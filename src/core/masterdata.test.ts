import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { customerDisplay, customerKey, masterDataTemplate, parseMasterData, type MasterItem } from './masterdata';

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

describe('masterDataTemplate', () => {
  it('předvyplní známé hodnoty ve formátu mapování', () => {
    const known: MasterItem = {
      item: '1',
      customerNumber: 'C1',
      customerKey: 'C1',
      description: 'X',
      variant: 'LHD',
      type: 'IP',
      kind: 'FG',
      project: 'P',
      customer: '',
      side: 'LHD',
      safetyStock: 0,
      safetyTime: null,
      orderMultiple: 16,
      componentCoverage: false,
      line: 'ASSEMBLY',
      category: 'DP',
    };
    const t = masterDataTemplate(
      [
        { item: '1', description: 'Popis 1' },
        { item: '2', description: 'Popis 2' },
      ],
      new Map([['1', known]]),
    );
    expect(t.header).toEqual(['Item Number', 'Item Type', 'Customer Number', 'Description', 'Variant', 'Type', 'Project', 'Customer', 'Side', 'Safety Stock', 'Safety Time', 'Order Multiple', 'Component Coverage', 'Line', 'Category']);
    expect(t.rows).toEqual([
      ['1', 'FG', 'C1', 'X', 'LHD', 'IP', 'P', '', 'LHD', '0', '', '16', '', 'ASSEMBLY', 'DP'],
      ['2', '', '', 'Popis 2', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
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
