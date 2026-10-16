// Kontrola mapování po modulech: vlastnosti dílů se berou jen z Item_Mapping (bez záloh). Pro každý díl ukáže, co
// v mapování doplnit (celý řádek, nebo které sloupce) a kvůli kterým modulům; pro sloupce, které v souboru chybí nebo
// v nich není nic označené, kterých modulů se to týká.

import type { CallOffExport } from './calloffs/parse';
import type { CoverageSource } from './coverage/compute';
import { customerDisplay, type MasterData, type MasterField, type MasterItem } from './masterdata';

export const CHECK_MODULES = ['coverage', 'calloffs', 'planning', 'components'] as const;
export type CheckModule = (typeof CHECK_MODULES)[number];

/** Údaje mapování, které moduly potřebují (sloupce Item_Mapping). */
export const CHECKED_FIELDS = ['project', 'customer', 'side', 'variant', 'category', 'description', 'line', 'orderMultiple'] as const;
export type CheckedField = (typeof CHECKED_FIELDS)[number];
export type CheckedColumn = CheckedField | 'componentCoverage';

/**
 * Co který modul potřebuje u dílů, se kterými pracuje: Coverage díly ze souborů Coverage (i dlaždice Zákazník;
 * varianta jen u projektů, kde ji v mapování má aspoň jeden díl),
 * Odvolávky díly z aktuálního exportu, Plánování díly z Coverage (Line u všech; projekt, strana a balení u dílů
 * s Line = ASSEMBLY), Komponenty hotové díly z kusovníků.
 */
export const MODULE_FIELDS: Record<CheckModule, readonly CheckedField[]> = {
  coverage: ['project', 'variant', 'category', 'description'],
  calloffs: ['project', 'customer', 'side', 'category', 'description'],
  planning: ['line', 'project', 'side', 'orderMultiple'],
  components: ['project', 'category', 'description'],
};

export interface FieldIssue {
  field: CheckedField;
  modules: CheckModule[];
}

export interface PartIssue {
  key: string;
  /** Naše číslo dílu (u dílu bez mapování, pokud ho soubor uvádí). */
  item: string;
  customerNumber: string;
  /** Popis z mapování, u dílu bez mapování ze souboru. */
  description: string;
  project: string;
  /** Díl v mapování vůbec není – doplnit celý řádek. */
  notInMapping: boolean;
  /** Složka Coverage, ve které díl je (nápověda pro projekt u dílu bez mapování). */
  folder: string;
  /** Prázdné sloupce mapování a kvůli kterým modulům (u dílu bez mapování prázdné). */
  fields: FieldIssue[];
  /** Všechny moduly, kterých se díl týká. */
  modules: CheckModule[];
}

/** Sloupec, který v souboru chybí, nebo v něm není nic označené (Line bez ASSEMBLY, Component Coverage bez Ano). */
export interface ColumnIssue {
  column: CheckedColumn;
  kind: 'missing' | 'noneMarked';
  modules: CheckModule[];
}

export interface ModuleSummary {
  /** Modul má data (soubory Coverage, export odvolávek, kusovník). */
  active: boolean;
  /** Dílů k doplnění pro modul. */
  parts: number;
  notInMapping: number;
  /** Počet dílů s prázdným sloupcem (jen sloupce, které modul potřebuje). */
  fields: Partial<Record<CheckedField, number>>;
}

export interface MappingCheck {
  parts: PartIssue[];
  columns: ColumnIssue[];
  modules: Record<CheckModule, ModuleSummary>;
}

export interface CheckInputs {
  coverage: readonly CoverageSource[];
  callOffs: CallOffExport | undefined;
  /** Hotové díly z kusovníků (parent). */
  bomParents?: Iterable<string>;
}

type Context = 'coverage' | 'calloffs' | 'bom';

const ASSEMBLY = 'ASSEMBLY';
const byItem = (a: PartIssue, b: PartIssue) => (a.item || a.customerNumber).localeCompare(b.item || b.customerNumber, 'en', { numeric: true });

function isEmpty(m: MasterItem, field: CheckedField): boolean {
  if (field === 'orderMultiple') return !(m.orderMultiple !== null && m.orderMultiple >= 1);
  return !m[field];
}

/** Kontrola mapování proti dílům ze souborů Coverage, aktuálního exportu odvolávek a kusovníků. */
export function checkMapping(master: MasterData, { coverage, callOffs, bomParents = [] }: CheckInputs): MappingCheck {
  const parents = [...bomParents];
  const active: Record<CheckModule, boolean> = { coverage: coverage.length > 0, calloffs: callOffs !== undefined, planning: coverage.length > 0, components: parents.length > 0 };
  // Strana se bere ze sloupce Side, jinak z varianty (LHD/RHD) – stačí jeden z nich.
  const has = (field: MasterField) => master.columns.has(field) || (field === 'side' && master.columns.has('variant'));

  const mapped = new Map<string, { m: MasterItem; contexts: Set<Context> }>();
  const unmapped = new Map<string, Omit<PartIssue, 'fields' | 'modules' | 'project' | 'notInMapping'> & { contexts: Set<Context> }>();
  const seen = (m: MasterItem, context: Context) => {
    const entry = mapped.get(m.item) ?? { m, contexts: new Set<Context>() };
    entry.contexts.add(context);
    mapped.set(m.item, entry);
  };
  const missing = (key: string, part: { item: string; customerNumber: string; description: string; folder: string }, context: Context) => {
    const entry = unmapped.get(key) ?? { key, ...part, contexts: new Set<Context>() };
    entry.contexts.add(context);
    if (!entry.folder) entry.folder = part.folder;
    if (!entry.description) entry.description = part.description;
    unmapped.set(key, entry);
  };

  for (const source of coverage) {
    for (const row of source.report.rows) {
      const m = master.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master.items.get(row.supplierItem) : undefined);
      if (m) seen(m, 'coverage');
      else {
        const key = row.supplierItem ? `i:${row.supplierItem.toUpperCase()}` : `c:${row.customerKey || row.customerNumber}`;
        missing(key, { item: row.supplierItem, customerNumber: customerDisplay(row.customerNumber), description: row.description, folder: source.project }, 'coverage');
      }
    }
  }
  callOffs?.items.forEach((item, i) => {
    const m = master.items.get(item);
    if (m) seen(m, 'calloffs');
    else missing(`i:${item.toUpperCase()}`, { item, customerNumber: '', description: callOffs.descriptions[i] ?? '', folder: '' }, 'calloffs');
  });
  const byUpper = new Map([...master.items.values()].map((m) => [m.item.toUpperCase(), m]));
  for (const parent of parents) {
    const m = byUpper.get(parent.toUpperCase());
    if (m) seen(m, 'bom');
    else missing(`i:${parent.toUpperCase()}`, { item: parent, customerNumber: '', description: '', folder: '' }, 'bom');
  }

  const modulesOf = (contexts: Set<Context>): CheckModule[] =>
    CHECK_MODULES.filter((mod) => (mod === 'coverage' || mod === 'planning' ? contexts.has('coverage') : mod === 'calloffs' ? contexts.has('calloffs') : contexts.has('bom')));

  // Varianta je potřeba jen v projektech, které varianty používají (aspoň jeden díl projektu ji má vyplněnou).
  const variantProjects = new Set([...master.items.values()].filter((m) => m.project && m.variant).map((m) => m.project));

  const parts: PartIssue[] = [];
  for (const u of unmapped.values()) {
    const { contexts, ...rest } = u;
    parts.push({ ...rest, project: '', notInMapping: true, fields: [], modules: modulesOf(contexts) });
  }
  for (const { m, contexts } of mapped.values()) {
    const needs = new Map<CheckedField, CheckModule[]>();
    const need = (mod: CheckModule, fields: readonly CheckedField[]) => fields.forEach((f) => needs.set(f, [...(needs.get(f) ?? []), mod]));
    if (contexts.has('coverage')) {
      need('coverage', MODULE_FIELDS.coverage.filter((f) => f !== 'variant' || variantProjects.has(m.project)));
      need('planning', m.line === ASSEMBLY ? MODULE_FIELDS.planning : ['line']);
    }
    if (contexts.has('calloffs')) need('calloffs', MODULE_FIELDS.calloffs);
    if (contexts.has('bom')) need('components', MODULE_FIELDS.components);
    const fields = CHECKED_FIELDS.flatMap((field): FieldIssue[] => {
      const modules = needs.get(field);
      return modules && has(field) && isEmpty(m, field) ? [{ field, modules: CHECK_MODULES.filter((x) => modules.includes(x)) }] : [];
    });
    if (fields.length) {
      const modules = CHECK_MODULES.filter((x) => fields.some((f) => f.modules.includes(x)));
      parts.push({ key: `m:${m.item}`, item: m.item, customerNumber: m.customerNumber ? customerDisplay(m.customerNumber) : '', description: m.description, project: m.project, notInMapping: false, folder: '', fields, modules });
    }
  }
  // Nejdřív díly, které v mapování chybí, pak podle projektu (bez projektu na konci) a čísla.
  parts.sort((a, b) => Number(b.notInMapping) - Number(a.notInMapping) || Number(!a.project) - Number(!b.project) || a.project.localeCompare(b.project, 'cs') || byItem(a, b));

  // Sloupce: chybí v souboru, nebo v nich není nic označené.
  const columns: ColumnIssue[] = [];
  // Variant je nepovinný sloupec (jen pro projekty s variantami), jeho chybění se nehlásí.
  for (const field of CHECKED_FIELDS.filter((f) => f !== 'variant')) {
    const modules = CHECK_MODULES.filter((mod) => active[mod] && MODULE_FIELDS[mod].includes(field));
    if (modules.length && !has(field)) columns.push({ column: field, kind: 'missing', modules });
  }
  if (active.planning && has('line') && ![...mapped.values()].some(({ m, contexts }) => contexts.has('coverage') && m.line === ASSEMBLY)) {
    columns.push({ column: 'line', kind: 'noneMarked', modules: ['planning'] });
  }
  if (active.components) {
    if (!has('componentCoverage')) columns.push({ column: 'componentCoverage', kind: 'missing', modules: ['components'] });
    else if (![...master.items.values()].some((m) => m.componentCoverage)) columns.push({ column: 'componentCoverage', kind: 'noneMarked', modules: ['components'] });
  }

  const modules = Object.fromEntries(
    CHECK_MODULES.map((mod): [CheckModule, ModuleSummary] => {
      const list = parts.filter((p) => p.modules.includes(mod));
      const fields: Partial<Record<CheckedField, number>> = {};
      for (const p of list) for (const f of p.fields) if (f.modules.includes(mod)) fields[f.field] = (fields[f.field] ?? 0) + 1;
      return [mod, { active: active[mod], parts: list.length, notInMapping: list.filter((p) => p.notInMapping).length, fields }];
    }),
  ) as Record<CheckModule, ModuleSummary>;

  return { parts, columns, modules };
}

/** Kolik věcí je potřeba v mapování doplnit (díly a sloupce), celkem nebo pro jeden modul. */
export function checkCount(check: MappingCheck, module?: CheckModule): number {
  const parts = module ? check.parts.filter((p) => p.modules.includes(module)).length : check.parts.length;
  const columns = module ? check.columns.filter((c) => c.modules.includes(module)).length : check.columns.length;
  return parts + columns;
}
