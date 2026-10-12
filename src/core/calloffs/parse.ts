// Čtení týdenního exportu odvolávek (požadavky na expedici po dnech).

import { findColumn } from '../csv';
import { isoWeek, mondayOfIsoWeek, type DayNumber } from '../dates';
import { cellDay, cellNumber, cellText, MAX_ISSUES, type DataIssue, type DataTable } from '../table';

/** Názvy sloupců v exportu (první je název z ERP, další jsou povolené alternativy). */
export const CALLOFF_COLUMNS = {
  item: ['Item Number', 'Díl', 'Item'],
  description: ['Item Description', 'Popis', 'Description'],
  date: ['Date', 'Datum'],
  qty: ['Discrete Qty', 'Množství', 'Quantity'],
  cumQty: ['Cumulative Qty'],
  cumShipped: ['Cum Shipped'],
  salesOrder: ['Sales Order'],
  line: ['Line'],
  shipTo: ['Ship-To', 'Ship To'],
} as const;

const REQUIRED = ['item', 'date', 'qty'] as const;

/**
 * Jeden export odvolávek v úsporné podobě: požadavky jsou sečtené po dílech a dnech
 * (přes odběrná místa, zakázky a reference) a uložené v typovaných polích.
 */
export interface CallOffExport {
  fileName: string;
  /** Kalendářní týden exportu (ISO). */
  year: number;
  week: number;
  /** Pondělí týdne exportu, slouží k řazení exportů. */
  exportDay: DayNumber;
  firstDay: DayNumber;
  lastDay: DayNumber;
  /** Čísla dílů seřazená vzestupně. */
  items: string[];
  descriptions: string[];
  /** Pro díl i jsou jeho dny a množství na indexech offsets[i] až offsets[i + 1] - 1, seřazené podle dne. */
  offsets: Int32Array;
  days: Int32Array;
  qty: Float64Array;
  /** Nedodáno po termínu k datu exportu (z kumulativů), po dílech. */
  backlog: Float64Array;
  /** Odesláno kumulativně k datu exportu, po dílech. */
  cumShipped: Float64Array;
  /** Export obsahuje kumulativy (Cumulative Qty a Cum Shipped), takže jde spočítat odeslané množství. */
  hasCumShipped: boolean;
  rowCount: number;
  issueCount: number;
  issues: DataIssue[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Týden z názvu souboru, např. „Odvolávky_CW42.csv“ nebo „KW 7“. */
export function weekFromFileName(fileName: string): number | null {
  const m = /(?:^|[^a-z])(?:cw|kw|wk)[\s_-]*0?(\d{1,2})(?!\d)/i.exec(fileName);
  if (!m) return null;
  const week = Number(m[1]);
  return week >= 1 && week <= 53 ? week : null;
}

interface ScheduleState {
  day: DayNumber;
  cumQty: number;
  qty: number;
  cumShipped: number | null;
}

export function parseCallOffExport(table: DataTable, fileName: string): ParseResult<CallOffExport> {
  const col = Object.fromEntries(
    Object.entries(CALLOFF_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)]),
  ) as Record<keyof typeof CALLOFF_COLUMNS, number>;
  const missing = REQUIRED.filter((key) => col[key] === -1).map((key) => CALLOFF_COLUMNS[key][0]);
  if (missing.length > 0) return { ok: false, error: 'missingColumns', columns: missing };

  const issues: DataIssue[] = [];
  let issueCount = 0;
  const issue = (i: DataIssue) => {
    issueCount++;
    if (issues.length < MAX_ISSUES) issues.push(i);
  };

  const perItem = new Map<string, Map<DayNumber, number>>();
  const descriptions = new Map<string, string>();
  const schedules = new Map<string, Map<string, ScheduleState>>();
  let firstDay = Infinity;
  let lastDay = -Infinity;
  let rowCount = 0;

  table.rows.forEach((row, index) => {
    const rowNo = index + 2;
    const item = cellText(row[col.item]);
    if (!item) {
      issue({ row: rowNo, column: CALLOFF_COLUMNS.item[0], message: 'missingValue' });
      return;
    }
    const day = cellDay(row[col.date]);
    if (day === null) {
      issue({ row: rowNo, column: CALLOFF_COLUMNS.date[0], value: cellText(row[col.date]), message: 'invalidDate' });
      return;
    }
    const qty = cellNumber(row[col.qty]);
    if (qty === null) {
      issue({ row: rowNo, column: CALLOFF_COLUMNS.qty[0], value: cellText(row[col.qty]), message: 'invalidNumber' });
      return;
    }
    rowCount++;
    firstDay = Math.min(firstDay, day);
    lastDay = Math.max(lastDay, day);

    let days = perItem.get(item);
    if (!days) perItem.set(item, (days = new Map()));
    days.set(day, (days.get(day) ?? 0) + qty);

    if (col.description !== -1 && !descriptions.has(item)) {
      const description = cellText(row[col.description]);
      if (description) descriptions.set(item, description);
    }

    // Kumulativy jsou za plán (zakázka, řádek, odběrné místo). Pro nedodané množství
    // potřebujeme první řádek každého plánu.
    const cumQty = col.cumQty === -1 ? null : cellNumber(row[col.cumQty]);
    if (cumQty !== null) {
      const key = [col.salesOrder, col.line, col.shipTo].map((c) => (c === -1 ? '' : cellText(row[c]))).join('|');
      let itemSchedules = schedules.get(item);
      if (!itemSchedules) schedules.set(item, (itemSchedules = new Map()));
      const current = itemSchedules.get(key);
      if (!current || day < current.day || (day === current.day && cumQty < current.cumQty)) {
        const cumShipped = col.cumShipped === -1 ? null : cellNumber(row[col.cumShipped]);
        itemSchedules.set(key, { day, cumQty, qty, cumShipped });
      }
    }
  });

  const items = [...perItem.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const offsets = new Int32Array(items.length + 1);
  let total = 0;
  items.forEach((item, i) => {
    offsets[i] = total;
    total += perItem.get(item)!.size;
  });
  offsets[items.length] = total;

  const days = new Int32Array(total);
  const qty = new Float64Array(total);
  const backlog = new Float64Array(items.length);
  const cumShipped = new Float64Array(items.length);
  items.forEach((item, i) => {
    const entries = [...perItem.get(item)!.entries()].sort((a, b) => a[0] - b[0]);
    entries.forEach(([day, q], k) => {
      days[offsets[i]! + k] = day;
      qty[offsets[i]! + k] = q;
    });
    for (const s of schedules.get(item)?.values() ?? []) {
      if (s.cumShipped === null) continue;
      cumShipped[i]! += s.cumShipped;
      backlog[i]! += Math.max(0, s.cumQty - s.qty - s.cumShipped);
    }
  });

  if (rowCount === 0) {
    firstDay = 0;
    lastDay = 0;
  }
  const dataWeek = isoWeek(firstDay);
  const fileWeek = weekFromFileName(fileName);
  if (rowCount > 0 && fileWeek !== null && fileWeek !== dataWeek.week) {
    issue({ row: 1, value: `CW ${fileWeek} / CW ${dataWeek.week}`, message: 'weekMismatch' });
  }
  const week = fileWeek ?? dataWeek.week;

  return {
    ok: true,
    value: {
      fileName,
      year: dataWeek.year,
      week,
      exportDay: mondayOfIsoWeek(dataWeek.year, week),
      firstDay,
      lastDay,
      items,
      descriptions: items.map((item) => descriptions.get(item) ?? ''),
      offsets,
      days,
      qty,
      backlog,
      cumShipped,
      hasCumShipped: col.cumQty !== -1 && col.cumShipped !== -1,
      rowCount,
      issueCount,
      issues,
    },
  };
}
