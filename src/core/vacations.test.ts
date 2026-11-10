import { describe, expect, it } from 'vitest';
import type { Cell } from './table';
import { dayFromParts } from './dates';
import {
  addEntry,
  addPerson,
  allowanceOf,
  awayOn,
  balanceOf,
  easterSunday,
  emptyVacations,
  entryDays,
  holidays,
  isWorkday,
  parseVacationWorkbook,
  removePerson,
  renamePerson,
  setAllowance,
  updateEntry,
  vacationSheets,
  workdays,
  type VacationData,
} from './vacations';

const day = (m: number, d: number, y = 2026) => dayFromParts(y, m, d)!;

const data: VacationData = {
  people: [
    { name: 'Anna', team: 'Sklad' },
    { name: 'Petr', team: 'Expedice' },
  ],
  allowances: [{ person: 'Anna', year: 2026, entitlement: 25, carryOver: 3 }],
  entries: [
    { id: 1, person: 'Anna', from: day(11, 2), to: day(11, 6), half: false, status: 'approved', note: '' },
    { id: 2, person: 'Anna', from: day(12, 21), to: day(12, 31), half: false, status: 'planned', note: 'Vánoce' },
    { id: 3, person: 'Petr', from: day(11, 10), to: day(11, 10), half: true, status: 'approved', note: '' },
  ],
  maxAway: 1,
};

describe('Dovolené – kalendář', () => {
  it('Velikonoce a státní svátky ČR', () => {
    expect(easterSunday(2026)).toBe(day(4, 5));
    expect(easterSunday(2027)).toBe(day(3, 28, 2027));
    const h = holidays(2026);
    expect(h.has(day(4, 3))).toBe(true); // Velký pátek
    expect(h.has(day(4, 6))).toBe(true); // Velikonoční pondělí
    expect(h.has(day(11, 17))).toBe(true);
    expect(h.size).toBe(13);
    expect(isWorkday(day(11, 17))).toBe(false);
    expect(isWorkday(day(11, 14))).toBe(false); // sobota
    expect(isWorkday(day(11, 16))).toBe(true);
  });

  it('pracovní dny bez víkendů a svátků; půl dne = 0,5', () => {
    expect(workdays(day(11, 16), day(11, 22))).toBe(4); // 17. 11. svátek
    expect(entryDays(data.entries[1]!)).toBe(7); // 21.–31. 12.: bez 24.–26. 12. a víkendu
    expect(entryDays(data.entries[2]!)).toBe(0.5);
    expect(entryDays(data.entries[0]!, day(11, 4))).toBe(3);
  });
});

describe('Dovolené – nárok a čerpání', () => {
  it('vyčerpáno do dneška, naplánováno po dnešku, neschváleno a zbývá', () => {
    const b = balanceOf(data, 'Anna', 2026, day(11, 10));
    expect(b).toEqual({ entitlement: 25, carryOver: 3, total: 28, taken: 5, planned: 7, unapproved: 7, remaining: 16 });
    // Bez zápisu nároku výchozí 20 dní; další rok převezme nárok bez převodu.
    expect(balanceOf(data, 'Petr', 2026, day(11, 10))).toMatchObject({ total: 20, taken: 0.5, remaining: 19.5 });
    expect(allowanceOf(data, 'Anna', 2027)).toEqual({ person: 'Anna', year: 2027, entitlement: 25, carryOver: 0 });
  });

  it('kdo je v den na dovolené (víkend nikdo)', () => {
    expect(awayOn(data, day(11, 4)).map((e) => e.person)).toEqual(['Anna']);
    expect(awayOn(data, day(11, 7))).toEqual([]);
  });
});

describe('Dovolené – úpravy a soubor', () => {
  it('osoby, nárok a záznamy', () => {
    expect(addPerson(data, 'Anna')).toBeNull();
    const renamed = renamePerson(data, 'Anna', 'Anna N.')!;
    expect(renamed.entries.filter((e) => e.person === 'Anna N.')).toHaveLength(2);
    expect(renamed.allowances[0]!.person).toBe('Anna N.');
    expect(renamePerson(data, 'Anna', 'Petr')).toBeNull();
    expect(removePerson(data, 'Anna').entries.map((e) => e.id)).toEqual([3]);
    expect(setAllowance(data, 'Petr', 2026, { carryOver: 2 }).allowances.find((a) => a.person === 'Petr')).toEqual({ person: 'Petr', year: 2026, entitlement: 20, carryOver: 2 });
    const added = addEntry(emptyVacations(), 'Anna', day(11, 20), day(11, 18));
    expect(added.data.entries[0]).toMatchObject({ id: 1, from: day(11, 18), to: day(11, 20), status: 'planned' });
    // Půl dne jen u jednoho dne.
    const half = updateEntry(added.data, 1, (e) => ({ ...e, half: true }));
    expect(half.entries[0]!.half).toBe(false);
  });

  it('uložení a načtení vrátí stejná data', () => {
    const sheets = vacationSheets(data);
    expect(sheets.map((s) => s.name)).toEqual(['Lidé', 'Nárok', 'Dovolené', 'Nastavení']);
    expect(sheets[2]!.rows[0]).toEqual([1, 'Anna', '02.11.2026', '06.11.2026', 'Ne', 'Schváleno', 5, null]);
    const back = parseVacationWorkbook(sheets.map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] })));
    if (!back.ok) throw new Error();
    expect(back.value).toEqual({ ...data, entries: [...data.entries].sort((a, b) => a.from - b.from) });
  });

  it('chybějící sloupce nahlásí', () => {
    expect(parseVacationWorkbook([{ name: 'X', data: [['Něco']] }])).toMatchObject({ ok: false, error: 'missingColumns' });
  });
});
