import { describe, expect, it } from 'vitest';
import { dayFromParts } from './dates';
import {
  addItem,
  emptyOil,
  nextProgress,
  oilSheets,
  originalDue,
  parseOilWorkbook,
  statusOf,
  updateItem,
  withComment,
  withDue,
  withProgress,
  type OilItem,
} from './oil';
import type { Cell } from './table';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const TODAY = day(14);

/** Listy jako po načtení z Excelu: záhlaví a řádky. */
const toSheets = (sheets: { name: string; header: string[]; rows: (string | number | null)[][] }[]) =>
  sheets.map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] }));

function sample(): OilItem {
  const { list, id } = addItem(emptyOil(), day(1));
  return list.items.find((i) => i.id === id)!;
}

describe('OIL', () => {
  it('nový bod dostane další číslo, otevřeno dnes, bez termínu a 0 %', () => {
    const a = addItem(emptyOil(), TODAY);
    const b = addItem(a.list, TODAY);
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(b.list.items[1]).toMatchObject({ opened: TODAY, due: null, progress: 0, cancelled: false, closed: null });
  });

  it('stav podle plnění a termínu', () => {
    const item = { ...sample(), due: day(20) };
    expect(statusOf(item, TODAY)).toBe('open');
    expect(statusOf({ ...item, progress: 50 }, TODAY)).toBe('progress');
    expect(statusOf({ ...item, progress: 50, due: day(13) }, TODAY)).toBe('overdue');
    expect(statusOf({ ...item, due: day(14) }, TODAY)).toBe('open'); // termín dnes ještě není po termínu
    expect(statusOf(withProgress({ ...item, due: day(1) }, 100, TODAY), TODAY)).toBe('done');
    expect(statusOf({ ...item, cancelled: true, due: day(1) }, TODAY)).toBe('cancelled');
  });

  it('plnění po krocích; 100 % uzavře bod, méně ho znovu otevře', () => {
    expect(([0, 25, 50, 75, 100] as const).map((p) => nextProgress(p))).toEqual([25, 50, 75, 100, 100]);
    const done = withProgress(sample(), 100, TODAY);
    expect(done.closed).toBe(TODAY);
    expect(withProgress(done, 100, day(20)).closed).toBe(TODAY);
    expect(withProgress(done, 75, TODAY).closed).toBeNull();
  });

  it('první termín se nastaví, každá změna je posun s důvodem a historií', () => {
    let item = withDue(sample(), day(20), '', 'Logistika', '1.10.2026 8:00');
    expect(item).toMatchObject({ due: day(20), shifts: [] });
    item = withDue(item, day(27), ' Čeká na dodavatele ', 'Logistika', '14.10.2026 9:15');
    item = withDue(item, day(27), 'beze změny', 'Logistika', '14.10.2026 9:16');
    item = withDue(item, day(30), 'Zkouška u zákazníka', 'Kvalita', '20.10.2026 10:00');
    expect(item.shifts).toEqual([
      { at: '14.10.2026 9:15', author: 'Logistika', from: day(20), to: day(27), reason: 'Čeká na dodavatele' },
      { at: '20.10.2026 10:00', author: 'Kvalita', from: day(27), to: day(30), reason: 'Zkouška u zákazníka' },
    ]);
    expect(originalDue(item)).toBe(day(20));
  });

  it('uloží do Excelu a znovu načte i s komentáři a posuny', () => {
    let list = addItem(addItem(emptyOil(), day(1)).list, day(2)).list;
    list = updateItem(list, 1, (i) => withComment({ ...i, problem: 'Chybí obaly', action: 'Objednat', owner: 'Logistika' }, 'Objednáno', 'Logistika', '2.10.2026 7:30'));
    list = updateItem(list, 1, (i) => withDue(withDue(i, day(10), '', 'L', ''), day(16), 'Pozdní dodávka', 'Logistika', '9.10.2026 14:05'));
    list = updateItem(list, 1, (i) => withProgress(i, 75, TODAY));
    list = updateItem(list, 2, (i) => withProgress({ ...i, problem: 'Hotová věc', due: day(5) }, 100, day(6)));
    list = updateItem(addItem(list, day(3)).list, 3, (i) => ({ ...i, problem: 'Zrušeno', cancelled: true }));

    const sheets = oilSheets(list, TODAY);
    expect(sheets.map((s) => s.name)).toEqual(['OIL', 'Komentáře', 'Posuny termínu']);
    expect(sheets[0]!.rows[0]).toEqual([1, 'Chybí obaly', 'Objednat', 'Logistika', '01.10.2026', '16.10.2026', '10.10.2026', 1, 75, 'Rozpracováno', null, 'Objednáno']);
    expect(sheets[0]!.rows.map((r) => r[9])).toEqual(['Rozpracováno', 'Hotovo', 'Zrušeno']);
    expect(parseOilWorkbook(toSheets(sheets))).toEqual({ ok: true, value: list });
  });

  it('bez sloupců bodů vrátí chybu', () => {
    expect(parseOilWorkbook([{ name: 'List1', data: [['A', 'B']] }])).toMatchObject({ ok: false, error: 'missingColumns' });
  });
});
