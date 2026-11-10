import { describe, expect, it } from 'vitest';
import type { Cell } from './table';
import { dayFromParts } from './dates';
import {
  addActivity,
  addPerson,
  emptySkills,
  levelOf,
  nextLevel,
  parseSkillWorkbook,
  qualifiedCount,
  removeActivity,
  renameActivity,
  renamePerson,
  setValidity,
  skillSheets,
  trainingAlerts,
  trainingState,
  uncovered,
  validUntil,
  withLevel,
  withRecord,
  type SkillData,
} from './skills';

const day = (m: number, d: number, y = 2026) => dayFromParts(y, m, d)!;
const today = day(11, 10);

let data: SkillData = {
  people: [
    { name: 'Anna', team: 'Sklad' },
    { name: 'Petr', team: 'Sklad' },
    { name: 'Eva', team: 'Expedice' },
  ],
  activities: [
    { name: 'VZV', area: 'Sklad', minQualified: 2 },
    { name: 'Sekvence', area: 'Výroba', minQualified: 1 },
  ],
  levels: {},
  trainings: [
    { name: 'BOZP', validityMonths: 12 },
    { name: 'Průkaz VZV', validityMonths: null },
  ],
  records: [],
};
data = withLevel(withLevel(withLevel(data, 'Anna', 'VZV', 4), 'Petr', 'VZV', 2), 'Eva', 'Sekvence', 3);
data = withRecord(withRecord(withRecord(data, 'Anna', 'BOZP', day(11, 1, 2025)), 'Petr', 'BOZP', day(11, 20, 2025)), 'Eva', 'Průkaz VZV', day(3, 1, 2020));

describe('Skill Matrix', () => {
  it('úrovně, zástupnost a činnosti bez zástupu', () => {
    expect(levelOf(data, 'Anna', 'VZV')).toBe(4);
    expect(levelOf(data, 'Anna', 'Sekvence')).toBe(0);
    expect(nextLevel(4)).toBe(0);
    expect(qualifiedCount(data, 'VZV')).toBe(1);
    expect(uncovered(data).map((a) => a.name)).toEqual(['VZV']);
    // Úroveň 0 se nezapisuje.
    expect(withLevel(data, 'Anna', 'VZV', 0).levels).not.toHaveProperty('Anna|VZV');
  });

  it('platnost školení: měsíce od absolvování, konec měsíce, trvale', () => {
    expect(validUntil(day(1, 31), 1)).toBe(day(2, 28));
    expect(validUntil(day(11, 20, 2025), 12)).toBe(day(11, 20));
    expect(validUntil(day(1, 1), null)).toBeNull();
    const alerts = trainingAlerts(data, today);
    expect(alerts.expired.map((r) => r.person)).toEqual(['Anna']);
    expect(alerts.soon.map((r) => r.person)).toEqual(['Petr']);
    expect(trainingState(undefined, today)).toBe('none');
    expect(trainingState(data.records.find((r) => r.person === 'Eva'), today)).toBe('ok');
    // Nová platnost přepočítá „platí do“.
    expect(setValidity(data, 'BOZP', 24).records.find((r) => r.person === 'Anna')!.validUntil).toBe(day(11, 1, 2027));
  });

  it('úpravy seznamů přenesou úrovně i školení', () => {
    expect(addPerson(data, 'Anna')).toBeNull();
    expect(addActivity(data, ' ')).toBeNull();
    const renamed = renamePerson(data, 'Anna', 'Anna N.')!;
    expect(levelOf(renamed, 'Anna N.', 'VZV')).toBe(4);
    expect(renamed.records.some((r) => r.person === 'Anna N.')).toBe(true);
    expect(levelOf(renameActivity(data, 'VZV', 'Vysokozdvižný vozík')!, 'Anna', 'Vysokozdvižný vozík')).toBe(4);
    expect(removeActivity(data, 'VZV').levels).toEqual({ 'Eva|Sekvence': 3 });
    expect(addPerson(emptySkills(), ' Jan ', 'Sklad')!.people).toEqual([{ name: 'Jan', team: 'Sklad' }]);
  });

  it('uložení a načtení vrátí stejná data', () => {
    const sheets = skillSheets(data);
    expect(sheets.map((s) => s.name)).toEqual(['Lidé', 'Činnosti', 'Dovednosti', 'Matice', 'Školení', 'Absolvováno']);
    expect(sheets[3]!.rows[0]).toEqual(['Anna', 'Sklad', 4, 0]);
    const back = parseSkillWorkbook(sheets.map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] })));
    if (!back.ok) throw new Error();
    expect(back.value.people).toEqual(data.people);
    expect(back.value.activities).toEqual(data.activities);
    expect(back.value.levels).toEqual(data.levels);
    expect(back.value.trainings).toEqual(data.trainings);
    expect([...back.value.records].sort((a, b) => a.person.localeCompare(b.person))).toEqual([...data.records].sort((a, b) => a.person.localeCompare(b.person)));
  });
});
