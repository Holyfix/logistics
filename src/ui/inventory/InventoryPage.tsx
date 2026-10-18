import { Fragment, useMemo, useState } from 'react';
import { dayToIso, type DayNumber } from '../../core/dates';
import { formatDayShort, formatOneDecimal, formatQuantity, type Locale } from '../../core/format';
import { BANDS, BLOCK_REASONS, buildInventory, byUrgency, KINDS, type Band, type InventoryLine, type Kind, type Scope } from '../../core/inventory';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsx } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';

type Tab = 'overview' | 'parts' | 'blocked';

/** Kolik dílů ukazuje Přehled v tabulce dílů mimo pásmo v pořádku. */
const PROBLEM_ROWS = 30;

/** Pásma s dosahem v pruhu rozložení (bez „ostatní“). */
const DIST_BANDS: readonly Band[] = ['crit', 'low', 'ok', 'high', 'over', 'none'];

/** Hodnota v Kč: miliony s jedním desetinným místem, jinak celé koruny. */
export function money(value: number, locale: Locale): string {
  if (Math.abs(value) >= 1_000_000) return `${formatOneDecimal(value / 1_000_000, locale)} ${locale === 'cs' ? 'mil. Kč' : 'M CZK'}`;
  return `${formatQuantity(Math.round(value), locale)} ${locale === 'cs' ? 'Kč' : 'CZK'}`;
}

const sum = (lines: readonly InventoryLine[], f: (l: InventoryLine) => number) => lines.reduce((s, l) => s + f(l), 0);

/** „1 díl“, „3 díly“, „12 dílů“. */
function partsCount(n: number, locale: Locale, forms: { one: string; few: string; other: string }): string {
  const form = new Intl.PluralRules(locale).select(n);
  return `${formatQuantity(n, locale)} ${form === 'one' ? forms.one : form === 'few' ? forms.few : forms.other}`;
}

/** Den „5. 4.“, v jiném roce než dnes s rokem „5. 4. 2027“. */
function dayText(d: DayNumber, today: DayNumber, locale: Locale): string {
  const iso = dayToIso(d);
  return formatDayShort(iso, locale) + (iso.slice(0, 4) !== dayToIso(today).slice(0, 4) ? ` ${iso.slice(0, 4)}` : '');
}

/** Zásoby: zdraví skladu – dosah podle potřeby zákazníka, minimum a maximum, nadbytek, blokace a hodnota. */
export function InventoryPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const { state } = useData();
  const data = state.data;
  const [tab, setTab] = useState<Tab>('overview');
  const [scope, setScope] = useState<Scope>('all');
  const [kind, setKind] = useState<Kind | ''>('');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [abc, setAbc] = useState('');
  const [band, setBand] = useState<Band | ''>('');
  const [query, setQuery] = useState('');

  const table = useMemo(
    () =>
      data?.stock
        ? buildInventory({ stock: data.stock.data, master: data.master?.data, boms: data.boms.map((b) => b.data), callOffs: data.exports.at(-1), today, scope })
        : null,
    [data, today, scope],
  );

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="stock" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.stock.title}</h1>
        <p className="lead">{t.modules.stock.description}</p>
      </div>
    </div>
  );

  if (!data || !table) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{data ? ti.noStock : ti.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {ti.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const options = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'cs'));
  const projects = options(table.lines.flatMap((l) => l.projects));
  const categories = options(table.lines.filter((l) => !project || l.projects.includes(project)).flatMap((l) => l.categories));
  const abcs = options(table.lines.map((l) => l.abc));
  // Filtry Přehledu (druh, projekt, kategorie, ABC); karta Díly navíc pásmo a hledání.
  const filtered = table.lines.filter(
    (l) => (!kind || l.kind === kind) && (!project || l.projects.includes(project)) && (!category || l.categories.includes(category)) && (!abc || l.abc === abc),
  );
  const q = query.trim().toLowerCase();
  const parts = filtered.filter((l) => (!band || l.band === band) && (!q || `${l.item} ${l.description}`.toLowerCase().includes(q))).sort(byUrgency);
  const latest = data.exports.at(-1);

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="tabs" role="tablist" aria-label={t.modules.stock.title}>
        {(['overview', 'parts', 'blocked'] as const).map((id) => (
          <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {ti.tabs[id]}
          </button>
        ))}
      </div>

      <div className="filters" role="group" aria-label={ti.filters.label}>
        <label className="inline-field">
          <span>{ti.filters.kind}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
            <option value="">{ti.filters.all}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {ti.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{ti.filters.project}</span>
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setCategory('');
            }}
          >
            <option value="">{ti.filters.all}</option>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {categories.length > 0 && (
          <label className="inline-field">
            <span>{ti.filters.category}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{ti.filters.all}</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        {abcs.length > 0 && (
          <label className="inline-field">
            <span>{ti.filters.abc}</span>
            <select value={abc} onChange={(e) => setAbc(e.target.value)}>
              <option value="">{ti.filters.all}</option>
              {abcs.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        )}
        <label className="inline-field">
          <span>{ti.filters.scope}</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {(['all', 'internal', 'external'] as const).map((s) => (
              <option key={s} value={s}>
                {ti.scope[s]}
              </option>
            ))}
          </select>
        </label>
        <span className="filters-break" role="presentation" />
        <span className="muted inv-source">
          {table.horizonEnd === null
            ? `${data.stock!.path.split('/').pop()} · ${ti.noCallOffs}`
            : ti.source
                .replace('{stock}', data.stock!.path.split('/').pop()!)
                .replace('{calloffs}', latest ? `CW ${latest.week}/${latest.year}` : '—')
                .replace('{end}', dayText(table.horizonEnd, today, locale))}
        </span>
      </div>

      {!table.hasCost && <p className="banner banner-warn">{ti.noCost}</p>}
      {table.negativeRows > 0 && <p className="muted">{ti.negative.replace('{n}', formatQuantity(table.negativeRows, locale))}</p>}

      {tab === 'overview' && <Overview lines={filtered} today={today} onParts={() => setTab('parts')} />}
      {tab === 'parts' && (
        <div className="panel">
          <div className="filters" role="group" aria-label={ti.tabs.parts}>
            <label className="inline-field">
              <span>{ti.filters.band}</span>
              <select value={band} onChange={(e) => setBand(e.target.value as Band | '')}>
                <option value="">{ti.filters.all}</option>
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {ti.bands[b]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              <span>{ti.filters.search}</span>
              <input type="search" value={query} placeholder={ti.filters.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <span className="muted">{partsCount(parts.length, locale, ti.parts)}</span>
            <span className="filters-break" role="presentation" />
            <button type="button" className="button" onClick={() => void exportParts(parts, ti, today)}>
              {ti.export.button}
            </button>
          </div>
          <PartsTable lines={parts} today={today} />
        </div>
      )}
      {tab === 'blocked' && <BlockedTable lines={filtered} today={today} />}
    </section>
  );
}

function Overview({ lines, today, onParts }: { lines: InventoryLine[]; today: DayNumber; onParts: () => void }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const m = (v: number) => money(v, locale);
  const crit = lines.filter((l) => l.band === 'crit');
  const low = lines.filter((l) => l.toMin > 0);
  const over = lines.filter((l) => l.band === 'over');
  const idle = lines.filter((l) => l.idle);
  const idleValue = (l: InventoryLine) => l.value + l.blockedValue;
  const blocked = Object.fromEntries(BLOCK_REASONS.map((r) => [r, sum(lines, (l) => l.blockedBy[r] * l.unitCost)])) as Record<(typeof BLOCK_REASONS)[number], number>;
  const value = sum(lines, (l) => l.value);
  const external = sum(lines, (l) => l.externalValue);
  const problems = lines.filter((l) => ['crit', 'low', 'over', 'none'].includes(l.band)).sort(byUrgency);

  const tiles = [
    { label: ti.tiles.value, value: m(value), note: ti.tiles.valueNote.replace('{external}', m(external)) },
    { label: ti.tiles.crit, value: formatQuantity(crit.length, locale), note: ti.tiles.critNote.replace('{pcs}', formatQuantity(sum(crit, (l) => l.toMin), locale)), tone: crit.length ? 'cell-short' : '' },
    { label: ti.tiles.low, value: formatQuantity(low.length, locale), note: ti.tiles.lowNote.replace('{value}', m(sum(low, (l) => l.toMin * l.unitCost))) },
    { label: ti.tiles.over, value: formatQuantity(over.length, locale), note: ti.tiles.overNote.replace('{value}', m(sum(over, (l) => l.overMax * l.unitCost))) },
    {
      label: ti.tiles.idle,
      value: formatQuantity(idle.length, locale),
      note: ti.tiles.idleNote.replace('{value}', m(sum(idle, idleValue))).replace('{none}', m(sum(idle.filter((l) => l.band === 'none'), idleValue))),
    },
    {
      label: ti.tiles.blocked,
      value: m(blocked.quality + blocked.inventory + blocked.logistics),
      note: ti.tiles.blockedNote.replace('{quality}', m(blocked.quality)).replace('{inventory}', m(blocked.inventory)).replace('{logistics}', m(blocked.logistics)),
    },
  ];

  return (
    <>
      <div className="kpis inv-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="kpi">
            <span className="kpi-label">{tile.label}</span>
            <span className={`kpi-value${tile.tone ? ` ${tile.tone}` : ''}`}>{tile.value}</span>
            <span className="kpi-note">{tile.note}</span>
          </div>
        ))}
      </div>

      <div className="inv-grid">
        <div className="panel">
          <h2>{ti.distribution.heading}</h2>
          <p className="muted">{ti.distribution.note}</p>
          {(['FG', 'SFG', 'PG'] as const).map((k) => {
            const of = lines.filter((l) => l.kind === k);
            return (
              <div key={k} className="inv-dist-row">
                <b>{ti.kinds[k]}</b>
                <div className="inv-stack" role="img" aria-label={`${ti.kinds[k]}: ${DIST_BANDS.map((b) => `${ti.bands[b]} ${of.filter((l) => l.band === b).length}`).join(', ')}`}>
                  {DIST_BANDS.map((b) => {
                    const n = of.filter((l) => l.band === b).length;
                    return n ? (
                      <span key={b} className={`inv-band-${b}`} style={{ flex: n }} title={`${ti.bands[b]}: ${n} · ${ti.bandHint[b]}`}>
                        {n}
                      </span>
                    ) : null;
                  })}
                </div>
                <span className="muted">{ti.distribution.summary.replace('{n}', partsCount(of.length, locale, ti.parts)).replace('{value}', m(sum(of, (l) => l.value)))}</span>
              </div>
            );
          })}
          {(() => {
            const other = lines.filter((l) => l.kind === 'other');
            return (
              <div className="inv-dist-row">
                <b className="muted">{ti.kinds.other}</b>
                <span className="muted">{ti.distribution.other}</span>
                <span className="muted">{ti.distribution.summary.replace('{n}', partsCount(other.length, locale, ti.parts)).replace('{value}', m(sum(other, (l) => l.value)))}</span>
              </div>
            );
          })()}
          <ul className="inv-legend">
            {DIST_BANDS.map((b) => (
              <li key={b} title={ti.bandHint[b]}>
                <i className={`inv-band-${b}`} /> {ti.bands[b]}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>{ti.structure.heading}</h2>
          <p className="muted">{ti.structure.note}</p>
          <table className="table inv-structure">
            <tbody>
              <tr>
                <td>{ti.structure.internal}</td>
                <td className="n">{m(value - external)}</td>
              </tr>
              <tr>
                <td>{ti.structure.external}</td>
                <td className="n">{m(external)}</td>
              </tr>
              {BLOCK_REASONS.map((r) => (
                <tr key={r}>
                  <td>{ti.structure.blocked.replace('{reason}', ti.reasons[r])}</td>
                  <td className="n">{m(blocked[r])}</td>
                </tr>
              ))}
              <tr className="inv-total">
                <td>{ti.structure.total}</td>
                <td className="n">{m(value + blocked.quality + blocked.inventory + blocked.logistics)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>{ti.problems.heading}</h2>
        <p className="muted">{ti.problems.note}</p>
        <PartsTable lines={problems.slice(0, PROBLEM_ROWS)} today={today} />
        {problems.length > PROBLEM_ROWS && (
          <p>
            <button type="button" className="link-button" onClick={onParts}>
              {ti.problems.more.replace('{n}', formatQuantity(problems.length, locale))}
            </button>
          </p>
        )}
      </div>
    </>
  );
}

/** Tabulka dílů; klik na řádek ukáže lokace dílu. */
function PartsTable({ lines, today }: { lines: InventoryLine[]; today: DayNumber }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const tt = ti.table;
  const [open, setOpen] = useState<string | null>(null);
  const qty = (n: number) => formatQuantity(n, locale);
  const date = (d: DayNumber | null) => (d === null ? '—' : dayText(d, today, locale));
  if (!lines.length) return <p className="muted">{tt.empty}</p>;
  return (
    <div className="table-scroll">
      <table className="table table-data inv-table">
        <thead>
          <tr>
            <th>{tt.item}</th>
            <th>{tt.description}</th>
            <th>{tt.kind}</th>
            <th>{tt.abc}</th>
            <th className="n">{tt.free}</th>
            <th className="n">{tt.blocked}</th>
            <th className="n">{tt.min}</th>
            <th className="n">{tt.max}</th>
            <th className="n">{tt.days}</th>
            <th className="n">{tt.toMin}</th>
            <th className="n">{tt.overMax}</th>
            <th className="n">{tt.value}</th>
            <th className="n">{tt.lastMove}</th>
            <th>{tt.band}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const expanded = open === l.item;
            const other = l.kind === 'other';
            return (
              <Fragment key={l.item}>
                <tr className={`inv-row${expanded ? ' inv-row-open' : ''}`} onClick={() => setOpen(expanded ? null : l.item)}>
                  <td>
                    <strong>{l.item}</strong>
                  </td>
                  <td className="inv-desc" title={l.description}>
                    {l.description}
                  </td>
                  <td>{ti.kinds[l.kind]}</td>
                  <td>{l.abc}</td>
                  <td className="n">
                    {qty(l.free)}
                    {l.external > 0 && (
                      <small className="cell-note">
                        {tt.external} {qty(l.external)}
                      </small>
                    )}
                  </td>
                  <td className="n">{l.blocked ? qty(l.blocked) : '—'}</td>
                  <td className="n">{other ? '' : qty(l.min)}</td>
                  <td className="n">{other ? '' : qty(l.max)}</td>
                  <td className={`n${l.band === 'crit' ? ' cell-short' : ''}`}>
                    {other || l.band === 'none' ? '—' : l.days === null ? tt.beyond : tt.daysUnit.replace('{n}', qty(l.days))}
                  </td>
                  <td className={`n${l.band === 'crit' ? ' cell-short' : ''}`}>{l.toMin ? qty(l.toMin) : '—'}</td>
                  <td className="n">{l.overMax ? qty(l.overMax) : '—'}</td>
                  <td className="n">{money(l.value, locale)}</td>
                  <td className={`n${l.idle ? ' cell-short' : ''}`} title={l.idle ? tt.idle : undefined}>
                    {date(l.lastMove)}
                  </td>
                  <td>
                    <span className={`inv-chip inv-band-${l.band}`} title={ti.bandHint[l.band]}>
                      {ti.bands[l.band]}
                    </span>
                    {l.idle && <span className="inv-chip inv-idle">{tt.idle}</span>}
                  </td>
                </tr>
                {expanded && (
                  <tr className="inv-detail">
                    <td colSpan={14}>
                      {l.locations.length === 0 ? (
                        <p className="muted">{ti.locations.none}</p>
                      ) : (
                      <table className="table inv-locations">
                        <thead>
                          <tr>
                            <th>{ti.locations.location}</th>
                            <th>{ti.locations.status}</th>
                            <th>{ti.locations.zone}</th>
                            <th className="n">{ti.locations.qty}</th>
                            <th className="n">{ti.locations.value}</th>
                            <th className="n">{ti.locations.lastMove}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l.locations.map((loc, k) => (
                            <tr key={k}>
                              <td>
                                {loc.location}
                                {loc.external && <small className="cell-note"> {ti.locations.external}</small>}
                              </td>
                              <td>
                                {loc.status}
                                <small className="cell-note"> {loc.blocked ? ti.reasons[loc.blocked] : ti.locations.free}</small>
                              </td>
                              <td>{loc.zone}</td>
                              <td className="n">{qty(loc.qty)}</td>
                              <td className="n">{money(loc.value, locale)}</td>
                              <td className="n">{date(loc.lastMove)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Blokovaná zásoba po lokacích, podle hodnoty. */
function BlockedTable({ lines, today }: { lines: InventoryLine[]; today: DayNumber }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const rows = lines
    .flatMap((l) => l.locations.filter((loc) => loc.blocked).map((loc) => ({ line: l, loc })))
    .sort((a, b) => b.loc.value - a.loc.value || a.line.item.localeCompare(b.line.item));
  return (
    <div className="panel">
      <h2>{ti.blockedTab.heading}</h2>
      <p className="muted">{ti.blockedTab.note}</p>
      {rows.length === 0 ? (
        <p className="muted">{ti.blockedTab.empty}</p>
      ) : (
        <div className="table-scroll">
          <table className="table table-data inv-table">
            <thead>
              <tr>
                <th>{ti.table.item}</th>
                <th>{ti.table.description}</th>
                <th>{ti.table.kind}</th>
                <th>{ti.blockedTab.reason}</th>
                <th>{ti.locations.status}</th>
                <th>{ti.locations.location}</th>
                <th className="n">{ti.locations.qty}</th>
                <th className="n">{ti.locations.value}</th>
                <th className="n">{ti.locations.lastMove}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, loc }, k) => (
                <tr key={k}>
                  <td>
                    <strong>{line.item}</strong>
                  </td>
                  <td className="inv-desc">{line.description}</td>
                  <td>{ti.kinds[line.kind]}</td>
                  <td>{ti.reasons[loc.blocked!]}</td>
                  <td>{loc.status}</td>
                  <td>{loc.location}</td>
                  <td className="n">{formatQuantity(loc.qty, locale)}</td>
                  <td className="n">{money(loc.value, locale)}</td>
                  <td className="n">{loc.lastMove === null ? '—' : dayText(loc.lastMove, today, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function exportParts(lines: InventoryLine[], ti: ReturnType<typeof useI18n>['t']['inventory'], today: DayNumber) {
  const tt = ti.table;
  const header = [tt.item, tt.description, tt.kind, ti.filters.project, ti.filters.category, tt.abc, tt.free, tt.external, tt.blocked, tt.min, tt.max, tt.days, tt.toMin, tt.overMax, tt.value, tt.lastMove, tt.band];
  const rows = lines.map((l) => [
    l.item,
    l.description,
    ti.kinds[l.kind],
    l.projects.join(', '),
    l.categories.join(', '),
    l.abc,
    l.free,
    l.external,
    l.blocked,
    l.kind === 'other' ? null : l.min,
    l.kind === 'other' ? null : l.max,
    l.days,
    l.toMin,
    l.overMax,
    Math.round(l.value),
    l.lastMove === null ? null : dayToIso(l.lastMove),
    ti.bands[l.band] + (l.idle ? `, ${tt.idle}` : ''),
  ]);
  return downloadXlsx(`${ti.export.fileName}_${dayToIso(today)}.xlsx`, ti.export.sheet, header, rows);
}
