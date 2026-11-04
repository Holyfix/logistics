// Pokrytí Maincarrieru (MC) a Middlefieldu (MF) ve formátu Order Status Matrix: vozy z matice v pořadí plánované
// stavby, u každých dveří stav z matice. Díly se určí podle klíče MC/MF (dveře, výbava, barva); co v klíči není, podle
// JIT Overview (dveřní panel pro Production number a dveře) a kusovníku (MC a MF pod panelem na úrovni 1). Sklad
// (ze souboru skladu, pro MC a MF zvlášť) se spotřebovává v pořadí stavby.

import type { BomData } from '../bom';
import type { DayNumber } from '../dates';
import { dayOfStamp, doorOf, DOORS, type Door, type JitPosition, type Stamp } from './jit';
import { statusCode, type MatrixOrder } from './matrix';
import { lookupPart, PART_KINDS, partColour, partKind, type PartKey, type PartKind } from './partKey';

/** Stav „Packed“ a vyšší: dveře jsou hotové, MC a MF už jsou spotřebované a do potřeby se nepočítají. */
export const DONE_STATUS = 50;

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

/** Díl MC nebo MF u dveří: množství na dveře a sklad, který po nich zbude. */
export interface DoorPart {
  item: string;
  kind: PartKind;
  qty: number;
  /** Sklad dílu po těchto dveřích (záporný = dveře nejsou pokryté). */
  left: number;
  /** Odkud je díl: z klíče MC/MF, nebo z JIT (dveřní panel a kusovník). */
  source: 'key' | 'jit';
}

/**
 * Pokrytí dveří: ok = MC i MF na skladě, short = něco chybí, unknown = díly nelze určit (nejsou v klíči ani v JIT),
 * none = dveře bez MC a MF (výklopné dveře), skipped = zabalené nebo odeslané dveře (stav 50+) se nepočítají.
 */
export type DoorState = 'ok' | 'short' | 'unknown' | 'none' | 'skipped';

export interface DoorCoverage {
  door: Door;
  status: string;
  /** Dveřní panel z JIT (když je vůz v JIT). */
  panel: string | null;
  parts: DoorPart[];
  /** Druhy dílů, které nejde určit (nejsou v klíči a dveře nejsou v JIT). */
  unknown: PartKind[];
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
  panel: string | null;
  planned: Stamp | null;
  status: string;
  qty: number;
}

export interface PartCoverage {
  item: string;
  kind: PartKind;
  description: string;
  /** Sklad dílu; null = díl ve skladu není (počítá se jako 0). */
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
  /** Dveře v matici (se stavem) a z nich hotové (stav 50+, nepočítají se). */
  doors: number;
  skippedDone: number;
  /** Počítané dveře (bez výklopných), u kterých jsou určené MC i MF, a u kterých něco určit nejde. */
  known: number;
  unknown: number;
  /** Počítané dveře (bez výklopných), u kterých nejde určit díl daného druhu. */
  unknownByKind: Record<PartKind, number>;
}

export interface MaterialInputs {
  matrix: ReadonlyMap<string, MatrixOrder>;
  /** Klíč MC/MF (druh, dveře, výbava, barva → díl). */
  key?: PartKey | undefined;
  /** JIT Overview a kusovník: pro dveře, které v klíči nejsou. */
  positions?: readonly JitPosition[] | undefined;
  bom?: BomData | undefined;
  /** Sklad po dílech zvlášť pro MC a MF (každý druh může mít jiné lokace). */
  stock: Record<PartKind, ReadonlyMap<string, number>>;
  today: DayNumber;
}

export function buildMaterialCoverage({ matrix, key, positions, bom, stock, today }: MaterialInputs): MaterialCoverage {
  const panels = positions && bom ? panelsFromJit(positions, bom) : new Map<string, string>();
  const info = new Map<string, { kind: PartKind; description: string }>();
  // Vozy v pořadí plánované stavby (při shodě v pořadí matice); vůz bez data na začátek.
  const orders = [...matrix.values()].map((o, i) => ({ o, i })).sort((a, b) => (a.o.planned ?? -Infinity) - (b.o.planned ?? -Infinity) || a.i - b.i);
  const left = new Map<string, number>();
  const demands = new Map<string, Demand[]>();
  let doors = 0;
  let known = 0;
  let unknown = 0;
  let skippedDone = 0;
  const unknownByKind: Record<PartKind, number> = { MC: 0, MF: 0 };
  const cars = orders.map(({ o }): CarCoverage => {
    const car: CarCoverage = { lot: o.lot, productionNumber: o.productionNumber, optionType: o.optionType, colors: o.colors, planned: o.planned, doors: {}, short: false };
    for (const door of DOORS) {
      const status = o.status[door];
      if (status === undefined) continue;
      doors++;
      const panel = panels.get(panelKey(o.productionNumber, door)) ?? null;
      const cell: DoorCoverage = { door, status, panel, parts: [], unknown: [], state: 'none' };
      car.doors[door] = cell;
      // Zabalené a odeslané dveře (stav 50+) už díly spotřebovaly: nepočítají se, ani když nejsou v JIT.
      if ((statusCode(status) ?? 0) >= DONE_STATUS) {
        cell.state = 'skipped';
        skippedDone++;
        continue;
      }
      for (const kind of PART_KINDS) {
        // Z klíče 1 ks na dveře, jinak díly daného druhu pod dveřním panelem v kusovníku.
        const keyed = key ? lookupPart(key, kind, door, o.optionType, o.colors) : null;
        const needed = keyed
          ? [{ item: keyed.item, qty: 1, description: keyed.description, source: 'key' as const }]
          : panel
            ? (bom!.trees.get(panel) ?? [])
                .map((node) => ({ item: node.item, qty: node.qty, description: bom!.info.get(node.item)?.description ?? '', source: 'jit' as const }))
                .filter((n) => partKind(n.description) === kind)
            : null;
        // Výklopné dveře MC ani MF nemají: když je klíč ani JIT neurčí, nejsou „neznámé“.
        if (!needed) {
          if (door !== 'HB') cell.unknown.push(kind);
          continue;
        }
        for (const node of needed) {
          if (!info.has(node.item)) info.set(node.item, { kind, description: bom?.info.get(node.item)?.description || node.description });
          const rest = (left.has(node.item) ? left.get(node.item)! : (stock[kind].get(node.item) ?? 0)) - node.qty;
          left.set(node.item, rest);
          cell.parts.push({ item: node.item, kind, qty: node.qty, left: rest, source: node.source });
          (demands.get(node.item) ?? demands.set(node.item, []).get(node.item)!).push({ lot: o.lot, productionNumber: o.productionNumber, door, panel, planned: o.planned, status, qty: node.qty });
        }
      }
      for (const kind of cell.unknown) unknownByKind[kind]++;
      if (door !== 'HB') {
        if (cell.unknown.length) unknown++;
        else known++;
      }
      cell.state = cell.parts.some((p) => p.left < -1e-9) ? 'short' : cell.parts.length ? 'ok' : cell.unknown.length ? 'unknown' : 'none';
      if (cell.state === 'short') car.short = true;
    }
    return car;
  });

  // Dny od dneška do poslední plánované stavby; dřívější stavba (a bez data) se počítá do „po termínu“.
  const stamps = [...demands.values()].flat().flatMap((d) => (d.planned === null ? [] : [dayOfStamp(d.planned)]));
  const last = Math.max(today, ...stamps);
  const days = Array.from({ length: last - today + 1 }, (_, k) => today + k);

  const parts = [...demands].map(([item, list]): PartCoverage => {
    const { kind, description } = info.get(item)!;
    const perDay = days.map(() => 0);
    let overdue = 0;
    for (const d of list) {
      const day = d.planned === null ? null : dayOfStamp(d.planned);
      if (day === null || day < today) overdue += d.qty;
      else perDay[day - today]! += d.qty;
    }
    const own = stock[kind].get(item);
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
      kind,
      description,
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
  // Nejdřív MC, pak MF; v nich díly, které chybí nejdřív; pak podle čísla.
  const shortAt = (p: PartCoverage) => (p.firstShort ? (p.firstShort.planned ?? -Infinity) : Infinity);
  parts.sort((a, b) => PART_KINDS.indexOf(a.kind) - PART_KINDS.indexOf(b.kind) || shortAt(a) - shortAt(b) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  return { days, cars, parts, doors, skippedDone, known, unknown, unknownByKind };
}

/** Chybějící MC a MF vozu po dveřích (pro sloupec Materiál). */
export function carMissing(car: CarCoverage): { door: Door; kind: PartKind; item: string }[] {
  return DOORS.flatMap((door) => (car.doors[door]?.parts ?? []).filter((p) => p.left < -1e-9).map((p) => ({ door, kind: p.kind, item: p.item })));
}

/** Díly vozu, které nejde určit (nejsou v klíči ani v JIT), po druzích: MC → [FL, FR]. Do potřeby se nepočítají. */
export function carUndetermined(car: CarCoverage): { kind: PartKind; doors: Door[] }[] {
  return PART_KINDS.map((kind) => ({ kind, doors: DOORS.filter((d) => car.doors[d]?.unknown.includes(kind)) })).filter((u) => u.doors.length > 0);
}

/** Kombinace dveří, výbavy a barvy, které v klíči MC/MF chybí: kolik dveří se kvůli nim nepočítá a od kdy. */
export interface MissingKey {
  kind: PartKind;
  door: Door;
  optionType: string;
  colour: string;
  doors: number;
  first: Stamp | null;
}

export function missingKeys(cars: readonly CarCoverage[]): MissingKey[] {
  const byKey = new Map<string, MissingKey>();
  // Vozy jsou v pořadí stavby: první výskyt kombinace je nejdřívější.
  for (const car of cars)
    for (const door of DOORS)
      for (const kind of car.doors[door]?.unknown ?? []) {
        const colour = partColour(car.colors, kind);
        const id = `${kind}|${door}|${car.optionType}|${colour}`;
        const entry = byKey.get(id) ?? byKey.set(id, { kind, door, optionType: car.optionType, colour, doors: 0, first: car.planned }).get(id)!;
        entry.doors++;
      }
  return [...byKey.values()].sort(
    (a, b) =>
      PART_KINDS.indexOf(a.kind) - PART_KINDS.indexOf(b.kind) ||
      a.optionType.localeCompare(b.optionType, 'en', { numeric: true }) ||
      DOORS.indexOf(a.door) - DOORS.indexOf(b.door) ||
      a.colour.localeCompare(b.colour, 'en', { numeric: true }),
  );
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
