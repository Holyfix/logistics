import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { dayFromParts, dayToIso } from '../dates';
import { parseMasterData } from '../masterdata';
import type { Cell } from '../table';
import { buildCoverage, coverageOptions, EMPTY_COVERAGE_FILTER, filterCoverage, shortage, summarizeBySide, type CoverageLine, type CoverageSource } from './compute';
import { parseCoverageWorkbook } from './parse';

const d = (day: number) => new Date(Date.UTC(2026, 9, day));
const block = ['Disposable Stock', 'Demand', 'In\r\nTransit', 'Stock End of the Day'];
const fixed = ['Customer Item Number', 'Customer Item Number 2', 'Supplier', 'Item number', 'Item description', 'First\r\nuncovered\r\nIB-Plan', 'First uncovered Prod No', 'Further stock in transit', 'Delivery\r\nnotes\r\nin transit', 'QHold', 'Open Orders', 'Stock in Lokalita 07:00'];
const pad = (n: number) => Array<Cell>(n).fill(null);

/** Smyšlený soubor ve formátu „Coverage Report Overview“ (dny 13., 14. a 16. 10.). */
const overview: Cell[][] = [
  [...pad(fixed.length), d(13), null, null, null, d(14), null, null, null, d(16), null, null, null],
  [...fixed, ...block, ...block, ...block],
  // díl, sklad 20, otevřené objednávky 2, poptávka 8/10/9, transit 5 první den; konečný stav je vzorec bez transitu
  ['A1234567890      0001', 'A1234567890-0001', null, null, 'ASSY DOOR LHD', new Date(Date.UTC(2026, 9, 14, 9, 59, 59, 990)), '0870001', null, null, 0, 2, 20, 18, 8, 5, 10, 10, 10, null, 0, 0, 9, null, -9],
  ['A1234567890      0002', 'A1234567890-0002', null, null, 'ASSY DOOR RHD', null, null, null, null, 0, 0, 50, 50, 5, null, 45, 45, 5, null, 40, 40, 5, null, 35],
  [null, null, null, null, null, null, null, null, null, null, null, null],
];

describe('parseCoverageWorkbook', () => {
  it('formát Coverage Report Overview: zůstatek bez transitu ze skladu a poptávky', () => {
    const r = parseCoverageWorkbook([
      { name: 'Info', data: [['Report'], ['x']] },
      { name: 'Coverage Report Overview', data: overview },
    ]);
    if (!r.ok) throw new Error();
    expect(r.value.format).toBe('overview');
    expect(r.value.days.map(dayToIso)).toEqual(['2026-10-13', '2026-10-14', '2026-10-16']);
    expect(r.value.rows).toHaveLength(2);
    expect(r.value.rows[0]).toEqual({
      customerNumber: 'A1234567890      0001',
      customerKey: 'A12345678900001',
      supplierItem: '',
      description: 'ASSY DOOR LHD',
      customerStock: 18,
      balance: [10, 0, -9],
      transit: [5, 5, 5],
      firstUncovered: '0870001',
      uncoveredAt: '2026-10-14T10:00',
    });
  });

  it('formát articles: stav dne obsahuje transit, odečte se; pomocné řádky a prázdné dny se vynechají', () => {
    const header = ['Site', 'Client', 'Supplier', 'Customer Item', 'Item number', 'Item description', 'Stock', 'First uncovered IB-Plan', 'First uncovered Prod No', 'Further stock in transit', 'Stock in transit', 'Delivery notes in transit', '2026.10.13', '2026.10.14', '2026.10.15', '2025.12.22'];
    const r = parseCoverageWorkbook([
      {
        name: 'articles',
        data: [
          header,
          // sklad 20, transit 5 + 1; stav včetně transitu 20, 14, 8 → bez transitu 14, 8, 2
          ['S1', 'X', '1', 'A1234567890      0001', '900100', 'DOOR LHD', 20, '2026.10.14 06:05', 5700001, 1, 5, null, 20, 14, 8, null],
          ['S1', 'X', '1', 'A1234567890      0002', '900101', 'DOOR RHD', 10, null, null, null, 0, null, 9, null, 3, null],
          [null, null, null, null, null, null, null, null, null, null, null, null, 4, 9, 15, null],
        ],
      },
    ]);
    if (!r.ok) throw new Error();
    expect(r.value.format).toBe('articles');
    expect(r.value.days.map(dayToIso)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
    expect(r.value.rows).toHaveLength(2);
    expect(r.value.rows[0]).toEqual({
      customerNumber: 'A1234567890      0001',
      customerKey: 'A12345678900001',
      supplierItem: '900100',
      description: 'DOOR LHD',
      customerStock: 20,
      balance: [14, 8, 2],
      transit: [6, 6, 6],
      firstUncovered: '5700001',
      uncoveredAt: '2026-10-14T06:05',
    });
    // prázdný den převezme předchozí stav
    expect(r.value.rows[1]!.balance).toEqual([9, 9, 3]);
  });

  it('formát bestand: stav bez transitu, jen řádky klienta z hlavičky souboru', () => {
    const r = parseCoverageWorkbook([
      {
        name: 'bestand',
        data: [
          [null, 'KLIENT:', 'Klient A'],
          [null, 'Čas:', '2026-10-13 06:54:44'],
          [],
          ['KUNDE', 'ARTIKEL', 'SACHNUMMER', 'BEZEICHNUNG', 'Bestand', 'False', 'Avisiert', 'Gesperrt', 'Erste Fehlende', 'PlanZeit', d(13), d(14), d(15)],
          ['KLIENT A', '900100', 'A1234567890  00000001', 'DOOR LHD', 30, 0, 12, 1, 4700001, new Date(Date.UTC(2026, 9, 14, 8, 28)), 20, 5, -10],
          ['Klient B', '800100', 'A9999999999  00000001', 'CIZÍ DÍL', 5, 0, 0, 0, null, null, 5, 5, 5],
          ['Klient A', '900101', 'A1234567890  00000002', 'DOOR RHD', 3, 0, 0, 0, null, null, 3, null, 3],
        ],
      },
    ]);
    if (!r.ok) throw new Error();
    expect(r.value.format).toBe('bestand');
    expect(r.value.days.map(dayToIso)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
    expect(r.value.rows.map((row) => row.supplierItem)).toEqual(['900100', '900101']);
    expect(r.value.rows[0]).toEqual({
      customerNumber: 'A1234567890  00000001',
      customerKey: 'A12345678900001',
      supplierItem: '900100',
      description: 'DOOR LHD',
      customerStock: 30,
      balance: [20, 5, -10],
      transit: [12, 12, 12],
      firstUncovered: '4700001',
      uncoveredAt: '2026-10-14T08:28',
    });
    expect(r.value.rows[1]!.balance).toEqual([3, 3, 3]);
  });

  it('stejný díl víckrát v souboru se sečte', () => {
    const header = ['Customer Item', 'Item number', 'Item description', 'Stock', 'First uncovered IB-Plan', 'First uncovered Prod No', 'Stock in transit', '2026.10.13', '2026.10.14'];
    const r = parseCoverageWorkbook([
      {
        name: 'articles',
        data: [
          header,
          ['A1234567890      0001', '900100', 'DOOR LHD', 7, '2026.10.20 08:37', 6300001, 0, 4, 2],
          ['A1234567890      0002', '900101', 'DOOR RHD', 5, null, null, 0, 5, 5],
          ['A1234567890      0001', '900100', 'DOOR LHD JINÝ POPIS', 1, null, null, 2, 3, 3],
        ],
      },
    ]);
    if (!r.ok) throw new Error();
    expect(r.value.rows).toHaveLength(2);
    expect(r.value.rows[0]).toMatchObject({ description: 'DOOR LHD', customerStock: 8, balance: [5, 3], transit: [2, 2], uncoveredAt: '2026-10-20T08:37' });
  });

  it('neznámý formát', () => {
    expect(parseCoverageWorkbook([{ name: 'List1', data: [['A', 'B'], [1, 2]] }])).toEqual({ ok: false, error: 'unknownFormat' });
  });
});

describe('buildCoverage', () => {
  const parsed = parseCoverageWorkbook([{ name: 'Coverage Report Overview', data: overview }]);
  if (!parsed.ok) throw new Error();
  const source: CoverageSource = { path: 'Coverage/Lokalita A/P100/r.xlsx', fileName: 'r.xlsx', location: 'Lokalita A', project: 'P100', lastModified: 0, report: parsed.value };
  const master = parseMasterData(parseCsv('Item Number;Customer Number;Description;Variant;Project\n900100;A1234567890  00000001;DOOR LHD;LHD HUD;P1'));
  if (!master.ok) throw new Error();

  it('spojí s mapováním a doplní víkend posledním stavem', () => {
    const t = buildCoverage([source], master.value, { transit: false });
    expect(t.days.map(dayToIso)).toEqual(['2026-10-13', '2026-10-14', '2026-10-16']);
    expect(t.lines[0]).toMatchObject({ item: '900100', project: 'P1', variant: 'LHD HUD', side: 'LHD', description: 'DOOR LHD', values: [10, 0, -9] });
    // díl bez mapování: číslo zákazníka a popis ze souboru (pro identifikaci), projekt prázdný – složka se nepoužije
    expect(t.lines[1]).toMatchObject({ item: '', project: '', description: 'ASSY DOOR RHD', values: [45, 40, 35] });
  });

  it('popis jen z mapování: díl v mapování bez popisu ho nemá (ne ze souboru)', () => {
    const noDesc = parseMasterData(parseCsv('Item Number;Customer Number;Project\n900100;A1234567890  00000001;P1'));
    if (!noDesc.ok) throw new Error();
    expect(buildCoverage([source], noDesc.value, { transit: false }).lines[0]!.description).toBe('');
  });

  it('číslo zákazníka v jednotném zápisu bez doplňujících nul, zápis ze souboru zůstane', () => {
    const t = buildCoverage([source], master.value, { transit: false });
    expect(t.lines.map((l) => [l.customerNumber, l.fileCustomerNumber])).toEqual([
      ['A1234567890 0001', 'A1234567890      0001'],
      ['A1234567890 0002', 'A1234567890      0002'],
    ]);
  });

  it('náš sklad: sloupec vždy, ke dnům jen s volbou; díl bez mapování nemá sklad', () => {
    const stock = new Map([['900100', 25]]);
    const off = buildCoverage([source], master.value, { transit: false }, stock);
    expect(off.lines.map((l) => l.ourStock)).toEqual([25, null]);
    expect(off.lines[0]!.values).toEqual([10, 0, -9]);
    const on = buildCoverage([source], master.value, { transit: true, ourStock: true }, stock);
    expect(on.lines[0]!.values).toEqual([40, 30, 21]);
    expect(on.lines[1]!.values).toEqual([45, 40, 35]);
    // bez souboru skladu není co přičíst
    expect(buildCoverage([source], master.value, { transit: false, ourStock: true }).lines[0]).toMatchObject({ ourStock: null, values: [10, 0, -9] });
  });

  it('transit podle přepínače', () => {
    const t = buildCoverage([source], master.value, { transit: true });
    expect(t.lines[0]!.values).toEqual([15, 5, -4]);
    expect(t.lines[0]!.transit).toBe(5);
  });

  it('dny mimo horizont souboru jsou prázdné a víkend bere poslední stav', () => {
    const shorter: CoverageSource = { ...source, path: 'b', report: { ...parsed.value, days: [dayFromParts(2026, 10, 12)!], rows: [{ ...parsed.value.rows[1]!, balance: [7], transit: [0] }] } };
    const t = buildCoverage([source, shorter], undefined, { transit: false });
    expect(t.days.map(dayToIso)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-16']);
    expect(t.lines.find((l) => l.id === 'b|0|A12345678900002')!.values).toEqual([7, null, null, null]);
    expect(t.lines[0]!.values).toEqual([null, 10, 0, -9]);
  });

  it('filtry: záporné kdykoli a k datu, strana a varianta, hledání', () => {
    const t = buildCoverage([source], master.value, { transit: false });
    const ids = (f: Partial<typeof EMPTY_COVERAGE_FILTER>) => filterCoverage(t, { ...EMPTY_COVERAGE_FILTER, ...f }).map((l) => l.item || l.customerNumber);
    expect(ids({})).toHaveLength(2);
    expect(ids({ rows: { kind: 'negativeAny' } })).toEqual(['900100']);
    expect(ids({ rows: { kind: 'negativeOn', day: t.days[1]! } })).toEqual([]);
    expect(ids({ rows: { kind: 'negativeOn', day: t.days[2]! } })).toEqual(['900100']);
    expect(ids({ variant: 'LHD HUD' })).toEqual(['900100']);
    expect(ids({ side: 'LHD' })).toEqual(['900100']);
    expect(ids({ query: 'rhd' })).toEqual(['A1234567890 0002']);
    // hledá se v jednotném zápisu, bez mezer i podle zápisu ze souboru
    expect(ids({ query: 'a1234567890 0001' })).toEqual(['900100']);
    expect(ids({ query: 'A12345678900001' })).toEqual(['900100']);
    expect(ids({ query: '      0001' })).toEqual(['900100']);
    expect(coverageOptions(t)).toEqual({ locations: ['Lokalita A'], projects: ['P1'], categories: [], sides: ['LHD'], variants: ['LHD HUD'], unmapped: 1 });
  });

  it('souhrn po stranách', () => {
    const t = buildCoverage([source], master.value, { transit: false });
    expect(summarizeBySide(t.days, t.lines)).toEqual([
      { side: 'LHD', values: [10, 0, -9] },
      { side: '', values: [45, 40, 35] },
    ]);
  });
});

describe('shortage', () => {
  const line = (values: (number | null)[]) => ({ values }) as CoverageLine;
  it('nejhorší záporný stav v prvních dnech, sečteno přes díly', () => {
    const lines = [line([5, -3, -20]), line([-4, -1, 0]), line([2, 1, -9]), line([null, -2, null])];
    expect(shortage(lines, 2)).toEqual({ pieces: 9, parts: 3 });
    expect(shortage(lines, 3)).toEqual({ pieces: 35, parts: 4 });
    expect(shortage([], 2)).toEqual({ pieces: 0, parts: 0 });
  });
});

describe('navazující filtry', () => {
  const line = (id: string, location: string, project: string, category: string, side = '', variant = '') =>
    ({ id, location, project, item: id, customerNumber: '', fileCustomerNumber: '', description: '', variant, side, category, customerStock: 0, transit: 0, ourStock: null, firstUncovered: '', uncoveredAt: '', values: [1] }) as CoverageLine;
  const t = {
    days: [dayFromParts(2026, 10, 12)!],
    lines: [line('A', 'L1', 'P1', 'DP', 'LHD', 'SR2'), line('B', 'L1', 'P1', 'DP', 'RHD'), line('C', 'L1', 'P1', 'IP'), line('D', 'L2', 'P2', 'HB', 'LHD')],
  };

  it('díly podle kategorie z mapování', () => {
    expect(filterCoverage(t, { ...EMPTY_COVERAGE_FILTER, category: 'HB' }).map((l) => l.item)).toEqual(['D']);
    expect(coverageOptions(t).categories).toEqual(['DP', 'HB', 'IP']);
  });

  it('nabídka podle filtrů před ní; kategorie bez stran nenabídne stranu', () => {
    expect(coverageOptions(t, { ...EMPTY_COVERAGE_FILTER, location: 'L1' })).toMatchObject({ projects: ['P1'], categories: ['DP', 'IP'], sides: ['LHD', 'RHD'], variants: ['SR2'] });
    expect(coverageOptions(t, { ...EMPTY_COVERAGE_FILTER, project: 'P1', category: 'IP' })).toMatchObject({ sides: [], variants: [] });
  });

  it('i obráceně: kategorie nebo strana zúží destinace a projekty', () => {
    expect(coverageOptions(t, { ...EMPTY_COVERAGE_FILTER, category: 'HB' })).toMatchObject({ locations: ['L2'], projects: ['P2'], categories: ['DP', 'HB', 'IP'], sides: ['LHD'], variants: [] });
    expect(coverageOptions(t, { ...EMPTY_COVERAGE_FILTER, side: 'RHD' })).toMatchObject({ locations: ['L1'], projects: ['P1'], categories: ['DP'] });
    // vybraný projekt nabízí jen svoje destinace
    expect(coverageOptions(t, { ...EMPTY_COVERAGE_FILTER, project: 'P1' }).locations).toEqual(['L1']);
  });
});
