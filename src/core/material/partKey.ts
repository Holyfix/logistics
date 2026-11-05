// Klíč MC/MF: Maincarrier a Middlefield podle dveří (Side), výbavy (Type = Option Type v matici) a barvy (Colour =
// barva ze sloupce „MC / MF“ v matici: první pro MC, druhá pro MF). Platí jen přesná shoda; výjimky: vyhřívaná výbava
// („-HT“) u zadních dveří, které vyhřívanou variantu nemají; MC u SR1, SR1-HT, TPO a TPO-HT je TPO Maincarrier bez
// barvy (v klíči Type „TPO“, barva se neporovnává); u ostatního MC se barva porovnává bez přípony „-ASQ“.
// Co přesně nesedí, je „chybí v klíči“.

import { cellText, type Cell } from '../table';
import { findColumn } from '../csv';
import { DOORS, type Door } from './doors';

export type PartKind = 'MC' | 'MF';
export const PART_KINDS: readonly PartKind[] = ['MC', 'MF'];

/** Druh dílu podle popisu: „ASSY MC …“ = Maincarrier, „ASSY MF …“ = Middlefield; jinak (i když jsou v popisu oba) null. */
export function partKind(description: string): PartKind | null {
  const d = description.toUpperCase();
  const mc = /\bMC\b/.test(d);
  const mf = /\bMF\b/.test(d);
  return mc === mf ? null : mc ? 'MC' : 'MF';
}

export interface PartKeyEntry {
  item: string;
  description: string;
}

export interface PartKey {
  /** Klíč `druh|dveře|výbava|barva` (velkými písmeny) → díl. */
  entries: Map<string, PartKeyEntry>;
  /** Kombinace, které mají v klíči víc různých dílů: nejsou jednoznačné, a proto se nepoužijí. */
  conflicts: Set<string>;
}

export type PartKeyResult = { ok: true; value: PartKey } | { ok: false; error: 'missingColumns'; columns: string[] };

const COLUMNS = { side: ['Side'], item: ['Item Number', 'Item'], type: ['Type', 'Option Type'], colour: ['Colour', 'Color'], description: ['Description'] };
const HEATED = /-HT$/;
/** Zadní dveře vyhřívanou variantu nemají: „SR2-HT“ se u nich hledá i jako „SR2“. */
const REAR: readonly Door[] = ['RL', 'RR'];

/** Výbavy, které mají TPO Maincarrier (jeden díl na stranu, bez barvy a bez rozlišení vyhřívání). */
const TPO_MC_TYPES = new Set(['SR1', 'SR1-HT', 'TPO', 'TPO-HT']);

/** MC u SR1, SR1-HT, TPO a TPO-HT je TPO Maincarrier: do potřeby ani skladu se nepočítá, jen se označí jako TPO. */
export const isTpoMaincarrier = (optionType: string) => TPO_MC_TYPES.has(optionType.trim().toUpperCase());
const TPO = 'TPO';
const ASQ = /-ASQ$/;

/**
 * Výbava a barva tak, jak se porovnávají s klíčem: MC u SR1, SR1-HT, TPO a TPO-HT → „TPO“ bez barvy; jinak výbava
 * přesně a barva dílu (u MC bez přípony „-ASQ“).
 */
export function keyCombo(kind: PartKind, optionType: string, colour: string): { type: string; colour: string } {
  const type = optionType.trim().toUpperCase();
  if (kind === 'MC' && TPO_MC_TYPES.has(type)) return { type: TPO, colour: '' };
  const c = colour.trim().toUpperCase();
  return { type, colour: kind === 'MC' ? c.replace(ASQ, '') : c };
}

const keyOf = (kind: PartKind, door: Door, type: string, colour: string) => `${kind}|${door}|${type.trim().toUpperCase()}|${colour.trim().toUpperCase()}`;

/**
 * Klíč MC/MF z listu: záhlaví je řádek se sloupci Side, Item Number, Type a Colour. Druh dílu podle popisu („MC“ / „MF“);
 * bez sloupce Description se díly berou jako MF.
 */
export function parsePartKey(data: readonly Cell[][]): PartKeyResult {
  const headerIndex = data.findIndex((row) => {
    const header = row.map((c) => cellText(c));
    return findColumn(header, COLUMNS.side) !== -1 && findColumn(header, COLUMNS.colour) !== -1;
  });
  const header = headerIndex === -1 ? [] : data[headerIndex]!.map((c) => cellText(c));
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, aliases]) => [k, findColumn(header, aliases)])) as Record<keyof typeof COLUMNS, number>;
  const missing = (['side', 'item', 'type', 'colour'] as const).filter((k) => col[k] === -1).map((k) => COLUMNS[k][0]!);
  if (missing.length) return { ok: false, error: 'missingColumns', columns: missing };
  const entries = new Map<string, PartKeyEntry>();
  const conflicts = new Set<string>();
  for (const row of data.slice(headerIndex + 1)) {
    const door = cellText(row[col.side]).toUpperCase() as Door;
    const item = cellText(row[col.item]);
    const type = cellText(row[col.type]);
    const description = col.description === -1 ? '' : cellText(row[col.description]);
    const kind = col.description === -1 ? 'MF' : partKind(description);
    if (!DOORS.includes(door) || !item || !type || !kind) continue;
    const combo = keyCombo(kind, type, cellText(row[col.colour]));
    const key = keyOf(kind, door, combo.type, combo.colour);
    const known = entries.get(key);
    if (known && known.item.toUpperCase() !== item.toUpperCase()) conflicts.add(key);
    else entries.set(key, { item, description });
  }
  for (const key of conflicts) entries.delete(key);
  return { ok: true, value: { entries, conflicts } };
}

/** Barva dílu ze sloupce „MC / MF“ matice („C9 / C1“ → MC C9, MF C1; jedna barva platí pro oba). */
export function partColour(colors: string, kind: PartKind): string {
  const parts = colors.split('/').map((s) => s.trim());
  return (kind === 'MC' ? parts[0] : parts[1] || parts[0]) ?? '';
}

/** Výbava, kterou stačí mít v klíči: u zadních dveří bez „-HT“ (SR2-HT → SR2), jinak přesně Option Type. */
export function keyType(door: Door, optionType: string): string {
  const type = optionType.trim();
  return REAR.includes(door) ? type.replace(/-HT$/i, '') : type;
}

/** Řádek, který v klíči chybí, tak jak ho zapsat: výbava (u zadních dveří bez „-HT“, u TPO Maincarrieru „TPO“) a barva. */
export function missingCombo(kind: PartKind, door: Door, optionType: string, colors: string): { type: string; colour: string } {
  const combo = keyCombo(kind, optionType, partColour(colors, kind));
  return { type: keyType(door, combo.type), colour: combo.colour };
}

/**
 * Díl daného druhu pro dveře vozu podle klíče: přesná shoda dveří, výbavy a barvy (s pravidly keyCombo pro MC). Zadní
 * dveře (RL, RR) se s vyhřívanou výbavou hledají i pod výbavou bez „-HT“ (SR2-HT → SR2), přednost má přesný řádek „-HT“.
 */
export function lookupPart(key: PartKey, kind: PartKind, door: Door, optionType: string, colors: string): PartKeyEntry | null {
  const { type, colour } = keyCombo(kind, optionType, partColour(colors, kind));
  const exact = key.entries.get(keyOf(kind, door, type, colour));
  if (exact || !REAR.includes(door) || !HEATED.test(type)) return exact ?? null;
  return key.entries.get(keyOf(kind, door, type.replace(HEATED, ''), colour)) ?? null;
}
