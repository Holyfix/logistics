// Rozbor KPI: body mimo cíl za období s detaily a co se opakuje (projekt, díl, osoba, příčina).

import { weekday, type DayNumber } from './dates';
import { entryOf, kpiStatus, kpiValue, LETTERS, letterStatus, type KpiData, type KpiDef, type KpiDetail, type KpiSource, type KpiStatus, type Letter } from './kpi';
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

/** Podle čeho se body ukazatele seskupí (cause = příčina; u Coverage lokalita, u komponent popis, u OIL bod). */
export type GroupDim = 'project' | 'item' | 'person' | 'cause' | 'supplier';

/** Seskupení podle zdroje ukazatele; první je výchozí (komponenty podle dodavatele, OIL podle odpovědného …). */
export const GROUP_DIMS: Record<KpiSource, readonly GroupDim[]> = {
  manual: ['cause', 'project', 'item', 'person'],
  coverageShortage: ['project', 'item', 'cause'],
  componentsShort: ['supplier', 'project', 'item'],
  oilOverdue: ['person', 'cause'],
};

type OffStatus = 'yellow' | 'red';
const worse = (a: OffStatus | undefined, b: OffStatus): OffStatus => (a === 'red' ? 'red' : b);

/** Ukazatel mimo cíl v období: dny mimo cíl s nejhorším stavem a jeho body. */
export interface KpiOff {
  def: KpiDef;
  days: ReadonlyMap<DayNumber, OffStatus>;
  points: NokPoint[];
}

/** Ukazatele, které byly v období aspoň jednou mimo cíl: nejdřív víc dní mimo cíl, pak červené, pak pořadí písmen. */
export function offKpis(points: readonly NokPoint[]): KpiOff[] {
  const byDef = new Map<string, { def: KpiDef; days: Map<DayNumber, OffStatus>; points: NokPoint[] }>();
  for (const p of points) {
    let k = byDef.get(p.def.id);
    if (!k) byDef.set(p.def.id, (k = { def: p.def, days: new Map(), points: [] }));
    k.days.set(p.day, worse(k.days.get(p.day), p.status));
    k.points.push(p);
  }
  const reds = (k: KpiOff) => [...k.days.values()].filter((s) => s === 'red').length;
  return [...byDef.values()].sort((a, b) => b.days.size - a.days.size || reds(b) - reds(a) || LETTERS.indexOf(a.def.letter) - LETTERS.indexOf(b.def.letter));
}

/** Díl (nebo jiná položka detailu) ve skupině: ve kterých dnech byl, nejvyšší množství. */
export interface GroupItem {
  /** Hlavní text: díl, jinak příčina nebo osoba. */
  label: string;
  /** Doplňující údaje (popis / lokalita, projekt, osoba). */
  note: string;
  days: DayNumber[];
  maxQty: number | null;
}

export interface DetailGroup {
  /** Hodnota skupiny; prázdná = bez údaje (nebo bod bez detailu). */
  value: string;
  days: ReadonlyMap<DayNumber, OffStatus>;
  items: GroupItem[];
  maxQty: number | null;
}

/** Hodnoty detailu pro seskupení: projekty „P1, P2“ a osoby „A / B“ se rozdělí, dodavatel z mapování podle dílu. */
function valuesOf(d: KpiDetail, dim: GroupDim, supplierOf: (item: string) => string): string[] {
  const raw = (dim === 'supplier' ? supplierOf(d.item) : d[dim]).trim();
  if (!raw) return [''];
  if (dim === 'person') return ownerNames(raw);
  if (dim === 'project') return raw.split(/\s*,\s*/).filter(Boolean);
  return [raw];
}

/**
 * Body ukazatele seskupené podle `dim`: skupina má dny (s nejhorším stavem), nejvyšší množství a položky (díly)
 * s dny a množstvím. Bod bez detailu patří do skupiny bez údaje. Nejdřív skupiny s víc dny, bez údaje na konci.
 */
export function detailGroups(points: readonly NokPoint[], dim: GroupDim, supplierOf: (item: string) => string = () => ''): DetailGroup[] {
  type Item = { label: string; note: string; days: Set<DayNumber>; maxQty: number | null };
  const groups = new Map<string, { value: string; days: Map<DayNumber, OffStatus>; items: Map<string, Item> }>();
  const maxOf = (a: number | null, b: number | null) => (b === null ? a : a === null ? b : Math.max(a, b));
  for (const p of points) {
    for (const d of p.details.length ? p.details : [null]) {
      const values = d ? valuesOf(d, dim, supplierOf) : [''];
      const label = d ? d.item || d.cause || d.person || d.project : '';
      const note = d ? [d.item ? d.cause : '', dim !== 'project' && label !== d.project ? d.project : '', dim !== 'person' && label !== d.person ? d.person : ''].filter(Boolean).join(' · ') : '';
      for (const value of new Set(values)) {
        const key = value.toLowerCase();
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { value, days: new Map(), items: new Map() }));
        g.days.set(p.day, worse(g.days.get(p.day), p.status));
        if (!label) continue;
        const itemKey = label.toLowerCase();
        let item = g.items.get(itemKey);
        if (!item) g.items.set(itemKey, (item = { label, note, days: new Set(), maxQty: null }));
        item.days.add(p.day);
        item.maxQty = maxOf(item.maxQty, d!.qty);
      }
    }
  }
  return [...groups.values()]
    .map((g) => {
      const items = [...g.items.values()]
        .map((i) => ({ label: i.label, note: i.note, days: [...i.days].sort((a, b) => a - b), maxQty: i.maxQty }))
        .sort((a, b) => b.days.length - a.days.length || (b.maxQty ?? 0) - (a.maxQty ?? 0) || a.label.localeCompare(b.label, 'cs', { numeric: true }));
      return { value: g.value, days: g.days, items, maxQty: items.reduce<number | null>((m, i) => maxOf(m, i.maxQty), null) };
    })
    .sort((a, b) => Number(!a.value) - Number(!b.value) || b.days.size - a.days.size || b.items.length - a.items.length || a.value.localeCompare(b.value, 'cs', { numeric: true }));
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
