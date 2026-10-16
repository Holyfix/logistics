import { useMemo } from 'react';
import type { DayNumber } from '../../core/dates';
import { ASSEMBLY, assemblyItems, autoPlan, packOf, slotCapacity, type AutoPlanResult, type PlanItem } from '../../core/planning/assembly';
import { emptyPlan, shiftSlots, type LinePlan } from '../../core/planning/plan';
import { DEFAULT_SETTINGS, lineCapacity, type LineCapacity, type PlanSettings } from '../../core/planning/settings';
import { stockByItem } from '../../core/stock';
import type { SavedPlan } from '../../platform/loader';
import { useData } from '../data/DataProvider';
import { planKey, usePlanningDrafts } from './PlanningProvider';

/** Plán linky pro jeden projekt: díly, kapacita a plán (rozpracovaný, uložený, nebo prázdný). */
export interface ProjectPlan {
  line: string;
  project: string;
  key: string;
  items: PlanItem[];
  capacity: LineCapacity;
  /** Plán, jak ho zadal plánovač (automatické směny bez dopočítaných množství). */
  plan: LinePlan;
  /** Výsledný plán: ruční směny + dopočítané automatické směny; tento se zobrazuje a ukládá. */
  result: AutoPlanResult;
  saved: SavedPlan | null;
  /** Plán má neuložené změny. */
  dirty: boolean;
}

export interface PlanningData {
  settings: PlanSettings;
  settingsDirty: boolean;
  settingsFile: { path: string; lastModified: number } | null;
  /** Dny coverage od dneška (i víkendy). */
  days: DayNumber[];
  projects: ProjectPlan[];
  /** Díly montáže podle sloupce Line v mapování (jinak všechny díly ze souborů coverage). */
  byLineColumn: boolean;
}

/** Aktuální čas v minutách od 1. 1. 1970 místního času (stejná osa jako směny). */
export function localNow(): number {
  const now = new Date();
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 60_000);
}

/** Data pro plánování; null, když nejsou načtená žádná data. */
export function usePlanning(today: DayNumber): PlanningData | null {
  const { state } = useData();
  const drafts = usePlanningDrafts();
  const data = state.data;
  const settings = drafts.settings ?? data?.planSettings?.settings ?? DEFAULT_SETTINGS;

  const items = useMemo(() => {
    if (!data) return null;
    return assemblyItems({
      master: data.master?.data,
      coverage: data.coverage,
      callOffs: data.exports.at(-1),
      stock: data.stock ? stockByItem(data.stock.data) : undefined,
      today,
    });
  }, [data, today]);

  return useMemo(() => {
    if (!data || !items) return null;
    const slots = shiftSlots(items.days[0] ?? today, items.days.length, settings.firstShiftStart);
    const byProject = new Map<string, PlanItem[]>();
    for (const it of items.items) byProject.set(it.project, [...(byProject.get(it.project) ?? []), it]);
    const projects = [...byProject.keys()]
      .sort((a, b) => (a ? (b ? a.localeCompare(b, 'cs') : -1) : 1))
      .map((project): ProjectPlan => {
        const key = planKey(ASSEMBLY, project);
        const saved = data.plans.find((p) => p.plan.line === ASSEMBLY && p.plan.project === project) ?? null;
        const draft = drafts.plans[key];
        const plan = draft ?? saved?.plan ?? emptyPlan(ASSEMBLY, project);
        const capacity = lineCapacity(settings, ASSEMBLY, project);
        const list = byProject.get(project)!;
        return {
          line: ASSEMBLY,
          project,
          key,
          items: list,
          capacity,
          plan,
          result: autoPlan(list, items.days, plan.cells, plan.auto, slots, (slot) => slotCapacity(slot, capacity, plan.capacity), packOf),
          saved,
          dirty: draft !== undefined,
        };
      });
    return {
      settings,
      settingsDirty: drafts.settings !== null,
      settingsFile: data.planSettings ? { path: data.planSettings.path, lastModified: data.planSettings.lastModified } : null,
      days: items.days,
      projects,
      byLineColumn: data.master?.data.hasLineColumn ?? false,
    };
  }, [data, items, today, settings, drafts.plans, drafts.settings]);
}
