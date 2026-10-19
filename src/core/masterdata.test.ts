import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { customerDisplay, customerKey, masterSheets, parseMasterData, parseMasterWorkbook, sheetKind } from './masterdata';

describe('customerKey', () => {
  it('sjednotí zápis čísla zákazníka', () => {
    expect(customerKey('A1234567890  00009051')).toBe('A12345678909051');
    expect(customerKey('A1234567890      9051')).toBe('A12345678909051');
    // Zápis s pomlčkou (číslo + varianta) dá stejný klíč.
    expect(customerKey(' a1234567890-9051 ')).toBe('A12345678909051');
    // Jiný prostředek než nuly je součást čísla: dva různé díly.
    // Písmenné označení (ERS) před variantou i za ní je stejný díl; bez něj jiný díl.
    const ers = 'A12345678908R01ERS';
    expect(['A1234567890  ERS 8R01', 'A1234567890 8R01 ERS', 'A12345678908R01ERS', 'A1234567890-ERS-8R01', 'A1234567890 00ERS 8R01'].map(customerKey)).toEqual([ers, ers, ers, ers, ers]);
    expect(customerKey('A1234567890      8R01')).toBe('A12345678908R01');
    // Varianta s písmeny na konci (méně než 3 písmena) zůstane variantou.
    expect(customerKey('A1234567890  000012AB')).toBe('A123456789012AB');
    // Varianta ze samých písmen s doplňujícími nulami není označení.
    expect(customerKey('A1234567890  0000ABCD')).toBe(customerKey('A1234567890 ABCD'));
    expect(customerKey('12345 678')).toBe('12345678');
    expect(customerKey('')).toBe('');
  });
});

describe('customerDisplay', () => {
  it('jednotný zápis bez doplňujících nul barvy', () => {
    expect(customerDisplay('A1234567890  00009L22')).toBe('A1234567890 9L22');
    expect(customerDisplay('A1234567890 9L22')).toBe('A1234567890 9L22');
    expect(customerDisplay('A1234567890  ERS 8R01')).toBe('A1234567890 8R01 ERS');
    expect(customerDisplay('A1234567890 8R01 ERS')).toBe('A1234567890 8R01 ERS');
    expect(customerDisplay('a1234567890      9051 ')).toBe('A1234567890 9051');
    expect(customerDisplay(' 12345  678 ')).toBe('12345 678');
  });
});

describe('parseMasterData', () => {
  it('dodavatel ze sloupce Supplier (nebo Dodavatel)', () => {
    const r = parseMasterData(parseCsv('Item Number;Item Type;Description;Dodavatel\nK-1;PG;CLIP;Alfa s.r.o.'));
    if (!r.ok) throw new Error();
    expect(r.value.items.get('K-1')).toMatchObject({ kind: 'PG', supplier: 'Alfa s.r.o.' });
  });

  it('čte formát mapování a stranu odvodí z varianty', () => {
    const r = parseMasterData(
      parseCsv(
        [
          'Item Number;Customer Number;Description;Variant;Type;Project;Safety Stock;Safety Time;Order Multiple;Yield Percent;Cost Total',
          '900100-0001;A1234567890  00000001;ASSY DOOR LHD;LHD HUD;DOOR;P100;0;0;16;100,00%;2 166,96615',
          '900101-0001;A1234567890  00000002;ASSY DOOR RHD;RHD;DOOR;P100',
          '900102;;SPARE;;;P200',
          '900103;A1234567890      0001;DUP;LHD;DOOR;P100',
        ].join('\n'),
      ),
    );
    if (!r.ok) throw new Error();
    expect(r.value.items.get('900100-0001')).toEqual({
      item: '900100-0001',
      customerNumber: 'A1234567890  00000001',
      customerKey: 'A12345678900001',
      description: 'ASSY DOOR LHD',
      variant: 'LHD HUD',
      type: 'DOOR',
      kind: '',
      project: 'P100',
      customer: '',
      side: 'LHD',
      safetyStock: 0,
      safetyTime: 0,
      orderMultiple: 16,
      componentCoverage: false,
      line: '',
      category: '',
      supplier: '',
    });
    expect(r.value.hasComponentColumn).toBe(false);
    expect(r.value.items.get('900101-0001')).toMatchObject({ side: 'RHD', orderMultiple: null });
    expect(r.value.items.get('900102')?.side).toBe('');
    expect(r.value.byCustomerKey.get('A12345678900001')?.item).toBe('900100-0001');
    expect(r.value.issues.map((i) => i.message)).toEqual(['duplicateCustomerNumber']);
  });

  it('čte i původní české sloupce se stranou', () => {
    const r = parseMasterData(parseCsv('Díl;Zákazník;Projekt;Strana\n1001;Zákazník A;P100;lhd\n1002;Zákazník B;P300;XYZ\n1001;Zákazník A;P100;RHD'));
    if (!r.ok) throw new Error();
    expect(r.value.items.get('1002')).toMatchObject({ customer: 'Zákazník B', project: 'P300', side: 'XYZ' });
    expect(r.value.items.get('1001')?.side).toBe('RHD');
    expect(r.value.issues.map((i) => i.message)).toEqual(['unknownSide', 'duplicateItem']);
  });

  it('sloupec Component Coverage označí komponenty pro modul Komponenty', () => {
    const r = parseMasterData(parseCsv('Item Number;Component Coverage\nK1;Ano\nK2;y\nK3;\nK4;ne\nK5;X'));
    if (!r.ok) throw new Error();
    expect(r.value.hasComponentColumn).toBe(true);
    expect([...r.value.items.values()].filter((m) => m.componentCoverage).map((m) => m.item)).toEqual(['K1', 'K2', 'K5']);
  });

  it('sloupec Line převede názvy linek na kódy', () => {
    const r = parseMasterData(parseCsv('Item Number;Linka\n1;Montáž\n2;assy\n3;Foaming\n4;slush\n5;Vstřikování\n6;IMM 2\n7;\n8;Lakovna'));
    if (!r.ok) throw new Error();
    expect(r.value.hasLineColumn).toBe(true);
    expect([...r.value.items.values()].map((m) => m.line)).toEqual(['ASSEMBLY', 'ASSEMBLY', 'FOA', 'SLH', 'IMM', 'IMM', '', 'LAKOVNA']);
  });

  it('vyžaduje sloupec s číslem dílu', () => {
    expect(parseMasterData(parseCsv('Projekt\nP100'))).toEqual({ ok: false, error: 'missingColumns', columns: ['Item Number'] });
  });
});

describe('druh dílu', () => {
  it('PG, SFG, FG (i WIP); neznámá hodnota je chyba, prázdná neuvedeno', () => {
    const r = parseMasterData(parseCsv('Item Number;Item Type\nA;fg\nB;WIP\nC;PG\nD;\nE;XYZ'));
    if (!r.ok) throw new Error();
    expect(['A', 'B', 'C', 'D', 'E'].map((i) => r.value.items.get(i)!.kind)).toEqual(['FG', 'SFG', 'PG', '', '']);
    expect(r.value.issues.map((i) => [i.message, i.value])).toEqual([['unknownKind', 'XYZ']]);
    expect(r.value.columns.has('kind')).toBe(true);
  });
});


describe('čísla zákazníka s prostředkem', () => {
  it('díl s „ERS“ uprostřed a díl bez něj nejsou duplicita', () => {
    const r = parseMasterData(parseCsv('Item Number;Customer Number\n900200-8R01;A1234567890      8R01\n900200-8R01ERS;A1234567890  ERS 8R01'));
    // zákazník v souboru píše ERS na konec
    if (!r.ok) throw new Error();
    expect(r.value.issues).toEqual([]);
    expect(r.value.byCustomerKey.get(customerKey('A1234567890 8R01'))?.item).toBe('900200-8R01');
    expect(r.value.byCustomerKey.get(customerKey('A1234567890 8R01 ERS'))?.item).toBe('900200-8R01ERS');
  });
});

describe('kategorie', () => {
  it('sloupec Category (nebo Kategorie) se přečte, mezery se sjednotí', () => {
    const r = parseMasterData(parseCsv('Item Number;Side;Variant;Category\n1;LHD;SR2 heating;DP\n2;RHD;;HB\n3;LHD;;  Door   panel '));
    if (!r.ok) throw new Error();
    expect(['1', '2', '3'].map((i) => r.value.items.get(i)?.category)).toEqual(['DP', 'HB', 'Door panel']);
    expect(r.value.items.get('1')).toMatchObject({ side: 'LHD', variant: 'SR2 heating' });
    const cz = parseMasterData(parseCsv('Item Number;Kategorie\n1;DP'));
    if (!cz.ok) throw new Error();
    expect(cz.value.items.get('1')?.category).toBe('DP');
  });
});

describe('mapování na více listech (FG / SFG / PG)', () => {
  const sheet = (name: string, csv: string) => ({ name, table: parseCsv(csv) });

  it('druh podle názvu listu, list se sloupcem Item Type, Návod a jiné listy se vynechají', () => {
    const r = parseMasterWorkbook([
      sheet('FG', 'Item Number;Project;Line\nF1;P1;ASSEMBLY'),
      sheet('SFG – mezivýroba', 'Item Number;Project;Line\nS1;P1;FOA'),
      sheet('pg', 'Item Number;Category;Component Coverage\nK1;K;Ano'),
      sheet('Bez druhu', 'Item Number;Item Type;Description\nX1;;A\nX2;pg;B'),
      sheet('Návod', 'Sloupec;FG\nItem Number;povinné'),
      sheet('Jiný', 'Item Number;Project\nZ1;P9'),
    ]);
    if (!r.ok) throw new Error();
    expect([...r.value.items.values()].map((m) => [m.item, m.kind])).toEqual([
      ['F1', 'FG'],
      ['S1', 'SFG'],
      ['K1', 'PG'],
      ['X1', ''],
      ['X2', 'PG'],
    ]);
    expect(r.value.hasComponentColumn && r.value.hasLineColumn).toBe(true);
    expect(['item', 'kind', 'project', 'line', 'category', 'description'].every((c) => r.value.columns.has(c as never))).toBe(true);
    expect(r.value.columns.has('customer')).toBe(false);
  });

  it('sešit bez listů druhů: jen první list (dosavadní formát)', () => {
    const books = [sheet('Mapping', 'Item Number;Item Type\nA;FG'), sheet('Export', 'Item Number\nB')];
    expect(masterSheets(books).map((s) => s.name)).toEqual(['Mapping']);
    const r = parseMasterWorkbook(books);
    if (!r.ok) throw new Error();
    expect([...r.value.items.keys()]).toEqual(['A']);
  });

  it('chyby s názvem listu; díl na dvou listech je duplicita; sloupec Item Type má přednost před listem', () => {
    const r = parseMasterWorkbook([sheet('FG', 'Item Number;Item Type\nA;\nB;PG\nC;XYZ'), sheet('PG', 'Item Number\nA')]);
    if (!r.ok) throw new Error();
    expect(['A', 'B', 'C'].map((i) => r.value.items.get(i)!.kind)).toEqual(['PG', 'PG', 'FG']);
    expect(r.value.issues.map((i) => [i.sheet, i.row, i.message])).toEqual([
      ['FG', 4, 'unknownKind'],
      ['PG', 2, 'duplicateItem'],
    ]);
    // jeden list (CSV) bez názvu listu v chybách
    const one = parseMasterData(parseCsv('Item Number\nA\nA'));
    if (!one.ok) throw new Error();
    expect(one.value.issues[0]!.sheet).toBeUndefined();
  });

  it('název listu → druh', () => {
    expect(['FG', ' sfg ', 'PG nákup', 'FGX', 'Návod'].map(sheetKind)).toEqual(['FG', 'SFG', 'PG', null, null]);
  });
});
