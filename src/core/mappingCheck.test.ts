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

const HEADER = 'Item Number;Customer Number;Description;Project;Side;Variant;Category;Order Multiple;Line';

describe('kontrola mapování po modulech (díly bez druhu)', () => {
  const m = master(
    [
      HEADER,
      '100;A1111111111 0001;DOOR;P1;LHD;SR2 Heating;DP;12;ASSEMBLY',
      '101;A2222222222 0001;PANEL;P1;;;DP;;ASSEMBLY',
      '102;;CLIP;P2;;;GB;;IMM',
      '103;A3333333333 0001;;P1;;;IP;;',
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
    // 101: kategorie DP projektu P1 se dělí na strany (100 má LHD) → strana chybí; montáž bez balení; varianta se nekontroluje
    expect(fields('101')).toEqual([
      ['side', ['coverage', 'calloffs', 'planning']],
      ['orderMultiple', ['planning']],
    ]);
    // 103: kategorie IP stranu nemá → nevyžaduje se; popis kvůli Coverage, linka kvůli Plánování
    expect(fields('103')).toEqual([
      ['description', ['coverage']],
      ['line', ['planning']],
    ]);
    // 100 je kompletní, 102 se nikde nepoužívá
    expect(fields('100')).toBeUndefined();
    expect(fields('102')).toBeUndefined();
  });

  it('souhrn po modulech a počty', () => {
    expect(check.modules.coverage).toMatchObject({ active: true, parts: 3, notInMapping: 1, fields: { side: 1, description: 1 } });
    expect(check.modules.planning).toMatchObject({ parts: 3, notInMapping: 1, fields: { side: 1, line: 1, orderMultiple: 1 } });
    expect(check.modules.calloffs).toMatchObject({ parts: 2, notInMapping: 1, fields: { side: 1 } });
    expect(check.modules.components).toMatchObject({ parts: 2, notInMapping: 2, fields: {} });
    // mapování bez druhu dílu: kontrola podle modulů a hlásí chybějící sloupec
    expect(check.columns.map((c) => c.column)).toEqual(['kind']);
    expect(checkCount(check)).toBe(6);
    expect(checkCount(check, 'components')).toBe(2);
  });

  it('chybějící sloupce a sloupce bez označení, s moduly, které je potřebují', () => {
    const plain = master('Item Number;Project;Description\n100;P1;DOOR');
    const c = checkMapping(plain, { coverage: [], callOffs: callOffs(['100']), bomParents: ['100'] });
    expect(c.columns.map((x) => [x.column, x.kind, x.modules])).toEqual([
      ['kind', 'missing', []],
      ['category', 'missing', ['calloffs', 'components']],
    ]);
    // Line bez ASSEMBLY u dílů z Coverage
    const unmarked = master(`${HEADER}\n100;A1111111111 0001;DOOR;P1;LHD;;DP;12;IMM`);
    const u = checkMapping(unmarked, { coverage: [source('P1', [row('A1111111111 0001')])], callOffs: undefined, bomParents: ['100'] });
    expect(u.columns.map((x) => [x.column, x.kind])).toEqual([
      ['kind', 'missing'],
      ['line', 'noneMarked'],
    ]);
  });

  it('strana jen v kategoriích projektu, kde ji má aspoň jeden díl (i strana z varianty)', () => {
    const mm = master(
      [HEADER, '200;A5555555555 0001;DOOR;PV;;LHD BASIS;DP;;IMM', '201;A6666666666 0001;DOOR;PV;;;DP;;IMM', '202;A7777777777 0001;DOOR;PV;;;IP;;IMM', '203;A8888888888 0001;DOOR;PX;;;DP;;IMM'].join('\n'),
    );
    const c = checkMapping(mm, { coverage: [source('L', [row('A5555555555 0001'), row('A6666666666 0001'), row('A7777777777 0001'), row('A8888888888 0001')])], callOffs: undefined });
    // 201: PV / DP má stranu u 200 → chybí; 202 (IP) a 203 (jiný projekt) ne
    expect(c.parts.map((p) => [p.item, p.fields.map((f) => f.field)])).toEqual([['201', ['side']]]);
  });
});

describe('kontrola podle druhu dílu (Item Type)', () => {
  const H = 'Item Number;Item Type;Customer Number;Description;Project;Side;Variant;Category;Order Multiple;Line';
  const m = master(
    [
      H,
      'FG1;FG;A1111111111 0001;DOOR;P1;LHD;;DP;;ASSEMBLY', // chybí balení
      'FG2;FG;;PANEL;P1;;;DP;12;ASSEMBLY', // chybí číslo zákazníka a strana (DP v P1 se dělí na strany)
      'FG3;FG;A3333333333 0001;IP PANEL;P1;;;IP;;IMM', // kompletní: IP bez stran, mimo montáž bez balení
      'SFG1;SFG;;FOAM;;;;;;IMM', // chybí projekt
      'PG1;PG;;;;;;;;', // chybí popis
      'PG2;PG;;SCREW;;;;;;', // kompletní
      'X1;;;;P1;;;;;', // bez druhu
    ].join('\n'),
  );
  const c = checkMapping(m, { coverage: [source('P1', [row('A1111111111 0001')])], callOffs: callOffs(['FG1', 'X1']), bomParents: ['FG1'] });

  it('co doplnit podle druhu; díly s druhem se kontrolují i mimo načtená data', () => {
    expect(c.parts.map((p) => [p.item, p.kind, p.fields.map((f) => f.field)])).toEqual([
      ['FG1', 'FG', ['orderMultiple']],
      ['FG2', 'FG', ['customerNumber', 'side']],
      ['X1', '', ['kind', 'category', 'description']],
      ['PG1', 'PG', ['description']],
      ['SFG1', 'SFG', ['project']],
    ]);
    // FG1 je v Coverage, odvolávkách i kusovníku – balení potřebuje Plánování; FG2 se nepoužívá → jen podle druhu
    expect(c.parts[0]!.fields[0]).toEqual({ field: 'orderMultiple', modules: ['planning'], byKind: true });
    expect(c.parts[1]!.fields[0]).toEqual({ field: 'customerNumber', modules: [], byKind: true });
  });

  it('souhrn podle druhu', () => {
    expect(c.hasKind).toBe(true);
    expect(c.kinds.FG).toEqual({ total: 3, parts: 2, fields: { orderMultiple: 1, customerNumber: 1, side: 1 } });
    expect(c.kinds.SFG).toMatchObject({ total: 1, parts: 1 });
    expect(c.kinds.PG).toMatchObject({ total: 2, parts: 1, fields: { description: 1 } });
    expect(c.withoutKind).toBe(1);
    expect(c.columns).toEqual([]);
  });
});
