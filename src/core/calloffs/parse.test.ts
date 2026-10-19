import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv';
import { dayToIso } from '../dates';
import { parseCallOffExport, weekFromFileName, type CallOffExport } from './parse';

const HEADER =
  'Item Number,Item Description,Date,Time,Schedule Type,Interval,Reference,Discrete Qty,Cumulative Qty,Cum Shipped,Net Cumulative Quantity,Sales Order,Line,Release,Carline,Site,Ship-To';

function row(item: string, date: string, qty: string, cum: string, shipped: string, so = 'SO1', line = '1', shipTo = 'S1') {
  return `${item},Popis ${item},${date},,3,D,,"${qty}","${cum}","${shipped}","0,0",${so},${line},000001,X,1,${shipTo}`;
}

function parse(lines: string[], name = 'Odvolavky_CW42.csv'): CallOffExport {
  const result = parseCallOffExport(parseCsv([HEADER, ...lines].join('\r\n')), name);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('weekFromFileName', () => {
  it.each([
    ['Odvolávky_CW42.csv', 42],
    ['odvolavky cw 7.csv', 7],
    ['KW05 export.csv', 5],
    ['export.csv', null],
    ['CW99.csv', null],
  ])('%s → %s', (name, week) => expect(weekFromFileName(name)).toBe(week));
});

describe('parseCallOffExport', () => {
  it('sečte požadavky dílu po dnech přes odběrná místa a reference', () => {
    const exp = parse([
      row('1001', '12.10.2026', '752,0', '1 000,0', '200,0'),
      row('1001', '12.10.2026', '8,0', '1 008,0', '200,0'),
      row('1001', '12.10.2026', '10,0', '510,0', '500,0', 'SO2', '1', 'S2'),
      row('1001', '13.10.2026', '1 200,0', '2 208,0', '200,0'),
      row('Y0002', '19.10.2026', '5,0', '5,0', '0,0'),
    ]);
    expect(exp.items).toEqual(['1001', 'Y0002']);
    expect(exp.week).toBe(42);
    expect(exp.year).toBe(2026);
    expect(dayToIso(exp.exportDay)).toBe('2026-10-12');
    expect(dayToIso(exp.firstDay)).toBe('2026-10-12');
    expect(dayToIso(exp.lastDay)).toBe('2026-10-19');
    expect([...exp.days.slice(0, 2)].map(dayToIso)).toEqual(['2026-10-12', '2026-10-13']);
    expect([...exp.qty]).toEqual([770, 1200, 5]);
    expect(exp.descriptions[0]).toBe('Popis 1001');
  });

  it('spočítá nedodané množství z prvního řádku každého plánu', () => {
    const exp = parse([
      row('1001', '12.10.2026', '752,0', '1 000,0', '200,0'),
      row('1001', '13.10.2026', '100,0', '1 100,0', '200,0'),
      row('1001', '12.10.2026', '10,0', '510,0', '600,0', 'SO2', '1', 'S2'),
    ]);
    expect(exp.cumShipped[0]).toBe(800);
  });

  it('nahlásí chybné řádky a pokračuje', () => {
    const exp = parse([row('1001', '12.10.2026', '5,0', '5,0', '0,0'), row('1002', '31.02.2026', '5,0', '5,0', '0,0'), row('', '12.10.2026', '1,0', '1,0', '0,0')]);
    expect(exp.rowCount).toBe(1);
    expect(exp.issueCount).toBe(2);
    expect(exp.issues[0]).toMatchObject({ row: 3, message: 'invalidDate' });
    expect(exp.issues[1]).toMatchObject({ row: 4, message: 'missingValue' });
  });

  it('upozorní, když týden v názvu nesedí s daty', () => {
    const exp = parse([row('1001', '12.10.2026', '5,0', '5,0', '0,0')], 'Odvolavky_CW41.csv');
    expect(exp.week).toBe(41);
    expect(exp.issues[0]).toMatchObject({ message: 'weekMismatch' });
  });

  it('odmítne soubor bez povinných sloupců', () => {
    const result = parseCallOffExport(parseCsv('Item Number,Date\n1,12.10.2026'), 'x.csv');
    expect(result).toEqual({ ok: false, error: 'missingColumns', columns: ['Discrete Qty'] });
  });

  it('přečte i tabulku z Excelu s čísly a daty', () => {
    const result = parseCallOffExport(
      { header: ['Item Number', 'Date', 'Discrete Qty'], rows: [[900200, new Date(Date.UTC(2026, 0, 5)), 780]] },
      'Odvolavky_CW2.xlsx',
    );
    expect(result.ok && result.value.items).toEqual(['900200']);
    expect(result.ok && result.value.week).toBe(2);
  });
});
