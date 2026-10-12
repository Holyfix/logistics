// Výpočty pro pohled „Porovnání exportů“: dva exporty proti sobě a vývoj požadavku napříč exporty.

import { isoWeek, mondayOf, weekLabel } from '../dates';
import type { CallOffExport } from './parse';
import { itemIndex, sumRange, type Period, type PeriodCount } from './views';

/** Export pokrývá období, pokud se jeho horizont s obdobím aspoň částečně překrývá. */
export function covers(exp: CallOffExport, period: Period): boolean {
  return period.end >= exp.firstDay && period.start <= exp.lastDay;
}

/**
 * Týdny, které obsahují oba exporty: od týdne prvního dne novějšího exportu
 * do konce kratšího horizontu. Týdny z jiného roku než novější export mají v popisku rok.
 */
export function comparePeriods(older: CallOffExport, newer: CallOffExport, count: PeriodCount): Period[] {
  const limit = count === 'all' ? Infinity : count;
  const first = mondayOf(Math.max(older.firstDay, newer.firstDay));
  const last = Math.min(older.lastDay, newer.lastDay);
  const periods: Period[] = [];
  for (let start = first; start <= last && periods.length < limit; start += 7) {
    periods.push({ start, end: start + 6, label: weekLabel(start, isoWeek(start).year !== newer.year) });
  }
  return periods;
}

/** Díly z obou exportů (seřazené); popis z novějšího exportu, chybí-li, ze staršího. */
export function compareItems(older: CallOffExport, newer: CallOffExport): { items: string[]; descriptions: string[] } {
  const descriptions = new Map<string, string>();
  for (const exp of [newer, older]) {
    exp.items.forEach((item, i) => {
      if (!descriptions.get(item)) descriptions.set(item, exp.descriptions[i]!);
    });
  }
  const items = [...descriptions.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return { items, descriptions: items.map((item) => descriptions.get(item)!) };
}

export interface CompareRow {
  item: string;
  description: string;
  older: number[];
  newer: number[];
  olderTotal: number;
  newerTotal: number;
  diff: number;
  /** Změna v %; null, pokud starší export měl nulu. */
  percent: number | null;
}

/** Řádky po dílech, seřazené podle velikosti změny (největší nahoře). */
export function buildCompareRows(
  older: CallOffExport,
  newer: CallOffExport,
  items: readonly string[],
  descriptions: readonly string[],
  periods: readonly Period[],
): CompareRow[] {
  const rows = items.map((item, i) => {
    const a = itemIndex(older, item);
    const b = itemIndex(newer, item);
    const olderValues = periods.map((p) => sumRange(older, a, p.start, p.end));
    const newerValues = periods.map((p) => sumRange(newer, b, p.start, p.end));
    const olderTotal = olderValues.reduce((x, y) => x + y, 0);
    const newerTotal = newerValues.reduce((x, y) => x + y, 0);
    const diff = newerTotal - olderTotal;
    return {
      item,
      description: descriptions[i] ?? '',
      older: olderValues,
      newer: newerValues,
      olderTotal,
      newerTotal,
      diff,
      percent: olderTotal === 0 ? null : (diff / olderTotal) * 100,
    };
  });
  return rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.item.localeCompare(y.item, 'en', { numeric: true }));
}

export interface Matrix {
  /** Řádky: exporty od nejstaršího po zvolený novější. */
  exports: CallOffExport[];
  /** Sloupce: týdny dodání od týdne novějšího exportu. */
  periods: Period[];
  /** Součet požadavku dílů; null, když export týden nepokrývá. */
  values: (number | null)[][];
}

/**
 * Vývoj odvolávek: jak se s každým exportem měnil požadavek na stejné týdny dodání.
 * Exporty musí být seřazené podle týdne exportu.
 */
export function buildMatrix(
  exports: readonly CallOffExport[],
  newer: CallOffExport,
  items: readonly string[],
  rowCount = 10,
  weekCount = 10,
): Matrix {
  const end = exports.indexOf(newer);
  const rows = exports.slice(Math.max(0, end - rowCount + 1), end + 1);
  const periods: Period[] = [];
  const first = mondayOf(newer.firstDay);
  for (let k = 0; k < weekCount; k++) {
    const start = first + k * 7;
    if (start > newer.lastDay) break;
    periods.push({ start, end: start + 6, label: weekLabel(start, isoWeek(start).year !== newer.year) });
  }
  const values = rows.map((exp) => {
    const indexes = items.map((item) => itemIndex(exp, item)).filter((i) => i >= 0);
    return periods.map((p) => (covers(exp, p) ? indexes.reduce((sum, i) => sum + sumRange(exp, i, p.start, p.end), 0) : null));
  });
  return { exports: rows, periods, values };
}
