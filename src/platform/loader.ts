// Načtení všech dat ze složky: rozpoznání souborů, mezipaměť v prohlížeči, zpracování na pozadí.

import type { CallOffExport } from '../core/calloffs/parse';
import type { CoverageSource } from '../core/coverage/compute';
import type { MasterData } from '../core/masterdata';
import type { StockData } from '../core/stock';
import type { BomData } from '../core/bom';
import { classifyPath, coverageScope, formatOf } from '../core/sources';
import { idbDelete, idbGet, idbKeys, idbSet, STORE_CALLOFFS } from './idb';
import { listFiles, type FolderSource, type SourceFile } from './folder';
import type { ParseRequest, ParseResponse } from './parse.worker';

export interface FailedFile {
  path: string;
  reason: 'missingColumns' | 'unreadable' | 'duplicateWeek' | 'unknownFormat' | 'superseded';
  detail: string;
}

export interface LoadedData {
  folderName: string;
  /** Exporty odvolávek seřazené od nejstaršího. */
  exports: CallOffExport[];
  master: { path: string; data: MasterData } | null;
  /** Soubory pokrytí od zákazníka: pro každou destinaci a projekt nejnovější. */
  coverage: CoverageSource[];
  /** Náš sklad: nejnovější soubor skladu. */
  stock: { path: string; lastModified: number; data: StockData } | null;
  /** Kusovníky (všechny soubory, od nejnovějšího). */
  boms: { path: string; lastModified: number; data: BomData }[];
  failed: FailedFile[];
  loadedAt: number;
}

export interface LoadProgress {
  done: number;
  total: number;
}

// Verze formátu v mezipaměti: při změně zpracování se exporty načtou znovu.
const CACHE_VERSION = 2;
const cacheKey = (f: SourceFile) => `v${CACHE_VERSION}|${f.path}|${f.size}|${f.lastModified}`;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: ParseResponse) => void>();

async function parseInWorker(request: Omit<ParseRequest, 'id' | 'buffer'> & { file: File }): Promise<ParseResponse> {
  // Soubor se čte v hlavním vlákně (čtení je asynchronní) a obsah se předá na pozadí bez kopírování.
  let buffer: ArrayBuffer;
  try {
    buffer = await request.file.arrayBuffer();
  } catch (error) {
    return { id: 0, kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  worker ??= new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  };
  const id = nextId++;
  const { kind, format, name } = request;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, kind, format, name, buffer } satisfies ParseRequest, [buffer]);
  });
}

export async function loadFolder(source: FolderSource, onProgress: (p: LoadProgress) => void): Promise<LoadedData> {
  const files = await listFiles(source);
  const calloffFiles = files.filter((f) => classifyPath(f.path) === 'calloffs');
  const masterFiles = files
    .filter((f) => classifyPath(f.path) === 'masterdata')
    .sort((a, b) => b.lastModified - a.lastModified);
  const stockFiles = files.filter((f) => classifyPath(f.path) === 'stock').sort((a, b) => b.lastModified - a.lastModified);
  const bomFiles = files.filter((f) => classifyPath(f.path) === 'bom').sort((a, b) => b.lastModified - a.lastModified);

  // Coverage: pro každou destinaci a projekt platí naposledy změněný soubor (i z hlubší podsložky).
  const coverageFiles = new Map<string, SourceFile>();
  const failed: FailedFile[] = [];
  // Sklad: platí naposledy změněný soubor, starší se jen vypíšou.
  for (const file of stockFiles.slice(1)) failed.push({ path: file.path, reason: 'superseded', detail: stockFiles[0]!.path });
  for (const file of files.filter((f) => classifyPath(f.path) === 'coverage').sort((a, b) => b.lastModified - a.lastModified)) {
    const { location, project } = coverageScope(file.path);
    const key = `${location}|${project}`;
    const newer = coverageFiles.get(key);
    if (newer) failed.push({ path: file.path, reason: 'superseded', detail: newer.path });
    else coverageFiles.set(key, file);
  }

  const parsed: { file: SourceFile; exp: CallOffExport }[] = [];
  const total = calloffFiles.length + (masterFiles.length > 0 ? 1 : 0) + coverageFiles.size + (stockFiles.length > 0 ? 1 : 0) + bomFiles.length;
  let done = 0;
  onProgress({ done, total });

  for (const file of calloffFiles) {
    const key = cacheKey(file);
    let exp = await idbGet<CallOffExport>(STORE_CALLOFFS, key).catch(() => undefined);
    if (!exp) {
      const response = await parseInWorker({ kind: 'calloffs', format: formatOf(file.path)!, name: file.path.split('/').pop()!, file: file.file });
      if (response.kind === 'calloffs' && response.result.ok) {
        exp = response.result.value;
        await idbSet(STORE_CALLOFFS, key, exp).catch(() => undefined);
      } else if (response.kind === 'calloffs' && !response.result.ok) {
        failed.push({ path: file.path, reason: 'missingColumns', detail: response.result.columns.join(', ') });
      } else if (response.kind === 'error') {
        failed.push({ path: file.path, reason: 'unreadable', detail: response.message });
      }
    }
    if (exp) parsed.push({ file, exp });
    onProgress({ done: ++done, total });
  }

  // Smazat z mezipaměti soubory, které už ve složce nejsou nebo se změnily.
  const keep = new Set(calloffFiles.map(cacheKey));
  for (const key of await idbKeys(STORE_CALLOFFS).catch(() => [])) {
    if (!keep.has(String(key))) await idbDelete(STORE_CALLOFFS, String(key)).catch(() => undefined);
  }

  // Víc souborů pro stejný týden: platí naposledy změněný.
  const byWeek = new Map<number, { file: SourceFile; exp: CallOffExport }>();
  for (const entry of parsed.sort((a, b) => b.file.lastModified - a.file.lastModified)) {
    const existing = byWeek.get(entry.exp.exportDay);
    if (existing) {
      failed.push({ path: entry.file.path, reason: 'duplicateWeek', detail: existing.file.path });
    } else {
      byWeek.set(entry.exp.exportDay, entry);
    }
  }
  const exports = [...byWeek.values()].map((e) => e.exp).sort((a, b) => a.exportDay - b.exportDay);

  let master: LoadedData['master'] = null;
  const masterFile = masterFiles[0];
  if (masterFile) {
    const response = await parseInWorker({ kind: 'masterdata', format: formatOf(masterFile.path)!, name: masterFile.path, file: masterFile.file });
    if (response.kind === 'masterdata' && response.result.ok) master = { path: masterFile.path, data: response.result.value };
    else if (response.kind === 'masterdata' && !response.result.ok)
      failed.push({ path: masterFile.path, reason: 'missingColumns', detail: response.result.columns.join(', ') });
    else if (response.kind === 'error') failed.push({ path: masterFile.path, reason: 'unreadable', detail: response.message });
    onProgress({ done: ++done, total });
  }

  const coverage: CoverageSource[] = [];
  for (const file of coverageFiles.values()) {
    const name = file.path.split('/').pop()!;
    const response = await parseInWorker({ kind: 'coverage', format: 'xlsx', name, file: file.file });
    if (response.kind === 'coverage' && response.result.ok) {
      coverage.push({ path: file.path, fileName: name, ...coverageScope(file.path), lastModified: file.lastModified, report: response.result.value });
    } else if (response.kind === 'coverage') {
      failed.push({ path: file.path, reason: 'unknownFormat', detail: '' });
    } else if (response.kind === 'error') {
      failed.push({ path: file.path, reason: 'unreadable', detail: response.message });
    }
    onProgress({ done: ++done, total });
  }
  coverage.sort((a, b) => a.location.localeCompare(b.location) || a.project.localeCompare(b.project));

  let stock: LoadedData['stock'] = null;
  const stockFile = stockFiles[0];
  if (stockFile) {
    const response = await parseInWorker({ kind: 'stock', format: formatOf(stockFile.path)!, name: stockFile.path, file: stockFile.file });
    if (response.kind === 'stock' && response.result.ok) stock = { path: stockFile.path, lastModified: stockFile.lastModified, data: response.result.value };
    else if (response.kind === 'stock' && !response.result.ok)
      failed.push({ path: stockFile.path, reason: 'missingColumns', detail: response.result.columns.join(', ') });
    else if (response.kind === 'error') failed.push({ path: stockFile.path, reason: 'unreadable', detail: response.message });
    onProgress({ done: ++done, total });
  }

  const boms: LoadedData['boms'] = [];
  for (const file of bomFiles) {
    const response = await parseInWorker({ kind: 'bom', format: formatOf(file.path)!, name: file.path, file: file.file });
    if (response.kind === 'bom' && response.result.ok) boms.push({ path: file.path, lastModified: file.lastModified, data: response.result.value });
    else if (response.kind === 'bom' && !response.result.ok) failed.push({ path: file.path, reason: 'missingColumns', detail: response.result.columns.join(', ') });
    else if (response.kind === 'error') failed.push({ path: file.path, reason: 'unreadable', detail: response.message });
    onProgress({ done: ++done, total });
  }

  return { folderName: source.name, exports, master, coverage, stock, boms, failed, loadedAt: Date.now() };
}
