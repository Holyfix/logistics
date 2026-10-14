import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import { parseMasterData } from '../masterdata';
import { parseCsv } from '../csv';
import { assemblyItems, autoPlan, evaluateItem, packOf, plannedTotal, roundUpToPack, slotCapacity, slotSides, type PlanItem } from './assembly';
import { sideGroup } from '../masterdata';
import { cellKey, emptyPlan, parsePlanWorkbook, planFileName, planSheets, shiftSlots, sideOrder, slotKey } from './plan';
import { DEFAULT_SETTINGS, destinationOf, lineCapacity, parseSettings, parseShifts, parseTime, settingsSheets, type PlanSettings } from './settings';
import type { Cell } from '../table';
import type { CoverageSource } from '../coverage/compute';

const MON = dayFromParts(2026, 10, 12)!;
const TUE = MON + 1;
const at = (day: number, hours: number) => day * 1440 + hours * 60;
const toSheets = (sheets: { name: string; header: string[]; rows: (string | number | null)[][] }[]) =>
  sheets.map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] }));

describe('nastavení', () => {
  it('čte časy a směny v různých zápisech', () => {
    expect(parseTime('6:00')).toBe(360);
    expect(parseTime('06:30')).toBe(390);
    expect(parseTime(0.25)).toBe(360);
    expect(parseTime(14)).toBe(840);
    expect(parseTime('x')).toBeNull();
    expect(parseShifts('R O N')).toEqual(['R', 'O', 'N']);
    expect(parseShifts('r,n')).toEqual(['R', 'N']);
    expect(parseShifts(2)).toEqual(['R', 'O']);
  });

  it('uloží a znovu načte kapacity a dopravu', () => {
    const settings: PlanSettings = {
      firstShiftStart: 330,
      lines: [{ line: 'ASSEMBLY', project: 'P100', perShift: 120, shifts: ['R', 'O'], pack: 16 }],
      destinations: [
        { location: 'Lokalita A', coverDays: 2, transitHours: 24, arrival: 360 },
        { location: '', coverDays: 3, transitHours: 48, arrival: 420 },
      ],
    };
    expect(parseSettings(toSheets(settingsSheets(settings)))).toEqual(settings);
  });

  it('bez řádku platí výchozí kapacita 0 a doprava 2 dny / 24 h / 6:00, jinak řádek „ostatní“', () => {
    expect(lineCapacity(DEFAULT_SETTINGS, 'ASSEMBLY', 'P1')).toMatchObject({ perShift: 0, shifts: ['R', 'O', 'N'], pack: 12 });
    expect(destinationOf(DEFAULT_SETTINGS, 'X')).toMatchObject({ coverDays: 2, transitHours: 24, arrival: 360 });
    const s = { ...DEFAULT_SETTINGS, destinations: [{ location: '', coverDays: 1, transitHours: 12, arrival: 300 }] };
    expect(destinationOf(s, 'X').transitHours).toBe(12);
  });
});

describe('směny a soubor plánu', () => {
  it('ranní směna začíná v nastavený čas, noční končí další den', () => {
    const slots = shiftSlots(MON, 1, 360);
    expect(slots.map((s) => s.key)).toEqual(['2026-10-12 R', '2026-10-12 O', '2026-10-12 N']);
    expect(slots[2]).toMatchObject({ start: at(MON, 22), end: at(TUE, 6) });
  });

  it('kapacita směny: ruční hodnota, jinak kapacita linky v pracovní dny', () => {
    const line = { line: 'ASSEMBLY', project: 'P', perShift: 100, shifts: ['R', 'O'] as const, pack: 12 };
    const [r, , n] = shiftSlots(MON, 1, 360);
    const sat = shiftSlots(MON + 5, 1, 360)[0]!;
    expect(slotCapacity(r!, { ...line, shifts: [...line.shifts] }, {})).toBe(100);
    expect(slotCapacity(n!, { ...line, shifts: [...line.shifts] }, {})).toBe(0);
    expect(slotCapacity(sat, { ...line, shifts: [...line.shifts] }, {})).toBe(0);
    expect(slotCapacity(sat, { ...line, shifts: [...line.shifts] }, { [sat.key]: 60 })).toBe(60);
  });

  it('strany na směně navazují na předchozí směnu', () => {
    expect(sideOrder(new Set(['LHD', 'RHD']), '')).toEqual(['LHD', 'RHD']);
    expect(sideOrder(new Set(['LHD', 'RHD']), 'RHD')).toEqual(['RHD', 'LHD']);
  });

  it('plán uloží v pořadí výroby po stranách a znovu načte', () => {
    const plan = emptyPlan('ASSEMBLY', 'P100');
    const r = slotKey(MON, 'R');
    const o = slotKey(MON, 'O');
    plan.cells[cellKey(r, 'A')] = 10;
    plan.cells[cellKey(r, 'B')] = 20;
    plan.cells[cellKey(o, 'A')] = 5;
    plan.cells[cellKey(o, 'B')] = 7;
    plan.capacity[slotKey(MON + 5, 'R')] = 50;
    plan.auto[slotKey(MON + 5, 'R')] = 'RHD';
    plan.auto[slotKey(TUE, 'N')] = 'BOTH';
    const info = new Map([
      ['A', { customerNumber: 'C-A', description: 'Díl A', side: 'LHD' }],
      ['B', { customerNumber: 'C-B', description: 'Díl B', side: 'RHD' }],
    ]);
    const sheets = planSheets(plan, info);
    expect(sheets[0]!.rows).toEqual([
      ['ASSEMBLY', 'P100', '12.10.2026', 'R', 1, 'LHD', 'A', 'C-A', 'Díl A', 10],
      ['ASSEMBLY', 'P100', '12.10.2026', 'R', 2, 'RHD', 'B', 'C-B', 'Díl B', 20],
      ['ASSEMBLY', 'P100', '12.10.2026', 'O', 1, 'RHD', 'B', 'C-B', 'Díl B', 7],
      ['ASSEMBLY', 'P100', '12.10.2026', 'O', 2, 'LHD', 'A', 'C-A', 'Díl A', 5],
    ]);
    expect(sheets[1]!.rows[0]).toEqual(['A', 'C-A', 'LHD', 10, 5, 15]);
    expect(sheets[2]!.rows).toEqual([
      ['13.10.2026', 'N', null, 'LHD+RHD'],
      ['17.10.2026', 'R', 50, 'RHD'],
    ]);
    const back = parsePlanWorkbook(toSheets(sheets), 'Plán/ASSEMBLY_P100.xlsx');
    expect(back).toEqual({ ok: true, value: plan });
  });

  it('linku a projekt vezme z názvu souboru, když nejsou ve sloupcích', () => {
    const r = parsePlanWorkbook([{ name: 'List1', data: [['Datum', 'Směna', 'Díl', 'Množství'], ['12.10.2026', 'n', 'A', 3]] }], 'Plán/ASSEMBLY_P200.xlsx');
    expect(r).toEqual({ ok: true, value: { line: 'ASSEMBLY', project: 'P200', cells: { [cellKey('2026-10-12 N', 'A')]: 3 }, capacity: {}, auto: {} } });
    expect(planFileName('ASSEMBLY', 'P1/2')).toBe('ASSEMBLY_P1_2.xlsx');
  });
});

/** Soubor coverage s jedním dílem: stav (sklad + transit − plán zákazníka) na konci dnů. */
function coverageFile(item: string, location: string, project: string, days: number[], balance: number[]): CoverageSource {
  return {
    path: `Coverage/${location}/${project}/c.xlsx`,
    fileName: 'c.xlsx',
    location,
    project,
    lastModified: 0,
    report: {
      format: 'articles',
      sheet: 'articles',
      days,
      rows: [{ customerNumber: '', customerKey: '', supplierItem: item, description: 'PANEL RHD', customerStock: 0, balance, transit: days.map(() => 0), firstUncovered: '', uncoveredAt: '' }],
      issueCount: 0,
      issues: [],
    },
  } as CoverageSource;
}

describe('díly montáže z coverage', () => {
  it('jen díly se souborem coverage; stav u zákazníka po dnech a chybějící kusy', () => {
    const master = parseMasterData(parseCsv('Item Number;Project;Variant;Line;Order Multiple\nA;;LHD;Assembly;16\nB;P;RHD;FOA;\nC;P;LHD;ASSEMBLY;'));
    if (!master.ok) throw new Error();
    // Stav u sekvencéra: čt 15. 10. −40, pá 16. 10. −30 (zlepšení), po 19. 10. −70.
    const cov = coverageFile('A', 'Lokalita A', 'P1', [MON + 3, MON + 4, MON + 7], [-40, -30, -70]);
    const { days, items } = assemblyItems({ master: master.value, coverage: [cov], callOffs: undefined, stock: new Map([['A', 5]]), today: MON });
    // C je ASSEMBLY, ale bez souboru coverage → v plánu není; B je jiná linka.
    expect(items.map((i) => [i.item, i.project])).toEqual([['A', 'P1']]);
    expect(days[0]).toBe(MON);
    expect(days).toHaveLength(14);
    // před prvním dnem souboru platí počáteční stav (sklad + transit = 0)
    expect(items[0]!.base.slice(0, 9)).toEqual([0, 0, 0, -40, -30, -30, -30, -70, -70]);
    // za koncem souboru zůstává poslední stav
    expect(items[0]!.base.at(-1)).toBe(-70);
    expect(items[0]!.stock).toBe(5);
    expect(items[0]!.pack).toBe(16);
  });

  it('bez sloupce Line všechny díly ze souborů coverage', () => {
    const master = parseMasterData(parseCsv('Item Number;Project;Variant\nA;P;LHD\nK;;'));
    if (!master.ok) throw new Error();
    const cov = coverageFile('Z', 'L', 'P2', [MON + 3], [-10]);
    const { items } = assemblyItems({ master: master.value, coverage: [cov], callOffs: undefined, stock: undefined, today: MON });
    expect(items.map((i) => [i.item, i.side, i.project])).toEqual([['Z', 'RHD', 'P2']]);
  });
});

const item = (id: string, side: string, stock: number, base: number[], pack = 0): PlanItem => ({
  item: id,
  customerNumber: '',
  description: '',
  side,
  project: 'P',
  location: '',
  stock,
  pack,
  base,
});

describe('coverage s plánem', () => {
  it('naplánované kusy se přičtou do všech dnů coverage', () => {
    const it = item('A', 'LHD', 10, [30, 0, -40, -80]);
    const cells = {
      [cellKey(slotKey(MON - 1, 'N'), 'A')]: 99, // včerejší směna: už je v našem skladu
      [cellKey(slotKey(MON, 'R'), 'A')]: 20,
      [cellKey(slotKey(MON, 'N'), 'A')]: 10,
      [cellKey(slotKey(MON + 3, 'O'), 'A')]: 30,
      [cellKey(slotKey(MON, 'R'), 'B')]: 5,
    };
    const planned = plannedTotal(cells, 'A', [MON, TUE, MON + 2, MON + 3]);
    expect(planned).toBe(60);
    const s = evaluateItem(it, planned);
    expect(s.withoutPlan).toEqual([40, 10, -30, -70]);
    // první nepokrytý den −30 + 60 = 30, i když část výroby je až ve čtvrtek
    expect(s.coverage).toEqual([100, 70, 30, -10]);
    expect(s).toMatchObject({ planned: 60, shortDay: 3, shortDayWithoutPlan: 2, missing: 10 });
    expect(evaluateItem(item('B', 'RHD', 0, [1, 2]), 0)).toMatchObject({ shortDay: null, missing: 0 });
  });

  it('strana HUD patří ke své straně', () => {
    expect(['LHD', 'LHD HUD', 'rhd hud', 'RHD', 'HUD', ''].map(sideGroup)).toEqual(['LHD', 'LHD', 'RHD', 'RHD', '', '']);
  });

  it('strany na směnách navazují', () => {
    const slots = shiftSlots(MON, 1, 360);
    const a = item('A', 'LHD HUD', 0, []);
    const b = item('B', 'RHD', 0, []);
    const sides = slotSides([a, b], slots, (s, i) => (s.code === 'O' && i.item === 'A' ? 0 : 1));
    expect(sides).toEqual([['LHD', 'RHD'], ['RHD'], ['RHD', 'LHD']]);
  });
});

describe('automatický plán', () => {
  const days = [MON, TUE, MON + 2, MON + 3];
  const slots = shiftSlots(MON, 2, 360);
  const cap = () => 100;
  const qty = (cells: Record<string, number>, day: number, code: 'R' | 'O' | 'N', id: string) => cells[cellKey(slotKey(day, code), id)] ?? 0;

  it('směna zvolené strany kryje první nepokryté dny jejích dílů, po celých dnech', () => {
    // A (LHD) chybí po 60 a út dalších 60, B (RHD HUD) chybí po 50 a st dalších 80, C (LHD) chybí út 50.
    const a = item('A', 'LHD', 0, [-60, -120, -120, -120]);
    const b = item('B', 'RHD HUD', 0, [-50, -50, -130, -130]);
    const c = item('C', 'LHD', 0, [0, -50, -50, -50]);
    const auto = { [slotKey(MON, 'R')]: 'LHD', [slotKey(MON, 'O')]: 'RHD', [slotKey(MON, 'N')]: 'BOTH' } as const;
    const { cells, remaining } = autoPlan([a, b, c], days, {}, auto, slots, cap);
    // R (LHD): A 60 (po), pak út: A 40 (C až po A, stejný den, ale A je první v pořadí)
    expect([qty(cells, MON, 'R', 'A'), qty(cells, MON, 'R', 'B'), qty(cells, MON, 'R', 'C')]).toEqual([100, 0, 0]);
    // O (RHD): B 50 (po) + 50 z 80 (st)
    expect([qty(cells, MON, 'O', 'A'), qty(cells, MON, 'O', 'B')]).toEqual([0, 100]);
    // N (obě): A zbylých 20 (út), C 50 (út), B zbylých 30 (st)
    expect([qty(cells, MON, 'N', 'A'), qty(cells, MON, 'N', 'B'), qty(cells, MON, 'N', 'C')]).toEqual([20, 30, 50]);
    expect(remaining).toBe(0);
  });

  it('ruční směny a náš sklad se započítají, zbytek nepokrytých kusů vrátí', () => {
    const a = item('A', 'LHD', 50, [-100, -500, -1000, -1000]);
    const manual = { [cellKey(slotKey(MON, 'R'), 'A')]: 30, [cellKey(slotKey(MON, 'O'), 'A')]: 70 };
    const auto = { [slotKey(MON, 'O')]: 'LHD', [slotKey(MON, 'N')]: 'LHD', [slotKey(TUE, 'R')]: 'RHD' } as const;
    const { cells, remaining } = autoPlan([a], days, manual, auto, slots, cap);
    // R zůstane ručně 30; O je automatická, ruční 70 se nahradí výpočtem; RHD směna pro A nic.
    expect([qty(cells, MON, 'R', 'A'), qty(cells, MON, 'O', 'A'), qty(cells, MON, 'N', 'A'), qty(cells, TUE, 'R', 'A')]).toEqual([30, 100, 100, 0]);
    // chybí 1000 − sklad 50 − 30 − 200 = 720
    expect(remaining).toBe(720);
  });

  it('po celých baleních: kusy navíc pokryjí další dny, do kapacity se vejdou jen celá balení', () => {
    // A (balení 12) chybí po 50, út 20, st 100; B (balení linky 10) chybí po 25.
    const a = item('A', 'LHD', 0, [-50, -70, -170, -170], 12);
    const b = item('B', 'LHD', 0, [-25, -25, -25, -25]);
    const line = { line: 'ASSEMBLY', project: 'P', perShift: 100, shifts: [], pack: 10 };
    expect([packOf(a, line), packOf(b, line), roundUpToPack(50, 12), roundUpToPack(48, 12), roundUpToPack(5, 1)]).toEqual([12, 10, 60, 48, 5]);
    const auto = { [slotKey(MON, 'R')]: 'LHD', [slotKey(MON, 'O')]: 'LHD' } as const;
    const { cells, remaining } = autoPlan([a, b], days, {}, auto, slots, cap, (it) => packOf(it, line));
    // R: A 60 (50 po + 10 na út), B 30 (25 → 3 balení); zbývá 10, A potřebuje út zbylých 10 → 12 se nevejde.
    expect([qty(cells, MON, 'R', 'A'), qty(cells, MON, 'R', 'B')]).toEqual([60, 30]);
    // O: A út 10 → 12 (2 navíc na st), st 98 → 84 (7 balení, víc kapacita nedovolí).
    expect(qty(cells, MON, 'O', 'A')).toBe(96);
    expect(remaining).toBe(14);
  });

  it('při stejném dni pokračuje stranou, která se právě vyrábí', () => {
    const a = item('A', 'LHD', 0, [-50, -50]);
    const b = item('B', 'RHD', 0, [-50, -100]);
    const c = item('C', 'LHD', 0, [0, -50]);
    const auto = { [slotKey(MON, 'R')]: 'BOTH', [slotKey(MON, 'O')]: 'BOTH' } as const;
    const { cells } = autoPlan([a, b, c], days.slice(0, 2), {}, auto, slots, cap);
    // R: A, B (po); O: B pokračuje (RHD), pak C.
    expect([qty(cells, MON, 'R', 'A'), qty(cells, MON, 'R', 'B')]).toEqual([50, 50]);
    expect([qty(cells, MON, 'O', 'B'), qty(cells, MON, 'O', 'C')]).toEqual([50, 50]);
  });
});
