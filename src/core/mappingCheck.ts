// Kontrola mapování: co je potřeba doplnit v Item_Mapping, aby se údaje o dílech braly z jednoho místa.
// Díly bez mapování, díly s nevyplněnými údaji a díly, jejichž projekt v mapování se liší od složky Coverage.

import type { CallOffExport } from './calloffs/parse';
import type { CoverageSource } from './coverage/compute';
import { customerDisplay, type MasterData, type MasterField, type MasterItem } from './masterdata';

/** Kde se díl bez mapování vyskytuje. */
export type CheckSource = 'coverage' | 'calloffs';

/** Údaje mapování, které aplikace potřebuje (jinak bere zálohu nebo nechá prázdné). */
export const CHECKED_FIELDS = ['project', 'customer', 'side', 'category', 'orderMultiple'] as const;
export type CheckedField = (typeof CHECKED_FIELDS)[number];

export interface MissingPart {
  /** Naše číslo dílu, pokud ho soubor uvádí (odvolávky, některé soubory Coverage). */
  item: string;
  customerNumber: string;
  description: string;
  /** Projekt ze složky Coverage (záloha, kterou aplikace použije). */
  project: string;
  sources: CheckSource[];
}

export interface IncompletePart {
  item: string;
  description: string;
  project: string;
  missing: CheckedField[];
}

export interface ProjectMismatch {
  item: string;
  description: string;
  /** Projekt v mapování (ten aplikace používá). */
  mapping: string;
  /** Projekt podle složek Coverage, ve kterých díl je. */
  folders: string[];
}

export interface MappingCheck {
  missing: MissingPart[];
  incomplete: IncompletePart[];
  mismatch: ProjectMismatch[];
  /** Kontrolované sloupce, které v souboru mapování úplně chybí (u dílů se pak nehlásí jednotlivě). */
  missingColumns: CheckedField[];
}

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const byItem = (a: { item: string; customerNumber?: string }, b: { item: string; customerNumber?: string }) =>
  (a.item || a.customerNumber || '').localeCompare(b.item || b.customerNumber || '', 'en', { numeric: true });

/**
 * Kontrola mapování proti dílům, se kterými aplikace pracuje (soubory Coverage a aktuální export odvolávek).
 * Balení (Order Multiple) se kontroluje jen u dílů z Coverage, které jdou do plánu montáže.
 */
export function checkMapping(master: MasterData, coverage: readonly CoverageSource[], callOffs: CallOffExport | undefined): MappingCheck {
  const missing = new Map<string, MissingPart>();
  const used = new Map<string, { m: MasterItem; inCoverage: boolean }>();
  const folders = new Map<string, Set<string>>();

  const addMissing = (key: string, part: Omit<MissingPart, 'sources'>, source: CheckSource) => {
    const found = missing.get(key);
    if (!found) missing.set(key, { ...part, sources: [source] });
    else if (!found.sources.includes(source)) found.sources.push(source);
  };

  for (const source of coverage) {
    for (const row of source.report.rows) {
      const m = master.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master.items.get(row.supplierItem) : undefined);
      if (!m) {
        const key = row.supplierItem ? `i:${row.supplierItem.toUpperCase()}` : `c:${row.customerKey || row.customerNumber}`;
        addMissing(key, { item: row.supplierItem, customerNumber: customerDisplay(row.customerNumber), description: row.description, project: source.project }, 'coverage');
        continue;
      }
      used.set(m.item, { m, inCoverage: true });
      if (m.project && source.project && !same(m.project, source.project)) folders.set(m.item, (folders.get(m.item) ?? new Set()).add(source.project));
    }
  }

  callOffs?.items.forEach((item, i) => {
    const m = master.items.get(item);
    if (!m) addMissing(`i:${item.toUpperCase()}`, { item, customerNumber: '', description: callOffs.descriptions[i] ?? '', project: '' }, 'calloffs');
    else if (!used.has(m.item)) used.set(m.item, { m, inCoverage: false });
  });

  // Strana se bere ze sloupce Side, jinak z varianty (LHD/RHD), stačí tedy jeden z nich.
  const has = (field: MasterField) => master.columns.has(field) || (field === 'side' && master.columns.has('variant'));
  const missingColumns = CHECKED_FIELDS.filter((f) => !has(f));
  const toAssembly = (m: MasterItem) => !master.hasLineColumn || m.line === 'ASSEMBLY';
  const incomplete = [...used.values()]
    .flatMap(({ m, inCoverage }): IncompletePart[] => {
      const empty = CHECKED_FIELDS.filter((f) => {
        if (!has(f)) return false;
        if (f === 'orderMultiple') return inCoverage && toAssembly(m) && !(m.orderMultiple !== null && m.orderMultiple >= 1);
        return !m[f];
      });
      return empty.length ? [{ item: m.item, description: m.description, project: m.project, missing: empty }] : [];
    })
    .sort((a, b) => Number(!a.project) - Number(!b.project) || a.project.localeCompare(b.project, 'cs') || byItem(a, b));

  const mismatch = [...folders.entries()]
    .map(([item, set]): ProjectMismatch => {
      const m = master.items.get(item)!;
      return { item, description: m.description, mapping: m.project, folders: [...set].sort((a, b) => a.localeCompare(b, 'cs')) };
    })
    .sort(byItem);

  return { missing: [...missing.values()].sort(byItem), incomplete, mismatch, missingColumns };
}

/** Kolik dílů je potřeba v mapování doplnit nebo opravit. */
export function checkCount(check: MappingCheck): number {
  return check.missing.length + check.incomplete.length + check.mismatch.length;
}
