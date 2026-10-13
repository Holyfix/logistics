import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import { parseMasterData } from '../masterdata';
import { parseCsv } from '../csv';
import { assemblyItems, evaluateItem, proposePlan, slotCapacity, slotSides, type PlanItem } from './assembly';
import { cellKey, emptyPlan, parsePlanWorkbook, planFileName, planSheets, shiftSlots, sideOrder, slotKey } from './plan';
import { DEFAULT_SETTINGS, destinationOf, lineCapacity, parseSettings, parseShifts, parseTime, settingsSheets, type PlanSettings } from './settings';
import type { Cell } from '../table';

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

const item = (id: string, side: string, stock: number, reqs: [number, number][]): PlanItem => ({
  item: id,
  customerNumber: '',
  description: '',
  side,
  project: 'P',
  location: '',
  stock,
  requirements: reqs.map(([deadline, qty]) => ({ day: Math.floor(deadline / 1440) + 2, deadline, qty, fixed: true })),
});

describe('požadavky montáže', () => {
  it('termín výroby: potřeba 15. 10. → příjezd 14. 10. 6:00 → odjezd 13. 10. 6:00', () => {
    const master = parseMasterData(parseCsv('Item Number;Project;Variant;Line\nA;P;LHD;Assembly\nB;P;RHD;FOA'));
    if (!master.ok) throw new Error();
    const exp = {
      items: ['A'],
      descriptions: ['PANEL LHD'],
      offsets: new Uint32Array([0, 1]),
      days: new Int32Array([MON + 3]),
      qty: new Float64Array([40]),
    } as unknown as Parameters<typeof assemblyItems>[0]['callOffs'];
    const items = assemblyItems({ master: master.value, callOffs: exp, stock: new Map([['A', 5]]), today: MON, settings: DEFAULT_SETTINGS });
    expect(items.map((i) => i.item)).toEqual(['A']);
    expect(items[0]).toMatchObject({ stock: 5, requirements: [{ day: MON + 3, deadline: at(MON + 1, 6), qty: 40, fixed: false }] });
  });
});

describe('díly montáže bez sloupce Line', () => {
  it('díly z mapování s projektem a stranou; díly jen z odvolávek ne', () => {
    const master = parseMasterData(parseCsv('Item Number;Project;Variant\nA;P;LHD\nK;;'));
    if (!master.ok) throw new Error();
    const exp = {
      items: ['Z'],
      descriptions: ['DOOR PANEL RHD'],
      offsets: new Uint32Array([0, 1]),
      days: new Int32Array([MON + 3]),
      qty: new Float64Array([10]),
    } as unknown as Parameters<typeof assemblyItems>[0]['callOffs'];
    const items = assemblyItems({ master: master.value, callOffs: exp, stock: undefined, today: MON, settings: DEFAULT_SETTINGS });
    expect(items.map((i) => [i.item, i.side, i.project])).toEqual([['A', 'LHD', 'P']]);
  });
});

describe('vyhodnocení plánu', () => {
  const slots = shiftSlots(MON, 2, 360);
  it('stav po směnách a pokrytí zákazníka', () => {
    // Termín v úterý 6:00 (konec pondělní noční), 30 ks; sklad 10.
    const it = item('A', 'LHD', 10, [[at(TUE, 6), 30]]);
    const short = evaluateItem(it, slots, (s) => (s.key === slotKey(MON, 'R') ? 10 : 0), MON);
    expect(short.balance.slice(0, 3)).toEqual([20, 20, -10]);
    expect(short.due[2]).toBe(30);
    expect(short.firstLate?.qty).toBe(30);
    expect(short.coveredUntil).toBe(TUE + 1);
    const ok = evaluateItem(it, slots, (s) => (s.key === slotKey(MON, 'N') ? 20 : 0), MON);
    expect(ok.coveredUntil).toBe('whole');
    expect(ok).toMatchObject({ planned: 20, required: 30 });
  });

  it('strany na směnách navazují', () => {
    const a = item('A', 'LHD', 0, []);
    const b = item('B', 'RHD', 0, []);
    const sides = slotSides([a, b], slots.slice(0, 3), (s, i) => (s.code === 'O' && i.item === 'A' ? 0 : 1));
    expect(sides).toEqual([['LHD', 'RHD'], ['RHD'], ['RHD', 'LHD']]);
  });
});

describe('návrh plánu', () => {
  const slots = shiftSlots(MON, 3, 360);
  const cap = () => 100;

  it('rozloží velkou potřebu rovnoměrně do směn před termínem, po stranách', () => {
    // Termín středa 6:00: okno pondělí R … úterý N (6 směn) → 300 ks LHD + 300 ks RHD = 100 ks na směnu.
    const a = item('A', 'LHD', 0, [[at(MON + 2, 6), 300]]);
    const b = item('B', 'RHD', 0, [[at(MON + 2, 6), 300]]);
    const { cells, unplaced } = proposePlan([a, b], slots, cap, {}, at(MON, 0));
    expect(unplaced).toBe(0);
    const qty = (day: number, code: 'R' | 'O' | 'N', id: string) => cells[cellKey(slotKey(day, code), id)] ?? 0;
    expect([qty(MON, 'R', 'A'), qty(MON, 'O', 'A'), qty(MON, 'N', 'A'), qty(TUE, 'R', 'A')]).toEqual([100, 100, 100, 0]);
    expect([qty(TUE, 'R', 'B'), qty(TUE, 'O', 'B'), qty(TUE, 'N', 'B')]).toEqual([100, 100, 100]);
  });

  it('malou potřebu nedělí na dávky menší než půl směny', () => {
    // 60 + 60 ks v okně 6 směn: rovnoměrně by to bylo 20 ks na směnu, díl se ale udělá najednou.
    const a = item('A', 'LHD', 0, [[at(MON + 2, 6), 60]]);
    const b = item('B', 'RHD', 0, [[at(MON + 2, 6), 60]]);
    const { cells } = proposePlan([a, b], slots, cap, {}, at(MON, 0));
    expect(cells).toEqual({ [cellKey(slotKey(MON, 'R'), 'A')]: 60, [cellKey(slotKey(TUE, 'R'), 'B')]: 60 });
  });

  it('odečte sklad, nechá rozběhnuté směny a co se nevejde, dá do dřívějších směn', () => {
    const a = item('A', 'LHD', 50, [
      [at(TUE, 6), 100],
      [at(MON + 2, 6), 350],
    ]);
    const current = { [cellKey(slotKey(MON, 'R'), 'A')]: 30 };
    const { cells, unplaced } = proposePlan([a], slots, cap, current, at(MON, 10));
    const qty = (day: number, code: 'R' | 'O' | 'N') => cells[cellKey(slotKey(day, code), 'A')] ?? 0;
    // Pondělí R zůstane 30; čistý požadavek do úterý 6:00 = 100 − 50 − 30 = 20.
    // 20 ks je méně než půl směny, udělají se najednou v odpolední. Do středy 6:00 350 ks: úterý R, O, N po 100,
    // zbytek 50 do pondělní noční (nejbližší volná směna před termínem).
    expect(qty(MON, 'R')).toBe(30);
    expect([qty(MON, 'O'), qty(MON, 'N')]).toEqual([20, 50]);
    expect([qty(TUE, 'R'), qty(TUE, 'O'), qty(TUE, 'N')]).toEqual([100, 100, 100]);
    expect(unplaced).toBe(0);
  });

  it('zpožděné požadavky co nejdřív, chybějící kapacitu vrátí jako nenaplánováno', () => {
    const a = item('A', 'LHD', 0, [[at(MON, 0), 150]]);
    const { cells, unplaced } = proposePlan([a], slots.slice(0, 1), cap, {}, at(MON, 0));
    expect(cells[cellKey(slotKey(MON, 'R'), 'A')]).toBe(100);
    expect(unplaced).toBe(50);
  });
});
