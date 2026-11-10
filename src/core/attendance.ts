// Docházka: export docházky (řádek = osoba × mzdová složka, sloupce = dny) a přehled po lidech a měsících:
// fond, odpracováno, přesčasy, uznané přesčasy, home office, lékař, dovolená, nemoc, služební cesty, náhradní volno.

import { findColumn } from './csv';
import { dayToIso, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

export interface AttendancePerson {
  /** Osobní číslo (jinak jméno). */
  id: string;
  name: string;
  center: string;
  contract: string;
}

/** Hodnota mzdové složky osoby za den (hodiny, u stravenek dny). */
export interface AttendanceValue {
  person: string;
  category: string;
  day: DayNumber;
  value: number;
}

/** Poznámka dne (zkratky HO, DOV, SC, NV, lékař …). */
export interface AttendanceNote {
  person: string;
  day: DayNumber;
  text: string;
}

export interface AttendanceData {
  people: AttendancePerson[];
  values: AttendanceValue[];
  notes: AttendanceNote[];
  /** Mzdové složky v pořadí z exportu. */
  categories: string[];
}

export const emptyAttendance = (): AttendanceData => ({ people: [], values: [], notes: [], categories: [] });

/**
 * Text z exportu, který Excel přečetl ve špatném kódování (Windows-1250 jako Latin-1: „Pøíjmení“ místo „Příjmení“).
 * Opraví se jen text ze znaků do 255 se znakem nad 127; správný český text obsahuje znaky nad 255 (č, ř, š …).
 */
const decoder = (() => {
  try {
    return new TextDecoder('windows-1250');
  } catch {
    return null;
  }
})();
export function fixEncoding(text: string): string {
  if (!decoder || ![...text].some((c) => c.charCodeAt(0) >= 0x80) || [...text].some((c) => c.charCodeAt(0) > 0xff)) return text;
  return decoder.decode(Uint8Array.from(text, (c) => c.charCodeAt(0)));
}

const COLUMNS = {
  category: ['Mzdová složka', 'Složka', 'Category'],
  id: ['Osobní číslo', 'Os. číslo', 'Personal number', 'ID'],
  name: ['Příjmení Jméno, Titul', 'Příjmení Jméno', 'Jméno', 'Name'],
  center: ['Středisko', 'Cost center'],
  contract: ['Prac.poměr', 'Prac. poměr', 'Pracovní poměr', 'Contract'],
} as const;

const NOTE = /^pozn/i;

export type AttendanceResult = { ok: true; value: AttendanceData } | { ok: false; error: 'missingColumns'; columns: string[] };

const text = (cell: Cell | undefined) => fixEncoding(cellText(cell));

/** Načte list exportu: záhlaví se sloupci Mzdová složka, Osobní číslo, Jméno a sloupci dnů (sloupce „Suma …“ se vynechají). */
export function parseAttendanceSheets(sheets: readonly Cell[][][]): AttendanceResult {
  for (const data of sheets) {
    const headerIndex = data.findIndex((row) => {
      const header = row.map(text);
      return findColumn(header, COLUMNS.category) !== -1 && findColumn(header, COLUMNS.name) !== -1;
    });
    if (headerIndex === -1) continue;
    const header = data[headerIndex]!.map(text);
    const col = (aliases: readonly string[]) => findColumn(header, aliases);
    const [catC, idC, nameC, centerC, contractC] = [col(COLUMNS.category), col(COLUMNS.id), col(COLUMNS.name), col(COLUMNS.center), col(COLUMNS.contract)];
    const dayCols = data[headerIndex]!.flatMap((cell, i) => {
      if (i <= Math.max(catC, idC, nameC)) return [];
      const day = cellDay(cell);
      return day === null ? [] : [{ i, day }];
    });
    const result = emptyAttendance();
    const people = new Map<string, AttendancePerson>();
    for (const row of data.slice(headerIndex + 1)) {
      const category = text(row[catC]);
      const name = text(row[nameC]);
      if (!category || !name) continue;
      const id = (idC === -1 ? '' : text(row[idC])) || name;
      if (!people.has(id)) people.set(id, { id, name, center: centerC === -1 ? '' : text(row[centerC]), contract: contractC === -1 ? '' : text(row[contractC]) });
      if (NOTE.test(category)) {
        for (const { i, day } of dayCols) {
          const note = text(row[i]);
          if (note) result.notes.push({ person: id, day, text: note });
        }
        continue;
      }
      if (!result.categories.includes(category)) result.categories.push(category);
      for (const { i, day } of dayCols) {
        const value = cellNumber(row[i]);
        if (value !== null && value !== 0) result.values.push({ person: id, category, day, value });
      }
    }
    result.people = [...people.values()];
    return { ok: true, value: result };
  }
  return { ok: false, error: 'missingColumns', columns: [COLUMNS.category[0], COLUMNS.name[0]] };
}

/** Spojí exporty více měsíců; stejný den osoby a složky platí z pozdějšího exportu. */
export function mergeAttendance(parts: readonly AttendanceData[]): AttendanceData {
  const people = new Map<string, AttendancePerson>();
  const values = new Map<string, AttendanceValue>();
  const notes = new Map<string, AttendanceNote>();
  const categories: string[] = [];
  for (const part of parts) {
    for (const p of part.people) people.set(p.id, p);
    for (const v of part.values) values.set(`${v.person}|${v.category}|${v.day}`, v);
    for (const n of part.notes) notes.set(`${n.person}|${n.day}`, n);
    for (const c of part.categories) if (!categories.includes(c)) categories.push(c);
  }
  return { people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs')), values: [...values.values()], notes: [...notes.values()], categories };
}

/** Měsíce v datech („2026-11“), od nejnovějšího. */
export function monthsOf(data: AttendanceData): string[] {
  return [...new Set([...data.values.map((v) => v.day), ...data.notes.map((n) => n.day)].map((d) => dayToIso(d).slice(0, 7)))].sort().reverse();
}

// --- Zkratky v poznámkách ---

/**
 * Zkratky dne z poznámky: „ok, HO“ → HO 1; „1/2HO“ → HO 0,5; „lékař/NV“ → lékař 1 a NV 1. „ok“ a čísla se vynechají.
 * Zkratky se sjednotí na velká písmena (lékař → LÉKAŘ).
 */
export function noteCodes(note: string): Map<string, number> {
  const codes = new Map<string, number>();
  for (const part of note.split(/[,;]/)) {
    const m = /^\s*(1\/2|½)?\s*(.*?)\s*$/.exec(part)!;
    const share = m[1] ? 0.5 : 1;
    for (const raw of m[2]!.split('/')) {
      const code = raw.trim().toUpperCase();
      if (!code || code === 'OK' || /^[\d.,\s]+$/.test(code)) continue;
      codes.set(code, (codes.get(code) ?? 0) + share);
    }
  }
  return codes;
}

// --- Přehled po lidech ---

export interface AttendanceSummary {
  person: AttendancePerson;
  fond: number;
  worked: number;
  credited: number;
  /** Kladné přesčasy z evidence (součet dnů s přesčasem). */
  overtime: number;
  /** Uznané přesčasy (složky „Uznáno …“). */
  approved: number;
  /** Čas k uznání (složky „Uznat …“). */
  toApprove: number;
  /** Lékař v hodinách. */
  doctor: number;
  /** Dovolená v hodinách. */
  vacationHours: number;
  /** Nemoc v hodinách. */
  sickHours: number;
  /** Služební cesta v hodinách. */
  tripHours: number;
  /** Příplatek noční v hodinách. */
  night: number;
  /** Dny podle poznámek (HO, DOV, SC, NV, LÉKAŘ …). */
  codes: Map<string, number>;
  /** Součet každé mzdové složky. */
  byCategory: Map<string, number>;
}

const is = (category: string, pattern: RegExp) => pattern.test(category.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());

/** Přehled osob za období (měsíc „2026-11“ nebo vše). */
export function summarize(data: AttendanceData, month: string | null): AttendanceSummary[] {
  const inMonth = (day: DayNumber) => !month || dayToIso(day).startsWith(month);
  const rows = new Map<string, AttendanceSummary>(
    data.people.map((p) => [
      p.id,
      { person: p, fond: 0, worked: 0, credited: 0, overtime: 0, approved: 0, toApprove: 0, doctor: 0, vacationHours: 0, sickHours: 0, tripHours: 0, night: 0, codes: new Map(), byCategory: new Map() },
    ]),
  );
  for (const v of data.values) {
    const row = rows.get(v.person);
    if (!row || !inMonth(v.day)) continue;
    row.byCategory.set(v.category, (row.byCategory.get(v.category) ?? 0) + v.value);
    const c = v.category;
    if (is(c, /^fond/)) row.fond += v.value;
    else if (is(c, /odpracovano/)) row.worked += v.value;
    else if (is(c, /zapocteno/)) row.credited += v.value;
    else if (is(c, /^prescas/) && v.value > 0) row.overtime += v.value;
    else if (is(c, /^uznano/)) row.approved += v.value;
    else if (is(c, /^uznat/)) row.toApprove += v.value;
    else if (is(c, /^lekar/)) row.doctor += v.value;
    else if (is(c, /^dovolena/)) row.vacationHours += v.value;
    else if (is(c, /^nemoc/)) row.sickHours += v.value;
    else if (is(c, /^sluzebni/)) row.tripHours += v.value;
    else if (is(c, /nocni/)) row.night += v.value;
  }
  for (const n of data.notes) {
    const row = rows.get(n.person);
    if (!row || !inMonth(n.day)) continue;
    for (const [code, share] of noteCodes(n.text)) row.codes.set(code, (row.codes.get(code) ?? 0) + share);
  }
  return [...rows.values()];
}
