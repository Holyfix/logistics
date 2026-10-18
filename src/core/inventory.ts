// Zásoby (zdraví skladu): dosah zásoby podle potřeby zákazníka, minimum a maximum, nadbytek, blokace a hodnota.
// Potřeba den po dni: hotové díly (FG) z odvolávek, polotovary (SFG) a nakupované díly (PG) přes kusovník
// (odvolávky × množství na 1 ks hotového dílu, bez odečtu skladu hotových dílů – stejně jako modul Komponenty).

import type { BomComponent, BomData } from './bom';
import type { CallOffExport } from './calloffs/parse';
import { weekday, type DayNumber } from './dates';
import { callOffDemand } from './demand';
import type { MasterData } from './masterdata';
import { isExcludedLocation, type StockData, type StockRow } from './stock';

/** Pásma dosahu v pracovních dnech: kritické pod 2, nízké pod 5, v pořádku do 20, vysoké do 40, nad 40 nadbytek. */
export const CRIT_DAYS = 2;
export const LOW_DAYS = 5;
export const HIGH_DAYS = 20;
export const OVER_DAYS = 40;
/** Minimum = potřeba na 5 pracovních dní, maximum = na 20 pracovních dní. */
export const MIN_DAYS = LOW_DAYS;
export const MAX_DAYS = HIGH_DAYS;
/** Ležák: bez pohybu aspoň 180 dní. */
export const IDLE_DAYS = 180;

export type Band = 'crit' | 'low' | 'ok' | 'high' | 'over' | 'none' | 'other';
export const BANDS: readonly Band[] = ['crit', 'low', 'ok', 'high', 'over', 'none', 'other'];

export type Kind = 'FG' | 'SFG' | 'PG' | 'other';
export const KINDS: readonly Kind[] = ['FG', 'SFG', 'PG', 'other'];

/** Důvod blokace podle statusu: kvalita, inventurní rozdíl, logistika. */
export type BlockReason = 'quality' | 'inventory' | 'logistics';
export const BLOCK_REASONS: readonly BlockReason[] = ['quality', 'inventory', 'logistics'];

/** Blokační statusy (velkými písmeny); ostatní statusy jsou volná zásoba. */
const BLOCKED: Record<string, BlockReason> = { QH: 'quality', 'QH-TEMP': 'quality', DIFF: 'inventory', 'CLAIMS-O': 'logistics' };

export const blockReason = (status: string): BlockReason | null => BLOCKED[status.trim().toUpperCase()] ?? null;

/** Domácí závod: nejčastější Site v souboru skladu. */
export function homeSite(rows: readonly StockRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.site) counts.set(r.site, (counts.get(r.site) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * Externí lokace (sekvencéry hotových dílů u zákazníka, díly jsou stále naše): jiný závod (Site) než domácí, nebo
 * externí lokace v domácím závodě, kterou Coverage vylučuje ze skladu (isExcludedLocation, název je jen jako otisk).
 */
export const isExternal = (row: StockRow, home: string, excluded: (location: string) => boolean = isExcludedLocation) =>
  (row.site !== '' && row.site !== home) || excluded(row.location);

export type Scope = 'all' | 'internal' | 'external';

export interface InventoryLocation {
  location: string;
  status: string;
  zone: string;
  qty: number;
  value: number;
  external: boolean;
  blocked: BlockReason | null;
  lastMove: DayNumber | null;
}

export interface InventoryLine {
  item: string;
  description: string;
  kind: Kind;
  projects: string[];
  categories: string[];
  abc: string;
  /** Cena za jednotku (Kč); 0, když v exportu chybí. */
  unitCost: number;
  /** Volná zásoba (bez blokací) včetně externích lokací. */
  free: number;
  /** Z volné zásoby na externích lokacích. */
  external: number;
  blocked: number;
  blockedBy: Record<BlockReason, number>;
  /** Hodnota volné zásoby (Kč), z toho externí. */
  value: number;
  externalValue: number;
  blockedValue: number;
  /** Potřeba na 5 a 20 pracovních dní od dneška (minimum a maximum zásoby). */
  min: number;
  max: number;
  /** Potřeba v celém horizontu odvolávek. */
  horizonDemand: number;
  /** Dosah v pracovních dnech: kolik pracovních dní volná zásoba pokryje potřebu; null = pokryje celý horizont nebo bez potřeby. */
  days: number | null;
  band: Band;
  /** Kolik kusů chybí do minima a kolik je nad maximem. */
  toMin: number;
  overMax: number;
  /** Nejnovější pohyb na lokacích se zásobou. */
  lastMove: DayNumber | null;
  /** Ležák: zásoba bez pohybu aspoň IDLE_DAYS. */
  idle: boolean;
  locations: InventoryLocation[];
}

export interface InventoryInputs {
  stock: StockData;
  master: MasterData | undefined;
  boms: readonly BomData[];
  callOffs: CallOffExport | undefined;
  today: DayNumber;
  scope?: Scope;
  /** Externí lokace v domácím závodě (výchozí: lokace vyloučené v Coverage). */
  excludedLocation?: (location: string) => boolean;
}

export interface InventoryTable {
  lines: InventoryLine[];
  /** Poslední den potřeby (konec exportu odvolávek); null bez odvolávek. */
  horizonEnd: DayNumber | null;
  /** Řádky se záporným množstvím (do zásoby se nepočítají). */
  negativeRows: number;
  /** Export obsahuje ceny (sloupec Standard Cost). */
  hasCost: boolean;
}

/** Pásmo podle dosahu; bez potřeby v horizontu „none“, s potřebou a zásobou na celý horizont nadbytek. */
export function bandOf(days: number | null, horizonDemand: number): Band {
  if (horizonDemand <= 0) return 'none';
  if (days === null) return 'over';
  if (days < CRIT_DAYS) return 'crit';
  if (days < LOW_DAYS) return 'low';
  if (days <= HIGH_DAYS) return 'ok';
  if (days <= OVER_DAYS) return 'high';
  return 'over';
}

/**
 * Dosah: počet pracovních dní (po–pá) od dneška, které zásoba plně pokryje, když se den po dni odečítá potřeba
 * (i víkendová). Null, když zásoba vystačí na celý horizont.
 */
export function coverageDays(stock: number, demand: readonly number[], days: readonly DayNumber[]): number | null {
  let left = stock;
  let covered = 0;
  for (let k = 0; k < days.length; k++) {
    left -= demand[k]!;
    if (left < -1e-9) return covered;
    if (weekday(days[k]!) <= 5) covered++;
  }
  return null;
}

/** Potřeba za prvních n pracovních dní (včetně víkendů mezi nimi). */
export function demandForWorkdays(demand: readonly number[], days: readonly DayNumber[], n: number): number {
  let sum = 0;
  let work = 0;
  for (let k = 0; k < days.length && work < n; k++) {
    sum += demand[k]!;
    if (weekday(days[k]!) <= 5) work++;
  }
  return sum;
}

/**
 * Zásoby po dílech: volná a blokovaná zásoba (interní i externí lokace podle `scope`), hodnota, potřeba po dnech
 * z odvolávek a kusovníku, dosah, minimum a maximum. Díly z mapování s potřebou se ukážou i bez zásoby (kritické);
 * díly mimo mapování jsou „ostatní“ jen s hodnotou.
 */
export function buildInventory({ stock, master, boms, callOffs, today, scope = 'all', excludedLocation = isExcludedLocation }: InventoryInputs): InventoryTable {
  const home = homeSite(stock.rows);
  const masterByItem = new Map([...(master?.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m]));

  // Horizont: od dneška do konce exportu odvolávek.
  const last = callOffs ? callOffs.lastDay : null;
  const days: DayNumber[] = [];
  if (last !== null) for (let d = today; d <= last; d++) days.push(d);

  // Hrubá potřeba po dnech: FG z odvolávek, komponenty přes kusovník (množství na 1 ks hotového dílu přes všechny úrovně).
  const calls = callOffDemand(callOffs);
  const demand = new Map<string, number[]>();
  const add = (item: string, k: number, qty: number) => {
    let d = demand.get(item);
    if (!d) demand.set(item, (d = days.map(() => 0)));
    d[k]! += qty;
  };
  const parents = new Map<string, BomComponent[]>();
  for (const bom of boms) for (const [parent, components] of bom.parents) if (!parents.has(parent)) parents.set(parent, components);
  for (const [item, byDay] of calls) {
    days.forEach((d, k) => {
      const q = byDay.get(d) ?? 0;
      if (q <= 0) return;
      add(item, k, q);
      for (const c of parents.get(item) ?? []) add(c.item, k, q * c.qty);
    });
  }

  // Projekt a kategorie: z mapování, u komponent z hotových dílů, ve kterých jsou.
  const usedIn = new Map<string, Set<string>>();
  for (const [parent, components] of parents) for (const c of components) (usedIn.get(c.item) ?? usedIn.set(c.item, new Set()).get(c.item)!).add(parent);
  const groups = (item: string, field: 'project' | 'category') => {
    const own = masterByItem.get(item)?.[field];
    if (own) return [own];
    return [...new Set([...(usedIn.get(item) ?? [])].map((p) => masterByItem.get(p)?.[field] ?? '').filter(Boolean))].sort();
  };

  // Lokace po dílech.
  let negativeRows = 0;
  const byItem = new Map<string, StockRow[]>();
  for (const row of stock.rows) {
    if (row.qty < 0) negativeRows++;
    if (row.qty <= 0) continue;
    const external = isExternal(row, home, excludedLocation);
    if ((scope === 'internal' && external) || (scope === 'external' && !external)) continue;
    (byItem.get(row.item) ?? byItem.set(row.item, []).get(row.item)!).push(row);
  }

  const items = new Set([...byItem.keys(), ...[...demand.keys()].filter((i) => masterByItem.get(i)?.kind)]);
  const lines: InventoryLine[] = [];
  for (const item of items) {
    const rows = byItem.get(item) ?? [];
    const m = masterByItem.get(item);
    const kind: Kind = m?.kind || 'other';
    const unitCost = rows.find((r) => r.cost)?.cost ?? 0;
    const blockedBy: Record<BlockReason, number> = { quality: 0, inventory: 0, logistics: 0 };
    let free = 0;
    let external = 0;
    let lastMove: DayNumber | null = null;
    const locations: InventoryLocation[] = rows.map((r) => {
      const ext = isExternal(r, home, excludedLocation);
      const blocked = blockReason(r.status);
      if (blocked) blockedBy[blocked] += r.qty;
      else {
        free += r.qty;
        if (ext) external += r.qty;
      }
      if (r.lastMove !== null && (lastMove === null || r.lastMove > lastMove)) lastMove = r.lastMove;
      return { location: r.location, status: r.status, zone: r.zone, qty: r.qty, value: r.qty * (r.cost ?? unitCost), external: ext, blocked, lastMove: r.lastMove };
    });
    const blocked = blockedBy.quality + blockedBy.inventory + blockedBy.logistics;
    const need = kind === 'other' ? days.map(() => 0) : (demand.get(item) ?? days.map(() => 0));
    const horizonDemand = need.reduce((a, b) => a + b, 0);
    const min = demandForWorkdays(need, days, MIN_DAYS);
    const max = demandForWorkdays(need, days, MAX_DAYS);
    const covered = horizonDemand > 0 ? coverageDays(free, need, days) : null;
    lines.push({
      item,
      description: m?.description || stock.descriptions.get(item) || '',
      kind,
      projects: groups(item, 'project'),
      categories: groups(item, 'category'),
      abc: rows.find((r) => r.abc)?.abc ?? '',
      unitCost,
      free,
      external,
      blocked,
      blockedBy,
      value: free * unitCost,
      externalValue: external * unitCost,
      blockedValue: blocked * unitCost,
      min,
      max,
      horizonDemand,
      days: covered,
      band: kind === 'other' ? 'other' : bandOf(covered, horizonDemand),
      toMin: Math.max(0, min - free),
      overMax: kind === 'other' || horizonDemand <= 0 ? 0 : Math.max(0, free - max),
      lastMove,
      idle: free + blocked > 0 && lastMove !== null && today - lastMove >= IDLE_DAYS,
      locations,
    });
  }
  lines.sort((a, b) => a.item.localeCompare(b.item));
  return { lines, horizonEnd: last, negativeRows, hasCost: stock.rows.some((r) => r.cost !== null) };
}

/** Pořadí pro „problémové“ díly: kritické, nízké, nadbytek, bez potřeby (v rámci pásma podle hodnoty / dosahu). */
const BAND_ORDER: Record<Band, number> = { crit: 0, low: 1, over: 2, none: 3, high: 4, ok: 5, other: 6 };

export function byUrgency(a: InventoryLine, b: InventoryLine): number {
  return BAND_ORDER[a.band] - BAND_ORDER[b.band] || (a.band === 'crit' || a.band === 'low' ? (a.days ?? 0) - (b.days ?? 0) || b.toMin - a.toMin : b.value - a.value) || a.item.localeCompare(b.item);
}
