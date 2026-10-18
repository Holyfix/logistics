import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  canPickDirectory,
  filesSource,
  permissionOf,
  pickDirectory,
  requestPermission,
  requestWrite,
  storedDirectory,
  writeFile,
  type FolderSource,
  type SaveResult,
} from '../../platform/folder';
import { downloadBlob } from '../../platform/download';
import { loadFolder, type LoadedData, type LoadProgress } from '../../platform/loader';

export type DataStatus = 'checking' | 'noFolder' | 'needsPermission' | 'loading' | 'ready' | 'error';

export interface DataState {
  status: DataStatus;
  folderName: string;
  progress: LoadProgress | null;
  data: LoadedData | null;
  error: string;
}

interface DataContextValue {
  state: DataState;
  chooseFolder: () => Promise<void>;
  chooseFiles: (files: FileList) => Promise<void>;
  grantPermission: () => Promise<void>;
  reload: () => Promise<void>;
  /**
   * Uloží soubor do vybrané složky (cesta relativně ke složce). Bez přístupu ke složce (jiný prohlížeč) se soubor
   * stáhne. `expected` = čas změny souboru při načtení (null = nový soubor), `force` = přepsat i změněný soubor.
   */
  saveFile: (path: string, build: () => Promise<Blob>, expected: number | null, force?: boolean) => Promise<SaveResult>;
  /** Změní načtená data bez nového načtení složky (např. po uložení plánu). */
  updateData: (update: (data: LoadedData) => LoadedData) => void;
  rememberFolder: boolean;
}

const DataContext = createContext<DataContextValue | null>(null);

const INITIAL: DataState = { status: 'checking', folderName: '', progress: null, data: null, error: '' };

/** `initial` slouží pro testy: data se nenačítají ze složky. */
export function DataProvider({ children, initial }: { children: ReactNode; initial?: DataState }) {
  const [state, setState] = useState<DataState>(initial ?? INITIAL);
  const source = useRef<FolderSource | null>(null);
  const pendingHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const rememberFolder = canPickDirectory();

  const load = useCallback(async (next: FolderSource) => {
    source.current = next;
    setState((s) => ({ ...s, status: 'loading', folderName: next.name, progress: null, error: '' }));
    try {
      const data = await loadFolder(next, (progress) => setState((s) => ({ ...s, progress })));
      setState((s) => ({ ...s, status: 'ready', data, progress: null }));
    } catch (error) {
      setState((s) => ({ ...s, status: 'error', progress: null, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      const handle = rememberFolder ? await storedDirectory() : undefined;
      if (cancelled) return;
      if (!handle) {
        setState((s) => ({ ...s, status: 'noFolder' }));
        return;
      }
      if ((await permissionOf(handle)) === 'granted') {
        await load({ kind: 'handle', name: handle.name, handle });
      } else {
        pendingHandle.current = handle;
        setState((s) => ({ ...s, status: 'needsPermission', folderName: handle.name }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, rememberFolder, initial]);

  const chooseFolder = useCallback(async () => {
    try {
      await load(await pickDirectory());
    } catch (error) {
      // Zavření dialogu bez výběru není chyba.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState((s) => ({ ...s, status: 'error', error: error instanceof Error ? error.message : String(error) }));
    }
  }, [load]);

  const chooseFiles = useCallback((files: FileList) => load(filesSource(files)), [load]);

  const grantPermission = useCallback(async () => {
    const handle = pendingHandle.current;
    if (handle && (await requestPermission(handle))) await load({ kind: 'handle', name: handle.name, handle });
  }, [load]);

  const reload = useCallback(async () => {
    if (source.current) await load(source.current);
  }, [load]);

  const saveFile = useCallback(async (path: string, build: () => Promise<Blob>, expected: number | null, force = false): Promise<SaveResult> => {
    const current = source.current;
    if (current?.kind !== 'handle') {
      downloadBlob(path.split('/').pop()!, await build());
      return { status: 'downloaded', path };
    }
    // Oprávnění se musí vyžádat hned po kliknutí, dřív než se soubor sestaví.
    if (!(await requestWrite(current.handle))) return { status: 'denied' };
    return writeFile(current.handle, path, await build(), expected, force);
  }, []);

  const updateData = useCallback((update: (data: LoadedData) => LoadedData) => {
    setState((s) => (s.data ? { ...s, data: update(s.data) } : s));
  }, []);

  const value = useMemo(
    () => ({ state, chooseFolder, chooseFiles, grantPermission, reload, saveFile, updateData, rememberFolder }),
    [state, chooseFolder, chooseFiles, grantPermission, reload, saveFile, updateData, rememberFolder],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData musí být uvnitř <DataProvider>');
  return context;
}
