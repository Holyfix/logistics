// Kmenová data dílů (mapování): tabulka, kterou udržuje uživatel (Excel nebo CSV ve sdílené složce).

import { findColumn } from './csv';
import { cellNumber, cellText, MAX_ISSUES, type DataIssue, type DataTable } from './table';

export const MASTER_COLUMNS = {
  item: ['Item Number', 'Díl', 'Číslo dílu', 'Item', 'Part Number'],
  customerNumber: ['Customer Number', 'Číslo zákazníka', 'Customer Item Number'],
  description: ['Description', 'Item Description', 'Popis'],
  variant: ['Variant', 'Varianta'],
  type: ['Type', 'Typ'],
  project: ['Project', 'Projekt'],
  customer: ['Zákazník', 'Customer'],
  side: ['Strana', 'Side', 'Řízení'],
  safetyStock: ['Safety Stock', 'Pojistná zásoba'],
  safetyTime: ['Safety Time', 'Pojistná doba'],
  orderMultiple: ['Order Multiple', 'Balení', 'Kusů v balení'],
} as const;

export const SIDES = ['LHD', 'RHD'] as const;

export interface MasterItem {
  item: string;
  /** Číslo dílu u zákazníka, jak je v mapování. */
  customerNumber: string;
  /** Normalizované číslo zákazníka pro párování se soubory zákazníka (customerKey). */
  customerKey: string;
  description: string;
  variant: string;
  type: string;
  project: string;
  customer: string;
  /** LHD / RHD: ze sloupce Strana, jinak ze začátku varianty (např. „LHD HUD“). */
  side: string;
  safetyStock: number | null;
  safetyTime: number | null;
  /** Kusů v plném balení; podle něj se náš sklad dělí na plná a neúplná balení. */
  orderMultiple: number | null;
}

export interface MasterData {
  items: Map<string, MasterItem>;
  /** Díly podle normalizovaného čísla zákazníka. */
  byCustomerKey: Map<string, MasterItem>;
  issueCount: number;
  issues: DataIssue[];
}

export type MasterResult = { ok: true; value: MasterData } | { ok: false; error: 'missingColumns'; columns: string[] };

/**
 * Číslo dílu zákazníka v jednotné podobě: velká písmena bez mezer. Dlouhá čísla začínající „A“
 * (číslo dílu + doplněná varianta, např. „A1234567890  00001234“) se zkrátí na prvních 11 a posledních 4 znaků,
 * aby se shodovala různá zápisová pravidla v souborech zákazníka.
 */
export function customerKey(value: string): string {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (compact.length >= 15 && compact.startsWith('A')) return compact.slice(0, 11) + compact.slice(-4);
  return compact;
}

function sideOf(side: string, variant: string): string {
  const explicit = side.toUpperCase();
  if (explicit) return explicit;
  const first = variant.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return (SIDES as readonly string[]).includes(first) ? first : '';
}

export function parseMasterData(table: DataTable): MasterResult {
  const col = Object.fromEntries(
    Object.entries(MASTER_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)]),
  ) as Record<keyof typeof MASTER_COLUMNS, number>;
  if (col.item === -1) return { ok: false, error: 'missingColumns', columns: [MASTER_COLUMNS.item[0]] };

  const items = new Map<string, MasterItem>();
  const byCustomerKey = new Map<string, MasterItem>();
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
    const variant = text(row, col.variant);
    const side = sideOf(text(row, col.side), variant);
    if (col.side !== -1 && side && !(SIDES as readonly string[]).includes(side)) {
      issue({ row: rowNo, column: MASTER_COLUMNS.side[0], value: side, message: 'unknownSide' });
    }
    const customerNumber = text(row, col.customerNumber);
    const number = (c: number) => (c === -1 ? null : cellNumber(row[c]));
    const entry: MasterItem = {
      item,
      customerNumber,
      customerKey: customerKey(customerNumber),
      description: text(row, col.description),
      variant,
      type: text(row, col.type),
      project: text(row, col.project),
      customer: text(row, col.customer),
      side,
      safetyStock: number(col.safetyStock),
      safetyTime: number(col.safetyTime),
      orderMultiple: number(col.orderMultiple),
    };
    items.set(item, entry);
    if (entry.customerKey) {
      const other = byCustomerKey.get(entry.customerKey);
      if (other && other.item !== item) {
        issue({ row: rowNo, column: MASTER_COLUMNS.customerNumber[0], value: `${customerNumber} (${other.item})`, message: 'duplicateCustomerNumber' });
      } else {
        byCustomerKey.set(entry.customerKey, entry);
      }
    }
  });

  return { ok: true, value: { items, byCustomerKey, issueCount, issues } };
}

/** Šablona mapování dílů: všechny známé díly, u existujících předvyplněné hodnoty. */
export function masterDataTemplate(
  parts: readonly { item: string; description: string }[],
  existing: Map<string, MasterItem> | undefined,
): { header: string[]; rows: string[][] } {
  const header = ['Item Number', 'Customer Number', 'Description', 'Variant', 'Type', 'Project', 'Safety Stock', 'Safety Time', 'Order Multiple'];
  const rows = parts.map(({ item, description }) => {
    const m = existing?.get(item);
    const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
    return [item, m?.customerNumber ?? '', m?.description || description, m?.variant ?? '', m?.type ?? '', m?.project ?? '', n(m?.safetyStock), n(m?.safetyTime), n(m?.orderMultiple)];
  });
  return { header, rows };
}
