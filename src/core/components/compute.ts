// Pokrytí komponent přes kusovník: poptávka hotových dílů × kusovník, odečtená od našeho skladu.

import type { BomData } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { DayNumber } from '../dates';
import type { MasterData } from '../masterdata';

/** Horizont pokrytí komponent ve dnech (od dneška). */
export const COMPONENT_DAYS = 14;

/** Poptávka hotového dílu po dnech horizontu (z odvolávek). */
export interface ProductDemand {
  item: string;
  description: string;
  project: string;
  qty: number[];
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
export function buildComponents({ bom, master, callOffs, stock, today }: ComponentInputs): ComponentTable {
  const days = Array.from({ length: COMPONENT_DAYS }, (_, k) => today + k);
  const calls = callOffDemand(callOffs);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));

  const products: ProductDemand[] = [...bom.parents.keys()].sort().map((item) => {
    const qty = days.map((d) => calls.get(item)?.get(d) ?? 0);
    const m = masterByItem.get(item);
    return { item, description: m?.description || bom.info.get(item)?.description || '', project: m?.project ?? '', qty };
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
