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
      'Item Number;Customer Number;Description;Project;Customer;Side;Category;Order Multiple;Line',
      '100;A1111111111 0001;DOOR;P1;Z1;LHD;DP;12;ASSEMBLY',
      '101;A2222222222 0001;PANEL;P1;;RHD;;;ASSEMBLY',
      '102;;CLIP;P2;Z1;LHD;GB;;IMM',
    ].join('\n'),
  );

  it('díly bez mapování z Coverage i odvolávek, neúplné údaje a jiný projekt než složka', () => {
    const check = checkMapping(
      m,
      [source('P1', [row('A1111111111 0001'), row('A2222222222 0001'), row('A9999999999 0001', '', 'NEW PART')]), source('P9', [row('A1111111111 0001')])],
      callOffs(['100', '102', '900', '900X']),
    );
    expect(check.missing.map((p) => [p.item || p.customerNumber, p.project, p.sources])).toEqual([
      ['900', '', ['calloffs']],
      ['900X', '', ['calloffs']],
      ['A9999999999 0001', 'P1', ['coverage']],
    ]);
    // 101: chybí zákazník, kategorie a balení (jde do montáže); 102 je jen v odvolávkách – balení se nekontroluje.
    expect(check.incomplete.map((p) => [p.item, p.missing])).toEqual([['101', ['customer', 'category', 'orderMultiple']]]);
    expect(check.mismatch).toEqual([{ item: '100', description: 'DOOR', mapping: 'P1', folders: ['P9'] }]);
    expect(check.missingColumns).toEqual([]);
    expect(checkCount(check)).toBe(5);
  });

  it('chybějící sloupec se hlásí jednou, ne u každého dílu', () => {
    const check = checkMapping(master('Item Number;Project\n100;P1'), [], callOffs(['100']));
    expect(check.missingColumns).toEqual(['customer', 'side', 'category', 'orderMultiple']);
    expect(check.incomplete).toEqual([]);
  });

  it('strana z varianty: bez sloupce Side stačí Variant', () => {
    const check = checkMapping(master('Item Number;Project;Variant\n100;P1;LHD BASIS\n101;P1;BASIS'), [], callOffs(['100', '101']));
    expect(check.missingColumns).not.toContain('side');
    expect(check.incomplete.map((p) => [p.item, p.missing])).toEqual([['101', ['side']]]);
  });
});
