// Kmenová data dílů: tabulka, kterou udržuje uživatel (Excel nebo CSV ve sdílené složce).

import { findColumn } from './csv';
import { cellText, MAX_ISSUES, type DataIssue, type DataTable } from './table';

export const MASTER_COLUMNS = {
  item: ['Item Number', 'Díl', 'Číslo dílu', 'Item', 'Part Number'],
  description: ['Item Description', 'Popis', 'Description'],
  customer: ['Zákazník', 'Customer'],
  project: ['Projekt', 'Project'],
  side: ['Strana', 'Side', 'Řízení'],
} as const;

export const SIDES = ['LHD', 'RHD'] as const;

export interface MasterItem {
  item: string;
  description: string;
  customer: string;
  project: string;
  side: string;
}

export interface MasterData {
  items: Map<string, MasterItem>;
  issueCount: number;
  issues: DataIssue[];
}

export type MasterResult = { ok: true; value: MasterData } | { ok: false; error: 'missingColumns'; columns: string[] };

export function parseMasterData(table: DataTable): MasterResult {
  const col = Object.fromEntries(
    Object.entries(MASTER_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)]),
  ) as Record<keyof typeof MASTER_COLUMNS, number>;
  if (col.item === -1) return { ok: false, error: 'missingColumns', columns: [MASTER_COLUMNS.item[0]] };

  const items = new Map<string, MasterItem>();
  const issues: DataIssue[] = [];
  let issueCount = 0;
  const issue = (i: DataIssue) => {
    issueCount++;
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  const text = (row: DataTable['rows'][number], c: number) => (c === -1 ? '' : cellText(row[c]));

  table.rows.forEach((row, index) => {
    const rowNo = index + 2;
    const item = text(row, col.item);
    if (!item) return;
    if (items.has(item)) issue({ row: rowNo, column: MASTER_COLUMNS.item[0], value: item, message: 'duplicateItem' });
    const side = text(row, col.side).toUpperCase();
    if (side && !(SIDES as readonly string[]).includes(side)) {
      issue({ row: rowNo, column: MASTER_COLUMNS.side[0], value: side, message: 'unknownSide' });
    }
    items.set(item, {
      item,
      description: text(row, col.description),
      customer: text(row, col.customer),
      project: text(row, col.project),
      side,
    });
  });

  return { ok: true, value: { items, issueCount, issues } };
}

/** Šablona kmenových dat: všechny známé díly, u existujících předvyplněné hodnoty. */
export function masterDataTemplate(
  parts: readonly { item: string; description: string }[],
  existing: Map<string, MasterItem> | undefined,
): { header: string[]; rows: string[][] } {
  const header = ['Item Number', 'Item Description', 'Zákazník', 'Projekt', 'Strana'];
  const rows = parts.map(({ item, description }) => {
    const m = existing?.get(item);
    return [item, m?.description || description, m?.customer ?? '', m?.project ?? '', m?.side ?? ''];
  });
  return { header, rows };
}
