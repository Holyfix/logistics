// Plán montáže jako zákaznická coverage: stav u zákazníka po dnech (jeho sklad + transit − plán zákazníka podle
// souboru coverage) + náš sklad + naplánovaná výroba. Návrh plánu kryje první chybějící dny v rámci kapacity.

import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { parseDay, weekday, type DayNumber } from '../dates';
import { customerNeed, sequencerPlans } from '../demand';
import { customerDisplay, type MasterData } from '../masterdata';
import { cellKey, sideOrder, type ShiftSlot } from './plan';
import type { LineCapacity } from './settings';

/** Kolik dní se plánuje po směnách, dokud si plánovač nepřidá další (dnes a zítra). */
export const PLAN_DAYS = 2;
/** Nejvíc dní coverage v plánu (soubory sekvencéra mají obvykle 2–3 týdny). */
const MAX_COVERAGE_DAYS = 28;
/** Bez souboru coverage: kolik dní zobrazit. */
const DEFAULT_COVERAGE_DAYS = 14;

export const ASSEMBLY = 'ASSEMBLY';

/** Chybějící kusy u zákazníka v den `day` podle souboru coverage (přírůstek chybějícího množství). */
export interface Requirement {
  day: DayNumber;
  qty: number;
}

export interface PlanItem {
  item: string;
  customerNumber: string;
  description: string;
  side: string;
  project: string;
  location: string;
  /** Náš sklad hotového dílu. */
  stock: number;
  /** Stav u zákazníka na konci dne (jeho sklad + transit − plán zákazníka) pro dny `AssemblyData.days`. */
  base: number[];
  /** Chybějící kusy po dnech souboru coverage (bez odečtu našeho skladu), seřazené podle dne. */
  requirements: Requirement[];
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
 * podle souboru; požadavky = přírůstek chybějícího množství (chybějící kusy z minulých dnů patří do dneška).
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
    const { need, fixed } = customerNeed(days.map(() => 0), days, plan);
    const description = m?.description || plan.description || callOffText.get(item) || '';
    return {
      item: m?.item ?? item,
      customerNumber: m?.customerNumber ? customerDisplay(m.customerNumber) : '',
      description,
      side: m?.side || sideFromText(description),
      project: m?.project || plan.projects[0] || '',
      location: plan.locations[0] ?? '',
      stock: Math.max(0, stock?.get(item) ?? 0),
      base: days.map((d) => plan.balance(d)),
      requirements: need.flatMap((qty, k) => (qty > 1e-9 && fixed[k] ? [{ day: days[k]!, qty }] : [])),
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

/** Naplánovaná výroba dílu po dnech (součet směn dne) pro dny `days`. */
export function plannedByDay(cells: Readonly<Record<string, number>>, item: string, days: readonly DayNumber[]): number[] {
  const index = new Map(days.map((d, k) => [d, k]));
  const result = days.map(() => 0);
  for (const [key, qty] of Object.entries(cells)) {
    const bar = key.indexOf('|');
    if (key.slice(bar + 1) !== item) continue;
    const day = parseDay(key.slice(0, bar).split(' ')[0] ?? '');
    const k = day === null ? undefined : index.get(day);
    if (k !== undefined) result[k]! += qty;
  }
  return result;
}

export interface ItemStatus {
  /** Coverage s plánem: stav u zákazníka + náš sklad + naplánovaná výroba do konce dne. */
  coverage: number[];
  /** Coverage bez plánu: stav u zákazníka + náš sklad. */
  withoutPlan: number[];
  planned: number;
  /** Index prvního dne v záporu s plánem; null = pokryto celé období. */
  shortDay: number | null;
  /** Index prvního dne v záporu bez plánu; null = pokryto celé období. */
  shortDayWithoutPlan: number | null;
}

const firstNegative = (values: readonly number[]) => {
  const k = values.findIndex((v) => v < -EPS);
  return k === -1 ? null : k;
};

/** Coverage dílu po dnech s plánem (`planned` po dnech) a bez něj. */
export function evaluateItem(item: PlanItem, planned: readonly number[]): ItemStatus {
  let made = 0;
  const withoutPlan = item.base.map((b) => b + item.stock);
  const coverage = withoutPlan.map((v, k) => v + (made += planned[k] ?? 0));
  return { coverage, withoutPlan, planned: made, shortDay: firstNegative(coverage), shortDayWithoutPlan: firstNegative(withoutPlan) };
}

/** Strany na směnách v pořadí výroby (navazuje na předchozí směnu). */
export function slotSides(items: readonly PlanItem[], slots: readonly ShiftSlot[], qty: (slot: ShiftSlot, item: PlanItem) => number): string[][] {
  let previous = '';
  return slots.map((slot) => {
    const sides = new Set(items.filter((it) => qty(slot, it) > 0).map((it) => it.side));
    const order = sideOrder(sides, previous);
    previous = order.at(-1) ?? previous;
    return order;
  });
}

const EPS = 1e-9;

export interface Proposal {
  cells: Record<string, number>;
  /** Chybějící kusy, které po návrhu zůstanou nepokryté (nevešly se do kapacity). */
  remaining: number;
}

/**
 * Návrh plánu podle pokrytí. Směny, které už začaly (`start < now`), zůstanou, jak jsou; jejich výroba a náš sklad
 * pokryjí nejdřívější chybějící kusy. Ostatní směny se plní od první: vždy díl s nejdřívějším nepokrytým dnem
 * (při shodě díl ze strany, která se právě vyrábí), po celých dnech, dokud je kapacita. Tím se pokrytí zvedá
 * rovnoměrně u všech dílů. Na směně se díly řadí po stranách (LHD a RHD nikdy zároveň).
 */
export function proposePlan(
  items: readonly PlanItem[],
  slots: readonly ShiftSlot[],
  capacity: (slot: ShiftSlot) => number,
  current: Readonly<Record<string, number>>,
  now: number,
): Proposal {
  const cells: Record<string, number> = {};
  const lockedSlots = slots.filter((s) => s.start < now);
  for (const slot of lockedSlots)
    for (const it of items) {
      const q = current[cellKey(slot.key, it.item)] ?? 0;
      if (q > 0) cells[cellKey(slot.key, it.item)] = q;
    }

  // Nepokryté kusy po dnech: náš sklad a výroba v rozběhnutých směnách pokryjí nejdřívější dny.
  const queues = items.map((it) => {
    let supply = it.stock + lockedSlots.reduce((sum, s) => sum + (cells[cellKey(s.key, it.item)] ?? 0), 0);
    const queue: { day: DayNumber; qty: number }[] = [];
    for (const req of [...it.requirements].sort((a, b) => a.day - b.day)) {
      const used = Math.min(supply, req.qty);
      supply -= used;
      if (req.qty - used > EPS) queue.push({ day: req.day, qty: req.qty - used });
    }
    return queue;
  });

  let side = '';
  for (const slot of slots.filter((s) => s.start >= now)) {
    let free = Math.max(0, capacity(slot));
    while (free > EPS) {
      let best = -1;
      items.forEach((it, i) => {
        const head = queues[i]![0];
        if (!head) return;
        if (best === -1) return void (best = i);
        const other = queues[best]![0]!;
        if (head.day < other.day || (head.day === other.day && it.side === side && items[best]!.side !== side)) best = i;
      });
      if (best === -1) break;
      const head = queues[best]![0]!;
      const take = Math.min(head.qty, free);
      const key = cellKey(slot.key, items[best]!.item);
      cells[key] = (cells[key] ?? 0) + take;
      head.qty -= take;
      free -= take;
      if (head.qty <= EPS) queues[best]!.shift();
      side = items[best]!.side;
    }
  }
  for (const key of Object.keys(cells)) cells[key] = Math.round(cells[key]! * 1000) / 1000;
  const remaining = queues.reduce((sum, q) => sum + q.reduce((a, b) => a + b.qty, 0), 0);
  return { cells, remaining: Math.round(remaining * 1000) / 1000 };
}
