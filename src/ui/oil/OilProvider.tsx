import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { OilList } from '../../core/oil';
import { useData } from '../data/DataProvider';

/** Neuložené změny OIL. Zůstanou i při přechodu do jiného modulu; nové načtení složky je zahodí. */
interface OilContextValue {
  draft: OilList | null;
  setDraft: (list: OilList | null) => void;
}

const OilContext = createContext<OilContextValue | null>(null);

export function OilProvider({ children }: { children: ReactNode }) {
  const { state } = useData();
  const loadedAt = state.data?.loadedAt ?? 0;
  const [stored, setStored] = useState<{ draft: OilList | null; loadedAt: number }>({ draft: null, loadedAt });
  const draft = stored.loadedAt === loadedAt ? stored.draft : null;
  const setDraft = useCallback((list: OilList | null) => setStored({ draft: list, loadedAt }), [loadedAt]);
  const value = useMemo(() => ({ draft, setDraft }), [draft, setDraft]);
  return <OilContext.Provider value={value}>{children}</OilContext.Provider>;
}

export function useOilDraft(): OilContextValue {
  const context = useContext(OilContext);
  if (!context) throw new Error('useOilDraft musí být uvnitř <OilProvider>');
  return context;
}
