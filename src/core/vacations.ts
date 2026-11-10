// Dovolené: plán dovolených po lidech, roční nárok, čerpání a zbytek. Pracovní dny bez víkendů a státních svátků ČR.
// Ukládá se jako Excel do složky Lide ve sdílené složce (listy Lidé, Nárok, Dovolené a Nastavení).

import { findColumn } from './csv';
import { dayFromParts, dayToIso, isoWeek, weekday, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

export interface VacationPerson {
  name: string;
  team: string;
}

/** Nárok osoby na rok: dny dovolené a převod z minulého roku. */
export interface Allowance {
  person: string;
  year: number;
  entitlement: number;
  carryOver: number;
}

/** planned = naplánováno (čeká na schválení), approved = schváleno. */
export type VacationStatus = 'planned' | 'approved';

export interface VacationEntry {
  /** Číslo záznamu, nemění se. */
  id: number;
  person: string;
  from: DayNumber;
  to: DayNumber;
  /** Půl dne (jen u jednodenní dovolené). */
  half: boolean;
  status: VacationStatus;
  note: string;
}

export interface VacationData {
  people: VacationPerson[];
  allowances: Allowance[];
  entries: VacationEntry[];
  /** Kolik lidí smí být na dovolené současně (víc = upozornění); null = bez limitu. */
  maxAway: number | null;
}

export const emptyVacations = (): VacationData => ({ people: [], allowances: [], entries: [], maxAway: null });

/** Výchozí roční nárok (4 týdny). */
export const DEFAULT_ENTITLEMENT = 20;

// --- Kalendář: svátky a pracovní dny ---

/** Velikonoční neděle (gregoriánský kalendář). */
export function easterSunday(year: number): DayNumber {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayFromParts(year, month, day)!;
}

const FIXED_HOLIDAYS: readonly [number, number][] = [
  [1, 1],
  [5, 1],
  [5, 8],
  [7, 5],
  [7, 6],
  [9, 28],
  [10, 28],
  [11, 17],
  [12, 24],
  [12, 25],
  [12, 26],
];

const holidayCache = new Map<number, Set<DayNumber>>();

/** Státní svátky ČR v roce (pevné svátky, Velký pátek a Velikonoční pondělí). */
export function holidays(year: number): Set<DayNumber> {
  let set = holidayCache.get(year);
  if (!set) {
    const easter = easterSunday(year);
    set = new Set([...FIXED_HOLIDAYS.map(([m, d]) => dayFromParts(year, m, d)!), easter - 2, easter + 1]);
    holidayCache.set(year, set);
  }
  return set;
}

export const yearOf = (day: DayNumber) => Number(dayToIso(day).slice(0, 4));
export const isHoliday = (day: DayNumber) => holidays(yearOf(day)).has(day);
export const isWorkday = (day: DayNumber) => weekday(day) <= 5 && !isHoliday(day);

/** Počet pracovních dní v rozsahu (včetně obou krajů). */
export function workdays(from: DayNumber, to: DayNumber): number {
  let n = 0;
  for (let d = from; d <= to; d++) if (isWorkday(d)) n++;
  return n;
}

/** Dny dovolené v rozsahu (jen pracovní dny); půl dne = 0,5. */
export function entryDays(entry: VacationEntry, from = -Infinity, to = Infinity): number {
  const a = Math.max(entry.from, from);
  const b = Math.min(entry.to, to);
  if (a > b) return 0;
  return entry.half ? (isWorkday(a) ? 0.5 : 0) : workdays(a, b);
}

const yearStart = (year: number) => dayFromParts(year, 1, 1)!;
const yearEnd = (year: number) => dayFromParts(year, 12, 31)!;

// --- Nárok a čerpání ---

/** Nárok osoby na rok; bez zápisu nárok z posledního dřívějšího roku (bez převodu), jinak výchozí. */
export function allowanceOf(data: VacationData, person: string, year: number): Allowance {
  const own = data.allowances.find((a) => a.person === person && a.year === year);
  if (own) return own;
  const earlier = data.allowances.filter((a) => a.person === person && a.year < year).sort((a, b) => b.year - a.year)[0];
  return { person, year, entitlement: earlier?.entitlement ?? DEFAULT_ENTITLEMENT, carryOver: 0 };
}

export interface Balance {
  entitlement: number;
  carryOver: number;
  total: number;
  /** Dny dovolené do dneška včetně. */
  taken: number;
  /** Dny dovolené po dnešku. */
  planned: number;
  /** Z naplánovaných dní ještě neschválené. */
  unapproved: number;
  remaining: number;
}

export function balanceOf(data: VacationData, person: string, year: number, today: DayNumber): Balance {
  const allowance = allowanceOf(data, person, year);
  const entries = data.entries.filter((e) => e.person === person);
  const start = yearStart(year);
  const end = yearEnd(year);
  const taken = entries.reduce((s, e) => s + entryDays(e, start, Math.min(end, today)), 0);
  const planned = entries.reduce((s, e) => s + entryDays(e, Math.max(start, today + 1), end), 0);
  const unapproved = entries.filter((e) => e.status === 'planned').reduce((s, e) => s + entryDays(e, Math.max(start, today + 1), end), 0);
  const total = allowance.entitlement + allowance.carryOver;
  return { entitlement: allowance.entitlement, carryOver: allowance.carryOver, total, taken, planned, unapproved, remaining: total - taken - planned };
}

/** Kdo je v den na dovolené (jen pracovní dny). */
export function awayOn(data: VacationData, day: DayNumber): VacationEntry[] {
  if (!isWorkday(day)) return [];
  return data.entries.filter((e) => e.from <= day && day <= e.to);
}

// --- Úpravy ---

export function addPerson(data: VacationData, name: string, team = ''): VacationData | null {
  const n = name.trim();
  if (!n || data.people.some((p) => p.name === n)) return null;
  return { ...data, people: [...data.people, { name: n, team: team.trim() }] };
}

/** Přejmenování osoby i v nároku a dovolených; prázdné nebo použité jméno se nepřijme (null). */
export function renamePerson(data: VacationData, from: string, to: string): VacationData | null {
  const n = to.trim();
  if (!n || (n !== from && data.people.some((p) => p.name === n))) return null;
  return {
    ...data,
    people: data.people.map((p) => (p.name === from ? { ...p, name: n } : p)),
    allowances: data.allowances.map((a) => (a.person === from ? { ...a, person: n } : a)),
    entries: data.entries.map((e) => (e.person === from ? { ...e, person: n } : e)),
  };
}

export function setTeam(data: VacationData, person: string, team: string): VacationData {
  return { ...data, people: data.people.map((p) => (p.name === person ? { ...p, team } : p)) };
}

/** Smaže osobu i s jejím nárokem a dovolenými. */
export function removePerson(data: VacationData, person: string): VacationData {
  return {
    ...data,
    people: data.people.filter((p) => p.name !== person),
    allowances: data.allowances.filter((a) => a.person !== person),
    entries: data.entries.filter((e) => e.person !== person),
  };
}

export function setAllowance(data: VacationData, person: string, year: number, change: Partial<Pick<Allowance, 'entitlement' | 'carryOver'>>): VacationData {
  const current = allowanceOf(data, person, year);
  const next = { ...current, ...change };
  return { ...data, allowances: [...data.allowances.filter((a) => !(a.person === person && a.year === year)), next] };
}

export function addEntry(data: VacationData, person: string, from: DayNumber, to = from): { data: VacationData; id: number } {
  const id = Math.max(0, ...data.entries.map((e) => e.id)) + 1;
  const entry: VacationEntry = { id, person, from: Math.min(from, to), to: Math.max(from, to), half: false, status: 'planned', note: '' };
  return { data: { ...data, entries: [...data.entries, entry] }, id };
}

/** Úprava záznamu; od a do se srovnají, půl dne platí jen u jednoho dne. */
export function updateEntry(data: VacationData, id: number, change: (e: VacationEntry) => VacationEntry): VacationData {
  return {
    ...data,
    entries: data.entries.map((e) => {
      if (e.id !== id) return e;
      const next = change(e);
      const from = Math.min(next.from, next.to);
      const to = Math.max(next.from, next.to);
      return { ...next, from, to, half: next.half && from === to };
    }),
  };
}

export function removeEntry(data: VacationData, id: number): VacationData {
  return { ...data, entries: data.entries.filter((e) => e.id !== id) };
}

// --- Soubor Dovolene.xlsx ---

const COLUMNS = {
  name: ['Jméno', 'Name', 'Osoba'],
  team: ['Tým', 'Team', 'Oddělení'],
  year: ['Rok', 'Year'],
  entitlement: ['Nárok (dny)', 'Nárok', 'Entitlement'],
  carryOver: ['Převod (dny)', 'Převod', 'Carry-over'],
  id: ['ID', 'Číslo'],
  from: ['Od', 'From'],
  to: ['Do', 'To'],
  half: ['Půl dne', 'Half day'],
  status: ['Stav', 'Status'],
  days: ['Pracovních dní', 'Days'],
  note: ['Poznámka', 'Note'],
  setting: ['Nastavení', 'Setting'],
  value: ['Hodnota', 'Value'],
} as const;

const MAX_AWAY = 'Max. současně na dovolené';

const formatDate = (day: DayNumber) => {
  const [y, m, d] = dayToIso(day).split('-');
  return `${d}.${m}.${y}`;
};

export interface VacationSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

export function vacationSheets(data: VacationData): VacationSheet[] {
  return [
    { name: 'Lidé', header: [COLUMNS.name[0], COLUMNS.team[0]], rows: data.people.map((p) => [p.name, p.team || null]) },
    {
      name: 'Nárok',
      header: [COLUMNS.name[0], COLUMNS.year[0], COLUMNS.entitlement[0], COLUMNS.carryOver[0]],
      rows: [...data.allowances].sort((a, b) => a.year - b.year || a.person.localeCompare(b.person, 'cs')).map((a) => [a.person, a.year, a.entitlement, a.carryOver]),
    },
    {
      name: 'Dovolené',
      header: [COLUMNS.id[0], COLUMNS.name[0], COLUMNS.from[0], COLUMNS.to[0], COLUMNS.half[0], COLUMNS.status[0], COLUMNS.days[0], COLUMNS.note[0]],
      rows: [...data.entries]
        .sort((a, b) => a.from - b.from || a.id - b.id)
        .map((e) => [e.id, e.person, formatDate(e.from), formatDate(e.to), e.half ? 'Ano' : 'Ne', e.status === 'approved' ? 'Schváleno' : 'Plánováno', entryDays(e), e.note || null]),
    },
    { name: 'Nastavení', header: [COLUMNS.setting[0], COLUMNS.value[0]], rows: [[MAX_AWAY, data.maxAway]] },
  ];
}

export type VacationResult = { ok: true; value: VacationData } | { ok: false; error: 'missingColumns'; columns: string[] };

type Sheets = readonly { name: string; data: Cell[][] }[];

function findSheet(sheets: Sheets, required: readonly (readonly string[])[]) {
  for (const sheet of sheets) {
    const header = (sheet.data[0] ?? []).map((c) => cellText(c));
    const cols = required.map((a) => findColumn(header, a));
    if (cols.every((c) => c !== -1)) return { header, rows: sheet.data.slice(1), cols };
  }
  return null;
}

export function parseVacationWorkbook(sheets: Sheets): VacationResult {
  const list = findSheet(sheets, [COLUMNS.id, COLUMNS.name, COLUMNS.from, COLUMNS.to]);
  const people = findSheet(sheets, [COLUMNS.name, COLUMNS.team]);
  if (!list && !people) return { ok: false, error: 'missingColumns', columns: [COLUMNS.id[0], COLUMNS.name[0], COLUMNS.from[0], COLUMNS.to[0]] };
  const data = emptyVacations();
  const addName = (name: string, team = '') => {
    if (name && !data.people.some((p) => p.name === name)) data.people.push({ name, team });
  };
  if (people && people !== list) for (const row of people.rows) addName(cellText(row[people.cols[0]!]), cellText(row[people.cols[1]!]));

  const allowances = findSheet(sheets, [COLUMNS.name, COLUMNS.year, COLUMNS.entitlement]);
  if (allowances) {
    const carryC = findColumn(allowances.header, COLUMNS.carryOver);
    for (const row of allowances.rows) {
      const person = cellText(row[allowances.cols[0]!]);
      const year = cellNumber(row[allowances.cols[1]!]);
      const entitlement = cellNumber(row[allowances.cols[2]!]);
      if (!person || year === null || entitlement === null) continue;
      addName(person);
      data.allowances = [...data.allowances.filter((a) => !(a.person === person && a.year === year)), { person, year, entitlement, carryOver: carryC === -1 ? 0 : (cellNumber(row[carryC]) ?? 0) }];
    }
  }

  if (list) {
    const [idC, nameC, fromC, toC] = list.cols as [number, number, number, number];
    const halfC = findColumn(list.header, COLUMNS.half);
    const statusC = findColumn(list.header, COLUMNS.status);
    const noteC = findColumn(list.header, COLUMNS.note);
    const ids = new Set<number>();
    for (const row of list.rows) {
      const id = cellNumber(row[idC]);
      const person = cellText(row[nameC]);
      const from = cellDay(row[fromC]);
      const to = cellDay(row[toC]) ?? from;
      if (id === null || ids.has(id) || !person || from === null || to === null) continue;
      ids.add(id);
      addName(person);
      const half = halfC !== -1 && /^(a|ano|y|yes|1|true)$/i.test(cellText(row[halfC]));
      data.entries.push({
        id,
        person,
        from: Math.min(from, to),
        to: Math.max(from, to),
        half: half && from === to,
        status: statusC !== -1 && /schv|appr/i.test(cellText(row[statusC])) ? 'approved' : 'planned',
        note: noteC === -1 ? '' : cellText(row[noteC]),
      });
    }
  }

  const settings = findSheet(sheets, [COLUMNS.setting, COLUMNS.value]);
  if (settings) {
    const row = settings.rows.find((r) => cellText(r[settings.cols[0]!]) === MAX_AWAY);
    const value = row ? cellNumber(row[settings.cols[1]!]) : null;
    data.maxAway = value !== null && value > 0 ? Math.round(value) : null;
  }
  return { ok: true, value: data };
}

/** Popisek týdne pro kalendář (CW). */
export const weekOf = (day: DayNumber) => isoWeek(day).week;
