// Tabulka načtená z CSV nebo Excelu a pomocné funkce pro čtení buněk.

import { dayFromDate, parseDay, type DayNumber } from './dates';
import { parseNumber } from './numbers';

export type Cell = string | number | boolean | Date | null;

export interface DataTable {
  header: string[];
  rows: Cell[][];
}

/** Problém v datech, který uživateli ukážeme v modulu Data. Řádek je číslo řádku v souboru (hlavička = 1). */
export interface DataIssue {
  row: number;
  column?: string;
  value?: string;
  message: 'missingValue' | 'invalidNumber' | 'invalidDate' | 'unknownSide' | 'unknownKind' | 'duplicateItem' | 'duplicateCustomerNumber' | 'weekMismatch';
}

export const MAX_ISSUES = 100;

export function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

export function cellNumber(cell: Cell | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'string') return parseNumber(cell);
  return null;
}

export function cellDay(cell: Cell | undefined): DayNumber | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : dayFromDate(cell);
  if (typeof cell === 'string') return parseDay(cell);
  return null;
}
