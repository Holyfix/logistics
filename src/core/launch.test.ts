import { describe, expect, it } from 'vitest';
import { dayFromParts } from './dates';
import {
  addItem,
  addProject,
  emptyLaunch,
  groupStatus,
  launchSheets,
  launchSummary,
  parseLaunchWorkbook,
  phasesOf,
  progressOf,
  removeProject,
  renameProject,
  shiftDays,
  statusOf,
  timelineRange,
  withEnd,
  withKind,
  withStart,
  type LaunchItem,
  type LaunchPlan,
} from './launch';
import type { Cell } from './table';

const day = (m: number, d: number, y = 2026) => dayFromParts(y, m, d)!;
const today = day(11, 6);

const item = (over: Partial<LaunchItem>): LaunchItem => ({
  id: 1,
  project: 'P1',
  phase: '',
  name: 'Úkol',
  kind: 'task',
  start: null,
  end: null,
  baseline: null,
  owner: '',
  customer: false,
  progress: 0,
  note: '',
  ...over,
});

const plan: LaunchPlan = {
  projects: [
    { name: 'P1', description: 'Zákazník A' },
    { name: 'P2', description: '' },
  ],
  items: [
    item({ id: 1, phase: 'Kvalita', name: 'Díly s PPA', kind: 'milestone', end: day(11, 11), owner: 'Kvalita' }),
    item({ id: 2, phase: 'Testy', name: 'Díly pro test 1', kind: 'milestone', end: day(1, 11, 2027), owner: 'Logistika', customer: true }),
    item({ id: 3, phase: 'Testy', name: 'Obaly', start: day(10, 20), end: day(11, 3), progress: 50, owner: 'Logistika / Nákup' }),
    item({ id: 4, phase: 'Kvalita', name: 'Uvolnění', kind: 'milestone', end: day(11, 1), progress: 100 }),
    item({ id: 5, project: 'P2', name: 'SOP', kind: 'milestone', end: day(5, 1, 2027), baseline: day(4, 1, 2027), customer: true }),
  ],
};

describe('Launch – stav a souhrny', () => {
  it('stav úkolu a milníku podle plnění, termínu a začátku', () => {
    expect(statusOf(item({ progress: 100, end: day(11, 1) }), today)).toBe('done');
    expect(statusOf(item({ end: day(11, 5) }), today)).toBe('overdue');
    expect(statusOf(item({ start: day(11, 1), end: day(11, 20) }), today)).toBe('open');
    expect(statusOf(item({ start: day(11, 1), end: day(11, 20), progress: 25 }), today)).toBe('started');
    expect(statusOf(item({ kind: 'milestone', end: day(11, 20), progress: 50 }), today)).toBe('advanced');
    expect(statusOf(item({ kind: 'milestone', end: day(11, 6) }), today)).toBe('open');
    expect(statusOf(item({}), today)).toBe('nodate');
    // Zákaznický termín plnění ani po termínu nemá.
    expect(statusOf(item({ customer: true, kind: 'milestone', end: day(11, 1) }), today)).toBe('customer');
  });

  it('skupina: po termínu má přednost, hotovo jen když je hotové vše', () => {
    const p1 = plan.items.filter((i) => i.project === 'P1');
    expect(groupStatus(p1, today)).toBe('overdue');
    expect(groupStatus([plan.items[3]!], today)).toBe('done');
    expect(groupStatus([plan.items[0]!, plan.items[3]!], today)).toBe('advanced');
    expect(groupStatus([plan.items[1]!], today)).toBe('customer');
    // Plnění jen z interních řádků; bez interních null.
    expect(progressOf(p1)).toBe(50);
    expect(progressOf([plan.items[4]!])).toBeNull();
  });

  it('fáze v pořadí podle nejdřívějšího data, řádky ve fázi podle data', () => {
    const groups = phasesOf(plan.items.filter((i) => i.project === 'P1'));
    expect(groups.map((g) => g.phase)).toEqual(['Testy', 'Kvalita']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual([3, 2]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual([4, 1]);
  });

  it('přehled: po termínu, nejbližší nehotový milník a plnění', () => {
    const s = launchSummary(plan, today);
    expect(s).toMatchObject({ projects: 2, items: 5, overdue: 1, progress: 50 });
    expect(s.next?.id).toBe(1);
  });

  it('osa: celé měsíce včetně dneška s týdnem rezervy', () => {
    const range = timelineRange(plan.items, today);
    expect(range).toEqual({ from: day(10, 1), to: day(6, 1, 2027) });
    expect(timelineRange([], today)).toEqual({ from: day(10, 1), to: day(12, 1) });
  });
});

describe('Launch – úpravy', () => {
  it('posun termínu si zapamatuje původní termín, návrat na něj posun zruší', () => {
    const a = item({ end: day(11, 10) });
    const b = withEnd(a, day(11, 17));
    expect(b).toMatchObject({ end: day(11, 17), baseline: day(11, 10) });
    expect(shiftDays(b)).toBe(7);
    expect(withEnd(b, day(11, 24)).baseline).toBe(day(11, 10));
    expect(withEnd(b, day(11, 10)).baseline).toBeNull();
    // První nastavení termínu není posun.
    expect(withEnd(item({}), day(11, 10)).baseline).toBeNull();
  });

  it('začátek po konci posune konec, konec před začátkem posune začátek', () => {
    const a = item({ start: day(11, 1), end: day(11, 10) });
    expect(withStart(a, day(11, 12))).toMatchObject({ start: day(11, 12), end: day(11, 12), baseline: day(11, 10) });
    expect(withEnd(a, day(10, 25))).toMatchObject({ start: day(10, 25), end: day(10, 25) });
  });

  it('změna typu: milník bez začátku, úkol začíná v den termínu', () => {
    const task = item({ start: day(11, 1), end: day(11, 10) });
    const ms = withKind(task, 'milestone');
    expect(ms).toMatchObject({ kind: 'milestone', start: null, end: day(11, 10) });
    expect(withKind(ms, 'task')).toMatchObject({ kind: 'task', start: day(11, 10) });
  });

  it('projekty: volný název, přejmenování i u řádků, smazání i s řádky', () => {
    const a = addProject(emptyLaunch(), 'Nový projekt');
    const b = addProject(a.plan, 'Nový projekt');
    expect(b.name).toBe('Nový projekt 2');
    expect(renameProject(plan, 'P1', 'P2')).toBeNull();
    expect(renameProject(plan, 'P1', '  ')).toBeNull();
    const renamed = renameProject(plan, 'P1', 'Projekt A')!;
    expect(renamed.projects.map((p) => p.name)).toEqual(['Projekt A', 'P2']);
    expect(renamed.items.filter((i) => i.project === 'Projekt A')).toHaveLength(4);
    expect(removeProject(plan, 'P1').items.map((i) => i.id)).toEqual([5]);
  });

  it('nový úkol a milník dostanou další číslo, termín od dneška a fázi posledního řádku', () => {
    const t = addItem(plan, 'P1', 'task', today);
    expect(t.id).toBe(6);
    expect(t.plan.items.at(-1)).toMatchObject({ kind: 'task', start: today, end: today + 13, phase: 'Kvalita' });
    const m = addItem(plan, 'P2', 'milestone', today);
    expect(m.plan.items.at(-1)).toMatchObject({ kind: 'milestone', start: null, end: today, phase: '', customer: false });
    // Termín zákazníka dostane fázi posledního zákaznického řádku.
    expect(addItem(plan, 'P1', 'milestone', today, true).plan.items.at(-1)).toMatchObject({ customer: true, phase: 'Testy' });
  });
});

describe('Launch – soubor', () => {
  it('uložení a načtení vrátí stejný plán', () => {
    const sheets = launchSheets(plan, today);
    expect(sheets.map((s) => s.name)).toEqual(['Launch', 'Projekty']);
    expect(sheets[0]!.rows[0]).toEqual([3, 'P1', 'Testy', 'Obaly', 'Úkol', '20.10.2026', '03.11.2026', null, 'Logistika / Nákup', 'Interní', 50, 'Po termínu', null]);
    expect(sheets[0]!.rows.find((r) => r[0] === 2)).toEqual([2, 'P1', 'Testy', 'Díly pro test 1', 'Milník', null, '11.01.2027', null, 'Logistika', 'Zákazník', null, 'Termín zákazníka', null]);
    const back = parseLaunchWorkbook(sheets.map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] })));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.projects).toEqual(plan.projects);
    expect([...back.value.items].sort((a, b) => a.id - b.id)).toEqual(plan.items);
  });

  it('bez listu Projekty se projekty vezmou z řádků; typ, data z Excelu a plnění se srovnají', () => {
    const data: Cell[][] = [
      ['ID', 'Project', 'Phase', 'Name', 'Type', 'Start', 'End', 'Owner', 'Progress'],
      [1, 'X', 'SOP', 'Start', 'Milestone', null, new Date(Date.UTC(2027, 4, 1)), 'A', 120],
      [2, 'X', '', 'Plán', 'Task', '1.2.2027', '15.2.2027', '', '40'],
      [2, 'X', '', 'Duplicitní číslo', 'Task', '', '', '', ''],
      [3, '', '', 'Bez projektu', 'Task', '', '', '', ''],
    ];
    const r = parseLaunchWorkbook([{ name: 'List1', data }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.projects).toEqual([{ name: 'X', description: '' }]);
    expect(r.value.items).toMatchObject([
      // Bez sloupce Zdroj jsou milníky termíny zákazníka a úkoly interní.
      { id: 1, kind: 'milestone', start: null, end: day(5, 1, 2027), progress: 100, customer: true },
      { id: 2, kind: 'task', start: day(2, 1, 2027), end: day(2, 15, 2027), progress: 40, customer: false },
    ]);
  });

  it('chybějící sloupce nahlásí', () => {
    expect(parseLaunchWorkbook([{ name: 'X', data: [['Projekt', 'Název']] }])).toEqual({ ok: false, error: 'missingColumns', columns: ['ID', 'Projekt', 'Název', 'Konec / termín'] });
  });
});
