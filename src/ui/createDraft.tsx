import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useData } from './data/DataProvider';

interface DraftValue<T> {
  draft: T | null;
  setDraft: (value: T | null) => void;
}

/**
 * Neuložené změny modulu, které zůstanou i při přechodu do jiného modulu; nové načtení složky je zahodí.
 * Vrací Provider, hook pro modul a hook pro přehledy (rozcestník), který mimo Provider vrátí null.
 */
export function createDraft<T>(name: string) {
  const Context = createContext<DraftValue<T> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const { state } = useData();
    const loadedAt = state.data?.loadedAt ?? 0;
    const [stored, setStored] = useState<{ draft: T | null; loadedAt: number }>({ draft: null, loadedAt });
    const draft = stored.loadedAt === loadedAt ? stored.draft : null;
    const setDraft = useCallback((value: T | null) => setStored({ draft: value, loadedAt }), [loadedAt]);
    const value = useMemo(() => ({ draft, setDraft }), [draft, setDraft]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useDraft(): DraftValue<T> {
    const context = useContext(Context);
    if (!context) throw new Error(`${name}: chybí Provider`);
    return context;
  }

  const useDraftValue = (): T | null => useContext(Context)?.draft ?? null;

  return { Provider, useDraft, useDraftValue };
}
