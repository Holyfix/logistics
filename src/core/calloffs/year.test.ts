import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { parseCallOffExport, type CallOffExport } from './parse';
import { buildYearRows, buildYearWeeks, exportYears, fulfillment, yearItems, yearTotals } from './year';

/** Export s jedním plánem na díl: [díl, datum, množství, kumulativ odeslaného]. */
function exportOf(name: string, rows: [string, string, number, number][]): CallOffExport {
  const lines = rows.map(([i, d, q, shipped]) => `${i},Popis ${i} ${name},${d},${q},${shipped + q},${shipped},SO1,1,X`);
  const text = ['Item Number,Item Description,Date,Discrete Qty,Cumulative Qty,Cum Shipped,Sales Order,Line,Ship-To', ...lines].join('\n');
  const r = parseCallOffExport(parseCsv(text), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const cw40 = exportOf('CW40.csv', [
  ['A', '28.09.2026', 100, 1000],
  ['A', '05.10.2026', 100, 1000],
  ['A', '12.10.2026', 100, 1000],
  ['B', '29.09.2026', 10, 50],
]);
const cw41 = exportOf('CW41.csv', [
  ['A', '05.10.2026', 120, 1090],
  ['A', '12.10.2026', 100, 1090],
  ['B', '06.10.2026', 5, 60],
]);
// CW42 chybí, CW43 je aktuální.
const cw43 = exportOf('CW43.csv', [
  ['A', '19.10.2026', 80, 1300],
  ['A', '26.10.2026', 90, 1300],
  ['A', '02.11.2026', 70, 1300],
  ['C', '20.10.2026', 1, 0],
]);
const exports = [cw40, cw41, cw43];

describe('buildYearWeeks', () => {
  const weeks = buildYearWeeks(exports, 2026, 1);

  it('týdny od prvního do posledního exportu a výhled', () => {
    expect(weeks.map((w) => w.label)).toEqual(['CW 40', 'CW 41', 'CW 42', 'CW 43', 'CW 44']);
    expect(weeks.map((w) => w.outlook)).toEqual([false, false, false, false, true]);
  });

  it('chybějící týden vezme požadavek ze staršího exportu', () => {
    expect(weeks[2]!.own).toBe(false);
    expect(weeks[2]!.source).toBe(cw41);
    expect(weeks[3]!.source).toBe(cw43);
  });

  it('odeslané jen mezi dvěma po sobě jdoucími exporty', () => {
    expect(weeks.map((w) => w.shipped !== null)).toEqual([true, false, false, false, false]);
  });

  it('rok bez exportů nemá týdny', () => {
    expect(buildYearWeeks(exports, 2025)).toEqual([]);
    expect(exportYears(exports)).toEqual([2026]);
  });
});

describe('buildYearRows', () => {
  const weeks = buildYearWeeks(exports, 2026);
  const { items, descriptions } = yearItems(weeks);

  it('sjednotí díly ze všech exportů a popis vezme z nejnovějšího', () => {
    expect(items).toEqual(['A', 'B', 'C']);
    expect(descriptions[0]).toBe('Popis A CW43.csv');
    expect(descriptions[1]).toBe('Popis B CW41.csv');
  });

  it('požadavek z exportu týdne a odeslané z rozdílu kumulativu', () => {
    const [a, b, c] = buildYearRows(weeks, items, descriptions);
    expect(a!.demand).toEqual([100, 120, 100, 80]);
    expect(a!.shipped).toEqual([90, null, null, null]);
    expect(b!.demand).toEqual([10, 5, 0, 0]);
    expect(b!.shipped).toEqual([10, null, null, null]);
    expect(c!.demand).toEqual([0, 0, 0, 1]);
    expect(c!.shipped).toEqual([0, null, null, null]);
  });

  it('součty a plnění jen za týdny se známým odesláním', () => {
    const rows = buildYearRows(weeks, items, descriptions);
    const totals = yearTotals(weeks, rows);
    expect(totals.demand).toEqual([110, 125, 100, 81]);
    expect(totals.shipped).toEqual([100, null, null, null]);
    expect(fulfillment(totals.demand, totals.shipped)).toBeCloseTo((100 / 110) * 100);
    expect(fulfillment([0], [null])).toBeNull();
  });

  it('pokles kumulativu nebo chybějící díl dá neznámé odeslání', () => {
    const later = exportOf('CW41.csv', [['A', '05.10.2026', 1, 10]]);
    const w = buildYearWeeks([cw40, later], 2026);
    const [a, b] = buildYearRows(w, ['A', 'B'], []);
    expect(a!.shipped[0]).toBeNull();
    expect(b!.shipped[0]).toBeNull();
  });

  it('bez kumulativů se odeslání nepočítá', () => {
    const plain = (name: string, date: string) => {
      const r = parseCallOffExport(parseCsv(`Item Number,Date,Discrete Qty\nA,${date},5`), name);
      if (!r.ok) throw new Error();
      return r.value;
    };
    const w = buildYearWeeks([plain('CW40.csv', '28.09.2026'), plain('CW41.csv', '05.10.2026')], 2026);
    expect(w[0]!.shipped).toBeNull();
  });
});
