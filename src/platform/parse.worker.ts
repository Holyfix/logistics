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
import { parseLaunchWorkbook, type LaunchResult } from '../core/launch';
import { parsePackagingWorkbook, type PackagingResult } from '../core/packaging';
import { dayFromParts } from '../core/dates';
import { parseAttendanceSheets, type AttendanceResult } from '../core/attendance';
import { decryptOffice, isEncryptedOffice, OfficeCryptoError } from '../core/officeCrypto';
import { parseSkillWorkbook, type SkillResult } from '../core/skills';
import { parseVacationWorkbook, type VacationResult } from '../core/vacations';
import { parseTransit, type TransitResult } from '../core/transit';
import { parseSequenceCsv, parseSequenceSheets, type SequenceFile } from '../core/material/sequence';
import { decodeText } from '../core/text';
import type { SourceFormat } from '../core/sources';
import type { Cell, DataTable } from '../core/table';

export type ParseRequest = { id: number; kind: 'calloffs' | 'masterdata' | 'coverage' | 'stock' | 'bom' | 'plan' | 'planSettings' | 'oil' | 'kpi' | 'launch' | 'packaging' | 'vacations' | 'skills' | 'attendance' | 'transit' | 'sequence'; format: SourceFormat; name: string; buffer: ArrayBuffer; password?: string };

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
  | { id: number; kind: 'launch'; result: LaunchResult }
  | { id: number; kind: 'packaging'; result: PackagingResult }
  | { id: number; kind: 'vacations'; result: VacationResult }
  | { id: number; kind: 'skills'; result: SkillResult }
  | { id: number; kind: 'attendance'; result: AttendanceResult | { ok: false; error: 'wrongPassword' | 'unsupported' | 'corrupt'; columns: string[] }; encrypted: boolean }
  | { id: number; kind: 'transit'; result: TransitResult }
  | { id: number; kind: 'sequence'; result: SequenceFile }
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
  const { id, kind, format, name, buffer, password } = event.data;
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
    if (kind === 'attendance') {
      // Export docházky: šifrovaný se rozšifruje heslem jen v paměti; špatné heslo nebo nepodporované šifrování se nahlásí.
      const encrypted = isEncryptedOffice(buffer);
      let plain = buffer;
      if (encrypted) {
        try {
          plain = await decryptOffice(buffer, password ?? '');
        } catch (error) {
          const code = error instanceof OfficeCryptoError && error.code !== 'notEncrypted' ? error.code : 'corrupt';
          (self as unknown as Worker).postMessage({ id, kind, encrypted, result: { ok: false, error: code, columns: [] } } satisfies ParseResponse);
          return;
        }
      }
      const sheets = (await readXlsxFile(plain)).map((s) => s.data as Cell[][]);
      (self as unknown as Worker).postMessage({ id, kind, encrypted, result: parseAttendanceSheets(sheets) } satisfies ParseResponse);
      return;
    }
    if (kind === 'vacations' || kind === 'skills') {
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, data: s.data as Cell[][] }));
      const response: ParseResponse = kind === 'vacations' ? { id, kind, result: parseVacationWorkbook(sheets) } : { id, kind, result: parseSkillWorkbook(sheets) };
      (self as unknown as Worker).postMessage(response);
      return;
    }
    if (kind === 'packaging') {
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, data: s.data as Cell[][] }));
      // Dnešek (místní) pro rok u termínů „16.11.“ a CW bez roku v checklistu.
      const now = new Date();
      const today = dayFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())!;
      (self as unknown as Worker).postMessage({ id, kind, result: parsePackagingWorkbook(sheets, today) } satisfies ParseResponse);
      return;
    }
    if (kind === 'launch') {
      const sheets = (await readXlsxFile(buffer)).map((s) => ({ name: s.sheet, data: s.data as Cell[][] }));
      (self as unknown as Worker).postMessage({ id, kind, result: parseLaunchWorkbook(sheets) } satisfies ParseResponse);
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
    if (kind === 'sequence') {
      // Sekvence: Order Status Matrix nebo klíč MC/MF (druh podle obsahu).
      const result = format === 'csv' ? parseSequenceCsv(decodeText(buffer)) : parseSequenceSheets((await readXlsxFile(buffer)).map((s) => s.data as Cell[][]));
      (self as unknown as Worker).postMessage({ id, kind, result } satisfies ParseResponse);
      return;
    }
    if (kind === 'bom') {
      // Kusovník: všechny listy sešitu (např. list na projekt), záhlaví může být o pár řádků níž.
      const sheets = format === 'csv' ? [(({ header, rows }) => [header, ...rows])(parseCsv(decodeText(buffer)))] : (await readXlsxFile(buffer)).map((s) => s.data as Cell[][]);
      const results = sheets.map((sheet) => parseBom(sheet));
      const ok = results.flatMap((r) => (r.ok ? [r.value] : []));
      const result: BomResult = ok.length === 0 ? results[0]! : { ok: true, value: mergeBoms(ok) };
      (self as unknown as Worker).postMessage({ id, kind, result } satisfies ParseResponse);
      return;
    }
    if (kind === 'stock' || kind === 'transit') {
      // Sklad a transit v Excelu: list „Data“, jinak první list.
      let table: DataTable;
      if (format === 'csv') table = parseCsv(decodeText(buffer));
      else {
        const sheets = await readXlsxFile(buffer);
        const sheet = sheets.find((s) => s.sheet.trim().toLowerCase() === 'data') ?? sheets[0];
        table = toTable((sheet?.data ?? []) as Cell[][]);
      }
      const response: ParseResponse = kind === 'stock' ? { id, kind, result: parseStock(table) } : { id, kind, result: parseTransit(table) };
      (self as unknown as Worker).postMessage(response);
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
        ? [result.value.offsets.buffer, result.value.days.buffer, result.value.qty.buffer, result.value.cumShipped.buffer]
        : [];
      (self as unknown as Worker).postMessage({ id, kind, result } satisfies ParseResponse, transfer);
    } else {
      (self as unknown as Worker).postMessage({ id, kind, result: parseMasterData(table) } satisfies ParseResponse);
    }
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) } satisfies ParseResponse);
  }
};
