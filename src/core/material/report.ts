// Export Sekvence jako formátovaný sešit (stejný vzhled jako Coverage): list Coverage se stavem skladu MC a MF na konci
// dne a list Potřeba po dnech s kusy sečtenými po dnech; díly v pořadí priority (nejdřív ty, které chybí nejdřív).

import type { ReportCell, ReportSheet } from '../calloffs/summaryReport';
import { BOUNDARY_EDGE, headerRows, isWeekend, QTY, REPORT_COLORS as C, titleRows, valueCell } from '../coverage/report';
import type { DayNumber } from '../dates';
import type { PartCoverage } from './coverage';
import { PART_KINDS, type PartKind } from './partKey';

export interface SequenceReportTexts {
  title: string;
  subtitle: string;
  filters: string;
  note: string;
  /** Zkratky dnů v týdnu od pondělí. */
  weekdays: readonly string[];
  kinds: Record<PartKind, string>;
  item: string;
  description: string;
  stock: string;
  total: string;
  overdue: string;
  shortFrom: string;
  sum: string;
  sheetCoverage: string;
  sheetDemand: string;
}

/**
 * Sešit Sekvence. `parts` v pořadí priority (druh, pak díly, které chybí nejdřív); `shortText` = text „chybí od“
 * (čas stavby, vůz a dveře) nebo prázdný; `boundary` = den hranice pokrytí 2 dny (dnes + 1), sloupec se orámuje zeleně.
 */
export function sequenceReport(
  parts: readonly PartCoverage[],
  days: readonly DayNumber[],
  texts: SequenceReportTexts,
  { boundary = null, shortText }: { boundary?: DayNumber | null; shortText: (p: PartCoverage) => string },
): ReportSheet[] {
  const edge = (d: DayNumber): ReportCell => (d === boundary ? BOUNDARY_EDGE : {});
  const anyOverdue = parts.some((p) => p.overdue > 0);
  const labels = [texts.item, texts.description, texts.stock, texts.total, ...(anyOverdue ? [texts.overdue] : []), texts.shortFrom];
  const width = labels.length + days.length;
  const qty = (value: number | null): ReportCell => (value === null ? { value: '' } : { value, type: Number, format: QTY });
  const span = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: width }, ...Array.from({ length: width - 1 }, () => null)];
  const groupRow = (kind: PartKind) => span({ value: texts.kinds[kind], fontWeight: 'bold', textColor: C.ink, backgroundColor: C.subHeader });
  const lead = (p: PartCoverage): (ReportCell | null)[] => [
    { value: p.item, fontWeight: 'bold' },
    { value: p.description },
    qty(p.stock ?? 0),
    qty(p.total),
  ];
  const short = (p: PartCoverage): ReportCell => ({ value: shortText(p), textColor: p.firstShort ? C.down : C.muted });
  const note = span({ value: texts.note, textColor: C.muted, fontStyle: 'italic', wrap: true, height: 30, alignVertical: 'top' });
  const columns = [{ width: 18 }, { width: 34 }, { width: 9 }, { width: 9 }, ...(anyOverdue ? [{ width: 10 }] : []), { width: 30 }, ...days.map(() => ({ width: 8 }))];
  const groups = PART_KINDS.map((kind) => ({ kind, list: parts.filter((p) => p.kind === kind) })).filter((g) => g.list.length > 0);

  // Coverage: stav skladu na konci dne (sklad − potřeba včetně dřívější); po termínu = sklad po potřebě před dneškem.
  const coverageRows = groups.flatMap(({ kind, list }) => [
    groupRow(kind),
    ...list.map((p): (ReportCell | null)[] => [
      ...lead(p),
      ...(anyOverdue ? [p.overdue ? valueCell((p.stock ?? 0) - p.overdue, days[0]!) : { value: '' }] : []),
      short(p),
      ...p.balance.map((v, k) => valueCell(v, days[k]!, edge(days[k]!))),
    ]),
  ]);

  // Potřeba po dnech: kusy dílu sečtené po dnech; červeně dny, kdy sklad na potřebu nestačí; součet za druh.
  const demandCell = (q: number, balance: number, d: DayNumber): ReportCell => {
    const style: ReportCell = { ...(isWeekend(d) ? { backgroundColor: C.weekend } : {}), ...edge(d) };
    if (q === 0) return { value: '', ...style };
    return balance < 0 ? { value: q, type: Number, format: QTY, ...style, textColor: C.down, backgroundColor: C.negative, fontWeight: 'bold' } : { value: q, type: Number, format: QTY, ...style };
  };
  const top: ReportCell = { topBorderColor: C.header, topBorderStyle: 'thin' };
  const sumRow = (kind: PartKind, list: readonly PartCoverage[]): (ReportCell | null)[] => [
    { value: `${texts.sum} ${texts.kinds[kind]}`, fontWeight: 'bold', ...top },
    { value: '', ...top },
    { value: '', ...top },
    { ...qty(list.reduce((s, p) => s + p.total, 0)), fontWeight: 'bold', ...top },
    ...(anyOverdue ? [{ ...qty(list.reduce((s, p) => s + p.overdue, 0)), fontWeight: 'bold' as const, ...top }] : []),
    { value: '', ...top },
    ...days.map((d, k): ReportCell => ({ ...qty(list.reduce((s, p) => s + p.perDay[k]!, 0)), fontWeight: 'bold', ...top, ...edge(d) })),
  ];
  const demandRows = groups.flatMap(({ kind, list }) => [
    groupRow(kind),
    ...list.map((p): (ReportCell | null)[] => [
      ...lead(p),
      ...(anyOverdue ? [p.overdue ? { value: p.overdue, type: Number, format: QTY, ...((p.stock ?? 0) < p.overdue ? { textColor: C.down, fontWeight: 'bold' as const } : {}) } : { value: '' }] : []),
      short(p),
      ...p.perDay.map((q, k) => demandCell(q, p.balance[k]!, days[k]!)),
    ]),
    sumRow(kind, list),
  ]);

  const sheet = (name: string, rows: (ReportCell | null)[][]): ReportSheet => ({
    name,
    data: [...titleRows(texts, width), ...headerRows(labels, days, boundary, texts), ...rows, [], note],
    columns,
    stickyRows: 6,
    stickyColumns: 2,
    gridLines: true,
  });
  return [sheet(texts.sheetCoverage, coverageRows), sheet(texts.sheetDemand, demandRows)];
}
