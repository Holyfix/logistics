// Klíč MC/MF: Maincarrier a Middlefield podle dveří (Side), výbavy (Type = Option Type v matici) a barvy (Colour =
// barva ze sloupce „MC / MF“ v matici: první pro MC, druhá pro MF). Nahrazuje dohledání přes JIT Overview a kusovník.

import { cellText, type Cell } from '../table';
import { findColumn } from '../csv';
import { DOORS, type Door } from './jit';

export type PartKind = 'MC' | 'MF';
export const PART_KINDS: readonly PartKind[] = ['MC', 'MF'];

/** Druh dílu podle popisu: „ASSY MC …“ = Maincarrier, „ASSY MF …“ = Middlefield; jinak null. */
export function partKind(description: string): PartKind | null {
  const d = description.toUpperCase();
  if (/\bMC\b/.test(d)) return 'MC';
  if (/\bMF\b/.test(d)) return 'MF';
  return null;
}

export interface PartKeyEntry {
  item: string;
  description: string;
}

export interface PartKey {
  /** Klíč `druh|dveře|výbava|barva` (velkými písmeny; barva prázdná = všechny barvy) → díl. */
  entries: Map<string, PartKeyEntry>;
  /** `druh|dveře`, které mají v klíči vyhřívanou výbavu („…-HT“); u ostatních se vyhřívání nerozlišuje. */
  heated: Set<string>;
}

export type PartKeyResult = { ok: true; value: PartKey } | { ok: false; error: 'missingColumns'; columns: string[] };

const COLUMNS = { side: ['Side'], item: ['Item Number', 'Item'], type: ['Type', 'Option Type'], colour: ['Colour', 'Color'], description: ['Description'] };
const HEATED = /-HT$/;

const keyOf = (kind: PartKind, door: Door, type: string, colour: string) => `${kind}|${door}|${type.trim().toUpperCase()}|${colour.trim().toUpperCase()}`;

/**
 * Klíč MC/MF z listu: záhlaví je řádek se sloupci Side, Item Number, Type a Colour. Druh dílu podle popisu („MC“ / „MF“);
 * bez sloupce Description se díly berou jako MF. Prázdná barva platí pro všechny barvy.
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
  const heated = new Set<string>();
  for (const row of data.slice(headerIndex + 1)) {
    const door = cellText(row[col.side]).toUpperCase() as Door;
    const item = cellText(row[col.item]);
    const type = cellText(row[col.type]);
    const description = col.description === -1 ? '' : cellText(row[col.description]);
    const kind = col.description === -1 ? 'MF' : partKind(description);
    if (!DOORS.includes(door) || !item || !type || !kind) continue;
    entries.set(keyOf(kind, door, type, cellText(row[col.colour])), { item, description });
    if (HEATED.test(type.trim().toUpperCase())) heated.add(`${kind}|${door}`);
  }
  return { ok: true, value: { entries, heated } };
}

/** Barva dílu ze sloupce „MC / MF“ matice („C9 / C1“ → MC C9, MF C1; jedna barva platí pro oba). */
export function partColour(colors: string, kind: PartKind): string {
  const parts = colors.split('/').map((s) => s.trim());
  return (kind === 'MC' ? parts[0] : parts[1] || parts[0]) ?? '';
}

/**
 * Díl daného druhu pro dveře vozu podle klíče: nejdřív s barvou, pak řádek bez barvy (pro všechny barvy). Dveře, které
 * v klíči vyhřívanou výbavu nemají (typicky zadní), se hledají i pod výbavou bez „-HT“ (SR2-HT → SR2).
 */
export function lookupPart(key: PartKey, kind: PartKind, door: Door, optionType: string, colors: string): PartKeyEntry | null {
  const type = optionType.trim().toUpperCase();
  const types = !key.heated.has(`${kind}|${door}`) && HEATED.test(type) ? [type, type.replace(HEATED, '')] : [type];
  for (const colour of [partColour(colors, kind), '']) {
    for (const t of types) {
      const entry = key.entries.get(keyOf(kind, door, t, colour));
      if (entry) return entry;
    }
  }
  return null;
}
