import { describe, expect, it } from 'vitest';
import type { MasterItem } from '../masterdata';
import { EMPTY_FILTER, filterItems, filterOptions, MISSING_MASTER } from './filter';

const m = (item: string, project: string, category: string, side: string, variant = ''): [string, MasterItem] => [item, { item, project, category, side, variant } as MasterItem];
const master = new Map([m('1', 'P100', 'DP', 'LHD', 'SR2'), m('2', 'P100', 'DP', 'RHD'), m('3', 'P100', 'IP', ''), m('5', 'P300', 'HB', 'LHD', 'BASIS')]);
const items = ['1', '2', '3', '4', '5'];
const desc = ['DOOR', 'DOOR', 'IP', 'GLOVEBOX', 'BOX'];

describe('filterItems', () => {
  it('filtruje podle kmenových dat a textu', () => {
    expect(filterItems(items, desc, master, EMPTY_FILTER)).toEqual(items);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, project: 'P100' })).toEqual(['1', '2', '3']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, side: 'LHD' })).toEqual(['1', '5']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, category: 'DP', side: 'RHD' })).toEqual(['2']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, variant: 'SR2' })).toEqual(['1']);
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, query: 'door' })).toEqual(['1', '2']);
    // díly bez mapování jako volba filtru Projekt
    expect(filterItems(items, desc, master, { ...EMPTY_FILTER, project: MISSING_MASTER })).toEqual(['4']);
  });

});

describe('filterOptions', () => {
  it('nabídne jen hodnoty dílů z exportu a spočítá chybějící', () => {
    expect(filterOptions(items, master)).toEqual({ projects: ['P100', 'P300'], categories: ['DP', 'HB', 'IP'], sides: ['LHD', 'RHD'], variants: ['BASIS', 'SR2'], missing: 1 });
    expect(filterOptions(['1'], undefined).missing).toBe(1);
  });

  it('navazující: kategorie projektu, strany kategorie; kategorie bez stran nenabídne stranu', () => {
    expect(filterOptions(items, master, { ...EMPTY_FILTER, project: 'P100' })).toMatchObject({ projects: ['P100', 'P300'], categories: ['DP', 'IP'], sides: ['LHD', 'RHD'], variants: ['SR2'] });
    expect(filterOptions(items, master, { ...EMPTY_FILTER, project: 'P100', category: 'IP' })).toMatchObject({ sides: [], variants: [] });
    expect(filterOptions(items, master, { ...EMPTY_FILTER, project: 'P100', category: 'DP', side: 'RHD' }).variants).toEqual([]);
  });

  it('i obráceně: vybraná kategorie, strana nebo varianta zúží ostatní filtry', () => {
    // kategorie DP jen v P100, jen strany LHD/RHD
    expect(filterOptions(items, master, { ...EMPTY_FILTER, category: 'DP' })).toMatchObject({ projects: ['P100'], categories: ['DP', 'HB', 'IP'], sides: ['LHD', 'RHD'], variants: ['SR2'] });
    // varianta BASIS jen v P300 / HB / LHD
    expect(filterOptions(items, master, { ...EMPTY_FILTER, variant: 'BASIS' })).toMatchObject({ projects: ['P300'], categories: ['HB'], sides: ['LHD'], variants: ['BASIS', 'SR2'] });
    // strana RHD: projekt P100, kategorie DP
    expect(filterOptions(items, master, { ...EMPTY_FILTER, side: 'RHD' })).toMatchObject({ projects: ['P100'], categories: ['DP'], variants: [] });
    // díly bez mapování: ostatní filtry nic nenabízí, projekty ano
    expect(filterOptions(items, master, { ...EMPTY_FILTER, project: MISSING_MASTER })).toMatchObject({ projects: ['P100', 'P300'], categories: [], sides: [] });
  });
});
