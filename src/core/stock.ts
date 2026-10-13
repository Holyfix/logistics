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

/** Zóny, které se počítají do našeho skladu (příjem, sklady, výroba); jiné lze nastavit v Settings.csv. */
export const DEFAULT_STOCK_ZONES = ['INCOME', 'MEZ', 'PRE', 'PURCH', 'SALE', 'WRKC'] as const;

export interface StockRule {
  zones: readonly string[];
  /** Lokace, které se nepočítají (porovnává se bez ohledu na velikost písmen). */
  excludedLocations: readonly string[];
}

export const DEFAULT_STOCK_RULE: StockRule = { zones: DEFAULT_STOCK_ZONES, excludedLocations: [] };

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
 * Zásoba po dílech: součet kladných množství na lokacích ve vybraných zónách, bez vyloučených lokací.
 * Plná i neúplná balení se počítají dohromady; záporné a nulové lokace se nepočítají.
 */
export function stockByItem(stock: StockData, rule: StockRule = DEFAULT_STOCK_RULE): Map<string, number> {
  const zones = new Set(rule.zones.map((z) => z.toUpperCase()));
  const excluded = new Set(rule.excludedLocations.map((l) => l.toUpperCase()));
  const result = new Map<string, number>();
  for (const row of stock.rows) {
    if (row.qty <= 0 || !zones.has(row.zone) || excluded.has(row.location.toUpperCase())) continue;
    result.set(row.item, (result.get(row.item) ?? 0) + row.qty);
  }
  return result;
}

/** Pravidlo pro náš sklad podle nastavení ve sdílené složce. */
export function stockRule(settings: { stockZones: string[] | null; stockExcludedLocations: string[] } | null | undefined): StockRule {
  return { zones: settings?.stockZones ?? DEFAULT_STOCK_ZONES, excludedLocations: settings?.stockExcludedLocations ?? [] };
}

/** Počet různých dílů v souboru. */
export function stockItemCount(stock: StockData): number {
  return new Set(stock.rows.map((r) => r.item)).size;
}
