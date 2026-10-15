import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OilList } from '../../core/oil';
import type { LoadedData } from '../../platform/loader';
import { useData } from '../data/DataProvider';

/** Jak často se kontroluje, jestli někdo jiný neuložil novější OIL (a při návratu do okna). */
export const OIL_CHECK_MS = 30_000;

type SavedOil = NonNullable<LoadedData['oil']>;

/** Neuložené změny OIL. Zůstanou i při přechodu do jiného modulu; nové načtení složky je zahodí. */
interface OilContextValue {
  draft: OilList | null;
  setDraft: (list: OilList | null) => void;
  /** Novější OIL ve složce (uložil ho někdo jiný), který se nenačetl, protože tu jsou neuložené změny. */
  remote: SavedOil | null;
  /** Načte novější OIL ze složky a zahodí neuložené změny. */
  acceptRemote: () => void;
}

const OilContext = createContext<OilContextValue | null>(null);

/**
 * Drží neuložené změny OIL a hlídá složku: když někdo jiný uloží novější OIL, načte ho (bez neuložených změn
 * hned, jinak nabídne v modulu OIL).
 */
export function OilProvider({ children }: { children: ReactNode }) {
  const { state, checkOil, updateData } = useData();
  const loadedAt = state.data?.loadedAt ?? 0;
  const [stored, setStored] = useState<{ draft: OilList | null; remote: SavedOil | null; loadedAt: number }>({ draft: null, remote: null, loadedAt });
  const current = stored.loadedAt === loadedAt ? stored : { draft: null, remote: null, loadedAt };
  const { draft, remote } = current;
  const setDraft = useCallback((list: OilList | null) => setStored((s) => ({ draft: list, remote: list === null ? null : s.loadedAt === loadedAt ? s.remote : null, loadedAt })), [loadedAt]);

  const hasDraft = useRef(false);
  useEffect(() => {
    hasDraft.current = draft !== null;
  }, [draft]);

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const newer = await checkOil();
        if (!newer) return;
        if (hasDraft.current) setStored((s) => ({ ...s, remote: newer, loadedAt }));
        else updateData((d) => ({ ...d, oil: newer }));
      } catch {
        // Kontrola je jen pomocná; při chybě se zkusí příště.
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void check(), OIL_CHECK_MS);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [ready, checkOil, updateData, loadedAt]);

  const acceptRemote = useCallback(() => {
    if (!remote) return;
    updateData((d) => ({ ...d, oil: remote }));
    setStored({ draft: null, remote: null, loadedAt });
  }, [remote, updateData, loadedAt]);

  const value = useMemo(() => ({ draft, setDraft, remote, acceptRemote }), [draft, setDraft, remote, acceptRemote]);
  return <OilContext.Provider value={value}>{children}</OilContext.Provider>;
}

export function useOilDraft(): OilContextValue {
  const context = useContext(OilContext);
  if (!context) throw new Error('useOilDraft musí být uvnitř <OilProvider>');
  return context;
}

/** Neuložený OIL pro přehledy (rozcestník, Dashboard); mimo <OilProvider> null. */
export function useOilDraftList(): OilList | null {
  return useContext(OilContext)?.draft ?? null;
}
