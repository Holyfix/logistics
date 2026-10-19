// Doplněný transit: naše expedice, které ještě nejsou v souboru coverage od zákazníka (např. ranní expedice).
// Soubory ve složce Transit (export transakcí z ERP nebo vlastní seznam): díl, množství a den expedice.

import type { CoverageSource } from './coverage/compute';
import { findColumn } from './csv';
import type { DayNumber } from './dates';
import type { MasterData } from './masterdata';
import { lastMoveDay } from './stock';
import { cellNumber, cellText, MAX_ISSUES, type DataIssue, type DataTable } from './table';

export const TRANSIT_COLUMNS = {
  item: ['Item Number', 'Díl', 'Číslo dílu', 'Item'],
  // Výdej je v exportu transakcí záporný („Quantity Change“); počítá se absolutní hodnota.
  qty: ['Quantity Change', 'Loc Qty Change', 'Quantity', 'Qty', 'Množství'],
  day: ['Effective Date', 'Date', 'Ship Date', 'Datum'],
  time: ['Time', 'Čas'],
  shipment: ['Shipper Number', 'Packing Slip', 'Doklad', 'Dodací list'],
  destination: ['Address', 'Destinace'],
  transaction: ['Transaction Number', 'Transakce'],
} as const;

export interface TransitRow {
  item: string;
  qty: number;
  day: DayNumber;
  time: string;
  shipment: string;
  destination: string;
  /** Klíč proti dvojímu započtení: číslo transakce, jinak díl, den, čas, doklad a množství. */
  key: string;
}

export interface TransitData {
  rows: TransitRow[];
  issueCount: number;
  issues: DataIssue[];
}

export type TransitResult = { ok: true; value: TransitData } | { ok: false; error: 'missingColumns'; columns: string[] };

export function parseTransit(table: DataTable): TransitResult {
  const col = Object.fromEntries(Object.entries(TRANSIT_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)])) as Record<
    keyof typeof TRANSIT_COLUMNS,
    number
  >;
  const missing = (['item', 'qty', 'day'] as const).filter((key) => col[key] === -1).map((key) => TRANSIT_COLUMNS[key][0]);
  if (missing.length) return { ok: false, error: 'missingColumns', columns: missing };
  const text = (row: DataTable['rows'][number], c: number) => (c === -1 ? '' : cellText(row[c]));
  const rows: TransitRow[] = [];
  const issues: DataIssue[] = [];
  let issueCount = 0;
  const issue = (i: DataIssue) => {
    issueCount++;
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  table.rows.forEach((row, index) => {
    const item = text(row, col.item).toUpperCase();
    if (!item) return;
    const qty = cellNumber(row[col.qty]);
    if (qty === null) return issue({ row: index + 2, column: table.header[col.qty]!, value: text(row, col.qty), message: 'invalidNumber' });
    const day = lastMoveDay(row[col.day]);
    if (day === null) return issue({ row: index + 2, column: table.header[col.day]!, value: text(row, col.day), message: 'invalidDate' });
    if (qty === 0) return;
    const r = { item, qty: Math.abs(qty), day, time: text(row, col.time), shipment: text(row, col.shipment), destination: text(row, col.destination) };
    rows.push({ ...r, key: text(row, col.transaction) || `${item}|${day}|${r.time}|${r.shipment}|${r.qty}` });
  });
  return { ok: true, value: { rows, issueCount, issues } };
}

/** added = přičteno k transitu; old = soubor coverage je z pozdějšího dne (expedici už obsahuje); noCoverage = díl
 * není v žádném souboru coverage; ambiguous = díl je ve víc souborech coverage (nejde určit destinaci). */
export type TransitStatus = 'added' | 'old' | 'noCoverage' | 'ambiguous' | 'duplicate';

export interface TransitEntry {
  file: string;
  row: TransitRow;
  status: TransitStatus;
  /** Soubor coverage, ke kterému se expedice přičetla (nebo podle kterého je stará). */
  location: string;
  project: string;
}

/**
 * Přičte expedice ze složky Transit k transitu u zákazníka: řádek coverage se najde přes mapování (naše číslo
 * dílu), množství se přičte ke všem dnům souboru (transit je součet od prvního dne). Expedice ze dne před prvním dnem
 * souboru coverage se nepřičte – soubor je novější a expedici už obsahuje.
 */
export function applyTransit(
  sources: readonly CoverageSource[],
  master: MasterData | undefined,
  files: readonly { path: string; data: TransitData }[],
): { coverage: CoverageSource[]; entries: TransitEntry[] } {
  // Řádky coverage po našem čísle dílu.
  const byItem = new Map<string, { source: number; row: number }[]>();
  sources.forEach((source, s) =>
    source.report.rows.forEach((row, r) => {
      const m = master?.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master?.items.get(row.supplierItem) : undefined);
      const item = (m?.item ?? row.supplierItem).toUpperCase();
      if (item) (byItem.get(item) ?? byItem.set(item, []).get(item)!).push({ source: s, row: r });
    }),
  );
  const extra = sources.map(() => new Map<number, number>());
  const seen = new Set<string>();
  const entries: TransitEntry[] = [];
  for (const file of files) {
    for (const row of file.data.rows) {
      const targets = byItem.get(row.item) ?? [];
      const target = targets.length === 1 ? targets[0]! : null;
      const source = target ? sources[target.source]! : null;
      const where = source ? { location: source.location, project: source.project } : { location: '', project: '' };
      let status: TransitStatus;
      if (seen.has(row.key)) status = 'duplicate';
      else if (!targets.length) status = 'noCoverage';
      else if (!target) status = 'ambiguous';
      else if ((source!.report.days[0] ?? row.day) > row.day) status = 'old';
      else status = 'added';
      seen.add(row.key);
      if (status === 'added') extra[target!.source]!.set(target!.row, (extra[target!.source]!.get(target!.row) ?? 0) + row.qty);
      entries.push({ file: file.path, row, status, ...where });
    }
  }
  const coverage = sources.map((source, s) => {
    const add = extra[s]!;
    if (!add.size) return source;
    const rows = source.report.rows.map((row, r) => (add.has(r) ? { ...row, transit: row.transit.map((t) => t + add.get(r)!) } : row));
    return { ...source, report: { ...source.report, rows }, extraTransit: add };
  });
  return { coverage, entries };
}
