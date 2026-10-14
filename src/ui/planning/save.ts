import { useCallback } from 'react';
import { planFileName, planSheets, type PlanItemInfo } from '../../core/planning/plan';
import { PLAN_FOLDER, SETTINGS_FILE, settingsSheets, type PlanSettings } from '../../core/planning/settings';
import { xlsxBlob } from '../../platform/download';
import type { SaveResult } from '../../platform/folder';
import type { LoadedData } from '../../platform/loader';
import { useData } from '../data/DataProvider';
import { usePlanningDrafts } from './PlanningProvider';
import type { ProjectPlan } from './usePlanning';

/** Složka plánů: kde už je nějaký plán nebo nastavení, jinak „Plan“ v kořeni vybrané složky. */
function planFolder(data: LoadedData | null): string {
  const path = data?.planSettings?.path ?? data?.plans[0]?.path;
  return path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : PLAN_FOLDER;
}

/** Uložení plánu linky a nastavení kapacit do složky Plan. */
export function usePlanSaving() {
  const { state, saveFile, updateData } = useData();
  const { setPlan, setSettings } = usePlanningDrafts();
  const data = state.data;

  const savePlan = useCallback(
    async (project: ProjectPlan, force = false): Promise<SaveResult> => {
      const path = project.saved?.path ?? `${planFolder(data)}/${planFileName(project.line, project.project)}`;
      const info = new Map<string, PlanItemInfo>(project.items.map((it) => [it.item, it]));
      // Do souboru jde výsledný plán: i množství dopočítaná na automatických směnách.
      const plan = { ...project.plan, cells: project.result.cells };
      const result = await saveFile(path, () => xlsxBlob(planSheets(plan, info)), project.saved?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({
          ...d,
          plans: [...d.plans.filter((p) => !(p.plan.line === plan.line && p.plan.project === plan.project)), { path: result.path, lastModified: result.lastModified, plan }],
        }));
        setPlan(null, project.key);
      }
      return result;
    },
    [data, saveFile, updateData, setPlan],
  );

  const saveSettings = useCallback(
    async (settings: PlanSettings, force = false): Promise<SaveResult> => {
      const path = data?.planSettings?.path ?? `${planFolder(data)}/${SETTINGS_FILE}`;
      const result = await saveFile(path, () => xlsxBlob(settingsSheets(settings)), data?.planSettings?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({ ...d, planSettings: { path: result.path, lastModified: result.lastModified, settings } }));
        setSettings(null);
      }
      return result;
    },
    [data, saveFile, updateData, setSettings],
  );

  return { savePlan, saveSettings };
}
