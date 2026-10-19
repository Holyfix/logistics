// Přehled odvolávek po projektech: strom Projekt → Kategorie → Strana → Varianta se součty po obdobích. Strana
// a varianta jsou úrovní jen tam, kde je díly mají (např. kategorie IP bez stran má rovnou díly s variantou nebo nic).

import type { MasterItem } from '../masterdata';
import { ITEM_FIELDS, type ItemField } from './filter';
import type { CurrentRow } from './views';

export interface SummaryNode {
  /** Jednoznačný klíč uzlu (cesta údajů a hodnot od projektu). */
  key: string;
  /** Hloubka ve stromu (0 = projekt, 1 = kategorie, 2 a 3 = strana / varianta). */
  level: number;
  /** Údaj z mapování, podle kterého uzel vznikl. */
  field: ItemField;
  /** Hodnota z mapování; prázdná = neuvedeno. */
  label: string;
  /** Počet dílů v uzlu. */
  items: number;
  values: number[];
  total: number;
  /** Změna proti předchozímu exportu v obdobích, která oba exporty pokrývají; null bez předchozího exportu. */
  diff: number | null;
  /** Součet předchozího exportu v týchž obdobích (základ pro změnu v %); null bez předchozího exportu. */
  previousTotal: number | null;
  children: SummaryNode[];
}

/** Údaje, které jsou úrovní jen tam, kde je aspoň jeden díl skupiny má vyplněné. */
const OPTIONAL: readonly ItemField[] = ['side', 'variant'];

/** Prázdné hodnoty (díly bez mapování nebo bez údaje) na konec, ostatní abecedně. */
const byLabel = (a: SummaryNode, b: SummaryNode) => Number(!a.label) - Number(!b.label) || a.label.localeCompare(b.label, 'cs', { numeric: true });

/**
 * Součty řádků odvolávek po projektech, pod nimi po kategoriích, stranách a variantách z mapování (sloupce Project,
 * Category, Side, Variant). Díly bez mapování nebo bez údaje patří do uzlu s prázdným názvem. Strana a varianta se
 * přeskočí, když ji nemá žádný díl skupiny (součet dětí pak vždy odpovídá rodiči).
 */
export function summarize(rows: readonly CurrentRow[], master: ReadonlyMap<string, MasterItem> | undefined): SummaryNode[] {
  const periods = rows[0]?.values.length ?? 0;
  const hasPrevious = rows.some((r) => r.previous.some((p) => p !== null));

  const build = (group: readonly CurrentRow[], index: number, level: number, parent: string): SummaryNode[] => {
    const field = ITEM_FIELDS[index];
    if (!field) return [];
    const valueOf = (row: CurrentRow) => master?.get(row.item)?.[field] ?? '';
    if (OPTIONAL.includes(field) && group.every((r) => !valueOf(r))) return build(group, index + 1, level, parent);
    const byValue = new Map<string, CurrentRow[]>();
    for (const row of group) byValue.set(valueOf(row), [...(byValue.get(valueOf(row)) ?? []), row]);
    return [...byValue.entries()]
      .map(([label, list]): SummaryNode => {
        const key = `${parent}|${field}:${label}`;
        const values = Array.from({ length: periods }, (_, k) => list.reduce((s, r) => s + r.values[k]!, 0));
        let diff = 0;
        let previousTotal = 0;
        for (const r of list)
          r.values.forEach((v, k) => {
            const p = r.previous[k];
            if (p === null || p === undefined) return;
            diff += v - p;
            previousTotal += p;
          });
        return {
          key,
          level,
          field,
          label,
          items: list.length,
          values,
          total: values.reduce((a, b) => a + b, 0),
          diff: hasPrevious ? diff : null,
          previousTotal: hasPrevious ? previousTotal : null,
          children: build(list, index + 1, level + 1, key),
        };
      })
      .sort(byLabel);
  };
  return build(rows, 0, 0, '');
}

/** Uzly v pořadí řádků tabulky (rodič, pak jeho děti), jen rozbalené větve. */
export function visibleNodes(nodes: readonly SummaryNode[], expanded: ReadonlySet<string>): SummaryNode[] {
  return nodes.flatMap((n) => [n, ...(expanded.has(n.key) ? visibleNodes(n.children, expanded) : [])]);
}
