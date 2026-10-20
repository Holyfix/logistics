// Stažení souboru vytvořeného v prohlížeči (CSV nebo Excel).

import type { ReportSheet } from '../core/calloffs/summaryReport';
import { outlineFeature } from './xlsxOutline';

/** Název souboru bez diakritiky a zvláštních znaků (některé prohlížeče a systémy s nimi mají potíže). */
export function safeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_');
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(fileName);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(fileName: string, csv: string): void {
  downloadBlob(fileName, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

type XlsxValue = string | number | null;

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: XlsxValue[][];
  /** Kolik prvních sloupců zůstane při posunu vidět. */
  stickyColumns?: number;
}

/** Sešit Excelu z listů. Knihovna se načte až při prvním použití. */
export async function xlsxBlob(sheets: XlsxSheet[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  return writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name.slice(0, 31),
      stickyRowsCount: 1,
      ...(sheet.stickyColumns ? { stickyColumnsCount: sheet.stickyColumns } : {}),
      data: [
        sheet.header.map((value) => ({ value, fontWeight: 'bold' as const })),
        // Prázdná buňka je v knihovně null místo objektu.
        ...sheet.rows.map((row) => row.map((value) => (value === null ? null : { value }))),
      ],
    })),
  ).toBlob();
}

/** Excel se vytváří až při stažení, knihovna se načte jen tehdy. */
export async function downloadXlsxSheets(fileName: string, sheets: XlsxSheet[]): Promise<void> {
  downloadBlob(fileName, await xlsxBlob(sheets));
}

export function downloadXlsx(fileName: string, sheetName: string, header: string[], rows: XlsxValue[][]): Promise<void> {
  return downloadXlsxSheets(fileName, [{ name: sheetName, header, rows }]);
}

/** Formátovaný sešit (barvy, formáty čísel, ukotvené řádky) pro reporty, které se posílají dál. */
export async function downloadReport(fileName: string, sheets: ReportSheet[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const blob = await writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name.slice(0, 31),
      // Buňky reportu jsou podmnožina buněk knihovny.
      data: sheet.data as Parameters<typeof writeXlsxFile>[0][number]['data'],
      columns: sheet.columns,
      stickyRowsCount: sheet.stickyRows,
      stickyColumnsCount: sheet.stickyColumns,
      showGridLines: sheet.gridLines ?? false,
      orientation: 'landscape' as const,
    })),
    { features: [outlineFeature(sheets.map((s) => s.outline))] },
  ).toBlob();
  downloadBlob(fileName, blob);
}
