import { useState } from 'react';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, type Locale } from '../../core/format';
import { LETTERS, type KpiData, type KpiDetail, type Letter } from '../../core/kpi';
import { DIMENSIONS, letterDays, letterSummary, nokGroups, nokPoints, type DayState, type Dimension, type NokGroup, type NokPoint } from '../../core/kpiAnalysis';
import { ownerNames, statusOf, type OilItem } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';

import { downloadXlsx } from '../../platform/download';
import { formatValue } from './KpiCharts';

type Period = 'week' | 'month' | 'custom';

/** Kolik karet „Co se opakuje“ a kolik pruhů v „Nejčastější“. */
const REPEAT_CARDS = 6;
const BAR_ROWS = 8;
/** Kolik nejnovějších dní je v seznamu bodů rozbalených. */
const OPEN_DAYS = 2;
/** Od kolika dní je opakování „horké“ (červená karta). */
const HOT_DAYS = 3;

/** Otevřené body OIL, které se týkají hodnoty: odpovědný (osoba), jinak hodnota v textu problému nebo opatření. */
function oilFor(items: readonly OilItem[], dim: Dimension, value: string, today: DayNumber): OilItem[] {
  const v = value.toLowerCase();
  return items.filter((i) => {
    if (['done', 'cancelled'].includes(statusOf(i, today))) return false;
    if (dim === 'person') return ownerNames(i.owner).some((o) => o.toLowerCase() === v);
    return v.length >= 3 && `${i.problem} ${i.action}`.toLowerCase().includes(v);
  });
}

/** Český tvar podle počtu: 1 den, 2–4 dny, 5 dní. */
const plural = (n: number, forms: readonly string[]) => `${n} ${forms[n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2]}`;

/** Detail bodu jedním řádkem: projekt, díl, osoba, množství, příčina (první údaj tučně). */
function DetailText({ d, locale }: { d: KpiDetail; locale: Locale }) {
  const parts = [d.project, d.item, d.person, d.qty === null ? '' : formatValue(d.qty, locale), d.cause].filter(Boolean);
  return (
    <span className="kpi-pt-detail">
      <b>{parts[0]}</b>
      {parts.length > 1 && ` · ${parts.slice(1).join(' · ')}`}
    </span>
  );
}

/** Rozbor: jak dopadla písmena, co se opakuje, nejčastější hodnoty a body mimo cíl po dnech. */
export function KpiAnalysis({
  kpi,
  oilItems,
  today,
  onOpenDay,
  onAddOil,
}: {
  kpi: KpiData;
  oilItems: readonly OilItem[];
  today: DayNumber;
  onOpenDay: (day: DayNumber) => void;
  onAddOil: (init: { letter: Letter; problem: string; kpi: { day: DayNumber; kpiId: string } }) => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.kpi.analysis;
  const [period, setPeriod] = useState<Period>('week');
  const [fromText, setFromText] = useState(dayToIso(today - 6));
  const [toText, setToText] = useState(dayToIso(today));
  const [letter, setLetter] = useState<Letter | ''>('');
  const [kpiId, setKpiId] = useState('');
  const [dim, setDim] = useState<Dimension>('project');
  // Dny, které uživatel rozbalil / sbalil (proti výchozímu stavu: rozbalené nejnovější dny).
  const [toggled, setToggled] = useState<ReadonlySet<DayNumber>>(new Set());

  const monthStart = today - Number(dayToIso(today).slice(8)) + 1;
  const from = period === 'week' ? today - 6 : period === 'month' ? monthStart : (parseDay(fromText) ?? today - 6);
  const to = period === 'custom' ? (parseDay(toText) ?? today) : today;
  const points = nokPoints(kpi, from, to, { letter, kpiId });
  const groups = Object.fromEntries(DIMENSIONS.map((d) => [d, nokGroups(points, d)])) as Record<Dimension, NokGroup[]>;
  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const oilText = (items: OilItem[]) => items.map((i) => ta.oilItem.replace('{id}', String(i.id))).join(', ');
  const defsShown = kpi.defs.filter((d) => !letter || d.letter === letter);
  const periodDays = Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);
  const workdays = periodDays.filter((d) => weekday(d) <= 5).length;

  // Co se opakuje: hodnoty, které se objevily aspoň ve dvou dnech.
  const repeats = DIMENSIONS.flatMap((d) =>
    groups[d].filter((g) => g.days.length >= 2).map((g) => ({ dim: d, g, oil: oilFor(oilItems, d, g.value, today) })),
  ).sort((a, b) => b.g.days.length - a.g.days.length || b.g.points - a.g.points);
  const addOil = (d: Dimension, g: NokGroup) => {
    const last = points.find((p) => g.dayStatus.has(p.day) && g.kpis.some((k) => k.id === p.def.id))!;
    const problem = `${ta.dims[d]} ${g.value}: ${ta.repeat.replace('{n}', String(g.days.length)).replace('{days}', g.days.map(dayLabel).join(', ')).replace('{kpis}', g.kpis.map((k) => k.name).join(', '))}`;
    onAddOil({ letter: last.def.letter, problem, kpi: { day: last.day, kpiId: last.def.id } });
  };

  const bars = groups[dim].slice(0, BAR_ROWS);
  const barScale = Math.max(workdays, ...bars.map((g) => g.days.length), 1);

  const byDay = new Map<DayNumber, NokPoint[]>();
  for (const p of points) (byDay.get(p.day) ?? byDay.set(p.day, []).get(p.day)!).push(p);
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const isOpen = (d: DayNumber, k: number) => (k < OPEN_DAYS) !== toggled.has(d);
  const toggle = (d: DayNumber) =>
    setToggled((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const rows = points.flatMap((p): { p: NokPoint; d: KpiDetail | null }[] => (p.details.length ? p.details.map((d) => ({ p, d })) : [{ p, d: null }]));
  const valueText = (value: number, unit: string) => `${formatValue(value, locale)}${unit ? ` ${unit}` : ''}`;
  const exportRows = () =>
    downloadXlsx(
      `${ta.fileName}_${dayToIso(from)}_${dayToIso(to)}.xlsx`,
      ta.sheet,
      [ta.day, ta.letter, ta.kpi, ta.value, ta.dims.project, ta.dims.item, ta.dims.person, ta.qty, ta.dims.cause, ta.source],
      rows.map(({ p, d }) => [dayToIso(p.day), p.def.letter, p.def.name, p.value, d?.project ?? '', d?.item ?? '', d?.person ?? '', d?.qty ?? null, d?.cause ?? '', d ? ta.sources[d.source] : '']),
    );
  const stateClass = (s: DayState) => `kpi-strip-${s}`;
  const shortLabels = periodDays.length <= 14;

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
        <label className="inline-field">
          <span>{ta.kpi}</span>
          <select value={kpiId} onChange={(e) => setKpiId(e.target.value)}>
            <option value="">{ta.all}</option>
            {defsShown.map((d) => (
              <option key={d.id} value={d.id}>
                {d.letter} · {d.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {formatDayShort(dayToIso(from), locale)} – {formatDayShort(dayToIso(to), locale)} · {plural(workdays, ta.workdayForms)}
        </span>
        {letter ? (
          <button
            type="button"
            className="chip kpi-letter-chip"
            onClick={() => {
              setLetter('');
              setKpiId('');
            }}
          >
            {ta.letterChip.replace('{letter}', letter)} ✕
          </button>
        ) : (
          <span className="muted kpi-filter-hint">{ta.letterHint}</span>
        )}
      </div>

      <section className="kpi-an-section" aria-labelledby="kpi-an-letters">
        <h2 id="kpi-an-letters" className="kpi-an-title">
          {ta.lettersHeading}
        </h2>
        <div className="kpi-an-letters">
          {LETTERS.map((l) => {
            const strip = letterDays(kpi, l, from, to, today);
            const summary = letterSummary(kpi, l, from, to);
            const worst = strip.some((d) => d.state === 'red') ? 'red' : strip.some((d) => d.state === 'yellow') ? 'yellow' : strip.some((d) => d.state === 'green') ? 'green' : 'none';
            return (
              <button
                key={l}
                type="button"
                className={`kpi-an-letter${letter === l ? ' kpi-an-letter-on' : ''}`}
                aria-pressed={letter === l}
                onClick={() => {
                  setLetter(letter === l ? '' : l);
                  setKpiId('');
                }}
              >
                <span className="kpi-an-letter-head">
                  <span className={`kpi-an-letter-mark kpi-text-${worst}`}>{l}</span>
                  <span className="kpi-an-letter-name">{t.kpi.letters[l]}</span>
                  <span className="kpi-an-letter-value">
                    <b>{summary.off}</b> {ta.offOf.replace('{n}', plural(summary.workdays, ta.workdayForms))}
                  </span>
                </span>
                <span className="kpi-strip" aria-hidden="true">
                  {strip.map((d) => (
                    <i key={d.day} className={stateClass(d.state)} title={dayLabel(d.day)} />
                  ))}
                </span>
                {shortLabels && (
                  <span className="kpi-strip-days" aria-hidden="true">
                    {strip.map((d) => (
                      <span key={d.day}>{t.calloffs.weekdays[weekday(d.day) - 1]}</span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="kpi-an-section" aria-labelledby="kpi-an-repeats">
        <h2 id="kpi-an-repeats" className="kpi-an-title">
          {ta.repeatsHeading}
        </h2>
        {repeats.length === 0 ? (
          <p className="panel muted">{points.length ? ta.noRepeats : ta.noPoints}</p>
        ) : (
          <div className="kpi-repeat-cards">
            {repeats.slice(0, REPEAT_CARDS).map(({ dim: d, g, oil }) => (
              <article key={`${d}|${g.value}`} className={`kpi-repeat-card${g.days.length >= HOT_DAYS ? ' kpi-repeat-hot' : ''}`}>
                <div className="kpi-repeat-top">
                  <span className="chip">{ta.dims[d]}</span>
                  <strong className="kpi-repeat-value">{g.value}</strong>
                  <span className="kpi-repeat-badge">{plural(g.days.length, ta.dayForms)}</span>
                </div>
                <div className="muted">
                  {plural(g.points, ta.pointForms)} · {g.kpis.map((k) => k.name).join(', ')}
                </div>
                <div className="kpi-repeat-foot">
                  <span className="kpi-mini" title={g.days.map(dayLabel).join(', ')}>
                    {periodDays.map((day) => (
                      <i key={day} className={g.dayStatus.has(day) ? `kpi-strip-${g.dayStatus.get(day)}` : undefined} />
                    ))}
                  </span>
                  {oil.length > 0 ? (
                    <span className="kpi-repeat-oil">OIL {oilText(oil)}</span>
                  ) : (
                    <>
                      <button type="button" className="button button-small" onClick={() => addOil(d, g)}>
                        + OIL
                      </button>
                      <span className="muted">{ta.noAction}</span>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="kpi-an-bottom">
        <div className="panel">
          <div className="panel-head">
            <h2>{ta.topHeading}</h2>
            <span className="segmented panel-actions" role="group" aria-label={ta.topHeading}>
              {DIMENSIONS.map((d) => (
                <button key={d} type="button" aria-pressed={dim === d} onClick={() => setDim(d)}>
                  {ta.dims[d]}
                </button>
              ))}
            </span>
          </div>
          <p className="muted kpi-bars-legend">
            <span>
              <i className="kpi-bar-swatch kpi-bar-repeat" /> {ta.legendRepeat}
            </span>
            <span>
              <i className="kpi-bar-swatch" /> {ta.legendOnce}
            </span>
            <span>{ta.legendNumber}</span>
          </p>
          {bars.length === 0 ? (
            <p className="muted">{points.length ? ta.noDetail : ta.noPoints}</p>
          ) : (
            <ul className="kpi-bars">
              {bars.map((g) => {
                const oil = oilFor(oilItems, dim, g.value, today);
                return (
                  <li key={g.value}>
                    <span className="kpi-bar-label" title={g.value}>
                      {g.value}
                    </span>
                    <span className="kpi-bar-track">
                      <span className={`kpi-bar-fill${g.days.length >= 2 ? ' kpi-bar-repeat' : ''}`} style={{ width: `${(g.days.length / barScale) * 100}%` }}>
                        {g.days.length}
                      </span>
                    </span>
                    <span className="muted kpi-bar-note">
                      {plural(g.points, ta.pointForms)}
                      {oil.length > 0 && ` · OIL ${oilText(oil)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>{ta.pointsHeading}</h2>
            <span className="muted">{plural(points.length, ta.pointForms)}</span>
            <span className="panel-actions">
              <button type="button" className="button button-small" disabled={!rows.length} onClick={() => void exportRows()}>
                {ta.export}
              </button>
            </span>
          </div>
          {days.length === 0 ? (
            <p className="muted">{ta.noPoints}</p>
          ) : (
            <div className="kpi-days">
              {days.map((day, k) => {
                const list = byDay.get(day)!;
                const open = isOpen(day, k);
                return (
                  <div key={day} className="kpi-day">
                    <div className="kpi-day-head">
                      <button type="button" className="kpi-day-toggle" aria-expanded={open} onClick={() => toggle(day)}>
                        <span className="kpi-day-chev" aria-hidden="true">
                          {open ? '▾' : '▸'}
                        </span>
                        <span className="kpi-day-label">{dayLabel(day)}</span>
                        <span className="kpi-day-dots" aria-hidden="true">
                          {list.map((p, i) => (
                            <span key={i} className={`kpi-dot kpi-${p.status}`} />
                          ))}
                        </span>
                        <span className="muted">{plural(list.length, ta.pointForms)}</span>
                      </button>
                      <button type="button" className="link-button" onClick={() => onOpenDay(day)}>
                        {ta.openDay}
                      </button>
                    </div>
                    {open &&
                      list.map((p) => (
                        <div key={p.def.id} className="kpi-pt">
                          <span className={`kpi-dot kpi-${p.status}`} title={t.kpi.legend[p.status]} />
                          <b>{p.def.letter}</b>
                          <span>{p.def.name}</span>
                          <span className="n">{valueText(p.value, p.def.unit)}</span>
                          <span className="kpi-pt-details">
                            {p.details.length ? (
                              p.details.map((d, i) => <DetailText key={i} d={d} locale={locale} />)
                            ) : (
                              <button type="button" className="link-button kpi-pt-missing" onClick={() => onOpenDay(day)}>
                                {ta.missingDetail}
                              </button>
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
