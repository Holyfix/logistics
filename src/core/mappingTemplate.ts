// Šablona Item_Mapping k vyplnění: list pro každý druh dílu (FG, SFG, PG) jen se sloupci, které aplikace pro daný
// druh používá, list „Bez druhu“ pro díly bez Item Type (všechny sloupce, druh se vybírá ze seznamu) a list Návod.
// Druh dílu určuje název listu. Formátování je jen statické (barva záhlaví, chybějící povinné údaje v době
// stažení), aby byl soubor v Excelu rychlý.

import type { ReportCell, ReportSheet } from './calloffs/summaryReport';
import { KIND_FIELDS, type CheckedField } from './mappingCheck';
import { customerDisplay, ITEM_KINDS, type ItemKind, type MasterData, type MasterItem } from './masterdata';

type TemplateKey = 'item' | 'kind' | 'customerNumber' | 'description' | 'project' | 'customer' | 'side' | 'variant' | 'category' | 'line' | 'orderMultiple' | 'componentCoverage';

/** Sloupce šablony: záhlaví a šířka. */
export const TEMPLATE_COLUMNS: Record<TemplateKey, { header: string; width: number }> = {
  item: { header: 'Item Number', width: 16 },
  kind: { header: 'Item Type', width: 9 },
  customerNumber: { header: 'Customer Number', width: 24 },
  description: { header: 'Description', width: 36 },
  project: { header: 'Project', width: 11 },
  customer: { header: 'Customer', width: 12 },
  side: { header: 'Side', width: 8 },
  variant: { header: 'Variant', width: 13 },
  category: { header: 'Category', width: 20 },
  line: { header: 'Line', width: 11 },
  orderMultiple: { header: 'Order Multiple', width: 10 },
  componentCoverage: { header: 'Component Coverage', width: 11 },
};

/** Sloupce listu podle druhu dílu: jen to, co aplikace u daného druhu používá. */
export const KIND_COLUMNS: Record<ItemKind, readonly TemplateKey[]> = {
  FG: ['item', 'customerNumber', 'description', 'project', 'customer', 'side', 'variant', 'category', 'line', 'orderMultiple'],
  SFG: ['item', 'description', 'project', 'line'],
  PG: ['item', 'description', 'category', 'componentCoverage'],
};

/** List pro díly bez druhu: všechny sloupce a Item Type. */
export const NO_KIND_COLUMNS: readonly TemplateKey[] = ['item', 'kind', 'customerNumber', 'description', 'project', 'customer', 'side', 'variant', 'category', 'line', 'orderMultiple', 'componentCoverage'];

/** Řádky pod díly na listu Bez druhu, ve kterých se Item Type také vybírá ze seznamu. */
export const SPARE_ROWS = 200;

/** Údaj u druhu dílu: povinný, volitelný, nebo ho druh nepotřebuje (sloupec na listu druhu není). */
export type ColumnStatus = 'required' | 'optional' | 'notNeeded';

export function columnStatus(key: TemplateKey, kind: ItemKind, variantProject: boolean): ColumnStatus {
  if (!KIND_COLUMNS[kind].includes(key)) return 'notNeeded';
  if (key === 'item') return 'required';
  if (key === 'variant') return variantProject ? 'required' : 'optional';
  return KIND_FIELDS[kind].includes(key as CheckedField) ? 'required' : 'optional';
}

const COLORS = {
  header: '#1D5C9E',
  optionalHeader: '#BDD7EE',
  missing: '#FFE699',
  kindMissing: '#F8CBAD',
  notNeeded: '#EDEDED',
  muted: '#8A8A8A',
};

export interface TemplateTexts {
  sheetNoKind: string;
  sheetGuide: string;
  title: string;
  legend: { requiredColumn: string; optionalColumn: string; missing: string; kindMissing: string };
  column: string;
  kinds: Record<ItemKind, string>;
  note: string;
  required: string;
  optional: string;
  variantRequired: string;
  notNeeded: string;
  /** Poznámka ke sloupci (podle klíče sloupce). */
  columnNotes: Partial<Record<TemplateKey, string>>;
  footnotes: string[];
}

export interface TemplatePart {
  item: string;
  customerNumber: string;
  description: string;
}

type Value = string | number | null;

function valuesOf(m: MasterItem | undefined, part: TemplatePart): Record<TemplateKey, Value> {
  return {
    item: m?.item ?? part.item,
    kind: m?.kind ?? '',
    customerNumber: m?.customerNumber || part.customerNumber,
    description: m?.description || part.description,
    project: m?.project ?? '',
    customer: m?.customer ?? '',
    side: m?.side ?? '',
    variant: m?.variant ?? '',
    category: m?.category ?? '',
    line: m?.line ?? '',
    orderMultiple: m?.orderMultiple ?? null,
    componentCoverage: m?.componentCoverage ? 'Ano' : '',
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
 * Šablona mapování: listy FG, SFG, PG (díly mapování podle druhu), list Bez druhu (díly mapování bez druhu a `extra`
 * = díly, které v mapování chybí) a Návod. Žlutě povinné údaje, které v době stažení chybí; světlé záhlaví = volitelný
 * sloupec.
 */
export function mappingTemplate(master: MasterData | undefined, extra: readonly TemplatePart[], texts: TemplateTexts): ReportSheet[] {
  const items = [...(master?.items.values() ?? [])];
  const variantProjects = new Set(items.filter((m) => m.project && m.variant).map((m) => m.project));
  const known = new Set(items.map((m) => m.item.toUpperCase()));

  const sheet = (name: string, keys: readonly TemplateKey[], rows: Record<TemplateKey, Value>[], cell: (key: TemplateKey, row: Record<TemplateKey, Value>) => ReportCell, optional: (key: TemplateKey) => boolean): ReportSheet => ({
    name,
    data: [keys.map((k) => headerCell(k, optional(k))), ...rows.map((r) => keys.map((k) => cell(k, r)))],
    columns: keys.map((k) => ({ width: TEMPLATE_COLUMNS[k].width })),
    stickyRows: 1,
    stickyColumns: 1,
    gridLines: true,
  });

  const kindSheets = ITEM_KINDS.map((kind) =>
    sheet(
      kind,
      KIND_COLUMNS[kind],
      items.filter((m) => m.kind === kind).map((m) => valuesOf(m, { item: m.item, customerNumber: '', description: '' })),
      (key, r) => {
        const cell = valueCell(r[key]);
        if (key === 'item') return { ...cell, fontWeight: 'bold' };
        const missing = (r[key] === null || r[key] === '') && columnStatus(key, kind, variantProjects.has(String(r.project))) === 'required';
        return missing ? { ...cell, backgroundColor: COLORS.missing } : cell;
      },
      // Varianta je u FG volitelná jen mimo projekty s variantami, záhlaví ji proto vede jako povinnou.
      (key) => key !== 'variant' && columnStatus(key, kind, false) === 'optional',
    ),
  );

  const noKindRows = [
    ...items.filter((m) => !m.kind).map((m) => valuesOf(m, { item: m.item, customerNumber: '', description: '' })),
    ...extra.filter((p) => !p.item || !known.has(p.item.toUpperCase())).map((p) => valuesOf(undefined, { ...p, customerNumber: p.customerNumber ? customerDisplay(p.customerNumber) : '' })),
  ];
  const sheets = [...kindSheets];
  if (noKindRows.length) {
    const noKind = sheet(
      texts.sheetNoKind,
      NO_KIND_COLUMNS,
      noKindRows,
      (key, r) => {
        const cell = valueCell(r[key]);
        if (key === 'item') return { ...cell, fontWeight: 'bold' };
        if (key === 'kind') return { ...cell, fontWeight: 'bold', align: 'center', backgroundColor: COLORS.kindMissing };
        return cell;
      },
      () => false,
    );
    const column = NO_KIND_COLUMNS.indexOf('kind') + 1;
    noKind.lists = [{ from: { row: 2, column }, to: { row: noKindRows.length + 1 + SPARE_ROWS, column }, values: [...ITEM_KINDS] }];
    sheets.push(noKind);
  }

  // Návod: legenda a tabulka sloupec × druh.
  const wide = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: 5 }, null, null, null, null];
  const swatch = (cell: ReportCell, text: string): (ReportCell | null)[] => [cell, { value: text, columnSpan: 4 }, null, null, null];
  const guideColumns = NO_KIND_COLUMNS.filter((k) => k !== 'item' && k !== 'kind');
  const statusText = (key: TemplateKey, kind: ItemKind): ReportCell => {
    if (key === 'variant' && kind === 'FG') return { value: texts.variantRequired, align: 'center', wrap: true };
    const s = columnStatus(key, kind, false);
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
      swatch({ backgroundColor: COLORS.missing }, texts.legend.missing),
      swatch({ backgroundColor: COLORS.kindMissing }, texts.legend.kindMissing),
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
