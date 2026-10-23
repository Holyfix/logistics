// Pokrytí komponent: potřeba hotových dílů podle coverage (co zákazníkovi chybí po jeho skladu a transitu; bez souboru
// coverage odvolávky) × kusovník, odečtená od našeho skladu komponent (volitelně se nejdřív spotřebuje náš sklad hotových
// dílů a mezivýroby). „Zákazník pokryt do“: do kdy je zákazník
// pokrytý hotovými díly podle coverage (jeho sklad + transit, volitelně i náš sklad hotových dílů).

import type { BomData, BomNode } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import type { DayNumber } from '../dates';
import { callOffDemand, customerNeed, sequencerPlans } from '../demand';
import type { MasterData } from '../masterdata';

/** Horizont pokrytí komponent ve dnech (od dneška). */
export const COMPONENT_DAYS = 14;

/** Komponenty v záporu „brzy“: dnes nebo zítra (modul i rozcestník). */
export const COMPONENT_SOON_DAYS = 2;

/** Hotový díl po dnech horizontu. */
export interface ProductDemand {
  item: string;
  description: string;
  project: string;
  /** Kategorie z mapování (sloupec Category, např. DP, HB). */
  category: string;
  /** Odvolávky zákazníka. */
  callOffs: number[];
  /** Potřeba výroby: potřeba (customerNeed), kterou nepokryje náš sklad hotového dílu (bez odečtu skladu = potřeba). */
  production: number[];
  /**
   * Chybějící množství u zákazníka: ve dnech souboru coverage přírůstek záporného stavu (sklad + transit u zákazníka
   * − plán zákazníka; chybějící kusy z minulých dnů patří do dneška), za koncem souboru odvolávky po spotřebování
   * zbytku u zákazníka. Bez souboru coverage odvolávky.
   */
  customerNeed: number[];
  /**
   * Zákazník pokryt do: index prvního dne, kdy u zákazníka chybí hotový díl (jeho sklad + transit; s odečtem našeho
   * skladu i náš sklad hotového dílu); null = pokryto celý horizont.
   */
  customerShortDay: number | null;
  /** Hotový díl má soubor coverage (jinak sklad a transit u zákazníka neznáme a Zákazník pokryt do se neurčuje). */
  hasCoverage: boolean;
}

export interface ComponentLine {
  item: string;
  description: string;
  um: string;
  /** P = nakupovaný, L/M = vyráběný. */
  source: string;
  /** Náš sklad; null, když soubor skladu není načtený. */
  stock: number | null;
  /** Potřeba komponenty po dnech: potřeba výroby hotových dílů (coverage, jinak odvolávky) × kusovník (po odečtu mezivýroby). */
  usage: number[];
  /** Stav na konci dne: sklad − kumulovaná potřeba (bez skladu od 0). Záporné = kolik chybí na odvolávky. */
  balance: number[];
  /** Index prvního dne v záporu (první chybějící komponenta); null, když vystačí na celý horizont. */
  shortDay: number | null;
  /**
   * Zákazník pokryt do (rámeček): první den, kdy u zákazníka chybí některý z hotových dílů s komponentou (každý díl
   * zvlášť, ne součet); null = všechny pokryté celý horizont. Jen hotové díly se souborem coverage.
   */
  customerShortDay: number | null;
  /** Aspoň jeden hotový díl s komponentou má soubor coverage. */
  customerKnown: boolean;
  /**
   * Zásoba ve dnech potřeby: od prvního dne s potřebou se sklad spotřebovává den po dni (dny bez potřeby se nepočítají);
   * celý pokrytý den = 1, poslední částečně pokrytý den = zbytek skladu ÷ potřeba dne (sklad 150, potřeba 100 a 100 → 1,5).
   */
  stockDays: number;
  /** Zásoba vystačí na celou potřebu horizontu (stockDays je pak počet dní s potřebou, ve skutečnosti víc). */
  stockLastsHorizon: boolean;
  /** Hotové díly, ve kterých je komponenta. */
  products: string[];
  projects: string[];
  /** Kategorie hotových dílů, ve kterých komponenta je (z mapování). */
  categories: string[];
}

export interface ComponentTable {
  days: DayNumber[];
  products: ProductDemand[];
  components: ComponentLine[];
  /** Mapování uvádí druh dílu (Item Type); sledují se díly PG, bez druhu se nesleduje nic. */
  byMapping: boolean;
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

/** Zásoba ve dnech potřeby (viz ComponentLine.stockDays). */
export function stockDaysOf(stock: number, usage: readonly number[]): { stockDays: number; stockLastsHorizon: boolean } {
  let left = Math.max(0, stock);
  let days = 0;
  for (const u of usage) {
    if (u <= 1e-9) continue;
    if (left >= u - 1e-9) {
      left -= u;
      days++;
    } else return { stockDays: days + left / u, stockLastsHorizon: false };
  }
  return { stockDays: days, stockLastsHorizon: true };
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
 * Pokrytí komponent. Potřeba hotového dílu = co zákazníkovi chybí podle coverage (jeho sklad + transit − plán; za koncem
 * souboru odvolávky po odečtu zbytku u zákazníka), bez souboru coverage odvolávky; × kusovník. Stav = náš sklad
 * komponenty − kumulovaná potřeba. S `netOwnStock` se potřeba nejdřív kryje naším skladem hotových dílů a mezivýroby (jako MRP).
 * „Zákazník pokryt do“: první den, kdy u zákazníka chybí některý hotový díl s komponentou (každý díl zvlášť) podle
 * coverage (jeho sklad + transit); s `netOwnStock` se započítá i náš sklad hotového dílu.
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
      // Popis z mapování; hotový díl, který v mapování není, s popisem z kusovníku (jen aby šel poznat).
      description: m ? m.description : (bom.info.get(item)?.description ?? ''),
      project: m?.project ?? '',
      category: m?.category ?? '',
      callOffs: callOffQty,
      production: days.map(() => 0),
      customerNeed: customerNeed(callOffQty, days, plans.get(item)).need,
      customerShortDay: null,
      hasCoverage: plans.has(item),
    };
  });

  // Sledované komponenty jen podle mapování: všechny nakupované díly (Item Type = PG).
  const byMapping = master?.columns.has('kind') ?? false;
  const wanted = (item: string) => masterByItem.get(item)?.kind === 'PG';

  const lines = new Map<string, ComponentLine>();
  for (const product of products) {
    for (const component of bom.parents.get(product.item) ?? []) {
      if (!wanted(component.item)) continue;
      let line = lines.get(component.item);
      if (!line) {
        const i = bom.info.get(component.item);
        line = {
          item: component.item,
          // Sledují se jen díly z mapování (PG): popis jen z mapování.
          description: masterByItem.get(component.item)?.description ?? '',
          um: i?.um ?? '',
          source: i?.source ?? '',
          stock: stock ? (stock.get(component.item) ?? 0) : null,
          usage: days.map(() => 0),
          balance: [],
          shortDay: null,
          customerShortDay: null,
          customerKnown: false,
          stockDays: 0,
          stockLastsHorizon: false,
          products: [],
          projects: [],
          categories: [],
        };
        lines.set(component.item, line);
      }
      line.products.push(product.item);
      if (product.project && !line.projects.includes(product.project)) line.projects.push(product.project);
      if (product.category && !line.categories.includes(product.category)) line.categories.push(product.category);
    }
  }

  const tracked = new Set(lines.keys());
  const productBy = new Map(products.map((p) => [p.item, p]));
  const items = products.map((p) => p.item);
  // Zákazník pokryt do: každý hotový díl zvlášť; jeho sklad + transit (chybějící množství), s odečtem i náš sklad.
  for (const p of products) {
    let left = netOwnStock ? Math.max(0, stock?.get(p.item) ?? 0) : 0;
    const k = p.customerNeed.findIndex((q) => (left -= q) < -1e-9);
    p.customerShortDay = k === -1 ? null : k;
  }
  const earliest = (values: readonly (number | null)[]) => values.reduce<number | null>((a, b) => (b === null ? a : a === null ? b : Math.min(a, b)), null);
  // Potřeba hotových dílů: co zákazníkovi chybí podle coverage, bez souboru coverage odvolávky.
  const exploded = explode(bom, items, products.map((p) => p.customerNeed), days.length, stock, netOwnStock, tracked);
  products.forEach((p, i) => (p.production = exploded.production[i]!));
  for (const line of lines.values()) {
    line.usage = exploded.usage.get(line.item) ?? days.map(() => 0);
    let left = line.stock ?? 0;
    line.balance = line.usage.map((u) => (left -= u));
    const k = line.balance.findIndex((v) => v < -1e-9);
    line.shortDay = k === -1 ? null : k;
    Object.assign(line, stockDaysOf(line.stock ?? 0, line.usage));
    const covered = line.products.map((item) => productBy.get(item)!).filter((p) => p.hasCoverage);
    line.customerKnown = covered.length > 0;
    line.customerShortDay = earliest(covered.map((p) => p.customerShortDay));
    line.projects.sort();
    line.categories.sort();
  }

  const components = [...lines.values()].sort((a, b) => (a.shortDay ?? Infinity) - (b.shortDay ?? Infinity) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  return { days, products, components, byMapping };
}
