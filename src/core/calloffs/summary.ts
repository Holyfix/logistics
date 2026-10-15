// Přehled odvolávek po projektech: strom Projekt → Kategorie → Strana se součty po obdobích.

import type { MasterItem } from '../masterdata';
import type { CurrentRow } from './views';

export interface SummaryNode {
  /** Jednoznačný klíč uzlu (projekt|kategorie|strana). */
  key: string;
  /** 0 = projekt, 1 = kategorie, 2 = strana. */
  level: 0 | 1 | 2;
  /** Hodnota z mapování; prázdná = neuvedeno. */
  label: string;
  /** Počet dílů v uzlu. */
  items: number;
  values: number[];
  total: number;
  backlog: number;
  /** Změna proti předchozímu exportu v obdobích, která oba exporty pokrývají; null bez předchozího exportu. */
  diff: number | null;
  children: SummaryNode[];
}

const LEVELS = ['project', 'category', 'side'] as const;

/** Prázdné hodnoty (díly bez mapování nebo bez údaje) na konec, ostatní abecedně. */
const byLabel = (a: SummaryNode, b: SummaryNode) => Number(!a.label) - Number(!b.label) || a.label.localeCompare(b.label, 'cs', { numeric: true });

/**
 * Součty řádků odvolávek po projektech, pod nimi po kategoriích a stranách z mapování (sloupce Project, Category,
 * Side). Díly bez mapování nebo bez údaje patří do uzlu s prázdným názvem.
 */
export function summarize(rows: readonly CurrentRow[], master: ReadonlyMap<string, MasterItem> | undefined): SummaryNode[] {
  const periods = rows[0]?.values.length ?? 0;
  const hasPrevious = rows.some((r) => r.previous.some((p) => p !== null));

  const build = (group: readonly CurrentRow[], level: 0 | 1 | 2, parent: string): SummaryNode[] => {
    const field = LEVELS[level];
    const byValue = new Map<string, CurrentRow[]>();
    for (const row of group) {
      const value = master?.get(row.item)?.[field] ?? '';
      byValue.set(value, [...(byValue.get(value) ?? []), row]);
    }
    return [...byValue.entries()]
      .map(([label, list]): SummaryNode => {
        const key = `${parent}|${label}`;
        const values = Array.from({ length: periods }, (_, k) => list.reduce((s, r) => s + r.values[k]!, 0));
        let diff = 0;
        for (const r of list) r.values.forEach((v, k) => (diff += r.previous[k] === null ? 0 : v - r.previous[k]!));
        return {
          key,
          level,
          label,
          items: list.length,
          values,
          total: values.reduce((a, b) => a + b, 0),
          backlog: list.reduce((s, r) => s + r.backlog, 0),
          diff: hasPrevious ? diff : null,
          children: level < 2 ? build(list, (level + 1) as 1 | 2, key) : [],
        };
      })
      .sort(byLabel);
  };
  return build(rows, 0, '');
}

/** Uzly v pořadí řádků tabulky (rodič, pak jeho děti), jen rozbalené větve. */
export function visibleNodes(nodes: readonly SummaryNode[], expanded: ReadonlySet<string>): SummaryNode[] {
  return nodes.flatMap((n) => [n, ...(expanded.has(n.key) ? visibleNodes(n.children, expanded) : [])]);
}
