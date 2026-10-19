import { useState } from 'react';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { LETTERS, type KpiData, type KpiDetail, type Letter } from '../../core/kpi';
import { DIMENSIONS, letterSummary, nokGroups, nokPoints, type Dimension, type NokGroup, type NokPoint } from '../../core/kpiAnalysis';
import { ownerNames, statusOf, type OilItem } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsx } from '../../platform/download';
import { formatValue } from './KpiCharts';

type Period = 'week' | 'month' | 'custom';

/** Kolik hodnot ukazuje souhrn podle rozměru. */
const GROUP_ROWS = 10;

/** Otevřené body OIL, které se týkají hodnoty: odpovědný (osoba), jinak hodnota v textu problému nebo opatření. */
function oilFor(items: readonly OilItem[], dim: Dimension, value: string, today: DayNumber): OilItem[] {
  const v = value.toLowerCase();
  return items.filter((i) => {
    if (['done', 'cancelled'].includes(statusOf(i, today))) return false;
    if (dim === 'person') return ownerNames(i.owner).some((o) => o.toLowerCase() === v);
    return v.length >= 3 && `${i.problem} ${i.action}`.toLowerCase().includes(v);
  });
}

/** Rozbor: body mimo cíl za období s detaily a co se opakuje podle projektu, dílu, osoby a příčiny. */
export function KpiAnalysis({ kpi, oilItems, today, onOpenDay }: { kpi: KpiData; oilItems: readonly OilItem[]; today: DayNumber; onOpenDay: (day: DayNumber) => void }) {
  const { t, locale } = useI18n();
  const ta = t.kpi.analysis;
  const [period, setPeriod] = useState<Period>('week');
  const [fromText, setFromText] = useState(dayToIso(today - 6));
  const [toText, setToText] = useState(dayToIso(today));
  const [letter, setLetter] = useState<Letter | ''>('');
  const [kpiId, setKpiId] = useState('');

  const monthStart = today - Number(dayToIso(today).slice(8)) + 1;
  const from = period === 'week' ? today - 6 : period === 'month' ? monthStart : (parseDay(fromText) ?? today - 6);
  const to = period === 'custom' ? (parseDay(toText) ?? today) : today;
  const points = nokPoints(kpi, from, to, { letter, kpiId });
  const groups = Object.fromEntries(DIMENSIONS.map((d) => [d, nokGroups(points, d)])) as Record<Dimension, NokGroup[]>;
  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const oilText = (items: OilItem[]) => (items.length ? items.map((i) => ta.oilItem.replace('{id}', String(i.id))).join(', ') : '—');
  const defsShown = kpi.defs.filter((d) => !letter || d.letter === letter);
  const summary = letter ? letterSummary(kpi, letter, from, to) : null;

  // Co se opakuje: hodnoty, které se objevily aspoň ve dvou dnech.
  const repeats = DIMENSIONS.flatMap((dim) =>
    groups[dim]
      .filter((g) => g.days.length >= 2)
      .map((g) => ({ dim, g, oil: oilFor(oilItems, dim, g.value, today) })),
  ).sort((a, b) => b.g.days.length - a.g.days.length || b.g.points - a.g.points);

  const rows = points.flatMap((p): { p: NokPoint; d: KpiDetail | null }[] => (p.details.length ? p.details.map((d) => ({ p, d })) : [{ p, d: null }]));
  const valueText = (value: number, unit: string) => `${formatValue(value, locale)}${unit ? ` ${unit}` : ''}`;
  const exportRows = () =>
    downloadXlsx(
      `${ta.fileName}_${dayToIso(from)}_${dayToIso(to)}.xlsx`,
      ta.sheet,
      [ta.day, ta.letter, ta.kpi, ta.value, ta.dims.project, ta.dims.item, ta.dims.person, ta.qty, ta.dims.cause, ta.source],
      rows.map(({ p, d }) => [dayToIso(p.day), p.def.letter, p.def.name, p.value, d?.project ?? '', d?.item ?? '', d?.person ?? '', d?.qty ?? null, d?.cause ?? '', d ? ta.sources[d.source] : '']),
    );

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
          <span>{ta.letter}</span>
          <select
            value={letter}
            onChange={(e) => {
              setLetter(e.target.value as Letter | '');
              setKpiId('');
            }}
          >
            <option value="">{ta.all}</option>
            {LETTERS.map((l) => (
              <option key={l} value={l}>
                {l} – {t.kpi.letters[l]}
              </option>
            ))}
          </select>
        </label>
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
          {formatDayShort(dayToIso(from), locale)} – {formatDayShort(dayToIso(to), locale)}
          {summary &&
            ` · ${ta.summary
              .replace('{letter}', letter)
              .replace('{off}', String(summary.off))
              .replace('{workdays}', String(summary.workdays))
              .replace('{red}', String(summary.red))}`}
        </span>
      </div>

      <div className="panel kpi-repeats">
        <p>
          <strong>{ta.repeatsHeading}</strong>
        </p>
        {repeats.length === 0 ? (
          <p className="muted">{points.length ? ta.noRepeats : ta.noPoints}</p>
        ) : (
          <ul>
            {repeats.slice(0, 6).map(({ dim, g, oil }) => (
              <li key={`${dim}|${g.value}`}>
                {ta.dims[dim]} <strong>{g.value}</strong>:{' '}
                {ta.repeat.replace('{n}', String(g.days.length)).replace('{days}', g.days.map(dayLabel).join(', ')).replace('{kpis}', g.kpis.map((k) => k.name).join(', '))}
                {oil.length > 0 && ` · ${ta.inOil} ${oilText(oil)}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="kpi-groups">
        {DIMENSIONS.map((dim) => (
          <div key={dim} className="panel">
            <h2>{ta.dims[dim]}</h2>
            {groups[dim].length === 0 ? (
              <p className="muted">{ta.noDetail}</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{ta.dims[dim]}</th>
                    <th className="n">{ta.days}</th>
                    <th className="n">{ta.points}</th>
                    <th>{ta.kpis}</th>
                    <th>OIL</th>
                  </tr>
                </thead>
                <tbody>
                  {groups[dim].slice(0, GROUP_ROWS).map((g) => (
                    <tr key={g.value} className={g.days.length >= 2 ? 'kpi-group-repeat' : undefined}>
                      <td>
                        <strong>{g.value}</strong>
                      </td>
                      <td className="n">{g.days.length}</td>
                      <td className="n">{g.points}</td>
                      <td>{g.kpis.map((k) => k.name).join(', ')}</td>
                      <td>{oilText(oilFor(oilItems, dim, g.value, today))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ta.pointsHeading}</h2>
          <span className="muted">{ta.pointsNote.replace('{n}', formatQuantity(points.length, locale))}</span>
          <span className="panel-actions">
            <button type="button" className="button" disabled={!rows.length} onClick={() => void exportRows()}>
              {ta.export}
            </button>
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="muted">{ta.noPoints}</p>
        ) : (
          <div className="table-scroll">
            <table className="table kpi-points">
              <thead>
                <tr>
                  <th>{ta.day}</th>
                  <th>{ta.letter}</th>
                  <th>{ta.kpi}</th>
                  <th className="n">{ta.value}</th>
                  <th>{ta.dims.project}</th>
                  <th>{ta.dims.item}</th>
                  <th>{ta.dims.person}</th>
                  <th className="n">{ta.qty}</th>
                  <th>{ta.dims.cause}</th>
                  <th>{ta.source}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, d }, k) => (
                  <tr key={k}>
                    <td>
                      <button type="button" className="link-button" onClick={() => onOpenDay(p.day)}>
                        {dayLabel(p.day)}
                      </button>
                    </td>
                    <td>
                      <span className={`kpi-dot kpi-${p.status}`} /> {p.def.letter}
                    </td>
                    <td>{p.def.name}</td>
                    <td className="n">{valueText(p.value, p.def.unit)}</td>
                    <td>{d?.project || '—'}</td>
                    <td>{d?.item || '—'}</td>
                    <td>{d?.person || '—'}</td>
                    <td className="n">{d?.qty === null || d === null ? '—' : formatValue(d.qty, locale)}</td>
                    <td>{d?.cause || (d ? '' : <span className="muted">{ta.missingDetail}</span>)}</td>
                    <td>{d ? ta.sources[d.source] : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
