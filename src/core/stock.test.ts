import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { dayFromParts } from './dates';
import { excludedLocationsIn, isExcludedLocation, lastMoveDay, locationHash, parseStock, stockByItem, stockItemCount } from './stock';

// Smyšlený export skladu ve formátu z ERP: čárka jako oddělovač, čísla v českém formátu, dvakrát sloupec Description.
const csv = [
  '﻿Site,Item Number,Description,Description,Unit of Measure,Status,Qty On Hand - Inv Mstr,Qty On Hand - Inv Detail,Location,Zone ID,Area ID,Warehouse ID',
  '1000,900100,DOOR LHD,A1234567890,EA,OK,"1 236,0","1 200,0",A-01,SALE,WRH,WH1',
  '1000,900100,DOOR LHD,A1234567890,EA,OK,"1 236,0","24,0",A-02,SALE,WRH,WH1',
  '1000,900100,DOOR LHD,A1234567890,EA,PROD,"1 236,0","12,0",B-01,PURCH,WRH,WH1',
  '1000,900100,DOOR LHD,A1234567890,EA,PROD,"1 236,0","8,0",L-01,WRKC,PROD,WH1',
  '1000,900100,DOOR LHD,A1234567890,EA,DIFF,"1 236,0","-8,0",A-03,SALE,WRH,WH1',
  '1000,900100,DOOR LHD,A1234567890,EA,OK,"1 236,0","0,0",A-04,sale,WRH,WH1',
  '1000,900101,DOOR RHD,,EA,HOLD,"5,0","5,0",HOLD,LAB,PROD,WH1',
  '1000,,,,EA,OK,"0,0","3,0",A-05,SALE,WRH,WH1',
  '1000,900102,DOOR X,,EA,OK,"x","x",A-06,SALE,WRH,WH1',
].join('\r\n');

describe('parseStock', () => {
  it('načte lokace s množstvím z detailu a českým formátem čísel', () => {
    const r = parseStock(parseCsv(csv));
    if (!r.ok) throw new Error();
    expect(r.value.qtyColumn).toBe('Qty On Hand - Inv Detail');
    expect(r.value.rows).toHaveLength(7);
    expect(r.value.rows[0]).toEqual({ item: '900100', location: 'A-01', zone: 'SALE', area: 'WRH', warehouse: 'WH1', status: 'OK', qty: 1200, site: '1000', locationType: '', cost: null, lastMove: null, abc: '' });
    expect(r.value.descriptions.get('900100')).toBe('DOOR LHD');
    expect(stockItemCount(r.value)).toBe(2);
    // neplatné množství je v problémech, řádek bez dílu se přeskočí
    expect(r.value.issues).toEqual([{ row: 10, column: 'Qty On Hand - Inv Detail', value: 'x', message: 'invalidNumber' }]);
  });

  it('cena, typ lokace, poslední pohyb (americké m/d/rr i české datum) a ABC', () => {
    const r = parseStock(parseCsv('Site,Item Number,Status,Standard Cost,Qty On Hand - Inv Detail,Location,Location Types,OID Date (Last Transaction Date),ABC Class\n1000,PG-1,QH,"1 473,5","2,0",SEQ-1,External,09/29/25,b'));
    if (!r.ok) throw new Error();
    expect(r.value.rows[0]).toMatchObject({ site: '1000', locationType: 'External', cost: 1473.5, lastMove: dayFromParts(2025, 9, 29), abc: 'B' });
    expect(lastMoveDay('1.10.2026')).toBe(dayFromParts(2026, 10, 1));
    expect(lastMoveDay('12/31/2025')).toBe(dayFromParts(2025, 12, 31));
    expect(lastMoveDay('')).toBeNull();
  });

  it('Qty Available má přednost před množstvím na lokaci', () => {
    const r = parseStock(parseCsv('Item Number;Zone ID;Qty On Hand - Inv Detail;Qty Available\n900100;SALE;10;7'));
    if (!r.ok) throw new Error();
    expect(r.value.qtyColumn).toBe('Qty Available');
    expect(r.value.rows[0]!.qty).toBe(7);
  });

  it('bez sloupce dílu nebo množství vrátí chybějící sloupce', () => {
    expect(parseStock(parseCsv('Location;Zone ID\nA;SALE'))).toEqual({ ok: false, error: 'missingColumns', columns: ['Item Number', 'Qty Available'] });
  });
});

describe('stockByItem', () => {
  it('sečte kladná množství na lokacích v zónách příjmu, skladů a výroby, plná i neúplná balení dohromady', () => {
    const r = parseStock(parseCsv(csv));
    if (!r.ok) throw new Error();
    // 1 200 + 24 (SALE) + 12 (PURCH) + 8 (WRKC); karanténa (LAB), záporná a nulová lokace se nepočítají
    expect(stockByItem(r.value)).toEqual(new Map([['900100', 1244]]));
  });

  it('vyloučené lokace se nepočítají a modul Data je vypíše', () => {
    const r = parseStock(parseCsv(csv));
    if (!r.ok) throw new Error();
    const excluded = (location: string) => location.toUpperCase() === 'A-01';
    expect(stockByItem(r.value, excluded)).toEqual(new Map([['900100', 44]]));
    expect(excludedLocationsIn(r.value, excluded)).toEqual(['A-01']);
    expect(excludedLocationsIn(r.value)).toEqual([]);
  });
});

describe('isExcludedLocation', () => {
  it('pozná lokaci podle otisku bez ohledu na velikost písmen a mezery', () => {
    expect(locationHash(' ext-01 ')).toBe(locationHash('EXT-01'));
    expect(locationHash('EXT-01')).toBe(0x1a321be0);
    expect(isExcludedLocation('EXT-01')).toBe(false);
    expect(isExcludedLocation('')).toBe(false);
  });
});
