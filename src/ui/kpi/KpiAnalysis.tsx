import { useState } from 'react';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort } from '../../core/format';
import { entryOf, kpiStatus, kpiValue, LETTERS, type KpiData, type KpiDef, type KpiDetail, type KpiSource, type Letter } from '../../core/kpi';
import { detailGroups, GROUP_DIMS, letterSummary, nokPoints, offKpis, type DetailGroup, type GroupDim, type KpiOff, type NokPoint } from '../../core/kpiAnalysis';
import { ownerNames, parseKpiSource, statusOf, type OilItem } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsx } from '../../platform/download';
import { openOilItem } from './KpiActions';
import { formatValue } from './KpiCharts';

type Period = 'week' | 'month' | 'custom';

/** Kolik skupin ukazatele a kolik položek skupiny se ukáže hned (ostatní po kliknutí na „další“). */
const GROUP_ROWS = 5;
const ITEM_ROWS = 5;
/** Od kolika dní je opakování „horké“ (červený štítek). */
const HOT_DAYS = 3;

/** Otevřené body OIL, které se týkají hodnoty: odpovědný (osoba), jinak hodnota v textu problému nebo opatření. */
function oilFor(items: readonly OilItem[], dim: GroupDim, value: string, today: DayNumber): OilItem[] {
  const v = value.toLowerCase();
  if (!v) return [];
  return items.filter((i) => {
    if (['done', 'cancelled'].includes(statusOf(i, today))) return false;
    if (dim === 'person') return ownerNames(i.owner).some((o) => o.toLowerCase() === v);
    return v.length >= 3 && `${i.problem} ${i.action}`.toLowerCase().includes(v);
  });
}

/** Otevřené body OIL založené k ukazateli (zdroj KPI). */
const oilForKpi = (items: readonly OilItem[], kpiId: string, today: DayNumber) =>
  items.filter((i) => parseKpiSource(i.kpi)?.kpiId === kpiId && !['done', 'cancelled'].includes(statusOf(i, today)));

/** Český tvar podle počtu: 1 den, 2–4 dny, 5 dní. */
const plural = (n: number, forms: readonly string[]) => `${n} ${forms[n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2]}`;

const toggled = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

/** Rozbor podle ukazatelů: písmena, ukazatele mimo cíl (od nejhoršího) → skupiny (projekt, dodavatel …) → díly. */
export function KpiAnalysis({
  kpi,
  oilItems,
  today,
  supplierOf,
  onOpenDay,
  onAddOil,
}: {
  kpi: KpiData;
  oilItems: readonly OilItem[];
  today: DayNumber;
  /** Dodavatel dílu z mapování (prázdný = neuvedeno). */
  supplierOf: (item: string) => string;
  onOpenDay: (day: DayNumber) => void;
  onAddOil: (init: { letter: Letter; problem: string; kpi: { day: DayNumber; kpiId: string } }) => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.kpi.analysis;
  const [period, setPeriod] = useState<Period>('week');
  const [fromText, setFromText] = useState(dayToIso(today - 6));
  const [toText, setToText] = useState(dayToIso(today));
  const [letter, setLetter] = useState<Letter | ''>('');
  // Rozbalené ukazatele (první je rozbalený, dokud uživatel nic nezmění), seskupení, rozbalené skupiny a „další“.
  const [openKpis, setOpenKpis] = useState<ReadonlySet<string> | null>(null);
  const [dims, setDims] = useState<Record<string, GroupDim>>({});
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [more, setMore] = useState<ReadonlySet<string>>(new Set());

  const monthStart = today - Number(dayToIso(today).slice(8)) + 1;
  const from = period === 'week' ? today - 6 : period === 'month' ? monthStart : (parseDay(fromText) ?? today - 6);
  const to = period === 'custom' ? (parseDay(toText) ?? today) : today;
  const periodDays = Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);
  const workdays = periodDays.filter((d) => weekday(d) <= 5).length;
  const points = nokPoints(kpi, from, to, { letter, kpiId: '' });
  const off = offKpis(points);
  const open = openKpis ?? new Set(off.slice(0, 1).map((k) => k.def.id));

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const dimOf = (def: KpiDef) => dims[def.id] ?? GROUP_DIMS[def.source][0]!;
  const dimLabel = (source: KpiSource, dim: GroupDim) => (dim === 'cause' ? ta.causeBySource[source] : ta.dims[dim]);
  const groupLabel = (dim: GroupDim, g: DetailGroup) => g.value || (g.items.length ? ta.none[dim] : ta.noDetail);
  const qtyText = (q: number | null) => (q === null ? '' : `${ta.max} ${formatValue(q, locale)}`);
  const daysText = (days: readonly DayNumber[]) => days.map(dayLabel).join(', ');

  /** Stav ukazatele po dnech období: mimo cíl, v cíli, víkend, nezapsaný den, budoucnost. */
  const kpiDay = (k: KpiOff, day: DayNumber) => {
    const status = k.days.get(day);
    if (status) return status;
    const value = kpiValue(entryOf(kpi, day), k.def);
    if (value !== null) return kpiStatus(k.def, value);
    return day > today ? 'future' : weekday(day) > 5 ? 'weekend' : 'missing';
  };
  const strip = (cells: { day: DayNumber; state: string }[], openable: boolean) => (
    <span className="kpi-mini">
      {cells.map(({ day, state }) =>
        openable ? (
          <button key={day} type="button" className={`kpi-mini-day kpi-strip-${state}`} title={dayLabel(day)} aria-label={dayLabel(day)} onClick={() => onOpenDay(day)} />
        ) : (
          <i key={day} className={`kpi-strip-${state}`} title={dayLabel(day)} />
        ),
      )}
    </span>
  );
  const groupStrip = (g: DetailGroup) => strip(periodDays.map((day) => ({ day, state: g.days.get(day) ?? 'none' })), false);
  const daysBadge = (n: number) => <span className={`kpi-days-badge${n >= HOT_DAYS ? ' kpi-days-hot' : n === 1 ? ' kpi-days-once' : ''}`}>{plural(n, ta.dayForms)}</span>;
  const oilLinks = (items: OilItem[]) =>
    items.map((i) => (
      <button key={i.id} type="button" className="link-button kpi-oil-link" onClick={() => openOilItem(i.id)}>
        {ta.oilItem.replace('{id}', String(i.id))}
      </button>
    ));
  const addOilButton = (onClick: () => void) => (
    <button type="button" className="button button-small" onClick={onClick}>
      + OIL
    </button>
  );
  const lastDay = (days: Iterable<DayNumber>) => Math.max(...days);

  const rows = points.flatMap((p): { p: NokPoint; d: KpiDetail | null }[] => (p.details.length ? p.details.map((d) => ({ p, d })) : [{ p, d: null }]));
  const exportRows = () =>
    downloadXlsx(
      `${ta.fileName}_${dayToIso(from)}_${dayToIso(to)}.xlsx`,
      ta.sheet,
      [ta.day, ta.letter, ta.kpi, ta.value, ta.dims.project, ta.dims.item, ta.dims.supplier, ta.dims.person, ta.qty, ta.dims.cause, ta.source],
      rows.map(({ p, d }) => [
        dayToIso(p.day),
        p.def.letter,
        p.def.name,
        p.value,
        d?.project ?? '',
        d?.item ?? '',
        d?.item ? supplierOf(d.item) : '',
        d?.person ?? '',
        d?.qty ?? null,
        d?.cause ?? '',
        d ? ta.sources[d.source] : '',
      ]),
    );

  const renderKpi = (k: KpiOff) => {
    const { def } = k;
    const isOpen = open.has(def.id);
    const dim = dimOf(def);
    const groups = detailGroups(k.points, dim, supplierOf);
    const top = groups.find((g) => g.value);
    const reds = [...k.days.values()].some((s) => s === 'red');
    const kpiOil = oilForKpi(oilItems, def.id, today);
    const addKpiOil = () => {
      const days = [...k.days.keys()].sort((a, b) => a - b);
      const problem = `${def.name}: ${ta.offText.replace('{n}', String(days.length)).replace('{workdays}', plural(workdays, ta.workdayForms)).replace('{days}', daysText(days))}${top ? `; ${ta.mostly} ${top.value}` : ''}`;
      onAddOil({ letter: def.letter, problem, kpi: { day: lastDay(days), kpiId: def.id } });
    };
    const shownGroups = more.has(def.id) ? groups : groups.slice(0, GROUP_ROWS);
    return (
      <section key={def.id} className={`kpi-off${reds ? '' : ' kpi-off-yellow'}`} aria-label={def.name}>
        <div className="kpi-off-head">
          <button type="button" className="kpi-off-toggle" aria-expanded={isOpen} onClick={() => setOpenKpis(toggled(open, def.id))}>
            <span className="kpi-chev" aria-hidden="true">
              {isOpen ? '▾' : '▸'}
            </span>
            <span className={`kpi-off-letter kpi-text-${reds ? 'red' : 'yellow'}`}>{def.letter}</span>
            <span className="kpi-off-name">
              {def.name}
              <small>{t.kpi.sources[def.source]}</small>
            </span>
          </button>
          {strip(periodDays.map((day) => ({ day, state: kpiDay(k, day) })), true)}
          <span className="kpi-off-count">
            <b>{k.days.size}</b> {ta.offOf.replace('{n}', plural(workdays, ta.workdayForms))}
          </span>
          <span className="kpi-off-top">
            {top && (
              <>
                {ta.mostly}: <b>{top.value}</b> · {plural(top.days.size, ta.dayForms)}
              </>
            )}
          </span>
          <span className="kpi-off-oil">{kpiOil.length ? oilLinks(kpiOil) : addOilButton(addKpiOil)}</span>
        </div>
        {isOpen && (
          <div className="kpi-off-body">
            {GROUP_DIMS[def.source].length > 1 && (
              <div className="kpi-group-by">
                <span className="muted">{ta.groupBy}</span>
                <span className="segmented" role="group" aria-label={`${def.name}: ${ta.groupBy}`}>
                  {GROUP_DIMS[def.source].map((d) => (
                    <button key={d} type="button" aria-pressed={dim === d} onClick={() => setDims({ ...dims, [def.id]: d })}>
                      {dimLabel(def.source, d)}
                    </button>
                  ))}
                </span>
              </div>
            )}
            {shownGroups.map((g) => {
              const key = `${def.id}|${dim}|${g.value}`;
              const groupOpen = openGroups.has(key);
              const days = [...g.days.keys()].sort((a, b) => a - b);
              const oil = oilFor(oilItems, dim, g.value, today);
              const items = more.has(key) ? g.items : g.items.slice(0, ITEM_ROWS);
              const addGroupOil = () => {
                const parts = g.items.slice(0, ITEM_ROWS).map((i) => i.label);
                const problem = `${def.name} – ${dimLabel(def.source, dim)} ${groupLabel(dim, g)}: ${days.length}× (${daysText(days)})${parts.length ? `; ${parts.join(', ')}` : ''}`;
                onAddOil({ letter: def.letter, problem, kpi: { day: lastDay(days), kpiId: def.id } });
              };
              return (
                <div key={key} className="kpi-group">
                  <button type="button" className="kpi-group-toggle" aria-expanded={groupOpen} disabled={!g.items.length} onClick={() => setOpenGroups(toggled(openGroups, key))}>
                    <span className="kpi-chev" aria-hidden="true">
                      {g.items.length ? (groupOpen ? '▾' : '▸') : ''}
                    </span>
                    <span className={g.value ? 'kpi-group-name' : 'kpi-group-name muted'}>{groupLabel(dim, g)}</span>
                    {g.items.length > 0 && <small className="muted">{plural(g.items.length, def.source === 'oilOverdue' ? ta.pointForms : ta.partForms)}</small>}
                  </button>
                  {groupStrip(g)}
                  {daysBadge(g.days.size)}
                  <span className="n muted">{qtyText(g.maxQty)}</span>
                  <span className="kpi-group-oil">{oil.length ? oilLinks(oil) : g.value ? addOilButton(addGroupOil) : null}</span>
                  {groupOpen && (
                    <div className="kpi-group-items">
                      {items.map((i) => (
                        <div key={i.label} className="kpi-group-item">
                          <span>
                            <b>{i.label}</b>
                            {i.note && <span className="muted"> · {i.note}</span>}
                          </span>
                          <span className="muted" title={daysText(i.days)}>
                            {plural(i.days.length, ta.dayForms)}
                          </span>
                          <span className="n">{i.maxQty === null ? '' : formatValue(i.maxQty, locale)}</span>
                        </div>
                      ))}
                      {g.items.length > ITEM_ROWS && (
                        <button type="button" className="link-button" onClick={() => setMore(toggled(more, key))}>
                          {more.has(key) ? ta.less : ta.moreItems.replace('{n}', String(g.items.length - ITEM_ROWS))}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {groups.length > GROUP_ROWS && (
              <button type="button" className="link-button" onClick={() => setMore(toggled(more, def.id))}>
                {more.has(def.id) ? ta.less : ta.moreGroups.replace('{n}', String(groups.length - GROUP_ROWS))}
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="filters" role="group" aria-label={ta.filters}>
        <span className="segmented" role="group" aria-label={ta.period}>
          {(['week', 'month', 'custom'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {ta.periods[p]}
            </button>
          ))}
        </span>
        {period === 'custom' && (
          <>
            <label className="inline-field">
              <span>{ta.from}</span>
              <input type="date" value={fromText} max={toText} onChange={(e) => setFromText(e.target.value)} />
            </label>
            <label className="inline-field">
              <span>{ta.to}</span>
              <input type="date" value={toText} min={fromText} onChange={(e) => setToText(e.target.value)} />
            </label>
          </>
        )}
        <span className="muted">
          {formatDayShort(dayToIso(from), locale)} – {formatDayShort(dayToIso(to), locale)} · {plural(workdays, ta.workdayForms)}
        </span>
        {letter && (
          <button type="button" className="chip kpi-letter-chip" onClick={() => setLetter('')}>
            {ta.letterChip.replace('{letter}', letter)} ✕
          </button>
        )}
        <span className="panel-actions">
          <button type="button" className="button button-small" disabled={!rows.length} onClick={() => void exportRows()}>
            {ta.export}
          </button>
        </span>
      </div>

      <section className="kpi-an-section" aria-labelledby="kpi-an-letters">
        <h2 id="kpi-an-letters" className="kpi-an-title">
          {ta.lettersHeading}
        </h2>
        <div className="kpi-an-letters">
          {LETTERS.map((l) => {
            const summary = letterSummary(kpi, l, from, to);
            const tone = summary.red ? 'red' : summary.off ? 'yellow' : kpi.entries.some((e) => e.day >= from && e.day <= to) ? 'green' : 'none';
            return (
              <button
                key={l}
                type="button"
                className={`kpi-an-letter${letter === l ? ' kpi-an-letter-on' : ''}`}
                aria-pressed={letter === l}
                onClick={() => setLetter(letter === l ? '' : l)}
              >
                <span className={`kpi-an-letter-mark kpi-text-${tone}`}>{l}</span>
                <span className="kpi-an-letter-name">{t.kpi.letters[l]}</span>
                <span className="kpi-an-letter-value">
                  <b>{summary.off}</b> / {plural(summary.workdays, ta.dayForms)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="kpi-an-section" aria-labelledby="kpi-an-kpis">
        <h2 id="kpi-an-kpis" className="kpi-an-title">
          {ta.kpisHeading}
        </h2>
        {off.length === 0 ? <p className="panel muted">{ta.noPoints}</p> : off.map(renderKpi)}
      </section>
    </>
  );
}
