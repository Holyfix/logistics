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
    ['MBOM_ASSY_PANEL_P100.xlsx', 'bom'],
    ['Kusovník/panel.xlsx', 'bom'],
    ['BOM/P100.csv', 'bom'],
    ['Sklad/export.xlsx', 'stock'],
    ['Logistics/stock/2026-10-13.csv', 'stock'],
    ['Coverage/Lokalita A/P100/Stock.xlsx', 'coverage'],
    ['Odvolávky_CW42.pdf', 'ignored'],
    ['Plán/Kapacity.xlsx', 'planSettings'],
    ['Logistics/Plan/ASSEMBLY_P100.xlsx', 'plan'],
    ['OIL/OIL.xlsx', 'oil'],
    ['Logistics/oil/body.xlsx', 'oil'],
    ['OIL_logistika.xlsx', 'oil'],
    ['KPI/KPI.xlsx', 'kpi'],
    ['Transit/Transit.xlsx', 'transit'],
    ['Transit_19.10.csv', 'transit'],
    ['KPI_logistika.xlsx', 'kpi'],
    ['OIL/OIL.csv', 'ignored'],
    ['Plán/poznamky.csv', 'ignored'],
    ['Plán/~$ASSEMBLY_P100.xlsx', 'ignored'],
  ])('%s → %s', (path, kind) => expect(classifyPath(path)).toBe(kind));
});

describe('coverageScope', () => {
  it('závod a projekt podle složek', () => {
    expect(coverageScope('Logistics/Coverage/Lokalita A/P100/report.xlsx')).toEqual({ location: 'Lokalita A', project: 'P100' });
    expect(coverageScope('Coverage/Lokalita B/report.xlsx')).toEqual({ location: 'Lokalita B', project: '' });
    expect(coverageScope('Coverage/report.xlsx')).toEqual({ location: '', project: '' });
  });
});
