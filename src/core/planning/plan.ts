// Plán linky po směnách: kolik kusů kterého dílu se na směně vyrobí. Ukládá se jako Excel do složky Plan
// (jeden soubor na linku a projekt), aby se dal sdílet; aplikace ho při načtení dat zase přečte.

import { findColumn } from '../csv';
import { dayToIso, parseDay, type DayNumber } from '../dates';
import { sideGroup } from '../masterdata';
import { cellDay, cellNumber, cellText, type Cell } from '../table';
import { SHIFT_CODES, SHIFT_MINUTES, type PlanSheet, type ShiftCode } from './settings';

/** Směna v plánu. Časy jsou minuty od 1. 1. 1970 0:00 místního času (den × 1440 + minuty). */
export interface ShiftSlot {
  /** Klíč směny, např. „2026-10-13 R“. */
  key: string;
  day: DayNumber;
  code: ShiftCode;
  start: number;
  end: number;
}

export const slotKey = (day: DayNumber, code: ShiftCode) => `${dayToIso(day)} ${code}`;

/** Směny R, O, N pro `days` dní od `from`; ranní začíná v `firstShiftStart` (minuty od půlnoci). */
export function shiftSlots(from: DayNumber, days: number, firstShiftStart: number): ShiftSlot[] {
  const slots: ShiftSlot[] = [];
  for (let d = from; d < from + days; d++) {
    SHIFT_CODES.forEach((code, i) => {
      const start = d * 1440 + firstShiftStart + i * SHIFT_MINUTES;
      slots.push({ key: slotKey(d, code), day: d, code, start, end: start + SHIFT_MINUTES });
    });
  }
  return slots;
}

/** Automatický plán směny: díly které strany se na směnu doplní samy (LHD a RHD = obě strany za sebou). */
export const AUTO_MODES = ['LHD', 'RHD', 'BOTH'] as const;
export type AutoMode = (typeof AUTO_MODES)[number];

/** Text režimu v souboru plánu. */
const AUTO_TEXT: Record<AutoMode, string> = { LHD: 'LHD', RHD: 'RHD', BOTH: 'LHD+RHD' };

function parseAuto(text: string): AutoMode | null {
  const t = text.toUpperCase().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes('LHD') && t.includes('RHD')) return 'BOTH';
  return t.startsWith('LHD') ? 'LHD' : t.startsWith('RHD') ? 'RHD' : null;
}

export interface LinePlan {
  line: string;
  project: string;
  /** Množství podle klíče `cellKey(směna, díl)`. */
  cells: Record<string, number>;
  /** Kapacita směny zadaná ručně (svátek, přesčas o víkendu …) podle klíče směny; jinak platí kapacita linky. */
  capacity: Record<string, number>;
  /** Směny s automatickým plánem podle klíče směny; množství se na nich dopočítají samy. */
  auto: Record<string, AutoMode>;
}

export const cellKey = (slot: string, item: string) => `${slot}|${item}`;

export function emptyPlan(line: string, project: string): LinePlan {
  return { line, project, cells: {}, capacity: {}, auto: {} };
}

/** Název souboru plánu, např. „ASSEMBLY_P100.xlsx“ (znaky, které Windows v názvu nedovolí, nahradí „_“). */
export function planFileName(line: string, project: string): string {
  return `${line}_${project || '-'}.xlsx`.replace(/[\\/:*?"<>|]+/g, '_');
}

function splitCell(key: string): { slot: string; item: string; day: DayNumber | null; code: ShiftCode | null } {
  const bar = key.indexOf('|');
  const slot = key.slice(0, bar);
  const [iso = '', code = ''] = slot.split(' ');
  return { slot, item: key.slice(bar + 1), day: parseDay(iso), code: (SHIFT_CODES as readonly string[]).includes(code) ? (code as ShiftCode) : null };
}

/** Strany (LHD, RHD) v pořadí výroby na směně: navazuje na stranu, kterou skončila předchozí směna (nejvýš jedno přepnutí). */
export function sideOrder(sides: ReadonlySet<string>, previous: string): string[] {
  const order = [...sides].sort();
  if (previous && order.includes(previous)) return [previous, ...order.filter((s) => s !== previous)];
  return order;
}

export interface PlanItemInfo {
  customerNumber: string;
  description: string;
  side: string;
}

const COLUMNS = {
  line: ['Linka', 'Line'],
  project: ['Projekt', 'Project'],
  day: ['Datum', 'Date'],
  shift: ['Směna', 'Shift'],
  item: ['Díl', 'Item Number', 'Item'],
  qty: ['Množství', 'Qty', 'Quantity'],
  capacity: ['Kapacita', 'Capacity'],
  auto: ['Automaticky', 'Auto'],
} as const;

const formatDate = (day: DayNumber) => {
  const [y, m, d] = dayToIso(day).split('-');
  return `${d}.${m}.${y}`;
};

/**
 * Listy souboru plánu: „Plán“ (řádek = díl na směně v pořadí výroby, strany po blocích), „Přehled“ (díly × směny)
 * a „Kapacita směn“ (ručně zadané kapacity a směny s automatickým plánem).
 */
export function planSheets(plan: LinePlan, info: ReadonlyMap<string, PlanItemInfo>): PlanSheet[] {
  const entries = Object.entries(plan.cells)
    .filter(([, qty]) => qty > 0)
    .map(([key, qty]) => ({ ...splitCell(key), qty }))
    .filter((e) => e.day !== null && e.code !== null);
  const slotOrder = (a: { day: DayNumber | null; code: ShiftCode | null }) => a.day! * 3 + SHIFT_CODES.indexOf(a.code!);
  const slots = [...new Map(entries.map((e) => [e.slot, e])).values()].sort((a, b) => slotOrder(a) - slotOrder(b));

  const rows: PlanSheet['rows'] = [];
  let previous = '';
  for (const slot of slots) {
    const inSlot = entries.filter((e) => e.slot === slot.slot);
    const side = (item: string) => sideGroup(info.get(item)?.side ?? '');
    const order = sideOrder(new Set(inSlot.map((e) => side(e.item))), previous);
    inSlot.sort((a, b) => order.indexOf(side(a.item)) - order.indexOf(side(b.item)) || a.item.localeCompare(b.item, 'en', { numeric: true }));
    inSlot.forEach((e, i) => {
      const it = info.get(e.item);
      rows.push([plan.line, plan.project, formatDate(e.day!), e.code, i + 1, it?.side ?? '', e.item, it?.customerNumber ?? '', it?.description ?? '', e.qty]);
    });
    previous = order.at(-1) ?? previous;
  }

  const items = [...new Set(entries.map((e) => e.item))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const qty = new Map(entries.map((e) => [cellKey(e.slot, e.item), e.qty]));
  const grid: PlanSheet = {
    name: 'Přehled',
    header: ['Díl', 'Číslo zákazníka', 'Strana', ...slots.map((s) => `${formatDate(s.day!)} ${s.code}`), 'Celkem'],
    rows: items.map((item) => {
      const values = slots.map((s) => qty.get(cellKey(s.slot, item)) ?? null);
      return [item, info.get(item)?.customerNumber ?? '', info.get(item)?.side ?? '', ...values, values.reduce<number>((a, b) => a + (b ?? 0), 0)];
    }),
  };

  const shiftKeys = [...new Set([...Object.keys(plan.capacity), ...Object.keys(plan.auto)])]
    .map((slot) => splitCell(`${slot}|`))
    .filter((c) => c.day !== null && c.code !== null)
    .sort((a, b) => slotOrder(a) - slotOrder(b));

  return [
    {
      name: 'Plán',
      header: [COLUMNS.line[0], COLUMNS.project[0], COLUMNS.day[0], COLUMNS.shift[0], 'Pořadí', 'Strana', COLUMNS.item[0], 'Číslo zákazníka', 'Popis', COLUMNS.qty[0]],
      rows,
    },
    grid,
    {
      name: 'Kapacita směn',
      header: [COLUMNS.day[0], COLUMNS.shift[0], COLUMNS.capacity[0], COLUMNS.auto[0]],
      rows: shiftKeys.map((c) => [formatDate(c.day!), c.code, plan.capacity[c.slot] ?? null, plan.auto[c.slot] ? AUTO_TEXT[plan.auto[c.slot]!] : null]),
    },
  ];
}

export type PlanResult = { ok: true; value: LinePlan } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Načte plán ze souboru. Linka a projekt jsou ve sloupcích, jinak z názvu souboru („ASSEMBLY_P100.xlsx“). */
export function parsePlanWorkbook(sheets: readonly { name: string; data: Cell[][] }[], fileName: string): PlanResult {
  const find = (required: readonly (readonly string[])[]) => {
    for (const sheet of sheets) {
      const header = (sheet.data[0] ?? []).map((c) => cellText(c));
      const cols = required.map((a) => findColumn(header, a));
      if (cols.every((c) => c !== -1)) return { header, rows: sheet.data.slice(1), cols };
    }
    return null;
  };
  const planTable = find([COLUMNS.day, COLUMNS.shift, COLUMNS.item, COLUMNS.qty]);
  if (!planTable) return { ok: false, error: 'missingColumns', columns: [COLUMNS.day[0], COLUMNS.shift[0], COLUMNS.item[0], COLUMNS.qty[0]] };

  const base = fileName.split('/').pop()!.replace(/\.[^.]+$/, '');
  const sep = base.indexOf('_');
  const lineCol = findColumn(planTable.header, COLUMNS.line);
  const projectCol = findColumn(planTable.header, COLUMNS.project);
  const first = planTable.rows.find((r) => r.some((c) => cellText(c)));
  const line = (lineCol !== -1 && cellText(first?.[lineCol])) || (sep === -1 ? base : base.slice(0, sep));
  const projectFromName = sep === -1 ? '' : base.slice(sep + 1);
  const project = (projectCol !== -1 && cellText(first?.[projectCol])) || (projectFromName === '-' ? '' : projectFromName);

  const plan = emptyPlan(line.toUpperCase(), project);
  const slotOf = (dayCell: Cell | undefined, shiftCell: Cell | undefined) => {
    const day = cellDay(dayCell);
    const code = cellText(shiftCell).toUpperCase();
    return day !== null && (SHIFT_CODES as readonly string[]).includes(code) ? slotKey(day, code as ShiftCode) : null;
  };
  const [dayCol, shiftCol, itemCol, qtyCol] = planTable.cols;
  for (const row of planTable.rows) {
    const slot = slotOf(row[dayCol!], row[shiftCol!]);
    const item = cellText(row[itemCol!]);
    const qty = cellNumber(row[qtyCol!]);
    if (!slot || !item || qty === null || qty <= 0) continue;
    const key = cellKey(slot, item);
    plan.cells[key] = (plan.cells[key] ?? 0) + qty;
  }

  const capTable = find([COLUMNS.day, COLUMNS.shift, COLUMNS.capacity]);
  if (capTable && capTable !== planTable) {
    const [dayC, shiftC, capC] = capTable.cols;
    const autoC = findColumn(capTable.header, COLUMNS.auto);
    for (const row of capTable.rows) {
      const slot = slotOf(row[dayC!], row[shiftC!]);
      if (!slot) continue;
      const value = cellNumber(row[capC!]);
      if (value !== null && value >= 0) plan.capacity[slot] = value;
      const auto = autoC === -1 ? null : parseAuto(cellText(row[autoC]));
      if (auto) plan.auto[slot] = auto;
    }
  }
  return { ok: true, value: plan };
}
