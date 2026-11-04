import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { mergeBoms } from '../core/bom';
import { dayToIso, weekday, type DayNumber } from '../core/dates';
import { formatDayShort, formatQuantity, type Locale } from '../core/format';
import { buildMaterialCoverage, PART_KINDS, type Demand, type PartCoverage, type PartKind } from '../core/material/coverage';
import { dayOfStamp, MINUTES_PER_DAY, type Stamp } from '../core/material/jit';
import { statusCode } from '../core/material/matrix';
import { parseStockPaste } from '../core/material/stock';
import { parseNumber } from '../core/numbers';
import { useI18n } from '../i18n/I18nProvider';
import { downloadXlsxSheets } from '../platform/download';
import { loadStock, readMaterialFile, saveStock, type MaterialFile, type SavedStock } from '../platform/materialFiles';
import { localToday } from '../ui/components/useComponents';

const LOCALES: Locale[] = ['cs', 'en'];

/** Nové soubory: JIT a matice nahradí předchozí, kusovníky se přidají (stejný název nahradí). */
function addFiles(current: readonly MaterialFile[], added: readonly MaterialFile[]): MaterialFile[] {
  let next = [...current];
  for (const file of added) {
    next = next.filter((f) => (file.kind === 'jit' || file.kind === 'matrix' ? f.kind !== file.kind : f.name !== file.name));
    next.push(file);
  }
  return next;
}

/** Pokrytí Maincarrieru a Middlefieldu: samostatná stránka (material.html) vedle logistické aplikace. */
export function MaterialApp({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale, setLocale } = useI18n();
  const tm = t.material;
  const [files, setFiles] = useState<MaterialFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<SavedStock>(loadStock);
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
      jit?.kind === 'jit' && bom
        ? buildMaterialCoverage({ positions: jit.positions, bom, matrix: matrix?.kind === 'matrix' ? matrix.orders : undefined, stock: stockMap, today, skipDone })
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
    // Rok jen u jiného roku než letos (staré zakázky v JIT).
    const year = dayToIso(day).slice(0, 4);
    return `${dayLabel(day)}${year !== dayToIso(today).slice(0, 4) ? ` ${year}` : ''} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  };
  const qty = (v: number) => formatQuantity(v, locale);
  const demandText = (d: Demand | null) => (d ? `${time(d.assembly)} · ${d.productionNumber}${d.door ? ` ${d.door}` : ''}` : '');

  const q = query.trim().toLowerCase();
  const parts = (coverage?.parts ?? []).filter(
    (p) => (!kind || p.kind === kind) && (!onlyShort || p.firstShort) && (!q || `${p.item} ${p.description}`.toLowerCase().includes(q)),
  );
  const anyOverdue = parts.some((p) => p.overdue > 0);
  const selectedPart = coverage?.parts.find((p) => p.item === selected) ?? null;
  const firstShort = (coverage?.parts ?? []).filter((p) => p.firstShort).sort((a, b) => (a.firstShort!.assembly ?? -Infinity) - (b.firstShort!.assembly ?? -Infinity))[0];

  const exportExcel = () => {
    if (!coverage) return;
    const days = coverage.days.map(dayToIso);
    void downloadXlsxSheets(`${tm.export.fileName}_${dayToIso(today)}.xlsx`, [
      {
        name: tm.export.sheet,
        header: [tm.table.item, tm.table.description, tm.table.kind, tm.table.stock, tm.table.demand, tm.table.overdue, tm.table.covered, tm.table.shortFrom, ...days],
        rows: parts.map((p) => [p.item, p.description, tm.kinds[p.kind], p.stock, p.total, p.overdue, demandText(p.lastCovered), demandText(p.firstShort), ...p.balance]),
        stickyColumns: 1,
      },
      {
        name: tm.export.orders,
        header: [tm.table.item, tm.table.kind, tm.detail.assembly, tm.detail.productionNumber, tm.detail.door, tm.detail.panel, tm.detail.status, tm.detail.qty],
        rows: parts.flatMap((p) => p.demands.map((d) => [p.item, tm.kinds[p.kind], d.assembly === null ? null : time(d.assembly), d.productionNumber, d.door, d.panel, d.status, d.qty])),
        stickyColumns: 1,
      },
    ]);
  };

  const tiles = coverage && [
    { label: tm.tiles.cars, value: qty(coverage.productionNumbers), note: '' },
    {
      label: tm.tiles.doors,
      value: qty(coverage.counted),
      note: tm.tiles.doorsNote.replace('{total}', qty(coverage.orders)) + (coverage.skippedDone ? tm.tiles.skipped.replace('{n}', qty(coverage.skippedDone)) : ''),
    },
    ...PART_KINDS.map((k) => {
      const of = coverage.parts.filter((p) => p.kind === k);
      const short = of.filter((p) => p.firstShort).length;
      return { label: k === 'MC' ? tm.tiles.shortMc : tm.tiles.shortMf, value: qty(short), note: tm.tiles.shortNote.replace('{n}', qty(of.length)), tone: short ? 'cell-short' : '' };
    }),
    { label: tm.tiles.first, value: firstShort ? time(firstShort.firstShort!.assembly) : tm.tiles.none, note: firstShort ? `${firstShort.item} · ${firstShort.firstShort!.productionNumber}` : '', small: true },
  ];

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

          <div className="panel mat-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
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
            {files.length > 0 && !jit && <p className="banner banner-warn">{tm.load.needJit}</p>}
            {files.length > 0 && !bom && <p className="banner banner-warn">{tm.load.needBom}</p>}
            {coverage && coverage.withoutPanel.length > 0 && (
              <p className="muted" title={coverage.withoutPanel.slice(0, 50).join('\n')}>
                {tm.load.withoutPanel.replace('{n}', qty(coverage.withoutPanel.length))}
              </p>
            )}
          </div>

          {coverage && tiles && (
            <>
              <div className="kpis">
                {tiles.map((tile) => (
                  <div key={tile.label} className="kpi">
                    <span className="kpi-label">{tile.label}</span>
                    <span className={`kpi-value${'tone' in tile && tile.tone ? ` ${tile.tone}` : ''}${'small' in tile ? ' mat-kpi-small' : ''}`}>{tile.value}</span>
                    <span className="kpi-note">{tile.note}</span>
                  </div>
                ))}
              </div>

              <div className="filters" role="group" aria-label={tm.filters.label}>
                <span className="segmented" role="group" aria-label={tm.filters.kind}>
                  {(['', ...PART_KINDS] as const).map((k) => (
                    <button key={k || 'all'} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                      {k ? tm.kinds[k] : tm.filters.all}
                    </button>
                  ))}
                </span>
                <label className="field field-wide">
                  <span>{tm.filters.search}</span>
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <label className="check-field">
                  <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
                  {tm.filters.onlyShort}
                </label>
                {matrix && (
                  <label className="check-field">
                    <input type="checkbox" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} />
                    {tm.filters.skipDone}
                  </label>
                )}
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>{tm.table.heading}</h2>
                  <span className="muted">{tm.table.sub}</span>
                  <span className="panel-actions">
                    <span className="muted">{stock.at ? tm.stock.saved.replace('{at}', new Date(stock.at).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })) : tm.stock.notSaved}</span>
                    <button type="button" className="button button-small" onClick={() => setPaste('')}>
                      {tm.stock.paste}
                    </button>
                    {Object.keys(stock.items).length > 0 && (
                      <button type="button" className="button button-small" onClick={() => window.confirm(tm.stock.clearConfirm) && updateStock({})}>
                        {tm.stock.clear}
                      </button>
                    )}
                    <button type="button" className="button button-small" onClick={exportExcel}>
                      ⤓ {tm.export.button}
                    </button>
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

              {selectedPart && <PartDetail part={selectedPart} time={time} onClose={() => setSelected(null)} />}
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

/** Zakázky dílu v pořadí montáže se zbývajícím skladem po každé; první nepokrytá zvýrazněná. */
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
                <tr key={`${d.order}-${i}`} className={d === part.firstShort ? 'row-selected' : undefined}>
                  <td>{time(d.assembly)}</td>
                  <td>
                    <strong>{d.productionNumber}</strong>
                  </td>
                  <td title={d.door ? tm.doors[d.door] : undefined}>{d.door ?? '—'}</td>
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
