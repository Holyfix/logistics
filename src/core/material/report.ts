// Export Sekvence jako formátovaný sešit (stejný vzhled jako Coverage): list Matrix s pokrytím dveřních panelů jako
// v aplikaci (stav dveří v barvách matice, stav MC a MF), list Coverage se stavem skladu MC a MF na konci dne a list
// Potřeba po dnech s kusy sečtenými po dnech; díly v pořadí priority (nejdřív ty, které chybí nejdřív).

import type { ReportCell, ReportSheet } from '../calloffs/summaryReport';
import { BOUNDARY_EDGE, headerRows, isWeekend, QTY, REPORT_COLORS as C, titleRows, valueCell } from '../coverage/report';
import type { DayNumber } from '../dates';
import type { CarCoverage, DoorCoverage, PartCoverage } from './coverage';
import { DOORS } from './doors';
import { statusCode } from './matrix';
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
  sheetMatrix: string;
  lot: string;
  productionNumber: string;
  optionType: string;
  colors: string;
  planned: string;
  status: string;
  material: string;
  matrixNote: string;
}

/** Barvy stavů jako v Order Status Matrix (podle čísla stavu) a štítky MC/MF jako v aplikaci. */
const STATUS_FILL: Record<number, string> = { 20: '#FFA500', 25: '#F0E68C', 30: '#FFFF00', 40: '#ADD8E6', 45: '#40E0D0', 50: '#90EE90', 60: '#32CD32' };
const BADGE_FILL = { ok: '#2E8B3E', short: '#C62828', unknown: '#9AA5B1' } as const;
const MATRIX_HEADER = '#4C68A2';

/** Text řádku vozu: plánovaná stavba a sloupec Materiál (chybějící díly, „chybí v klíči“, nebo vše na skladě). */
export interface CarTexts {
  planned: string;
  material: string;
  tone: 'short' | 'ok' | 'undetermined' | 'none';
}

/** Stav dílu daného druhu u dveří: na skladě, chybí, chybí v klíči, nebo bez štítku (hotové, výklopné). */
function badge(cell: DoorCoverage, kind: PartKind): keyof typeof BADGE_FILL | null {
  if (cell.state === 'none' || cell.state === 'skipped') return null;
  const parts = cell.parts.filter((p) => p.kind === kind);
  if (parts.length) return parts.some((p) => p.left < -1e-9) ? 'short' : 'ok';
  return cell.unknown.includes(kind) ? 'unknown' : null;
}

/** List Matrix: vozy jako v aplikaci; u dveří stav v barvě matice a vedle štítky MC a MF. */
function matrixSheet(cars: readonly CarCoverage[], texts: SequenceReportTexts, carTexts: (car: CarCoverage) => CarTexts): ReportSheet {
  const labels = [texts.lot, texts.productionNumber, texts.optionType, texts.colors, texts.planned];
  const width = labels.length + DOORS.length * 3 + 1;
  const head: ReportCell = { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: MATRIX_HEADER, alignVertical: 'center', wrap: true, height: 30 };
  const header: (ReportCell | null)[] = [
    ...labels.map((value) => ({ ...head, value })),
    ...DOORS.flatMap((d): ReportCell[] => [
      { ...head, value: `${texts.status} ${d}` },
      { ...head, value: 'MC', align: 'center' },
      { ...head, value: 'MF', align: 'center' },
    ]),
    { ...head, value: texts.material },
  ];
  const rows = cars.map((car): (ReportCell | null)[] => {
    const ct = carTexts(car);
    return [
      { value: car.lot },
      { value: car.productionNumber, fontWeight: 'bold', ...(car.short ? { textColor: C.down } : {}) },
      { value: car.optionType },
      { value: car.colors },
      { value: ct.planned },
      ...DOORS.flatMap((d): ReportCell[] => {
        const cell = car.doors[d];
        if (!cell) return [{ value: '' }, { value: '' }, { value: '' }];
        const fill = STATUS_FILL[statusCode(cell.status) ?? -1];
        const mark = (kind: PartKind): ReportCell => {
          const b = badge(cell, kind);
          return b ? { value: kind, align: 'center', fontWeight: 'bold', fontSize: 9, textColor: '#FFFFFF', backgroundColor: BADGE_FILL[b] } : { value: '' };
        };
        return [{ value: cell.status, textColor: '#4D4D4D', ...(fill ? { backgroundColor: fill } : {}) }, mark('MC'), mark('MF')];
      }),
      {
        value: ct.material,
        ...(ct.tone === 'short' ? { textColor: C.down, fontWeight: 'bold' as const } : ct.tone === 'ok' ? { textColor: C.boundary } : ct.tone === 'undetermined' ? { textColor: C.muted, fontStyle: 'italic' as const } : {}),
      },
    ];
  });
  const span = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: width }, ...Array.from({ length: width - 1 }, () => null)];
  return {
    name: texts.sheetMatrix,
    data: [...titleRows(texts, width), header, ...rows, [], span({ value: texts.matrixNote, textColor: C.muted, fontStyle: 'italic', wrap: true, height: 30, alignVertical: 'top' })],
    columns: [{ width: 8 }, { width: 16 }, { width: 10 }, { width: 14 }, { width: 16 }, ...DOORS.flatMap(() => [{ width: 22 }, { width: 5 }, { width: 5 }]), { width: 40 }],
    stickyRows: 5,
    stickyColumns: 2,
    gridLines: true,
  };
}

/**
 * Sešit Sekvence. `cars` = vozy pro list Matrix (jak je ukazuje aplikace, s filtry), `carTexts` = plánovaná stavba
 * a sloupec Materiál; `parts` v pořadí priority (druh, pak díly, které chybí nejdřív); `shortText` = text „chybí od“
 * (čas stavby, vůz a dveře) nebo prázdný; `boundary` = den hranice pokrytí 2 dny (dnes + 1), sloupec se orámuje zeleně.
 */
export function sequenceReport(
  parts: readonly PartCoverage[],
  days: readonly DayNumber[],
  texts: SequenceReportTexts,
  {
    boundary = null,
    shortText,
    cars = [],
    carTexts = (car) => ({ planned: '', material: '', tone: car.short ? 'short' : 'none' }),
  }: { boundary?: DayNumber | null; shortText: (p: PartCoverage) => string; cars?: readonly CarCoverage[]; carTexts?: (car: CarCoverage) => CarTexts },
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
  return [matrixSheet(cars, texts, carTexts), sheet(texts.sheetCoverage, coverageRows), sheet(texts.sheetDemand, demandRows)];
}
