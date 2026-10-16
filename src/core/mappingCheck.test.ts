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
    // mapování bez sloupce Item Type: kontrola podle modulů a hlásí chybějící sloupec
    expect(check.columns.map((c) => c.column)).toEqual(['kind']);
    expect(checkCount(check)).toBe(6);
    expect(checkCount(check, 'components')).toBe(2);
  });

  it('chybějící sloupce a sloupce bez označení, s moduly, které je potřebují', () => {
    const plain = master('Item Number;Project;Description\n100;P1;DOOR');
    const c = checkMapping(plain, { coverage: [], callOffs: callOffs(['100']), bomParents: ['100'] });
    expect(c.columns.map((x) => [x.column, x.kind, x.modules])).toEqual([
      ['kind', 'missing', []],
      ['customer', 'missing', ['calloffs']],
      ['side', 'missing', ['calloffs']],
      ['category', 'missing', ['calloffs', 'components']],
      ['componentCoverage', 'missing', ['components']],
    ]);
    // Line bez ASSEMBLY u dílů z Coverage, Component Coverage bez Ano
    const unmarked = master(`${HEADER}\n100;A1111111111 0001;DOOR;P1;Z1;LHD;LHD;DP;12;IMM;`);
    const u = checkMapping(unmarked, { coverage: [source('P1', [row('A1111111111 0001')])], callOffs: undefined, bomParents: ['100'] });
    expect(u.columns.map((x) => [x.column, x.kind])).toEqual([
      ['kind', 'missing'],
      ['line', 'noneMarked'],
      ['componentCoverage', 'noneMarked'],
    ]);
  });

  it('varianta jen u projektů, které varianty používají', () => {
    const mm = master(
      [HEADER, '200;A5555555555 0001;DOOR;PV;Z;LHD;LHD BASIS;DP;;IMM;', '201;A6666666666 0001;DOOR;PV;Z;LHD;;DP;;IMM;', '202;A7777777777 0001;DOOR;PX;Z;LHD;;DP;;IMM;'].join('\n'),
    );
    const c = checkMapping(mm, { coverage: [source('L', [row('A5555555555 0001'), row('A6666666666 0001'), row('A7777777777 0001')])], callOffs: undefined });
    // 201 je v projektu PV, kde má variantu jiný díl → chybí; 202 v projektu PX bez variant → nevadí
    expect(c.parts.map((p) => [p.item, p.fields.map((f) => f.field)])).toEqual([['201', ['variant']]]);
    // bez sloupce Variant se nic nehlásí
    expect(checkMapping(master('Item Number;Project;Description;Category\n100;P1;A;K'), { coverage: [source('L', [row('X', '100')])], callOffs: undefined }).columns.map((x) => x.column)).not.toContain('variant');
  });

  it('strana z varianty: bez sloupce Side stačí Variant', () => {
    const c = checkMapping(master('Item Number;Project;Variant;Description;Customer;Category\n100;P1;LHD BASIS;A;Z;K\n101;P1;BASIS;B;Z;K'), { coverage: [], callOffs: callOffs(['100', '101']) });
    expect(c.columns.map((x) => x.column)).toEqual(['kind']);
    expect(c.parts.map((p) => [p.item, p.fields.map((f) => f.field)])).toEqual([['101', ['side']]]);
  });
});

describe('kontrola podle druhu dílu (Item Type)', () => {
  const H = 'Item Number;Item Type;Customer Number;Description;Project;Customer;Side;Variant;Category;Order Multiple;Line;Component Coverage';
  const m = master(
    [
      H,
      'FG1;FG;A1111111111 0001;DOOR;P1;Z1;LHD;;DP;;ASSEMBLY;', // chybí balení
      'FG2;FG;;PANEL;P1;Z1;RHD;;DP;12;ASSEMBLY;', // chybí číslo zákazníka
      'SFG1;SFG;;FOAM;;;;;;;IMM;', // chybí projekt
      'PG1;PG;;CLIP;;;;;;;;Ano', // chybí kategorie
      'PG2;PG;;SCREW;;;;;K1;;;', // kompletní
      'X1;;;;P1;;;;;;;', // bez druhu, nikde se nepoužívá → nekontroluje se
    ].join('\n'),
  );
  const c = checkMapping(m, { coverage: [source('P1', [row('A1111111111 0001')])], callOffs: callOffs(['FG1', 'X1']), bomParents: ['FG1'] });

  it('co doplnit podle druhu; díly s druhem se kontrolují i mimo načtená data', () => {
    expect(c.parts.map((p) => [p.item, p.kind, p.fields.map((f) => f.field)])).toEqual([
      ['FG1', 'FG', ['orderMultiple']],
      ['FG2', 'FG', ['customerNumber']],
      ['X1', '', ['kind', 'customer', 'side', 'category', 'description']],
      ['PG1', 'PG', ['category']],
      ['SFG1', 'SFG', ['project']],
    ]);
    // FG1 je v Coverage, odvolávkách i kusovníku – balení potřebuje Plánování; FG2 se nepoužívá → jen podle druhu
    expect(c.parts[0]!.fields[0]).toEqual({ field: 'orderMultiple', modules: ['planning'], byKind: true });
    expect(c.parts[1]!.fields[0]).toEqual({ field: 'customerNumber', modules: [], byKind: true });
  });

  it('souhrn podle druhu', () => {
    expect(c.hasKind).toBe(true);
    expect(c.kinds.FG).toEqual({ total: 2, parts: 2, fields: { orderMultiple: 1, customerNumber: 1 } });
    expect(c.kinds.SFG).toMatchObject({ total: 1, parts: 1 });
    expect(c.kinds.PG).toMatchObject({ total: 2, parts: 1, fields: { category: 1 } });
    expect(c.withoutKind).toBe(1);
    expect(c.columns).toEqual([]);
  });
});
