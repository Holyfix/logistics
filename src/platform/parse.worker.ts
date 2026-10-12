// Zpracování souborů na pozadí, aby aplikace během načítání nezamrzla.

import { readSheet } from 'read-excel-file/universal';
import { parseCallOffExport, type CallOffExport, type ParseResult } from '../core/calloffs/parse';
import { parseCsv } from '../core/csv';
import { parseMasterData, type MasterResult } from '../core/masterdata';
import { decodeText } from '../core/text';
import type { SourceFormat } from '../core/sources';
import type { Cell, DataTable } from '../core/table';

export type ParseRequest = { id: number; kind: 'calloffs' | 'masterdata'; format: SourceFormat; name: string; buffer: ArrayBuffer };

export type ParseResponse =
  | { id: number; kind: 'calloffs'; result: ParseResult<CallOffExport> }
  | { id: number; kind: 'masterdata'; result: MasterResult }
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
