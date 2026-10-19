import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseMasterData, parseMasterWorkbook, type MasterItem } from './masterdata';
import { columnStatus, KIND_COLUMNS, mappingTemplate, TEMPLATE_COLUMNS, templateKind, type TemplateTexts } from './mappingTemplate';
import type { ReportSheet } from './calloffs/summaryReport';

const texts: TemplateTexts = {
  sheetGuide: 'Návod',
  title: 'T',
  legend: { requiredColumn: 'a', optionalColumn: 'b' },
  column: 'Sloupec',
  kinds: { FG: 'hotový', SFG: 'mezi', PG: 'nákup' },
  note: 'Pozn.',
  required: 'povinné',
  optional: 'volitelné',
  sideRule: 'strana',
  packRule: 'ASSEMBLY',
  calloffRule: 'odvolávky',
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
      'X2;;;FOAM 2;P1;;;;;SLH;;',
      'X3;;;NUT;;;;;;;;Ano',
    ].join('\n'),
  ),
);
if (!master.ok) throw new Error();
const sheets = mappingTemplate(
  master.value,
  [
    { item: 'NEW', customerNumber: 'A9999999999  00000001', description: 'NEW PART' },
    { item: 'FG1', customerNumber: '', description: '' },
    { item: 'K-NEW', customerNumber: '', description: 'CLIP NEW', kind: 'PG' },
  ],
  texts,
);
const byName = (name: string) => sheets.find((s) => s.name === name)!;
const headers = (s: ReportSheet) => s.data[0]!.map((c) => c?.value);
const row = (s: ReportSheet, item: string) => {
  const r = s.data.find((x) => x[0]?.value === item)!;
  return Object.fromEntries(headers(s).map((h, i) => [h, r[i]]));
};

describe('šablona mapování po druzích dílu', () => {
  it('jen listy FG, SFG, PG (každý jen se svými sloupci) a Návod', () => {
    expect(sheets.map((s) => s.name)).toEqual(['FG', 'SFG', 'PG', 'Návod']);
    expect(headers(byName('SFG'))).toEqual(['Item Number', 'Description', 'Project', 'Line']);
    expect(headers(byName('PG'))).toEqual(['Item Number', 'Description', 'Project', 'Category']);
    expect(headers(byName('FG'))).toEqual(KIND_COLUMNS.FG.map((k) => TEMPLATE_COLUMNS[k].header));
  });

  it('díly bez druhu podle údajů, díly mimo mapování na FG (bez duplicit)', () => {
    expect(byName('FG').data.slice(1).map((r) => r[0]?.value)).toEqual(['FG1', 'FG2', 'FG3', 'X1', 'NEW']);
    expect(byName('SFG').data.slice(1).map((r) => r[0]?.value)).toEqual(['SFG1', 'X2']);
    // díl mimo mapování s navrženým druhem na svém listu
    expect(byName('PG').data.slice(1).map((r) => r[0]?.value)).toEqual(['PG1', 'X3', 'K-NEW']);
    expect(row(byName('FG'), 'NEW')['Customer Number']!.value).toBe('A9999999999 0001');
    expect(templateKind(undefined)).toBe('FG');
  });

  it('chybějící údaj zůstane prázdný bez zvýraznění; volitelné sloupce světlým záhlavím', () => {
    const fg = row(byName('FG'), 'FG1');
    expect(fg['Order Multiple']).toEqual({});
    expect(byName('FG').data.slice(1).flat().every((c) => c?.backgroundColor === undefined)).toBe(true);
    expect(byName('PG').data[0]!.map((c) => c?.backgroundColor)).toEqual(['#1D5C9E', '#1D5C9E', '#BDD7EE', '#BDD7EE']);
    // u FG volitelné jen strana a varianta
    expect(byName('FG').data[0]!.filter((c) => c?.backgroundColor === '#BDD7EE').map((c) => c?.value)).toEqual(['Side', 'Variant']);
  });

  it('prázdné listy druhů zůstanou se záhlavím', () => {
    const only = parseMasterData(parseCsv('Item Number;Item Type;Description;Category\nPG1;PG;CLIP;K'));
    if (!only.ok) throw new Error();
    const s = mappingTemplate(only.value, [], texts);
    expect(s.map((x) => x.name)).toEqual(['FG', 'SFG', 'PG', 'Návod']);
    expect(s[0]!.data).toHaveLength(1);
  });

  it('stav sloupce podle druhu a návod', () => {
    expect([columnStatus('variant', 'FG'), columnStatus('side', 'FG'), columnStatus('orderMultiple', 'FG'), columnStatus('variant', 'PG')]).toEqual(['optional', 'optional', 'required', 'notNeeded']);
    expect([columnStatus('line', 'SFG'), columnStatus('line', 'PG'), columnStatus('category', 'PG'), columnStatus('category', 'FG')]).toEqual(['required', 'notNeeded', 'optional', 'required']);
    const sideRow = byName('Návod').data.find((r) => r[0]?.value === 'Side')!;
    expect(sideRow.slice(1, 4).map((c) => c?.value)).toEqual(['strana', '–', '–']);
    const lineRow = byName('Návod').data.find((r) => r[0]?.value === 'Line')!;
    expect(lineRow.slice(1, 4).map((c) => c?.value)).toEqual(['povinné', 'povinné', '–']);
  });

  it('šablona se načte zpět: druh podle listu, údaje druhu beze ztráty', () => {
    const table = (s: ReportSheet) => ({ name: s.name, table: { header: headers(s).map(String), rows: s.data.slice(1).map((r) => r.map((c) => c?.value ?? null)) } });
    const back = parseMasterWorkbook(sheets.map(table));
    if (!back.ok) throw new Error();
    expect(Object.fromEntries([...back.value.items.values()].map((m) => [m.item, m.kind]))).toEqual({ FG1: 'FG', FG2: 'FG', FG3: 'FG', X1: 'FG', NEW: 'FG', SFG1: 'SFG', X2: 'SFG', PG1: 'PG', X3: 'PG', 'K-NEW': 'PG' });
    const kinded = [...master.value.items.values()].filter((m) => m.kind);
    // šablona nepřenáší sloupce, které aplikace nepoužívá
    const fields = (m: MasterItem) => ({ ...m, type: '', safetyStock: null, safetyTime: null, customer: '', componentCoverage: false });
    expect(kinded.map((m) => fields(back.value.items.get(m.item)!))).toEqual(kinded.map(fields));
    expect(back.value.issues).toEqual([]);
  });
});
