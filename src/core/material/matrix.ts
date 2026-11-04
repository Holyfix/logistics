// Order Status Matrix: vozy (Production number) s plánovanou stavbou u zákazníka a stavem každých dveří. Z ní se
// skládá pokrytí materiálu (vozy v pořadí matice); JIT Overview jen doplní dveřní panel.

import { findColumn } from '../csv';
import { dayFromDate } from '../dates';
import { cellText, type Cell } from '../table';
import { MINUTES_PER_DAY, parseStamp, type Door, type Stamp } from './jit';

export interface MatrixOrder {
  lot: string;
  productionNumber: string;
  planned: Stamp | null;
  optionType: string;
  /** Barvy Maincarrieru a Middlefieldu, jak je matice uvádí (např. „9K82 / 9H15“). */
  colors: string;
  /** Stav dveří, např. „20 - Container planned“; prázdné, když ho matice nemá. */
  status: Partial<Record<Door, string>>;
}

export type MatrixResult = { ok: true; value: Map<string, MatrixOrder> } | { ok: false; error: 'missingColumns'; columns: string[] };

const STATUS_COLUMNS: Record<Door, string> = { FL: 'Status FL', FR: 'Status FR', RL: 'Status RL', RR: 'Status RR', HB: 'Status HB' };

/** Pořadové číslo dne 1. 1. 1970 v Excelu (dny od 30. 12. 1899). */
const EXCEL_EPOCH = 25569;

/** Datum a čas z buňky: datum, pořadové číslo Excelu (když buňka nemá formát data) nebo text. */
function stampOf(cell: Cell | undefined): Stamp | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return dayFromDate(cell) * MINUTES_PER_DAY + cell.getUTCHours() * 60 + cell.getUTCMinutes();
  if (typeof cell === 'number' && cell > EXCEL_EPOCH - 36525) return Math.round((cell - EXCEL_EPOCH) * MINUTES_PER_DAY);
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
  const lot = findColumn(header, ['Lot']);
  const colors = findColumn(header, ['MC / MF', 'MC/MF']);
  const status = Object.fromEntries(Object.entries(STATUS_COLUMNS).map(([door, name]) => [door, findColumn(header, [name])])) as Record<Door, number>;
  const value = new Map<string, MatrixOrder>();
  for (const row of data.slice(headerIndex + 1)) {
    const number = cellText(row[pn]).toUpperCase();
    if (!number) continue;
    const doors: Partial<Record<Door, string>> = {};
    for (const [door, c] of Object.entries(status) as [Door, number][]) if (c !== -1 && cellText(row[c])) doors[door] = cellText(row[c]);
    value.set(number, {
      lot: lot === -1 ? '' : cellText(row[lot]),
      productionNumber: number,
      planned: planned === -1 ? null : stampOf(row[planned]),
      optionType: option === -1 ? '' : cellText(row[option]),
      colors: colors === -1 ? '' : cellText(row[colors]),
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
