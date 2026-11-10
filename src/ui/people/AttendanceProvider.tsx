import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AttendanceData } from '../../core/attendance';
import { useData } from '../data/DataProvider';

/** Po jaké době se odemčená docházka sama zamkne. */
export const AUTO_LOCK_MS = 30 * 60 * 1000;

export interface Unlocked {
  data: AttendanceData;
  /** Soubory, které nejsou šifrované (upozornění). */
  plainFiles: string[];
}

interface Value {
  unlocked: Unlocked | null;
  setUnlocked: (value: Unlocked | null) => void;
}

const Context = createContext<Value | null>(null);

/**
 * Odemčená docházka jen v paměti: zůstane při přechodu mezi moduly, zamkne se tlačítkem, po 30 minutách
 * nebo novým načtením složky. Nic se neukládá do prohlížeče ani do souboru.
 */
export function AttendanceProvider({ children }: { children: ReactNode }) {
  const { state } = useData();
  const loadedAt = state.data?.loadedAt ?? 0;
  const [stored, setStored] = useState<{ value: Unlocked | null; loadedAt: number }>({ value: null, loadedAt });
  const unlocked = stored.loadedAt === loadedAt ? stored.value : null;
  const setUnlocked = useCallback((value: Unlocked | null) => setStored({ value, loadedAt }), [loadedAt]);
  useEffect(() => {
    if (!unlocked) return;
    const timer = setTimeout(() => setStored((s) => ({ ...s, value: null })), AUTO_LOCK_MS);
    return () => clearTimeout(timer);
  }, [unlocked]);
  const value = useMemo(() => ({ unlocked, setUnlocked }), [unlocked, setUnlocked]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAttendance(): Value {
  const context = useContext(Context);
  if (!context) throw new Error('useAttendance musí být uvnitř <AttendanceProvider>');
  return context;
}

/** Je docházka odemčená (pro rozcestník); mimo Provider false. */
export function useAttendanceUnlocked(): boolean {
  return !!useContext(Context)?.unlocked;
}
