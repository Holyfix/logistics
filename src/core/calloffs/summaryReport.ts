// Report „Přehled po projektech“ do Excelu pro vedení: titulek, barevné záhlaví, strom projekt → kategorie → strana,
// čísla s oddělovači, změna proti předchozímu exportu v kusech a v %, součet a list s díly.

import { dayToIso } from '../dates';
import type { MasterItem } from '../masterdata';
import type { SummaryNode } from './summary';
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
  /** Výběr hodnoty ze seznamu. */
  lists?: ReportList[];
}

/** Oblast buněk; řádky i sloupce od 1. */
export interface ReportRange {
  from: { row: number; column: number };
  to: { row: number; column: number };
}

/** Seznam povolených hodnot pro oblast buněk. */
export interface ReportList extends ReportRange {
  values: string[];
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
  item: string;
  description: string;
  backlog: string;
  total: string;
  diff: string;
  diffPercent: string;
  sum: string;
  none: [string, string, string];
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
    // Textové sloupce (před sloupcem Po termínu) vlevo, čísla na střed.
    labels.map((value, k) => ({ ...head, value, ...(k < firstWeek - 1 ? { align: 'left' as const } : {}) })),
    labels.map((_, k) => ({ ...sub, value: k >= firstWeek && k < firstWeek + periods.length ? weekStart(periods[k - firstWeek]!) : '' })),
  ];
}

/**
 * Sešit pro vedení: list Přehled (strom v pořadí `nodes`, jak je v aplikaci rozbalený) a list Díly (každý díl se
 * stejnými sloupci). `rows` jsou řádky odvolávek po dílech, `periods` týdny.
 */
export function summaryReport(
  nodes: readonly SummaryNode[],
  tree: readonly SummaryNode[],
  rows: readonly CurrentRow[],
  periods: readonly Period[],
  master: ReadonlyMap<string, MasterItem> | undefined,
  texts: ReportTexts,
): ReportSheet[] {
  const label = (n: SummaryNode) => n.label || texts.none[n.level];
  const weeks = periods.map((p) => p.label);

  // List 1: strom.
  const summaryLabels = [texts.tree, texts.backlog, ...weeks, texts.total, texts.diff, texts.diffPercent];
  const levelStyle: ReportCell[] = [
    { fontWeight: 'bold', backgroundColor: C.project, topBorderColor: C.line, topBorderStyle: 'thin' },
    { backgroundColor: C.category },
    {},
  ];
  const treeRows = nodes.map((n) => {
    const s = levelStyle[n.level]!;
    return [
      // Odsazení se v Excelu projeví jen u buňky zarovnané vlevo.
      { value: label(n), align: 'left' as const, indent: n.level * 2, ...s, ...(n.label ? {} : { textColor: C.muted, fontStyle: 'italic' as const }) },
      num(n.backlog, s),
      ...n.values.map((v) => num(v, s)),
      num(n.total, { ...s, fontWeight: 'bold' }),
      diffCell(n.diff, s),
      pctCell(n.diff, n.previousTotal, s),
    ];
  });
  const sum = (pick: (n: SummaryNode) => number) => tree.reduce((a, n) => a + pick(n), 0);
  const hasPrevious = tree.some((n) => n.diff !== null);
  const totalStyle: ReportCell = { fontWeight: 'bold', backgroundColor: C.subHeader, topBorderColor: C.header, topBorderStyle: 'medium' };
  const totalDiff = hasPrevious ? sum((n) => n.diff ?? 0) : null;
  const totalRow = [
    { value: texts.sum, ...totalStyle },
    num(sum((n) => n.backlog), totalStyle),
    ...periods.map((_, k) => num(sum((n) => n.values[k]!), totalStyle)),
    num(sum((n) => n.total), totalStyle),
    diffCell(totalDiff, totalStyle),
    pctCell(totalDiff, hasPrevious ? sum((n) => n.previousTotal ?? 0) : null, totalStyle),
  ];
  const width = summaryLabels.length;
  const summarySheet: ReportSheet = {
    name: texts.sheetSummary,
    data: [
      ...titleRows(texts, width),
      ...headerRows(summaryLabels, periods, 2),
      ...treeRows,
      totalRow,
      [],
      [{ value: texts.note, textColor: C.muted, fontStyle: 'italic', columnSpan: width, wrap: true, height: 30, alignVertical: 'top' }, ...Array.from({ length: width - 1 }, () => null)],
    ],
    columns: [{ width: 34 }, { width: 10 }, ...weeks.map(() => ({ width: 9 })), { width: 11 }, { width: 11 }, { width: 9 }],
    stickyRows: 6,
    stickyColumns: 1,
  };

  // List 2: díly.
  const field = (item: string, key: 'project' | 'category' | 'side', level: 0 | 1 | 2) => master?.get(item)?.[key] || texts.none[level];
  // Stejné pořadí jako ve stromu: prázdné hodnoty na konec, ostatní abecedně.
  const by = (key: 'project' | 'category' | 'side') => (a: CurrentRow, b: CurrentRow) => {
    const x = master?.get(a.item)?.[key] ?? '';
    const y = master?.get(b.item)?.[key] ?? '';
    return Number(!x) - Number(!y) || x.localeCompare(y, 'cs', { numeric: true });
  };
  const sorted = [...rows].sort((a, b) => by('project')(a, b) || by('category')(a, b) || by('side')(a, b) || a.item.localeCompare(b.item, 'en', { numeric: true }));
  const itemLabels = [texts.project, texts.category, texts.side, texts.item, texts.description, texts.backlog, ...weeks, texts.total, texts.diff, texts.diffPercent];
  const itemRows = sorted.map((r, i) => {
    const s: ReportCell = i % 2 ? { backgroundColor: C.category } : {};
    let diff = 0;
    let base = 0;
    r.values.forEach((v, k) => {
      const p = r.previous[k];
      if (p === null || p === undefined) return;
      diff += v - p;
      base += p;
    });
    return [
      { value: field(r.item, 'project', 0), ...s },
      { value: field(r.item, 'category', 1), ...s },
      { value: field(r.item, 'side', 2), ...s },
      { value: r.item, fontWeight: 'bold' as const, ...s },
      { value: r.description, ...s },
      num(r.backlog, s),
      ...r.values.map((v) => num(v, s)),
      num(r.total, { ...s, fontWeight: 'bold' }),
      diffCell(hasPrevious ? diff : null, s),
      pctCell(hasPrevious ? diff : null, base, s),
    ];
  });
  const itemWidth = itemLabels.length;
  const itemsSheet: ReportSheet = {
    name: texts.sheetItems,
    data: [...titleRows(texts, itemWidth), ...headerRows(itemLabels, periods, 6), ...itemRows],
    columns: [{ width: 12 }, { width: 12 }, { width: 9 }, { width: 18 }, { width: 42 }, { width: 10 }, ...weeks.map(() => ({ width: 9 })), { width: 11 }, { width: 11 }, { width: 9 }],
    stickyRows: 6,
    stickyColumns: 4,
  };
  return [summarySheet, itemsSheet];
}
