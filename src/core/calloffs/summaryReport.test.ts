import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import type { MasterItem } from '../masterdata';
import { summarize, visibleNodes } from './summary';
import { summaryReport, type ReportCell, type ReportTexts } from './summaryReport';
import type { CurrentRow, Period } from './views';

const m = (item: string, project: string, category: string, side: string) => [item, { item, project, category, side } as MasterItem] as const;
const master = new Map([m('1', 'P1', 'DP', 'LHD'), m('2', 'P1', 'DP', 'RHD'), m('3', 'P2', 'HB', 'LHD')]);
const row = (item: string, values: number[], previous: (number | null)[]): CurrentRow => ({ item, description: `popis ${item}`, values, previous, total: values.reduce((a, b) => a + b, 0) });
const monday = dayFromParts(2026, 10, 12)!;
const periods: Period[] = [
  { start: monday, end: monday + 6, label: 'CW 42' },
  { start: monday + 7, end: monday + 13, label: 'CW 43' },
];
const texts: ReportTexts = {
  title: 'Titulek',
  subtitle: 'Podtitulek',
  filters: 'Filtry: žádné',
  note: 'Poznámka',
  tree: 'Strom',
  project: 'Projekt',
  category: 'Kategorie',
  side: 'Strana',
  variant: 'Varianta',
  item: 'Díl',
  description: 'Popis',
  total: 'Celkem',
  diff: 'Změna ks',
  diffPercent: 'Změna %',
  sum: 'Celkem',
  none: { project: 'bez projektu', category: 'bez kategorie', side: 'bez strany', variant: 'bez varianty' },
  sheetSummary: 'Přehled',
  sheetItems: 'Díly',
};
const values = (cells: (ReportCell | null)[] | undefined) => cells?.map((c) => c?.value);

describe('report přehledu pro vedení', () => {
  const rows = [row('3', [5, 5], [10, 5]), row('1', [10, 20], [10, 10]), row('2', [1, 2], [1, 2]), row('9', [3, 0], [3, 0])];
  const tree = summarize(rows, master);
  const [summary, items] = summaryReport(visibleNodes(tree, new Set([tree[0]!.key])), tree, rows, periods, master, texts);

  it('přehled: titulek, záhlaví s pondělky, strom ve zvolené úrovni a součet', () => {
    expect(summary!.name).toBe('Přehled');
    expect(values(summary!.data[0])?.[0]).toBe('Titulek');
    expect(summary!.data[0]![0]!.columnSpan).toBe(6);
    expect(values(summary!.data[4])).toEqual(['Strom', 'CW 42', 'CW 43', 'Celkem', 'Změna ks', 'Změna %']);
    expect(values(summary!.data[5])).toEqual(['', '12.10.', '19.10.', '', '', '']);
    const body = summary!.data.slice(6, 11);
    expect(body.map((r) => values(r)?.slice(0, 4))).toEqual([
      ['P1', 11, 22, 33],
      ['DP', 11, 22, 33],
      ['P2', 5, 5, 10],
      ['bez projektu', 3, 0, 3],
      ['Celkem', 19, 27, 46],
    ]);
    expect(body[1]![0]).toMatchObject({ indent: 2, align: 'left' });
    expect(body[1]![0]!.fontWeight).toBeUndefined();
    expect(body[0]![0]!.fontWeight).toBe('bold');
    expect(body[3]![0]!.fontStyle).toBe('italic');
  });

  it('změna v kusech a v procentech proti předchozímu exportu, barevně', () => {
    const p1 = summary!.data[6]!;
    expect(p1[4]).toMatchObject({ value: 10, format: '+#,##0;-#,##0;0', textColor: '#006300' });
    expect(p1[5]!.value).toBeCloseTo(10 / 23);
    const p2 = summary!.data[8]!;
    expect(p2[4]).toMatchObject({ value: -5, textColor: '#B42D2D' });
    expect(p2[5]!.value).toBeCloseTo(-5 / 15);
    const total = summary!.data[10]!;
    expect(total[4]!.value).toBe(5);
    expect(total[5]!.value).toBeCloseTo(5 / 41);
    expect(p1[1]!.format).toBe('#,##0;-#,##0;"–"');
  });

  it('bez předchozího exportu je změna pomlčka', () => {
    const fresh = [row('1', [1, 1], [null, null])];
    const t = summarize(fresh, master);
    const [s] = summaryReport(t, t, fresh, periods, master, texts);
    expect(values(s!.data[6])?.slice(4)).toEqual(['—', '—']);
  });

  it('list dílů seřazený podle projektu, kategorie, strany, varianty a dílu', () => {
    expect(items!.name).toBe('Díly');
    expect(values(items!.data[4])?.slice(0, 7)).toEqual(['Projekt', 'Kategorie', 'Strana', 'Varianta', 'Díl', 'Popis', 'CW 42']);
    // strana a varianta prázdné, když je díl nemá
    expect(items!.data.slice(6).map((r) => values(r)?.slice(0, 5))).toEqual([
      ['P1', 'DP', 'LHD', '', '1'],
      ['P1', 'DP', 'RHD', '', '2'],
      ['P2', 'HB', 'LHD', '', '3'],
      ['bez projektu', 'bez kategorie', '', '', '9'],
    ]);
    expect(values(items!.data[6])?.slice(6)).toEqual([10, 20, 30, 10, 0.5]);
    expect(items!.stickyColumns).toBe(5);
  });
});
