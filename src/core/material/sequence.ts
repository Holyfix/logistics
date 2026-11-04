// Soubory ze složky Sekvence: Order Status Matrix, klíč MC/MF (Excel nebo CSV) a JIT Overview (CSV). Druh se pozná
// podle obsahu.

import { parseCsv } from '../csv';
import type { Cell } from '../table';
import { parseJit, type JitPosition } from './jit';
import { parseStatusMatrix, type MatrixOrder } from './matrix';
import { parsePartKey, type PartKey } from './partKey';

export type SequenceFile =
  | { type: 'jit'; positions: JitPosition[] }
  | { type: 'matrix'; orders: Map<string, MatrixOrder> }
  | { type: 'key'; key: PartKey }
  | { type: 'unknown' };

/** Matice má sloupce stavu dveří; jinak by se za ni mohl považovat i jiný soubor se sloupcem Production number. */
const isMatrix = (data: readonly Cell[][]) => data.some((row) => row.some((c) => typeof c === 'string' && /^status (fl|fr|rl|rr|hb)$/i.test(c.trim())));

function matrixOf(data: readonly Cell[][]): SequenceFile | null {
  const matrix = parseStatusMatrix(data);
  if (matrix.ok && isMatrix(data)) return { type: 'matrix', orders: matrix.value };
  const key = parsePartKey(data);
  return key.ok && key.value.entries.size > 0 ? { type: 'key', key: key.value } : null;
}

/** CSV: JIT Overview, jinak Order Status Matrix nebo klíč MC/MF. */
export function parseSequenceCsv(text: string): SequenceFile {
  const jit = parseJit(text);
  if (jit.ok) return { type: 'jit', positions: jit.value };
  const table = parseCsv(text);
  return matrixOf([table.header, ...table.rows]) ?? { type: 'unknown' };
}

/** Excel: první list s Order Status Matrix nebo klíčem MC/MF. */
export function parseSequenceSheets(sheets: readonly (readonly Cell[][])[]): SequenceFile {
  for (const data of sheets) {
    const matrix = matrixOf(data);
    if (matrix) return matrix;
  }
  return { type: 'unknown' };
}
