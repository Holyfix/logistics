// Nastavení ve sdílené složce (Settings.csv): hodnoty, které patří firmě, ne do kódu aplikace.

import { normalizeHeader } from './csv';
import { cellText, type DataTable } from './table';

export interface Settings {
  /** Zóny skladu, které se počítají do našeho skladu; null = výchozí zóny aplikace. */
  stockZones: string[] | null;
  /** Lokace skladu, které se do našeho skladu nepočítají (např. díly už zamontované u odběratele). */
  stockExcludedLocations: string[];
  /** Klíče, kterým aplikace nerozumí (pro upozornění v modulu Data). */
  unknown: string[];
}

export const EMPTY_SETTINGS: Settings = { stockZones: null, stockExcludedLocations: [], unknown: [] };

const KEYS = {
  stockZones: ['Stock zones', 'Sklad zóny', 'Zóny skladu'],
  stockExcludedLocations: ['Stock excluded locations', 'Sklad vyloučené lokace', 'Vyloučené lokace skladu'],
} as const;

/** Hodnota se může zapsat do jedné buňky oddělená čárkou, nebo do dalších sloupců řádku. */
function values(row: DataTable['rows'][number]): string[] {
  return row
    .slice(1)
    .flatMap((cell) => cellText(cell).split(','))
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Tabulka nastavení: v prvním sloupci název, v dalších hodnota. Řádek záhlaví (např. „Setting;Value“)
 * i neznámé klíče se přeskočí. Stejný klíč na víc řádcích se sloučí.
 */
export function parseSettings(table: DataTable): Settings {
  const keyOf = new Map<string, keyof typeof KEYS>();
  for (const [key, aliases] of Object.entries(KEYS) as [keyof typeof KEYS, readonly string[]][]) {
    for (const alias of aliases) keyOf.set(normalizeHeader(alias), key);
  }
  const zones: string[] = [];
  let hasZones = false;
  const excluded: string[] = [];
  const unknown: string[] = [];
  for (const row of [table.header, ...table.rows]) {
    const name = cellText(row[0]);
    if (!name) continue;
    const key = keyOf.get(normalizeHeader(name));
    if (key === 'stockZones') {
      hasZones = true;
      zones.push(...values(row));
    } else if (key === 'stockExcludedLocations') {
      excluded.push(...values(row));
    } else if (row !== table.header) {
      unknown.push(name);
    }
  }
  return { stockZones: hasZones ? [...new Set(zones)] : null, stockExcludedLocations: [...new Set(excluded)], unknown };
}
