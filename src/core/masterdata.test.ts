import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { customerDisplay, customerKey, masterDataTemplate, parseMasterData, type MasterItem } from './masterdata';

describe('customerKey', () => {
  it('sjednotí zápis čísla zákazníka', () => {
    expect(customerKey('A1234567890  00009051')).toBe('A12345678909051');
    expect(customerKey('A1234567890      9051')).toBe('A12345678909051');
    // Zápis s pomlčkou (číslo + varianta) dá stejný klíč.
    expect(customerKey(' a1234567890-9051 ')).toBe('A12345678909051');
    expect(customerKey('12345 678')).toBe('12345678');
    expect(customerKey('')).toBe('');
  });
});

describe('customerDisplay', () => {
  it('jednotný zápis bez doplňujících nul barvy', () => {
    expect(customerDisplay('A1234567890  00009L22')).toBe('A1234567890 9L22');
    expect(customerDisplay('A1234567890 9L22')).toBe('A1234567890 9L22');
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
      project: 'P100',
      customer: '',
      side: 'LHD',
      safetyStock: 0,
      safetyTime: 0,
      orderMultiple: 16,
      componentCoverage: false,
      line: '',
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

describe('masterDataTemplate', () => {
  it('předvyplní známé hodnoty ve formátu mapování', () => {
    const known: MasterItem = {
      item: '1',
      customerNumber: 'C1',
      customerKey: 'C1',
      description: 'X',
      variant: 'LHD',
      type: 'IP',
      project: 'P',
      customer: '',
      side: 'LHD',
      safetyStock: 0,
      safetyTime: null,
      orderMultiple: 16,
      componentCoverage: false,
      line: 'ASSEMBLY',
    };
    const t = masterDataTemplate(
      [
        { item: '1', description: 'Popis 1' },
        { item: '2', description: 'Popis 2' },
      ],
      new Map([['1', known]]),
    );
    expect(t.header).toEqual(['Item Number', 'Customer Number', 'Description', 'Variant', 'Type', 'Project', 'Safety Stock', 'Safety Time', 'Order Multiple', 'Component Coverage', 'Line']);
    expect(t.rows).toEqual([
      ['1', 'C1', 'X', 'LHD', 'IP', 'P', '0', '', '16', '', 'ASSEMBLY'],
      ['2', '', 'Popis 2', '', '', '', '', '', '', '', ''],
    ]);
  });
});
