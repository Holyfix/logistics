import { Fragment, useMemo, useState } from 'react';
import {
  dayInfos,
  DAY_CODES,
  closedDay,
  lastWorkedDay,
  monthsOf,
  periodRange,
  SUMMARY_PERIODS,
  summarize,
  type AttendanceData,
  type AttendanceSummary,
  type DayCode,
  type DayInfo,
  type SummaryPeriod,
} from '../../core/attendance';
import { dayFromParts, dayToIso, weekday, type DayNumber } from '../../core/dates';
import { localToday } from '../components/useComponents';
import type { Locale } from '../../core/format';
import { isHoliday, isWorkday } from '../../core/vacations';
import { useI18n } from '../../i18n/I18nProvider';

const hours = (n: number, locale: Locale) => n.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedHours = (n: number, locale: Locale) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${hours(Math.abs(n), locale)}`;
const daysText = (n: number, locale: Locale) => n.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 1 });

type ColumnId = 'overtime' | 'approved' | 'toApprove' | DayCode;
interface Column {
  id: ColumnId;
  value: (r: AttendanceSummary) => number;
  kind: 'hours' | 'signed' | 'days';
}

const COLUMNS: { group: 'overtime' | 'away' | 'absence'; columns: Column[] }[] = [
  {
    group: 'overtime',
    columns: [
      { id: 'overtime', value: (r) => r.overtime, kind: 'signed' },
      { id: 'approved', value: (r) => r.approved, kind: 'hours' },
      { id: 'toApprove', value: (r) => r.toApprove, kind: 'hours' },
    ],
  },
  { group: 'away', columns: (['HO', 'SC'] as const).map((c) => ({ id: c, value: (r: AttendanceSummary) => r.days.get(c) ?? 0, kind: 'days' as const })) },
  { group: 'absence', columns: (['DOV', 'L', 'N', 'NV'] as const).map((c) => ({ id: c, value: (r: AttendanceSummary) => r.days.get(c) ?? 0, kind: 'days' as const })) },
];
const ALL_COLUMNS = COLUMNS.flatMap((g) => g.columns);
/** Kolik jmen ukázat u každé položky v panelu TOP. */
const TOP = 5;

/** Přehled odemčené docházky: ukazatele, kalendář měsíce (kdo kdy HO, dovolená, lékař …) a souhrn po lidech. */
export function AttendanceOverview({
  today = localToday(),
  data,
  plainFiles,
  month: chosenMonth,
  setMonth,
  center,
  setCenter,
  lock,
}: {
  today?: DayNumber;
  data: AttendanceData;
  plainFiles: string[];
  month: string | null | undefined;
  setMonth: (m: string | null) => void;
  center: string;
  setCenter: (c: string) => void;
  lock: () => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.attendance;
  const tt = ta.table;
  const [sort, setSort] = useState<ColumnId | 'name'>('name');
  const [period, setPeriod] = useState<SummaryPeriod>('month');
  const months = useMemo(() => monthsOf(data), [data]);
  // Výchozí je nejnovější měsíc.
  const month = chosenMonth === undefined ? (months[0] ?? null) : chosenMonth;
  const centers = useMemo(() => [...new Set(data.people.map((p) => p.center).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [data]);
  // Dnešek se do přesčasů nepočítá, když ho export už obsahuje (směna nemusí být uzavřená).
  const last = lastWorkedDay(data);
  const todayOpen = last !== null && last >= today;
  const reference = closedDay(data, today);
  // Období souhrnu: týden, měsíc (zvolený nahoře), rok nebo celkem k poslednímu uzavřenému dni.
  const range = useMemo(() => {
    if (period === 'month' && month === null) return null;
    const anchor = reference ?? last ?? today;
    return periodRange(data, period, anchor, period === 'month' ? month : null);
  }, [data, period, month, reference, last, today]);
  const all = useMemo(() => summarize(data, range, today).filter((r) => !center || r.person.center === center), [data, range, center, today]);
  const days = useMemo(() => dayInfos(data, month), [data, month]);
  const sortColumn = ALL_COLUMNS.find((c) => c.id === sort);
  const rows = sortColumn ? [...all].sort((a, b) => sortColumn.value(b) - sortColumn.value(a) || a.person.name.localeCompare(b.person.name, 'cs')) : all;

  const monthName = (m: string) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    return new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, 1)));
  };
  const sum = (pick: (r: AttendanceSummary) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const dayCount = (code: DayCode) => sum((r) => r.days.get(code) ?? 0);
  const h = (n: number) => hours(n, locale);
  const d = (n: number) => daysText(n, locale);
  const cell = (c: Column, v: number) => {
    if (!v) return '';
    if (c.kind === 'signed') return <span className={v < 0 ? 'cell-short' : 'delta-up'}>{signedHours(v, locale)}</span>;
    return c.kind === 'days' ? d(v) : h(v);
  };

  const fullDate = (day: DayNumber) => `${Number(dayToIso(day).slice(8))}. ${Number(dayToIso(day).slice(5, 7))}. ${dayToIso(day).slice(0, 4)}`;
  const shortDate = (day: DayNumber) => `${Number(dayToIso(day).slice(8))}. ${Number(dayToIso(day).slice(5, 7))}.`;
  const rangeText = range ? `${shortDate(range.from)} – ${fullDate(range.to)}` : ta.allMonths;

  // Dny vybraného měsíce pro kalendář.
  const monthDays = useMemo(() => {
    if (!month) return [];
    const [y, m] = month.split('-').map(Number) as [number, number];
    const first = dayFromParts(y, m, 1)!;
    const next = m === 12 ? dayFromParts(y + 1, 1, 1)! : dayFromParts(y, m + 1, 1)!;
    return Array.from({ length: next - first }, (_, k) => first + k);
  }, [month]);

  // Víkend šedě, státní svátek vlastní barvou, dnešek orámovaný.
  const dayClass = (day: DayNumber) => `${isHoliday(day) ? ' att-holiday' : isWorkday(day) ? '' : ' att-off'}${day === today ? ` att-today${todayOpen ? ' att-open' : ''}` : ''}`;

  const dayTitle = (name: string, day: DayNumber, info: DayInfo | undefined) => {
    const parts = [`${name} · ${dayToIso(day).split('-').reverse().join('. ').replace(/^0/, '')}`];
    if (info) {
      for (const [code, part] of info.codes) parts.push(`${ta.codes[code]}${part < 1 ? ' (½)' : ''}`);
      if (info.worked) parts.push(`${tt.columns.worked} ${h(info.worked)} h`);
    }
    return parts.join('\n');
  };

  return (
    <>
      <div className="filters" role="group" aria-label={tt.heading}>
        <label className="inline-field">
          <span>{ta.month}</span>
          <select value={month ?? ''} onChange={(e) => setMonth(e.target.value || null)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
            <option value="">{ta.allMonths}</option>
          </select>
        </label>
        {centers.length > 1 && (
          <label className="inline-field">
            <span>{ta.center}</span>
            <select value={center} onChange={(e) => setCenter(e.target.value)}>
              <option value="">{ta.allCenters}</option>
              {centers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="segmented" role="group" aria-label={ta.period}>
          {SUMMARY_PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {ta.periods[p]}
            </button>
          ))}
        </span>
        <span className="muted">{rangeText}</span>
        <span className="filters-break" role="presentation" />
        <button type="button" className="button" onClick={lock}>
          🔒 {ta.lock}
        </button>
        <span className="muted">{ta.autoLock}</span>
      </div>

      {plainFiles.map((f) => (
        <p key={f} className="banner-inline">
          {ta.notEncrypted.replace('{file}', f)}
        </p>
      ))}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.overtime}</span>
          <span className={`kpi-value${sum((r) => r.overtime) < 0 ? ' cell-short' : ''}`}>{signedHours(sum((r) => r.overtime), locale)} h</span>
          <span className="kpi-note">{ta.kpi.overtimeNote.replace('{approved}', h(sum((r) => r.approved))).replace('{toApprove}', h(sum((r) => r.toApprove)))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.away}</span>
          <span className="kpi-value">{d(dayCount('HO'))}</span>
          <span className="kpi-note">{ta.kpi.awayNote.replace('{sc}', d(dayCount('SC')))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.absence}</span>
          <span className="kpi-value">{d(dayCount('DOV') + dayCount('L') + dayCount('N') + dayCount('NV'))}</span>
          <span className="kpi-note">
            {ta.kpi.absenceNote.replace('{dov}', d(dayCount('DOV'))).replace('{l}', d(dayCount('L'))).replace('{n}', d(dayCount('N'))).replace('{nv}', d(dayCount('NV')))}
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ta.top.heading}</h2>
          <span className="muted">{rangeText}</span>
        </div>
        <div className="att-top">
          {ALL_COLUMNS.map((c) => {
            const best = all
              .map((r) => ({ name: r.person.name, value: c.value(r) }))
              .filter((x) => (c.kind === 'signed' ? Math.abs(x.value) >= 0.005 : x.value > 0))
              .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'cs'))
              .slice(0, TOP);
            return (
              <div key={c.id} className="att-top-card">
                <h3>{ta.top.titles[c.id]}</h3>
                {best.length === 0 ? (
                  <p className="muted">{ta.top.none}</p>
                ) : (
                  <ol>
                    {best.map((x) => (
                      <li key={x.name}>
                        <span>{x.name}</span>
                        <strong>{cell(c, x.value)}</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {month && (
        <div className="panel">
          <div className="panel-head">
            <h2>{ta.calendar.heading}</h2>
            <span className="muted">{monthName(month)}</span>
          </div>
          <div className="table-scroll">
            <table className="table att-calendar" aria-label={ta.calendar.heading}>
              <thead>
                <tr>
                  <th className="sticky-col">{tt.name}</th>
                  {monthDays.map((day) => (
                    <th key={day} className={`att-day${dayClass(day)}`} title={isHoliday(day) ? t.vacations.holiday : day === today ? (todayOpen ? ta.calendar.openDay : ta.calendar.today) : undefined}>
                      <span>{Number(dayToIso(day).slice(8))}</span>
                      <small>{t.calloffs.weekdays[weekday(day) - 1]!.slice(0, 2)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person.id}>
                    <td className="sticky-col">{r.person.name}</td>
                    {monthDays.map((day) => {
                      const info = days.get(r.person.id)?.get(day);
                      const codes = info ? DAY_CODES.filter((c) => info.codes.has(c)) : [];
                      const main = codes[0];
                      const half = main !== undefined && (info!.codes.get(main) ?? 1) < 1;
                      return (
                        <td key={day} className={`att-cell${dayClass(day)}${main ? ` att-${main}` : ''}`} title={dayTitle(r.person.name, day, info)}>
                          {main && (
                            <>
                              {half && '½'}
                              {main}
                              {codes.length > 1 && <sup>+</sup>}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="cov-legend">
            {DAY_CODES.map((c) => (
              <li key={c}>
                <i className={`att-key att-${c}`} aria-hidden="true">
                  {c}
                </i>{' '}
                {ta.codes[c]}
              </li>
            ))}
            <li>
              <i className="att-key att-key-day att-holiday" aria-hidden="true" /> {ta.calendar.holiday}
            </li>
            <li>
              <i className="att-key att-key-day att-today" aria-hidden="true" /> {ta.calendar.today}
            </li>
            <li className="muted">{ta.calendar.legendNote}</li>
          </ul>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>{tt.heading}</h2>
          <span className="muted">
            {rangeText}
            {reference !== null && ` · ${ta.closedTo.replace('{date}', fullDate(reference))}`}
            {todayOpen && ` · ${ta.openDayNote}`}
          </span>
        </div>
        <div className="table-scroll table-tall">
          <table className="table table-data att-summary" aria-label={tt.heading}>
            <thead>
              <tr>
                <th className="sticky-col" rowSpan={2}>
                  <button type="button" className="att-sort" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>
                    {tt.name}
                  </button>
                </th>
                {COLUMNS.map((g) => (
                  <th key={g.group} colSpan={g.columns.length} className="att-group">
                    {tt.groups[g.group]}
                  </th>
                ))}
              </tr>
              <tr>
                {COLUMNS.map((g) => (
                  <Fragment key={g.group}>
                    {g.columns.map((c, k) => (
                      <th key={c.id} className={`n${k === 0 ? ' att-group-start' : ''}`} title={tt.titles[c.id]}>
                        <button type="button" className="att-sort" aria-pressed={sort === c.id} onClick={() => setSort(sort === c.id ? 'name' : c.id)}>
                          {tt.columns[c.id]}
                          {sort === c.id && ' ▼'}
                        </button>
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.person.id}>
                  <td className="sticky-col">
                    {r.person.name}
                    {centers.length > 1 && <small className="muted"> · {r.person.center}</small>}
                  </td>
                  {COLUMNS.map((g) => (
                    <Fragment key={g.group}>
                      {g.columns.map((c, k) => (
                        <td key={c.id} className={`n${k === 0 ? ' att-group-start' : ''}`}>
                          {cell(c, c.value(r))}
                        </td>
                      ))}
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">{tt.total}</td>
                {COLUMNS.map((g) => (
                  <Fragment key={g.group}>
                    {g.columns.map((c, k) => (
                      <td key={c.id} className={`n${k === 0 ? ' att-group-start' : ''}`}>
                        {cell(c, sum(c.value)) || '0'}
                      </td>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted">{tt.note}</p>
      </div>

      <details className="panel">
        <summary>
          <h2 className="att-summary-heading">{ta.detail.heading}</h2>
        </summary>
        <div className="table-scroll table-tall">
          <table className="table table-data" aria-label={ta.detail.heading}>
            <thead>
              <tr>
                <th className="sticky-col">{tt.name}</th>
                {data.categories.map((c) => (
                  <th key={c} className="n">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.person.id}>
                  <td className="sticky-col">{r.person.name}</td>
                  {data.categories.map((c) => {
                    const v = r.byCategory.get(c) ?? 0;
                    return (
                      <td key={c} className="n">
                        {v ? h(v) : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">{ta.detail.note}</p>
      </details>
    </>
  );
}
