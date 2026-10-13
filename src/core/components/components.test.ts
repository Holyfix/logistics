import { describe, expect, it } from 'vitest';
import { parseBom } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import type { CoverageReport } from '../coverage/parse';
import { parseCsv } from '../csv';
import { dayFromParts } from '../dates';
import { parseMasterData } from '../masterdata';
import { buildComponents, COMPONENT_DAYS, dailyDemand } from './compute';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const today = day(13);

const bom = parseBom([
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
  ['Parent', 'FG-1', 'PANEL LHD', null, 'EA', 'L'],
  ['1', 'SUB-1', 'INTERMEDIATE', 1, 'EA', 'L'],
  ['.2', 'CLIP-1', 'CLIP', 2, 'EA', 'P'],
  ['.2', 'RESIN', 'RESIN', 0.5, 'KG', 'P'],
  ['Parent', 'FG-2', 'PANEL RHD', null, 'EA', 'L'],
  ['1', 'CLIP-1', 'CLIP', 1, 'EA', 'P'],
]);
if (!bom.ok) throw new Error();

// FG-1 má soubor zákazníka na 13.–15. 10. (spotřeba 10, 0, 5); FG-2 jen odvolávky.
const report: CoverageReport = {
  format: 'articles',
  sheet: 's',
  days: [day(13), day(15)],
  rows: [{ customerNumber: 'C1', customerKey: 'C1', supplierItem: '', description: '', customerStock: 20, balance: [10, 5], transit: [0, 0], firstUncovered: '', uncoveredAt: '' }],
  issueCount: 0,
  issues: [],
};
const coverage: CoverageSource[] = [{ path: 'Coverage/A/P1/r.xlsx', fileName: 'r.xlsx', location: 'A', project: 'P1', lastModified: 0, report }];
const callOffs = {
  items: ['FG-1', 'FG-2'],
  offsets: Int32Array.from([0, 2, 4]),
  days: Int32Array.from([day(14), day(16), day(13), day(14)]),
  qty: Float64Array.from([99, 7, 3, 4]),
} as unknown as CallOffExport;

const mapping = (extra = '') =>
  parseMasterData(parseCsv(`Item Number;Customer Number;Description;Project${extra ? ';Component Coverage' : ''}\nFG-1;C1;PANEL LHD;P1${extra ? ';' : ''}\nCLIP-1;;CLIP;${extra ? ';Ano' : ''}\nSUB-1;;INTERMEDIATE;${extra ? ';' : ''}`));

describe('dailyDemand', () => {
  it('pokles zůstatku je spotřeba, nárůst se nepočítá', () => {
    expect(dailyDemand(20, [10, 10, 4, 8, 1])).toEqual([10, 0, 6, 0, 7]);
  });
});

describe('buildComponents', () => {
  it('poptávka: soubor zákazníka je fix, zbytek horizontu z odvolávek', () => {
    const m = mapping();
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, coverage, callOffs, stock: new Map([['CLIP-1', 40]]), today });
    expect(t.days).toHaveLength(COMPONENT_DAYS);
    const [fg1, fg2] = t.products;
    // 13. 10. ze souboru 10, 14. 10. v souboru chybí (0, i když odvolávka je 99), 15. 10. 5, 16. 10. odvolávka 7
    expect(fg1!.qty.slice(0, 4)).toEqual([10, 0, 5, 7]);
    expect(fg1!.fixed.slice(0, 4)).toEqual([true, true, true, false]);
    expect(fg1!.project).toBe('P1');
    expect(fg2!.qty.slice(0, 3)).toEqual([3, 4, 0]);
  });

  it('bez sloupce v mapování: nakupované komponenty; spotřeba × kusovník a pokrytí ze skladu', () => {
    const m = mapping();
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, coverage, callOffs, stock: new Map([['CLIP-1', 40]]), today });
    expect(t.byMapping).toBe(false);
    expect(t.components.map((c) => c.item)).toEqual(['RESIN', 'CLIP-1']);
    const clip = t.components[1]!;
    // FG-1 × 2 + FG-2 × 1: 13. 10. 20 + 3, 14. 10. 0 + 4, 15. 10. 10, 16. 10. 14
    expect(clip.usage.slice(0, 4)).toEqual([23, 4, 10, 14]);
    expect(clip.balance.slice(0, 4)).toEqual([17, 13, 3, -11]);
    expect(clip.shortDay).toBe(3);
    expect(clip.products).toEqual(['FG-1', 'FG-2']);
    expect(clip.projects).toEqual(['P1']);
    // pryskyřice v kg, sklad v souboru není → 0, hned v záporu
    expect(t.components[0]).toMatchObject({ um: 'KG', stock: 0, shortDay: 0 });
    expect(t.components[0]!.usage[0]).toBe(5);
  });

  it('se sloupcem Component Coverage jen označené; mezivýroba bez označení se nezobrazí', () => {
    const m = mapping('x');
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, coverage, callOffs, stock: undefined, today });
    expect(t.byMapping).toBe(true);
    expect(t.components.map((c) => c.item)).toEqual(['CLIP-1']);
    expect(t.components[0]!.stock).toBeNull();
    expect(t.markedNotInBom).toEqual([]);
  });
});
