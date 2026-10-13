// Plán montáže: chybějící kusy u zákazníka podle souborů coverage (sklad + transit u sekvencéra + náš sklad),
// vyhodnocení plánu po směnách a návrh plánu, který kryje první chybějící dny v rámci kapacity.

import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { weekday, type DayNumber } from '../dates';
import { customerNeed, sequencerPlans } from '../demand';
import { customerDisplay, type MasterData } from '../masterdata';
import { cellKey, sideOrder, type ShiftSlot } from './plan';
import { destinationOf, type LineCapacity, type PlanSettings } from './settings';

/** Kolik dní se plánuje: zbývající směny dneška a zítřek. */
export const PLAN_DAYS = 2;
/** Kolik dní souboru coverage se nejvýš načte (soubory sekvencéra mají obvykle 2–3 týdny). */
const COVERAGE_DAYS = 42;

export const ASSEMBLY = 'ASSEMBLY';

/** Chybějící kusy u zákazníka v den `day` podle souboru coverage; musí být vyrobené do `deadline`. */
export interface Requirement {
  day: DayNumber;
  /** Termín výroby (minuty od 1. 1. 1970): odjezd auta, aby zákazník měl při příjezdu pokrytí na požadovaný počet dní. */
  deadline: number;
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
  /** Chybějící kusy po dnech souboru coverage (bez odečtu našeho skladu), seřazené podle dne. */
  requirements: Requirement[];
}

export interface AssemblyInputs {
  master: MasterData | undefined;
  coverage?: readonly CoverageSource[];
  /** Odvolávky: jen popisy dílů, které nejsou v mapování (potřeba se bere jen z coverage). */
  callOffs: CallOffExport | undefined;
  stock: ReadonlyMap<string, number> | undefined;
  today: DayNumber;
  settings: PlanSettings;
}

/** Strana ze slova LHD nebo RHD v popisu (když ji mapování neuvádí). */
function sideFromText(text: string): string {
  return /\b(LHD|RHD)\b/.exec(text.toUpperCase())?.[1] ?? '';
}

/**
 * Hotové díly pro montáž s požadavky zákazníka. Díly podle sloupce Line v mapování (ASSEMBLY); bez sloupce díly
 * ze souborů sekvencéra (coverage) a díly z mapování s projektem a stranou.
 * Projekt z mapování, jinak ze složky souboru coverage. Požadavky jen ze souboru coverage: přírůstek chybějícího
 * množství (sklad + transit u sekvencéra − plán zákazníka; chybějící kusy z minulých dnů patří do dneška).
 * Termín výroby = příjezd v den (den − pokrytí + 1) v čase příjezdu, minus transit.
 */
export function assemblyItems({ master, coverage = [], callOffs, stock, today, settings }: AssemblyInputs): PlanItem[] {
  const days = Array.from({ length: COVERAGE_DAYS }, (_, k) => today + k);
  const plans = sequencerPlans(coverage, master);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));
  const callOffText = new Map((callOffs?.items ?? []).map((item, i) => [item.toUpperCase(), callOffs!.descriptions[i] ?? '']));

  const candidates = new Set<string>();
  if (master?.hasLineColumn) {
    for (const [item, m] of masterByItem) if (m.line === ASSEMBLY) candidates.add(item);
  } else {
    for (const item of plans.keys()) candidates.add(item);
    for (const [item, m] of masterByItem) if (m.project && m.side) candidates.add(item);
  }

  const result: PlanItem[] = [];
  for (const item of candidates) {
    const m = masterByItem.get(item);
    const plan = plans.get(item);
    const { need, fixed } = plan ? customerNeed(days.map(() => 0), days, plan) : { need: [], fixed: [] };
    const location = plan?.locations[0] ?? '';
    const dest = destinationOf(settings, location);
    const requirements: Requirement[] = [];
    need.forEach((q, k) => {
      if (q <= 1e-9 || !fixed[k]) return;
      const day = days[k]!;
      const deadline = (day - dest.coverDays + 1) * 1440 + dest.arrival - dest.transitHours * 60;
      requirements.push({ day, deadline, qty: q });
    });
    const description = m?.description || plan?.description || callOffText.get(item) || '';
    result.push({
      item: m?.item ?? item,
      customerNumber: m?.customerNumber ? customerDisplay(m.customerNumber) : '',
      description,
      side: m?.side || sideFromText(description),
      project: m?.project || plan?.projects[0] || '',
      location,
      stock: Math.max(0, stock?.get(item) ?? 0),
      requirements,
    });
  }
  return result.sort((a, b) => a.side.localeCompare(b.side) || a.item.localeCompare(b.item, 'en', { numeric: true }));
}

/** Kapacita směny: ručně zadaná, jinak kusů za směnu linky, když se směna v pracovní den jede. */
export function slotCapacity(slot: ShiftSlot, line: LineCapacity, overrides: Readonly<Record<string, number>>): number {
  const manual = overrides[slot.key];
  if (manual !== undefined) return manual;
  return weekday(slot.day) <= 5 && line.shifts.includes(slot.code) ? line.perShift : 0;
}

export interface ItemStatus {
  /** Stav po každé směně: sklad + vyrobeno do konce směny − chybějící kusy s termínem do konce směny. Záporné = odeslání po termínu. */
  balance: number[];
  /** Chybějící kusy s termínem výroby v dané směně (první směna zahrnuje i starší termíny). */
  due: number[];
  planned: number;
  /** Chybějící kusy v souborech coverage po odečtu našeho skladu. */
  missing: number;
  /** První den, kdy u zákazníka chybí díly (sklad + transit u sekvencéra + náš sklad); null = nic nechybí. */
  firstMissing: DayNumber | null;
  /** Poslední pracovní den pokrytý i s plánem; `whole` = celý soubor coverage, null = nepokryto ani dnes. */
  coveredWithPlan: DayNumber | 'whole' | null;
  /** Některé chybějící kusy plán nestihne vyrobit do termínu odeslání. */
  late: boolean;
}

/** Poslední pracovní den před `day` (nejdřív dnes); null, když takový není. */
function weekdayBefore(day: DayNumber, today: DayNumber): DayNumber | null {
  for (let d = day - 1; d >= today; d--) if (weekday(d) <= 5) return d;
  return null;
}

/** Den prvního požadavku, který nepokryje zásoba `supply`; null = pokryje všechny. */
function firstUncovered(reqs: readonly Requirement[], supply: number): DayNumber | null {
  let need = 0;
  for (const r of reqs) {
    need += r.qty;
    if (need > supply + EPS) return r.day;
  }
  return null;
}

/** Vyhodnotí plán dílu po směnách. `qty` vrátí množství dílu na směně. */
export function evaluateItem(item: PlanItem, slots: readonly ShiftSlot[], qty: (slot: ShiftSlot) => number, today: DayNumber): ItemStatus {
  const reqs = [...item.requirements].sort((a, b) => a.day - b.day);
  const byDeadline = [...reqs].sort((a, b) => a.deadline - b.deadline);
  const produced = slots.map(qty);
  const due = slots.map(() => 0);
  let r = 0;
  slots.forEach((slot, k) => {
    while (r < byDeadline.length && byDeadline[r]!.deadline <= slot.end) due[k]! += byDeadline[r++]!.qty;
  });
  let made = item.stock;
  let needed = 0;
  const balance = slots.map((_, k) => {
    made += produced[k]!;
    needed += due[k]!;
    return made - needed;
  });
  const planned = produced.reduce((a, b) => a + b, 0);
  const total = reqs.reduce((a, b) => a + b.qty, 0);
  const withPlan = firstUncovered(reqs, item.stock + planned);
  return {
    balance,
    due,
    planned,
    missing: Math.max(0, total - item.stock),
    firstMissing: firstUncovered(reqs, item.stock),
    coveredWithPlan: withPlan === null ? 'whole' : weekdayBefore(withPlan, today),
    late: balance.some((b) => b < -EPS),
  };
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
