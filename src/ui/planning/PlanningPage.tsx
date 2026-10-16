import { useMemo } from 'react';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { LINES } from '../../core/masterdata';
import { evaluateItem, plannedTotal } from '../../core/planning/assembly';
import { useI18n } from '../../i18n/I18nProvider';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { localToday } from '../components/useComponents';
import { AssemblyPlan } from './AssemblyPlan';
import { CapacityPage } from './CapacityPage';
import { usePlanningDrafts, type PlanningTab } from './PlanningProvider';
import { formatModified } from './SaveStatus';
import { localNow, usePlanning, type PlanningData } from './usePlanning';
import { MappingNotice } from '../data/MappingPanels';

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

export function PlanningPage({ today = localToday(), now = localNow() }: { today?: DayNumber; now?: number } = {}) {
  const { t } = useI18n();
  const tp = t.planning;
  const { state } = useData();
  const { tab, setTab } = usePlanningDrafts();
  const data = usePlanning(today);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="production" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.production.title}</h1>
        <p className="lead">{t.modules.production.description}</p>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{state.status === 'loading' ? t.data.folder.loading : tp.noData}</p>
          {state.status !== 'loading' && (
            <p>
              <a className="button button-primary" href="#data">
                {tp.noDataAction}
              </a>
            </p>
          )}
        </div>
      </section>
    );
  }

  const tabs: PlanningTab[] = ['overview', ...LINES, 'capacity'];
  const dirty = data.projects.some((p) => p.dirty);
  const tabLabel = (id: PlanningTab) => (id === 'overview' ? tp.tabs.overview : id === 'capacity' ? tp.tabs.capacity : id);

  return (
    <section className="page" aria-labelledby="page-title">
      {head}
      <MappingNotice module="planning" />
      <div className="tabs" role="tablist" aria-label={t.modules.production.title}>
        {tabs.map((id) => (
          <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {tabLabel(id)}
            {((id === 'ASSEMBLY' && dirty) || (id === 'capacity' && data.settingsDirty)) && ' •'}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview data={data} />}
      {tab === 'ASSEMBLY' && <AssemblyPlan data={data} today={today} now={now} />}
      {tab === 'capacity' && <CapacityPage data={data} />}
      {(tab === 'FOA' || tab === 'SLH' || tab === 'IMM') && (
        <div className="panel">
          <h2>{tab}</h2>
          <p>{tp.later}</p>
        </div>
      )}
    </section>
  );
}

/** Přehled linek: potřeba, plán a vytížení na 7 dní, nepokryté díly a stav uložení. */
function Overview({ data }: { data: PlanningData }) {
  const { t, locale } = useI18n();
  const tp = t.planning;
  const to = tp.overview;
  const { setTab, setProject } = usePlanningDrafts();

  const rows = useMemo(() => {
    const days = data.days;
    const earliest = (values: readonly (number | null)[]) => values.reduce<number | null>((w, v) => (v === null ? w : w === null ? v : Math.min(w, v)), null);
    return data.projects.map((p) => {
      const statuses = p.items.map((it) => evaluateItem(it, plannedTotal(p.result.cells, it.item, days)));
      return {
        p,
        planned: sum(statuses.map((s) => s.planned)),
        uncovered: statuses.filter((s) => s.shortDay !== null).length,
        worst: earliest(statuses.map((s) => s.shortDay)),
        worstWithout: earliest(statuses.map((s) => s.shortDayWithoutPlan)),
      };
    });
  }, [data]);

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const untilText = (short: number | null) => {
    if (short === null) return `${dayLabel(data.days.at(-1)!)} ${tp.assembly.orLater}`;
    return short === 0 ? tp.assembly.notCovered : dayLabel(data.days[short - 1]!);
  };
  const open = (project: string) => {
    setProject(project);
    setTab('ASSEMBLY');
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{to.heading}</h2>
        <span className="muted">{to.sub}</span>
      </div>
      <div className="table-scroll">
        <table className="table table-data">
          <thead>
            <tr>
              <th>{to.line}</th>
              <th>{to.project}</th>
              <th className="n">{to.uncovered}</th>
              <th>{to.until}</th>
              <th className="n">{to.planned}</th>
              <th>{to.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, planned, uncovered, worst, worstWithout }) => (
              <tr key={p.key}>
                <td>
                  <strong>{p.line}</strong>
                </td>
                <td>
                  <button type="button" className="link-button cell-link" onClick={() => open(p.project)}>
                    <strong>{p.project || tp.noProject}</strong>
                  </button>
                </td>
                <td className={`n${uncovered > 0 ? ' cell-negative' : ''}`}>
                  {formatQuantity(uncovered, locale)} / {formatQuantity(p.items.length, locale)}
                </td>
                <td className="cell-until">
                  <strong className={worst === null ? undefined : 'cell-short'}>{untilText(worst)}</strong>
                  <small className="muted cell-note">
                    {tp.assembly.withoutPlan} {untilText(worstWithout)}
                  </small>
                </td>
                <td className="n">{formatQuantity(planned, locale)}</td>
                <td>
                  {p.dirty ? (
                    <span className="save-dirty">{tp.status.dirty}</span>
                  ) : p.saved ? (
                    <span className="muted">
                      {tp.status.saved} {formatModified(p.saved.lastModified, locale)}
                    </span>
                  ) : (
                    <span className="muted">{tp.status.none}</span>
                  )}
                </td>
              </tr>
            ))}
            {LINES.filter((l) => l !== 'ASSEMBLY').map((line) => (
              <tr key={line}>
                <td>
                  <strong>{line}</strong>
                </td>
                <td colSpan={5} className="muted">
                  {tp.later}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{to.note}</p>
    </div>
  );
}
