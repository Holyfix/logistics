// Přístup ke sdílené složce: uložená složka (Edge, Chrome) nebo jednorázový výběr souborů (ostatní prohlížeče).

import { idbGet, idbSet, STORE_KV } from './idb';

export interface SourceFile {
  /** Cesta relativně ke zvolené složce, oddělovač „/“. */
  path: string;
  size: number;
  lastModified: number;
  file: File;
}

export type FolderSource =
  | { kind: 'handle'; name: string; handle: FileSystemDirectoryHandle }
  | { kind: 'files'; name: string; files: SourceFile[] };

const HANDLE_KEY = 'folder';
/**
 * Kolik úrovní složek se prohledá (kořen = 1). Coverage má soubory ve 4. úrovni
 * (Coverage/<destinace>/<projekt>/soubor); rezerva pro případ, že je vybraná nadřazená složka.
 */
export const MAX_DEPTH = 6;

export function canPickDirectory(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FolderSource> {
  const handle = await window.showDirectoryPicker!({ id: 'logistics-data', mode: 'read' });
  await idbSet(STORE_KV, HANDLE_KEY, handle);
  return { kind: 'handle', name: handle.name, handle };
}

export async function storedDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await idbGet<FileSystemDirectoryHandle>(STORE_KV, HANDLE_KEY);
  } catch {
    return undefined;
  }
}

/** Stav oprávnění ke složce: granted = lze číst, prompt = je potřeba kliknout na „Povolit“. */
export async function permissionOf(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
}

/** Požádá o oprávnění. Musí být volané z kliknutí uživatele. */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return ((await handle.requestPermission?.({ mode: 'read' })) ?? 'granted') === 'granted';
}

/** Soubory vybrané přes <input webkitdirectory> (prohlížeče bez File System Access API). */
export function filesSource(list: FileList): FolderSource {
  const files: SourceFile[] = [...list].map((file) => {
    const relative = file.webkitRelativePath || file.name;
    // Cesta bez názvu kořenové složky.
    const path = relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : relative;
    return { path, size: file.size, lastModified: file.lastModified, file };
  });
  const first = list[0]?.webkitRelativePath ?? '';
  return { kind: 'files', name: first.split('/')[0] || '', files };
}

export async function listFiles(source: FolderSource): Promise<SourceFile[]> {
  if (source.kind === 'files') return source.files;
  const result: SourceFile[] = [];
  async function walk(dir: FileSystemDirectoryHandle, prefix: string, depth: number) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        const file = await (entry as FileSystemFileHandle).getFile();
        result.push({ path: prefix + entry.name, size: file.size, lastModified: file.lastModified, file });
      } else if (depth < MAX_DEPTH) {
        await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`, depth + 1);
      }
    }
  }
  await walk(source.handle, '', 1);
  return result;
}

export type SaveResult =
  | { status: 'saved'; path: string; lastModified: number }
  | { status: 'conflict'; path: string; lastModified: number }
  | { status: 'denied' }
  /** Systém soubor nedovolil přepsat (otevřený v Excelu, synchronizace OneDrive, jen právo čtení). */
  | { status: 'locked'; path: string }
  | { status: 'downloaded' };

/** Chyby zápisu, kdy soubor nejde přepsat kvůli stavu souborového systému (zámek, jen pro čtení). */
const LOCKED_ERRORS = new Set(['NoModificationAllowedError', 'InvalidStateError']);

/** Kolikrát zkusit zápis znovu, když je soubor dočasně zamčený (např. OneDrive ho právě synchronizuje). */
const WRITE_ATTEMPTS = 3;
const RETRY_MS = 800;

/** Povolí zápis do složky (aplikace ji jinak jen čte). Musí být volané z kliknutí uživatele. */
export async function requestWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
  return ((await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
}

/**
 * Zapíše soubor na cestu relativně ke složce (chybějící podsložky vytvoří). `expected` je čas změny souboru,
 * jak byl načtený (null = soubor nebyl); když ho mezitím změnil někdo jiný, vrátí `conflict` a nic nezapíše,
 * pokud není `force`. Když systém soubor nedovolí přepsat (zámek), zkusí to ještě dvakrát a pak vrátí `locked`.
 */
export async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  blob: Blob,
  expected: number | null,
  force = false,
): Promise<SaveResult> {
  const parts = path.split('/');
  const name = parts.pop()!;
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  let existing: number | null;
  try {
    existing = (await (await dir.getFileHandle(name)).getFile()).lastModified;
  } catch {
    existing = null;
  }
  if (!force && existing !== null && (expected === null || existing > expected)) return { status: 'conflict', path, lastModified: existing };
  const file = await dir.getFileHandle(name, { create: true });
  for (let attempt = 1; ; attempt++) {
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: 'saved', path, lastModified: (await file.getFile()).lastModified };
    } catch (error) {
      await writable?.abort().catch(() => undefined);
      if (!(error instanceof DOMException) || !LOCKED_ERRORS.has(error.name)) throw error;
      if (attempt >= WRITE_ATTEMPTS) return { status: 'locked', path };
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}
