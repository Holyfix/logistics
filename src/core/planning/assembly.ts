// Plán montáže jako zákaznická coverage: stav u zákazníka po dnech (jeho sklad + transit − plán zákazníka podle
// souboru coverage) + náš sklad + vše naplánované. Automatický plán směny kryje první nepokryté dny v rámci kapacity.

import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { parseDay, weekday, type DayNumber } from '../dates';
import { sequencerPlans } from '../demand';
import { customerDisplay, sideGroup, type MasterData } from '../masterdata';
import { cellKey, sideOrder, type AutoMode, type ShiftSlot } from './plan';
import type { LineCapacity } from './settings';

/** Kolik dní se plánuje po směnách, dokud si plánovač nepřidá další (dnes a zítra). */
export const PLAN_DAYS = 2;
/** Nejvíc dní coverage v plánu (soubory sekvencéra mají obvykle 2–3 týdny). */
const MAX_COVERAGE_DAYS = 28;
/** Bez souboru coverage: kolik dní zobrazit. */
const DEFAULT_COVERAGE_DAYS = 14;

export const ASSEMBLY = 'ASSEMBLY';

const EPS = 1e-9;

export interface PlanItem {
  item: string;
  customerNumber: string;
  description: string;
  side: string;
  project: string;
  location: string;
  /** Náš sklad hotového dílu. */
  stock: number;
  /** Kusů v balení podle mapování (Order Multiple); 0 = neuvedeno, platí balení linky. */
  pack: number;
  /** Stav u zákazníka na konci dne (jeho sklad + transit − plán zákazníka) pro dny `AssemblyData.days`. */
  base: number[];
}

export interface AssemblyData {
  /** Dny coverage od dneška do konce souborů coverage (i víkendy). */
  days: DayNumber[];
  items: PlanItem[];
}

export interface AssemblyInputs {
  master: MasterData | undefined;
  coverage?: readonly CoverageSource[];
  /** Odvolávky: jen popisy dílů, které nejsou v mapování (potřeba se bere jen z coverage). */
  callOffs: CallOffExport | undefined;
  stock: ReadonlyMap<string, number> | undefined;
  today: DayNumber;
}

/** Strana ze slova LHD nebo RHD v popisu (když ji mapování neuvádí). */
function sideFromText(text: string): string {
  return /\b(LHD|RHD)\b/.exec(text.toUpperCase())?.[1] ?? '';
}

/**
 * Hotové díly pro montáž: jen díly se souborem coverage (podle sloupce Line = ASSEMBLY v mapování, bez sloupce
 * všechny díly ze souborů coverage). Projekt z mapování, jinak ze složky souboru coverage. Stav u zákazníka po dnech
 * podle souboru (za koncem souboru zůstává poslední stav).
 */
export function assemblyItems({ master, coverage = [], callOffs, stock, today }: AssemblyInputs): AssemblyData {
  const plans = sequencerPlans(coverage, master);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));
  const callOffText = new Map((callOffs?.items ?? []).map((item, i) => [item.toUpperCase(), callOffs!.descriptions[i] ?? '']));

  const candidates = master?.hasLineColumn ? [...plans.keys()].filter((item) => masterByItem.get(item)?.line === ASSEMBLY) : [...plans.keys()];
  const last = Math.max(today + DEFAULT_COVERAGE_DAYS - 1, ...candidates.map((item) => plans.get(item)!.last));
  const days = Array.from({ length: Math.min(MAX_COVERAGE_DAYS, last - today + 1) }, (_, k) => today + k);

  const items = candidates.map((item): PlanItem => {
    const m = masterByItem.get(item);
    const plan = plans.get(item)!;
    const description = m?.description || plan.description || callOffText.get(item) || '';
    return {
      item: m?.item ?? item,
      customerNumber: m?.customerNumber ? customerDisplay(m.customerNumber) : '',
      description,
      side: m?.side || sideFromText(description),
      project: m?.project || plan.projects[0] || '',
      location: plan.locations[0] ?? '',
      stock: Math.max(0, stock?.get(item) ?? 0),
      pack: m?.orderMultiple && m.orderMultiple >= 1 ? Math.round(m.orderMultiple) : 0,
      base: days.map((d) => plan.balance(d)),
    };
  });
  items.sort((a, b) => a.side.localeCompare(b.side) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  return { days, items };
}

/** Kapacita směny: ručně zadaná, jinak kusů za směnu linky, když se směna v pracovní den jede. */
export function slotCapacity(slot: ShiftSlot, line: LineCapacity, overrides: Readonly<Record<string, number>>): number {
  const manual = overrides[slot.key];
  if (manual !== undefined) return manual;
  return weekday(slot.day) <= 5 && line.shifts.includes(slot.code) ? line.perShift : 0;
}

/** Kusů v balení dílu: z mapování, jinak balení linky (nejméně 1). */
export function packOf(item: PlanItem, line: LineCapacity): number {
  return Math.max(1, item.pack || line.pack);
}

/** Množství zaokrouhlené nahoru na celá balení. */
export function roundUpToPack(qty: number, pack: number): number {
  return pack > 1 ? Math.ceil(qty / pack - EPS) * pack : qty;
}

/** Naplánovaná výroba dílu celkem ve směnách dnů `days` (od dneška); starší směny už jsou v našem skladu. */
export function plannedTotal(cells: Readonly<Record<string, number>>, item: string, days: readonly DayNumber[]): number {
  const first = days[0] ?? 0;
  const last = days.at(-1) ?? -1;
  let total = 0;
  for (const [key, qty] of Object.entries(cells)) {
    const bar = key.indexOf('|');
    if (key.slice(bar + 1) !== item) continue;
    const day = parseDay(key.slice(0, bar).split(' ')[0] ?? '');
    if (day !== null && day >= first && day <= last) total += qty;
  }
  return total;
}

export interface ItemStatus {
  /** Coverage s plánem: stav u zákazníka + náš sklad + vše naplánované (do všech dnů). */
  coverage: number[];
  /** Coverage bez plánu: stav u zákazníka + náš sklad. */
  withoutPlan: number[];
  planned: number;
  /** Index prvního dne v záporu s plánem; null = pokryto celé období. */
  shortDay: number | null;
  /** Index prvního dne v záporu bez plánu; null = pokryto celé období. */
  shortDayWithoutPlan: number | null;
  /** Kolik kusů i s plánem chybí do konce období (nejhlubší záporný stav). */
  missing: number;
}

const firstNegative = (values: readonly number[]) => {
  const k = values.findIndex((v) => v < -EPS);
  return k === -1 ? null : k;
};

/**
 * Coverage dílu s plánem a bez něj. Naplánované kusy se přičtou do všech dnů coverage: první nepokrytý den −50
 * a v plánu 60 ks → 10 (kdy vyrobit, aby díly k zákazníkovi dorazily včas, řídí plánovač).
 */
export function evaluateItem(item: PlanItem, planned: number): ItemStatus {
  const withoutPlan = item.base.map((b) => b + item.stock);
  const coverage = withoutPlan.map((v) => v + planned);
  return {
    coverage,
    withoutPlan,
    planned,
    shortDay: firstNegative(coverage),
    shortDayWithoutPlan: firstNegative(withoutPlan),
    missing: Math.max(0, -Math.min(0, ...coverage)),
  };
}

/** Strany (LHD, RHD) na směnách v pořadí výroby (navazuje na předchozí směnu). */
export function slotSides(items: readonly PlanItem[], slots: readonly ShiftSlot[], qty: (slot: ShiftSlot, item: PlanItem) => number): string[][] {
  let previous = '';
  return slots.map((slot) => {
    const sides = new Set(items.filter((it) => qty(slot, it) > 0).map((it) => sideGroup(it.side)));
    const order = sideOrder(sides, previous);
    previous = order.at(-1) ?? previous;
    return order;
  });
}

export interface AutoPlanResult {
  /** Plán: ručně zadané směny beze změny + dopočítané automatické směny. */
  cells: Record<string, number>;
  /** Kusy, které ani s plánem nejsou pokryté (nevešly se do kapacity automatických směn). */
  remaining: number;
}

/**
 * Plán s dopočítanými automatickými směnami (`auto`, klíč směny → strana). Ruční směny zůstanou, jak jsou, a spolu
 * s naším skladem pokryjí nejdřívější chybějící kusy. Automatické směny se plní v pořadí `slots`: vždy díl zvolené
 * strany s nejdřívějším nepokrytým dnem (při shodě díl ze strany, kterou skončila předchozí směna, ruční
 * i automatická; jinak LHD před RHD), po celých dnech a celých baleních (`pack`; kusy navíc pokryjí další dny),
 * dokud je kapacita. Chybějící kusy = přírůstek nejhlubšího záporného stavu coverage po dnech.
 */
export function autoPlan(
  items: readonly PlanItem[],
  days: readonly DayNumber[],
  cells: Readonly<Record<string, number>>,
  auto: Readonly<Record<string, AutoMode>>,
  slots: readonly ShiftSlot[],
  capacity: (slot: ShiftSlot) => number,
  pack: (item: PlanItem) => number = () => 1,
): AutoPlanResult {
  const autoSlots = slots.filter((s) => auto[s.key]);
  const autoKeys = new Set(autoSlots.map((s) => s.key));
  const result: Record<string, number> = {};
  for (const [key, qty] of Object.entries(cells)) if (qty > 0 && !autoKeys.has(key.slice(0, key.indexOf('|')))) result[key] = qty;

  const queues = items.map((it) => {
    let supply = plannedTotal(result, it.item, days);
    let deepest = 0;
    const queue: { day: DayNumber; qty: number }[] = [];
    evaluateItem(it, 0).withoutPlan.forEach((v, k) => {
      if (-v <= deepest + EPS) return;
      const need = -v - deepest;
      deepest = -v;
      const used = Math.min(supply, need);
      supply -= used;
      if (need - used > EPS) queue.push({ day: days[k]!, qty: need - used });
    });
    return queue;
  });

  // Strana, kterou skončila předchozí směna (ruční i automatická): při shodě dne se pokračuje na ní.
  let side = '';
  const lastSide = (slot: ShiftSlot, previous: string) => {
    const sides = new Set(items.filter((it) => (result[cellKey(slot.key, it.item)] ?? 0) > 0).map((it) => sideGroup(it.side)));
    return sideOrder(sides, previous).at(-1) ?? previous;
  };
  for (const slot of slots) {
    const mode = auto[slot.key];
    if (!mode) {
      side = lastSide(slot, side);
      continue;
    }
    const previous = side;
    const fits = (it: PlanItem) => mode === 'BOTH' || sideGroup(it.side) === mode;
    let free = Math.max(0, capacity(slot));
    while (free > EPS) {
      let best = -1;
      items.forEach((it, i) => {
        const head = queues[i]![0];
        if (!head || !fits(it) || pack(it) > free + EPS) return;
        if (best === -1) return void (best = i);
        const other = queues[best]![0]!;
        const onSide = (x: PlanItem) => sideGroup(x.side) === side;
        if (head.day < other.day || (head.day === other.day && onSide(it) && !onSide(items[best]!))) best = i;
      });
      if (best === -1) break;
      const queue = queues[best]!;
      const p = pack(items[best]!);
      const take = Math.min(roundUpToPack(queue[0]!.qty, p), Math.floor(free / p + EPS) * p);
      const key = cellKey(slot.key, items[best]!.item);
      result[key] = (result[key] ?? 0) + take;
      free -= take;
      // Kusy navíc z celého balení pokryjí další chybějící dny.
      let left = take;
      while (left > EPS && queue[0]) {
        const used = Math.min(left, queue[0].qty);
        queue[0].qty -= used;
        left -= used;
        if (queue[0].qty <= EPS) queue.shift();
      }
      side = sideGroup(items[best]!.side);
    }
    side = lastSide(slot, previous);
  }
  for (const key of Object.keys(result)) result[key] = Math.round(result[key]! * 1000) / 1000;
  const remaining = queues.reduce((sum, q) => sum + q.reduce((a, b) => a + b.qty, 0), 0);
  return { cells: result, remaining: Math.round(remaining * 1000) / 1000 };
}

export interface PlanMetrics {
  /** Index prvního nepokrytého dne nejhoršího dílu; null = všechny díly pokryté celé období. */
  shortDay: number | null;
  /** Díly, které ani s plánem nejsou pokryté celé období. */
  uncovered: number;
  /** Kolik kusů i s plánem chybí (součet přes díly). */
  missing: number;
  /** Přestavby mezi stranami na směnách `slots` (v pořadí výroby). */
  changeovers: number;
}

/** Hodnocení plánu: pokrytí nejhoršího dílu, nepokryté díly, chybějící kusy a počet přestaveb. */
export function planMetrics(items: readonly PlanItem[], days: readonly DayNumber[], cells: Readonly<Record<string, number>>, slots: readonly ShiftSlot[]): PlanMetrics {
  const statuses = items.map((it) => evaluateItem(it, plannedTotal(cells, it.item, days)));
  const short = statuses.flatMap((s) => (s.shortDay === null ? [] : [s.shortDay]));
  const order = slotSides(items, slots, (s, it) => cells[cellKey(s.key, it.item)] ?? 0).flat();
  return {
    shortDay: short.length ? Math.min(...short) : null,
    uncovered: short.length,
    missing: Math.round(statuses.reduce((sum, s) => sum + s.missing, 0) * 1000) / 1000,
    changeovers: order.filter((side, i) => i > 0 && side !== order[i - 1]).length,
  };
}

/** Lepší plán: později první nepokrytý den, pak méně chybějících kusů, pak méně přestaveb. */
export function compareMetrics(a: PlanMetrics, b: PlanMetrics): number {
  const day = (m: PlanMetrics) => m.shortDay ?? Infinity;
  return day(b) - day(a) || a.missing - b.missing || a.changeovers - b.changeovers;
}

export type VariantId = 'both' | 'oneSide';

export interface PlanVariant {
  id: VariantId;
  /** Automatický plán navržených směn (ostatní směny beze změny). */
  auto: Record<string, AutoMode>;
  result: AutoPlanResult;
  metrics: PlanMetrics;
}

export interface SuggestInputs {
  items: readonly PlanItem[];
  days: readonly DayNumber[];
  /** Plán, jak ho zadal plánovač (ruční množství a automatické směny). */
  cells: Readonly<Record<string, number>>;
  auto: Readonly<Record<string, AutoMode>>;
  /** Všechny směny horizontu (pro výpočet automatického plánu). */
  slots: readonly ShiftSlot[];
  /** Směny plánovacích dnů (pro počet přestaveb). */
  planSlots: readonly ShiftSlot[];
  /** Směny, které návrh smí nastavit (bez ručních čísel). */
  targets: readonly ShiftSlot[];
  capacity: (slot: ShiftSlot) => number;
  pack: (item: PlanItem) => number;
}

/**
 * Návrhy automatického plánu pro směny `targets`; ruční směny zůstanou. „both“ = na všech směnách obě strany:
 * kusy vždy dostane díl, kterému chybí nejdřív, takže pokrytí je nejlepší (za cenu přestavby uvnitř směny).
 * „oneSide“ = každá směna jen jedna strana: strana dílu, kterému po dosavadním plánu chybí nejdřív (při shodě
 * strana předchozí směny), takže přestavby jsou jen mezi směnami.
 */
export function suggestPlans({ items, days, cells, auto, slots, planSlots, targets, capacity, pack }: SuggestInputs): PlanVariant[] {
  const targetKeys = new Set(targets.map((s) => s.key));
  const baseAuto = Object.fromEntries(Object.entries(auto).filter(([key]) => !targetKeys.has(key)));
  const baseCells = Object.fromEntries(Object.entries(cells).filter(([key]) => !targetKeys.has(key.slice(0, key.indexOf('|')))));
  const variant = (id: VariantId, modes: Record<string, AutoMode>): PlanVariant => {
    const result = autoPlan(items, days, baseCells, { ...baseAuto, ...modes }, slots, capacity, pack);
    return { id, auto: modes, result, metrics: planMetrics(items, days, result.cells, planSlots) };
  };

  const both = variant('both', Object.fromEntries(targets.map((s) => [s.key, 'BOTH' as const])));

  const oneSide: Record<string, AutoMode> = {};
  let previous = '';
  for (const slot of targets) {
    const { cells: planned } = autoPlan(items, days, baseCells, { ...baseAuto, ...oneSide }, slots, capacity, pack);
    let first = Infinity;
    const sides = new Set<string>();
    for (const it of items) {
      const side = sideGroup(it.side);
      const short = evaluateItem(it, plannedTotal(planned, it.item, days)).shortDay;
      if (!side || short === null || short > first) continue;
      if (short < first) sides.clear();
      first = short;
      sides.add(side);
    }
    if (sides.size === 0) break;
    const side = (sides.has(previous) ? previous : [...sides].sort()[0]!) as AutoMode;
    oneSide[slot.key] = side;
    previous = side;
  }
  return [both, variant('oneSide', oneSide)];
}
