// Stažení souboru vytvořeného v prohlížeči (CSV nebo Excel).

import type { Feature } from 'write-excel-file/browser';
import type { ReportList, ReportSheet } from '../core/calloffs/summaryReport';

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

/** Sloupec jako písmena (1 → A, 27 → AA). */
function columnLetters(column: number): string {
  let s = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const cellRef = (p: { row: number; column: number }) => `${columnLetters(p.column)}${p.row}`;

/** Element `<dataValidations>` listu: výběr ze seznamu hodnot, jiná hodnota se nepřijme. */
export function listValidationsXml(lists: readonly ReportList[]): string {
  const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const items = lists.map(
    (l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${cellRef(l.from)}:${cellRef(l.to)}"><formula1>${escape(`"${l.values.join(',')}"`)}</formula1></dataValidation>`,
  );
  return `<dataValidations count="${lists.length}">${items.join('')}</dataValidations>`;
}

/** Elementy listu, které podle specifikace následují za `<dataValidations>` (Excel jiné pořadí odmítne). */
const AFTER_VALIDATIONS = ['hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];

/** Vloží `<dataValidations>` do XML listu: za podmíněné formátování, před první z následujících elementů. */
export function insertListValidations(sheetXml: string, lists: readonly ReportList[]): string {
  if (!lists.length) return sheetXml;
  const positions = AFTER_VALIDATIONS.map((tag) => sheetXml.search(new RegExp(`<${tag}[\\s/>]`))).filter((i) => i >= 0);
  const at = positions.length ? Math.min(...positions) : sheetXml.lastIndexOf('</worksheet>');
  return sheetXml.slice(0, at) + listValidationsXml(lists) + sheetXml.slice(at);
}

/** Formátovaný sešit (barvy, formáty čísel, ukotvené řádky) pro reporty, které se posílají dál. */
export async function downloadReport(fileName: string, sheets: ReportSheet[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  // Výběr ze seznamu knihovna neumí, doplní se do XML listu.
  const lists: Feature<File | Blob | ArrayBuffer> = {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform: (xml, _options, { sheetIndex }) => insertListValidations(xml, sheets[sheetIndex]?.lists ?? []),
        },
      },
    },
  };
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
      ...(sheet.rules?.length
        ? { conditionalFormatting: sheet.rules.map((r) => ({ cellRange: { from: r.from, to: r.to }, condition: { formula: r.formula }, style: r.style })) }
        : {}),
    })),
    { features: [lists] },
  ).toBlob();
  downloadBlob(fileName, blob);
}
