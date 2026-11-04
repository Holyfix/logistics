// Order Status Matrix: stav každých dveří vozu (Production number) a plánovaná stavba u zákazníka. Slouží jen
// k zobrazení stavu u zakázek v pokrytí; potřeba se bere z JIT Overview.

import { findColumn } from '../csv';
import { dayFromDate } from '../dates';
import { cellText, type Cell } from '../table';
import { MINUTES_PER_DAY, parseStamp, type Door, type Stamp } from './jit';

export interface MatrixOrder {
  productionNumber: string;
  planned: Stamp | null;
  optionType: string;
  /** Stav dveří, např. „20 - Container planned“; prázdné, když ho matice nemá. */
  status: Partial<Record<Door, string>>;
}

export type MatrixResult = { ok: true; value: Map<string, MatrixOrder> } | { ok: false; error: 'missingColumns'; columns: string[] };

const STATUS_COLUMNS: Record<Door, string> = { FL: 'Status FL', FR: 'Status FR', RL: 'Status RL', RR: 'Status RR', HB: 'Status HB' };

function stampOf(cell: Cell | undefined): Stamp | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return dayFromDate(cell) * MINUTES_PER_DAY + cell.getUTCHours() * 60 + cell.getUTCMinutes();
  return parseStamp(cellText(cell));
}

/** Přečte matici: záhlaví je řádek se sloupcem „Production number“ (nad ním titulek a informace o exportu). */
export function parseStatusMatrix(data: readonly Cell[][]): MatrixResult {
  const headerIndex = data.findIndex((row) => row.some((c) => cellText(c).toLowerCase() === 'production number'));
  if (headerIndex === -1) return { ok: false, error: 'missingColumns', columns: ['Production number'] };
  const header = data[headerIndex]!.map((c) => cellText(c));
  const pn = findColumn(header, ['Production number']);
  const planned = findColumn(header, ['Planned customer built', 'Planned customer build']);
  const option = findColumn(header, ['Option Type']);
  const status = Object.fromEntries(Object.entries(STATUS_COLUMNS).map(([door, name]) => [door, findColumn(header, [name])])) as Record<Door, number>;
  const value = new Map<string, MatrixOrder>();
  for (const row of data.slice(headerIndex + 1)) {
    const number = cellText(row[pn]).toUpperCase();
    if (!number) continue;
    const doors: Partial<Record<Door, string>> = {};
    for (const [door, c] of Object.entries(status) as [Door, number][]) if (c !== -1 && cellText(row[c])) doors[door] = cellText(row[c]);
    value.set(number, {
      productionNumber: number,
      planned: planned === -1 ? null : stampOf(row[planned]),
      optionType: option === -1 ? '' : cellText(row[option]),
      status: doors,
    });
  }
  return { ok: true, value };
}

/** Číslo stavu „50 - Packed“ → 50; bez čísla null. */
export function statusCode(status: string): number | null {
  const m = /^\s*(\d+)/.exec(status);
  return m ? Number(m[1]) : null;
}
