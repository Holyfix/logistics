import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseMasterData } from './masterdata';
import { cellStatus, mappingTemplate, TEMPLATE_COLUMNS, type TemplateTexts } from './mappingTemplate';

const texts: TemplateTexts = {
  sheetMapping: 'Mapping',
  sheetGuide: 'Návod',
  title: 'T',
  legend: { filled: 'a', missing: 'b', optional: 'c', notNeeded: 'd', kindMissing: 'e' },
  column: 'Sloupec',
  kinds: { FG: 'hotový', SFG: 'mezi', PG: 'nákup' },
  note: 'Pozn.',
  required: 'povinné',
  optional: 'volitelné',
  variantRequired: 'var',
  notNeeded: '–',
  columnNotes: {},
  footnotes: ['F'],
};

const master = parseMasterData(
  parseCsv(
    [
      'Item Number;Item Type;Customer Number;Description;Project;Customer;Side;Variant;Category;Line;Order Multiple',
      'FG1;FG;A1111111111 0001;DOOR;P1;Z;LHD;LHD BASIS;DP;ASSEMBLY;',
      'PG1;PG;;CLIP;;;;;;;',
      'X1;;;;;;;;;;',
    ].join('\n'),
  ),
);
if (!master.ok) throw new Error();
const [mapping, guide] = mappingTemplate(master.value, [{ item: 'NEW', customerNumber: 'A9999999999  00000001', description: 'NEW PART' }, { item: 'FG1', customerNumber: '', description: '' }], texts);
const col = (key: string) => TEMPLATE_COLUMNS.findIndex((c) => c.key === key);
const row = (item: string) => mapping!.data.find((r) => r[0]?.value === item)!;

describe('šablona mapování', () => {
  it('záhlaví v prvním řádku, všechny díly mapování a díly, které v něm chybí (bez duplicit)', () => {
    expect(mapping!.data[0]!.map((c) => c?.value)).toEqual(TEMPLATE_COLUMNS.map((c) => c.header));
    expect(mapping!.data.slice(1).map((r) => r[0]?.value)).toEqual(['FG1', 'PG1', 'X1', 'NEW']);
    expect(row('NEW')[col('customerNumber')]!.value).toBe('A9999999999 0001');
    expect(mapping!.gridLines).toBe(true);
  });

  it('barvy podle druhu: povinné vyplněné / chybí, nepotřebné, chybí druh', () => {
    const fg = row('FG1');
    expect(fg[col('project')]!.backgroundColor).toBe('#E2EFDA');
    expect(fg[col('orderMultiple')]!.backgroundColor).toBe('#FFE699');
    expect(fg[col('componentCoverage')]!.backgroundColor).toBe('#EDEDED');
    const pg = row('PG1');
    expect(pg[col('category')]!.backgroundColor).toBe('#FFE699');
    expect(pg[col('customerNumber')]!.backgroundColor).toBe('#EDEDED');
    expect(row('X1')[col('kind')]!.backgroundColor).toBe('#F8CBAD');
    expect(row('X1')[col('project')]!.backgroundColor).toBeUndefined();
  });

  it('stav buňky podle druhu a návod', () => {
    expect([cellStatus('variant', 'FG', true), cellStatus('variant', 'FG', false), cellStatus('variant', 'PG', true)]).toEqual(['required', 'optional', 'notNeeded']);
    expect([cellStatus('line', 'SFG', false), cellStatus('line', 'PG', false), cellStatus('componentCoverage', 'PG', false)]).toEqual(['required', 'notNeeded', 'optional']);
    expect(guide!.name).toBe('Návod');
    const lineRow = guide!.data.find((r) => r[0]?.value === 'Line')!;
    expect(lineRow.slice(1, 4).map((c) => c?.value)).toEqual(['povinné', 'povinné', '–']);
  });
});
