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
  /** Směny po obdobích (kusy ÷ výkon za směnu kategorie dílu, jen díly s výkonem); null, když výkon nemá žádný díl. */
  shifts: number[] | null;
  /** Kolik dílů uzlu výkon za směnu nemá (směny jsou pak neúplné). */
  shiftsMissing: number;
  /** Výkon za směnu, když je u všech dílů uzlu stejný (kategorie a níž); jinak null. */
  perShift: number | null;
  children: SummaryNode[];
}

/** Výkon za směnu dílu (podle projektu a kategorie z mapování); null = nevyplněno. */
export type PerShift = (item: string) => number | null;

/** Směny dílů po obdobích (jen díly s výkonem) a počet dílů bez výkonu; null, když výkon nemá žádný díl. */
export function shiftsOf(rows: readonly CurrentRow[], perShift: PerShift | undefined, periods: number): { values: number[]; missing: number } | null {
  if (!perShift) return null;
  const known = rows.flatMap((r) => {
    const o = perShift(r.item);
    return o !== null && o > 0 ? [{ r, o }] : [];
  });
  if (!known.length) return null;
  return { values: Array.from({ length: periods }, (_, k) => known.reduce((s, { r, o }) => s + r.values[k]! / o, 0)), missing: rows.length - known.length };
}

/** Údaje, které jsou úrovní jen tam, kde je aspoň jeden díl skupiny má vyplněné. */
const OPTIONAL: readonly ItemField[] = ['side', 'variant'];

/** Prázdné hodnoty (díly bez mapování nebo bez údaje) na konec, ostatní abecedně. */
const byLabel = (a: SummaryNode, b: SummaryNode) => Number(!a.label) - Number(!b.label) || a.label.localeCompare(b.label, 'cs', { numeric: true });

/** Společná hodnota, když jsou všechny stejné (a vyplněné); jinak null. */
const sameOutput = (values: readonly (number | null)[]) => (values.length && values.every((v) => v !== null && v === values[0]) ? values[0]! : null);

/**
 * Součty řádků odvolávek po projektech, pod nimi po kategoriích, stranách a variantách z mapování (sloupce Project,
 * Category, Side, Variant). Díly bez mapování nebo bez údaje patří do uzlu s prázdným názvem. Strana a varianta se
 * přeskočí, když ji nemá žádný díl skupiny (součet dětí pak vždy odpovídá rodiči).
 */
export function summarize(rows: readonly CurrentRow[], master: ReadonlyMap<string, MasterItem> | undefined, perShift?: PerShift): SummaryNode[] {
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
          ...(() => {
            const s = shiftsOf(list, perShift, periods);
            return { shifts: s?.values ?? null, shiftsMissing: s ? s.missing : perShift ? list.length : 0 };
          })(),
          perShift: perShift ? sameOutput(list.map((r) => perShift(r.item))) : null,
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
