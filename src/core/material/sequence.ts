// Soubory ze složky Sekvence: Order Status Matrix a klíč MC/MF (Excel nebo CSV). Druh se pozná podle obsahu.

import { parseCsv } from '../csv';
import type { Cell } from '../table';
import { parseStatusMatrix, type MatrixOrder } from './matrix';
import { parsePartKey, type PartKey } from './partKey';

export type SequenceFile = { type: 'matrix'; orders: Map<string, MatrixOrder> } | { type: 'key'; key: PartKey } | { type: 'unknown' };

/** Matice má sloupce stavu dveří; jinak by se za ni mohl považovat i jiný soubor se sloupcem Production number. */
const isMatrix = (data: readonly Cell[][]) => data.some((row) => row.some((c) => typeof c === 'string' && /^status (fl|fr|rl|rr|hb)$/i.test(c.trim())));

function sequenceOf(data: readonly Cell[][]): SequenceFile | null {
  const matrix = parseStatusMatrix(data);
  if (matrix.ok && isMatrix(data)) return { type: 'matrix', orders: matrix.value };
  const key = parsePartKey(data);
  return key.ok && (key.value.entries.size > 0 || key.value.conflicts.size > 0) ? { type: 'key', key: key.value } : null;
}

/** CSV: Order Status Matrix nebo klíč MC/MF. */
export function parseSequenceCsv(text: string): SequenceFile {
  const table = parseCsv(text);
  return sequenceOf([table.header, ...table.rows]) ?? { type: 'unknown' };
}

/** Excel: první list s Order Status Matrix nebo klíčem MC/MF. */
export function parseSequenceSheets(sheets: readonly (readonly Cell[][])[]): SequenceFile {
  for (const data of sheets) {
    const found = sequenceOf(data);
    if (found) return found;
  }
  return { type: 'unknown' };
}
