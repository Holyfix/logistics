// Zpracování souborů na pozadí, aby aplikace během načítání nezamrzla.

import readXlsxFile, { readSheet } from 'read-excel-file/universal';
import { parseCallOffExport, type CallOffExport, type ParseResult } from '../core/calloffs/parse';
import { parseCoverageWorkbook, type CoverageResult } from '../core/coverage/parse';
import { parseCsv } from '../core/csv';
import { parseMasterData, type MasterResult } from '../core/masterdata';
import { decodeText } from '../core/text';
import type { SourceFormat } from '../core/sources';
import type { Cell, DataTable } from '../core/table';

export type ParseRequest = { id: number; kind: 'calloffs' | 'masterdata' | 'coverage'; format: SourceFormat; name: string; buffer: ArrayBuffer };

export type ParseResponse =
  | { id: number; kind: 'calloffs'; result: ParseResult<CallOffExport> }
  | { id: number; kind: 'masterdata'; result: MasterResult }
  | { id: number; kind: 'coverage'; result: CoverageResult }
  | { id: number; kind: 'error'; message: string };

async function readTable(format: SourceFormat, buffer: ArrayBuffer): Promise<DataTable> {
  if (format === 'csv') return parseCsv(decodeText(buffer));
  const data = (await readSheet(buffer)) as Cell[][];
  const [header = [], ...rows] = data;
  return { header: header.map((h) => (h === null ? '' : String(h).trim())), rows };
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
