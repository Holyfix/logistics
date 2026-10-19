// Rozbor KPI: body mimo cíl za období s detaily a co se opakuje (projekt, díl, osoba, příčina).

import { weekday, type DayNumber } from './dates';
import { entryOf, kpiStatus, kpiValue, LETTERS, letterStatus, type KpiData, type KpiDef, type KpiDetail, type KpiStatus, type Letter } from './kpi';
import { ownerNames } from './oil';

export interface NokPoint {
  day: DayNumber;
  def: KpiDef;
  value: number;
  status: 'yellow' | 'red';
  details: KpiDetail[];
}

export interface NokFilter {
  letter: Letter | '';
  kpiId: string;
}

/** Body mimo cíl (žluté a červené hodnoty) za období from–to, od nejnovějšího dne, v pořadí písmen a ukazatelů. */
export function nokPoints(data: KpiData, from: DayNumber, to: DayNumber, filter: NokFilter): NokPoint[] {
  const defs = data.defs.filter((d) => (!filter.letter || d.letter === filter.letter) && (!filter.kpiId || d.id === filter.kpiId));
  defs.sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
  const points: NokPoint[] = [];
  for (const entry of [...data.entries].filter((e) => e.day >= from && e.day <= to).sort((a, b) => b.day - a.day)) {
    for (const def of defs) {
      const value = kpiValue(entry, def);
      if (value === null) continue;
      const status = kpiStatus(def, value);
      if (status === 'green') continue;
      points.push({ day: entry.day, def, value, status, details: data.details.filter((d) => d.day === entry.day && d.kpiId === def.id) });
    }
  }
  return points;
}

export type Dimension = 'project' | 'item' | 'person' | 'cause';
export const DIMENSIONS: readonly Dimension[] = ['project', 'item', 'person', 'cause'];

export interface NokGroup {
  value: string;
  /** Dny, kdy se hodnota objevila (vzestupně). */
  days: DayNumber[];
  /** Počet bodů mimo cíl s touto hodnotou. */
  points: number;
  /** Ukazatele, u kterých se objevila. */
  kpis: KpiDef[];
  /** Nejhorší stav bodů s touto hodnotou po dnech. */
  dayStatus: ReadonlyMap<DayNumber, 'yellow' | 'red'>;
}

/** Hodnoty detailu v daném rozměru; osoby „A / B“ se rozdělí jako v OIL, příčina bez rozdílu velikosti písmen. */
function valuesOf(detail: KpiDetail, dim: Dimension): string[] {
  const raw = detail[dim].trim();
  if (!raw) return [];
  if (dim === 'person') return ownerNames(raw);
  return [raw];
}

/** Souhrn bodů mimo cíl podle rozměru: nejdřív co se objevilo ve víc dnech, pak víckrát. */
export function nokGroups(points: readonly NokPoint[], dim: Dimension): NokGroup[] {
  const groups = new Map<string, { value: string; days: Map<DayNumber, 'yellow' | 'red'>; points: number; kpis: Map<string, KpiDef> }>();
  for (const point of points) {
    const values = new Map<string, string>();
    for (const detail of point.details) for (const v of valuesOf(detail, dim)) values.set(v.toLowerCase(), v);
    for (const [key, value] of values) {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { value, days: new Map(), points: 0, kpis: new Map() }));
      if (g.days.get(point.day) !== 'red') g.days.set(point.day, point.status);
      g.points++;
      g.kpis.set(point.def.id, point.def);
    }
  }
  return [...groups.values()]
    .map((g) => ({ value: g.value, days: [...g.days.keys()].sort((a, b) => a - b), points: g.points, kpis: [...g.kpis.values()], dayStatus: g.days }))
    .sort((a, b) => b.days.length - a.days.length || b.points - a.points || a.value.localeCompare(b.value, 'cs'));
}

/** Kolik zapsaných pracovních dní období bylo písmeno červené / mimo cíl a kolik pracovních dní období má. */
export function letterSummary(data: KpiData, letter: Letter, from: DayNumber, to: DayNumber): { red: number; off: number; workdays: number } {
  let red = 0;
  let off = 0;
  let workdays = 0;
  for (let d = from; d <= to; d++) {
    if (weekday(d) <= 5) workdays++;
    const entry = entryOf(data, d);
    const status = entry ? letterStatus(data, letter, entry) : null;
    if (status === 'red') red++;
    if (status === 'red' || status === 'yellow') off++;
  }
  return { red, off, workdays };
}

export type DayState = KpiStatus | 'weekend' | 'missing' | 'future';

/** Stav písmene po dnech období: barva zapsaného dne, jinak víkend, nezapsaný pracovní den nebo budoucí den. */
export function letterDays(data: KpiData, letter: Letter, from: DayNumber, to: DayNumber, today: DayNumber): { day: DayNumber; state: DayState }[] {
  const days: { day: DayNumber; state: DayState }[] = [];
  for (let d = from; d <= to; d++) {
    const entry = entryOf(data, d);
    const status = entry ? letterStatus(data, letter, entry) : null;
    days.push({ day: d, state: status ?? (d > today ? 'future' : weekday(d) > 5 ? 'weekend' : 'missing') });
  }
  return days;
}
