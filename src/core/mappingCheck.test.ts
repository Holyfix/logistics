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

const HEADER = 'Item Number;Customer Number;Description;Project;Customer;Side;Variant;Category;Order Multiple;Line;Component Coverage';

describe('kontrola mapování po modulech', () => {
  const m = master(
    [
      HEADER,
      '100;A1111111111 0001;DOOR;P1;Z1;LHD;LHD;DP;12;ASSEMBLY;',
      '101;A2222222222 0001;PANEL;P1;;RHD;RHD;;;ASSEMBLY;',
      '102;;CLIP;P2;Z1;LHD;LHD;GB;;IMM;Ano',
      '103;A3333333333 0001;;P1;Z1;LHD;LHD;DP;;;',
    ].join('\n'),
  );
  const check = checkMapping(m, {
    coverage: [source('P1', [row('A1111111111 0001'), row('A2222222222 0001'), row('A3333333333 0001'), row('A9999999999 0001', '', 'NEW PART')])],
    callOffs: callOffs(['100', '101', '900']),
    bomParents: ['900', 'FG-X', '100'],
  });

  it('díl bez mapování: celý řádek, moduly podle toho, kde je', () => {
    const missing = check.parts.filter((p) => p.notInMapping).map((p) => [p.item || p.customerNumber, p.folder, p.modules]);
    expect(missing).toEqual([
      ['900', '', ['calloffs', 'components']],
      ['A9999999999 0001', 'P1', ['coverage', 'planning']],
      ['FG-X', '', ['components']],
    ]);
  });

  it('díl v mapování: které sloupce doplnit a kvůli kterým modulům', () => {
    const fields = (item: string) => check.parts.find((p) => p.item === item)?.fields.map((f) => [f.field, f.modules]);
    // 101: montážní díl (ASSEMBLY) v Coverage i odvolávkách
    expect(fields('101')).toEqual([
      ['customer', ['calloffs']],
      ['category', ['coverage', 'calloffs']],
      ['orderMultiple', ['planning']],
    ]);
    // 103: jen v Coverage, bez linky – popis kvůli Coverage, linka kvůli Plánování
    expect(fields('103')).toEqual([
      ['description', ['coverage']],
      ['line', ['planning']],
    ]);
    // 100 je kompletní, 102 se nikde nepoužívá
    expect(fields('100')).toBeUndefined();
    expect(fields('102')).toBeUndefined();
  });

  it('souhrn po modulech a počty', () => {
    expect(check.modules.coverage).toMatchObject({ active: true, parts: 3, notInMapping: 1, fields: { category: 1, description: 1 } });
    expect(check.modules.planning).toMatchObject({ parts: 3, notInMapping: 1, fields: { line: 1, orderMultiple: 1 } });
    expect(check.modules.calloffs).toMatchObject({ parts: 2, notInMapping: 1, fields: { customer: 1, category: 1 } });
    expect(check.modules.components).toMatchObject({ parts: 2, notInMapping: 2, fields: {} });
    expect(check.columns).toEqual([]);
    expect(checkCount(check)).toBe(5);
    expect(checkCount(check, 'components')).toBe(2);
  });

  it('chybějící sloupce a sloupce bez označení, s moduly, které je potřebují', () => {
    const plain = master('Item Number;Project;Description\n100;P1;DOOR');
    const c = checkMapping(plain, { coverage: [], callOffs: callOffs(['100']), bomParents: ['100'] });
    expect(c.columns.map((x) => [x.column, x.kind, x.modules])).toEqual([
      ['customer', 'missing', ['calloffs']],
      ['side', 'missing', ['calloffs']],
      ['category', 'missing', ['calloffs', 'components']],
      ['componentCoverage', 'missing', ['components']],
    ]);
    // Line bez ASSEMBLY u dílů z Coverage, Component Coverage bez Ano
    const unmarked = master(`${HEADER}\n100;A1111111111 0001;DOOR;P1;Z1;LHD;LHD;DP;12;IMM;`);
    const u = checkMapping(unmarked, { coverage: [source('P1', [row('A1111111111 0001')])], callOffs: undefined, bomParents: ['100'] });
    expect(u.columns.map((x) => [x.column, x.kind])).toEqual([
      ['line', 'noneMarked'],
      ['componentCoverage', 'noneMarked'],
    ]);
  });

  it('strana z varianty: bez sloupce Side stačí Variant', () => {
    const c = checkMapping(master('Item Number;Project;Variant;Description;Customer;Category\n100;P1;LHD BASIS;A;Z;K\n101;P1;BASIS;B;Z;K'), { coverage: [], callOffs: callOffs(['100', '101']) });
    expect(c.columns).toEqual([]);
    expect(c.parts.map((p) => [p.item, p.fields.map((f) => f.field)])).toEqual([['101', ['side']]]);
  });
});
