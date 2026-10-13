// Zpracování souborů na pozadí, aby aplikace během načítání nezamrzla.

import readXlsxFile, { readSheet } from 'read-excel-file/universal';
import { parseCallOffExport, type CallOffExport, type ParseResult } from '../core/calloffs/parse';
import { parseCoverageWorkbook, type CoverageResult } from '../core/coverage/parse';
import { parseCsv } from '../core/csv';
import { parseMasterData, type MasterResult } from '../core/masterdata';
import { parseBom, type BomResult } from '../core/bom';
import { parseStock, type StockResult } from '../core/stock';
import { decodeText } from '../core/text';
import type { SourceFormat } from '../core/sources';
import type { Cell, DataTable } from '../core/table';

export type ParseRequest = { id: number; kind: 'calloffs' | 'masterdata' | 'coverage' | 'stock' | 'bom'; format: SourceFormat; name: string; buffer: ArrayBuffer };

export type ParseResponse =
  | { id: number; kind: 'calloffs'; result: ParseResult<CallOffExport> }
  | { id: number; kind: 'masterdata'; result: MasterResult }
  | { id: number; kind: 'coverage'; result: CoverageResult }
  | { id: number; kind: 'stock'; result: StockResult }
  | { id: number; kind: 'bom'; result: BomResult }
  | { id: number; kind: 'error'; message: string };

function toTable(data: Cell[][]): DataTable {
  const [header = [], ...rows] = data;
  return { header: header.map((h) => (h === null ? '' : String(h).trim())), rows };
}

async function readTable(format: SourceFormat, buffer: ArrayBuffer): Promise<DataTable> {
  if (format === 'csv') return parseCsv(decodeText(buffer));
  return toTable((await readSheet(buffer)) as Cell[][]);
}

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, kind, format, name, buffer } = event.data;
  try {
    if (kind === 'coverage') {
      // Soubory pokrytí mají víc listů; formát se pozná podle obsahu listu.
      const sheets = await readXlsxFile(buffer);
      const result = parseCoverageWorkbook(sheets.map((s) => ({ name: s.sheet, data: s.data as Cell[][] })));
      (self as unknown as Worker).postMessage({ id, kind, result } satisfies ParseResponse);
      return;
    }
    if (kind === 'bom') {
      // Kusovník: první list (záhlaví může být o pár řádků níž).
      const data = format === 'csv' ? (({ header, rows }) => [header, ...rows])(parseCsv(decodeText(buffer))) : ((await readSheet(buffer)) as Cell[][]);
      (self as unknown as Worker).postMessage({ id, kind, result: parseBom(data) } satisfies ParseResponse);
      return;
    }
    if (kind === 'stock') {
      // Sklad v Excelu: list „Data“, jinak první list.
      let table: DataTable;
      if (format === 'csv') table = parseCsv(decodeText(buffer));
      else {
        const sheets = await readXlsxFile(buffer);
        const sheet = sheets.find((s) => s.sheet.trim().toLowerCase() === 'data') ?? sheets[0];
        table = toTable((sheet?.data ?? []) as Cell[][]);
      }
      (self as unknown as Worker).postMessage({ id, kind, result: parseStock(table) } satisfies ParseResponse);
      return;
    }
    const table = await readTable(format, buffer);
    if (kind === 'calloffs') {
      const result = parseCallOffExport(table, name);
      const transfer = result.ok
        ? [result.value.offsets.buffer, result.value.days.buffer, result.value.qty.buffer, result.value.backlog.buffer, result.value.cumShipped.buffer]
        : [];
      (self as unknown as Worker).postMessage({ id, kind, result } satisfies ParseResponse, transfer);
    } else {
      (self as unknown as Worker).postMessage({ id, kind, result: parseMasterData(table) } satisfies ParseResponse);
    }
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) } satisfies ParseResponse);
  }
};
