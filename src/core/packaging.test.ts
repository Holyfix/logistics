import { describe, expect, it } from 'vitest';
import { dayFromParts } from './dates';
import {
  addItem,
  appendItems,
  currentStep,
  moveStep,
  packagingSheets,
  parseLooseDay,
  parsePackagingWorkbook,
  parseStepText,
  statusOf,
  withDone,
  withDue,
  type PackItem,
  type PackList,
} from './packaging';
import type { Cell } from './table';

const d = (day: number, month: number, year = 2026) => dayFromParts(year, month, day)!;
const today = d(12, 11); // čtvrtek CW46

const item = (steps: PackItem['steps'], extra: Partial<PackItem> = {}): PackItem => ({
  id: 1,
  title: 'Bod',
  project: 'P100',
  note: '',
  created: d(1, 11),
  cancelled: false,
  steps,
  comments: [],
  shifts: [],
  ...extra,
});

describe('text kroku z checklistu', () => {
  it('datum bez roku (nejbližší dnešku) a CW (pátek týdne)', () => {
    expect(parseLooseDay('16.11.', today)).toBe(d(16, 11));
    expect(parseLooseDay('5.1.', today)).toBe(d(5, 1, 2027));
    expect(parseLooseDay('30.1.2027', today)).toBe(d(30, 1, 2027));
    expect(parseLooseDay('CW50', today)).toBe(d(11, 12));
    expect(parseLooseDay('CW02/27', today)).toBe(d(15, 1, 2027));
    expect(parseLooseDay('CW 8', today)).toBe(d(26, 2, 2027));
    expect(parseLooseDay('TBD', today)).toBeNull();
  });

  it('oddělí termín a jméno v závorce, jinak nechá text celý', () => {
    expect(parseStepText('Calculation of quantity + PR - 16.11.', today)).toEqual({ text: 'Calculation of quantity + PR', owner: '', due: d(16, 11), done: null });
    expect(parseStepText('Send calculation, ask for budget - 20.11. (Novák)', today)).toEqual({ text: 'Send calculation, ask for budget', owner: 'Novák', due: d(20, 11), done: null });
    expect(parseStepText('Transport test (A. Dvořák + Svoboda) - 17.11.', today)).toMatchObject({ text: 'Transport test', owner: 'A. Dvořák + Svoboda', due: d(17, 11) });
    expect(parseStepText('Approval process - CW50', today)).toMatchObject({ text: 'Approval process', due: d(11, 12) });
    expect(parseStepText('Start modifications CW02/27', today)).toMatchObject({ text: 'Start modifications', due: d(15, 1, 2027) });
    expect(parseStepText('Prepare list of racks (300pcs)', today)).toEqual({ text: 'Prepare list of racks (300pcs)', owner: '', due: null, done: null });
    expect(parseStepText('Delivery date?', today)).toEqual({ text: 'Delivery date?', owner: '', due: null, done: null });
    // Dva termíny v jednom kroku: text zůstane celý, doplní se ručně.
    expect(parseStepText('RFQ - 20.11.(Černá), PO - 4.12. (Novák)', today)).toEqual({ text: 'RFQ - 20.11.(Černá), PO - 4.12. (Novák)', owner: '', due: null, done: null });
  });
});

describe('stav bodu', () => {
  it('aktuální krok = první nesplněný; po termínu, tento týden, otevřeno, hotovo, zrušeno', () => {
    const a = item([
      { text: 'A', owner: 'X', due: d(5, 11), done: d(5, 11) },
      { text: 'B', owner: 'Y', due: d(11, 11), done: null },
      { text: 'C', owner: 'Z', due: d(20, 11), done: null },
    ]);
    expect(currentStep(a)?.text).toBe('B');
    expect(statusOf(a, today)).toBe('overdue');
    expect(statusOf(withDone(a, 1, true, today), today)).toBe('open');
    expect(statusOf(item([{ text: 'B', owner: '', due: d(15, 11), done: null }]), today)).toBe('week');
    expect(statusOf(item([{ text: 'B', owner: '', due: null, done: null }]), today)).toBe('open');
    expect(statusOf(item([{ text: 'B', owner: '', due: null, done: d(1, 11) }]), today)).toBe('done');
    expect(statusOf({ ...a, cancelled: true }, today)).toBe('cancelled');
  });

  it('posun termínu se zapíše do historie, první termín ne', () => {
    let a = item([{ text: 'B', owner: '', due: null, done: null }]);
    a = withDue(a, 0, d(13, 11), '', 'Novák', '12.11.2026 8:00');
    expect(a.shifts).toEqual([]);
    a = withDue(a, 0, d(20, 11), 'čeká na dodavatele', 'Novák', '12.11.2026 8:05');
    expect(a.steps[0]!.due).toBe(d(20, 11));
    expect(a.shifts).toEqual([{ at: '12.11.2026 8:05', author: 'Novák', step: 'B', from: d(13, 11), to: d(20, 11), reason: 'čeká na dodavatele' }]);
  });

  it('přesun kroku a nové body s novými čísly', () => {
    const a = item([
      { text: 'A', owner: '', due: null, done: null },
      { text: 'B', owner: '', due: null, done: null },
    ]);
    expect(moveStep(a, 1, -1).steps.map((s) => s.text)).toEqual(['B', 'A']);
    expect(moveStep(a, 0, -1)).toBe(a);
    const { list } = addItem({ items: [a] }, today);
    expect(list.items.map((i) => i.id)).toEqual([1, 2]);
    expect(appendItems(list, [a, a]).items.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('soubor Obaly.xlsx', () => {
  const sheetsOf = (list: PackList) =>
    packagingSheets(list, today).map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] }));

  it('uložení a načtení vrátí stejné body, kroky, komentáře a posuny', () => {
    const list: PackList = {
      items: [
        item(
          [
            { text: 'Koncept', owner: 'Dvořák', due: d(3, 11), done: d(3, 11) },
            { text: 'Transportní test', owner: 'Svoboda', due: d(17, 11), done: null },
          ],
          { note: 'Prototyp hotový', comments: [{ at: '10.11.2026 9:15', author: 'Novák', text: 'Test v úterý' }], shifts: [{ at: '9.11.2026 8:00', author: 'Novák', step: 'Transportní test', from: d(13, 11), to: d(17, 11), reason: 'linka stojí' }] },
        ),
        item([], { id: 2, title: 'Zrušený', cancelled: true }),
      ],
    };
    const sheets = sheetsOf(list);
    expect(sheets.map((s) => s.name)).toEqual(['Obaly', 'Kroky', 'Komentáře', 'Posuny termínu']);
    expect(sheets[0]!.data[1]!.slice(5, 10)).toEqual(['Otevřeno', 'Transportní test', 'Svoboda', '17.11.2026', '1/2']);
    const result = parsePackagingWorkbook(sheets, today);
    expect(result).toEqual({ ok: true, value: list, source: 'app' });
  });

  it('checklist: Description | Status | Step 0 … → body s kroky', () => {
    const sheets = [
      { name: 'Jiný', data: [['PO number', 'Description']] as Cell[][] },
      {
        name: 'List5',
        data: [
          ['Description', 'Status', 'Step 0', 'Step 1', 'Step 2'],
          ['P100 rack', 'Validate', 'Calculation - 16.11.', 'Revalidation (Svoboda) - CW48', null],
          ['P200 cover', 'DONE', null, null, null],
          [null, null, null, null, null],
          ['P300 KLT', null, 'Offer', 'PR/PO', 'Delivery date?'],
        ] as Cell[][],
      },
    ];
    const result = parsePackagingWorkbook(sheets, today);
    expect(result.ok && result.source).toBe('checklist');
    if (!result.ok) return;
    expect(result.value.items.map((i) => [i.id, i.title, i.note, i.steps.length])).toEqual([
      [1, 'P100 rack', 'Validate', 2],
      [2, 'P200 cover', 'DONE', 1],
      [3, 'P300 KLT', '', 3],
    ]);
    expect(result.value.items[0]!.steps[1]).toEqual({ text: 'Revalidation', owner: 'Svoboda', due: d(27, 11), done: null });
    expect(statusOf(result.value.items[1]!, today)).toBe('done');
  });

  it('soubor bez potřebných sloupců', () => {
    expect(parsePackagingWorkbook([{ name: 'X', data: [['A', 'B']] }], today)).toEqual({ ok: false, error: 'missingColumns', columns: ['Číslo', 'Bod', 'Krok'] });
  });
});
