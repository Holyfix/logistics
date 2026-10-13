import { describe, expect, it } from 'vitest';
import { classifyPath, coverageScope } from './sources';

describe('classifyPath', () => {
  it.each([
    ['Odvolávky_CW42.csv', 'calloffs'],
    ['odvolavky/export_42.csv', 'calloffs'],
    ['Call-offs/CW42.xlsx', 'calloffs'],
    ['kmenova-data.xlsx', 'masterdata'],
    ['Kmenová data dílů.csv', 'masterdata'],
    ['Mapping/Item_Mapping.xlsx', 'masterdata'],
    ['Logistics/Coverage/Lokalita A/P100/report.xlsx', 'coverage'],
    ['Coverage/Lokalita B/report.xlsm', 'coverage'],
    ['Coverage/poznamky.csv', 'ignored'],
    ['odvolavky/~$Odvolávky_CW42.xlsx', 'ignored'],
    ['zasoby/CW42.csv', 'ignored'],
    ['Stock_13.10.2026.csv', 'stock'],
    ['Settings.csv', 'settings'],
    ['Nastavení.xlsx', 'settings'],
    ['Sklad/export.xlsx', 'stock'],
    ['Logistics/stock/2026-10-13.csv', 'stock'],
    ['Coverage/Lokalita A/P100/Stock.xlsx', 'coverage'],
    ['Odvolávky_CW42.pdf', 'ignored'],
  ])('%s → %s', (path, kind) => expect(classifyPath(path)).toBe(kind));
});

describe('coverageScope', () => {
  it('závod a projekt podle složek', () => {
    expect(coverageScope('Logistics/Coverage/Lokalita A/P100/report.xlsx')).toEqual({ location: 'Lokalita A', project: 'P100' });
    expect(coverageScope('Coverage/Lokalita B/report.xlsx')).toEqual({ location: 'Lokalita B', project: '' });
    expect(coverageScope('Coverage/report.xlsx')).toEqual({ location: '', project: '' });
  });
});
