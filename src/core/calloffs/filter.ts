// Filtrování dílů podle kmenových dat a hledaného textu. Filtry na sebe navazují: Projekt → Kategorie → Strana →
// Varianta; každý nabízí jen hodnoty dílů, které odpovídají filtrům před ním.

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

/** Nastaví filtr a zruší filtry za ním (jejich hodnoty by nemusely v novém výběru existovat). */
export function setItemFilter(filter: ItemFilter, key: ItemField | 'query', value: string): ItemFilter {
  if (key === 'query') return { ...filter, query: value };
  const index = ITEM_FIELDS.indexOf(key);
  const next = { ...filter, [key]: value };
  for (const later of ITEM_FIELDS.slice(index + 1)) next[later] = '';
  return next;
}

/** Díl odpovídá filtrům mapování (bez hledání); `upTo` = jen filtry před tímto údajem. */
function matches(m: MasterItem | undefined, filter: ItemFilter, upTo: number = ITEM_FIELDS.length): boolean {
  if (filter.project === MISSING_MASTER) return !m;
  return ITEM_FIELDS.slice(0, upTo).every((field) => !filter[field] || m?.[field] === filter[field]);
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
 * Hodnoty pro výběr ve filtrech: jen ty, které mají díly v exportu a odpovídají filtrům před nimi (kategorie
 * vybraného projektu, strany vybrané kategorie …). Prázdný seznam = údaj u těchto dílů není (filtr se nezobrazí).
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
      if (m[field] && matches(m, { ...filter, project: filter.project === MISSING_MASTER ? '' : filter.project }, index)) sets[index]!.add(m[field]);
    });
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
  const [projects, categories, sides, variants] = sets.map(sorted) as [string[], string[], string[], string[]];
  return { projects, categories, sides, variants, missing };
}
