import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { dayToIso } from '../dates';
import { parseCallOffExport, type CallOffExport } from './parse';
import { buildCurrentRows, buildPeriods, changeOf } from './views';

function exportOf(name: string, rows: [string, string, number][]): CallOffExport {
  const text = ['Item Number,Date,Discrete Qty', ...rows.map(([i, d, q]) => `${i},${d},${q}`)].join('\n');
  const r = parseCallOffExport(parseCsv(text), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const prev = exportOf('CW41.csv', [
  ['A', '05.10.2026', 10],
  ['A', '12.10.2026', 100],
  ['A', '13.10.2026', 100],
  ['A', '19.10.2026', 50],
]);
const cur = exportOf('CW42.csv', [
  ['A', '12.10.2026', 100],
  ['A', '13.10.2026', 150],
  ['A', '17.10.2026', 7], // sobota s požadavkem
  ['A', '19.10.2026', 50],
  ['A', '26.10.2026', 40], // mimo horizont staršího exportu
  ['B', '14.10.2026', 3],
]);

describe('buildPeriods', () => {
  it('týdny začínají pondělím týdne exportu', () => {
    const periods = buildPeriods(cur, 'week', 10);
    expect(periods.map((p) => p.label)).toEqual(['CW 42', 'CW 43', 'CW 44']);
    expect(dayToIso(periods[0]!.start)).toBe('2026-10-12');
  });

  it('celý horizont a rok u týdnů z dalšího roku', () => {
    const exp = exportOf('CW52.csv', [
      ['A', '21.12.2026', 1],
      ['A', '04.01.2027', 2],
    ]);
    expect(buildPeriods(exp, 'week', 'all').map((p) => p.label)).toEqual(['CW 52', 'CW 53', 'CW 1/2027']);
    expect(buildPeriods(cur, 'week', 'all')).toHaveLength(3);
  });

  it('dny vynechají víkend bez požadavku', () => {
    const days = buildPeriods(cur, 'day', 7).map((p) => dayToIso(p.start));
    expect(days).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-19']);
  });
});

describe('buildCurrentRows', () => {
  it('sečte týdny a doplní hodnoty ze staršího exportu', () => {
    const [a, b] = buildCurrentRows(cur, prev, ['A', 'B'], buildPeriods(cur, 'week', 3));
    expect(a!.values).toEqual([257, 50, 40]);
    expect(a!.previous).toEqual([200, 50, null]);
    expect(a!.total).toBe(347);
    expect(b!.values).toEqual([3, 0, 0]);
  });

  it('díl, který v exportu není, má nuly', () => {
    const [x] = buildCurrentRows(cur, undefined, ['X'], buildPeriods(cur, 'week', 1));
    expect(x).toMatchObject({ values: [0], previous: [null], total: 0, description: '' });
  });
});

describe('changeOf', () => {
  it('rozliší významnou změnu', () => {
    expect(changeOf(120, 100)).toEqual({ diff: 20, percent: 20, significant: true });
    expect(changeOf(110, 100)).toEqual({ diff: 10, percent: 10, significant: false });
    expect(changeOf(5, 0)).toEqual({ diff: 5, percent: null, significant: true });
    expect(changeOf(100, 100)).toBeNull();
    expect(changeOf(100, null)).toBeNull();
  });
});
