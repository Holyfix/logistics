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
  REACH_SLICES,
  type InventoryLine,
  type Kind,
  type MoneyPart,
  type ReachSlice,
  type Scope,
} from '../../core/inventory';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsx } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';

/** Kolik největších položek ukazují žebříčky; zbytek se sečte do jednoho řádku. */
const TOP_ROWS = 5;

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

/** Dosah v pracovních dnech; zásoba na celý horizont odvolávek jako „150+“ (víc dní odvolávky neukazují). */
function reachDays(days: number | null, horizonWorkdays: number, locale: Locale): string {
  return days === null ? `${formatQuantity(horizonWorkdays, locale)}+` : formatQuantity(days, locale);
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
        <ReachPanel lines={lines} today={today} horizonWorkdays={table.horizonWorkdays} />
        <ProjectsPanel lines={lines} />
      </div>

      <Rankings lines={lines} horizonWorkdays={table.horizonWorkdays} />

      <div className="panel inv-export">
        <span className="muted">{ti.export.note}</span>
        <button type="button" className="button" onClick={() => void exportParts(lines, ti, today, table.horizonWorkdays)}>
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

/** Kolik dílů ukazuje detail pásma; zbytek se sečte do jednoho řádku (celý seznam v Excelu). */
const DETAIL_ROWS = 10;

/** Popisek procent v úseku pruhu jen u úseků aspoň takového podílu druhu. */
const PERCENT_SHARE = 0.06;

/**
 * Hodnota volné zásoby podle doby spotřeby (ReachSlice): díl se rozdělí do pásem podle toho, kdy se jeho zásoba
 * spotřebuje, ne celou hodnotou do jednoho pásma. FG, SFG a PG každý na celou šířku (úseky = podíl v rámci druhu), pod
 * pruhem částky všech pásem. Klik na pásmo (nebo na „mimo mapování“) ukáže pod grafem největší díly a Excel s díly.
 */
function ReachPanel({ lines, today, horizonWorkdays }: { lines: InventoryLine[]; today: DayNumber; horizonWorkdays: number }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const tr = ti.reach;
  const [selected, setSelected] = useState<{ kind: Kind; band: ReachSlice | null } | null>(null);
  const kinds = (['FG', 'SFG', 'PG'] as const).map((k) => {
    const of = lines.filter((l) => l.kind === k);
    return { kind: k, bands: REACH_SLICES.map((b) => sum(of, (l) => l.reach[b])), total: sum(of, (l) => l.value) };
  });
  const others = lines.filter((l) => l.kind === 'other');
  const isSelected = (kind: Kind, band: ReachSlice | null) => selected?.kind === kind && selected.band === band;
  const toggle = (kind: Kind, band: ReachSlice | null) => setSelected(isSelected(kind, band) ? null : { kind, band });
  const label = (kind: Kind, band: ReachSlice) => `${ti.kinds[kind]} · ${tr.slices[band]}`;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tr.heading}</h2>
      </div>
      <p className="muted">{tr.note}</p>
      {kinds.map(({ kind, bands, total }) => (
        <div key={kind} className="inv-reach-row">
          <b>{ti.kinds[kind]}</b>
          <div className="inv-reach-bars">
            <div className="inv-stack">
              {REACH_SLICES.map((b, i) =>
                bands[i]! > 0.5 ? (
                  <button
                    key={b}
                    type="button"
                    className={`inv-band-${b}`}
                    style={{ flex: bands[i] }}
                    aria-pressed={isSelected(kind, b)}
                    title={`${label(kind, b)}: ${money(bands[i]!, locale)} · ${tr.hints[b]}`}
                    onClick={() => toggle(kind, b)}
                  >
                    {bands[i]! / total >= PERCENT_SHARE ? `${Math.round((bands[i]! / total) * 100)} %` : ''}
                  </button>
                ) : null,
              )}
            </div>
            <ul className="inv-reach-values">
              {REACH_SLICES.map((b, i) =>
                bands[i]! > 0.5 ? (
                  <li key={b}>
                    <button type="button" className="link-button" aria-pressed={isSelected(kind, b)} aria-label={`${label(kind, b)} ${money(bands[i]!, locale)}`} onClick={() => toggle(kind, b)}>
                      <i className={`inv-band-${b}`} /> {moneyShort(bands[i]!, locale)}
                    </button>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
          <span className="muted">{money(total, locale)}</span>
        </div>
      ))}
      {others.length > 0 && (
        <p className="inv-reach-other">
          {tr.other}:{' '}
          <button type="button" className="link-button" aria-pressed={isSelected('other', null)} onClick={() => toggle('other', null)}>
            {money(sum(others, (l) => l.value), locale)} · {partsCount(others.length, locale, ti.parts)}
          </button>
        </p>
      )}
      <ul className="inv-legend">
        {REACH_SLICES.map((b) => (
          <li key={b} title={tr.hints[b]}>
            <i className={`inv-band-${b}`} /> {tr.slices[b]}
          </li>
        ))}
      </ul>
      {selected && <ReachDetail lines={lines} kind={selected.kind} band={selected.band} today={today} horizonWorkdays={horizonWorkdays} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Detail pásma: největší díly podle hodnoty, zbytek v jednom řádku, Excel s díly pásma. */
function ReachDetail({
  lines,
  kind,
  band,
  today,
  horizonWorkdays,
  onClose,
}: {
  lines: InventoryLine[];
  kind: Kind;
  band: ReachSlice | null;
  today: DayNumber;
  horizonWorkdays: number;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const td = ti.reach.detail;
  // Hodnota dílu v pásmu (část podle doby spotřeby); mimo mapování celá hodnota.
  const inBand = (l: InventoryLine) => (band === null ? l.value : l.reach[band]);
  const of = lines.filter((l) => l.kind === kind && inBand(l) >= 0.5).sort((a, b) => inBand(b) - inBand(a) || a.item.localeCompare(b.item));
  if (of.length === 0) return null;
  const title = band === null ? ti.reach.other : `${ti.kinds[kind]} · ${ti.reach.slices[band]}`;
  const reach = (l: InventoryLine) => (l.kind === 'other' ? '—' : l.noNeed ? ti.noNeed[l.noNeed] : td.daysUnit.replace('{n}', reachDays(l.days, horizonWorkdays, locale)));
  const rest = of.slice(DETAIL_ROWS);
  const m = (v: number) => (Math.abs(v) < 0.5 ? '–' : money(v, locale));
  return (
    <div className="inv-reach-detail" role="region" aria-label={title}>
      <div className="inv-reach-detail-head">
        <h3>
          {title} · {money(sum(of, inBand), locale)} · {partsCount(of.length, locale, ti.parts)}
        </h3>
        <button type="button" className="link-button" onClick={() => void exportParts(of, ti, today, horizonWorkdays, `${kind}_${band ?? 'mimo'}`)}>
          {td.excel}
        </button>
        <button type="button" className="link-button" aria-label={td.close} title={td.close} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="table-scroll">
        <table className="table table-data">
          <thead>
            <tr>
              <th>{ti.table.item}</th>
              <th>{ti.table.description}</th>
              <th>{ti.filters.project}</th>
              <th className="n">{td.reach}</th>
              <th className="n">{td.inBand}</th>
              <th className="n">{td.value}</th>
            </tr>
          </thead>
          <tbody>
            {of.slice(0, DETAIL_ROWS).map((l) => (
              <tr key={l.item}>
                <td>
                  <strong>{l.item}</strong>
                </td>
                <td className="desc">{l.description}</td>
                <td>{l.projects.length > 1 ? ti.projects.shared : l.projects[0] ?? '–'}</td>
                <td className="n">{reach(l)}</td>
                <td className="n">{m(inBand(l))}</td>
                <td className="n">{money(l.value, locale)}</td>
              </tr>
            ))}
            {rest.length > 0 && (
              <tr>
                <td className="muted" colSpan={4}>
                  {plural(rest.length, locale, ti.top.rest).replace('{n}', partsCount(rest.length, locale, ti.parts))}
                </td>
                <td className="n muted">{m(sum(rest, inBand))}</td>
                <td className="n muted">{money(sum(rest, (l) => l.value), locale)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
function Rankings({ lines, horizonWorkdays }: { lines: InventoryLine[]; horizonWorkdays: number }) {
  const { t, locale } = useI18n();
  const ti = t.inventory;
  const tt = ti.top;
  const sub = (l: InventoryLine) => [l.description, l.projects.join(', ')].filter(Boolean).join(' · ');
  const over: RankRow[] = lines
    .filter((l) => l.kind !== 'other' && l.band !== 'none')
    .map((l) => {
      const p = moneyParts(l);
      return { item: l.item, sub: sub(l), amount: p.overMax + p.surplus, note: tt.days.replace('{n}', reachDays(l.days, horizonWorkdays, locale)) };
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

function exportParts(lines: InventoryLine[], ti: ReturnType<typeof useI18n>['t']['inventory'], today: DayNumber, horizonWorkdays: number, suffix = '') {
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
      l.days ?? (l.horizonDemand > 0 && l.kind !== 'other' ? `${horizonWorkdays}+` : null),
      l.toMin,
      l.overMax,
      l.surplus,
      Math.round(l.value),
      ti.bands[l.band] + (l.noNeed ? ` – ${ti.noNeed[l.noNeed]}` : ''),
    ]);
  return downloadXlsx(`${ti.export.fileName}${suffix ? `_${suffix}` : ''}_${dayToIso(today)}.xlsx`, ti.export.sheet, header, rows);
}
