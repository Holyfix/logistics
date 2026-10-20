// Report „Přehled po projektech“ do Excelu pro vedení: titulek, barevné záhlaví, strom projekt → kategorie → strana → varianta,
// čísla s oddělovači, změna proti předchozímu exportu v kusech a v %, součet a list s díly.

import { dayToIso } from '../dates';
import type { MasterItem } from '../masterdata';
import { ITEM_FIELDS, type ItemField } from './filter';
import { shiftsOf, type PerShift, type SummaryNode } from './summary';
import type { CurrentRow, Period } from './views';

/** Buňka sešitu (podmnožina vlastností knihovny write-excel-file). */
export interface ReportCell {
  value?: string | number;
  type?: StringConstructor | NumberConstructor;
  format?: string;
  fontWeight?: 'bold';
  fontStyle?: 'italic';
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right';
  alignVertical?: 'top' | 'center' | 'bottom';
  indent?: number;
  wrap?: boolean;
  height?: number;
  columnSpan?: number;
  topBorderColor?: string;
  topBorderStyle?: 'thin' | 'medium';
  bottomBorderColor?: string;
  bottomBorderStyle?: 'thin' | 'medium';
}

export interface ReportSheet {
  name: string;
  data: (ReportCell | null)[][];
  columns: { width: number }[];
  stickyRows: number;
  stickyColumns: number;
  /** Zobrazit mřížku (např. u šablony k vyplňování); výchozí bez mřížky. */
  gridLines?: boolean;
  /** Seskupení řádků v Excelu (tlačítka −/+ vlevo) po řádcích `data`; bez záznamu úroveň 0. */
  outline?: (RowOutline | undefined)[];
}

/** Úroveň řádku ve skupině Excelu; skrytý = sbalený pod rodičem, sbalený = řádek nad sbalenou skupinou. */
export interface RowOutline {
  level: number;
  hidden?: boolean;
  collapsed?: boolean;
}

export interface ReportTexts {
  title: string;
  subtitle: string;
  filters: string;
  note: string;
  tree: string;
  project: string;
  category: string;
  side: string;
  variant: string;
  item: string;
  description: string;
  total: string;
  diff: string;
  diffPercent: string;
  sum: string;
  /** Sloupec a řádky směn: „Jednotka“, „ks“, „sm.“, „Ks / směna“, „chybí“. */
  unit: string;
  pcs: string;
  shifts: string;
  perShift: string;
  missingOutput: string;
  /** Popisek uzlu bez údaje (bez projektu, bez kategorie …). */
  none: Record<ItemField, string>;
  sheetSummary: string;
  sheetItems: string;
}

const C = {
  ink: '#13202A',
  muted: '#6F7E8B',
  header: '#1D5C9E',
  headerText: '#FFFFFF',
  subHeader: '#DCE6F1',
  project: '#DCE6F1',
  category: '#F3F5F7',
  line: '#B7C3CF',
  up: '#006300',
  down: '#B42D2D',
};

/** Celá čísla s oddělovači tisíců, nula jako pomlčka. */
const QTY = '#,##0;-#,##0;"–"';
const DIFF = '+#,##0;-#,##0;0';
const PCT = '+0.0%;-0.0%;0.0%';
/** Směny na desetiny, nula jako pomlčka. */
const SHIFTS = '#,##0.0;-#,##0.0;"–"';

const num = (value: number, style: ReportCell = {}): ReportCell => ({ value, type: Number, format: QTY, ...style });
const diffCell = (value: number | null, style: ReportCell = {}): ReportCell | null =>
  value === null ? { value: '—', align: 'right', ...style } : { value, type: Number, format: DIFF, textColor: value > 0 ? C.up : value < 0 ? C.down : C.muted, ...style };
const pctCell = (diff: number | null, base: number | null, style: ReportCell = {}): ReportCell | null =>
  diff === null || !base ? { value: '—', align: 'right', ...style } : { value: diff / base, type: Number, format: PCT, textColor: diff > 0 ? C.up : diff < 0 ? C.down : C.muted, ...style };

/** Pondělí týdne jako „12.10.“ (druhý řádek záhlaví). */
const weekStart = (p: Period) => {
  const [, m, d] = dayToIso(p.start).split('-');
  return `${Number(d)}.${Number(m)}.`;
};

function titleRows(texts: ReportTexts, width: number): (ReportCell | null)[][] {
  const span = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: width }, ...Array.from({ length: width - 1 }, () => null)];
  return [
    span({ value: texts.title, fontWeight: 'bold', fontSize: 16, textColor: C.ink, height: 26, alignVertical: 'center' }),
    span({ value: texts.subtitle, textColor: C.muted }),
    span({ value: texts.filters, textColor: C.muted, fontStyle: 'italic' }),
    [],
  ];
}

function headerRows(labels: string[], periods: readonly Period[], firstWeek: number): (ReportCell | null)[][] {
  const head: ReportCell = { fontWeight: 'bold', textColor: C.headerText, backgroundColor: C.header, align: 'center', alignVertical: 'center', wrap: true, height: 30 };
  const sub: ReportCell = { fontSize: 9, textColor: C.ink, backgroundColor: C.subHeader, align: 'center', bottomBorderColor: C.header, bottomBorderStyle: 'medium' };
  return [
    // Textové sloupce (před prvním týdnem) vlevo, čísla na střed.
    labels.map((value, k) => ({ ...head, value, ...(k < firstWeek ? { align: 'left' as const } : {}) })),
    labels.map((_, k) => ({ ...sub, value: k >= firstWeek && k < firstWeek + periods.length ? weekStart(periods[k - firstWeek]!) : '' })),
  ];
}

export interface ReportOptions {
  /** Rozbalené uzly stromu jako v aplikaci; ostatní jsou v Excelu sbalené (řádky skryté pod −/+). */
  expanded: ReadonlySet<string>;
  /** Výkon za směnu dílu: pod každým řádkem kusů řádek směn (sm.); bez něj jen kusy. */
  perShift?: PerShift;
}

/**
 * Sešit pro vedení: list Přehled (celý strom projekt → kategorie → strana → varianta, seskupený v Excelu a sbalený jako
 * v aplikaci) a list Díly (díly seskupené pod projekt a kategorii). Se směnami má každý řádek kusů pod sebou řádek sm.
 * `rows` jsou řádky odvolávek po dílech, `periods` týdny.
 */
export function summaryReport(
  tree: readonly SummaryNode[],
  rows: readonly CurrentRow[],
  periods: readonly Period[],
  master: ReadonlyMap<string, MasterItem> | undefined,
  texts: ReportTexts,
  { expanded, perShift }: ReportOptions,
): ReportSheet[] {
  const label = (n: SummaryNode) => n.label || texts.none[n.field];
  const weeks = periods.map((p) => p.label);
  const withShifts = perShift !== undefined;
  const hasPrevious = tree.some((n) => n.diff !== null);
  const blue: ReportCell = { textColor: C.header };
  const shiftCell = (value: number | null, style: ReportCell): ReportCell =>
    value === null ? { value: '–', align: 'right', ...style, textColor: C.muted } : { value, type: Number, format: SHIFTS, ...style, ...blue };
  const unitCells = (unit: 'pcs' | 'shifts', style: ReportCell): ReportCell[] => (withShifts ? [{ value: texts[unit], ...style, ...(unit === 'shifts' ? blue : {}) }] : []);

  // List 1: strom (všechny uzly; sbalené jako v aplikaci).
  const summaryLabels = [texts.tree, ...(withShifts ? [texts.perShift, texts.unit] : []), ...weeks, texts.total, texts.diff, texts.diffPercent];
  const firstWeek = withShifts ? 3 : 1;
  const levelStyle: ReportCell[] = [
    { fontWeight: 'bold', backgroundColor: C.project, topBorderColor: C.line, topBorderStyle: 'thin' },
    { backgroundColor: C.category },
    {},
  ];
  const treeRows: (ReportCell | null)[][] = [];
  const treeOutline: RowOutline[] = [];
  const walk = (nodes: readonly SummaryNode[], hidden: boolean) =>
    nodes.forEach((n) => {
      const s = levelStyle[Math.min(n.level, 2)]!;
      const open = expanded.has(n.key);
      const collapsed = n.children.length > 0 && !open;
      const output: ReportCell[] = withShifts
        ? [n.perShift !== null ? num(n.perShift, s) : { value: n.shiftsMissing ? texts.missingOutput : '', align: 'right', ...s, textColor: C.muted, fontStyle: 'italic' }]
        : [];
      treeRows.push([
        // Odsazení se v Excelu projeví jen u buňky zarovnané vlevo.
        { value: label(n), align: 'left' as const, indent: n.level * 2, ...s, ...(n.label ? {} : { textColor: C.muted, fontStyle: 'italic' as const }) },
        ...output,
        ...unitCells('pcs', s),
        ...n.values.map((v) => num(v, s)),
        num(n.total, { ...s, fontWeight: 'bold' }),
        diffCell(n.diff, s),
        pctCell(n.diff, n.previousTotal, s),
      ]);
      treeOutline.push({ level: n.level, hidden, collapsed: collapsed && !withShifts });
      if (withShifts) {
        const total = n.shifts ? n.shifts.reduce((a, b) => a + b, 0) : null;
        treeRows.push([
          { value: '', ...s },
          { value: '', ...s },
          ...unitCells('shifts', s),
          ...periods.map((_, k) => shiftCell(n.shifts ? n.shifts[k]! : null, s)),
          shiftCell(total, { ...s, fontWeight: 'bold' }),
          { value: '', ...s },
          { value: '', ...s },
        ]);
        treeOutline.push({ level: n.level, hidden, collapsed });
      }
      walk(n.children, hidden || !open);
    });
  walk(tree, false);
  const sum = (pick: (n: SummaryNode) => number) => tree.reduce((a, n) => a + pick(n), 0);
  const totalStyle: ReportCell = { fontWeight: 'bold', backgroundColor: C.subHeader, topBorderColor: C.header, topBorderStyle: 'medium' };
  const totalDiff = hasPrevious ? sum((n) => n.diff ?? 0) : null;
  const totalRows: (ReportCell | null)[][] = [
    [
      { value: texts.sum, ...totalStyle },
      ...(withShifts ? [{ value: '', ...totalStyle }] : []),
      ...unitCells('pcs', totalStyle),
      ...periods.map((_, k) => num(sum((n) => n.values[k]!), totalStyle)),
      num(sum((n) => n.total), totalStyle),
      diffCell(totalDiff, totalStyle),
      pctCell(totalDiff, hasPrevious ? sum((n) => n.previousTotal ?? 0) : null, totalStyle),
    ],
  ];
  if (withShifts) {
    // Součet směn dílů s výkonem; díly bez výkonu označí „chybí“ ve sloupci Ks / směna.
    const any = tree.some((n) => n.shifts !== null);
    const weekShifts = periods.map((_, k) => (any ? sum((n) => n.shifts?.[k] ?? 0) : null));
    const missing = tree.some((n) => n.shiftsMissing > 0);
    totalRows[0]![1] = { value: missing ? texts.missingOutput : '', align: 'right', ...totalStyle, textColor: C.muted, fontStyle: 'italic' };
    totalRows.push([
      { value: '', ...totalStyle },
      { value: '', ...totalStyle },
      ...unitCells('shifts', totalStyle),
      ...weekShifts.map((v) => shiftCell(v, totalStyle)),
      shiftCell(any ? weekShifts.reduce((a, b) => a! + b!, 0) : null, totalStyle),
      { value: '', ...totalStyle },
      { value: '', ...totalStyle },
    ]);
  }
  const width = summaryLabels.length;
  const head = [...titleRows(texts, width), ...headerRows(summaryLabels, periods, firstWeek)];
  const summarySheet: ReportSheet = {
    name: texts.sheetSummary,
    data: [
      ...head,
      ...treeRows,
      ...totalRows,
      [],
      [{ value: texts.note, textColor: C.muted, fontStyle: 'italic', columnSpan: width, wrap: true, height: 30, alignVertical: 'top' }, ...Array.from({ length: width - 1 }, () => null)],
    ],
    columns: [{ width: 34 }, ...(withShifts ? [{ width: 11 }, { width: 9 }] : []), ...weeks.map(() => ({ width: 9 })), { width: 11 }, { width: 11 }, { width: 9 }],
    stickyRows: 6,
    stickyColumns: 1,
    outline: [...head.map(() => undefined), ...treeOutline],
  };

  // List 2: díly seskupené pod projekt a kategorii.
  const value = (item: string, key: ItemField) => master?.get(item)?.[key] ?? '';
  // Stejné pořadí jako ve stromu: prázdné hodnoty na konec, ostatní abecedně.
  const by = (key: ItemField) => (a: CurrentRow, b: CurrentRow) => {
    const x = value(a.item, key);
    const y = value(b.item, key);
    return Number(!x) - Number(!y) || x.localeCompare(y, 'cs', { numeric: true });
  };
  const sorted = [...rows].sort((a, b) => ITEM_FIELDS.reduce((d, key) => d || by(key)(a, b), 0) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  // Projekt a kategorie bez údaje s popiskem, strana a varianta prázdné (díl je nemá).
  const shown = (item: string, key: ItemField) => value(item, key) || (key === 'project' || key === 'category' ? texts.none[key] : '');
  const itemLabels = [texts.project, texts.category, texts.side, texts.variant, texts.item, texts.description, ...(withShifts ? [texts.unit] : []), ...weeks, texts.total, texts.diff, texts.diffPercent];
  const changeOf = (list: readonly CurrentRow[]) => {
    let diff = 0;
    let base = 0;
    for (const r of list)
      r.values.forEach((v, k) => {
        const p = r.previous[k];
        if (p === null || p === undefined) return;
        diff += v - p;
        base += p;
      });
    return { diff: hasPrevious ? diff : null, base };
  };
  const itemRows: (ReportCell | null)[][] = [];
  const itemOutline: RowOutline[] = [];
  // Řádek skupiny (projekt / kategorie) se součty, se směnami i řádek sm.
  const groupRows = (list: readonly CurrentRow[], level: 0 | 1, name: string, style: ReportCell) => {
    const values = periods.map((_, k) => list.reduce((a, r) => a + r.values[k]!, 0));
    const total = values.reduce((a, b) => a + b, 0);
    const { diff, base } = changeOf(list);
    const lead = level === 0 ? [{ value: name, ...style }, { value: '', ...style }] : [{ value: '', ...style }, { value: name, ...style }];
    const blank = Array.from({ length: 4 }, () => ({ value: '', ...style }));
    itemRows.push([...lead, ...blank, ...unitCells('pcs', style), ...values.map((v) => num(v, style)), num(total, { ...style, fontWeight: 'bold' }), diffCell(diff, style), pctCell(diff, base, style)]);
    itemOutline.push({ level });
    if (!withShifts) return;
    const shifts = shiftsOf(list, perShift, periods.length)?.values ?? null;
    itemRows.push([
      ...Array.from({ length: 6 }, () => ({ value: '', ...style })),
      ...unitCells('shifts', style),
      ...periods.map((_, k) => shiftCell(shifts ? shifts[k]! : null, style)),
      shiftCell(shifts ? shifts.reduce((a, b) => a + b, 0) : null, { ...style, fontWeight: 'bold' }),
      { value: '', ...style },
      { value: '', ...style },
    ]);
    itemOutline.push({ level });
  };
  const groupsOf = (list: readonly CurrentRow[], key: ItemField) => {
    const groups = new Map<string, CurrentRow[]>();
    for (const r of list) groups.set(shown(r.item, key), [...(groups.get(shown(r.item, key)) ?? []), r]);
    return [...groups];
  };
  let stripe = 0;
  for (const [project, projectRows] of groupsOf(sorted, 'project')) {
    groupRows(projectRows, 0, project, levelStyle[0]!);
    for (const [category, categoryRows] of groupsOf(projectRows, 'category')) {
      groupRows(categoryRows, 1, category, { fontWeight: 'bold', backgroundColor: C.category });
      for (const r of categoryRows) {
        const s: ReportCell = stripe++ % 2 ? { backgroundColor: C.category } : {};
        const { diff, base } = changeOf([r]);
        itemRows.push([
          ...ITEM_FIELDS.map((key) => ({ value: shown(r.item, key), ...s })),
          { value: r.item, fontWeight: 'bold' as const, ...s },
          { value: r.description, ...s },
          ...unitCells('pcs', s),
          ...r.values.map((v) => num(v, s)),
          num(r.total, { ...s, fontWeight: 'bold' }),
          diffCell(diff, s),
          pctCell(diff, base, s),
        ]);
        itemOutline.push({ level: 2 });
      }
    }
  }
  const itemWidth = itemLabels.length;
  const itemHead = [...titleRows(texts, itemWidth), ...headerRows(itemLabels, periods, withShifts ? 7 : 6)];
  const itemsSheet: ReportSheet = {
    name: texts.sheetItems,
    data: [...itemHead, ...itemRows],
    columns: [
      { width: 12 },
      { width: 12 },
      { width: 9 },
      { width: 16 },
      { width: 18 },
      { width: 42 },
      ...(withShifts ? [{ width: 9 }] : []),
      ...weeks.map(() => ({ width: 9 })),
      { width: 11 },
      { width: 11 },
      { width: 9 },
    ],
    stickyRows: 6,
    stickyColumns: 5,
    outline: [...itemHead.map(() => undefined), ...itemOutline],
  };
  return [summarySheet, itemsSheet];
}
