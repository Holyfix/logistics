// Šablona Item_Mapping k vyplnění: list pro každý druh dílu (FG, SFG, PG) jen se sloupci, které aplikace pro daný
// druh používá, a list Návod. Druh dílu určuje název listu. Formátování je jen záhlaví (povinný / volitelný sloupec),
// aby byl soubor v Excelu rychlý; chybějící údaj zůstane prázdný.

import type { ReportCell, ReportSheet } from './calloffs/summaryReport';
import { KIND_FIELDS, type CheckedField } from './mappingCheck';
import { customerDisplay, ITEM_KINDS, type ItemKind, type MasterData, type MasterItem } from './masterdata';

type TemplateKey = 'item' | 'customerNumber' | 'description' | 'project' | 'category' | 'side' | 'variant' | 'line' | 'orderMultiple' | 'supplier';

/** Sloupce šablony: záhlaví a šířka. */
export const TEMPLATE_COLUMNS: Record<TemplateKey, { header: string; width: number }> = {
  item: { header: 'Item Number', width: 16 },
  customerNumber: { header: 'Customer Number', width: 24 },
  description: { header: 'Description', width: 36 },
  project: { header: 'Project', width: 11 },
  category: { header: 'Category', width: 14 },
  side: { header: 'Side', width: 8 },
  variant: { header: 'Variant', width: 16 },
  line: { header: 'Line', width: 11 },
  orderMultiple: { header: 'Order Multiple', width: 10 },
  supplier: { header: 'Supplier', width: 22 },
};

/** Sloupce listu podle druhu dílu: jen to, co aplikace u daného druhu používá. */
export const KIND_COLUMNS: Record<ItemKind, readonly TemplateKey[]> = {
  FG: ['item', 'customerNumber', 'description', 'project', 'category', 'side', 'variant', 'line', 'orderMultiple'],
  SFG: ['item', 'description', 'project', 'line'],
  PG: ['item', 'description', 'supplier', 'project', 'category'],
};

/** Všechny sloupce šablony v pořadí (pro Návod). */
const ALL_COLUMNS = Object.keys(TEMPLATE_COLUMNS) as TemplateKey[];

/**
 * List šablony pro díl: druh z mapování. Díl bez druhu se zařadí podle údajů (dřívější Component Coverage = Ano → PG,
 * linka FOA / SLH / IMM → SFG, jinak FG), díl, který v mapování chybí (z Coverage, odvolávek, kusovníků), do FG.
 * Po nahrání šablony má díl druh podle listu, na kterém je.
 */
export function templateKind(m: MasterItem | undefined): ItemKind {
  if (!m) return 'FG';
  if (m.kind) return m.kind;
  if (m.componentCoverage) return 'PG';
  if (['FOA', 'SLH', 'IMM'].includes(m.line)) return 'SFG';
  return 'FG';
}

/**
 * Údaj u druhu dílu: povinný, volitelný, nebo ho druh nepotřebuje (sloupec na listu druhu není). Strana je volitelná
 * (kontrola ji chce jen v kategoriích dělených na LHD / RHD), balení povinné (kontrola ho chce jen u ASSEMBLY).
 */
export type ColumnStatus = 'required' | 'optional' | 'notNeeded';

export function columnStatus(key: TemplateKey, kind: ItemKind): ColumnStatus {
  if (!KIND_COLUMNS[kind].includes(key)) return 'notNeeded';
  if (key === 'item') return 'required';
  if (key === 'side') return 'optional';
  return KIND_FIELDS[kind].includes(key as CheckedField) ? 'required' : 'optional';
}

const COLORS = {
  header: '#1D5C9E',
  optionalHeader: '#BDD7EE',
  notNeeded: '#EDEDED',
  muted: '#8A8A8A',
};

export interface TemplateTexts {
  sheetGuide: string;
  title: string;
  legend: { requiredColumn: string; optionalColumn: string };
  column: string;
  kinds: Record<ItemKind, string>;
  note: string;
  required: string;
  optional: string;
  /** Strana u FG: jen v kategoriích dělených na LHD / RHD. */
  sideRule: string;
  /** Balení u FG: jen u linky ASSEMBLY. */
  packRule: string;
  /** Projekt a kategorie u PG: jen u dílů, které zákazník odvolává. */
  calloffRule: string;
  notNeeded: string;
  /** Poznámka ke sloupci (podle klíče sloupce). */
  columnNotes: Partial<Record<TemplateKey, string>>;
  footnotes: string[];
}

export interface TemplatePart {
  item: string;
  customerNumber: string;
  description: string;
  /** List šablony (navržený druh z kontroly); bez něj FG. */
  kind?: ItemKind;
}

type Value = string | number | null;

function valuesOf(m: MasterItem | undefined, part: TemplatePart): Record<TemplateKey, Value> {
  return {
    item: m?.item ?? part.item,
    customerNumber: m?.customerNumber || part.customerNumber,
    description: m?.description || part.description,
    project: m?.project ?? '',
    side: m?.side ?? '',
    variant: m?.variant ?? '',
    category: m?.category ?? '',
    line: m?.line ?? '',
    orderMultiple: m?.orderMultiple ?? null,
    supplier: m?.supplier ?? '',
  };
}

const headerCell = (key: TemplateKey, optional: boolean): ReportCell => ({
  value: TEMPLATE_COLUMNS[key].header,
  fontWeight: 'bold',
  textColor: optional ? '#1F1F1F' : '#FFFFFF',
  backgroundColor: optional ? COLORS.optionalHeader : COLORS.header,
  alignVertical: 'center',
  wrap: true,
  height: 30,
});

const valueCell = (value: Value): ReportCell => (value === null || value === '' ? {} : typeof value === 'number' ? { value, type: Number } : { value: String(value) });

/**
 * Šablona mapování: listy FG, SFG, PG (díly mapování podle `templateKind` a `extra` = díly, které v mapování
 * chybí, na listu FG) a Návod. Světlé záhlaví = volitelný sloupec; chybějící údaje zůstanou prázdné.
 */
export function mappingTemplate(master: MasterData | undefined, extra: readonly TemplatePart[], texts: TemplateTexts): ReportSheet[] {
  const items = [...(master?.items.values() ?? [])];
  const known = new Set(items.map((m) => m.item.toUpperCase()));
  const rows = [
    ...items.map((m) => ({ kind: templateKind(m), values: valuesOf(m, { item: m.item, customerNumber: '', description: '' }) })),
    ...extra
      .filter((p) => !p.item || !known.has(p.item.toUpperCase()))
      .map((p) => ({ kind: p.kind ?? templateKind(undefined), values: valuesOf(undefined, { ...p, customerNumber: p.customerNumber ? customerDisplay(p.customerNumber) : '' }) })),
  ];

  const sheets: ReportSheet[] = ITEM_KINDS.map((kind) => {
    const keys = KIND_COLUMNS[kind];
    const optional = (key: TemplateKey) => columnStatus(key, kind) === 'optional';
    const data = rows.filter((r) => r.kind === kind).map((r) => keys.map((k): ReportCell => ({ ...valueCell(r.values[k]), ...(k === 'item' ? { fontWeight: 'bold' } : {}) })));
    return {
      name: kind,
      data: [keys.map((k) => headerCell(k, optional(k))), ...data],
      columns: keys.map((k) => ({ width: TEMPLATE_COLUMNS[k].width })),
      stickyRows: 1,
      stickyColumns: 1,
      gridLines: true,
    };
  });

  // Návod: legenda a tabulka sloupec × druh.
  const wide = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: 5 }, null, null, null, null];
  const swatch = (cell: ReportCell, text: string): (ReportCell | null)[] => [cell, { value: text, columnSpan: 4 }, null, null, null];
  const guideColumns = ALL_COLUMNS.filter((k) => k !== 'item');
  const statusText = (key: TemplateKey, kind: ItemKind): ReportCell => {
    if (kind === 'FG' && key === 'side') return { value: texts.sideRule, align: 'center', wrap: true };
    if (kind === 'FG' && key === 'orderMultiple') return { value: texts.packRule, fontWeight: 'bold', align: 'center', wrap: true };
    if (kind === 'PG' && (key === 'project' || key === 'category')) return { value: texts.calloffRule, align: 'center', wrap: true };
    const s = columnStatus(key, kind);
    if (s === 'required') return { value: texts.required, fontWeight: 'bold', align: 'center' };
    if (s === 'notNeeded') return { value: texts.notNeeded, backgroundColor: COLORS.notNeeded, textColor: COLORS.muted, align: 'center' };
    return { value: texts.optional, align: 'center' };
  };
  const th = (value: string): ReportCell => ({ value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: COLORS.header, wrap: true, alignVertical: 'center', height: 30 });
  const guide: ReportSheet = {
    name: texts.sheetGuide,
    data: [
      wide({ value: texts.title, fontWeight: 'bold', fontSize: 14, height: 24 }),
      [],
      swatch({ value: 'Item Number', fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: COLORS.header }, texts.legend.requiredColumn),
      swatch({ value: 'Variant', fontWeight: 'bold', backgroundColor: COLORS.optionalHeader }, texts.legend.optionalColumn),
      [],
      [th(texts.column), ...ITEM_KINDS.map((k) => th(`${k} – ${texts.kinds[k]}`)), th(texts.note)],
      ...guideColumns.map((k) => [{ value: TEMPLATE_COLUMNS[k].header, fontWeight: 'bold' as const }, ...ITEM_KINDS.map((kind) => statusText(k, kind)), { value: texts.columnNotes[k] ?? '', wrap: true }]),
      [],
      ...texts.footnotes.map((f) => wide({ value: f })),
    ],
    columns: [{ width: 20 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 60 }],
    stickyRows: 0,
    stickyColumns: 0,
  };
  return [...sheets, guide];
}
