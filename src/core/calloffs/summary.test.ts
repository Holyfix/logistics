import { describe, expect, it } from 'vitest';
import type { MasterItem } from '../masterdata';
import { summarize, visibleNodes } from './summary';
import type { CurrentRow } from './views';

const m = (item: string, project: string, category: string, side: string) => [item, { item, project, category, side } as MasterItem] as const;
const master = new Map([m('1', 'P1', 'DP', 'LHD'), m('2', 'P1', 'DP', 'RHD'), m('3', 'P1', 'HB', 'LHD'), m('4', 'P2', '', 'LHD')]);
const row = (item: string, values: number[], previous: (number | null)[], backlog = 0): CurrentRow => ({ item, description: '', values, previous, total: values.reduce((a, b) => a + b, 0), backlog });

describe('přehled po projektech', () => {
  const rows = [row('1', [10, 20], [10, 10], 5), row('2', [1, 2], [1, 2]), row('3', [100, 0], [50, null]), row('4', [7, 7], [7, 7]), row('5', [3, 3], [3, 3])];
  const tree = summarize(rows, master);

  it('projekt → kategorie → strana se součty po týdnech, bez údaje na konci', () => {
    expect(tree.map((n) => [n.label, n.items, n.values, n.total, n.backlog, n.diff])).toEqual([
      ['P1', 3, [111, 22], 133, 5, 60],
      ['P2', 1, [7, 7], 14, 0, 0],
      ['', 1, [3, 3], 6, 0, 0],
    ]);
    const p1 = tree[0]!;
    expect(p1.children.map((n) => [n.label, n.values])).toEqual([
      ['DP', [11, 22]],
      ['HB', [100, 0]],
    ]);
    expect(p1.children[0]!.children.map((n) => [n.level, n.label, n.values])).toEqual([
      [2, 'LHD', [10, 20]],
      [2, 'RHD', [1, 2]],
    ]);
  });

  it('rozbalené větve v pořadí tabulky', () => {
    const p1 = tree[0]!.key;
    expect(visibleNodes(tree, new Set()).map((n) => n.label)).toEqual(['P1', 'P2', '']);
    expect(visibleNodes(tree, new Set([p1])).map((n) => n.label)).toEqual(['P1', 'DP', 'HB', 'P2', '']);
  });

  it('bez předchozího exportu změna není', () => {
    expect(summarize([row('1', [1], [null])], master)[0]!.diff).toBeNull();
  });
});
