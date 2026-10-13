import { useMemo } from 'react';
import type { DayNumber } from '../../core/dates';
import { ASSEMBLY, assemblyItems, PLAN_DAYS, type PlanItem } from '../../core/planning/assembly';
import { emptyPlan, shiftSlots, type LinePlan, type ShiftSlot } from '../../core/planning/plan';
import { DEFAULT_SETTINGS, lineCapacity, type LineCapacity, type PlanSettings } from '../../core/planning/settings';
import { stockByItem } from '../../core/stock';
import type { SavedPlan } from '../../platform/loader';
import { useData } from '../data/DataProvider';
import { planKey, usePlanningDrafts } from './PlanningProvider';

/** Plán linky pro jeden projekt: díly s požadavky, kapacita a plán (rozpracovaný, uložený, nebo prázdný). */
export interface ProjectPlan {
  line: string;
  project: string;
  key: string;
  items: PlanItem[];
  capacity: LineCapacity;
  plan: LinePlan;
  saved: SavedPlan | null;
  /** Plán má neuložené změny. */
  dirty: boolean;
}

export interface PlanningData {
  settings: PlanSettings;
  settingsDirty: boolean;
  settingsFile: { path: string; lastModified: number } | null;
  slots: ShiftSlot[];
  projects: ProjectPlan[];
  /** Díly montáže podle sloupce Line v mapování (jinak díly ze souborů coverage a díly s projektem a stranou). */
  byLineColumn: boolean;
}

/** Aktuální čas v minutách od 1. 1. 1970 místního času (stejná osa jako směny). */
export function localNow(): number {
  const now = new Date();
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 60_000);
}

/** Data pro plánování; null, když nejsou načtená žádná data o dílech (mapování, odvolávky ani coverage). */
export function usePlanning(today: DayNumber): PlanningData | null {
  const { state } = useData();
  const drafts = usePlanningDrafts();
  const data = state.data;
  const settings = drafts.settings ?? data?.planSettings?.settings ?? DEFAULT_SETTINGS;

  const items = useMemo(() => {
    if (!data || (!data.master && data.exports.length === 0 && data.coverage.length === 0)) return null;
    return assemblyItems({
      master: data.master?.data,
      coverage: data.coverage,
      callOffs: data.exports.at(-1),
      stock: data.stock ? stockByItem(data.stock.data) : undefined,
      today,
      settings,
    });
  }, [data, today, settings]);

  return useMemo(() => {
    if (!data || !items) return null;
    const slots = shiftSlots(today, PLAN_DAYS, settings.firstShiftStart);
    const byProject = new Map<string, PlanItem[]>();
    for (const it of items) byProject.set(it.project, [...(byProject.get(it.project) ?? []), it]);
    const projects = [...byProject.keys()]
      .sort((a, b) => (a ? (b ? a.localeCompare(b, 'cs') : -1) : 1))
      .map((project): ProjectPlan => {
        const key = planKey(ASSEMBLY, project);
        const saved = data.plans.find((p) => p.plan.line === ASSEMBLY && p.plan.project === project) ?? null;
        const draft = drafts.plans[key];
        return {
          line: ASSEMBLY,
          project,
          key,
          items: byProject.get(project)!,
          capacity: lineCapacity(settings, ASSEMBLY, project),
          plan: draft ?? saved?.plan ?? emptyPlan(ASSEMBLY, project),
          saved,
          dirty: draft !== undefined,
        };
      });
    return {
      settings,
      settingsDirty: drafts.settings !== null,
      settingsFile: data.planSettings ? { path: data.planSettings.path, lastModified: data.planSettings.lastModified } : null,
      slots,
      projects,
      byLineColumn: data.master?.data.hasLineColumn ?? false,
    };
  }, [data, items, today, settings, drafts.plans, drafts.settings]);
}
