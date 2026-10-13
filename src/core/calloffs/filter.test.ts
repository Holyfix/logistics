import { describe, expect, it } from 'vitest';
import type { MasterItem } from '../masterdata';
import { EMPTY_FILTER, filterItems, filterOptions, MISSING_MASTER } from './filter';

const m = (item: string, customer: string, project: string, side: string): [string, MasterItem] => [
  item,
  { item, customerNumber: '', customerKey: '', description: '', variant: '', type: '', customer, project, side },
];
const master = new Map([m('1', 'A', 'P100', 'LHD'), m('2', 'A', 'P200', 'RHD'), m('3', 'B', 'P300', 'LHD')]);
const items = ['1', '2', '3', '4'];
const desc = ['DOOR', 'DOOR', 'IP', 'GLOVEBOX'];

describe('filterItems', () => {
  it('filtruje podle kmenových dat a textu', () => {
    expect(filterItems(items, desc, master, EMPTY_FILTER)).toEqual(items);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, customer: 'A' })).toEqual(['1', '2']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, side: 'LHD' })).toEqual(['1', '3']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, query: 'door' })).toEqual(['1', '2']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, customer: MISSING_MASTER })).toEqual(['4']);
  });
});

describe('filterOptions', () => {
  it('nabídne jen hodnoty dílů z exportu a spočítá chybějící', () => {
    expect(filterOptions(['1', '3', '4'], master)).toEqual({ customers: ['A', 'B'], projects: ['P100', 'P300'], sides: ['LHD'], missing: 1 });
    expect(filterOptions(['1'], undefined).missing).toBe(1);
  });
});
