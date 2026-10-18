import { useMemo } from 'react';
import { buildCoverage } from '../../core/coverage/compute';
import { callOffDigest, componentAlerts, dataFreshness, oilAlerts, projectCoverage, type Severity } from '../../core/dashboard';
import type { DayNumber } from '../../core/dates';
import { checkCount } from '../../core/mappingCheck';
import { useComponents } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { useMappingCheck } from '../data/MappingPanels';
import { useOilDraftList } from '../oil/OilProvider';

export type Tone = Severity | 'ok';
/** Stav oblasti: hoří, pozor, nebo v pořádku. */
export type AreaTone = 'crit' | 'warn' | 'ok';

/** Oblasti Dashboardu v pořadí karet. */
export const AREAS = ['customer', 'components', 'oil', 'calloffs', 'data'] as const;
export type Area = (typeof AREAS)[number];

/** Nejhorší stav z položek; bez dat pozor, bez položek v pořádku. */
function worstOf(list: readonly { severity: Severity }[] | null): AreaTone {
  if (!list) return 'warn';
  if (list.some((a) => a.severity === 'crit')) return 'crit';
  if (list.some((a) => a.severity === 'warn')) return 'warn';
  return 'ok';
}

/** Podklady Dashboardu a stav každé oblasti (hoří / pozor / v pořádku); sdílí je Dashboard a rozcestník. */
export function useDashboard(today: DayNumber, now: number) {
  const { state } = useData();
  const data = state.data;
  const components = useComponents(today);
  const oilDraft = useOilDraftList();
  const mapping = useMappingCheck();
  const mappingIssues = mapping ? checkCount(mapping) : 0;
  const oilList = oilDraft ?? data?.oil?.list ?? null;

  const coverage = useMemo(() => {
    if (!data?.coverage.length) return null;
    const master = data.master?.data;
    return { withTransit: buildCoverage(data.coverage, master, { transit: true }), withoutTransit: buildCoverage(data.coverage, master, { transit: false }) };
  }, [data]);
  const projects = useMemo(() => (coverage ? projectCoverage(coverage.withTransit, coverage.withoutTransit, today) : null), [coverage, today]);
  const componentList = useMemo(() => (components ? componentAlerts(components) : null), [components]);
  const oil = useMemo(() => (oilList ? oilAlerts(oilList, today) : null), [oilList, today]);
  const calloffs = useMemo(() => {
    const current = data?.exports.at(-1);
    return current ? callOffDigest(current, data!.exports.at(-2)) : null;
  }, [data]);
  const freshness = useMemo(
    () =>
      data
        ? dataFreshness({ callOffs: data.exports.at(-1), coverage: data.coverage, stock: data.stock, boms: data.boms, master: data.master, today, now })
        : [],
    [data, today, now],
  );

  const tones: Record<Area, AreaTone> = {
    customer: projects ? worstOf(projects.flatMap((p) => (p.severity ? [{ severity: p.severity }] : []))) : 'warn',
    components: worstOf(componentList),
    oil: worstOf(oil),
    calloffs: !calloffs ? 'warn' : calloffs.alerts.some((a) => a.severity === 'warn') ? 'warn' : 'ok',
    data: freshness.some((f) => f.stale) || mappingIssues ? 'warn' : 'ok',
  };
  return { projects, componentList, oil, calloffs, freshness, mapping, mappingIssues, tones };
}
