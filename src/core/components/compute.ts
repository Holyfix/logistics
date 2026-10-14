// Pokrytí komponent podle odvolávek: odvolávky hotových dílů × kusovník, odečtené od našeho skladu komponent
// (volitelně se nejdřív spotřebuje náš sklad hotových dílů a mezivýroby). „Zákazník pokryt do“: do kdy pokryjeme
// zákazníka podle coverage (jeho sklad + transit) naším skladem hotových dílů, mezivýrobou a výrobou z komponent.

import type { BomData, BomNode } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { weekday, type DayNumber } from '../dates';
import { callOffDemand, customerNeed, sequencerPlans } from '../demand';
import type { MasterData } from '../masterdata';

/** Horizont pokrytí komponent ve dnech (od dneška). */
export const COMPONENT_DAYS = 14;

/** Za kolik prvních dnů se počítá průměrná spotřeba pro zásobu ve dnech výroby. */
export const RESERVE_DAYS = 7;

/** Komponenty v záporu „brzy“: dnes nebo zítra (modul i rozcestník). */
export const COMPONENT_SOON_DAYS = 2;

/** Hotový díl po dnech horizontu. */
export interface ProductDemand {
  item: string;
  description: string;
  project: string;
  /** Odvolávky zákazníka. */
  callOffs: number[];
  /** Potřeba výroby: odvolávky, které nepokryje náš sklad hotového dílu (bez odečtu skladu = odvolávky). */
  production: number[];
  /**
   * Chybějící množství u zákazníka: ve dnech souboru coverage přírůstek záporného stavu (sklad + transit u zákazníka
   * − plán zákazníka; chybějící kusy z minulých dnů patří do dneška), za koncem souboru odvolávky po spotřebování
   * zbytku u zákazníka. Bez souboru coverage odvolávky.
   */
  customerNeed: number[];
  /** Index prvního dne, kdy chybějící množství u zákazníka nepokryje náš sklad hotového dílu; null = pokryje. */
  finishedShortDay: number | null;
}

export interface ComponentLine {
  item: string;
  description: string;
  um: string;
  /** P = nakupovaný, L/M = vyráběný. */
  source: string;
  /** Náš sklad; null, když soubor skladu není načtený. */
  stock: number | null;
  /** Potřeba komponenty po dnech: potřeba výroby hotových dílů podle odvolávek × kusovník (po odečtu mezivýroby). */
  usage: number[];
  /** Stav na konci dne: sklad − kumulovaná potřeba (bez skladu od 0). Záporné = kolik chybí na odvolávky. */
  balance: number[];
  /** Index prvního dne v záporu (první chybějící komponenta podle odvolávek); null, když vystačí na celý horizont. */
  shortDay: number | null;
  /**
   * Zákazník pokryt do (rámeček): index prvního dne, kdy chybějící množství u zákazníka (podle coverage) nepokryje
   * náš sklad hotových dílů, mezivýroba ani výroba z našeho skladu komponenty; null = pokryje celý horizont.
   */
  customerShortDay: number | null;
  /** Jen náš sklad hotových dílů: index prvního dne, kdy u některého hotového dílu s komponentou chybí; null = pokryje. */
  finishedShortDay: number | null;
  /** Průměrná spotřeba za den výroby podle odvolávek za prvních 7 dní (pracovní dny po–pá). */
  avgDaily: number;
  /** Zásoba komponenty ve dnech výroby (sklad ÷ průměrná spotřeba); null bez spotřeby. */
  productionDays: number | null;
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

/**
 * Rozpad potřeby hotových dílů den po dni jako v MRP (bez doby výroby): potřeba hotového dílu se nejdřív kryje z našeho
 * skladu hotových dílů, zbytek je potřeba výroby; ta se rozpadne podle kusovníku, vyráběné díly (mezivýroba) se kryjí
 * ze svého skladu a teprve zbytek jde o úroveň níž. Nakupované díly se nerozpadají. Bez odečtu skladu (`netOwnStock`)
 * se sklad hotových dílů a mezivýroby nepoužije. Vrátí potřebu výroby hotových dílů a potřebu sledovaných dílů po dnech.
 */
function explode(
  bom: BomData,
  items: readonly string[],
  need: readonly (readonly number[])[],
  days: number,
  stock: ReadonlyMap<string, number> | undefined,
  netOwnStock: boolean,
  tracked: ReadonlySet<string>,
): { usage: Map<string, number[]>; production: number[][] } {
  const production = items.map(() => Array.from({ length: days }, () => 0));
  const left = new Map(netOwnStock ? (stock ?? []) : []);
  const usage = new Map<string, number[]>();
  const record = (item: string, qty: number, day: number) => {
    let u = usage.get(item);
    if (!u) usage.set(item, (u = Array.from({ length: days }, () => 0)));
    u[day]! += qty;
  };
  const fromStock = (item: string, qty: number) => {
    const used = Math.min(Math.max(0, left.get(item) ?? 0), qty);
    if (used > 0) left.set(item, left.get(item)! - used);
    return qty - used;
  };
  const consume = (item: string, qty: number, children: readonly BomNode[], day: number) => {
    if (tracked.has(item)) record(item, qty, day);
    if (children.length === 0 || bom.info.get(item)?.source === 'P') return;
    const rest = fromStock(item, qty);
    if (rest > 1e-9) for (const child of children) consume(child.item, rest * child.qty, child.children, day);
  };
  for (let day = 0; day < days; day++) {
    items.forEach((item, i) => {
      const q = need[i]![day]!;
      if (q <= 0) return;
      const rest = fromStock(item, q);
      production[i]![day] = rest;
      if (rest > 1e-9) for (const child of bom.trees.get(item) ?? []) consume(child.item, rest * child.qty, child.children, day);
    });
  }
  return { usage, production };
}

export interface ComponentInputs {
  bom: BomData;
  master: MasterData | undefined;
  /** Soubory pokrytí od sekvencéra: sklad + transit a plán zákazníka (chybějící množství je potřeba na nás). */
  coverage?: readonly CoverageSource[];
  /** Nejnovější export odvolávek. */
  callOffs: CallOffExport | undefined;
  /** Náš sklad po dílech (velkými písmeny); undefined, když soubor skladu není načtený. */
  stock: ReadonlyMap<string, number> | undefined;
  today: DayNumber;
  /** Odečíst náš sklad hotových dílů a mezivýroby (výchozí ne: jen odvolávky a sklad komponent). */
  netOwnStock?: boolean;
}

/**
 * Pokrytí komponent podle odvolávek. Potřeba = odvolávky × kusovník; stav = náš sklad komponenty − kumulovaná potřeba.
 * S `netOwnStock` se odvolávky nejdřív kryjí naším skladem hotových dílů a mezivýroby (jako MRP).
 * „Zákazník pokryt do“: chybějící množství u zákazníka podle coverage se vždy nejdřív kryje naším skladem hotových
 * dílů, pak mezivýrobou a nakonec výrobou z našeho skladu komponenty (jako MRP, bez doby výroby).
 */
export function buildComponents({ bom, master, coverage = [], callOffs, stock, today, netOwnStock = false }: ComponentInputs): ComponentTable {
  const days = Array.from({ length: COMPONENT_DAYS }, (_, k) => today + k);
  const calls = callOffDemand(callOffs);
  const plans = sequencerPlans(coverage, master);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));

  const products: ProductDemand[] = [...bom.parents.keys()].sort().map((item) => {
    const callOffQty = days.map((d) => calls.get(item)?.get(d) ?? 0);
    const m = masterByItem.get(item);
    return {
      item,
      description: m?.description || bom.info.get(item)?.description || '',
      project: m?.project || bom.info.get(item)?.project || '',
      callOffs: callOffQty,
      production: days.map(() => 0),
      customerNeed: customerNeed(callOffQty, days, plans.get(item)).need,
      finishedShortDay: null,
    };
  });

  const byMapping = master?.hasComponentColumn ?? false;
  const wanted = (item: string) => (byMapping ? masterByItem.get(item)?.componentCoverage === true : bom.info.get(item)?.source === 'P');

  // Průměrná spotřeba pro zásobu: odvolávky za prvních 7 dní ÷ pracovní dny po–pá v nich (o víkendu odvolávky nebývají).
  const workDays = days.slice(0, RESERVE_DAYS).filter((d) => weekday(d) <= 5).length || 1;
  const lines = new Map<string, ComponentLine>();
  for (const product of products) {
    const callOffTotal = product.callOffs.slice(0, RESERVE_DAYS).reduce((a, b) => a + b, 0);
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
          customerShortDay: null,
          finishedShortDay: null,
          avgDaily: 0,
          productionDays: null,
          products: [],
          projects: [],
        };
        lines.set(component.item, line);
      }
      line.avgDaily += (callOffTotal * component.qty) / workDays;
      line.products.push(product.item);
      if (product.project && !line.projects.includes(product.project)) line.projects.push(product.project);
    }
  }

  const tracked = new Set(lines.keys());
  const productBy = new Map(products.map((p) => [p.item, p]));
  const items = products.map((p) => p.item);
  // Zákazník podle coverage: vždy s odečtem našeho skladu hotových dílů a mezivýroby.
  const forCustomer = explode(bom, items, products.map((p) => p.customerNeed), days.length, stock, true, tracked);
  for (const p of products) {
    let left = Math.max(0, stock?.get(p.item) ?? 0);
    const k = p.customerNeed.findIndex((q) => (left -= q) < -1e-9);
    p.finishedShortDay = k === -1 ? null : k;
  }
  const firstShort = (stockQty: number, usage: readonly number[] | undefined) => {
    let left = stockQty;
    const k = (usage ?? []).findIndex((u) => (left -= u) < -1e-9);
    return k === -1 ? null : k;
  };
  const earliest = (values: readonly (number | null)[]) => values.reduce<number | null>((a, b) => (b === null ? a : a === null ? b : Math.min(a, b)), null);
  const byCallOffs = explode(bom, items, products.map((p) => p.callOffs), days.length, stock, netOwnStock, tracked);
  products.forEach((p, i) => (p.production = byCallOffs.production[i]!));
  for (const line of lines.values()) {
    line.usage = byCallOffs.usage.get(line.item) ?? days.map(() => 0);
    let left = line.stock ?? 0;
    line.balance = line.usage.map((u) => (left -= u));
    const k = line.balance.findIndex((v) => v < -1e-9);
    line.shortDay = k === -1 ? null : k;
    line.customerShortDay = firstShort(line.stock ?? 0, forCustomer.usage.get(line.item));
    line.finishedShortDay = earliest(line.products.map((item) => productBy.get(item)!.finishedShortDay));
    line.productionDays = line.avgDaily > 0 ? Math.max(0, line.stock ?? 0) / line.avgDaily : null;
    line.projects.sort();
  }

  const components = [...lines.values()].sort((a, b) => (a.shortDay ?? Infinity) - (b.shortDay ?? Infinity) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  const inBom = new Set(bom.info.keys());
  const markedNotInBom = byMapping ? [...masterByItem.values()].filter((m) => m.componentCoverage && !inBom.has(m.item.toUpperCase())).map((m) => m.item) : [];
  return { days, products, components, byMapping, markedNotInBom };
}
