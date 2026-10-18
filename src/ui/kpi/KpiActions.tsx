import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort } from '../../core/format';
import { statusOf, type OilItem, type OilStatus } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { ProgressBall } from '../oil/ProgressBall';

/** Otevře bod v modulu OIL. */
export const openOilItem = (id: number) => {
  location.hash = `oil?open=${id}`;
};

/** Otevřené body OIL s písmenem SQCDP (bez hotových a zrušených). */
export const openActions = (items: readonly OilItem[], today: DayNumber) => items.filter((i) => i.letter !== null && !['done', 'cancelled'].includes(statusOf(i, today)));

const ORDER: Record<OilStatus, number> = { overdue: 0, progress: 1, open: 1, done: 2, cancelled: 3 };

/** Seznam opatření pod grafy KPI: otevřené body OIL s písmenem, nejdřív po termínu, pak podle termínu. */
export function KpiActionList({ items, today }: { items: OilItem[]; today: DayNumber }) {
  const { t, locale } = useI18n();
  const ta = t.kpi.actions;
  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const sorted = [...items].sort((a, b) => ORDER[statusOf(a, today)] - ORDER[statusOf(b, today)] || (a.due ?? Infinity) - (b.due ?? Infinity) || a.id - b.id);

  return (
    <div className="panel kpi-actions">
      <div className="panel-head">
        <h2>{ta.heading}</h2>
        <span className="muted">{ta.note}</span>
      </div>
      {sorted.length === 0 ? (
        <p className="muted">{ta.empty}</p>
      ) : (
        <div className="table-scroll">
          <table className="table oil-table">
            <thead>
              <tr>
                <th className="oil-letter">{ta.letter}</th>
                <th className="n">{ta.id}</th>
                <th>{ta.problem}</th>
                <th>{ta.action}</th>
                <th>{ta.owner}</th>
                <th>{ta.due}</th>
                <th>{ta.progress}</th>
                <th>{ta.status}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const s = statusOf(item, today);
                return (
                  <tr key={item.id} className={`oil-row oil-${s}`} title={ta.open} onClick={() => openOilItem(item.id)}>
                    <td className="oil-letter" title={t.kpi.letters[item.letter!]}>
                      {item.letter}
                    </td>
                    <td className="n">
                      <a href={`#oil?open=${item.id}`} onClick={(e) => e.stopPropagation()}>
                        {item.id}
                      </a>
                    </td>
                    <td className="oil-text">{item.problem || t.oil.noProblem}</td>
                    <td className="oil-text">{item.action || '—'}</td>
                    <td className="oil-owner">{item.owner || '—'}</td>
                    <td>{item.due === null ? <span className="muted">{t.oil.noDue}</span> : <span className={s === 'overdue' ? 'cell-short' : undefined}>{dayLabel(item.due)}</span>}</td>
                    <td>
                      <span className="kpi-action-progress">
                        <ProgressBall progress={item.progress} /> {item.progress} %
                      </span>
                    </td>
                    <td>
                      <span className={`oil-chip oil-chip-${s}`}>{t.oil.status[s]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{ta.hint}</p>
    </div>
  );
}
