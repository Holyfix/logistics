// Šablona Item_Mapping k vyplnění: list Mapping (všechny díly mapování a díly, které v něm chybí) s buňkami
// obarvenými podle druhu dílu (povinné vyplněné / povinné chybí / volitelné / druh nepotřebuje) a list Návod
// s tabulkou, co vyplnit pro FG, SFG a PG. Aplikace čte jen první list.

import type { ReportCell, ReportSheet } from './calloffs/summaryReport';
import { KIND_FIELDS, type CheckedField } from './mappingCheck';
import { customerDisplay, ITEM_KINDS, type ItemKind, type MasterData, type MasterItem } from './masterdata';

type TemplateKey = 'item' | 'kind' | 'customerNumber' | 'description' | 'project' | 'customer' | 'side' | 'variant' | 'category' | 'line' | 'orderMultiple' | 'componentCoverage' | 'type' | 'safetyStock' | 'safetyTime';

/** Sloupce šablony v pořadí: nejdřív klíč a druh, pak údaje podle důležitosti, nakonec nepoužívané. */
export const TEMPLATE_COLUMNS: readonly { key: TemplateKey; header: string; width: number }[] = [
  { key: 'item', header: 'Item Number', width: 16 },
  { key: 'kind', header: 'Item Type', width: 9 },
  { key: 'customerNumber', header: 'Customer Number', width: 24 },
  { key: 'description', header: 'Description', width: 36 },
  { key: 'project', header: 'Project', width: 11 },
  { key: 'customer', header: 'Customer', width: 12 },
  { key: 'side', header: 'Side', width: 8 },
  { key: 'variant', header: 'Variant', width: 13 },
  { key: 'category', header: 'Category', width: 14 },
  { key: 'line', header: 'Line', width: 11 },
  { key: 'orderMultiple', header: 'Order Multiple', width: 10 },
  { key: 'componentCoverage', header: 'Component Coverage', width: 11 },
  { key: 'type', header: 'Type', width: 10 },
  { key: 'safetyStock', header: 'Safety Stock', width: 9 },
  { key: 'safetyTime', header: 'Safety Time', width: 9 },
];

/** Stav buňky: povinná (podle druhu), volitelná, druh ji nepotřebuje, klíč (Item Number), nebo chybí druh. */
export type CellStatus = 'required' | 'optional' | 'notNeeded' | 'key' | 'kind';

export function cellStatus(key: TemplateKey, kind: ItemKind | '', variantProject: boolean): CellStatus {
  if (key === 'item') return 'key';
  if (key === 'kind') return 'kind';
  if (!kind) return 'optional';
  if (key === 'variant') return kind === 'FG' && variantProject ? 'required' : kind === 'FG' ? 'optional' : 'notNeeded';
  if (key === 'componentCoverage') return kind === 'PG' ? 'optional' : 'notNeeded';
  if (key === 'type' || key === 'safetyStock' || key === 'safetyTime') return 'optional';
  return KIND_FIELDS[kind].includes(key as CheckedField) ? 'required' : 'notNeeded';
}

const COLORS = {
  header: '#1D5C9E',
  filled: '#E2EFDA',
  missing: '#FFE699',
  notNeeded: '#EDEDED',
  kindMissing: '#F8CBAD',
  muted: '#8A8A8A',
};

export interface TemplateTexts {
  sheetMapping: string;
  sheetGuide: string;
  title: string;
  legend: { filled: string; missing: string; optional: string; notNeeded: string; kindMissing: string };
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
    type: m?.type ?? '',
    safetyStock: m?.safetyStock ?? null,
    safetyTime: m?.safetyTime ?? null,
  };
}

/**
 * Šablona mapování: řádky = všechny díly mapování a pak `extra` (díly, které v mapování chybí). Buňky obarvené podle
 * druhu dílu v době stažení (zeleně povinné vyplněné, žlutě povinné prázdné, šedě nepotřebné, červeně chybí druh).
 */
export function mappingTemplate(master: MasterData | undefined, extra: readonly TemplatePart[], texts: TemplateTexts): ReportSheet[] {
  const items = [...(master?.items.values() ?? [])];
  const variantProjects = new Set(items.filter((m) => m.project && m.variant).map((m) => m.project));
  const known = new Set(items.map((m) => m.item.toUpperCase()));
  const rows = [
    ...items.map((m) => valuesOf(m, { item: m.item, customerNumber: '', description: '' })),
    ...extra.filter((p) => !p.item || !known.has(p.item.toUpperCase())).map((p) => valuesOf(undefined, { ...p, customerNumber: p.customerNumber ? customerDisplay(p.customerNumber) : '' })),
  ];

  const header: ReportCell[] = TEMPLATE_COLUMNS.map((c) => ({ value: c.header, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: COLORS.header, alignVertical: 'center', wrap: true, height: 30 }));
  const data = rows.map((r) =>
    TEMPLATE_COLUMNS.map((c): ReportCell => {
      const value = r[c.key];
      const empty = value === null || value === '';
      const status = cellStatus(c.key, (r.kind as ItemKind | '') || '', variantProjects.has(String(r.project)));
      const cell: ReportCell = empty ? {} : typeof value === 'number' ? { value, type: Number } : { value: String(value) };
      if (status === 'key') return { ...cell, fontWeight: 'bold' };
      if (status === 'kind') return { ...cell, fontWeight: 'bold', align: 'center', ...(empty ? { backgroundColor: COLORS.kindMissing } : {}) };
      if (status === 'required') return { ...cell, backgroundColor: empty ? COLORS.missing : COLORS.filled };
      if (status === 'notNeeded') return { ...cell, backgroundColor: COLORS.notNeeded, textColor: COLORS.muted };
      return cell;
    }),
  );
  const mapping: ReportSheet = {
    name: texts.sheetMapping,
    data: [header, ...data],
    columns: TEMPLATE_COLUMNS.map((c) => ({ width: c.width })),
    stickyRows: 1,
    stickyColumns: 1,
    gridLines: true,
  };

  // Návod: legenda barev a tabulka sloupec × druh.
  // Text přes celou šířku návodu (nadpis, poznámky).
  const wide = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: 5 }, null, null, null, null];
  const swatch = (color: string | undefined, text: string): (ReportCell | null)[] => [{ value: '', ...(color ? { backgroundColor: color } : {}) }, { value: text, columnSpan: 4 }, null, null, null];
  const guideColumns = TEMPLATE_COLUMNS.filter((c) => !['item', 'type', 'safetyStock', 'safetyTime'].includes(c.key));
  const statusText = (key: TemplateKey, kind: ItemKind): ReportCell => {
    if (key === 'kind') return { value: kind, fontWeight: 'bold', align: 'center' };
    if (key === 'variant' && kind === 'FG') return { value: texts.variantRequired, backgroundColor: COLORS.filled, align: 'center', wrap: true };
    const s = cellStatus(key, kind, false);
    if (s === 'required') return { value: texts.required, backgroundColor: COLORS.filled, align: 'center' };
    if (s === 'notNeeded') return { value: texts.notNeeded, backgroundColor: COLORS.notNeeded, textColor: COLORS.muted, align: 'center' };
    return { value: texts.optional, align: 'center' };
  };
  const th = (value: string): ReportCell => ({ value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: COLORS.header, wrap: true, alignVertical: 'center', height: 30 });
  const guide: ReportSheet = {
    name: texts.sheetGuide,
    data: [
      wide({ value: texts.title, fontWeight: 'bold', fontSize: 14, height: 24 }),
      [],
      swatch(COLORS.filled, texts.legend.filled),
      swatch(COLORS.missing, texts.legend.missing),
      swatch(undefined, texts.legend.optional),
      swatch(COLORS.notNeeded, texts.legend.notNeeded),
      swatch(COLORS.kindMissing, texts.legend.kindMissing),
      [],
      [th(texts.column), ...ITEM_KINDS.map((k) => th(`${k} – ${texts.kinds[k]}`)), th(texts.note)],
      ...guideColumns.map((c) => [{ value: c.header, fontWeight: 'bold' as const }, ...ITEM_KINDS.map((k) => statusText(c.key, k)), { value: texts.columnNotes[c.key] ?? '', wrap: true }]),
      [],
      ...texts.footnotes.map((f) => wide({ value: f })),
    ],
    columns: [{ width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 60 }],
    stickyRows: 0,
    stickyColumns: 0,
  };
  return [mapping, guide];
}
