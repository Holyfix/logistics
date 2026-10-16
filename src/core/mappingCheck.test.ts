import { describe, expect, it } from 'vitest';
import type { CallOffExport } from './calloffs/parse';
import type { CoverageSource } from './coverage/compute';
import type { CoverageReport } from './coverage/parse';
import { parseCsv } from './csv';
import { customerKey, parseMasterData } from './masterdata';
import { checkCount, checkMapping } from './mappingCheck';

const master = (csv: string) => {
  const r = parseMasterData(parseCsv(csv));
  if (!r.ok) throw new Error();
  return r.value;
};
const row = (customerNumber: string, supplierItem = '', description = '') => ({ customerNumber, customerKey: customerKey(customerNumber), supplierItem, description });
const source = (project: string, rows: ReturnType<typeof row>[]): CoverageSource =>
  ({ path: `Coverage/L/${project}/r.xlsx`, fileName: 'r.xlsx', location: 'L', project, lastModified: 0, report: { rows } as unknown as CoverageReport }) as CoverageSource;
const callOffs = (items: string[]) => ({ items, descriptions: items.map((i) => `popis ${i}`) }) as unknown as CallOffExport;

describe('kontrola mapování', () => {
  const m = master(
    [
      'Item Number;Customer Number;Description;Project;Customer;Side;Category;Order Multiple;Line;Component Coverage',
      '100;A1111111111 0001;DOOR;P1;Z1;LHD;DP;12;ASSEMBLY;',
      '101;A2222222222 0001;PANEL;P1;;RHD;;;ASSEMBLY;',
      '102;;CLIP;P2;Z1;LHD;GB;;IMM;',
      '103;A3333333333 0001;;P1;Z1;LHD;DP;;;',
    ].join('\n'),
  );

  it('díly bez mapování z Coverage, odvolávek i kusovníku a díly s nevyplněnými údaji', () => {
    const check = checkMapping(m, {
      coverage: [source('P1', [row('A1111111111 0001'), row('A2222222222 0001'), row('A3333333333 0001'), row('A9999999999 0001', '', 'NEW PART')])],
      callOffs: callOffs(['100', '102', '900']),
      bomParents: ['900', 'FG-X', '100'],
    });
    expect(check.missing.map((p) => [p.item || p.customerNumber, p.folder, p.sources])).toEqual([
      ['900', '', ['calloffs', 'bom']],
      ['A9999999999 0001', 'P1', ['coverage']],
      ['FG-X', '', ['bom']],
    ]);
    // 101: chybí zákazník, kategorie a balení (jde do montáže); 103: chybí popis a linka (je v Coverage);
    // 102 není v Coverage – linka a balení se nekontrolují.
    expect(check.incomplete.map((p) => [p.item, p.missing])).toEqual([
      ['101', ['customer', 'category', 'orderMultiple']],
      ['103', ['description', 'line']],
    ]);
    expect(check.missingColumns).toEqual([]);
    expect(checkCount(check)).toBe(5);
  });

  it('chybějící sloupec se hlásí jednou, ne u každého dílu; Component Coverage jen s kusovníkem', () => {
    const plain = master('Item Number;Project\n100;P1');
    expect(checkMapping(plain, { coverage: [], callOffs: callOffs(['100']) }).missingColumns).toEqual(['customer', 'side', 'category', 'description', 'line', 'orderMultiple']);
    expect(checkMapping(plain, { coverage: [], callOffs: callOffs(['100']), bomParents: ['100'] }).missingColumns).toContain('componentCoverage');
    expect(checkMapping(plain, { coverage: [], callOffs: callOffs(['100']) }).incomplete).toEqual([]);
  });

  it('strana z varianty: bez sloupce Side stačí Variant', () => {
    const check = checkMapping(master('Item Number;Project;Variant\n100;P1;LHD BASIS\n101;P1;BASIS'), { coverage: [], callOffs: callOffs(['100', '101']) });
    expect(check.missingColumns).not.toContain('side');
    expect(check.incomplete.map((p) => [p.item, p.missing])).toEqual([['101', ['side']]]);
  });
});
