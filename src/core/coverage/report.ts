// Coverage do Excelu jako formátovaný sešit: titulek, barevné záhlaví se dny, záporné pokrytí červeně, víkendy šedě,
// ukotvené záhlaví a díl; list se souhrnem po stranách.

import type { ReportCell, ReportSheet } from '../calloffs/summaryReport';
import { dayToIso, weekday, type DayNumber } from '../dates';
import type { CoverageLine } from './compute';

export interface CoverageReportTexts {
  title: string;
  subtitle: string;
  filters: string;
  note: string;
  /** Zkratky dnů v týdnu od pondělí. */
  weekdays: readonly string[];
  item: string;
  customerNumber: string;
  description: string;
  location: string;
  project: string;
  category: string;
  side: string;
  variant: string;
  customerStock: string;
  transit: string;
  ourStock: string;
  firstUncovered: string;
  sheetLines: string;
  sheetSides: string;
  sideNone: string;
}

/** Barvy formátovaných sešitů (Coverage, Sekvence). */
export const REPORT_COLORS = {
  ink: '#13202A',
  boundary: '#2E8B3E',
  boundarySub: '#DDF0DF',
  muted: '#6F7E8B',
  header: '#1D5C9E',
  headerText: '#FFFFFF',
  subHeader: '#DCE6F1',
  weekendHead: '#4F7BAA',
  weekendHeader: '#C9D6E4',
  weekend: '#ECEFF3',
  negative: '#FDECEC',
  down: '#B42D2D',
};

const C = REPORT_COLORS;

/** Celá čísla s oddělovači tisíců; nula zůstává nulou (pokrytí přesně na nulu). */
export const QTY = '#,##0;-#,##0;0';

/** Den „2.11.“ (druhý řádek záhlaví). */
const dayMonth = (d: DayNumber) => {
  const [, m, day] = dayToIso(d).split('-');
  return `${Number(day)}.${Number(m)}.`;
};

export const isWeekend = (d: DayNumber) => weekday(d) >= 6;

/** Titulek, podtitulek a filtry přes celou šířku listu a prázdný řádek. */
export function titleRows(texts: { title: string; subtitle: string; filters: string }, width: number): (ReportCell | null)[][] {
  const span = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: width }, ...Array.from({ length: width - 1 }, () => null)];
  return [
    span({ value: texts.title, fontWeight: 'bold', fontSize: 16, textColor: C.ink, height: 26, alignVertical: 'center' }),
    span({ value: texts.subtitle, textColor: C.muted }),
    span({ value: texts.filters, textColor: C.muted, fontStyle: 'italic' }),
    [],
  ];
}

/** Okraje sloupce hranice pokrytí 2 dny (dnes + 1): zeleně zleva i zprava. */
export const BOUNDARY_EDGE: ReportCell = { leftBorderColor: C.boundary, leftBorderStyle: 'medium', rightBorderColor: C.boundary, rightBorderStyle: 'medium' };

/** Záhlaví: popisky sloupců, u dnů zkratka dne a pod ní datum; víkend v jiném odstínu, hranice 2 dny zeleně. */
export function headerRows(labels: string[], days: readonly DayNumber[], boundary: DayNumber | null, texts: { weekdays: readonly string[] }): (ReportCell | null)[][] {
  const head: ReportCell = { fontWeight: 'bold', textColor: C.headerText, backgroundColor: C.header, align: 'center', alignVertical: 'center', wrap: true, height: 30 };
  const sub: ReportCell = { fontSize: 9, textColor: C.ink, backgroundColor: C.subHeader, align: 'center', bottomBorderColor: C.header, bottomBorderStyle: 'medium' };
  return [
    [
      ...labels.map((value) => ({ ...head, value, align: 'left' as const })),
      ...days.map((d) => ({
        ...head,
        value: texts.weekdays[weekday(d) - 1] ?? '',
        ...(isWeekend(d) ? { backgroundColor: C.weekendHead } : {}),
        ...(d === boundary ? { ...BOUNDARY_EDGE, backgroundColor: C.boundary } : {}),
      })),
    ],
    [
      ...labels.map(() => ({ ...sub, value: '' })),
      ...days.map((d) => ({
        ...sub,
        value: dayMonth(d),
        ...(isWeekend(d) ? { backgroundColor: C.weekendHeader } : {}),
        ...(d === boundary ? { ...BOUNDARY_EDGE, backgroundColor: C.boundarySub, fontWeight: 'bold' as const } : {}),
      })),
    ],
  ];
}

/** Buňka pokrytí: záporné červeně na světle červeném podkladu, víkend šedě, mimo horizont souboru prázdná. */
export function valueCell(v: number | null, d: DayNumber, style: ReportCell = {}): ReportCell {
  const weekend: ReportCell = isWeekend(d) ? { backgroundColor: C.weekend } : {};
  if (v === null) return { value: '', ...weekend, ...style };
  if (v < 0) return { value: v, type: Number, format: QTY, ...weekend, ...style, textColor: C.down, backgroundColor: C.negative, fontWeight: 'bold' };
  return { value: v, type: Number, format: QTY, ...weekend, ...style };
}

/**
 * Sešit Coverage: list s díly (jako tabulka Pokrytí po dílech, s filtry z aplikace) a list se souhrnem po stranách.
 * `ourStock` = sloupec Náš sklad (jen když je sklad načtený); `boundary` = den hranice pokrytí 2 dny (dnes + 1), sloupec
 * se orámuje zeleně, aby bylo vidět, které díly nejsou pokryté na 2 dny.
 */
export function coverageReport(
  lines: readonly CoverageLine[],
  sides: readonly { side: string; values: (number | null)[] }[],
  days: readonly DayNumber[],
  texts: CoverageReportTexts,
  { ourStock, boundary = null }: { ourStock: boolean; boundary?: DayNumber | null },
): ReportSheet[] {
  const edge = (d: DayNumber): ReportCell => (d === boundary ? BOUNDARY_EDGE : {});
  const labels = [
    texts.item,
    texts.customerNumber,
    texts.description,
    texts.location,
    texts.project,
    texts.category,
    texts.side,
    texts.variant,
    texts.customerStock,
    texts.transit,
    ...(ourStock ? [texts.ourStock] : []),
    texts.firstUncovered,
  ];
  const width = labels.length + days.length;
  const qty = (value: number | null): ReportCell => (value === null ? { value: '' } : { value, type: Number, format: QTY });
  const rows = lines.map((l): (ReportCell | null)[] => [
    { value: l.item || l.fileCustomerNumber, fontWeight: 'bold', ...(l.item ? {} : { textColor: C.muted }) },
    { value: l.customerNumber },
    { value: l.description },
    { value: l.location },
    { value: l.project },
    { value: l.category },
    { value: l.side },
    { value: l.variant },
    qty(l.customerStock),
    qty(l.transit),
    ...(ourStock ? [qty(l.ourStock)] : []),
    { value: [l.uncoveredAt.replace('T', ' '), l.firstUncovered].filter(Boolean).join(' · '), textColor: C.muted },
    ...l.values.map((v, k) => valueCell(v, days[k]!, edge(days[k]!))),
  ]);
  const note: (ReportCell | null)[] = [{ value: texts.note, textColor: C.muted, fontStyle: 'italic', columnSpan: width, wrap: true, height: 30, alignVertical: 'top' }, ...Array.from({ length: width - 1 }, () => null)];
  const linesSheet: ReportSheet = {
    name: texts.sheetLines,
    data: [...titleRows(texts, width), ...headerRows(labels, days, boundary, texts), ...rows, [], note],
    columns: [
      { width: 14 },
      { width: 20 },
      { width: 34 },
      { width: 12 },
      { width: 11 },
      { width: 10 },
      { width: 8 },
      { width: 12 },
      { width: 10 },
      { width: 9 },
      ...(ourStock ? [{ width: 9 }] : []),
      { width: 16 },
      ...days.map(() => ({ width: 8 })),
    ],
    stickyRows: 6,
    stickyColumns: 3,
    gridLines: true,
  };

  const sideLabels = [texts.side];
  const sideWidth = sideLabels.length + days.length;
  const sidesSheet: ReportSheet = {
    name: texts.sheetSides,
    data: [
      ...titleRows(texts, sideWidth),
      ...headerRows(sideLabels, days, boundary, texts),
      ...sides.map((s): (ReportCell | null)[] => [
        { value: s.side || texts.sideNone, fontWeight: 'bold', ...(s.side ? {} : { textColor: C.muted, fontStyle: 'italic' }) },
        ...s.values.map((v, k) => valueCell(v, days[k]!, edge(days[k]!))),
      ]),
    ],
    columns: [{ width: 16 }, ...days.map(() => ({ width: 8 }))],
    stickyRows: 6,
    stickyColumns: 1,
    gridLines: true,
  };
  return [linesSheet, sidesSheet];
}
