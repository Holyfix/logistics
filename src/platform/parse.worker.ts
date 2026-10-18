// Zpracování souborů na pozadí, aby aplikace během načítání nezamrzla.

import readXlsxFile, { readSheet } from 'read-excel-file/universal';
import { parseCallOffExport, type CallOffExport, type ParseResult } from '../core/calloffs/parse';
import { parseCoverageWorkbook, type CoverageResult } from '../core/coverage/parse';
import { parseCsv } from '../core/csv';
import { parseMasterData, parseMasterWorkbook, type MasterResult } from '../core/masterdata';
import { mergeBoms, parseBom, type BomResult } from '../core/bom';
import { parseStock, type StockResult } from '../core/stock';
import { parsePlanWorkbook, type PlanResult } from '../core/planning/plan';
import { parseSettings, type PlanSettings } from '../core/planning/settings';
import { parseKpiWorkbook, type KpiResult } from '../core/kpi';
import { parseOilWorkbook, type OilResult } from '../core/oil';
import { decodeText } from '../core/text';
import type { SourceFormat } from '../core/sources';
import type { Cell, DataTable } from '../core/table';

export type ParseRequest = { id: number; kind: 'calloffs' | 'masterdata' | 'coverage' | 'stock' | 'bom' | 'plan' | 'planSettings' | 'oil' | 'kpi'; format: SourceFormat; name: string; buffer: ArrayBuffer };

export type ParseResponse =
  | { id: number; kind: 'calloffs'; result: ParseResult<CallOffExport> }
  | { id: number; kind: 'masterdata'; result: MasterResult }
  | { id: number; kind: 'coverage'; result: CoverageResult }
  | { id: number; kind: 'stock'; result: StockResult }
  | { id: number; kind: 'bom'; result: BomResult }
  | { id: number; kind: 'plan'; result: PlanResult }
  | { id: number; kind: 'planSettings'; result: PlanSettings }
  | { id: number; kind: 'oil'; result: OilResult }
  | { id: number; kind: 'kpi'; result: KpiResult }
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
    if (kind === 'oil') {
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, data: s.data as Cell[][] }));
      (self as unknown as Worker).postMessage({ id, kind, result: parseOilWorkbook(sheets) } satisfies ParseResponse);
      return;
    }
    if (kind === 'kpi') {
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, data: s.data as Cell[][] }));
      (self as unknown as Worker).postMessage({ id, kind, result: parseKpiWorkbook(sheets) } satisfies ParseResponse);
      return;
    }
    if (kind === 'plan' || kind === 'planSettings') {
      // Plán linky a nastavení kapacit: sešity s několika listy, které vytváří aplikace.
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, data: s.data as Cell[][] }));
      const response: ParseResponse = kind === 'plan' ? { id, kind, result: parsePlanWorkbook(sheets, name) } : { id, kind, result: parseSettings(sheets) };
      (self as unknown as Worker).postMessage(response);
      return;
    }
    if (kind === 'bom') {
      // Kusovník: všechny listy sešitu (např. list na projekt), záhlaví může být o pár řádků níž.
      const sheets = format === 'csv' ? [(({ header, rows }) => [header, ...rows])(parseCsv(decodeText(buffer)))] : (await readXlsxFile(buffer)).map((s) => s.data as Cell[][]);
      const results = sheets.map(parseBom);
      const ok = results.flatMap((r) => (r.ok ? [r.value] : []));
      const result: BomResult = ok.length === 0 ? results[0]! : { ok: true, value: mergeBoms(ok) };
      (self as unknown as Worker).postMessage({ id, kind, result } satisfies ParseResponse);
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
    if (kind === 'masterdata' && format !== 'csv') {
      // Mapování: první list, nebo listy FG / SFG / PG (+ list se sloupcem Item Type) ze šablony.
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, table: toTable(s.data as Cell[][]) }));
      (self as unknown as Worker).postMessage({ id, kind, result: parseMasterWorkbook(sheets) } satisfies ParseResponse);
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
