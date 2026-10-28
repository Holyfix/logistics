import { describe, expect, it } from 'vitest';
import { parseBom } from './bom';
import { parseCallOffExport } from './calloffs/parse';
import { parseCsv } from './csv';
import { dayFromParts } from './dates';
import { bandOf, buildInventory, coverageDays, demandForWorkdays, homeSite, isExternal, moneyParts, moneyTotals, type InventoryLine } from './inventory';
import { parseMasterData } from './masterdata';
import { parseStock, type StockRow } from './stock';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const TODAY = day(12); // pondělí

const master = parseMasterData(parseCsv('Item Number;Customer Number;Description;Project;Category;Item Type\nFG-1;C1;PANEL LHD;P1;DP;FG\nSFG-1;;CARRIER;P1;;SFG\nPG-1;;CLIP;;;PG\nPG-2;;OLD CLIP;;;PG'));
if (!master.ok) throw new Error();
const bom = parseBom([
  ['Level', 'Component Item', 'Quantity Per', 'Purchase/Manufacture'],
  ['Parent', 'FG-1', null, 'L'],
  ['1', 'SFG-1', 1, 'L'],
  ['.2', 'PG-1', 2, 'P'],
]);
if (!bom.ok) throw new Error();
// FG-1: 10 ks každý pracovní den dva týdny (12.–23. 10.).
const workdays = [12, 13, 14, 15, 16, 19, 20, 21, 22, 23];
const calls = parseCallOffExport(parseCsv(['Item Number,Date,Discrete Qty', ...workdays.map((d) => `FG-1,${d}.10.2026,10`)].join('\n')), 'Odvolavky_CW42.csv');
if (!calls.ok) throw new Error();
const stock = parseStock(
  parseCsv(
    [
      'Site,Item Number,Description,Status,Standard Cost,Qty On Hand - Inv Detail,Location,OID Date (Last Transaction Date),ABC Class',
      '1000,FG-1,PANEL,WH.F,100,25,A-01,10/10/26,A',
      '1000DE,FG-1,PANEL,WH.F,100,10,SEQ-1,10/11/26,A',
      '1000,FG-1,PANEL,QH,100,5,Q-01,10/01/26,A',
      '1000,PG-1,CLIP,WH.P,"0,5",2000,C-01,10/09/26,B',
      '1000,PG-1,CLIP,DIFF,"0,5",-3,C-02,10/09/26,B',
      '1000,PG-2,OLD CLIP,WH.P,2,50,C-03,12/15/25,C',
      '1000,OTHER-1,PALLET,WH.P,10,5,P-01,10/09/26,C',
      '1000,FG-1,PANEL,WH.F,100,0,X-01,10/09/26,A',
      '1000,FG-1,PANEL,WH.F,100,0,EXT-01,10/09/26,A',
    ].join('\n'),
  ),
);
if (!stock.ok) throw new Error();
// Externí lokace v domácím závodě (v aplikaci podle otisku názvu, tady smyšlená).
const ext = (location: string) => location.trim().toUpperCase() === 'EXT-01';
const inputs = { stock: stock.value, master: master.value, boms: [bom.value], callOffs: calls.value, today: TODAY, excludedLocation: ext };
const line = (item: string, scope: 'all' | 'internal' | 'external' = 'all') => buildInventory({ ...inputs, scope }).lines.find((l) => l.item === item)!;

describe('Zásoby', () => {
  it('domácí závod = nejčastější Site; externí = jiný Site nebo externí lokace vyloučená v Coverage', () => {
    const rows = stock.value.rows;
    expect(homeSite(rows)).toBe('1000');
    expect(rows.filter((r) => isExternal(r, '1000', ext)).map((r) => r.location)).toEqual(['SEQ-1', 'EXT-01']);
    expect(isExternal({ site: '1000', location: 'ext-01 ' } as StockRow, '1000', ext)).toBe(true);
    expect(isExternal({ site: '1000', location: 'X-01' } as StockRow, '1000')).toBe(false);
  });

  it('dosah v pracovních dnech, minimum a maximum z potřeby den po dni', () => {
    const days = Array.from({ length: 14 }, (_, k) => TODAY + k);
    const need = days.map((d) => (workdays.includes(d - day(1) + 1) ? 10 : 0));
    expect(coverageDays(35, need, days)).toBe(3);
    expect(coverageDays(0, need, days)).toBe(0);
    expect(coverageDays(1000, need, days)).toBeNull();
    // 5 pracovních dní = po–pá, 6. pracovní den je až po víkendu
    expect(demandForWorkdays(need, days, 5)).toBe(50);
    expect(demandForWorkdays(need, days, 6)).toBe(60);
    expect([0, 1.9, 2, 4, 5, 20, 21, 40, 41].map((d) => bandOf(d, 100))).toEqual(['crit', 'crit', 'low', 'low', 'ok', 'ok', 'high', 'high', 'over']);
    expect(bandOf(null, 100)).toBe('over');
    expect(bandOf(null, 0)).toBe('none');
  });

  it('FG: volná zásoba včetně externích lokací, blokace zvlášť, hodnota z ceny', () => {
    const fg = line('FG-1');
    expect(fg).toMatchObject({ kind: 'FG', projects: ['P1'], categories: ['DP'], abc: 'A', free: 35, external: 10, blocked: 5, value: 3500, externalValue: 1000, blockedValue: 500 });
    expect(fg.blockedBy).toEqual({ quality: 5, inventory: 0, logistics: 0 });
    expect(fg).toMatchObject({ days: 3, band: 'low', min: 50, max: 100, toMin: 15, overMax: 0, surplus: 0, noNeed: null });
    expect(fg.locations.map((l) => [l.location, l.external, l.blocked])).toEqual([
      ['A-01', false, null],
      ['SEQ-1', true, null],
      ['Q-01', false, 'quality'],
    ]);
    // jen interní nebo jen externí lokace
    expect(line('FG-1', 'internal')).toMatchObject({ free: 25, external: 0 });
    expect(line('FG-1', 'external')).toMatchObject({ free: 10, external: 10, blocked: 0 });
  });

  it('jen díly se zásobou; PG přes kusovník, zásoba nad celou potřebu; bez potřeby s důvodem; ostatní jen hodnota', () => {
    // SFG-1 má potřebu, ale skladem není (mezivýroba): v Zásobách se neukáže, chybějící díly řeší Komponenty
    expect(line('SFG-1')).toBeUndefined();
    expect(line('PG-1')).toMatchObject({ kind: 'PG', projects: ['P1'], categories: ['DP'], free: 2000, value: 1000, horizonDemand: 200, days: null, band: 'over', max: 200, overMax: 1800 });
    // nad celou potřebu do konce odvolávek: 2000 − 200 = 1800 ks po 0,5
    expect(line('PG-1')).toMatchObject({ surplus: 1800, surplusValue: 900, noNeed: null });
    // PG-2 není v žádném kusovníku: bez potřeby, celá zásoba nad potřebu
    expect(line('PG-2')).toMatchObject({ band: 'none', horizonDemand: 0, overMax: 0, surplus: 50, noNeed: 'notInBom' });
    expect(line('OTHER-1')).toMatchObject({ kind: 'other', band: 'other', value: 50, description: 'PALLET', surplus: 0, noNeed: null });
    const table = buildInventory(inputs);
    expect(table.negativeRows).toBe(1);
    expect(table.hasCost).toBe(true);
    expect(table.horizonEnd).toBe(day(23));
    expect(table.lines.map((l) => l.item)).toEqual(['FG-1', 'OTHER-1', 'PG-1', 'PG-2']);
  });

  it('kam jsou peníze: hodnota rozdělená podle potřeby, součet = volná + blokovaná hodnota', () => {
    // 300 ks po 2 Kč, maximum 100 ks, celá potřeba 250 ks → potřebná 200 Kč, nad maximem 300 Kč, nad celou potřebu 100 Kč
    const l = { kind: 'PG', band: 'over', free: 300, max: 100, unitCost: 2, value: 600, surplusValue: 100, blockedValue: 10 } as InventoryLine;
    expect(moneyParts(l)).toEqual({ needed: 200, overMax: 300, surplus: 100, none: 0, blocked: 10, other: 0 });
    // testovací sklad: FG-1 potřebná 35 × 100 a blokace 500, PG-1 do maxima 200 ks po 0,5 a nad potřebu 1800 ks,
    // PG-2 bez potřeby, paleta mimo mapování
    const table = buildInventory(inputs);
    expect(moneyTotals(table.lines)).toEqual({ needed: 3600, overMax: 0, surplus: 900, none: 100, blocked: 500, other: 50 });
    const value = table.lines.reduce((s, x) => s + x.value + x.blockedValue, 0);
    expect(Object.values(moneyTotals(table.lines)).reduce((a, b) => a + b, 0)).toBe(value);
  });

  it('bez odvolávek nemá žádný díl potřebu', () => {
    const table = buildInventory({ ...inputs, callOffs: undefined });
    expect(table.horizonEnd).toBeNull();
    expect(table.lines.find((l) => l.item === 'FG-1')).toMatchObject({ band: 'none', surplus: 0, noNeed: null });
  });

  it('bez potřeby: hotový díl bez odvolávek a komponenta jeho kusovníku', () => {
    const other = parseCallOffExport(parseCsv('Item Number,Date,Discrete Qty\nFG-9,12.10.2026,10'), 'Odvolavky_CW42.csv');
    if (!other.ok) throw new Error();
    const table = buildInventory({ ...inputs, callOffs: other.value });
    const by = (item: string) => table.lines.find((l) => l.item === item)!;
    expect(by('FG-1')).toMatchObject({ band: 'none', noNeed: 'noCallOffs', surplus: 35 });
    expect(by('PG-1')).toMatchObject({ band: 'none', noNeed: 'noCallOffs' });
    expect(by('PG-2')).toMatchObject({ band: 'none', noNeed: 'notInBom' });
  });
});
