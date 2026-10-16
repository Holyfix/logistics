import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseMasterData, parseMasterWorkbook, type MasterItem } from './masterdata';
import { columnStatus, KIND_COLUMNS, mappingTemplate, NO_KIND_COLUMNS, SPARE_ROWS, TEMPLATE_COLUMNS, type TemplateTexts } from './mappingTemplate';
import type { ReportSheet } from './calloffs/summaryReport';

const texts: TemplateTexts = {
  sheetNoKind: 'Bez druhu',
  sheetGuide: 'Návod',
  title: 'T',
  legend: { requiredColumn: 'a', optionalColumn: 'b', missing: 'c', kindMissing: 'd' },
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
      'Item Number;Item Type;Customer Number;Description;Project;Customer;Side;Variant;Category;Line;Order Multiple;Component Coverage',
      'FG1;FG;A1111111111 0001;DOOR;P1;Z;LHD;LHD BASIS;DP;ASSEMBLY;;',
      'FG2;FG;A2222222222 0001;DOOR;P1;Z;RHD;;DP;ASSEMBLY;12;',
      'FG3;FG;A3333333333 0001;PANEL;P2;Z;RHD;;IP;ASSEMBLY;8;',
      'SFG1;SFG;;FOAM;P1;;;;;FOA;;',
      'PG1;PG;;CLIP;;;;;;;;Ano',
      'X1;;;SPARE;P1;;;;;;;',
    ].join('\n'),
  ),
);
if (!master.ok) throw new Error();
const sheets = mappingTemplate(master.value, [{ item: 'NEW', customerNumber: 'A9999999999  00000001', description: 'NEW PART' }, { item: 'FG1', customerNumber: '', description: '' }], texts);
const byName = (name: string) => sheets.find((s) => s.name === name)!;
const headers = (s: ReportSheet) => s.data[0]!.map((c) => c?.value);
const row = (s: ReportSheet, item: string) => {
  const r = s.data.find((x) => x[0]?.value === item)!;
  return Object.fromEntries(headers(s).map((h, i) => [h, r[i]]));
};

describe('šablona mapování po druzích dílu', () => {
  it('list pro každý druh jen s jeho sloupci, list Bez druhu a Návod', () => {
    expect(sheets.map((s) => s.name)).toEqual(['FG', 'SFG', 'PG', 'Bez druhu', 'Návod']);
    expect(headers(byName('SFG'))).toEqual(['Item Number', 'Description', 'Project', 'Line']);
    expect(headers(byName('PG'))).toEqual(['Item Number', 'Description', 'Category', 'Component Coverage']);
    expect(headers(byName('FG'))).toEqual(KIND_COLUMNS.FG.map((k) => TEMPLATE_COLUMNS[k].header));
    expect(byName('FG').data.slice(1).map((r) => r[0]?.value)).toEqual(['FG1', 'FG2', 'FG3']);
    // bez druhu: díl mapování bez druhu a díl, který v mapování chybí (FG1 už v mapování je)
    expect(headers(byName('Bez druhu'))).toEqual(NO_KIND_COLUMNS.map((k) => TEMPLATE_COLUMNS[k].header));
    expect(byName('Bez druhu').data.slice(1).map((r) => r[0]?.value)).toEqual(['X1', 'NEW']);
    expect(row(byName('Bez druhu'), 'NEW')['Customer Number']!.value).toBe('A9999999999 0001');
    expect(sheets.every((s) => !('rules' in s))).toBe(true);
  });

  it('žlutě chybějící povinné údaje; varianta jen v projektu s variantami; volitelné sloupce světlým záhlavím', () => {
    const fg = byName('FG');
    expect(row(fg, 'FG1')['Order Multiple']!.backgroundColor).toBe('#FFE699');
    expect(row(fg, 'FG1')['Project']!.backgroundColor).toBeUndefined();
    expect(row(fg, 'FG2')['Variant']!.backgroundColor).toBe('#FFE699'); // P1 má varianty
    expect(row(fg, 'FG3')['Variant']!.backgroundColor).toBeUndefined(); // P2 ne
    expect(byName('PG').data[0]!.map((c) => c?.backgroundColor)).toEqual(['#1D5C9E', '#1D5C9E', '#1D5C9E', '#BDD7EE']);
    expect(fg.data[0]!.every((c) => c?.backgroundColor === '#1D5C9E')).toBe(true);
  });

  it('list Bez druhu: Item Type ze seznamu, i v řádcích pod díly', () => {
    const s = byName('Bez druhu');
    expect(s.lists).toEqual([{ from: { row: 2, column: 2 }, to: { row: 3 + SPARE_ROWS, column: 2 }, values: ['FG', 'SFG', 'PG'] }]);
    expect(row(s, 'X1')['Item Type']!.backgroundColor).toBe('#F8CBAD');
  });

  it('bez dílů bez druhu se list Bez druhu nevytvoří; prázdné listy druhů zůstanou se záhlavím', () => {
    const only = parseMasterData(parseCsv('Item Number;Item Type;Description;Category\nPG1;PG;CLIP;K'));
    if (!only.ok) throw new Error();
    const s = mappingTemplate(only.value, [], texts);
    expect(s.map((x) => x.name)).toEqual(['FG', 'SFG', 'PG', 'Návod']);
    expect(s[0]!.data).toHaveLength(1);
  });

  it('stav sloupce podle druhu a návod', () => {
    expect([columnStatus('variant', 'FG', true), columnStatus('variant', 'FG', false), columnStatus('variant', 'PG', true)]).toEqual(['required', 'optional', 'notNeeded']);
    expect([columnStatus('line', 'SFG', false), columnStatus('line', 'PG', false), columnStatus('componentCoverage', 'PG', false)]).toEqual(['required', 'notNeeded', 'optional']);
    const lineRow = byName('Návod').data.find((r) => r[0]?.value === 'Line')!;
    expect(lineRow.slice(1, 4).map((c) => c?.value)).toEqual(['povinné', 'povinné', '–']);
  });

  it('šablona se načte zpět: druh podle listu, data beze ztráty', () => {
    const table = (s: ReportSheet) => ({ name: s.name, table: { header: headers(s).map(String), rows: s.data.slice(1).map((r) => r.map((c) => c?.value ?? null)) } });
    const back = parseMasterWorkbook(sheets.map(table));
    if (!back.ok) throw new Error();
    expect([...back.value.items.values()].map((m) => [m.item, m.kind])).toEqual([
      ['FG1', 'FG'],
      ['FG2', 'FG'],
      ['FG3', 'FG'],
      ['SFG1', 'SFG'],
      ['PG1', 'PG'],
      ['X1', ''],
      ['NEW', ''],
    ]);
    const keep = (m: { item: string }) => m.item !== 'NEW';
    const fields = (m: MasterItem) => ({ ...m, type: '', safetyStock: null, safetyTime: null });
    expect([...back.value.items.values()].filter(keep).map(fields)).toEqual([...master.value.items.values()].map(fields));
    expect(back.value.issues).toEqual([]);
    expect(back.value.columns.has('kind')).toBe(true);
  });
});
