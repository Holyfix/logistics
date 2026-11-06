import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LaunchPlan } from '../../core/launch';
import { useData } from '../data/DataProvider';

/** Neuložené změny Launch. Zůstanou i při přechodu do jiného modulu; nové načtení složky je zahodí. */
interface LaunchContextValue {
  draft: LaunchPlan | null;
  setDraft: (plan: LaunchPlan | null) => void;
}

const LaunchContext = createContext<LaunchContextValue | null>(null);

export function LaunchProvider({ children }: { children: ReactNode }) {
  const { state } = useData();
  const loadedAt = state.data?.loadedAt ?? 0;
  const [stored, setStored] = useState<{
    draft: LaunchPlan | null;
    loadedAt: number;
  }>({ draft: null, loadedAt });
  const draft = stored.loadedAt === loadedAt ? stored.draft : null;
  const setDraft = useCallback((plan: LaunchPlan | null) => setStored({ draft: plan, loadedAt }), [loadedAt]);
  const value = useMemo(() => ({ draft, setDraft }), [draft, setDraft]);
  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>;
}

export function useLaunchDraft(): LaunchContextValue {
  const context = useContext(LaunchContext);
  if (!context) throw new Error('useLaunchDraft musí být uvnitř <LaunchProvider>');
  return context;
}

/** Neuložený Launch pro rozcestník; mimo <LaunchProvider> null. */
export function useLaunchDraftPlan(): LaunchPlan | null {
  return useContext(LaunchContext)?.draft ?? null;
}
