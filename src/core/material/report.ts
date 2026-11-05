// Export Sekvence jako formátovaný sešit (stejný vzhled jako Coverage): list Matrix s pokrytím dveřních panelů jako
// v aplikaci (stav dveří v barvách matice, stav MC a MF), list Coverage se stavem skladu MC a MF na konci dne a list
// Potřeba po dnech s kusy sečtenými po dnech; díly v pořadí priority (nejdřív ty, které chybí nejdřív); list PRIO
// Sorting pro kvalitu (nepokryté díly a chybějící kusy po dnech, které je potřeba vytřídit).

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
  sheetPrio: string;
  order: string;
  kind: string;
  sorting: string;
  missing: string;
  prioNote: string;
}

/** Barvy stavů jako v Order Status Matrix (podle čísla stavu) a štítky MC/MF jako v aplikaci. */
const STATUS_FILL: Record<number, string> = { 20: '#FFA500', 25: '#F0E68C', 30: '#FFFF00', 40: '#ADD8E6', 45: '#40E0D0', 50: '#90EE90', 60: '#32CD32' };
const BADGE_FILL = { ok: '#2E8B3E', short: '#C62828', unknown: '#9AA5B1', tpo: '#1D5C9E' } as const;
const MATRIX_HEADER = '#4C68A2';

/** Text řádku vozu: plánovaná stavba a sloupec Materiál (chybějící díly, „chybí v klíči“, nebo vše na skladě). */
export interface CarTexts {
  planned: string;
  material: string;
  tone: 'short' | 'ok' | 'undetermined' | 'none';
}

/** Stav dílu daného druhu u dveří: na skladě, chybí, chybí v klíči, nebo bez štítku (hotové, výklopné). */
function badge(cell: DoorCoverage, kind: PartKind): keyof typeof BADGE_FILL | null {
  if (cell.state === 'skipped') return null;
  if (kind === 'MC' && cell.tpo) return 'tpo';
  if (cell.state === 'none') return null;
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
          return b ? { value: b === 'tpo' ? 'TPO' : kind, align: 'center', fontWeight: 'bold', fontSize: 9, textColor: '#FFFFFF', backgroundColor: BADGE_FILL[b] } : { value: '' };
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
    sortingStock = () => null,
    cars = [],
    carTexts = (car) => ({ planned: '', material: '', tone: car.short ? 'short' : 'none' }),
  }: {
    boundary?: DayNumber | null;
    shortText: (p: PartCoverage) => string;
    /** Sklad dílu v lokacích před sortingem (vyřazené ze skladu) pro PRIO Sorting; null = neznámý. */
    sortingStock?: (p: PartCoverage) => number | null;
    cars?: readonly CarCoverage[];
    carTexts?: (car: CarCoverage) => CarTexts;
  },
): ReportSheet[] {
  const edge = (d: DayNumber): ReportCell => (d === boundary ? BOUNDARY_EDGE : {});
  const anyOverdue = parts.some((p) => p.overdue > 0);
  const labels = [texts.item, texts.description, texts.stock, texts.total, ...(anyOverdue ? [texts.overdue] : []), texts.shortFrom];
  const width = labels.length + days.length;
  const qty = (value: number | null): ReportCell => (value === null ? { value: '' } : { value, type: Number, format: QTY });
  const span = (cell: ReportCell): (ReportCell | null)[] => [{ ...cell, columnSpan: width }, ...Array.from({ length: width - 1 }, () => null)];
  // Řádek skupiny (Maincarrier / Middlefield): v Excelu jde skupinu sbalit a rozbalit (tlačítka −/+ vlevo).
  type Row = { cells: (ReportCell | null)[]; level: 0 | 1 };
  const groupLabel = (kind: PartKind, n: number) => `${texts.kinds[kind]} (${n})`;
  const group: ReportCell = { fontWeight: 'bold', textColor: C.ink, backgroundColor: C.subHeader };
  const groupRow = (kind: PartKind, n: number, w: number): Row => ({ cells: [{ ...group, value: groupLabel(kind, n), columnSpan: w }, ...Array.from({ length: w - 1 }, () => null)], level: 0 });
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
  const coverageRows = groups.flatMap(({ kind, list }): Row[] => [
    groupRow(kind, list.length, width),
    ...list.map((p): Row => ({
      cells: [
        ...lead(p),
        ...(anyOverdue ? [p.overdue ? valueCell((p.stock ?? 0) - p.overdue, days[0]!) : { value: '' }] : []),
        short(p),
        ...p.balance.map((v, k) => valueCell(v, days[k]!, edge(days[k]!))),
      ],
      level: 1,
    })),
  ]);

  // Potřeba po dnech: kusy dílu sečtené po dnech; červeně dny, kdy sklad na potřebu nestačí; součty za druh na řádku
  // skupiny (vidět i po sbalení).
  const demandCell = (q: number, balance: number, d: DayNumber): ReportCell => {
    const style: ReportCell = { ...(isWeekend(d) ? { backgroundColor: C.weekend } : {}), ...edge(d) };
    if (q === 0) return { value: '', ...style };
    return balance < 0 ? { value: q, type: Number, format: QTY, ...style, textColor: C.down, backgroundColor: C.negative, fontWeight: 'bold' } : { value: q, type: Number, format: QTY, ...style };
  };
  const demandGroupRow = (kind: PartKind, list: readonly PartCoverage[]): Row => ({
    cells: [
      { ...group, value: groupLabel(kind, list.length) },
      { ...group, value: '' },
      { ...group, value: '' },
      { ...group, ...qty(list.reduce((s, p) => s + p.total, 0)) },
      ...(anyOverdue ? [{ ...group, ...qty(list.reduce((s, p) => s + p.overdue, 0)) }] : []),
      { ...group, value: '' },
      ...days.map((d, k): ReportCell => ({ ...group, ...qty(list.reduce((s, p) => s + p.perDay[k]!, 0)), ...edge(d) })),
    ],
    level: 0,
  });
  const demandRows = groups.flatMap(({ kind, list }): Row[] => [
    demandGroupRow(kind, list),
    ...list.map((p): Row => ({
      cells: [
        ...lead(p),
        ...(anyOverdue ? [p.overdue ? { value: p.overdue, type: Number, format: QTY, ...((p.stock ?? 0) < p.overdue ? { textColor: C.down, fontWeight: 'bold' as const } : {}) } : { value: '' }] : []),
        short(p),
        ...p.perDay.map((q, k) => demandCell(q, p.balance[k]!, days[k]!)),
      ],
      level: 1,
    })),
  ]);

  // List se skupinami: řádky dílů na úrovni 1 pod řádkem skupiny (rozbalené); titulek, záhlaví a poznámka bez úrovně.
  const grouped = (name: string, head: (ReportCell | null)[][], rows: Row[], foot: (ReportCell | null)[][], cols: { width: number }[]): ReportSheet => ({
    name,
    data: [...head, ...rows.map((r) => r.cells), ...foot],
    columns: cols,
    stickyRows: 6,
    stickyColumns: 2,
    gridLines: true,
    outline: [...head.map(() => undefined), ...rows.map((r) => (r.level ? { level: r.level } : undefined)), ...foot.map(() => undefined)],
  });
  const head = [...titleRows(texts, width), ...headerRows(labels, days, boundary, texts)];

  // PRIO Sorting (pro kvalitu): jen nepokryté díly a kolik kusů jim chybí po dnech – to je potřeba vytřídit z lokací
  // před sortingem (do skladu se nepočítají). Chybějící kusy dne = o kolik vzroste nepokrytá potřeba (−stav skladu).
  // V každém druhu podle toho, kdy díl začne chybět (při shodě víc chybějících kusů dřív), s pořadím v rámci druhu.
  const uncovered = (p: PartCoverage) => {
    const short = (v: number) => Math.max(0, -v);
    let prev = short((p.stock ?? 0) - p.overdue);
    const perDay = p.balance.map((v) => {
      const now = short(v);
      const q = now - prev;
      prev = now;
      return q > 1e-9 ? q : 0;
    });
    return { overdue: short((p.stock ?? 0) - p.overdue), perDay, total: short(p.balance.at(-1) ?? (p.stock ?? 0) - p.overdue) };
  };
  const shortAt = (p: PartCoverage) => (p.firstShort ? (p.firstShort.planned ?? -Infinity) : Infinity);
  const prioLabels = [texts.order, texts.item, texts.kind, texts.description, texts.stock, texts.sorting, texts.missing, ...(anyOverdue ? [texts.overdue] : []), texts.shortFrom];
  const prioWidth = prioLabels.length + days.length;
  const prioRows = groups.flatMap(({ kind, list }): Row[] => {
    const sorted = list
      .filter((p) => p.firstShort)
      .map((p) => ({ p, u: uncovered(p) }))
      .sort((a, b) => shortAt(a.p) - shortAt(b.p) || b.u.total - a.u.total || a.p.item.localeCompare(b.p.item, 'en', { numeric: true }));
    if (sorted.length === 0) return [];
    return [
      groupRow(kind, sorted.length, prioWidth),
      ...sorted.map(({ p, u }, i): Row => {
        const toSort = sortingStock(p);
        return {
          cells: [
            { value: i + 1, type: Number, align: 'center' },
            { value: p.item, fontWeight: 'bold' },
            { value: p.kind, align: 'center' },
            { value: p.description },
            qty(p.stock ?? 0),
            toSort === null ? { value: '' } : { ...qty(toSort), ...(toSort < u.total ? { textColor: C.down } : {}) },
            { ...qty(u.total), fontWeight: 'bold', textColor: C.down },
            ...(anyOverdue ? [u.overdue ? { ...qty(u.overdue), fontWeight: 'bold' as const, textColor: C.down } : { value: '' }] : []),
            { value: shortText(p), textColor: C.down },
            ...u.perDay.map((q, k): ReportCell => {
              const d = days[k]!;
              const style: ReportCell = { ...(isWeekend(d) ? { backgroundColor: C.weekend } : {}), ...edge(d) };
              return q ? { value: q, type: Number, format: QTY, ...style, fontWeight: 'bold', textColor: C.down, backgroundColor: C.negative } : { value: '', ...style };
            }),
          ],
          level: 1,
        };
      }),
    ];
  });
  const prioNote: (ReportCell | null)[] = [{ value: texts.prioNote, textColor: C.muted, fontStyle: 'italic', wrap: true, height: 30, alignVertical: 'top', columnSpan: prioWidth }, ...Array.from({ length: prioWidth - 1 }, () => null)];

  return [
    matrixSheet(cars, texts, carTexts),
    grouped(texts.sheetCoverage, head, coverageRows, [[], note], columns),
    grouped(texts.sheetDemand, head, demandRows, [[], note], columns),
    grouped(
      texts.sheetPrio,
      [...titleRows(texts, prioWidth), ...headerRows(prioLabels, days, boundary, texts)],
      prioRows,
      [[], prioNote],
      [{ width: 7 }, { width: 18 }, { width: 6 }, { width: 34 }, { width: 9 }, { width: 10 }, { width: 9 }, ...(anyOverdue ? [{ width: 10 }] : []), { width: 30 }, ...days.map(() => ({ width: 8 }))],
    ),
  ];
}
