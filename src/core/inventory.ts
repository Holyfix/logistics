// Zásoby (zdraví skladu): rozbor aktuální zásoby – jen díly, které skladem jsou (chybějící díly řeší Komponenty).
// Dosah zásoby podle potřeby zákazníka, minimum a maximum, nadbytek, zásoba nad celou potřebu, blokace a hodnota.
// Potřeba den po dni: hotové díly (FG) z odvolávek, polotovary (SFG) a nakupované díly (PG) přes kusovník
// (odvolávky × množství na 1 ks hotového dílu, bez odečtu skladu hotových dílů – stejně jako modul Komponenty).

import type { BomComponent, BomData } from './bom';
import type { CallOffExport } from './calloffs/parse';
import { weekday, type DayNumber } from './dates';
import { callOffDemand } from './demand';
import type { MasterData } from './masterdata';
import { homeSite, isExcludedLocation, type StockData, type StockRow } from './stock';

/** Pásma dosahu v pracovních dnech: kritické pod 2, nízké pod 5, v pořádku do 20, vysoké do 40, nad 40 nadbytek. */
export const CRIT_DAYS = 2;
export const LOW_DAYS = 5;
export const HIGH_DAYS = 20;
export const OVER_DAYS = 40;
/** Minimum = potřeba na 5 pracovních dní, maximum = na 20 pracovních dní. */
export const MIN_DAYS = LOW_DAYS;
export const MAX_DAYS = HIGH_DAYS;
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

export { homeSite };

/**
 * Externí lokace (sekvencéry hotových dílů u zákazníka, díly jsou stále naše): jiný závod (Site) než domácí, nebo
 * externí lokace v domácím závodě, kterou Coverage vylučuje ze skladu (isExcludedLocation, název je jen jako otisk).
 */
export const isExternal = (row: StockRow, home: string, excluded: (location: string) => boolean = isExcludedLocation) =>
  (row.site !== '' && row.site !== home) || excluded(row.location);

export type Scope = 'all' | 'internal' | 'external';

/**
 * Proč díl se zásobou nemá do konce odvolávek potřebu: není v kusovníku žádného načteného hotového dílu (doběhlý díl,
 * kandidát na odpis), nebo je hotový díl / jeho hotové díly teď nemají odvolávky.
 */
export type NoNeedReason = 'notInBom' | 'noCallOffs';

export interface InventoryLocation {
  location: string;
  status: string;
  zone: string;
  qty: number;
  value: number;
  external: boolean;
  blocked: BlockReason | null;
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
  /** Zásoba nad celou potřebu do konce odvolávek: volná zásoba, která se podle odvolávek nespotřebuje (kusy a hodnota). */
  surplus: number;
  surplusValue: number;
  /** U pásma „bez potřeby“ důvod; jinak null. */
  noNeed: NoNeedReason | null;
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
  /** Počet pracovních dní od dneška do konce odvolávek: zásoba na celý horizont má dosah „aspoň tolik“ (např. 150+). */
  horizonWorkdays: number;
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
 * Zásoby po dílech: jen díly se zásobou (volnou nebo blokovanou) na lokacích podle `scope`; díly bez zásoby se neukazují
 * (chybějící díly řeší Komponenty, mezivýroba, která se neskladuje, tu nepřekáží). Hodnota, potřeba po dnech
 * z odvolávek a kusovníku, dosah, minimum a maximum, zásoba nad celou potřebu; díly mimo mapování jsou „ostatní“ jen s hodnotou.
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

  const lines: InventoryLine[] = [];
  for (const [item, rows] of byItem) {
    const m = masterByItem.get(item);
    const kind: Kind = m?.kind || 'other';
    const unitCost = rows.find((r) => r.cost)?.cost ?? 0;
    const blockedBy: Record<BlockReason, number> = { quality: 0, inventory: 0, logistics: 0 };
    let free = 0;
    let external = 0;
    const locations: InventoryLocation[] = rows.map((r) => {
      const ext = isExternal(r, home, excludedLocation);
      const blocked = blockReason(r.status);
      if (blocked) blockedBy[blocked] += r.qty;
      else {
        free += r.qty;
        if (ext) external += r.qty;
      }
      return { location: r.location, status: r.status, zone: r.zone, qty: r.qty, value: r.qty * (r.cost ?? unitCost), external: ext, blocked };
    });
    const blocked = blockedBy.quality + blockedBy.inventory + blockedBy.logistics;
    const need = kind === 'other' ? days.map(() => 0) : (demand.get(item) ?? days.map(() => 0));
    const horizonDemand = need.reduce((a, b) => a + b, 0);
    const min = demandForWorkdays(need, days, MIN_DAYS);
    const max = demandForWorkdays(need, days, MAX_DAYS);
    const covered = horizonDemand > 0 ? coverageDays(free, need, days) : null;
    const band = kind === 'other' ? 'other' : bandOf(covered, horizonDemand);
    // Bez odvolávek se potřeba nedá posoudit: nad potřebu ani důvod „bez potřeby“ se neurčují.
    const surplus = kind === 'other' || last === null ? 0 : Math.max(0, free - horizonDemand);
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
      band,
      toMin: Math.max(0, min - free),
      overMax: kind === 'other' || horizonDemand <= 0 ? 0 : Math.max(0, free - max),
      surplus,
      surplusValue: surplus * unitCost,
      noNeed: band === 'none' && last !== null ? (kind !== 'FG' && !usedIn.has(item) ? 'notInBom' : 'noCallOffs') : null,
      locations,
    });
  }
  lines.sort((a, b) => a.item.localeCompare(b.item));
  return { lines, horizonEnd: last, horizonWorkdays: days.filter((d) => weekday(d) <= 5).length, negativeRows, hasCost: stock.rows.some((r) => r.cost !== null) };
}

/**
 * Kam jsou peníze uložené: hodnota zásoby dílu (volná + blokovaná) rozdělená podle potřeby z odvolávek. Potřebná =
 * do maxima (20 pracovních dní potřeby), nad maximem = spotřebuje se, ale později, nad celou potřebu = do konce
 * odvolávek se nespotřebuje (díly s potřebou), bez potřeby (celá volná zásoba), blokováno, mimo mapování (ostatní).
 */
export type MoneyPart = 'needed' | 'overMax' | 'surplus' | 'none' | 'blocked' | 'other';
export const MONEY_PARTS: readonly MoneyPart[] = ['needed', 'overMax', 'surplus', 'none', 'blocked', 'other'];

export function moneyParts(l: InventoryLine): Record<MoneyPart, number> {
  const parts: Record<MoneyPart, number> = { needed: 0, overMax: 0, surplus: 0, none: 0, blocked: l.blockedValue, other: 0 };
  if (l.kind === 'other') parts.other = l.value;
  else if (l.band === 'none') parts.none = l.value;
  else {
    parts.needed = Math.min(l.free, l.max) * l.unitCost;
    parts.surplus = l.surplusValue;
    parts.overMax = Math.max(0, l.value - parts.needed - parts.surplus);
  }
  return parts;
}

/** Součet rozdělení hodnoty přes díly. */
export function moneyTotals(lines: readonly InventoryLine[]): Record<MoneyPart, number> {
  const total: Record<MoneyPart, number> = { needed: 0, overMax: 0, surplus: 0, none: 0, blocked: 0, other: 0 };
  for (const l of lines) {
    const parts = moneyParts(l);
    for (const k of MONEY_PARTS) total[k] += parts[k];
  }
  return total;
}
