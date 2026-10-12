// Filtrování dílů podle kmenových dat a hledaného textu.

import type { MasterItem } from '../masterdata';

/** Hodnota filtru zákazníka pro díly, které v kmenových datech chybí. */
export const MISSING_MASTER = '__missing__';

export interface ItemFilter {
  customer: string;
  project: string;
  side: string;
  query: string;
}

export const EMPTY_FILTER: ItemFilter = { customer: '', project: '', side: '', query: '' };

export function filterItems(
  items: readonly string[],
  descriptions: readonly string[],
  master: ReadonlyMap<string, MasterItem> | undefined,
  filter: ItemFilter,
): string[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item, i) => {
    const m = master?.get(item);
    if (filter.customer === MISSING_MASTER) {
      if (m) return false;
    } else if (filter.customer && m?.customer !== filter.customer) return false;
    if (filter.project && m?.project !== filter.project) return false;
    if (filter.side && m?.side !== filter.side) return false;
    if (query && !`${item} ${descriptions[i] ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

/** Hodnoty pro výběr ve filtrech: jen ty, které mají díly v exportu. */
export function filterOptions(items: readonly string[], master: ReadonlyMap<string, MasterItem> | undefined) {
  const customers = new Set<string>();
  const projects = new Set<string>();
  const sides = new Set<string>();
  let missing = 0;
  for (const item of items) {
    const m = master?.get(item);
    if (!m) {
      missing++;
      continue;
    }
    if (m.customer) customers.add(m.customer);
    if (m.project) projects.add(m.project);
    if (m.side) sides.add(m.side);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, 'cs'));
  return { customers: sorted(customers), projects: sorted(projects), sides: sorted(sides), missing };
}
