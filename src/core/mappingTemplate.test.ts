import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseMasterData } from './masterdata';
import { cellStatus, mappingTemplate, SPARE_ROWS, TEMPLATE_COLUMNS, type TemplateTexts } from './mappingTemplate';

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

  it('barvy jako podmíněné formátování podle Item Type, i pro prázdné řádky pod díly; druh ze seznamu', () => {
    const last = 1 + 4 + SPARE_ROWS;
    expect(mapping!.lists).toEqual([{ from: { row: 2, column: 2 }, to: { row: last, column: 2 }, values: ['FG', 'SFG', 'PG'] }]);
    // statické buňky bez barev – barvy jsou jen v pravidlech
    expect(row('FG1').slice(2).every((c) => c?.backgroundColor === undefined)).toBe(true);
    const rules = mapping!.rules!;
    expect(rules.every((r) => r.from.row === 2 && r.to.row === last)).toBe(true);
    const of = (key: string) => rules.filter((r) => r.from.column === col(key) + 1).map((r) => [r.formula, r.style.backgroundColor]);
    expect(of('kind')).toEqual([
      ['AND($A2<>"",$B2="")', '#F8CBAD'],
      ['AND($B2<>"",$B2<>"FG",$B2<>"SFG",$B2<>"PG")', '#F8CBAD'],
    ]);
    expect(of('project')).toEqual([
      ['$B2="PG"', '#EDEDED'],
      ['AND(OR($B2="FG",$B2="SFG"),E2="")', '#FFE699'],
      ['AND(OR($B2="FG",$B2="SFG"),E2<>"")', '#E2EFDA'],
    ]);
    expect(of('variant')[1]![0]).toBe(`AND($B2="FG",H2="",$E2<>"",COUNTIFS($E$2:$E$${last},$E2,$H$2:$H$${last},"<>")>0)`);
    expect(of('componentCoverage')).toEqual([['OR($B2="FG",$B2="SFG")', '#EDEDED']]);
    expect(of('type')).toEqual([]);
  });

  it('stav buňky podle druhu a návod', () => {
    expect([cellStatus('variant', 'FG', true), cellStatus('variant', 'FG', false), cellStatus('variant', 'PG', true)]).toEqual(['required', 'optional', 'notNeeded']);
    expect([cellStatus('line', 'SFG', false), cellStatus('line', 'PG', false), cellStatus('componentCoverage', 'PG', false)]).toEqual(['required', 'notNeeded', 'optional']);
    expect(guide!.name).toBe('Návod');
    const lineRow = guide!.data.find((r) => r[0]?.value === 'Line')!;
    expect(lineRow.slice(1, 4).map((c) => c?.value)).toEqual(['povinné', 'povinné', '–']);
  });
});
