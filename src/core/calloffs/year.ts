// Výpočty pro pohled „Přehled od začátku roku“: požadavek každého týdne z exportu
// daného týdne a odeslané množství z rozdílu kumulativu odeslaného mezi exporty.

import { isoWeek, mondayOfIsoWeek, weekLabel, type DayNumber } from '../dates';
import type { CallOffExport } from './parse';
import { itemIndex, sumRange } from './views';

export interface YearWeek {
  year: number;
  week: number;
  /** Pondělí týdne. */
  start: DayNumber;
  label: string;
  /** Export, ze kterého je požadavek: vlastní export týdne, nebo poslední starší export, který týden pokrývá. */
  source: CallOffExport | undefined;
  /** Požadavek je z exportu právě tohoto týdne. */
  own: boolean;
  /** Exporty na začátku a na konci týdne pro odeslané množství; null, pokud některý chybí. */
  shipped: readonly [CallOffExport, CallOffExport] | null;
  /** Týden z výhledu aktuálního exportu (po posledním exportu roku). */
  outlook: boolean;
}

export interface YearRow {
  item: string;
  description: string;
  demand: number[];
  /** Odesláno v týdnu; null, pokud to z exportů nejde spočítat. */
  shipped: (number | null)[];
}

/** Roky, pro které jsou načtené exporty, od nejnovějšího. */
export function exportYears(exports: readonly CallOffExport[]): number[] {
  return [...new Set(exports.map((e) => e.year))].sort((a, b) => b - a);
}

/**
 * Týdny roku od prvního do posledního exportu v roce. Za ně se volitelně přidá výhled
 * z posledního exportu roku. Exporty musí být seřazené podle týdne exportu.
 */
export function buildYearWeeks(exports: readonly CallOffExport[], year: number, outlook = 0): YearWeek[] {
  const inYear = exports.filter((e) => e.year === year);
  if (inYear.length === 0) return [];
  const byStart = new Map(exports.map((e) => [e.exportDay, e]));
  const first = mondayOfIsoWeek(year, Math.min(...inYear.map((e) => e.week)));
  const last = mondayOfIsoWeek(year, Math.max(...inYear.map((e) => e.week)));

  const weeks: YearWeek[] = [];
  for (let start = first; start <= last; start += 7) {
    const own = byStart.get(start);
    const source = own ?? exports.findLast((e) => e.exportDay < start && e.lastDay >= start);
    const next = byStart.get(start + 7);
    const shipped = own?.hasCumShipped && next?.hasCumShipped ? ([own, next] as const) : null;
    const { week } = isoWeek(start);
    weeks.push({ year, week, start, label: weekLabel(start), source, own: own !== undefined, shipped, outlook: false });
  }

  const latest = byStart.get(last)!;
  for (let k = 1; k <= outlook; k++) {
    const start = last + k * 7;
    if (start > latest.lastDay) break;
    const iso = isoWeek(start);
    weeks.push({
      year: iso.year,
      week: iso.week,
      start,
      label: weekLabel(start, iso.year !== year),
      source: latest,
      own: false,
      shipped: null,
      outlook: true,
    });
  }
  return weeks;
}

/** Všechny díly z exportů použitých v týdnech, seřazené jako v exportu. */
export function yearItems(weeks: readonly YearWeek[]): { items: string[]; descriptions: string[] } {
  const descriptions = new Map<string, string>();
  const sources = new Set(weeks.flatMap((w) => (w.source ? [w.source] : [])));
  // Novější exporty mají přednost u popisu.
  for (const exp of [...sources].sort((a, b) => b.exportDay - a.exportDay)) {
    exp.items.forEach((item, i) => {
      if (!descriptions.get(item)) descriptions.set(item, exp.descriptions[i]!);
    });
  }
  const items = [...descriptions.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return { items, descriptions: items.map((item) => descriptions.get(item)!) };
}

function shippedOf(pair: readonly [CallOffExport, CallOffExport], item: string): number | null {
  const [from, to] = pair;
  const a = itemIndex(from, item);
  const b = itemIndex(to, item);
  if (a < 0 && b < 0) return 0;
  if (a < 0 || b < 0) return null;
  const diff = to.cumShipped[b]! - from.cumShipped[a]!;
  // Pokles kumulativu znamená jeho vynulování nebo změnu zakázky; množství pak neznáme.
  return diff < 0 ? null : diff;
}

export function buildYearRows(weeks: readonly YearWeek[], items: readonly string[], descriptions: readonly string[]): YearRow[] {
  return items.map((item, i) => ({
    item,
    description: descriptions[i] ?? '',
    demand: weeks.map((w) => (w.source ? sumRange(w.source, itemIndex(w.source, item), w.start, w.start + 6) : 0)),
    shipped: weeks.map((w) => (w.shipped ? shippedOf(w.shipped, item) : null)),
  }));
}

export interface YearTotals {
  demand: number[];
  /** Součet známých hodnot; null pro týden, kde odeslané množství nejde spočítat. */
  shipped: (number | null)[];
}

export function yearTotals(weeks: readonly YearWeek[], rows: readonly YearRow[]): YearTotals {
  return {
    demand: weeks.map((_, k) => rows.reduce((sum, r) => sum + r.demand[k]!, 0)),
    shipped: weeks.map((w, k) => (w.shipped ? rows.reduce((sum, r) => sum + (r.shipped[k] ?? 0), 0) : null)),
  };
}

/** Plnění (odesláno / požadováno) za týdny, kde je odeslané množství známé; null bez požadavku. */
export function fulfillment(demand: readonly number[], shipped: readonly (number | null)[]): number | null {
  let d = 0;
  let s = 0;
  shipped.forEach((v, k) => {
    if (v === null) return;
    d += demand[k]!;
    s += v;
  });
  return d > 0 ? (s / d) * 100 : null;
}
