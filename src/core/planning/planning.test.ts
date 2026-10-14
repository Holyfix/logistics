import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import { parseMasterData } from '../masterdata';
import { parseCsv } from '../csv';
import { assemblyItems, evaluateItem, plannedByDay, proposePlan, slotCapacity, slotSides, type PlanItem } from './assembly';
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
      lines: [{ line: 'ASSEMBLY', project: 'P100', perShift: 120, shifts: ['R', 'O'] }],
      destinations: [
        { location: 'Lokalita A', coverDays: 2, transitHours: 24, arrival: 360 },
        { location: '', coverDays: 3, transitHours: 48, arrival: 420 },
      ],
    };
    expect(parseSettings(toSheets(settingsSheets(settings)))).toEqual(settings);
  });

  it('bez řádku platí výchozí kapacita 0 a doprava 2 dny / 24 h / 6:00, jinak řádek „ostatní“', () => {
    expect(lineCapacity(DEFAULT_SETTINGS, 'ASSEMBLY', 'P1')).toMatchObject({ perShift: 0, shifts: ['R', 'O', 'N'] });
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
    const line = { line: 'ASSEMBLY', project: 'P', perShift: 100, shifts: ['R', 'O'] as const };
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
    const back = parsePlanWorkbook(toSheets(sheets), 'Plán/ASSEMBLY_P100.xlsx');
    expect(back).toEqual({ ok: true, value: plan });
  });

  it('linku a projekt vezme z názvu souboru, když nejsou ve sloupcích', () => {
    const r = parsePlanWorkbook([{ name: 'List1', data: [['Datum', 'Směna', 'Díl', 'Množství'], ['12.10.2026', 'n', 'A', 3]] }], 'Plán/ASSEMBLY_P200.xlsx');
    expect(r).toEqual({ ok: true, value: { line: 'ASSEMBLY', project: 'P200', cells: { [cellKey('2026-10-12 N', 'A')]: 3 }, capacity: {} } });
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
    const master = parseMasterData(parseCsv('Item Number;Project;Variant;Line\nA;;LHD;Assembly\nB;P;RHD;FOA\nC;P;LHD;ASSEMBLY'));
    if (!master.ok) throw new Error();
    // Stav u sekvencéra: čt 15. 10. −40, pá 16. 10. −30 (zlepšení), po 19. 10. −70.
    const cov = coverageFile('A', 'Lokalita A', 'P1', [MON + 3, MON + 4, MON + 7], [-40, -30, -70]);
    const { days, items } = assemblyItems({ master: master.value, coverage: [cov], callOffs: undefined, stock: new Map([['A', 5]]), today: MON });
    // C je ASSEMBLY, ale bez souboru coverage → v plánu není; B je jiná linka.
    expect(items.map((i) => [i.item, i.project])).toEqual([['A', 'P1']]);
    expect(days[0]).toBe(MON);
    expect(days).toHaveLength(14);
    // před prvním dnem souboru platí počáteční stav (sklad + transit = 0)
    expect(items[0]!.base.slice(0, 5)).toEqual([0, 0, 0, -40, -30]);
    expect(items[0]).toMatchObject({ stock: 5, requirements: [{ day: MON + 3, qty: 40 }, { day: MON + 7, qty: 30 }] });
  });

  it('bez sloupce Line všechny díly ze souborů coverage', () => {
    const master = parseMasterData(parseCsv('Item Number;Project;Variant\nA;P;LHD\nK;;'));
    if (!master.ok) throw new Error();
    const cov = coverageFile('Z', 'L', 'P2', [MON + 3], [-10]);
    const { items } = assemblyItems({ master: master.value, coverage: [cov], callOffs: undefined, stock: undefined, today: MON });
    expect(items.map((i) => [i.item, i.side, i.project])).toEqual([['Z', 'RHD', 'P2']]);
  });
});

const item = (id: string, side: string, stock: number, reqs: [number, number][], base: number[] = []): PlanItem => ({
  item: id,
  customerNumber: '',
  description: '',
  side,
  project: 'P',
  location: '',
  stock,
  base,
  requirements: reqs.map(([day, qty]) => ({ day, qty })),
});

describe('coverage s plánem', () => {
  it('stav u zákazníka + náš sklad + naplánovaná výroba do konce dne', () => {
    const it = item('A', 'LHD', 10, [], [30, 0, -40, -80]);
    const cells = { [cellKey(slotKey(MON, 'R'), 'A')]: 20, [cellKey(slotKey(MON, 'N'), 'A')]: 10, [cellKey(slotKey(TUE, 'O'), 'A')]: 30 };
    const planned = plannedByDay(cells, 'A', [MON, TUE, MON + 2, MON + 3]);
    expect(planned).toEqual([30, 30, 0, 0]);
    const s = evaluateItem(it, planned);
    expect(s.withoutPlan).toEqual([40, 10, -30, -70]);
    expect(s.coverage).toEqual([70, 70, 30, -10]);
    expect(s).toMatchObject({ planned: 60, shortDay: 3, shortDayWithoutPlan: 2 });
    expect(evaluateItem(it, [0, 0, 0, 100]).shortDay).toBe(2);
    expect(evaluateItem(item('B', 'RHD', 0, [], [1, 2]), [0, 0]).shortDay).toBeNull();
  });

  it('strany na směnách navazují', () => {
    const slots = shiftSlots(MON, 1, 360);
    const a = item('A', 'LHD', 0, []);
    const b = item('B', 'RHD', 0, []);
    const sides = slotSides([a, b], slots, (s, i) => (s.code === 'O' && i.item === 'A' ? 0 : 1));
    expect(sides).toEqual([['LHD', 'RHD'], ['RHD'], ['RHD', 'LHD']]);
  });
});

describe('návrh plánu', () => {
  const slots = shiftSlots(MON, 2, 360);
  const cap = () => 100;
  const qty = (cells: Record<string, number>, day: number, code: 'R' | 'O' | 'N', id: string) => cells[cellKey(slotKey(day, code), id)] ?? 0;

  it('kryje první chybějící dny všech dílů, po celých dnech, dokud je kapacita', () => {
    // A chybí po 60 a út 60, B chybí po 50 a st 80. Kapacita 100 na směnu.
    const a = item('A', 'LHD', 0, [
      [MON, 60],
      [TUE, 60],
    ]);
    const b = item('B', 'RHD', 0, [
      [MON, 50],
      [TUE + 1, 80],
    ]);
    const { cells, remaining } = proposePlan([a, b], slots, cap, {}, at(MON, 0));
    // R: A 60 (den 1) + B 40; O: B 10 (den 1) + A 60 (den 2) + B 30; N: B 50.
    expect([qty(cells, MON, 'R', 'A'), qty(cells, MON, 'R', 'B')]).toEqual([60, 40]);
    expect([qty(cells, MON, 'O', 'A'), qty(cells, MON, 'O', 'B')]).toEqual([60, 40]);
    expect([qty(cells, MON, 'N', 'A'), qty(cells, MON, 'N', 'B')]).toEqual([0, 50]);
    expect(remaining).toBe(0);
  });

  it('odečte náš sklad a výrobu rozběhnutých směn, zbytek nepokrytých kusů vrátí', () => {
    const a = item('A', 'LHD', 50, [
      [MON, 100],
      [TUE, 400],
      [TUE + 1, 500],
    ]);
    const current = { [cellKey(slotKey(MON, 'R'), 'A')]: 30 };
    // Pondělí 10:00: ranní běží a zůstane; sklad 50 + 30 pokryje 80 z prvních 100.
    const { cells, remaining } = proposePlan([a], slots, cap, current, at(MON, 10));
    expect(qty(cells, MON, 'R', 'A')).toBe(30);
    expect([qty(cells, MON, 'O', 'A'), qty(cells, MON, 'N', 'A'), qty(cells, TUE, 'R', 'A'), qty(cells, TUE, 'N', 'A')]).toEqual([100, 100, 100, 100]);
    // 920 chybějících − 5 směn × 100 = 420.
    expect(remaining).toBe(420);
  });

  it('při stejném dni pokračuje stranou, která se právě vyrábí', () => {
    const a = item('A', 'LHD', 0, [[MON, 50]]);
    const b = item('B', 'RHD', 0, [[MON, 50], [TUE, 50]]);
    const c = item('C', 'LHD', 0, [[TUE, 50]]);
    const { cells } = proposePlan([a, b, c], slots.slice(0, 2), cap, {}, at(MON, 0));
    // R: A, B (den 1); O: B pokračuje (RHD), pak C.
    expect([qty(cells, MON, 'R', 'A'), qty(cells, MON, 'R', 'B')]).toEqual([50, 50]);
    expect([qty(cells, MON, 'O', 'B'), qty(cells, MON, 'O', 'C')]).toEqual([50, 50]);
  });
});
