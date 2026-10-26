import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { buildCompareRows, buildMatrix, compareItems, comparePeriods } from './compare';
import { parseCallOffExport, type CallOffExport } from './parse';

function exportOf(name: string, rows: [string, string, number][]): CallOffExport {
  const text = ['Item Number,Item Description,Date,Discrete Qty', ...rows.map(([i, d, q]) => `${i},${i} ${name},${d},${q}`)].join('\n');
  const r = parseCallOffExport(parseCsv(text), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const cw40 = exportOf('CW40.csv', [
  ['A', '28.09.2026', 100],
  ['A', '05.10.2026', 100],
  ['A', '12.10.2026', 100],
  ['B', '13.10.2026', 40],
]);
const cw41 = exportOf('CW41.csv', [
  ['A', '05.10.2026', 110],
  ['A', '12.10.2026', 90],
  ['A', '19.10.2026', 100],
  ['B', '13.10.2026', 40],
]);
const cw42 = exportOf('CW42.csv', [
  ['A', '12.10.2026', 60],
  ['A', '19.10.2026', 100],
  ['A', '26.10.2026', 100],
  ['C', '20.10.2026', 5],
]);

describe('comparePeriods', () => {
  it('týdny obsažené v obou exportech', () => {
    expect(comparePeriods(cw40, cw42, 'all').map((p) => p.label)).toEqual(['CW 42']);
    expect(comparePeriods(cw41, cw42, 'all').map((p) => p.label)).toEqual(['CW 42', 'CW 43']);
    expect(comparePeriods(cw41, cw42, 1)).toHaveLength(1);
  });
});

describe('buildCompareRows', () => {
  it('součty, rozdíl a řazení podle velikosti změny', () => {
    const { items, descriptions } = compareItems(cw41, cw42);
    expect(items).toEqual(['A', 'B', 'C']);
    expect(descriptions).toEqual(['A CW42.csv', 'B CW41.csv', 'C CW42.csv']);
    const rows = buildCompareRows(cw41, cw42, items, descriptions, comparePeriods(cw41, cw42, 'all'));
    expect(rows.map((r) => r.item)).toEqual(['B', 'A', 'C']);
    expect(rows[0]).toMatchObject({ older: [40, 0], newer: [0, 0], diff: -40, percent: -100 });
    expect(rows[1]).toMatchObject({ older: [90, 100], newer: [60, 100], olderTotal: 190, newerTotal: 160, diff: -30 });
    expect(rows[2]).toMatchObject({ diff: 5, percent: null });
  });
});

describe('buildMatrix', () => {
  it('řádky jsou všechny exporty, sloupce všechny týdny od nejstaršího exportu', () => {
    const m = buildMatrix([cw40, cw41, cw42], ['A', 'B', 'C']);
    expect(m.exports).toEqual([cw40, cw41, cw42]);
    expect(m.periods.map((p) => p.label)).toEqual(['CW 40', 'CW 41', 'CW 42', 'CW 43', 'CW 44']);
    expect(m.values).toEqual([
      [100, 100, 140, null, null],
      [null, 110, 130, 100, null],
      [null, null, 60, 105, 100],
    ]);
  });

  it('export bez řádků se vynechá', () => {
    const empty = { ...cw41, items: [] } as CallOffExport;
    const m = buildMatrix([cw40, empty], ['A']);
    expect(m.exports).toEqual([cw40]);
    expect(m.periods.map((p) => p.label)).toEqual(['CW 40', 'CW 41', 'CW 42']);
  });
});
