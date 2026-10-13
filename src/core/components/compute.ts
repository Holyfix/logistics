// Pokrytí komponent přes kusovník: poptávka hotových dílů × kusovník, odečtená od našeho skladu.

import type { BomData, BomNode } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { weekday, type DayNumber } from '../dates';
import type { MasterData } from '../masterdata';

/** Horizont pokrytí komponent ve dnech (od dneška). */
export const COMPONENT_DAYS = 14;

/** Komponenty v záporu „brzy“: dnes nebo zítra (modul i rozcestník). */
export const COMPONENT_SOON_DAYS = 2;

/** Poptávka hotového dílu po dnech horizontu (z odvolávek). */
export interface ProductDemand {
  item: string;
  description: string;
  project: string;
  qty: number[];
  /** Sklad u sekvencéru (ze souboru Coverage); null, když hotový díl v souborech Coverage není. */
  sequencerStock: number | null;
  /** Transit k sekvencéru, který dorazí během horizontu (kumulativně po dnech). */
  sequencerTransit: number[] | null;
  /** Náš sklad hotového dílu; null, když soubor skladu není načtený. */
  ourStock: number | null;
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
  /** Průměrná spotřeba za den výroby (pracovní dny po–pá v horizontu). */
  avgDaily: number;
  /** Na kolik dní výroby stačí samotná komponenta (sklad ÷ průměrná spotřeba); null bez spotřeby. */
  productionDays: number | null;
  /**
   * Index prvního dne, kdy kvůli komponentě nejsou pokryté odvolávky, když se nejdřív spotřebují hotové díly
   * a mezivýroba na skladě (výpočet jako MRP). null = pokryto na celý horizont nebo nejde určit (díl se vyrábí).
   */
  customerShortDay: number | null;
  /** Pokrytí zákazníka jde u dílu určit (nakupuje se nebo pod ním v kusovníku nic není). */
  customerKnown: boolean;
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

/**
 * Čistý rozpad jako v MRP, den po dni: poptávka hotového dílu se nejdřív kryje ze skladu hotových dílů, zbytek se
 * rozpadne na komponenty; vyráběné díly (mezivýroba) se kryjí ze svého skladu a teprve zbytek jde o úroveň níž.
 * Vrátí první den, kdy nakupovanému dílu (nebo dílu bez dalšího rozpadu) chybí zásoba. Bez průběžné doby výroby.
 */
function customerShortDays(bom: BomData, products: readonly ProductDemand[], stock: ReadonlyMap<string, number> | undefined): Map<string, number> {
  const left = new Map(stock ?? []);
  // Hotové díly u sekvencéru (sklad a transit) se spotřebují stejně jako náš sklad hotových dílů.
  const add = (item: string, qty: number) => left.set(item, (left.get(item) ?? 0) + qty);
  for (const p of products) if (p.sequencerStock !== null) add(p.item, p.sequencerStock + (p.sequencerTransit?.[0] ?? 0));
  const first = new Map<string, number>();
  const consume = (item: string, qty: number, children: readonly BomNode[], day: number) => {
    const have = Math.max(0, left.get(item) ?? 0);
    const used = Math.min(have, qty);
    left.set(item, (left.get(item) ?? 0) - used);
    const rest = qty - used;
    if (rest <= 1e-9) return;
    if (children.length > 0 && bom.info.get(item)?.source !== 'P') {
      for (const child of children) consume(child.item, rest * child.qty, child.children, day);
    } else {
      left.set(item, (left.get(item) ?? 0) - rest);
      if (!first.has(item)) first.set(item, day);
    }
  };
  const days = products[0]?.qty.length ?? 0;
  for (let day = 0; day < days; day++) {
    if (day > 0) for (const p of products) if (p.sequencerTransit) add(p.item, p.sequencerTransit[day]! - p.sequencerTransit[day - 1]!);
    for (const product of products) {
      const q = product.qty[day]!;
      if (q > 0) consume(product.item, q, bom.trees.get(product.item) ?? [], day);
    }
  }
  return first;
}

/** Sklad a transit u sekvencéru po našich číslech hotových dílů (spárované přes mapování), transit po dnech horizontu. */
function sequencerByItem(
  sources: readonly CoverageSource[],
  master: MasterData | undefined,
  days: readonly DayNumber[],
): Map<string, { stock: number; transit: number[] }> {
  const result = new Map<string, { stock: number; transit: number[] }>();
  for (const { report } of sources) {
    for (const row of report.rows) {
      const m = master?.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master?.items.get(row.supplierItem) : undefined);
      const item = (m?.item ?? row.supplierItem).toUpperCase();
      if (!item) continue;
      // Transit k dispozici k danému dni: kumulativní hodnota posledního dne souboru, který není později.
      const transit = days.map((d) => {
        let value = 0;
        for (let k = 0; k < report.days.length && report.days[k]! <= d; k++) value = row.transit[k]!;
        return value;
      });
      const entry = result.get(item);
      if (entry) {
        entry.stock += row.customerStock;
        transit.forEach((t, k) => (entry.transit[k]! += t));
      } else {
        result.set(item, { stock: row.customerStock, transit });
      }
    }
  }
  return result;
}

export interface ComponentInputs {
  bom: BomData;
  master: MasterData | undefined;
  /** Soubory pokrytí od sekvencéru: sklad a transit hotových dílů pro „Zákazník pokryt do“. */
  coverage?: readonly CoverageSource[];
  /** Nejnovější export odvolávek. */
  callOffs: CallOffExport | undefined;
  /** Náš sklad po dílech (velkými písmeny); undefined, když soubor skladu není načtený. */
  stock: ReadonlyMap<string, number> | undefined;
  today: DayNumber;
}

/**
 * Poptávka hotového dílu na den z nejnovějšího exportu odvolávek. Soubory pokrytí od zákazníka se nepoužívají:
 * ukazují jen stav na konci dne a spotřebu prvního dne z nich nejde spolehlivě určit.
 * Spotřeba komponenty = poptávka hotových dílů × množství z kusovníku (hrubý rozpad, zásoba mezivýrob se neodečítá).
 */
export function buildComponents({ bom, master, coverage = [], callOffs, stock, today }: ComponentInputs): ComponentTable {
  const days = Array.from({ length: COMPONENT_DAYS }, (_, k) => today + k);
  const calls = callOffDemand(callOffs);
  const sequencer = sequencerByItem(coverage, master, days);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));

  const products: ProductDemand[] = [...bom.parents.keys()].sort().map((item) => {
    const qty = days.map((d) => calls.get(item)?.get(d) ?? 0);
    const m = masterByItem.get(item);
    const seq = sequencer.get(item);
    return {
      item,
      description: m?.description || bom.info.get(item)?.description || '',
      project: m?.project ?? '',
      qty,
      sequencerStock: seq?.stock ?? null,
      sequencerTransit: seq?.transit ?? null,
      ourStock: stock ? (stock.get(item) ?? 0) : null,
    };
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
          avgDaily: 0,
          productionDays: null,
          customerShortDay: null,
          customerKnown: false,
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

  // Dny výroby: pracovní dny po–pá v horizontu (o víkendu odvolávky nebývají).
  const workDays = days.filter((d) => weekday(d) <= 5).length || 1;
  const netShort = customerShortDays(bom, products, stock);
  const madeWithParts = new Set<string>();
  const walk = (nodes: readonly BomNode[]) => {
    for (const n of nodes) {
      if (n.children.length > 0) madeWithParts.add(n.item);
      walk(n.children);
    }
  };
  for (const tree of bom.trees.values()) walk(tree);
  for (const line of lines.values()) {
    let left = line.stock ?? 0;
    line.balance = line.usage.map((u) => (left -= u));
    const k = line.balance.findIndex((v) => v < -1e-9);
    line.shortDay = k === -1 ? null : k;
    line.avgDaily = line.usage.reduce((a, b) => a + b, 0) / workDays;
    line.productionDays = line.avgDaily > 0 ? Math.max(0, line.stock ?? 0) / line.avgDaily : null;
    line.customerKnown = line.source === 'P' || !madeWithParts.has(line.item);
    line.customerShortDay = line.customerKnown ? (netShort.get(line.item) ?? null) : null;
    line.projects.sort();
  }

  const components = [...lines.values()].sort((a, b) => (a.shortDay ?? Infinity) - (b.shortDay ?? Infinity) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  const inBom = new Set(bom.info.keys());
  const markedNotInBom = byMapping ? [...masterByItem.values()].filter((m) => m.componentCoverage && !inBom.has(m.item.toUpperCase())).map((m) => m.item) : [];
  return { days, products, components, byMapping, markedNotInBom };
}
