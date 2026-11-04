// Načtení exportů pro pokrytí materiálu: Order Status Matrix, JIT Overview a kusovníky (Excel nebo CSV). Druh souboru se
// pozná podle obsahu (sloupců), ne podle názvu. Ručně zadaný sklad se pamatuje v prohlížeči.

import { mergeBoms, parseBom, type BomData } from '../core/bom';
import { parseCsv } from '../core/csv';
import { parseJit, type JitPosition } from '../core/material/jit';
import { parseStatusMatrix, type MatrixOrder } from '../core/material/matrix';
import type { Cell } from '../core/table';
import { decodeText } from '../core/text';

export type MaterialFile =
  | { kind: 'jit'; name: string; positions: JitPosition[] }
  | { kind: 'matrix'; name: string; orders: Map<string, MatrixOrder> }
  | { kind: 'bom'; name: string; bom: BomData }
  | { kind: 'unknown'; name: string };

/** Matice má sloupce stavu dveří; jinak by se za ni mohl považovat i jiný soubor se sloupcem Production number. */
const isMatrix = (data: readonly Cell[][]) => data.some((row) => row.some((c) => typeof c === 'string' && /^status (fl|fr|rl|rr|hb)$/i.test(c.trim())));

/** Rozpozná a načte jeden soubor. */
export async function readMaterialFile(file: File): Promise<MaterialFile> {
  const name = file.name;
  const buffer = await file.arrayBuffer();
  if (/\.(csv|txt)$/i.test(name)) {
    const text = decodeText(buffer);
    const jit = parseJit(text);
    if (jit.ok) return { kind: 'jit', name, positions: jit.value };
    // Matice i kusovník můžou být i v CSV.
    const table = parseCsv(text);
    const rows = [table.header, ...table.rows];
    const matrix = parseStatusMatrix(rows);
    if (matrix.ok && isMatrix(rows)) return { kind: 'matrix', name, orders: matrix.value };
    const bom = parseBom(rows);
    return bom.ok ? { kind: 'bom', name, bom: bom.value } : { kind: 'unknown', name };
  }
  if (!/\.xlsx$/i.test(name)) return { kind: 'unknown', name };
  const { default: readXlsxFile } = await import('read-excel-file/universal');
  const sheets = (await readXlsxFile(buffer)).map((s) => s.data as Cell[][]);
  for (const data of sheets) {
    const matrix = parseStatusMatrix(data);
    if (matrix.ok && isMatrix(data)) {
      return { kind: 'matrix', name, orders: matrix.value };
    }
  }
  const boms = sheets.map((data) => parseBom(data)).flatMap((r) => (r.ok ? [r.value] : []));
  return boms.length > 0 ? { kind: 'bom', name, bom: mergeBoms(boms) } : { kind: 'unknown', name };
}

const STOCK_KEY = 'material-stock';

export interface SavedStock {
  items: Record<string, number>;
  /** Kdy byl sklad naposledy změněný (ISO). */
  at: string | null;
}

export function loadStock(): SavedStock {
  try {
    const saved = JSON.parse(localStorage.getItem(STOCK_KEY) ?? 'null') as SavedStock | null;
    if (saved && typeof saved.items === 'object') return saved;
  } catch {
    // Úložiště může být zakázané nebo poškozené; začne se s prázdným skladem.
  }
  return { items: {}, at: null };
}

export function saveStock(stock: SavedStock): void {
  try {
    localStorage.setItem(STOCK_KEY, JSON.stringify(stock));
  } catch {
    // Sklad se jen nezapamatuje.
  }
}
