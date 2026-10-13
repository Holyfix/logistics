// Plán montáže: požadavky zákazníka s termínem výroby, vyhodnocení plánu po směnách a návrh plánu.

import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { weekday, type DayNumber } from '../dates';
import { callOffDemand, customerNeed, sequencerPlans } from '../demand';
import { customerDisplay, type MasterData } from '../masterdata';
import { cellKey, sideOrder, type ShiftSlot } from './plan';
import { destinationOf, type LineCapacity, type PlanSettings } from './settings';

/** Kolik dní dopředu se plánuje (od dneška). */
export const PLAN_DAYS = 14;
/** Kolik dní potřeby zákazníka za horizontem plánu se ještě načte (termín výroby je o pár dní dřív než potřeba). */
const NEED_LOOKAHEAD = 7;

export const ASSEMBLY = 'ASSEMBLY';

/** Požadavek zákazníka: množství potřebné v den `day`, které musí být vyrobené do `deadline`. */
export interface Requirement {
  day: DayNumber;
  /** Termín výroby (minuty od 1. 1. 1970): odjezd auta, aby zákazník měl při příjezdu pokrytí na požadovaný počet dní. */
  deadline: number;
  qty: number;
  /** Ze souboru sekvencéra (jinak z odvolávek). */
  fixed: boolean;
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
  requirements: Requirement[];
}

export interface AssemblyInputs {
  master: MasterData | undefined;
  coverage?: readonly CoverageSource[];
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
 * Projekt z mapování, jinak ze složky souboru coverage. Potřeba po dnech jako v Komponentách (chybějící množství
 * u sekvencéra, dál odvolávky); termín výroby = příjezd v den (potřeba − pokrytí + 1) v čase příjezdu, minus transit.
 */
export function assemblyItems({ master, coverage = [], callOffs, stock, today, settings }: AssemblyInputs): PlanItem[] {
  const days = Array.from({ length: PLAN_DAYS + NEED_LOOKAHEAD }, (_, k) => today + k);
  const calls = callOffDemand(callOffs);
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
    const qty = days.map((d) => calls.get(item)?.get(d) ?? 0);
    const { need, fixed } = customerNeed(qty, days, plan);
    const location = plan?.locations[0] ?? '';
    const dest = destinationOf(settings, location);
    const requirements: Requirement[] = [];
    need.forEach((q, k) => {
      if (q <= 1e-9) return;
      const day = days[k]!;
      const deadline = (day - dest.coverDays + 1) * 1440 + dest.arrival - dest.transitHours * 60;
      requirements.push({ day, deadline, qty: q, fixed: fixed[k]! });
    });
    const description = m?.description || callOffText.get(item) || '';
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
  /** Stav po každé směně: sklad + vyrobeno do konce směny − požadavky s termínem do konce směny. Záporné = zpoždění. */
  balance: number[];
  /** Požadavky s termínem v dané směně (první směna zahrnuje i starší termíny). */
  due: number[];
  planned: number;
  /** Požadavky s termínem výroby v horizontu plánu. */
  required: number;
  /** Poslední pracovní den, kdy je zákazník pokrytý; `whole` = celý horizont, null = nepokrytý ani dnes. */
  coveredUntil: DayNumber | 'whole' | null;
  /** První požadavek, který plán nestihne. */
  firstLate: Requirement | null;
}

/** Vyhodnotí plán dílu po směnách. `qty` vrátí množství dílu na směně. */
export function evaluateItem(item: PlanItem, slots: readonly ShiftSlot[], qty: (slot: ShiftSlot) => number, today: DayNumber): ItemStatus {
  const horizonEnd = slots.at(-1)?.end ?? 0;
  const reqs = item.requirements.filter((r) => r.deadline <= horizonEnd).sort((a, b) => a.deadline - b.deadline);
  const produced = slots.map(qty);
  const due = slots.map(() => 0);
  let r = 0;
  slots.forEach((slot, k) => {
    while (r < reqs.length && reqs[r]!.deadline <= slot.end) due[k]! += reqs[r++]!.qty;
  });
  let made = item.stock;
  let needed = 0;
  const balance = slots.map((_, k) => {
    made += produced[k]!;
    needed += due[k]!;
    return made - needed;
  });

  // Pokrytí zákazníka: první požadavek, na který do jeho termínu nestačí sklad + výroba.
  let firstLate: Requirement | null = null;
  let cumReq = 0;
  let cumMade = item.stock;
  let s = 0;
  for (const req of reqs) {
    while (s < slots.length && slots[s]!.end <= req.deadline) cumMade += produced[s++]!;
    cumReq += req.qty;
    if (cumMade < cumReq - 1e-9) {
      firstLate = req;
      break;
    }
  }
  let coveredUntil: ItemStatus['coveredUntil'] = 'whole';
  if (firstLate) {
    coveredUntil = null;
    for (let d = firstLate.day - 1; d >= today; d--) {
      if (weekday(d) <= 5) {
        coveredUntil = d;
        break;
      }
    }
  }
  return { balance, due, planned: produced.reduce((a, b) => a + b, 0), required: reqs.reduce((a, b) => a + b.qty, 0), coveredUntil, firstLate };
}

/** Strany na směnách v pořadí výroby (navazuje na předchozí směnu) a počet přepnutí. */
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

/** Vyrovnané rozdělení množství do směn s volnou kapacitou (každá směna stejný díl, dokud má místo). */
function level(total: number, free: readonly number[]): number[] {
  const quota = free.map(() => 0);
  let rest = total;
  let open = free.map((_, i) => i).filter((i) => free[i]! > 0);
  while (rest > 1e-9 && open.length > 0) {
    const share = Math.max(1, Math.floor(rest / open.length));
    for (const i of open) {
      const add = Math.min(share, free[i]! - quota[i]!, rest);
      quota[i]! += add;
      rest -= add;
      if (rest <= 1e-9) break;
    }
    open = open.filter((i) => quota[i]! < free[i]!);
  }
  return quota;
}

export interface Proposal {
  cells: Record<string, number>;
  /** Kusy, které se do horizontu nevejdou (chybí kapacita). */
  unplaced: number;
}

/**
 * Návrh plánu. Směny, které už začaly (`start < now`), zůstanou, jak jsou; ostatní se naplánují znovu.
 * Požadavky (po odečtu skladu a výroby v rozběhnutých směnách) se berou podle termínu: množství s jedním termínem
 * se rozloží rovnoměrně do směn mezi předchozím a tímto termínem; co se nevejde, jde do dřívějších směn (od nejbližší),
 * a co se nestihne vůbec, co nejdřív po termínu. Díly jdou ve směnách po stranách (LHD a RHD v blocích) a nedělí se
 * na dávky menší než půl směny.
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
  for (const slot of lockedSlots) for (const it of items) {
    const q = current[cellKey(slot.key, it.item)] ?? 0;
    if (q > 0) cells[cellKey(slot.key, it.item)] = q;
  }
  const open = slots.filter((s) => s.start >= now);
  const free = open.map((s) => Math.max(0, capacity(s)));
  const horizonEnd = slots.at(-1)?.end ?? 0;

  // Čisté požadavky: sklad a výroba v rozběhnutých směnách pokryjí nejdřívější termíny.
  const net: { item: PlanItem; deadline: number; qty: number }[] = [];
  for (const it of items) {
    let supply = it.stock + lockedSlots.reduce((sum, s) => sum + (cells[cellKey(s.key, it.item)] ?? 0), 0);
    for (const req of [...it.requirements].sort((a, b) => a.deadline - b.deadline)) {
      if (req.deadline > horizonEnd) break;
      const used = Math.min(supply, req.qty);
      supply -= used;
      if (req.qty - used > 1e-9) net.push({ item: it, deadline: req.deadline, qty: req.qty - used });
    }
  }

  const deadlines = [...new Set(net.map((n) => n.deadline))].sort((a, b) => a - b);
  let previous = -Infinity;
  let lastSide = '';
  let unplaced = 0;
  for (const deadline of deadlines) {
    const group = net.filter((n) => n.deadline === deadline);
    const total = group.reduce((a, b) => a + b.qty, 0);
    // Rozdělení množství do směn: rovnoměrně ve „vlastním okně“, zbytek do dřívějších směn, pak po termínu.
    const quota = open.map(() => 0);
    const window = open.map((s, i) => (s.end <= deadline && s.end > previous ? i : -1)).filter((i) => i !== -1);
    const inWindow = level(total, window.map((i) => free[i]!));
    window.forEach((i, k) => (quota[i] = inWindow[k]!));
    let rest = total - inWindow.reduce((a, b) => a + b, 0);
    for (let i = open.length - 1; i >= 0 && rest > 1e-9; i--) {
      if (open[i]!.end > deadline || window.includes(i)) continue;
      const add = Math.min(free[i]! - quota[i]!, rest);
      quota[i]! += add;
      rest -= add;
    }
    for (let i = 0; i < open.length && rest > 1e-9; i++) {
      if (open[i]!.end <= deadline) continue;
      const add = Math.min(free[i]! - quota[i]!, rest);
      quota[i]! += add;
      rest -= add;
    }
    previous = deadline;

    // Díly po stranách: nejdřív strana, kterou skončila předchozí skupina, pak druhá. Díl se nedělí na malé dávky:
    // na směně se dělá aspoň půl směny, nebo se dodělá celý; o kolik směna vezme víc, o tolik méně vezmou další.
    const order = sideOrder(new Set(group.map((g) => g.item.side)), lastSide);
    const tape = group
      .map((g) => ({ ...g }))
      .sort((a, b) => order.indexOf(a.item.side) - order.indexOf(b.item.side) || a.item.item.localeCompare(b.item.item, 'en', { numeric: true }));
    let t = 0;
    const assign = (i: number, take: number) => {
      const piece = tape[t]!;
      const key = cellKey(open[i]!.key, piece.item.item);
      cells[key] = (cells[key] ?? 0) + take;
      piece.qty -= take;
      free[i]! -= take;
      if (piece.qty <= EPS) t++;
    };
    let debt = 0;
    quota.forEach((q, i) => {
      let left = q - debt;
      debt = 0;
      const minLot = capacity(open[i]!) / 2;
      while (left > EPS && t < tape.length && free[i]! > EPS) {
        const piece = tape[t]!;
        let take = Math.min(left, piece.qty, free[i]!);
        if (take < piece.qty - EPS) {
          if (piece.qty - take < minLot && piece.qty <= free[i]! + EPS) take = piece.qty;
          else if (take < minLot) take = Math.min(minLot, piece.qty, free[i]!);
        }
        assign(i, take);
        left -= take;
      }
      if (left < 0) debt = -left;
    });
    // Co se kvůli plným směnám nerozdělilo, jde do směn skupiny s volnou kapacitou (od nejbližší k termínu).
    for (let i = open.length - 1; i >= 0 && t < tape.length; i--) {
      if (quota[i]! <= 0) continue;
      while (t < tape.length && free[i]! > EPS) assign(i, Math.min(tape[t]!.qty, free[i]!));
    }
    unplaced += tape.slice(t).reduce((a, b) => a + b.qty, 0);
    lastSide = order.at(-1) ?? lastSide;
  }
  for (const key of Object.keys(cells)) cells[key] = Math.round(cells[key]! * 1000) / 1000;
  return { cells, unplaced: Math.round(unplaced * 1000) / 1000 };
}
