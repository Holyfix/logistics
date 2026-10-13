// Pokrytí komponent pro zákazníka: chybějící množství u zákazníka (sklad + transit u sekvencéra, dál odvolávky),
// které nepokryje náš sklad hotových dílů a mezivýroby, × kusovník, odečtené od našeho skladu komponent.

import type { BomData, BomNode } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { weekday, type DayNumber } from '../dates';
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
  /** Odvolávky zákazníka (pro srovnání). */
  callOffs: number[];
  /**
   * Potřeba zákazníka na nás: ve dnech souboru sekvencéra přírůstek chybějícího množství podle jeho souboru
   * (sklad + transit − plán zákazníka), za koncem souboru odvolávky po spotřebování zbytku u sekvencéra.
   * Bez souboru sekvencéra odvolávky.
   */
  need: number[];
  /** Den je ze souboru sekvencéra (fixní plán), jinak z odvolávek. */
  fixed: boolean[];
  /** Potřeba výroby: potřeba zákazníka, kterou nepokryje náš sklad hotového dílu (bez odečtu skladu = potřeba). */
  production: number[];
}

export interface ComponentLine {
  item: string;
  description: string;
  um: string;
  /** P = nakupovaný, L/M = vyráběný. */
  source: string;
  /** Náš sklad; null, když soubor skladu není načtený. */
  stock: number | null;
  /** Potřeba komponenty po dnech: potřeba výroby hotových dílů × kusovník (po odečtu mezivýroby). */
  usage: number[];
  /** Stav na konci dne: sklad − kumulovaná potřeba (bez skladu od 0). Záporné = kolik chybí na pokrytí zákazníka. */
  balance: number[];
  /** Index prvního dne v záporu; null, když vystačí na celý horizont. */
  shortDay: number | null;
  /** Průměrná spotřeba za den výroby podle odvolávek (pracovní dny po–pá v horizontu). */
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
 * Rozpad potřeby zákazníka den po dni jako v MRP (bez doby výroby): potřeba hotového dílu se nejdřív kryje z našeho
 * skladu hotových dílů, zbytek je potřeba výroby; ta se rozpadne podle kusovníku, vyráběné díly (mezivýroba) se kryjí
 * ze svého skladu a teprve zbytek jde o úroveň níž. Nakupované díly se nerozpadají. Bez odečtu skladu (`netOwnStock`)
 * se sklad hotových dílů a mezivýroby nepoužije. Vrátí potřebu výroby hotových dílů a potřebu sledovaných dílů po dnech.
 */
function explode(
  bom: BomData,
  products: readonly ProductDemand[],
  stock: ReadonlyMap<string, number> | undefined,
  netOwnStock: boolean,
  tracked: ReadonlySet<string>,
): Map<string, number[]> {
  const days = products[0]?.need.length ?? 0;
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
    for (const product of products) {
      const q = product.need[day]!;
      if (q <= 0) continue;
      const rest = fromStock(product.item, q);
      product.production[day] = rest;
      if (rest > 1e-9) for (const child of bom.trees.get(product.item) ?? []) consume(child.item, rest * child.qty, child.children, day);
    }
  }
  return usage;
}

/** Stav u sekvencéru se skladem a transitem po dnech jeho souboru, po našich číslech hotových dílů (přes mapování). */
interface SequencerPlan {
  /** Stav (sklad + transit − kumulovaná spotřeba) na konci dne; mezi dny souboru platí poslední známý stav. */
  balance: (day: DayNumber) => number;
  fileDays: DayNumber[];
  last: DayNumber;
}

function sequencerPlans(sources: readonly CoverageSource[], master: MasterData | undefined): Map<string, SequencerPlan> {
  const rows = new Map<string, { days: readonly DayNumber[]; values: number[]; initial: number }[]>();
  for (const { report } of sources) {
    if (report.days.length === 0) continue;
    for (const row of report.rows) {
      const m = master?.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master?.items.get(row.supplierItem) : undefined);
      const item = (m?.item ?? row.supplierItem).toUpperCase();
      if (!item) continue;
      const values = row.balance.map((b, k) => b + row.transit[k]!);
      const list = rows.get(item) ?? [];
      list.push({ days: report.days, values, initial: row.customerStock + (row.transit[0] ?? 0) });
      rows.set(item, list);
    }
  }
  const result = new Map<string, SequencerPlan>();
  for (const [item, list] of rows) {
    const valueOn = (r: (typeof list)[number], day: DayNumber) => {
      let value = r.initial;
      for (let k = 0; k < r.days.length && r.days[k]! <= day; k++) value = r.values[k]!;
      return value;
    };
    result.set(item, {
      balance: (day) => list.reduce((sum, r) => sum + valueOn(r, day), 0),
      fileDays: [...new Set(list.flatMap((r) => r.days))].sort((x, y) => x - y),
      last: Math.max(...list.map((r) => r.days.at(-1)!)),
    });
  }
  return result;
}

/**
 * Požadavek na nás po dnech horizontu. Ve dnech souboru sekvencéra je kumulovaný požadavek největší dosavadní
 * chybějící množství (záporný stav); když se stav později zlepší (dorazí transit), požadavek se nesnižuje.
 * Chybějící množství ze dnů před dneškem patří do dneška. Za koncem souboru se odvolávky kryjí nejdřív zbytkem
 * u sekvencéru (stav posledního dne + to, co jsme měli dodat), zbytek je požadavek na nás.
 */
function customerNeed(qty: readonly number[], days: readonly DayNumber[], plan: SequencerPlan | undefined): { need: number[]; fixed: boolean[] } {
  if (!plan) return { need: [...qty], fixed: qty.map(() => false) };
  let required = 0;
  for (const d of plan.fileDays) if (d < days[0]!) required = Math.max(required, -plan.balance(d));
  let counted = 0;
  let leftover: number | null = null;
  const need: number[] = [];
  const fixed: boolean[] = [];
  days.forEach((d, k) => {
    if (d <= plan.last) {
      required = Math.max(required, -plan.balance(d));
      need.push(required - counted);
      counted = required;
      fixed.push(true);
    } else {
      leftover ??= Math.max(0, plan.balance(plan.last) + required);
      const fromSequencer = Math.min(leftover, qty[k]!);
      leftover -= fromSequencer;
      need.push(qty[k]! - fromSequencer);
      fixed.push(false);
    }
  });
  return { need, fixed };
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
  /** Odečíst náš sklad hotových dílů a mezivýroby (výchozí ano). */
  netOwnStock?: boolean;
}

/**
 * Pokrytí komponent pro zákazníka. Potřeba hotového dílu na den = chybějící množství u zákazníka podle souboru
 * sekvencéra (sklad + transit − plán zákazníka), za koncem souboru a u dílů bez souboru odvolávky. Odečte se náš sklad
 * hotových dílů a mezivýroby, zbytek × kusovník je potřeba komponenty; stav = náš sklad komponenty − kumulovaná potřeba.
 */
export function buildComponents({ bom, master, coverage = [], callOffs, stock, today, netOwnStock = true }: ComponentInputs): ComponentTable {
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
      project: m?.project ?? '',
      callOffs: callOffQty,
      ...customerNeed(callOffQty, days, plans.get(item)),
      production: days.map(() => 0),
    };
  });

  const byMapping = master?.hasComponentColumn ?? false;
  const wanted = (item: string) => (byMapping ? masterByItem.get(item)?.componentCoverage === true : bom.info.get(item)?.source === 'P');

  // Dny výroby: pracovní dny po–pá v horizontu (o víkendu odvolávky nebývají).
  const workDays = days.filter((d) => weekday(d) <= 5).length || 1;
  const lines = new Map<string, ComponentLine>();
  for (const product of products) {
    const callOffTotal = product.callOffs.reduce((a, b) => a + b, 0);
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

  const usage = explode(bom, products, stock, netOwnStock, new Set(lines.keys()));
  for (const line of lines.values()) {
    line.usage = usage.get(line.item) ?? days.map(() => 0);
    let left = line.stock ?? 0;
    line.balance = line.usage.map((u) => (left -= u));
    const k = line.balance.findIndex((v) => v < -1e-9);
    line.shortDay = k === -1 ? null : k;
    line.productionDays = line.avgDaily > 0 ? Math.max(0, line.stock ?? 0) / line.avgDaily : null;
    line.projects.sort();
  }

  const components = [...lines.values()].sort((a, b) => (a.shortDay ?? Infinity) - (b.shortDay ?? Infinity) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  const inBom = new Set(bom.info.keys());
  const markedNotInBom = byMapping ? [...masterByItem.values()].filter((m) => m.componentCoverage && !inBom.has(m.item.toUpperCase())).map((m) => m.item) : [];
  return { days, products, components, byMapping, markedNotInBom };
}
