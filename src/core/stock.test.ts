import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { DEFAULT_STOCK_ZONES, parseStock, stockByItem, stockItemCount, stockRule } from './stock';

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
    expect(r.value.rows[0]).toEqual({ item: '900100', location: 'A-01', zone: 'SALE', area: 'WRH', warehouse: 'WH1', status: 'OK', qty: 1200 });
    expect(r.value.descriptions.get('900100')).toBe('DOOR LHD');
    expect(stockItemCount(r.value)).toBe(2);
    // neplatné množství je v problémech, řádek bez dílu se přeskočí
    expect(r.value.issues).toEqual([{ row: 10, column: 'Qty On Hand - Inv Detail', value: 'x', message: 'invalidNumber' }]);
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
  it('sečte kladná množství na lokacích ve výchozích zónách, plná i neúplná balení dohromady', () => {
    const r = parseStock(parseCsv(csv));
    if (!r.ok) throw new Error();
    // 1 200 + 24 (SALE) + 12 (PURCH) + 8 (WRKC); karanténa (LAB), záporná a nulová lokace se nepočítají
    expect(stockByItem(r.value)).toEqual(new Map([['900100', 1244]]));
    expect(stockByItem(r.value, { zones: ['lab'], excludedLocations: [] })).toEqual(new Map([['900101', 5]]));
  });

  it('vyloučené lokace z nastavení se nepočítají (bez ohledu na velikost písmen)', () => {
    const r = parseStock(parseCsv(csv));
    if (!r.ok) throw new Error();
    expect(stockByItem(r.value, stockRule({ stockZones: null, stockExcludedLocations: ['a-01'] }))).toEqual(new Map([['900100', 44]]));
    expect(stockRule(null)).toEqual({ zones: DEFAULT_STOCK_ZONES, excludedLocations: [] });
  });
});
