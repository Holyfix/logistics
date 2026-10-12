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
const MAX_DEPTH = 3;

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
