// Kontrola mapování: vlastnosti dílů se berou jen z Item_Mapping (bez záloh). Co má být u dílu vyplněné, určuje druh
// dílu (Item Type: FG hotový výrobek, SFG mezivýroba, PG nakupovaný); díl bez druhu se kontroluje podle modulů, ve
// kterých je. Pro každý díl ukáže, co doplnit (celý řádek, nebo které sloupce) a kvůli kterým modulům / podle druhu.

import type { CallOffExport } from './calloffs/parse';
import type { CoverageSource } from './coverage/compute';
import { customerDisplay, ITEM_KINDS, type ItemKind, type MasterData, type MasterField, type MasterItem } from './masterdata';

export const CHECK_MODULES = ['coverage', 'calloffs', 'planning', 'components'] as const;
export type CheckModule = (typeof CHECK_MODULES)[number];

/** Kontrolované sloupce mapování. */
export const CHECKED_FIELDS = ['kind', 'customerNumber', 'project', 'customer', 'side', 'variant', 'category', 'description', 'line', 'orderMultiple'] as const;
export type CheckedField = (typeof CHECKED_FIELDS)[number];
export type CheckedColumn = CheckedField | 'componentCoverage';

/**
 * Co který modul potřebuje u dílů, se kterými pracuje: Coverage díly ze souborů Coverage (i dlaždice Zákazník),
 * Odvolávky díly z aktuálního exportu, Plánování díly z Coverage (Line u všech; projekt, strana a balení u dílů
 * s Line = ASSEMBLY), Komponenty hotové díly z kusovníků. Varianta jen v projektech, kde ji má aspoň jeden díl.
 */
export const MODULE_FIELDS: Record<CheckModule, readonly CheckedField[]> = {
  coverage: ['project', 'variant', 'category', 'description'],
  calloffs: ['project', 'customer', 'side', 'category', 'description'],
  planning: ['line', 'project', 'side', 'orderMultiple'],
  components: ['project', 'category', 'description'],
};

/** Co má být vyplněné podle druhu dílu (varianta jen v projektech s variantami). */
export const KIND_FIELDS: Record<ItemKind, readonly CheckedField[]> = {
  FG: ['customerNumber', 'project', 'customer', 'side', 'variant', 'category', 'description', 'line', 'orderMultiple'],
  SFG: ['project', 'description', 'line'],
  PG: ['category', 'description'],
};

export interface FieldIssue {
  field: CheckedField;
  /** Moduly, ve kterých díl je a které údaj potřebují (může být prázdné, když je údaj povinný jen podle druhu). */
  modules: CheckModule[];
  /** Údaj je povinný podle druhu dílu. */
  byKind: boolean;
}

export interface PartIssue {
  key: string;
  /** Naše číslo dílu (u dílu bez mapování, pokud ho soubor uvádí). */
  item: string;
  customerNumber: string;
  /** Popis z mapování, u dílu bez mapování ze souboru. */
  description: string;
  project: string;
  kind: ItemKind | '';
  /** Díl v mapování vůbec není – doplnit celý řádek. */
  notInMapping: boolean;
  /** Složka Coverage, ve které díl je (nápověda pro projekt u dílu bez mapování). */
  folder: string;
  /** Prázdné sloupce mapování (u dílu bez mapování prázdné). */
  fields: FieldIssue[];
  /** Moduly, ve kterých díl je (u dílu, který se v načtených datech nepoužívá, prázdné). */
  modules: CheckModule[];
}

/** Sloupec, který v souboru chybí, nebo v něm není nic označené (Line bez ASSEMBLY, Component Coverage bez Ano). */
export interface ColumnIssue {
  column: CheckedColumn;
  kind: 'missing' | 'noneMarked';
  modules: CheckModule[];
  /** Druhy dílů, u kterých je sloupec povinný. */
  kinds: ItemKind[];
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

export interface KindSummary {
  /** Dílů toho druhu v mapování. */
  total: number;
  /** Z nich k doplnění. */
  parts: number;
  fields: Partial<Record<CheckedField, number>>;
}

export interface MappingCheck {
  parts: PartIssue[];
  columns: ColumnIssue[];
  modules: Record<CheckModule, ModuleSummary>;
  kinds: Record<ItemKind, KindSummary>;
  /** Mapování má sloupec Item Type (druh dílu). */
  hasKind: boolean;
  /** Díly bez druhu, které se používají v načtených datech. */
  withoutKind: number;
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

/** Kontrola mapování proti dílům ze souborů Coverage, aktuálního exportu odvolávek, kusovníků a podle druhu dílu. */
export function checkMapping(master: MasterData, { coverage, callOffs, bomParents = [] }: CheckInputs): MappingCheck {
  const parents = [...bomParents];
  const active: Record<CheckModule, boolean> = { coverage: coverage.length > 0, calloffs: callOffs !== undefined, planning: coverage.length > 0, components: parents.length > 0 };
  // Strana se bere ze sloupce Side, jinak z varianty (LHD/RHD) – stačí jeden z nich.
  const has = (field: MasterField) => master.columns.has(field) || (field === 'side' && master.columns.has('variant'));
  const hasKind = has('kind');

  const mapped = new Map<string, { m: MasterItem; contexts: Set<Context> }>();
  const unmapped = new Map<string, { key: string; item: string; customerNumber: string; description: string; folder: string; contexts: Set<Context> }>();
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
  // Díly s vyplněným druhem se kontrolují celé (i když se v načtených datech nepoužívají).
  for (const m of master.items.values()) if (m.kind && !mapped.has(m.item)) mapped.set(m.item, { m, contexts: new Set() });

  const modulesOf = (contexts: Set<Context>): CheckModule[] =>
    CHECK_MODULES.filter((mod) => (mod === 'coverage' || mod === 'planning' ? contexts.has('coverage') : mod === 'calloffs' ? contexts.has('calloffs') : contexts.has('bom')));

  // Varianta je potřeba jen v projektech, které varianty používají (aspoň jeden díl projektu ji má vyplněnou).
  const variantProjects = new Set([...master.items.values()].filter((m) => m.project && m.variant).map((m) => m.project));

  const parts: PartIssue[] = [];
  for (const { contexts, ...u } of unmapped.values()) {
    parts.push({ ...u, project: '', kind: '', notInMapping: true, fields: [], modules: modulesOf(contexts) });
  }
  for (const { m, contexts } of mapped.values()) {
    // Co potřebují moduly, ve kterých díl je.
    const byModule = new Map<CheckedField, CheckModule[]>();
    const need = (mod: CheckModule, fields: readonly CheckedField[]) => fields.forEach((f) => byModule.set(f, [...(byModule.get(f) ?? []), mod]));
    if (contexts.has('coverage')) {
      need('coverage', MODULE_FIELDS.coverage);
      need('planning', m.line === ASSEMBLY ? MODULE_FIELDS.planning : ['line']);
    }
    if (contexts.has('calloffs')) need('calloffs', MODULE_FIELDS.calloffs);
    if (contexts.has('bom')) need('components', MODULE_FIELDS.components);
    const partModules = modulesOf(contexts);
    if (hasKind && !m.kind) byModule.set('kind', partModules);
    // Povinné údaje: podle druhu, bez druhu podle modulů.
    const required = new Set<CheckedField>(m.kind ? KIND_FIELDS[m.kind] : byModule.keys());
    if (hasKind && !m.kind && partModules.length) required.add('kind');
    if (!variantProjects.has(m.project)) required.delete('variant');

    const fields = CHECKED_FIELDS.flatMap((field): FieldIssue[] => {
      if (!required.has(field) || !has(field) || !isEmpty(m, field)) return [];
      const modules = byModule.get(field) ?? [];
      return [{ field, modules: CHECK_MODULES.filter((x) => modules.includes(x)), byKind: m.kind !== '' }];
    });
    if (fields.length) {
      parts.push({
        key: `m:${m.item}`,
        item: m.item,
        customerNumber: m.customerNumber ? customerDisplay(m.customerNumber) : '',
        description: m.description,
        project: m.project,
        kind: m.kind,
        notInMapping: false,
        folder: '',
        fields,
        modules: partModules,
      });
    }
  }
  // Nejdřív díly, které v mapování chybí, pak podle projektu (bez projektu na konci) a čísla.
  parts.sort((a, b) => Number(b.notInMapping) - Number(a.notInMapping) || Number(!a.project) - Number(!b.project) || a.project.localeCompare(b.project, 'cs') || byItem(a, b));

  // Sloupce: chybí v souboru (a kdo je potřebuje), nebo v nich není nic označené.
  const kindsInMapping = ITEM_KINDS.filter((k) => [...master.items.values()].some((m) => m.kind === k));
  const columns: ColumnIssue[] = [];
  if (!hasKind) columns.push({ column: 'kind', kind: 'missing', modules: [], kinds: [] });
  for (const field of CHECKED_FIELDS.filter((f) => f !== 'variant' && f !== 'kind')) {
    const modules = CHECK_MODULES.filter((mod) => active[mod] && MODULE_FIELDS[mod].includes(field));
    const kinds = kindsInMapping.filter((k) => KIND_FIELDS[k].includes(field));
    if ((modules.length || kinds.length) && !has(field)) columns.push({ column: field, kind: 'missing', modules, kinds });
  }
  if (active.planning && has('line') && ![...mapped.values()].some(({ m, contexts }) => contexts.has('coverage') && m.line === ASSEMBLY)) {
    columns.push({ column: 'line', kind: 'noneMarked', modules: ['planning'], kinds: [] });
  }
  if (active.components) {
    if (!has('componentCoverage')) columns.push({ column: 'componentCoverage', kind: 'missing', modules: ['components'], kinds: [] });
    else if (![...master.items.values()].some((m) => m.componentCoverage)) columns.push({ column: 'componentCoverage', kind: 'noneMarked', modules: ['components'], kinds: [] });
  }

  const count = (list: readonly PartIssue[], include: (f: FieldIssue) => boolean) => {
    const fields: Partial<Record<CheckedField, number>> = {};
    for (const p of list) for (const f of p.fields) if (include(f)) fields[f.field] = (fields[f.field] ?? 0) + 1;
    return fields;
  };
  const modules = Object.fromEntries(
    CHECK_MODULES.map((mod): [CheckModule, ModuleSummary] => {
      const list = parts.filter((p) => p.modules.includes(mod) && (p.notInMapping || p.fields.some((f) => f.modules.includes(mod))));
      return [mod, { active: active[mod], parts: list.length, notInMapping: list.filter((p) => p.notInMapping).length, fields: count(list, (f) => f.modules.includes(mod)) }];
    }),
  ) as Record<CheckModule, ModuleSummary>;
  const kinds = Object.fromEntries(
    ITEM_KINDS.map((k): [ItemKind, KindSummary] => {
      const list = parts.filter((p) => p.kind === k);
      return [k, { total: [...master.items.values()].filter((m) => m.kind === k).length, parts: list.length, fields: count(list, () => true) }];
    }),
  ) as Record<ItemKind, KindSummary>;
  const withoutKind = [...mapped.values()].filter(({ m, contexts }) => !m.kind && contexts.size > 0).length;

  return { parts, columns, modules, kinds, hasKind, withoutKind };
}

/** Kolik věcí je potřeba v mapování doplnit (díly a sloupce), celkem nebo pro jeden modul. */
export function checkCount(check: MappingCheck, module?: CheckModule): number {
  if (!module) return check.parts.length + check.columns.length;
  return check.modules[module].parts + check.columns.filter((c) => c.modules.includes(module)).length;
}
