import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { mergeBoms } from '../core/bom';
import { dayToIso, weekday, type DayNumber } from '../core/dates';
import { formatDayShort, formatQuantity, type Locale } from '../core/format';
import { buildMaterialCoverage, PART_KINDS, type CarCoverage, type Demand, type DoorCoverage, type PartCoverage, type PartKind } from '../core/material/coverage';
import { dayOfStamp, DOORS, MINUTES_PER_DAY, type Stamp } from '../core/material/jit';
import { statusCode } from '../core/material/matrix';
import { parseStockPaste } from '../core/material/stock';
import { parseNumber } from '../core/numbers';
import { useI18n } from '../i18n/I18nProvider';
import { downloadXlsxSheets } from '../platform/download';
import { loadStock, readMaterialFile, saveStock, type MaterialFile, type SavedStock } from '../platform/materialFiles';
import { localToday } from '../ui/components/useComponents';

const LOCALES: Locale[] = ['cs', 'en'];

type Tab = 'matrix' | 'parts';

/** Nové soubory: JIT a matice nahradí předchozí, kusovníky se přidají (stejný název nahradí). */
function addFiles(current: readonly MaterialFile[], added: readonly MaterialFile[]): MaterialFile[] {
  let next = [...current];
  for (const file of added) {
    next = next.filter((f) => (file.kind === 'jit' || file.kind === 'matrix' ? f.kind !== file.kind : f.name !== file.name));
    next.push(file);
  }
  return next;
}

/**
 * Pokrytí Maincarrieru a Middlefieldu: samostatná stránka (material.html) vedle logistické aplikace. Karta Matrix je ve
 * formátu Order Status Matrix (vozy a stav dveří, barva podle pokrytí materiálem), karta Díly a sklad pro zadání skladu.
 */
export function MaterialApp({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale, setLocale } = useI18n();
  const tm = t.material;
  const [files, setFiles] = useState<MaterialFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<SavedStock>(loadStock);
  const [tab, setTab] = useState<Tab>('matrix');
  const [kind, setKind] = useState<PartKind | ''>('');
  const [query, setQuery] = useState('');
  const [onlyShort, setOnlyShort] = useState(false);
  const [skipDone, setSkipDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);

  const jit = [...files].reverse().find((f) => f.kind === 'jit');
  const matrix = [...files].reverse().find((f) => f.kind === 'matrix');
  const bom = useMemo(() => {
    const boms = files.flatMap((f) => (f.kind === 'bom' ? [f.bom] : []));
    return boms.length ? mergeBoms(boms) : null;
  }, [files]);
  const stockMap = useMemo(() => new Map(Object.entries(stock.items)), [stock]);
  const coverage = useMemo(
    () =>
      jit?.kind === 'jit' && matrix?.kind === 'matrix' && bom
        ? buildMaterialCoverage({ matrix: matrix.orders, positions: jit.positions, bom, stock: stockMap, today, skipDone })
        : null,
    [jit, bom, matrix, stockMap, today, skipDone],
  );

  const load = async (list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      const read = await Promise.all([...list].map((f) => readMaterialFile(f).catch(() => ({ kind: 'unknown' as const, name: f.name }))));
      setFiles((current) => addFiles(current, read));
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void load([...e.dataTransfer.files]);
  };

  const updateStock = (items: Record<string, number>) => {
    const next = { items, at: new Date().toISOString() };
    setStock(next);
    saveStock(next);
  };
  const setItemStock = (item: string, text: string) => {
    const items = { ...stock.items };
    const qty = parseNumber(text);
    if (text.trim() === '' || qty === null) delete items[item];
    else items[item] = qty;
    updateStock(items);
  };

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const time = (s: Stamp | null) => {
    if (s === null) return tm.detail.noDate;
    const day = dayOfStamp(s);
    const minute = s - day * MINUTES_PER_DAY;
    // Rok jen u jiného roku než letos.
    const year = dayToIso(day).slice(0, 4);
    return `${dayLabel(day)}${year !== dayToIso(today).slice(0, 4) ? ` ${year}` : ''} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  };
  const qty = (v: number) => formatQuantity(v, locale);
  const demandText = (d: Demand | null) => (d ? `${time(d.planned)} · ${d.productionNumber} ${d.door}` : '');
  /** Text pokrytí dveří: díly MC a MF se značkou, nebo důvod, proč pokrytí nejde určit. */
  const doorNote = (cell: DoorCoverage) =>
    cell.state === 'unknown'
      ? tm.matrix.notInJit
      : cell.state === 'skipped'
        ? tm.matrix.skipped
        : cell.state === 'none'
          ? tm.matrix.noParts
          : cell.parts.map((p) => `${p.kind} ${p.left < -1e-9 ? '✗' : '✓'}`).join(' · ');
  const doorTitle = (cell: DoorCoverage) =>
    [cell.panel ? `${tm.detail.panel}: ${cell.panel}` : tm.matrix.notInJit, ...cell.parts.map((p) => `${tm.kinds[p.kind]} ${p.item}: ${tm.matrix.left} ${qty(p.left)}`)].join('\n');

  const q = query.trim().toLowerCase();
  const cars = (coverage?.cars ?? []).filter((c) => (!onlyShort || c.short) && (!q || `${c.productionNumber} ${c.lot}`.toLowerCase().includes(q)));
  const parts = (coverage?.parts ?? []).filter(
    (p) => (!kind || p.kind === kind) && (!onlyShort || p.firstShort) && (!q || `${p.item} ${p.description}`.toLowerCase().includes(q)),
  );
  const anyOverdue = parts.some((p) => p.overdue > 0);
  const selectedPart = coverage?.parts.find((p) => p.item === selected) ?? null;
  // První nepokryté dveře v pořadí stavby.
  const firstShort = (() => {
    for (const car of coverage?.cars ?? []) for (const door of DOORS) if (car.doors[door]?.state === 'short') return { car, cell: car.doors[door]! };
    return null;
  })();
  const shortDoors = (coverage?.cars ?? []).reduce((n, c) => n + DOORS.filter((d) => c.doors[d]?.state === 'short').length, 0);

  const exportExcel = () => {
    if (!coverage) return;
    const material = (cell: DoorCoverage | undefined) =>
      !cell
        ? null
        : cell.state === 'short'
          ? `${tm.matrix.short}: ${cell.parts
              .filter((p) => p.left < -1e-9)
              .map((p) => p.item)
              .join(', ')}`
          : doorNote(cell).replace(/ ✓/g, ' OK');
    void downloadXlsxSheets(`${tm.export.fileName}_${dayToIso(today)}.xlsx`, [
      {
        name: tm.export.matrix,
        header: [tm.matrix.lot, tm.matrix.productionNumber, tm.matrix.optionType, tm.matrix.colors, tm.matrix.planned, ...DOORS.flatMap((d) => [`${tm.matrix.status} ${d}`, `${tm.matrix.material} ${d}`])],
        rows: cars.map((c) => [c.lot, c.productionNumber, c.optionType, c.colors, c.planned === null ? null : time(c.planned), ...DOORS.flatMap((d) => [c.doors[d]?.status ?? null, material(c.doors[d])])]),
        stickyColumns: 2,
      },
      {
        name: tm.export.sheet,
        header: [tm.table.item, tm.table.description, tm.table.kind, tm.table.stock, tm.table.demand, tm.table.covered, tm.table.shortFrom, ...coverage.days.map(dayToIso)],
        rows: parts.map((p) => [p.item, p.description, tm.kinds[p.kind], p.stock, p.total, demandText(p.lastCovered), demandText(p.firstShort), ...p.balance]),
        stickyColumns: 1,
      },
    ]);
  };

  const stockInfo = stock.at ? tm.stock.saved.replace('{at}', new Date(stock.at).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })) : tm.stock.notSaved;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <span className="brand-name">{tm.title}</span>
          <span className="brand-tagline">{tm.tagline}</span>
        </span>
        <span />
        <div className="segmented" role="group" aria-label={t.language.label}>
          {LOCALES.map((l) => (
            <button key={l} type="button" aria-pressed={locale === l} onClick={() => setLocale(l)}>
              {t.language[l]}
            </button>
          ))}
        </div>
      </header>

      <main className="content">
        <section className="page" aria-labelledby="page-title">
          <div className="page-head">
            <h1 id="page-title">{tm.title}</h1>
            <p className="lead">{tm.lead}</p>
          </div>

          <div className="panel" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <div className="panel-head">
              <h2>{tm.load.heading}</h2>
              <span className="panel-actions">
                <label className="button button-primary">
                  {busy ? tm.load.reading : tm.load.choose}
                  <input type="file" multiple accept=".csv,.txt,.xlsx" hidden onChange={(e) => void load(e.target.files)} />
                </label>
                {files.length > 0 && (
                  <button type="button" className="button" onClick={() => setFiles([])}>
                    {tm.load.clear}
                  </button>
                )}
              </span>
            </div>
            <p className="muted">{tm.load.hint}</p>
            {files.length > 0 && (
              <ul className="mat-files">
                {files.map((f) => (
                  <li key={f.name} className={f.kind === 'unknown' ? 'cell-short' : undefined}>
                    <strong>{f.name}</strong> ·{' '}
                    {f.kind === 'jit'
                      ? tm.load.jit.replace('{orders}', qty(new Set(f.positions.map((p) => p.order)).size)).replace('{pn}', qty(new Set(f.positions.map((p) => p.productionNumber)).size))
                      : f.kind === 'bom'
                        ? tm.load.bom.replace('{panels}', qty(f.bom.trees.size)) + (f.bom.expired ? tm.load.bomExpired.replace('{n}', qty(f.bom.expired)) : '')
                        : f.kind === 'matrix'
                          ? tm.load.matrix.replace('{n}', qty(f.orders.size))
                          : tm.load.unknown}
                  </li>
                ))}
              </ul>
            )}
            {files.length > 0 && !matrix && <p className="banner banner-warn">{tm.load.needMatrix}</p>}
            {files.length > 0 && !jit && <p className="banner banner-warn">{tm.load.needJit}</p>}
            {files.length > 0 && !bom && <p className="banner banner-warn">{tm.load.needBom}</p>}
          </div>

          {coverage && (
            <>
              <div className="kpis">
                <div className="kpi">
                  <span className="kpi-label">{tm.tiles.cars}</span>
                  <span className="kpi-value">{qty(coverage.cars.length)}</span>
                  <span className="kpi-note">{tm.tiles.carsNote.replace('{doors}', qty(coverage.doors))}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">{tm.tiles.known}</span>
                  <span className="kpi-value">{qty(coverage.known)}</span>
                  <span className="kpi-note">{tm.tiles.knownNote.replace('{n}', qty(coverage.unknown))}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">{tm.tiles.short}</span>
                  <span className={`kpi-value${shortDoors ? ' cell-short' : ''}`}>{qty(shortDoors)}</span>
                  <span className="kpi-note">
                    {PART_KINDS.map((k) => `${tm.kinds[k]} ${qty(coverage.parts.filter((p) => p.kind === k && p.firstShort).length)}`).join(' · ')} {tm.tiles.shortParts}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">{tm.tiles.first}</span>
                  <span className="kpi-value mat-kpi-small">{firstShort ? time(firstShort.car.planned) : tm.tiles.none}</span>
                  <span className="kpi-note">
                    {firstShort
                      ? `${firstShort.car.productionNumber} ${firstShort.cell.door} · ${firstShort.cell.parts
                          .filter((p) => p.left < -1e-9)
                          .map((p) => p.item)
                          .join(', ')}`
                      : ''}
                  </span>
                </div>
              </div>

              <div className="tabs" role="tablist" aria-label={tm.title}>
                {(['matrix', 'parts'] as const).map((id) => (
                  <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                    {tm.tabs[id]}
                  </button>
                ))}
              </div>

              <div className="filters" role="group" aria-label={tm.filters.label}>
                {tab === 'parts' && (
                  <span className="segmented" role="group" aria-label={tm.filters.kind}>
                    {(['', ...PART_KINDS] as const).map((k) => (
                      <button key={k || 'all'} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                        {k ? tm.kinds[k] : tm.filters.all}
                      </button>
                    ))}
                  </span>
                )}
                <label className="field field-wide">
                  <span>{tab === 'matrix' ? tm.filters.searchCar : tm.filters.search}</span>
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <label className="check-field">
                  <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
                  {tab === 'matrix' ? tm.filters.onlyShortCars : tm.filters.onlyShort}
                </label>
                <label className="check-field">
                  <input type="checkbox" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} />
                  {tm.filters.skipDone}
                </label>
                <span className="filters-break" role="presentation" />
                <span className="muted">{stockInfo}</span>
                <button type="button" className="button button-small" onClick={exportExcel}>
                  ⤓ {tm.export.button}
                </button>
              </div>

              {tab === 'matrix' && (
                <div className="panel">
                  <div className="panel-head">
                    <h2>{tm.matrix.heading}</h2>
                    <span className="muted">{tm.matrix.sub}</span>
                  </div>
                  {cars.length === 0 ? (
                    <p className="muted">{tm.matrix.empty}</p>
                  ) : (
                    <div className="table-scroll table-tall">
                      <table className="table table-data mat-matrix">
                        <thead>
                          <tr>
                            <th>{tm.matrix.lot}</th>
                            <th className="sticky-col">{tm.matrix.productionNumber}</th>
                            <th>{tm.matrix.optionType}</th>
                            <th>{tm.matrix.colors}</th>
                            <th>{tm.matrix.planned}</th>
                            {DOORS.map((d) => (
                              <th key={d}>
                                {tm.matrix.status} {d}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cars.map((c) => (
                            <CarRow key={c.productionNumber} car={c} time={time} note={doorNote} title={doorTitle} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <ul className="cov-legend">
                    <li>
                      <i className="swatch mat-ok" /> {tm.matrix.legendOk}
                    </li>
                    <li>
                      <i className="swatch mat-short" /> {tm.matrix.legendShort}
                    </li>
                    <li>
                      <i className="swatch mat-unknown" /> {tm.matrix.legendUnknown}
                    </li>
                  </ul>
                  <p className="muted">{tm.matrix.note}</p>
                </div>
              )}

              {tab === 'parts' && (
                <div className="panel">
                  <div className="panel-head">
                    <h2>{tm.table.heading}</h2>
                    <span className="muted">{tm.table.sub}</span>
                    <span className="panel-actions">
                      <button type="button" className="button button-small" onClick={() => setPaste('')}>
                        {tm.stock.paste}
                      </button>
                      {Object.keys(stock.items).length > 0 && (
                        <button type="button" className="button button-small" onClick={() => window.confirm(tm.stock.clearConfirm) && updateStock({})}>
                          {tm.stock.clear}
                        </button>
                      )}
                    </span>
                  </div>
                  {paste !== null && (
                    <div className="mat-paste">
                      <p className="muted">{tm.stock.pasteHint}</p>
                      <textarea rows={6} value={paste} aria-label={tm.stock.paste} onChange={(e) => setPaste(e.target.value)} />
                      <p>
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => {
                            updateStock({ ...stock.items, ...Object.fromEntries(parseStockPaste(paste)) });
                            setPaste(null);
                          }}
                        >
                          {tm.stock.apply}
                        </button>{' '}
                        <button type="button" className="button" onClick={() => setPaste(null)}>
                          {tm.stock.cancel}
                        </button>
                      </p>
                    </div>
                  )}
                  {parts.length === 0 ? (
                    <p className="muted">{tm.table.empty}</p>
                  ) : (
                    <div className="table-scroll table-tall">
                      <table className="table table-data">
                        <thead>
                          <tr>
                            <th className="sticky-col">{tm.table.item}</th>
                            <th>{tm.table.description}</th>
                            <th className="n">{tm.table.stock}</th>
                            <th className="n">{tm.table.demand}</th>
                            <th>{tm.table.covered}</th>
                            {anyOverdue && <th className="n">{tm.table.overdue}</th>}
                            {coverage.days.map((d) => (
                              <th key={d} className={`n${weekday(d) >= 6 ? ' col-weekend' : ''}`}>
                                {dayLabel(d)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {parts.map((p) => (
                            <PartRow
                              key={p.item}
                              part={p}
                              days={coverage.days}
                              anyOverdue={anyOverdue}
                              selected={p.item === selected}
                              onSelect={() => setSelected(p.item === selected ? null : p.item)}
                              onStock={(text) => setItemStock(p.item, text)}
                              demandText={demandText}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="muted">{tm.legend}</p>
                </div>
              )}

              {tab === 'parts' && selectedPart && <PartDetail part={selectedPart} time={time} onClose={() => setSelected(null)} />}
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>{t.footer.privacy}</span>
        <span>
          {t.footer.version} {__APP_VERSION__} · {t.footer.built} {__BUILD_DATE__}
        </span>
      </footer>
    </div>
  );
}

/** Řádek vozu jako v Order Status Matrix: stav dveří a pod ním pokrytí MC a MF; barva buňky podle pokrytí. */
function CarRow({
  car,
  time,
  note,
  title,
}: {
  car: CarCoverage;
  time: (s: Stamp | null) => string;
  note: (cell: DoorCoverage) => string;
  title: (cell: DoorCoverage) => string;
}) {
  return (
    <tr className={car.short ? 'mat-car-short' : undefined}>
      <td>{car.lot}</td>
      <td className="sticky-col">
        <strong>{car.productionNumber}</strong>
      </td>
      <td>{car.optionType}</td>
      <td>{car.colors}</td>
      <td>{time(car.planned)}</td>
      {DOORS.map((d) => {
        const cell = car.doors[d];
        if (!cell) return <td key={d} />;
        return (
          <td key={d} className={`mat-door mat-${cell.state}`} title={title(cell)}>
            {cell.status}
            <small className="cell-note">
              {cell.parts.length === 0
                ? note(cell)
                : cell.parts.map((p, i) => (
                    <span key={p.item} className={p.left < -1e-9 ? 'mat-part-short' : undefined}>
                      {i > 0 && ' · '}
                      {p.kind} {p.left < -1e-9 ? '✗' : '✓'}
                    </span>
                  ))}
            </small>
          </td>
        );
      })}
    </tr>
  );
}

function PartRow({
  part: p,
  days,
  anyOverdue,
  selected,
  onSelect,
  onStock,
  demandText,
}: {
  part: PartCoverage;
  days: readonly DayNumber[];
  anyOverdue: boolean;
  selected: boolean;
  onSelect: () => void;
  onStock: (text: string) => void;
  demandText: (d: Demand | null) => string;
}) {
  const { t, locale } = useI18n();
  const tm = t.material;
  const qty = (v: number) => formatQuantity(v, locale);
  const [draft, setDraft] = useState<string | null>(null);
  const afterOverdue = (p.stock ?? 0) - p.overdue;
  return (
    <tr className={`mat-row${selected ? ' row-selected' : ''}`} onClick={onSelect}>
      <td className="sticky-col">
        <strong>{p.item}</strong>
        <small className="cell-note muted">{tm.kinds[p.kind]}</small>
      </td>
      <td className="desc">{p.description}</td>
      <td className="n" onClick={(e) => e.stopPropagation()}>
        <input
          className="mat-stock"
          inputMode="numeric"
          aria-label={`${tm.table.stock} ${p.item}`}
          title={tm.table.stockTitle}
          value={draft ?? (p.stock === null ? '' : String(p.stock))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) onStock(draft);
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="n">{qty(p.total)}</td>
      <td className="cell-until">
        <strong className={p.firstShort ? 'cell-short' : undefined}>{p.firstShort ? (p.lastCovered ? demandText(p.lastCovered) : tm.table.none) : tm.table.all}</strong>
        {p.firstShort && (
          <small className="muted cell-note">
            {tm.table.shortFrom} {demandText(p.firstShort)}
          </small>
        )}
      </td>
      {anyOverdue && <td className={`n${afterOverdue < 0 ? ' cell-negative' : ''}`}>{p.overdue ? qty(afterOverdue) : <span className="muted">–</span>}</td>}
      {p.balance.map((v, k) => (
        <td key={days[k]} className={`n${weekday(days[k]!) >= 6 ? ' col-weekend' : ''}${v < 0 ? ' cell-negative' : ''}`}>
          {qty(v)}
        </td>
      ))}
    </tr>
  );
}

/** Dveře, které díl potřebují, v pořadí stavby se zbývajícím skladem; první nepokryté zvýrazněné. */
function PartDetail({ part, time, onClose }: { part: PartCoverage; time: (s: Stamp | null) => string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const tm = t.material;
  const td = tm.detail;
  const qty = (v: number) => formatQuantity(v, locale);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), [part.item]);
  let left = part.stock ?? 0;
  const rows = part.demands.map((d) => ({ d, left: (left -= d.qty) }));
  const statuses = new Map<string, number>();
  for (const d of part.demands) statuses.set(d.status, (statuses.get(d.status) ?? 0) + d.qty);
  const byStatus = [...statuses].sort((a, b) => (statusCode(a[0]) ?? 0) - (statusCode(b[0]) ?? 0));
  return (
    <div className="panel" ref={ref} role="region" aria-label={`${td.heading} ${part.item}`}>
      <div className="panel-head">
        <h2>
          {part.item} · {part.description}
        </h2>
        <span className="muted">
          {td.byStatus}: {byStatus.map(([s, n]) => `${s || '—'} ${qty(n)}`).join(' · ')}
        </span>
        <span className="panel-actions">
          <button type="button" className="button button-small" onClick={onClose}>
            {td.close}
          </button>
        </span>
      </div>
      <div className="table-scroll table-tall">
        <table className="table table-data">
          <thead>
            <tr>
              <th>{td.assembly}</th>
              <th>{td.productionNumber}</th>
              <th>{td.door}</th>
              <th>{td.panel}</th>
              <th>{td.status}</th>
              <th className="n">{td.qty}</th>
              <th className="n">{td.left}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, left: l }, i) => (
              <tr key={`${d.productionNumber}-${d.door}-${i}`} className={d === part.firstShort ? 'row-selected' : undefined}>
                <td>{time(d.planned)}</td>
                <td>
                  <strong>{d.productionNumber}</strong>
                </td>
                <td title={tm.doors[d.door]}>{d.door}</td>
                <td>{d.panel}</td>
                <td>{d.status}</td>
                <td className="n">{qty(d.qty)}</td>
                <td className={`n${l < 0 ? ' cell-negative' : ''}`}>{qty(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
