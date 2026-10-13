// Pokrytí komponent přes kusovník: poptávka hotových dílů × kusovník, odečtená od našeho skladu.

import type { BomData } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import type { DayNumber } from '../dates';
import type { MasterData } from '../masterdata';

/** Horizont pokrytí komponent ve dnech (od dneška). */
export const COMPONENT_DAYS = 14;

/** Poptávka hotového dílu po dnech horizontu; `fixed[k]` = den je ze souboru zákazníka, jinak z odvolávek. */
export interface ProductDemand {
  item: string;
  description: string;
  project: string;
  qty: number[];
  fixed: boolean[];
}

export interface ComponentLine {
  item: string;
  description: string;
  um: string;
  /** P = nakupovaný, L/M = vyráběný. */
  source: string;
  /** Náš sklad; null, když soubor skladu není načtený. */
  stock: number | null;
  /** Spotřeba po dnech horizontu. */
  usage: number[];
  /** Stav na konci dne: sklad − kumulovaná spotřeba (bez skladu od 0). */
  balance: number[];
  /** Index prvního dne v záporu; null, když vystačí na celý horizont. */
  shortDay: number | null;
  /** Hotové díly, ve kterých je komponenta. */
  products: string[];
  projects: string[];
}

export interface ComponentTable {
  days: DayNumber[];
  products: ProductDemand[];
  components: ComponentLine[];
  /** Komponenty se vybírají podle sloupce Component Coverage v mapování (jinak všechny nakupované). */
  byMapping: boolean;
  /** Označené komponenty, které v žádném kusovníku nejsou. */
  markedNotInBom: string[];
}

/** Denní spotřeba u zákazníka ze souboru pokrytí: pokles zůstatku bez transitu (příjem se nepočítá). */
export function dailyDemand(customerStock: number, balance: readonly number[]): number[] {
  let previous = customerStock;
  return balance.map((value) => {
    const demand = Math.max(0, previous - value);
    previous = value;
    return demand;
  });
}

interface CustomerDemand {
  first: DayNumber;
  last: DayNumber;
  byDay: Map<DayNumber, number>;
}

/** Poptávka ze souborů zákazníka po našich číslech dílů (spárované přes mapování). */
function customerDemand(sources: readonly CoverageSource[], master: MasterData | undefined): Map<string, CustomerDemand> {
  const result = new Map<string, CustomerDemand>();
  for (const { report } of sources) {
    const first = report.days[0];
    const last = report.days.at(-1);
    if (first === undefined || last === undefined) continue;
    for (const row of report.rows) {
      const m = master?.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master?.items.get(row.supplierItem) : undefined);
      const item = (m?.item ?? row.supplierItem).toUpperCase();
      if (!item) continue;
      const entry = result.get(item) ?? { first, last, byDay: new Map<DayNumber, number>() };
      entry.first = Math.min(entry.first, first);
      entry.last = Math.max(entry.last, last);
      dailyDemand(row.customerStock, row.balance).forEach((q, k) => {
        const day = report.days[k]!;
        entry.byDay.set(day, (entry.byDay.get(day) ?? 0) + q);
      });
      result.set(item, entry);
    }
  }
  return result;
}

/** Odvolávky po dnech pro díly (velkými písmeny). */
function callOffDemand(exp: CallOffExport | undefined): Map<string, Map<DayNumber, number>> {
  const result = new Map<string, Map<DayNumber, number>>();
  if (!exp) return result;
  exp.items.forEach((item, i) => {
    const byDay = new Map<DayNumber, number>();
    for (let k = exp.offsets[i]!; k < exp.offsets[i + 1]!; k++) byDay.set(exp.days[k]!, (byDay.get(exp.days[k]!) ?? 0) + exp.qty[k]!);
    result.set(item.toUpperCase(), byDay);
  });
  return result;
}

export interface ComponentInputs {
  bom: BomData;
  master: MasterData | undefined;
  coverage: readonly CoverageSource[];
  /** Nejnovější export odvolávek. */
  callOffs: CallOffExport | undefined;
  /** Náš sklad po dílech (velkými písmeny); undefined, když soubor skladu není načtený. */
  stock: ReadonlyMap<string, number> | undefined;
  today: DayNumber;
}

/**
 * Poptávka hotového dílu na den: ze souboru zákazníka, pokud ten den pokrývá (fix), jinak z odvolávek (forecast).
 * Spotřeba komponenty = poptávka hotových dílů × množství z kusovníku (hrubý rozpad, zásoba mezivýrob se neodečítá).
 */
export function buildComponents({ bom, master, coverage, callOffs, stock, today }: ComponentInputs): ComponentTable {
  const days = Array.from({ length: COMPONENT_DAYS }, (_, k) => today + k);
  const customer = customerDemand(coverage, master);
  const calls = callOffDemand(callOffs);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));

  const products: ProductDemand[] = [...bom.parents.keys()].sort().map((item) => {
    const c = customer.get(item);
    const fixed = days.map((d) => c !== undefined && d >= c.first && d <= c.last);
    const qty = days.map((d, k) => (fixed[k] ? (c!.byDay.get(d) ?? 0) : (calls.get(item)?.get(d) ?? 0)));
    const m = masterByItem.get(item);
    return { item, description: m?.description || bom.info.get(item)?.description || '', project: m?.project ?? '', qty, fixed };
  });

  const byMapping = master?.hasComponentColumn ?? false;
  const wanted = (item: string) => (byMapping ? masterByItem.get(item)?.componentCoverage === true : bom.info.get(item)?.source === 'P');

  const lines = new Map<string, ComponentLine>();
  for (const product of products) {
    for (const component of bom.parents.get(product.item) ?? []) {
      if (!wanted(component.item)) continue;
      let line = lines.get(component.item);
      if (!line) {
        const i = bom.info.get(component.item);
        line = {
          item: component.item,
          description: masterByItem.get(component.item)?.description || i?.description || '',
          um: i?.um ?? '',
          source: i?.source ?? '',
          stock: stock ? (stock.get(component.item) ?? 0) : null,
          usage: days.map(() => 0),
          balance: [],
          shortDay: null,
          products: [],
          projects: [],
        };
        lines.set(component.item, line);
      }
      product.qty.forEach((q, k) => (line.usage[k]! += q * component.qty));
      line.products.push(product.item);
      if (product.project && !line.projects.includes(product.project)) line.projects.push(product.project);
    }
  }

  for (const line of lines.values()) {
    let left = line.stock ?? 0;
    line.balance = line.usage.map((u) => (left -= u));
    const k = line.balance.findIndex((v) => v < -1e-9);
    line.shortDay = k === -1 ? null : k;
    line.projects.sort();
  }

  const components = [...lines.values()].sort((a, b) => (a.shortDay ?? Infinity) - (b.shortDay ?? Infinity) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  const inBom = new Set(bom.info.keys());
  const markedNotInBom = byMapping ? [...masterByItem.values()].filter((m) => m.componentCoverage && !inBom.has(m.item.toUpperCase())).map((m) => m.item) : [];
  return { days, products, components, byMapping, markedNotInBom };
}
