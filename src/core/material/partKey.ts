// Klíč MC/MF: Middlefield podle dveří (Side), výbavy (Type = Option Type v matici) a barvy (Colour = barva MF
// ze sloupce „MC / MF“ v matici). Nahrazuje dohledání přes JIT Overview a kusovník.

import { cellText, type Cell } from '../table';
import { findColumn } from '../csv';
import { DOORS, type Door } from './jit';

export interface PartKeyEntry {
  item: string;
  description: string;
}

export interface PartKey {
  /** Klíč `dveře|výbava|barva` (velkými písmeny) → díl MF. */
  entries: Map<string, PartKeyEntry>;
  /** Dveře, které mají v klíči vyhřívanou výbavu („…-HT“); u ostatních se vyhřívání nerozlišuje. */
  heated: Set<Door>;
}

export type PartKeyResult = { ok: true; value: PartKey } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Middlefield podle popisu („ASSY MF …“). */
export function isMiddlefield(description: string): boolean {
  return /\bMF\b/.test(description.toUpperCase());
}

const COLUMNS = { side: ['Side'], item: ['Item Number', 'Item'], type: ['Type', 'Option Type'], colour: ['Colour', 'Color'], description: ['Description'] };
const HEATED = /-HT$/;

const keyOf = (door: Door, type: string, colour: string) => `${door}|${type.trim().toUpperCase()}|${colour.trim().toUpperCase()}`;

/** Klíč MC/MF z listu: záhlaví je řádek se sloupci Side, Item Number, Type a Colour; bere se jen Middlefield (popis s „MF“). */
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
  const heated = new Set<Door>();
  for (const row of data.slice(headerIndex + 1)) {
    const door = cellText(row[col.side]).toUpperCase() as Door;
    const item = cellText(row[col.item]);
    const type = cellText(row[col.type]);
    const description = col.description === -1 ? '' : cellText(row[col.description]);
    // Bez popisu se díl bere jako MF; Maincarrier („MC“ v popisu) se nepočítá.
    if (!DOORS.includes(door) || !item || !type || (description && !isMiddlefield(description))) continue;
    entries.set(keyOf(door, type, cellText(row[col.colour])), { item, description });
    if (HEATED.test(type.trim().toUpperCase())) heated.add(door);
  }
  return { ok: true, value: { entries, heated } };
}

/** Barva Middlefieldu ze sloupce „MC / MF“ matice („C9 / C1“ → „C1“; jedna barva platí pro oba). */
export function mfColour(colors: string): string {
  const parts = colors.split('/').map((s) => s.trim());
  return parts[1] || parts[0] || '';
}

/**
 * MF pro dveře vozu podle klíče. Dveře, které v klíči vyhřívanou výbavu nemají (typicky zadní), se hledají
 * pod výbavou bez „-HT“ (SR2-HT → SR2).
 */
export function lookupMf(key: PartKey, door: Door, optionType: string, colors: string): PartKeyEntry | null {
  const colour = mfColour(colors);
  const type = optionType.trim().toUpperCase();
  return key.entries.get(keyOf(door, type, colour)) ?? (!key.heated.has(door) && HEATED.test(type) ? (key.entries.get(keyOf(door, type.replace(HEATED, ''), colour)) ?? null) : null);
}
