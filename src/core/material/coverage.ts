// Pokrytí Maincarrieru (MC) a Middlefieldu (MF): JIT zakázky po dveřích → dveřní panel (pozice, která je v kusovníku)
// → MC a MF pod panelem na úrovni 1 kusovníku. Potřeba v čase montáže u zákazníka, odečtená od ručně zadaného skladu.

import type { BomData } from '../bom';
import type { DayNumber } from '../dates';
import { dayOfStamp, doorOf, type Door, type JitPosition, type Stamp } from './jit';
import { statusCode, type MatrixOrder } from './matrix';

export type PartKind = 'MC' | 'MF';
export const PART_KINDS: readonly PartKind[] = ['MC', 'MF'];

/** Stav „Packed“ a vyšší: dveře jsou hotové (lze je volitelně nepočítat do potřeby). */
export const DONE_STATUS = 50;

/** Druh dílu podle popisu v kusovníku: „ASSY MC …“ = Maincarrier, „ASSY MF …“ = Middlefield. */
export function partKind(description: string): PartKind | null {
  const d = description.toUpperCase();
  if (/\bMC\b/.test(d)) return 'MC';
  if (/\bMF\b/.test(d)) return 'MF';
  return null;
}

/** Zakázka na jedny dveře, která díl potřebuje. */
export interface Demand {
  order: string;
  productionNumber: string;
  door: Door | null;
  panel: string;
  assembly: Stamp | null;
  /** Stav dveří z Order Status Matrix, jinak z JIT (Last priority). */
  status: string;
  qty: number;
}

export interface PartCoverage {
  item: string;
  kind: PartKind;
  description: string;
  /** Ručně zadaný sklad; null = nezadaný (počítá se jako 0). */
  stock: number | null;
  total: number;
  /** Potřeba po termínu (montáž před dneškem nebo bez data). */
  overdue: number;
  /** Potřeba po dnech `days`. */
  perDay: number[];
  /** Stav na konci dne po dnech `days` (sklad − kumulovaná potřeba včetně po termínu). */
  balance: number[];
  /** Poslední zakázka, na kterou sklad ještě stačí; null = nestačí ani na první. */
  lastCovered: Demand | null;
  /** První zakázka, na kterou sklad nestačí; null = pokryje všechny. */
  firstShort: Demand | null;
  /** Zakázky v pořadí montáže. */
  demands: Demand[];
}

export interface MaterialCoverage {
  days: DayNumber[];
  parts: PartCoverage[];
  /** Zakázky (dveře) v JIT celkem a z nich započítané. */
  orders: number;
  counted: number;
  /** Nepočítané hotové dveře (stav Packed a výš), když se vynechávají. */
  skippedDone: number;
  /** Zakázky, u kterých žádná pozice není dveřní panel z kusovníku (čísla panelů / zakázek pro kontrolu). */
  withoutPanel: string[];
  /** Production numbers v JIT. */
  productionNumbers: number;
}

export interface MaterialInputs {
  positions: readonly JitPosition[];
  bom: BomData;
  matrix?: ReadonlyMap<string, MatrixOrder> | undefined;
  stock: ReadonlyMap<string, number>;
  today: DayNumber;
  /** Nepočítat dveře, které jsou podle matice zabalené nebo odeslané (stav 50 a víc). */
  skipDone?: boolean;
}

export function buildMaterialCoverage({ positions, bom, matrix, stock, today, skipDone = false }: MaterialInputs): MaterialCoverage {
  const orders = new Map<string, JitPosition[]>();
  for (const p of positions) (orders.get(p.order) ?? orders.set(p.order, []).get(p.order)!).push(p);

  const demands = new Map<string, Demand[]>();
  const withoutPanel: string[] = [];
  let counted = 0;
  let skippedDone = 0;
  for (const [order, list] of orders) {
    const panel = list.find((p) => bom.trees.has(p.article));
    if (!panel) {
      withoutPanel.push(`${list[0]!.productionNumber} (${order})`);
      continue;
    }
    const door = doorOf(bom.info.get(panel.article)?.description || panel.description);
    const status = (door && matrix?.get(panel.productionNumber)?.status[door]) || panel.status;
    if (skipDone && (statusCode(status) ?? 0) >= DONE_STATUS) {
      skippedDone++;
      continue;
    }
    counted++;
    for (const node of bom.trees.get(panel.article) ?? []) {
      const kind = partKind(bom.info.get(node.item)?.description ?? '');
      if (!kind) continue;
      const demand: Demand = { order, productionNumber: panel.productionNumber, door, panel: panel.article, assembly: panel.assembly, status, qty: node.qty };
      (demands.get(node.item) ?? demands.set(node.item, []).get(node.item)!).push(demand);
    }
  }

  // Dny od dneška do poslední montáže; dřívější montáže (a bez data) jsou „po termínu“.
  const stamps = [...demands.values()].flat().flatMap((d) => (d.assembly === null ? [] : [dayOfStamp(d.assembly)]));
  const last = Math.max(today, ...stamps);
  const days = Array.from({ length: last - today + 1 }, (_, k) => today + k);

  const parts = [...demands].map(([item, list]): PartCoverage => {
    list.sort((a, b) => (a.assembly ?? -Infinity) - (b.assembly ?? -Infinity) || a.productionNumber.localeCompare(b.productionNumber));
    const perDay = days.map(() => 0);
    let overdue = 0;
    for (const d of list) {
      const day = d.assembly === null ? null : dayOfStamp(d.assembly);
      if (day === null || day < today) overdue += d.qty;
      else perDay[day - today]! += d.qty;
    }
    const own = stock.get(item);
    let left = (own ?? 0) - overdue;
    const balance = perDay.map((q) => (left -= q));
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
    const kind = partKind(bom.info.get(item)?.description ?? '')!;
    return {
      item,
      kind,
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
  // Nejdřív díly, které chybí nejdřív (zakázka po termínu nejdřív); pak podle čísla.
  const shortAt = (p: PartCoverage) => (p.firstShort ? (p.firstShort.assembly ?? -Infinity) : Infinity);
  parts.sort(
    (a, b) =>
      PART_KINDS.indexOf(a.kind) - PART_KINDS.indexOf(b.kind) ||
      shortAt(a) - shortAt(b) ||
      a.item.localeCompare(b.item, 'en', { numeric: true }),
  );
  return { days, parts, orders: orders.size, counted, skippedDone, withoutPanel, productionNumbers: new Set(positions.map((p) => p.productionNumber)).size };
}
