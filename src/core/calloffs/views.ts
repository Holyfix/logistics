// Výpočty pro pohled „Aktuální odvolávky“.

import { isoWeek, mondayOf, weekLabel, weekday, type DayNumber } from '../dates';
import type { CallOffExport } from './parse';

export type Granularity = 'day' | 'week';

export interface Period {
  /** První den období (pro týden pondělí). */
  start: DayNumber;
  /** Poslední den období včetně. */
  end: DayNumber;
  label: string;
}

const indexCache = new WeakMap<CallOffExport, Map<string, number>>();

export function itemIndex(exp: CallOffExport, item: string): number {
  let map = indexCache.get(exp);
  if (!map) {
    map = new Map(exp.items.map((it, i) => [it, i]));
    indexCache.set(exp, map);
  }
  return map.get(item) ?? -1;
}

/** Součet požadavku dílu v rozmezí dnů (včetně). */
export function sumRange(exp: CallOffExport, index: number, from: DayNumber, to: DayNumber): number {
  if (index < 0) return 0;
  let sum = 0;
  for (let k = exp.offsets[index]!; k < exp.offsets[index + 1]!; k++) {
    const day = exp.days[k]!;
    if (day > to) break;
    if (day >= from) sum += exp.qty[k]!;
  }
  return sum;
}

/** Dny, na které připadá aspoň nějaký požadavek. */
function daysWithDemand(exp: CallOffExport): Set<DayNumber> {
  return new Set(exp.days);
}

/** Počet období v tabulce, nebo celý horizont exportu. */
export type PeriodCount = number | 'all';

/**
 * Období pro tabulku: týdny od týdne exportu, nebo dny od prvního dne exportu.
 * Víkendy se zobrazí jen tehdy, když na ně připadá požadavek.
 * Týdny z jiného roku, než je rok exportu, mají v popisku i rok (CW 1/2027).
 */
export function buildPeriods(exp: CallOffExport, granularity: Granularity, count: PeriodCount): Period[] {
  const limit = count === 'all' ? Infinity : count;
  const periods: Period[] = [];
  if (granularity === 'week') {
    const start = mondayOf(exp.firstDay);
    for (let i = 0; i < limit; i++) {
      const s = start + i * 7;
      if (s > exp.lastDay) break;
      periods.push({ start: s, end: s + 6, label: weekLabel(s, isoWeek(s).year !== exp.year) });
    }
    return periods;
  }
  const withDemand = daysWithDemand(exp);
  for (let day = exp.firstDay; periods.length < limit && day <= exp.lastDay; day++) {
    if (weekday(day) >= 6 && !withDemand.has(day)) continue;
    periods.push({ start: day, end: day, label: '' });
  }
  return periods;
}

export interface CurrentRow {
  item: string;
  description: string;
  values: number[];
  /** Hodnota ze staršího exportu; null, pokud starší export do období vůbec nezasahuje nebo neexistuje. */
  previous: (number | null)[];
  total: number;
  backlog: number;
}

export function buildCurrentRows(
  current: CallOffExport,
  previous: CallOffExport | undefined,
  items: readonly string[],
  periods: readonly Period[],
): CurrentRow[] {
  return items.map((item) => {
    const i = itemIndex(current, item);
    const p = previous ? itemIndex(previous, item) : -1;
    const values = periods.map((period) => sumRange(current, i, period.start, period.end));
    const prevValues = periods.map((period) =>
      previous && period.end >= previous.firstDay && period.start <= previous.lastDay
        ? sumRange(previous, p, period.start, period.end)
        : null,
    );
    return {
      item,
      description: i >= 0 ? current.descriptions[i]! : '',
      values,
      previous: prevValues,
      total: values.reduce((a, b) => a + b, 0),
      backlog: i >= 0 ? current.backlog[i]! : 0,
    };
  });
}

export interface Change {
  diff: number;
  /** Změna v procentech; null, pokud předchozí hodnota byla 0. */
  percent: number | null;
  significant: boolean;
}

/** Změna proti předchozímu exportu. Významná je od prahu (v %) nebo nový požadavek tam, kde byla nula. */
export function changeOf(value: number, previous: number | null, thresholdPercent = 20): Change | null {
  if (previous === null || value === previous) return null;
  const diff = value - previous;
  const percent = previous === 0 ? null : (diff / previous) * 100;
  return { diff, percent, significant: percent === null || Math.abs(percent) >= thresholdPercent };
}
