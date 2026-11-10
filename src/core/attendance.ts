// Docházka: export docházky (řádek = osoba × mzdová složka, sloupce = dny) a přehled po lidech a měsících:
// fond, odpracováno, přesčasy, uznané přesčasy, home office, lékař, dovolená, nemoc, služební cesty, náhradní volno.

import { findColumn } from './csv';
import { dayFromParts, dayToIso, mondayOf, type DayNumber } from './dates';
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

const decoder = (() => {
  try {
    return new TextDecoder('windows-1250');
  } catch {
    return null;
  }
})();

/** Znaky Windows-1252 v rozsahu 0x80–0x9F (ostatní bajty odpovídají znaku se stejným kódem). */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const CP1252: ReadonlyMap<string, number> = new Map([...CP1252_HIGH].map((c, i) => [c, 0x80 + i]));

/**
 * Text z exportu, který systém docházky přečetl ve špatném kódování: české znaky (Windows-1250) jako západoevropské
 * (Windows-1252), např. „Pøíjmení“, „Kuèera“. Text se převede zpět na bajty podle Windows-1252 a přečte jako
 * Windows-1250. Správný český text se nezmění: znaky č, ř, ě, ť … ve Windows-1252 nejsou, takový text se nechá být,
 * a společné znaky (á, í, š, ž …) mají v obou kódováních stejný bajt.
 */
export function fixEncoding(text: string): string {
  if (!decoder || ![...text].some((c) => c.charCodeAt(0) >= 0x80)) return text;
  const bytes: number[] = [];
  for (const c of text) {
    const code = c.charCodeAt(0);
    const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252.get(c);
    if (byte === undefined) return text;
    bytes.push(byte);
  }
  return decoder.decode(Uint8Array.from(bytes));
}

/** Jméno bez pozice: v exportu je za čárkou titul nebo pozice („Novák Jan, Logistik“ → „Novák Jan“). */
export const personName = (text: string) => text.split(',')[0]!.trim();

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
      const name = personName(text(row[nameC]));
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

// --- Dny: co osoba v den dělala ---

/** Zkratky dne: home office, dovolená, lékař, nemoc, služební cesta, náhradní volno. */
export const DAY_CODES = ['HO', 'DOV', 'L', 'N', 'SC', 'NV'] as const;
export type DayCode = (typeof DAY_CODES)[number];

const NOTE_ALIASES: Record<string, DayCode> = { HO: 'HO', DOV: 'DOV', LÉKAŘ: 'L', LEKAR: 'L', L: 'L', NEMOC: 'N', PN: 'N', N: 'N', SC: 'SC', NV: 'NV' };

export interface DayInfo {
  /** Zkratky dne s podílem dne (1 = celý den, 0,5 = půl dne). */
  codes: Map<DayCode, number>;
  /** Odpracováno v hodinách. */
  worked: number;
  /** Fond dne v hodinách. */
  fond: number;
  /** Hodiny podle mzdových složek dne (pro popisek). */
  hours: Map<string, number>;
}

const share = (hours: number, fond: number) => (hours >= (fond || 8) * 0.75 ? 1 : 0.5);

/**
 * Den osoby: zkratky z mzdových složek (Dovolená, Lékař, Nemoc, Služební cesta – celý nebo půl dne podle hodin
 * proti fondu) a z poznámky (HO, DOV, SC, NV, lékař; „1/2“ = půl dne). Stejná zkratka z obou zdrojů se počítá jednou
 * a podíl dne se vezme z hodin mzdové složky.
 */
export function dayInfos(data: AttendanceData, month: string | null): Map<string, Map<DayNumber, DayInfo>> {
  const inMonth = (day: DayNumber) => !month || dayToIso(day).startsWith(month);
  const result = new Map<string, Map<DayNumber, DayInfo>>();
  const info = (person: string, day: DayNumber) => {
    let days = result.get(person);
    if (!days) result.set(person, (days = new Map()));
    let d = days.get(day);
    if (!d) days.set(day, (d = { codes: new Map(), worked: 0, fond: 0, hours: new Map() }));
    return d;
  };
  const setCode = (d: DayInfo, code: DayCode, value: number) => d.codes.set(code, Math.max(d.codes.get(code) ?? 0, value));
  for (const v of data.values) {
    if (!inMonth(v.day)) continue;
    const d = info(v.person, v.day);
    d.hours.set(v.category, (d.hours.get(v.category) ?? 0) + v.value);
    if (is(v.category, /^fond/)) d.fond += v.value;
    else if (is(v.category, /odpracovano/)) d.worked += v.value;
  }
  for (const days of result.values())
    for (const d of days.values())
      for (const [category, hours] of d.hours) {
        if (hours <= 0) continue;
        const code: DayCode | null = is(category, /^dovolena/) ? 'DOV' : is(category, /^lekar/) ? 'L' : is(category, /^nemoc/) ? 'N' : is(category, /^sluzebni/) ? 'SC' : null;
        if (code) setCode(d, code, share(hours, d.fond));
      }
  for (const n of data.notes) {
    if (!inMonth(n.day)) continue;
    const d = info(n.person, n.day);
    for (const [raw, part] of noteCodes(n.text)) {
      const code = NOTE_ALIASES[raw];
      // Hodiny ze mzdové složky mají přednost; poznámka doplní jen zkratku, kterou složky nemají (HO, NV …).
      if (code && !d.codes.has(code)) d.codes.set(code, Math.min(1, part));
    }
  }
  return result;
}

// --- Přehled po lidech ---

export interface AttendanceSummary {
  person: AttendancePerson;
  fond: number;
  worked: number;
  credited: number;
  /** Přesčasy k dispozici: čistý součet „Přesčas evidence“ po dnech (kladné i záporné dny, +1 h a −1,5 h = −0,5 h). */
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
  /** Dny podle zkratek dne (HO, DOV, L, N, SC, NV) ze mzdových složek i poznámek. */
  days: Map<DayCode, number>;
  /** Fond do posledního dne s docházkou (bez budoucích dnů). */
  fondToDate: number;
  /** Saldo: započteno − fond, obojí do posledního dne s odpracovaným časem. */
  balance: number;
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
      {
        person: p,
        fond: 0,
        worked: 0,
        credited: 0,
        overtime: 0,
        approved: 0,
        toApprove: 0,
        doctor: 0,
        vacationHours: 0,
        sickHours: 0,
        tripHours: 0,
        night: 0,
        codes: new Map(),
        days: new Map(),
        fondToDate: 0,
        balance: 0,
        byCategory: new Map(),
      },
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
    else if (is(c, /^prescas/)) row.overtime += v.value;
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
    for (const [code, part] of noteCodes(n.text)) row.codes.set(code, (row.codes.get(code) ?? 0) + part);
  }
  // Dny podle zkratek a fond do posledního dne, za který export obsahuje odpracovaný nebo započtený čas.
  // Započteno export uvádí i dopředu (svátky, plánované nepřítomnosti), proto rozhoduje poslední den s odpracovaným časem.
  const lastDay = Math.max(-Infinity, ...data.values.filter((v) => inMonth(v.day) && is(v.category, /odpracovano/)).map((v) => v.day));
  const creditedToDate = new Map<string, number>();
  for (const v of data.values) if (inMonth(v.day) && v.day <= lastDay && is(v.category, /zapocteno/)) creditedToDate.set(v.person, (creditedToDate.get(v.person) ?? 0) + v.value);
  for (const [person, days] of dayInfos(data, month)) {
    const row = rows.get(person);
    if (!row) continue;
    for (const [day, d] of days) {
      if (day <= lastDay) row.fondToDate += d.fond;
      for (const [code, part] of d.codes) row.days.set(code, (row.days.get(code) ?? 0) + part);
    }
  }
  for (const row of rows.values()) row.balance = (creditedToDate.get(row.person.id) ?? 0) - row.fondToDate;
  return [...rows.values()];
}

// --- Přesčasy za období ---

/** Poslední den, za který export obsahuje odpracovaný čas (konec „dneška“ v datech); null bez dat. */
export function lastWorkedDay(data: AttendanceData): DayNumber | null {
  const days = data.values.filter((v) => is(v.category, /odpracovano/)).map((v) => v.day);
  return days.length ? Math.max(...days) : null;
}

export type OvertimePeriod = 'week' | 'month' | 'year' | 'total';
export const OVERTIME_PERIODS: readonly OvertimePeriod[] = ['week', 'month', 'year', 'total'];

/** Období přesčasů k referenčnímu dni: kalendářní týden (po–ne), měsíc a rok do referenčního dne, celkem vše načtené. */
export function overtimeRanges(data: AttendanceData, reference: DayNumber): Record<OvertimePeriod, { from: DayNumber; to: DayNumber }> {
  const [y, m] = dayToIso(reference).split('-').map(Number) as [number, number];
  const first = Math.min(reference, ...data.values.map((v) => v.day));
  return {
    week: { from: mondayOf(reference), to: reference },
    month: { from: dayFromParts(y, m, 1)!, to: reference },
    year: { from: dayFromParts(y, 1, 1)!, to: reference },
    total: { from: first, to: reference },
  };
}

/**
 * Přesčasy k dispozici po lidech za období: čistý součet denní „Přesčas evidence“ (kladné i záporné dny) v rozsahu dnů.
 * Dny po referenčním dni (budoucí část měsíce) se nepočítají.
 */
export function overtimeByPeriod(data: AttendanceData, reference: DayNumber): Map<string, Record<OvertimePeriod, number>> {
  const ranges = overtimeRanges(data, reference);
  const result = new Map<string, Record<OvertimePeriod, number>>(data.people.map((p) => [p.id, { week: 0, month: 0, year: 0, total: 0 }]));
  for (const v of data.values) {
    if (!is(v.category, /^prescas/)) continue;
    const row = result.get(v.person);
    if (!row) continue;
    for (const period of OVERTIME_PERIODS) if (v.day >= ranges[period].from && v.day <= ranges[period].to) row[period] += v.value;
  }
  return result;
}
