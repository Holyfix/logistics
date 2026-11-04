// Pokrytí Middlefieldu (MF) ve formátu Order Status Matrix: vozy z matice v pořadí plánované stavby, u každých dveří
// stav z matice. Dveřní panel pro Production number a dveře se dohledá v JIT Overview, MF pod panelem na úrovni 1
// kusovníku. Sklad (ručně zadaný) se spotřebovává v pořadí stavby.

import type { BomData } from '../bom';
import type { DayNumber } from '../dates';
import { dayOfStamp, doorOf, DOORS, type Door, type JitPosition, type Stamp } from './jit';
import { statusCode, type MatrixOrder } from './matrix';

/** Stav „Packed“ a vyšší: dveře jsou hotové, MF už je spotřebovaný a do potřeby se nepočítají. */
export const DONE_STATUS = 50;

/** Middlefield podle popisu v kusovníku („ASSY MF …“). */
export function isMiddlefield(description: string): boolean {
  return /\bMF\b/.test(description.toUpperCase());
}

/** Dveřní panel podle Production number a dveří z JIT Overview (pozice, která je v kusovníku jako hotový díl). */
export function panelsFromJit(positions: readonly JitPosition[], bom: BomData): Map<string, string> {
  const panels = new Map<string, string>();
  for (const p of positions) {
    if (!bom.trees.has(p.article)) continue;
    const door = doorOf(bom.info.get(p.article)?.description || p.description);
    if (door) panels.set(panelKey(p.productionNumber, door), p.article);
  }
  return panels;
}

const panelKey = (productionNumber: string, door: Door) => `${productionNumber}|${door}`;

/** Middlefield u dveří: množství na dveře a sklad, který po nich zbude. */
export interface DoorPart {
  item: string;
  qty: number;
  /** Sklad dílu po těchto dveřích (záporný = dveře nejsou pokryté). */
  left: number;
}

/**
 * Pokrytí dveří: ok = MF na skladě, short = chybí, unknown = dveřní panel není v JIT, none = dveře bez MF (panel bez
 * něj, nebo výklopné dveře), skipped = zabalené nebo odeslané dveře (stav 50+) se nepočítají.
 */
export type DoorState = 'ok' | 'short' | 'unknown' | 'none' | 'skipped';

export interface DoorCoverage {
  door: Door;
  status: string;
  panel: string | null;
  parts: DoorPart[];
  state: DoorState;
}

export interface CarCoverage {
  lot: string;
  productionNumber: string;
  optionType: string;
  colors: string;
  planned: Stamp | null;
  doors: Partial<Record<Door, DoorCoverage>>;
  /** Některé dveře vozu nejsou pokryté. */
  short: boolean;
}

/** Dveře, které díl potřebují (v pořadí stavby). */
export interface Demand {
  lot: string;
  productionNumber: string;
  door: Door;
  panel: string;
  planned: Stamp | null;
  status: string;
  qty: number;
}

export interface PartCoverage {
  item: string;
  description: string;
  /** Ručně zadaný sklad; null = nezadaný (počítá se jako 0). */
  stock: number | null;
  total: number;
  /** Potřeba před dneškem nebo bez data stavby. */
  overdue: number;
  /** Potřeba po dnech `days`. */
  perDay: number[];
  /** Stav na konci dne po dnech `days` (sklad − kumulovaná potřeba včetně dřívější). */
  balance: number[];
  /** Poslední dveře, na které sklad ještě stačí; null = nestačí ani na první. */
  lastCovered: Demand | null;
  /** První dveře, na které sklad nestačí; null = pokryje všechny. */
  firstShort: Demand | null;
  demands: Demand[];
}

export interface MaterialCoverage {
  days: DayNumber[];
  cars: CarCoverage[];
  parts: PartCoverage[];
  /** Dveře v matici (se stavem); z nich hotové (stav 50+, nepočítají se) a z ostatních s dveřním panelem z JIT a bez něj (bez výklopných). */
  doors: number;
  known: number;
  unknown: number;
  skippedDone: number;
}

export interface MaterialInputs {
  matrix: ReadonlyMap<string, MatrixOrder>;
  positions: readonly JitPosition[];
  bom: BomData;
  stock: ReadonlyMap<string, number>;
  today: DayNumber;
}

export function buildMaterialCoverage({ matrix, positions, bom, stock, today }: MaterialInputs): MaterialCoverage {
  const panels = panelsFromJit(positions, bom);
  // Vozy v pořadí plánované stavby (při shodě v pořadí matice); vůz bez data na začátek.
  const orders = [...matrix.values()].map((o, i) => ({ o, i })).sort((a, b) => (a.o.planned ?? -Infinity) - (b.o.planned ?? -Infinity) || a.i - b.i);
  const left = new Map<string, number>();
  const demands = new Map<string, Demand[]>();
  let doors = 0;
  let known = 0;
  let unknown = 0;
  let skippedDone = 0;
  const cars = orders.map(({ o }): CarCoverage => {
    const car: CarCoverage = { lot: o.lot, productionNumber: o.productionNumber, optionType: o.optionType, colors: o.colors, planned: o.planned, doors: {}, short: false };
    for (const door of DOORS) {
      const status = o.status[door];
      if (status === undefined) continue;
      doors++;
      const panel = panels.get(panelKey(o.productionNumber, door)) ?? null;
      // Výklopné dveře MF nemají: bez panelu z JIT nejsou „neznámé“, jen bez MF.
      const cell: DoorCoverage = { door, status, panel, parts: [], state: panel || door === 'HB' ? 'none' : 'unknown' };
      car.doors[door] = cell;
      // Zabalené a odeslané dveře (stav 50+) už MF spotřebovaly: nepočítají se, ani když nejsou v JIT.
      if ((statusCode(status) ?? 0) >= DONE_STATUS) {
        cell.state = 'skipped';
        skippedDone++;
        continue;
      }
      if (!panel) {
        if (door !== 'HB') unknown++;
        continue;
      }
      known++;
      for (const node of bom.trees.get(panel) ?? []) {
        if (!isMiddlefield(bom.info.get(node.item)?.description ?? '')) continue;
        const rest = (left.has(node.item) ? left.get(node.item)! : (stock.get(node.item) ?? 0)) - node.qty;
        left.set(node.item, rest);
        cell.parts.push({ item: node.item, qty: node.qty, left: rest });
        (demands.get(node.item) ?? demands.set(node.item, []).get(node.item)!).push({ lot: o.lot, productionNumber: o.productionNumber, door, panel, planned: o.planned, status, qty: node.qty });
      }
      if (cell.parts.length) cell.state = cell.parts.some((p) => p.left < -1e-9) ? 'short' : 'ok';
      if (cell.state === 'short') car.short = true;
    }
    return car;
  });

  // Dny od dneška do poslední plánované stavby; dřívější stavba (a bez data) se počítá do „po termínu“.
  const stamps = [...demands.values()].flat().flatMap((d) => (d.planned === null ? [] : [dayOfStamp(d.planned)]));
  const last = Math.max(today, ...stamps);
  const days = Array.from({ length: last - today + 1 }, (_, k) => today + k);

  const parts = [...demands].map(([item, list]): PartCoverage => {
    const perDay = days.map(() => 0);
    let overdue = 0;
    for (const d of list) {
      const day = d.planned === null ? null : dayOfStamp(d.planned);
      if (day === null || day < today) overdue += d.qty;
      else perDay[day - today]! += d.qty;
    }
    const own = stock.get(item);
    let running = (own ?? 0) - overdue;
    const balance = perDay.map((q) => (running -= q));
    let rest = own ?? 0;
    let lastCovered: Demand | null = null;
    let firstShort: Demand | null = null;
    for (const d of list) {
      rest -= d.qty;
      if (rest < -1e-9) {
        firstShort = d;
        break;
      }
      lastCovered = d;
    }
    return {
      item,
      description: bom.info.get(item)?.description ?? '',
      stock: own ?? null,
      total: list.reduce((s, d) => s + d.qty, 0),
      overdue,
      perDay,
      balance,
      lastCovered,
      firstShort,
      demands: list,
    };
  });
  // Nejdřív díly, které chybí nejdřív; pak podle čísla.
  const shortAt = (p: PartCoverage) => (p.firstShort ? (p.firstShort.planned ?? -Infinity) : Infinity);
  parts.sort((a, b) => shortAt(a) - shortAt(b) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  return { days, cars, parts, doors, known, unknown, skippedDone };
}

/** Chybějící MF vozu po dveřích (pro sloupec Materiál). */
export function carMissing(car: CarCoverage): { door: Door; item: string }[] {
  return DOORS.flatMap((door) => (car.doors[door]?.parts ?? []).filter((p) => p.left < -1e-9).map((p) => ({ door, item: p.item })));
}

/** Dveře, na které sklad dílu nestačí, s chybějícím množstvím (v pořadí stavby). */
export interface ShortDemand extends Demand {
  missing: number;
}

/** Díl, který chybí: kolik celkem a od kterých dveří (pro prioritní seznam). */
export interface PartShortage {
  part: PartCoverage;
  missing: number;
  demands: ShortDemand[];
}

/** Prioritní seznam: díly, které chybí, seřazené podle stavby prvních nepokrytých dveří. */
export function shortages(parts: readonly PartCoverage[]): PartShortage[] {
  return parts
    .filter((p) => p.firstShort)
    .map((part) => {
      let left = part.stock ?? 0;
      const demands: ShortDemand[] = [];
      for (const d of part.demands) {
        left -= d.qty;
        // Dveře, které sklad pokryje jen zčásti, chybí jen o zbytek.
        if (left < -1e-9) demands.push({ ...d, missing: Math.min(d.qty, -left) });
      }
      return { part, missing: demands.reduce((s, d) => s + d.missing, 0), demands };
    })
    .sort((a, b) => (a.part.firstShort!.planned ?? -Infinity) - (b.part.firstShort!.planned ?? -Infinity) || a.part.item.localeCompare(b.part.item, 'en', { numeric: true }));
}
