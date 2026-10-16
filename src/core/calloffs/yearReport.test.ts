import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { parseMasterData } from '../masterdata';
import { EMPTY_FILTER } from './filter';
import { parseCallOffExport, type CallOffExport } from './parse';
import { buildYearReport, type YearReportLabels } from './yearReport';

function exportOf(name: string, rows: [string, string, number, number][]): CallOffExport {
  const lines = rows.map(([i, d, q, shipped]) => `${i},${d},${q},${shipped + q},${shipped},SO1,1,X`);
  const text = ['Item Number,Date,Discrete Qty,Cumulative Qty,Cum Shipped,Sales Order,Line,Ship-To', ...lines].join('\n');
  const r = parseCallOffExport(parseCsv(text), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const labels: YearReportLabels = {
  sheets: { summary: 'Souhrn', demand: 'Požadováno', shipped: 'Odesláno', difference: 'Rozdíl' },
  week: 'Týden',
  source: 'Export',
  demand: 'Požadováno',
  shipped: 'Odesláno',
  difference: 'Rozdíl',
  fulfillment: 'Plnění',
  outlook: 'výhled',
  total: 'Celkem',
  item: 'Díl',
  description: 'Popis',
  project: 'Projekt',
  category: 'Kategorie',
  side: 'Strana',
  variant: 'Varianta',
  notes: ['Poznámka'],
};

const cw51 = exportOf('CW51.csv', [
  ['A', '14.12.2026', 100, 1000],
  ['B', '15.12.2026', 10, 0],
]);
const cw52 = exportOf('CW52.csv', [
  ['A', '21.12.2026', 80, 1090],
  ['A', '28.12.2026', 60, 1090],
  ['A', '04.01.2027', 50, 1090], // příští rok, do přehledu nepatří
]);

describe('buildYearReport', () => {
  const report = buildYearReport([cw51, cw52], undefined, EMPTY_FILTER, labels)!;
  const [summary, demand, shipped, difference] = report.sheets;

  it('souhrn po týdnech s výhledem do konce roku', () => {
    expect(report.year).toBe(2026);
    expect(summary!.header).toEqual(['Týden', 'CW 51', 'CW 52', 'CW 53 (výhled)', 'Celkem']);
    expect(summary!.rows[0]).toEqual(['Export', 'CW 51/2026', 'CW 52/2026', 'CW 52/2026', null]);
    expect(summary!.rows[1]).toEqual(['Požadováno', 110, 80, 60, 250]);
    expect(summary!.rows[2]).toEqual(['Odesláno', 90, null, null, 90]);
    expect(summary!.rows[3]).toEqual(['Rozdíl', -20, null, null, -20]);
    expect(summary!.rows[4]).toEqual(['Plnění %', 81.8, null, null, 81.8]);
    expect(summary!.rows.at(-1)).toEqual(['Poznámka']);
  });

  it('listy po dílech', () => {
    expect(demand!.name).toBe('Požadováno');
    expect(demand!.rows).toEqual([
      ['A', '', '', '', '', '', 100, 80, 60, 240],
      ['B', '', '', '', '', '', 10, 0, 0, 10],
    ]);
    // Díl B v exportu CW52 chybí, odeslané množství neznáme.
    expect(shipped!.rows.map((r) => r.slice(6))).toEqual([
      [90, null, null, 90],
      [null, null, null, null],
    ]);
    expect(difference!.rows[0]!.slice(6)).toEqual([-10, null, null, -10]);
  });

  it('respektuje filtr a kmenová data', () => {
    const master = parseMasterData(parseCsv('Item Number;Projekt;Kategorie;Strana;Varianta\nA;P1;DP;LHD;SR2'));
    if (!master.ok) throw new Error();
    const filtered = buildYearReport([cw51, cw52], master.value.items, { ...EMPTY_FILTER, side: 'LHD' }, labels)!;
    expect(filtered.sheets[1]!.header.slice(0, 6)).toEqual(['Díl', 'Popis', 'Projekt', 'Kategorie', 'Strana', 'Varianta']);
    expect(filtered.sheets[1]!.rows.map((r) => r.slice(0, 6))).toEqual([['A', '', 'P1', 'DP', 'LHD', 'SR2']]);
  });

  it('bez exportů nic', () => {
    expect(buildYearReport([], undefined, EMPTY_FILTER, labels)).toBeNull();
  });
});
