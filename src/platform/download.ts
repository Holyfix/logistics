// Stažení souboru vytvořeného v prohlížeči (CSV nebo Excel).

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

/** Excel se vytváří až při stažení, knihovna se načte jen tehdy. */
export async function downloadXlsxSheets(fileName: string, sheets: XlsxSheet[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const blob = await writeXlsxFile(
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
  downloadBlob(fileName, blob);
}

export function downloadXlsx(fileName: string, sheetName: string, header: string[], rows: XlsxValue[][]): Promise<void> {
  return downloadXlsxSheets(fileName, [{ name: sheetName, header, rows }]);
}
