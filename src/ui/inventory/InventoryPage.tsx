import { useMemo, useState } from 'react';
import { dayToIso, type DayNumber } from '../../core/dates';
import { formatDayShort, formatOneDecimal, formatQuantity, type Locale } from '../../core/format';
import {
  BLOCK_REASONS,
  buildInventory,
  KINDS,
  MONEY_PARTS,
  moneyParts,
  moneyTotals,
  type Band,
  type InventoryLine,
  type Kind,
  type MoneyPart,
  type Scope,
} from '../../core/inventory';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsx } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';

/** Kolik největších položek ukazují žebříčky; zbytek se sečte do jednoho řádku. */
const TOP_ROWS = 5;

/** Pásma dosahu v grafu hodnoty (bez „ostatní“). */
const REACH_BANDS: readonly Band[] = ['crit', 'low', 'ok', 'high', 'over', 'none'];

/** Popisek úseku pruhu jen u úseků aspoň takového podílu (jinak se nevejde). */
const LABEL_SHARE = 0.1;

/** Hodnota v Kč: miliony s jedním desetinným místem, jinak celé koruny. */
export function money(value: number, locale: Locale): string {
  if (Math.abs(value) >= 1_000_000) return `${formatOneDecimal(value / 1_000_000, locale)} ${locale === 'cs' ? 'mil. Kč' : 'M CZK'}`;
  return `${formatQuantity(Math.round(value), locale)} ${locale === 'cs' ? 'Kč' : 'CZK'}`;
}

/** Krátká částka do pruhu grafu: „1,4 mil.“, „154 tis.“, „800“ (celá částka je v popisku úseku). */
function moneyShort(value: number, locale: Locale): string {
  if (Math.abs(value) >= 1_000_000) return `${formatOneDecimal(value / 1_000_000, locale)} ${locale === 'cs' ? 'mil.' : 'M'}`;
  if (Math.abs(value) >= 1_000) return `${formatQuantity(value / 1_000, locale)} ${locale === 'cs' ? 'tis.' : 'k'}`;
  return formatQuantity(value, locale);
}

const sum = (lines: readonly InventoryLine[], f: (l: InventoryLine) => number) => lines.reduce((s, l) => s + f(l), 0);

type PluralForms = { one: string; few: string; other: string };

/** Tvar podle počtu: „1 díl“, „3 díly“, „12 dílů“. */
function plural(n: number, locale: Locale, forms: PluralForms): string {
  const form = new Intl.PluralRules(locale).select(n);
  return form === 'one' ? forms.one : form === 'few' ? forms.few : forms.other;
}

function partsCount(n: number, locale: Locale, forms: PluralForms): string {
  return `${formatQuantity(n, locale)} ${plural(n, locale, forms)}`;
}

/** Den „5. 4.“, v jiném roce než dnes s rokem „5. 4. 2027“. */
function dayText(d: DayNumber, today: DayNumber, locale: Locale): string {
  const iso = dayToIso(d);
  return formatDayShort(iso, locale) + (iso.slice(0, 4) !== dayToIso(today).slice(0, 4) ? ` ${iso.slice(0, 4)}` : '');
}

/**
 * Zásoby: přehled aktuální zásoby v penězích – kolik je ve skladu a kolik z toho je navíc (nad maximem, nad celou
 * potřebu, bez potřeby, blokováno), hodnota podle dosahu, po projektech a největší položky. Detail dílů je v ERP.
 */
export function InventoryPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const { state } = useData();
  const data = state.data;
  const [scope, setScope] = useState<Scope>('all');
  const [kind, setKind] = useState<Kind | ''>('');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');

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
  const lines = table.lines.filter((l) => (!kind || l.kind === kind) && (!project || l.projects.includes(project)) && (!category || l.categories.includes(category)));
  const latest = data.exports.at(-1);
  const m = (v: number) => money(v, locale);
  const totals = moneyTotals(lines);
  const blocked = Object.fromEntries(BLOCK_REASONS.map((r) => [r, sum(lines, (l) => l.blockedBy[r] * l.unitCost)])) as Record<(typeof BLOCK_REASONS)[number], number>;

  const tiles = [
    { label: ti.tiles.value, value: m(sum(lines, (l) => l.value)), note: ti.tiles.valueNote.replace('{external}', m(sum(lines, (l) => l.externalValue))) },
    {
      label: ti.tiles.toMin,
      value: m(sum(lines, (l) => l.toMin * l.unitCost)),
      note: ti.tiles.toMinNote.replace('{crit}', m(sum(lines.filter((l) => l.band === 'crit'), (l) => l.toMin * l.unitCost))),
      tone: 'risk',
    },
    { label: ti.tiles.overMax, value: m(totals.overMax), note: ti.tiles.overMaxNote, tone: 'part-overMax' },
    { label: ti.tiles.surplus, value: m(totals.surplus), note: ti.tiles.surplusNote, tone: 'part-surplus' },
    {
      label: ti.tiles.none,
      value: m(totals.none),
      note: ti.tiles.noneNote.replace('{notInBom}', m(sum(lines.filter((l) => l.band === 'none' && l.noNeed === 'notInBom'), (l) => l.value))),
      tone: 'part-none',
    },
    {
      label: ti.tiles.blocked,
      value: m(totals.blocked),
      note: ti.tiles.blockedNote.replace('{quality}', m(blocked.quality)).replace('{inventory}', m(blocked.inventory)).replace('{logistics}', m(blocked.logistics)),
      tone: 'part-blocked',
    },
  ];

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

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

      <div className="kpis inv-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className={`kpi${tile.tone ? ` inv-tile-${tile.tone}` : ''}`}>
            <span className="kpi-label">{tile.label}</span>
            <span className="kpi-value">{tile.value}</span>
            <span className="kpi-note">{tile.note}</span>
          </div>
        ))}
      </div>

      <MoneyPanel totals={totals} known={table.horizonEnd !== null} />

      <div className="inv-grid">
        <ReachPanel lines={lines} />
        <ProjectsPanel lines={lines} />
      </div>

      <Rankings lines={lines} />

      <div className="panel inv-export">
        <span className="muted">{ti.export.note}</span>
        <button type="button" className="button" onClick={() => void exportParts(lines, ti, today)}>
          {ti.export.button}
        </button>
      </div>
    </section>
  );
}

/** Pruh: celá hodnota zásoby rozdělená podle potřeby, pod ním částky. */
function MoneyPanel({ totals, known }: { totals: Record<MoneyPart, number>; known: boolean }) {
  const { t, locale } = useI18n();
  const tm = t.inventory.money;
  const total = MONEY_PARTS.reduce((s, k) => s + totals[k], 0);
  const parts = MONEY_PARTS.filter((k) => k !== 'other' || totals.other > 0);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tm.heading}</h2>
        <span className="muted">{tm.note.replace('{total}', money(total, locale))}</span>
      </div>
      {!known && <p className="muted">{tm.noCallOffs}</p>}
      {total > 0 && (
        <div className="inv-money-bar" role="img" aria-label={parts.map((k) => `${tm.parts[k]} ${money(totals[k], locale)}`).join(', ')}>
          {parts.map((k) =>
            totals[k] > 0 ? (
              <span key={k} className={`inv-part-${k}`} style={{ flex: totals[k] }} title={`${tm.parts[k]}: ${money(totals[k], locale)}`}>
                {totals[k] / total >= LABEL_SHARE ? `${moneyShort(totals[k], locale)} · ${Math.round((totals[k] / total) * 100)} %` : ''}
              </span>
            ) : null,
          )}
        </div>
      )}
      <ul className="inv-money-split">
        {parts.map((k) => (
          <li key={k} title={tm.hints[k]}>
            <span>
              <i className={`inv-part-${k}`} /> {tm.parts[k]}
            </span>
            <b>{money(totals[k], locale)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Hodnota volné zásoby podle pásma dosahu pro FG, SFG a PG; délka pruhu podle hodnoty druhu. */
function ReachPanel({ lines }: { lines: InventoryLine[] }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const kinds = (['FG', 'SFG', 'PG'] as const).map((k) => {
    const of = lines.filter((l) => l.kind === k);
    return { kind: k, bands: REACH_BANDS.map((b) => sum(of.filter((l) => l.band === b), (l) => l.value)), total: sum(of, (l) => l.value) };
  });
  const widest = Math.max(1, ...kinds.map((k) => k.total));
  const other = sum(
    lines.filter((l) => l.kind === 'other'),
    (l) => l.value,
  );
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{ti.reach.heading}</h2>
      </div>
      <p className="muted">{ti.reach.note}</p>
      {kinds.map(({ kind, bands, total }) => (
        <div key={kind} className="inv-dist-row">
          <b>{ti.kinds[kind]}</b>
          <div className="inv-stack-track">
            <div
              className="inv-stack"
              style={{ width: `${(total / widest) * 100}%` }}
              role="img"
              aria-label={`${ti.kinds[kind]}: ${REACH_BANDS.map((b, i) => `${ti.bands[b]} ${money(bands[i]!, locale)}`).join(', ')}`}
            >
              {REACH_BANDS.map((b, i) =>
                bands[i]! > 0 ? (
                  <span key={b} className={`inv-band-${b}`} style={{ flex: bands[i] }} title={`${ti.bands[b]}: ${money(bands[i]!, locale)} · ${ti.bandHint[b]}`}>
                    {bands[i]! / widest >= LABEL_SHARE ? moneyShort(bands[i]!, locale) : ''}
                  </span>
                ) : null,
              )}
            </div>
          </div>
          <span className="muted">{money(total, locale)}</span>
        </div>
      ))}
      {other > 0 && (
        <div className="inv-dist-row">
          <b className="muted">{ti.kinds.other}</b>
          <span className="muted">{ti.reach.other}</span>
          <span className="muted">{money(other, locale)}</span>
        </div>
      )}
      <ul className="inv-legend">
        {REACH_BANDS.map((b) => (
          <li key={b} title={ti.bandHint[b]}>
            <i className={`inv-band-${b}`} /> {ti.bands[b]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Krátká tabulka po projektech: díl s více projekty zvlášť (hodnota se nedělí), díly bez projektu zvlášť. */
function ProjectsPanel({ lines }: { lines: InventoryLine[] }) {
  const { t, locale } = useI18n();
  const tp = t.inventory.projects;
  const m = (v: number) => (Math.abs(v) < 0.5 ? '–' : money(v, locale));
  const groups = new Map<string, InventoryLine[]>();
  for (const l of lines) {
    const key = l.projects.length === 1 ? l.projects[0]! : l.projects.length === 0 ? '' : '*';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }
  const rows = [...groups].map(([key, of]) => ({ key, totals: moneyTotals(of), value: sum(of, (l) => l.value) }));
  // Projekty podle hodnoty, společné díly a díly bez projektu na konec.
  rows.sort((a, b) => Number(a.key === '' || a.key === '*') - Number(b.key === '' || b.key === '*') || b.value - a.value || a.key.localeCompare(b.key, 'cs'));
  const all = moneyTotals(lines);
  const cols: MoneyPart[] = ['overMax', 'surplus', 'none', 'blocked'];
  const barParts: MoneyPart[] = ['needed', 'overMax', 'surplus', 'none', 'blocked'];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tp.heading}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{tp.empty}</p>
      ) : (
        <div className="table-scroll">
          <table className="table table-data inv-projects">
            <thead>
              <tr>
                <th>{tp.project}</th>
                <th className="n">{tp.value}</th>
                {cols.map((c) => (
                  <th key={c} className="n">
                    {tp.cols[c as keyof typeof tp.cols]}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className={r.key === '' || r.key === '*' ? 'muted' : undefined}>{r.key === '' ? tp.noProject : r.key === '*' ? tp.shared : <strong>{r.key}</strong>}</td>
                  <td className="n">{m(r.value)}</td>
                  {cols.map((c) => (
                    <td key={c} className="n">
                      {m(r.totals[c])}
                    </td>
                  ))}
                  <td>
                    <div className="inv-mini" aria-hidden="true">
                      {barParts.map((k) => (r.totals[k] > 0 ? <span key={k} className={`inv-part-${k}`} style={{ flex: r.totals[k] }} /> : null))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{tp.total}</td>
                <td className="n">{m(sum(lines, (l) => l.value))}</td>
                {cols.map((c) => (
                  <td key={c} className="n">
                    {m(all[c])}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

interface RankRow {
  item: string;
  sub: string;
  amount: number;
  note: string;
}

/** Žebříčky: největší položky nad potřebou, bez potřeby a blokované; zbytek v jednom řádku. */
function Rankings({ lines }: { lines: InventoryLine[] }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const tt = ti.top;
  const sub = (l: InventoryLine) => [l.description, l.projects.join(', ')].filter(Boolean).join(' · ');
  const over: RankRow[] = lines
    .filter((l) => l.kind !== 'other' && l.band !== 'none')
    .map((l) => {
      const p = moneyParts(l);
      return { item: l.item, sub: sub(l), amount: p.overMax + p.surplus, note: l.days === null ? tt.beyond : tt.days.replace('{n}', formatQuantity(l.days, locale)) };
    });
  const none: RankRow[] = lines.filter((l) => l.band === 'none').map((l) => ({ item: l.item, sub: sub(l), amount: l.value, note: l.noNeed ? ti.noNeed[l.noNeed] : '' }));
  const blocked: RankRow[] = lines.map((l) => {
    const locs = l.locations.filter((loc) => loc.blocked);
    return {
      item: l.item,
      sub: [l.description, ...new Set(locs.map((loc) => loc.status))].filter(Boolean).join(' · '),
      amount: l.blockedValue,
      note: [...new Set(locs.map((loc) => ti.reasons[loc.blocked!]))].join(', '),
    };
  });
  return (
    <div className="inv-top">
      <RankList title={tt.over} rows={over} />
      <RankList title={tt.none} rows={none} />
      <RankList title={tt.blocked} rows={blocked} />
    </div>
  );
}

function RankList({ title, rows }: { title: string; rows: RankRow[] }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const shown = rows.filter((r) => r.amount >= 0.5).sort((a, b) => b.amount - a.amount || a.item.localeCompare(b.item));
  const rest = shown.slice(TOP_ROWS);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      {shown.length === 0 ? (
        <p className="muted">{ti.top.empty}</p>
      ) : (
        <table className="table inv-rank">
          <tbody>
            {shown.slice(0, TOP_ROWS).map((r) => (
              <tr key={r.item}>
                <td>
                  <strong>{r.item}</strong>
                  {r.sub && <small className="cell-note muted">{r.sub}</small>}
                </td>
                <td className="n">
                  {money(r.amount, locale)}
                  {r.note && <small className="cell-note muted">{r.note}</small>}
                </td>
              </tr>
            ))}
            {rest.length > 0 && (
              <tr>
                <td className="muted">{plural(rest.length, locale, ti.top.rest).replace('{n}', partsCount(rest.length, locale, ti.parts))}</td>
                <td className="n muted">{money(rest.reduce((s, r) => s + r.amount, 0), locale)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function exportParts(lines: InventoryLine[], ti: ReturnType<typeof useI18n>['t']['inventory'], today: DayNumber) {
  const tt = ti.table;
  const header = [tt.item, tt.description, tt.kind, ti.filters.project, ti.filters.category, tt.abc, tt.free, tt.external, tt.blocked, tt.min, tt.max, tt.days, tt.toMin, tt.overMax, tt.surplus, tt.value, tt.band];
  const rows = [...lines]
    .sort((a, b) => b.value + b.blockedValue - (a.value + a.blockedValue) || a.item.localeCompare(b.item))
    .map((l) => [
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
      l.surplus,
      Math.round(l.value),
      ti.bands[l.band] + (l.noNeed ? ` – ${ti.noNeed[l.noNeed]}` : ''),
    ]);
  return downloadXlsx(`${ti.export.fileName}_${dayToIso(today)}.xlsx`, ti.export.sheet, header, rows);
}
