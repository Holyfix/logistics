// Filtrování dílů podle kmenových dat a hledaného textu. Filtry Projekt, Kategorie, Strana a Varianta se ovlivňují
// navzájem v libovolném pořadí: každý nabízí jen hodnoty dílů, které odpovídají ostatním vybraným filtrům.

import type { MasterItem } from '../masterdata';

/** Hodnota filtru projektu pro díly, které v kmenových datech chybí. */
export const MISSING_MASTER = '__missing__';

/** Údaje z mapování, podle kterých se odvolávky filtrují a členění (v tomto pořadí). */
export const ITEM_FIELDS = ['project', 'category', 'side', 'variant'] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

export interface ItemFilter {
  project: string;
  /** Kategorie z mapování (sloupec Category, např. DP, IP). */
  category: string;
  side: string;
  variant: string;
  query: string;
}

export const EMPTY_FILTER: ItemFilter = { project: '', category: '', side: '', variant: '', query: '' };

/** Díl odpovídá filtrům mapování (bez hledání); `except` = bez filtru tohoto údaje (pro jeho nabídku). */
function matches(m: MasterItem | undefined, filter: ItemFilter, except?: ItemField): boolean {
  if (filter.project === MISSING_MASTER && except !== 'project') return !m;
  return ITEM_FIELDS.every((field) => field === except || !filter[field] || m?.[field] === filter[field]);
}

export function filterItems(
  items: readonly string[],
  descriptions: readonly string[],
  master: ReadonlyMap<string, MasterItem> | undefined,
  filter: ItemFilter,
): string[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item, i) => {
    if (!matches(master?.get(item), filter)) return false;
    if (query && !`${item} ${descriptions[i] ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

export type ItemOptions = Record<'projects' | 'categories' | 'sides' | 'variants', string[]> & { missing: number };

/**
 * Hodnoty pro výběr ve filtrech: jen ty, které mají díly v exportu a odpovídají ostatním vybraným filtrům (kategorie
 * vybraného projektu, projekty vybrané kategorie …). Prázdný seznam = údaj u těchto dílů není (filtr se nezobrazí).
 */
export function filterOptions(items: readonly string[], master: ReadonlyMap<string, MasterItem> | undefined, filter: ItemFilter = EMPTY_FILTER): ItemOptions {
  const sets = ITEM_FIELDS.map(() => new Set<string>());
  let missing = 0;
  for (const item of items) {
    const m = master?.get(item);
    if (!m) {
      missing++;
      continue;
    }
    ITEM_FIELDS.forEach((field, index) => {
      if (m[field] && matches(m, filter, field)) sets[index]!.add(m[field]);
    });
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
  const [projects, categories, sides, variants] = sets.map(sorted) as [string[], string[], string[], string[]];
  return { projects, categories, sides, variants, missing };
}
