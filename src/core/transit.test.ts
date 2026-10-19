import { describe, expect, it } from 'vitest';
import type { CoverageSource } from './coverage/compute';
import { buildCoverage } from './coverage/compute';
import { parseCsv } from './csv';
import { dayFromParts } from './dates';
import { parseMasterData } from './masterdata';
import { applyTransit, parseTransit } from './transit';

const day = (n: number) => dayFromParts(2026, 10, n)!;

// Smyšlený export transakcí z ERP: výdej na dodací list je záporný, datum jako datum, čas zvlášť.
const csv = [
  'Site,Item Number,Transaction Number,Transaction Type,Effective Date,Time,Quantity Change,Address,Shipper Number',
  '1000,FG-1,501,ISS-DO,19.10.2026,05:40,-256,1000DE,SD-1',
  '1000,FG-2,502,ISS-DO,19.10.2026,05:40,-144,1000DE,SD-1',
  '1000,FG-1,501,ISS-DO,19.10.2026,05:40,-256,1000DE,SD-1',
  '1000,FG-3,503,ISS-DO,10/19/26,05:41,-10,1000DE,SD-1',
  '1000,FG-9,504,ISS-DO,19.10.2026,05:41,-5,1000DE,SD-1',
  '1000,FG-1,505,ISS-DO,x,05:41,-5,1000DE,SD-1',
].join('\n');

const master = parseMasterData(parseCsv('Item Number;Customer Number;Description;Project;Item Type\nFG-1;C1;PANEL;P1;FG\nFG-2;C2;IP;P2;FG\nFG-3;C3;BOX;P3;FG\nFG-9;C9;OTHER;P9;FG'));
if (!master.ok) throw new Error();

const source = (location: string, first: number, customers: string[]): CoverageSource => ({
  path: `Coverage/${location}/x.xlsx`,
  fileName: 'x.xlsx',
  location,
  project: '',
  lastModified: 0,
  report: {
    format: 'overview',
    sheet: 'S',
    days: [day(first), day(first + 1)],
    rows: customers.map((c) => ({ customerNumber: c, customerKey: c, supplierItem: '', description: '', customerStock: 0, balance: [-100, -300], transit: [0, 50], firstUncovered: '', uncoveredAt: '' })),
    issueCount: 0,
    issues: [],
  },
});

describe('doplněný transit', () => {
  it('načte export transakcí: absolutní množství, den i ve formátu m/d/rr, chybné datum v problémech', () => {
    const r = parseTransit(parseCsv(csv));
    if (!r.ok) throw new Error();
    expect(r.value.rows.map((x) => [x.item, x.qty, x.day, x.time, x.shipment, x.destination, x.key])).toEqual([
      ['FG-1', 256, day(19), '05:40', 'SD-1', '1000DE', '501'],
      ['FG-2', 144, day(19), '05:40', 'SD-1', '1000DE', '502'],
      ['FG-1', 256, day(19), '05:40', 'SD-1', '1000DE', '501'],
      ['FG-3', 10, day(19), '05:41', 'SD-1', '1000DE', '503'],
      ['FG-9', 5, day(19), '05:41', 'SD-1', '1000DE', '504'],
    ]);
    expect(r.value.issues).toEqual([{ row: 7, column: 'Effective Date', value: 'x', message: 'invalidDate' }]);
    expect(parseTransit(parseCsv('Item Number;Quantity\nA;1'))).toEqual({ ok: false, error: 'missingColumns', columns: ['Effective Date'] });
  });

  it('přičte k transitu dílu v coverage; novější coverage, díl mimo coverage, víc souborů a duplicita se nepřičtou', () => {
    const r = parseTransit(parseCsv(csv));
    if (!r.ok) throw new Error();
    // FG-1 v coverage od 19. 10., FG-2 v coverage od 20. 10. (už expedici obsahuje), FG-3 ve dvou destinacích, FG-9 v žádné
    const sources = [source('A', 19, ['C1', 'C3']), source('B', 20, ['C2']), source('C', 19, ['C3'])];
    const { coverage, entries } = applyTransit(sources, master.value, [{ path: 'Transit/Transit.xlsx', data: r.value }]);
    expect(entries.map((e) => [e.row.item, e.status, e.location])).toEqual([
      ['FG-1', 'added', 'A'],
      ['FG-2', 'old', 'B'],
      ['FG-1', 'duplicate', 'A'],
      ['FG-3', 'ambiguous', ''],
      ['FG-9', 'noCoverage', ''],
    ]);
    expect(coverage[0]!.report.rows[0]!.transit).toEqual([256, 306]);
    expect(coverage[0]!.report.rows[1]!.transit).toEqual([0, 50]);
    expect(coverage[1]).toBe(sources[1]);
    // v tabulce coverage: transit včetně doplněného a stav dne s transitem
    const line = buildCoverage(coverage, master.value, { transit: true }).lines.find((l) => l.item === 'FG-1')!;
    expect([line.transit, line.extraTransit, line.values[0]]).toEqual([306, 256, 156]);
    expect(buildCoverage(coverage, master.value, { transit: false }).lines.find((l) => l.item === 'FG-1')!.values[0]).toBe(-100);
  });
});
