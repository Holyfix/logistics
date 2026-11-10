// Skill Matrix: kdo umí jakou činnost (úroveň 0–4), zástupnost činností a periodická školení s platností.
// Ukládá se jako Excel do složky Lide ve sdílené složce (listy Lidé, Činnosti, Dovednosti, Matice, Školení, Absolvováno).

import { findColumn } from './csv';
import { dayFromParts, dayToIso, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

/** 0 neumí, 1 zaučuje se, 2 umí pod dohledem, 3 umí samostatně, 4 může školit. */
export const LEVELS = [0, 1, 2, 3, 4] as const;
export type Level = (typeof LEVELS)[number];
/** Od jaké úrovně člověk činnost zastoupí (umí samostatně). */
export const QUALIFIED: Level = 3;

export interface SkillPerson {
  name: string;
  team: string;
}

export interface Activity {
  name: string;
  /** Oblast (příjem, expedice, sklad …) pro seskupení sloupců. */
  area: string;
  /** Kolik lidí má činnost umět samostatně (méně = bez zástupu). */
  minQualified: number;
}

export interface Training {
  name: string;
  /** Platnost v měsících; null = platí trvale. */
  validityMonths: number | null;
}

export interface TrainingRecord {
  person: string;
  training: string;
  /** Den absolvování. */
  date: DayNumber;
  /** Platí do (dopočítané z platnosti, nebo ruční); null = trvale. */
  validUntil: DayNumber | null;
}

export interface SkillData {
  people: SkillPerson[];
  activities: Activity[];
  /** Úroveň `osoba|činnost` (chybí = 0). */
  levels: Record<string, Level>;
  trainings: Training[];
  records: TrainingRecord[];
}

export const emptySkills = (): SkillData => ({ people: [], activities: [], levels: {}, trainings: [], records: [] });

export const DEFAULT_MIN_QUALIFIED = 2;
/** Za kolik dní před koncem platnosti školení upozornit. */
export const EXPIRY_WARN_DAYS = 30;

const key = (person: string, activity: string) => `${person}|${activity}`;
export const levelOf = (data: SkillData, person: string, activity: string): Level => data.levels[key(person, activity)] ?? 0;

export const nextLevel = (level: Level): Level => ((level + 1) % LEVELS.length) as Level;

export function withLevel(data: SkillData, person: string, activity: string, level: Level): SkillData {
  const levels = { ...data.levels };
  if (level === 0) delete levels[key(person, activity)];
  else levels[key(person, activity)] = level;
  return { ...data, levels };
}

/** Kolik lidí umí činnost samostatně (úroveň 3 a 4). */
export const qualifiedCount = (data: SkillData, activity: string) => data.people.filter((p) => levelOf(data, p.name, activity) >= QUALIFIED).length;

/** Činnosti, které umí samostatně méně lidí, než je potřeba. */
export const uncovered = (data: SkillData) => data.activities.filter((a) => qualifiedCount(data, a.name) < a.minQualified);

/** Platí do: den absolvování + platnost v měsících (bez platnosti trvale). */
export function validUntil(date: DayNumber, months: number | null): DayNumber | null {
  if (months === null) return null;
  const [y, m, d] = dayToIso(date).split('-').map(Number) as [number, number, number];
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  // Den v kratším měsíci se srovná na poslední den měsíce.
  for (let day = d; day > 0; day--) {
    const result = dayFromParts(year, month, day);
    if (result !== null) return result;
  }
  return null;
}

/** expired = propadlé, soon = končí do 30 dní, ok = platné, none = chybí. */
export type TrainingState = 'expired' | 'soon' | 'ok' | 'none';

export const recordOf = (data: SkillData, person: string, training: string) => data.records.find((r) => r.person === person && r.training === training);

export function trainingState(record: TrainingRecord | undefined, today: DayNumber): TrainingState {
  if (!record) return 'none';
  if (record.validUntil === null) return 'ok';
  if (record.validUntil < today) return 'expired';
  return record.validUntil - today <= EXPIRY_WARN_DAYS ? 'soon' : 'ok';
}

/** Školení po platnosti a končící do 30 dní (u lidí ze seznamu). */
export function trainingAlerts(data: SkillData, today: DayNumber): { expired: TrainingRecord[]; soon: TrainingRecord[] } {
  const names = new Set(data.people.map((p) => p.name));
  const records = data.records.filter((r) => names.has(r.person) && data.trainings.some((t) => t.name === r.training));
  return {
    expired: records.filter((r) => trainingState(r, today) === 'expired'),
    soon: records.filter((r) => trainingState(r, today) === 'soon'),
  };
}

/** Zápis absolvování školení; platí do se dopočítá z platnosti školení. Bez data se záznam smaže. */
export function withRecord(data: SkillData, person: string, training: string, date: DayNumber | null): SkillData {
  const rest = data.records.filter((r) => !(r.person === person && r.training === training));
  if (date === null) return { ...data, records: rest };
  const months = data.trainings.find((t) => t.name === training)?.validityMonths ?? null;
  return { ...data, records: [...rest, { person, training, date, validUntil: validUntil(date, months) }] };
}

// --- Úpravy seznamů ---

const unique = (names: readonly string[], name: string, from?: string) => {
  const n = name.trim();
  return n && (n === from || !names.includes(n)) ? n : null;
};

export function addPerson(data: SkillData, name: string, team = ''): SkillData | null {
  const n = unique(data.people.map((p) => p.name), name);
  return n ? { ...data, people: [...data.people, { name: n, team: team.trim() }] } : null;
}

export function addActivity(data: SkillData, name: string, area = ''): SkillData | null {
  const n = unique(data.activities.map((a) => a.name), name);
  return n ? { ...data, activities: [...data.activities, { name: n, area: area.trim(), minQualified: DEFAULT_MIN_QUALIFIED }] } : null;
}

export function addTraining(data: SkillData, name: string, validityMonths: number | null = 12): SkillData | null {
  const n = unique(data.trainings.map((t) => t.name), name);
  return n ? { ...data, trainings: [...data.trainings, { name: n, validityMonths }] } : null;
}

const renameKeys = (levels: Record<string, Level>, map: (person: string, activity: string) => [string, string]) =>
  Object.fromEntries(
    Object.entries(levels).map(([k, v]) => {
      const [p, a] = k.split('|') as [string, string];
      const [np, na] = map(p, a);
      return [key(np, na), v];
    }),
  );

/** Přejmenování osoby (i v úrovních a školeních); prázdné nebo použité jméno = null. */
export function renamePerson(data: SkillData, from: string, to: string): SkillData | null {
  const n = unique(data.people.map((p) => p.name), to, from);
  if (!n) return null;
  return {
    ...data,
    people: data.people.map((p) => (p.name === from ? { ...p, name: n } : p)),
    levels: renameKeys(data.levels, (p, a) => [p === from ? n : p, a]),
    records: data.records.map((r) => (r.person === from ? { ...r, person: n } : r)),
  };
}

export function renameActivity(data: SkillData, from: string, to: string): SkillData | null {
  const n = unique(data.activities.map((a) => a.name), to, from);
  if (!n) return null;
  return {
    ...data,
    activities: data.activities.map((a) => (a.name === from ? { ...a, name: n } : a)),
    levels: renameKeys(data.levels, (p, a) => [p, a === from ? n : a]),
  };
}

export function renameTraining(data: SkillData, from: string, to: string): SkillData | null {
  const n = unique(data.trainings.map((t) => t.name), to, from);
  if (!n) return null;
  return {
    ...data,
    trainings: data.trainings.map((t) => (t.name === from ? { ...t, name: n } : t)),
    records: data.records.map((r) => (r.training === from ? { ...r, training: n } : r)),
  };
}

export const updatePerson = (data: SkillData, name: string, change: Partial<SkillPerson>): SkillData => ({ ...data, people: data.people.map((p) => (p.name === name ? { ...p, ...change, name } : p)) });
export const updateActivity = (data: SkillData, name: string, change: Partial<Activity>): SkillData => ({
  ...data,
  activities: data.activities.map((a) => (a.name === name ? { ...a, ...change, name } : a)),
});

/** Nová platnost školení přepočítá „platí do“ u všech záznamů školení. */
export function setValidity(data: SkillData, training: string, validityMonths: number | null): SkillData {
  return {
    ...data,
    trainings: data.trainings.map((t) => (t.name === training ? { ...t, validityMonths } : t)),
    records: data.records.map((r) => (r.training === training ? { ...r, validUntil: validUntil(r.date, validityMonths) } : r)),
  };
}

export function removePerson(data: SkillData, name: string): SkillData {
  return {
    ...data,
    people: data.people.filter((p) => p.name !== name),
    levels: Object.fromEntries(Object.entries(data.levels).filter(([k]) => k.split('|')[0] !== name)),
    records: data.records.filter((r) => r.person !== name),
  };
}

export function removeActivity(data: SkillData, name: string): SkillData {
  return { ...data, activities: data.activities.filter((a) => a.name !== name), levels: Object.fromEntries(Object.entries(data.levels).filter(([k]) => k.split('|')[1] !== name)) };
}

export function removeTraining(data: SkillData, name: string): SkillData {
  return { ...data, trainings: data.trainings.filter((t) => t.name !== name), records: data.records.filter((r) => r.training !== name) };
}

// --- Soubor SkillMatrix.xlsx ---

const COLUMNS = {
  name: ['Jméno', 'Name', 'Osoba'],
  team: ['Tým', 'Team', 'Oddělení'],
  activity: ['Činnost', 'Activity', 'Skill'],
  area: ['Oblast', 'Area'],
  min: ['Min. samostatně', 'Min. zástupců', 'Minimum'],
  level: ['Úroveň', 'Level'],
  training: ['Školení', 'Training'],
  validity: ['Platnost (měsíců)', 'Platnost', 'Validity (months)'],
  date: ['Datum', 'Absolvováno', 'Date'],
  until: ['Platí do', 'Valid until'],
} as const;

const formatDate = (day: DayNumber | null) => {
  if (day === null) return null;
  const [y, m, d] = dayToIso(day).split('-');
  return `${d}.${m}.${y}`;
};

export interface SkillSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

/** Listy souboru; Matice je jen pro čtení v Excelu (úrovně se načítají z listu Dovednosti). */
export function skillSheets(data: SkillData): SkillSheet[] {
  return [
    { name: 'Lidé', header: [COLUMNS.name[0], COLUMNS.team[0]], rows: data.people.map((p) => [p.name, p.team || null]) },
    { name: 'Činnosti', header: [COLUMNS.activity[0], COLUMNS.area[0], COLUMNS.min[0]], rows: data.activities.map((a) => [a.name, a.area || null, a.minQualified]) },
    {
      name: 'Dovednosti',
      header: [COLUMNS.name[0], COLUMNS.activity[0], COLUMNS.level[0]],
      rows: data.people.flatMap((p) => data.activities.flatMap((a) => (levelOf(data, p.name, a.name) ? [[p.name, a.name, levelOf(data, p.name, a.name)]] : []))),
    },
    {
      name: 'Matice',
      header: [COLUMNS.name[0], COLUMNS.team[0], ...data.activities.map((a) => a.name)],
      rows: data.people.map((p) => [p.name, p.team || null, ...data.activities.map((a) => levelOf(data, p.name, a.name))]),
    },
    { name: 'Školení', header: [COLUMNS.training[0], COLUMNS.validity[0]], rows: data.trainings.map((t) => [t.name, t.validityMonths]) },
    {
      name: 'Absolvováno',
      header: [COLUMNS.name[0], COLUMNS.training[0], COLUMNS.date[0], COLUMNS.until[0]],
      rows: [...data.records].sort((a, b) => a.person.localeCompare(b.person, 'cs') || a.training.localeCompare(b.training, 'cs')).map((r) => [r.person, r.training, formatDate(r.date), formatDate(r.validUntil)]),
    },
  ];
}

export type SkillResult = { ok: true; value: SkillData } | { ok: false; error: 'missingColumns'; columns: string[] };

type Sheets = readonly { name: string; data: Cell[][] }[];

function findSheet(sheets: Sheets, required: readonly (readonly string[])[], exclude: readonly (readonly string[])[] = []) {
  for (const sheet of sheets) {
    const header = (sheet.data[0] ?? []).map((c) => cellText(c));
    const cols = required.map((a) => findColumn(header, a));
    if (cols.every((c) => c !== -1) && exclude.every((a) => findColumn(header, a) === -1)) return { header, rows: sheet.data.slice(1), cols };
  }
  return null;
}

export function parseSkillWorkbook(sheets: Sheets): SkillResult {
  const peopleSheet = findSheet(sheets, [COLUMNS.name, COLUMNS.team], [COLUMNS.activity, COLUMNS.training]);
  const activitySheet = findSheet(sheets, [COLUMNS.activity, COLUMNS.area], [COLUMNS.name]);
  const levelSheet = findSheet(sheets, [COLUMNS.name, COLUMNS.activity, COLUMNS.level]);
  if (!peopleSheet && !levelSheet) return { ok: false, error: 'missingColumns', columns: [COLUMNS.name[0], COLUMNS.team[0]] };
  const data = emptySkills();
  const addName = (name: string, team = '') => {
    if (name && !data.people.some((p) => p.name === name)) data.people.push({ name, team });
  };
  const addAct = (name: string, area = '', min = DEFAULT_MIN_QUALIFIED) => {
    if (name && !data.activities.some((a) => a.name === name)) data.activities.push({ name, area, minQualified: min });
  };
  if (peopleSheet) for (const row of peopleSheet.rows) addName(cellText(row[peopleSheet.cols[0]!]), cellText(row[peopleSheet.cols[1]!]));
  if (activitySheet) {
    const minC = findColumn(activitySheet.header, COLUMNS.min);
    for (const row of activitySheet.rows) {
      const min = minC === -1 ? null : cellNumber(row[minC]);
      addAct(cellText(row[activitySheet.cols[0]!]), cellText(row[activitySheet.cols[1]!]), min === null ? DEFAULT_MIN_QUALIFIED : Math.max(0, Math.round(min)));
    }
  }
  if (levelSheet) {
    for (const row of levelSheet.rows) {
      const person = cellText(row[levelSheet.cols[0]!]);
      const activity = cellText(row[levelSheet.cols[1]!]);
      const value = cellNumber(row[levelSheet.cols[2]!]);
      if (!person || !activity || value === null) continue;
      addName(person);
      addAct(activity);
      const level = Math.max(0, Math.min(4, Math.round(value))) as Level;
      if (level) data.levels[key(person, activity)] = level;
    }
  }
  const trainingSheet = findSheet(sheets, [COLUMNS.training, COLUMNS.validity], [COLUMNS.name]);
  if (trainingSheet)
    for (const row of trainingSheet.rows) {
      const name = cellText(row[trainingSheet.cols[0]!]);
      const months = cellNumber(row[trainingSheet.cols[1]!]);
      if (name && !data.trainings.some((t) => t.name === name)) data.trainings.push({ name, validityMonths: months === null || months <= 0 ? null : Math.round(months) });
    }
  const recordSheet = findSheet(sheets, [COLUMNS.name, COLUMNS.training, COLUMNS.date]);
  if (recordSheet) {
    const untilC = findColumn(recordSheet.header, COLUMNS.until);
    for (const row of recordSheet.rows) {
      const person = cellText(row[recordSheet.cols[0]!]);
      const training = cellText(row[recordSheet.cols[1]!]);
      const date = cellDay(row[recordSheet.cols[2]!]);
      if (!person || !training || date === null) continue;
      addName(person);
      if (!data.trainings.some((t) => t.name === training)) data.trainings.push({ name: training, validityMonths: null });
      const months = data.trainings.find((t) => t.name === training)!.validityMonths;
      const manual = untilC === -1 ? null : cellDay(row[untilC]);
      data.records = [...data.records.filter((r) => !(r.person === person && r.training === training)), { person, training, date, validUntil: manual ?? validUntil(date, months) }];
    }
  }
  return { ok: true, value: data };
}
