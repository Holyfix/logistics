// Kontrola mapování: vlastnosti dílů se berou jen z Item_Mapping (bez záloh ze složek, kusovníku nebo popisu).
// Kontrola ukáže, co v mapování chybí: díly, které v něm nejsou, a díly s nevyplněnými údaji.

import type { CallOffExport } from './calloffs/parse';
import type { CoverageSource } from './coverage/compute';
import { customerDisplay, type MasterData, type MasterField, type MasterItem } from './masterdata';

/** Kde se díl bez mapování vyskytuje. */
export type CheckSource = 'coverage' | 'calloffs' | 'bom';

/** Údaje mapování, které aplikace potřebuje; bez nich zůstanou prázdné. */
export const CHECKED_FIELDS = ['project', 'customer', 'side', 'category', 'description', 'line', 'orderMultiple'] as const;
export type CheckedField = (typeof CHECKED_FIELDS)[number];
/** Sloupce, které musí soubor mapování mít (Component Coverage jen s načteným kusovníkem). */
export type CheckedColumn = CheckedField | 'componentCoverage';

export interface MissingPart {
  /** Naše číslo dílu, pokud ho soubor uvádí (odvolávky, kusovník, některé soubory Coverage). */
  item: string;
  customerNumber: string;
  description: string;
  /** Složka Coverage, ve které díl je (jen nápověda pro doplnění projektu; aplikace ji nepoužije). */
  folder: string;
  sources: CheckSource[];
}

export interface IncompletePart {
  item: string;
  description: string;
  project: string;
  missing: CheckedField[];
}

export interface MappingCheck {
  missing: MissingPart[];
  incomplete: IncompletePart[];
  /** Potřebné sloupce, které v souboru mapování chybí (u dílů se pak nehlásí jednotlivě). */
  missingColumns: CheckedColumn[];
}

export interface CheckInputs {
  coverage: readonly CoverageSource[];
  callOffs: CallOffExport | undefined;
  /** Hotové díly z kusovníků (parent). */
  bomParents?: Iterable<string>;
}

const byItem = (a: { item: string; customerNumber?: string }, b: { item: string; customerNumber?: string }) =>
  (a.item || a.customerNumber || '').localeCompare(b.item || b.customerNumber || '', 'en', { numeric: true });

/**
 * Kontrola mapování proti dílům, se kterými aplikace pracuje (soubory Coverage, aktuální export odvolávek, hotové díly
 * z kusovníků). Linka se kontroluje u dílů z Coverage (bez ní nejdou do plánu montáže), balení u dílů s Line = ASSEMBLY.
 */
export function checkMapping(master: MasterData, { coverage, callOffs, bomParents = [] }: CheckInputs): MappingCheck {
  const missing = new Map<string, MissingPart>();
  const used = new Map<string, { m: MasterItem; inCoverage: boolean }>();
  const markUsed = (m: MasterItem, inCoverage: boolean) => used.set(m.item, { m, inCoverage: inCoverage || (used.get(m.item)?.inCoverage ?? false) });

  const addMissing = (key: string, part: Omit<MissingPart, 'sources'>, source: CheckSource) => {
    const found = missing.get(key);
    if (!found) missing.set(key, { ...part, sources: [source] });
    else {
      if (!found.sources.includes(source)) found.sources.push(source);
      if (!found.folder) found.folder = part.folder;
      if (!found.description) found.description = part.description;
    }
  };

  for (const source of coverage) {
    for (const row of source.report.rows) {
      const m = master.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master.items.get(row.supplierItem) : undefined);
      if (m) markUsed(m, true);
      else {
        const key = row.supplierItem ? `i:${row.supplierItem.toUpperCase()}` : `c:${row.customerKey || row.customerNumber}`;
        addMissing(key, { item: row.supplierItem, customerNumber: customerDisplay(row.customerNumber), description: row.description, folder: source.project }, 'coverage');
      }
    }
  }
  callOffs?.items.forEach((item, i) => {
    const m = master.items.get(item);
    if (m) markUsed(m, false);
    else addMissing(`i:${item.toUpperCase()}`, { item, customerNumber: '', description: callOffs.descriptions[i] ?? '', folder: '' }, 'calloffs');
  });
  const byUpper = new Map([...master.items.values()].map((m) => [m.item.toUpperCase(), m]));
  for (const parent of bomParents) {
    const m = byUpper.get(parent.toUpperCase());
    if (m) markUsed(m, false);
    else addMissing(`i:${parent.toUpperCase()}`, { item: parent, customerNumber: '', description: '', folder: '' }, 'bom');
  }

  // Strana se bere ze sloupce Side, jinak z varianty (LHD/RHD) – stačí jeden z nich.
  const has = (field: MasterField) => master.columns.has(field) || (field === 'side' && master.columns.has('variant'));
  const bomLoaded = [...bomParents].length > 0;
  const missingColumns: CheckedColumn[] = [...CHECKED_FIELDS.filter((f) => !has(f)), ...(bomLoaded && !has('componentCoverage') ? (['componentCoverage'] as const) : [])];

  const incomplete = [...used.values()]
    .flatMap(({ m, inCoverage }): IncompletePart[] => {
      const empty = CHECKED_FIELDS.filter((f) => {
        if (!has(f)) return false;
        if (f === 'line') return inCoverage && !m.line;
        if (f === 'orderMultiple') return m.line === 'ASSEMBLY' && !(m.orderMultiple !== null && m.orderMultiple >= 1);
        return !m[f];
      });
      return empty.length ? [{ item: m.item, description: m.description, project: m.project, missing: empty }] : [];
    })
    .sort((a, b) => Number(!a.project) - Number(!b.project) || a.project.localeCompare(b.project, 'cs') || byItem(a, b));

  return { missing: [...missing.values()].sort(byItem), incomplete, missingColumns };
}

/** Kolik dílů je potřeba v mapování doplnit. */
export function checkCount(check: MappingCheck): number {
  return check.missing.length + check.incomplete.length;
}
