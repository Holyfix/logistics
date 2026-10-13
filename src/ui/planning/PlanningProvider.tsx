import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LinePlan } from '../../core/planning/plan';
import type { PlanSettings } from '../../core/planning/settings';
import { useData } from '../data/DataProvider';

export type PlanningTab = 'overview' | 'ASSEMBLY' | 'FOA' | 'SLH' | 'IMM' | 'capacity';

/** Neuložené změny plánů a kapacit. Zůstanou i při přechodu do jiného modulu; nové načtení složky je zahodí. */
interface PlanningDrafts {
  /** Upravené plány podle klíče `linka|projekt`. */
  plans: Record<string, LinePlan>;
  settings: PlanSettings | null;
  tab: PlanningTab;
  project: string;
}

interface PlanningContextValue extends PlanningDrafts {
  setPlan: (plan: LinePlan | null, key: string) => void;
  setSettings: (settings: PlanSettings | null) => void;
  setTab: (tab: PlanningTab) => void;
  setProject: (project: string) => void;
}

export const planKey = (line: string, project: string) => `${line}|${project}`;

const EMPTY: PlanningDrafts = { plans: {}, settings: null, tab: 'overview', project: '' };
const PlanningContext = createContext<PlanningContextValue | null>(null);

export function PlanningProvider({ children }: { children: ReactNode }) {
  const { state } = useData();
  const loadedAt = state.data?.loadedAt ?? 0;
  const [stored, setDrafts] = useState<PlanningDrafts & { loadedAt: number }>({ ...EMPTY, loadedAt });
  // Nově načtená složka: rozpracované změny patří ke starým datům a neplatí.
  const drafts: PlanningDrafts = stored.loadedAt === loadedAt ? stored : { ...stored, plans: EMPTY.plans, settings: null };

  const setPlan = useCallback(
    (plan: LinePlan | null, key: string) => {
      setDrafts((d) => {
        const plans = d.loadedAt === loadedAt ? { ...d.plans } : {};
        if (plan) plans[key] = plan;
        else delete plans[key];
        return { ...d, plans, settings: d.loadedAt === loadedAt ? d.settings : null, loadedAt };
      });
    },
    [loadedAt],
  );
  const setSettings = useCallback(
    (settings: PlanSettings | null) => setDrafts((d) => ({ ...d, plans: d.loadedAt === loadedAt ? d.plans : {}, settings, loadedAt })),
    [loadedAt],
  );
  const setTab = useCallback((tab: PlanningTab) => setDrafts((d) => ({ ...d, tab })), []);
  const setProject = useCallback((project: string) => setDrafts((d) => ({ ...d, project })), []);

  const { plans, settings, tab, project } = drafts;
  const value = useMemo(
    () => ({ plans, settings, tab, project, setPlan, setSettings, setTab, setProject }),
    [plans, settings, tab, project, setPlan, setSettings, setTab, setProject],
  );
  return <PlanningContext.Provider value={value}>{children}</PlanningContext.Provider>;
}

export function usePlanningDrafts(): PlanningContextValue {
  const context = useContext(PlanningContext);
  if (!context) throw new Error('usePlanningDrafts musí být uvnitř <PlanningProvider>');
  return context;
}
