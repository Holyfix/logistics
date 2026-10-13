// Náš sklad: export zásob po lokacích (celý sklad, používají ho i další moduly).

import { findColumn } from './csv';
import { cellNumber, cellText, MAX_ISSUES, type DataIssue, type DataTable } from './table';

export const STOCK_COLUMNS = {
  item: ['Item Number', 'Díl', 'Číslo dílu', 'Item'],
  // Množství na lokaci; „Qty Available“ má přednost, pokud ho export obsahuje.
  qty: ['Qty Available', 'Qty On Hand - Inv Detail', 'Qty On Hand', 'Quantity', 'Množství'],
  description: ['Description', 'Item Description', 'Popis'],
  location: ['Location', 'Lokace'],
  zone: ['Zone ID', 'Zone', 'Zóna'],
  area: ['Area ID', 'Area'],
  warehouse: ['Warehouse ID', 'Warehouse', 'Sklad'],
  status: ['Status', 'Inventory Status'],
} as const;

/** Zóny, které se počítají do našeho skladu: příjem, sklady a výroba. */
export const STOCK_ZONES: readonly string[] = ['INCOME', 'MEZ', 'PRE', 'PURCH', 'SALE', 'WRKC'];

/** Otisk názvu lokace (FNV-1a, 32 bitů) z velkých písmen bez mezer na okrajích. */
export function locationHash(location: string): number {
  let hash = 0x811c9dc5;
  for (const ch of location.trim().toUpperCase()) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Lokace, které se do našeho skladu nepočítají: externí lokace, kde jsou díly už zamontované
 * ve výrobku odběratele. Názvy jsou firemní, proto jsou ve veřejném kódu jen jako otisk (locationHash);
 * skutečný název ukáže modul Data podle načteného souboru skladu.
 */
const EXCLUDED_LOCATIONS = new Set([0xe9f4bdc9]);

export function isExcludedLocation(location: string): boolean {
  return EXCLUDED_LOCATIONS.has(locationHash(location));
}

export interface StockRow {
  item: string;
  location: string;
  zone: string;
  area: string;
  warehouse: string;
  status: string;
  qty: number;
}

export interface StockData {
  rows: StockRow[];
  /** Popis dílu (první neprázdný v souboru). */
  descriptions: Map<string, string>;
  /** Název sloupce, ze kterého je množství. */
  qtyColumn: string;
  issueCount: number;
  issues: DataIssue[];
}

export type StockResult = { ok: true; value: StockData } | { ok: false; error: 'missingColumns'; columns: string[] };

export function parseStock(table: DataTable): StockResult {
  const col = Object.fromEntries(
    Object.entries(STOCK_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)]),
  ) as Record<keyof typeof STOCK_COLUMNS, number>;
  const missing = (['item', 'qty'] as const).filter((key) => col[key] === -1).map((key) => STOCK_COLUMNS[key][0]);
  if (missing.length > 0) return { ok: false, error: 'missingColumns', columns: missing };

  const rows: StockRow[] = [];
  const descriptions = new Map<string, string>();
  const issues: DataIssue[] = [];
  let issueCount = 0;
  const text = (row: DataTable['rows'][number], c: number) => (c === -1 ? '' : cellText(row[c]));
  const upper = (row: DataTable['rows'][number], c: number) => text(row, c).toUpperCase();
  const qtyColumn = table.header[col.qty]!;

  table.rows.forEach((row, index) => {
    const item = text(row, col.item).toUpperCase();
    if (!item) return;
    const raw = row[col.qty];
    const qty = cellText(raw) === '' ? 0 : cellNumber(raw);
    if (qty === null) {
      issueCount++;
      if (issues.length < MAX_ISSUES) issues.push({ row: index + 2, column: qtyColumn, value: cellText(raw), message: 'invalidNumber' });
      return;
    }
    const description = text(row, col.description);
    if (description && !descriptions.has(item)) descriptions.set(item, description);
    rows.push({
      item,
      location: text(row, col.location),
      zone: upper(row, col.zone),
      area: upper(row, col.area),
      warehouse: upper(row, col.warehouse),
      status: text(row, col.status),
      qty,
    });
  });

  return { ok: true, value: { rows, descriptions, qtyColumn, issueCount, issues } };
}

/**
 * Zásoba po dílech: součet kladných množství na lokacích v zónách STOCK_ZONES, bez vyloučených lokací.
 * Plná i neúplná balení se počítají dohromady; záporné a nulové lokace se nepočítají.
 */
export function stockByItem(stock: StockData, excluded: (location: string) => boolean = isExcludedLocation): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of stock.rows) {
    if (row.qty <= 0 || !STOCK_ZONES.includes(row.zone) || excluded(row.location)) continue;
    result.set(row.item, (result.get(row.item) ?? 0) + row.qty);
  }
  return result;
}

/** Vyloučené lokace, které jsou v souboru skladu (názvy tak, jak jsou v souboru, velkými písmeny). */
export function excludedLocationsIn(stock: StockData, excluded: (location: string) => boolean = isExcludedLocation): string[] {
  return [...new Set(stock.rows.filter((r) => excluded(r.location)).map((r) => r.location.trim().toUpperCase()))].sort();
}

/** Počet různých dílů v souboru. */
export function stockItemCount(stock: StockData): number {
  return new Set(stock.rows.map((r) => r.item)).size;
}
