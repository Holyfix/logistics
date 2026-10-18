// KPI po písmenech SQCDP (bezpečnost, kvalita, náklady, dodávky, lidé): ukazatele s cílem, denní zápis hodnot,
// stav dne a měsíce po písmenech. Ukládá se jako Excel do složky KPI ve sdílené složce (ukazatele, hodnoty, zapsané dny).

import { findColumn } from './csv';
import { dayFromParts, dayToIso, weekday, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

export const LETTERS = ['S', 'Q', 'C', 'D', 'P'] as const;
export type Letter = (typeof LETTERS)[number];

export type KpiStatus = 'green' | 'yellow' | 'red';

/** Odkud se hodnota bere: ruční zápis, nebo automaticky z dat aplikace v okamžiku zápisu dne. */
export const KPI_SOURCES = ['manual', 'coverageShortage', 'componentsShort', 'oilOverdue'] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];

export interface KpiDef {
  /** Stálý klíč ukazatele (v souboru ve sloupci ID). */
  id: string;
  letter: Letter;
  name: string;
  unit: string;
  /** Hodnota v cíli (zelená): nejvýš tolik, u „více je lépe“ aspoň tolik. */
  target: number;
  /** Hranice červené: za ní je den červený, mezi cílem a hranicí žlutý. null = jen upozornění (nikdy červená). */
  red: number | null;
  /** Více je lépe (např. plnění v %); jinak méně je lépe. */
  higherIsBetter: boolean;
  source: KpiSource;
  /** Kategorie (např. druhy událostí): zapisuje se počet po kategoriích, hodnota je jejich součet. */
  categories: string[];
}

/** Zápis jednoho dne: hodnoty ukazatelů (klíč ID, u kategorií „ID|kategorie“), kdo a kdy zapsal. */
export interface KpiEntry {
  day: DayNumber;
  author: string;
  at: string;
  values: Record<string, number>;
}

export interface KpiData {
  defs: KpiDef[];
  /** Zapsané dny seřazené od nejstaršího. */
  entries: KpiEntry[];
}

/** Úvodní sada ukazatelů (názvy a kategorie podle jazyka, ostatní napevno; vše jde v aplikaci upravit). */
export interface DefaultKpiTexts {
  names: Record<string, string>;
  units: Record<string, string>;
  categories: Record<string, string[]>;
}

const DEFAULTS: Omit<KpiDef, 'name' | 'unit' | 'categories'>[] = [
  { id: 's_injury', letter: 'S', target: 0, red: 0, higherIsBetter: false, source: 'manual' },
  { id: 's_nearmiss', letter: 'S', target: 0, red: null, higherIsBetter: false, source: 'manual' },
  { id: 'q_claims', letter: 'Q', target: 0, red: 0, higherIsBetter: false, source: 'manual' },
  { id: 'c_premium', letter: 'C', target: 0, red: 5000, higherIsBetter: false, source: 'manual' },
  { id: 'd_customer', letter: 'D', target: 0, red: 10, higherIsBetter: false, source: 'coverageShortage' },
  { id: 'd_components', letter: 'D', target: 0, red: 0, higherIsBetter: false, source: 'componentsShort' },
  { id: 'd_premium', letter: 'D', target: 0, red: 1, higherIsBetter: false, source: 'manual' },
  { id: 'd_linestop', letter: 'D', target: 0, red: 0, higherIsBetter: false, source: 'manual' },
  { id: 'p_absent', letter: 'P', target: 1, red: 2, higherIsBetter: false, source: 'manual' },
  { id: 'p_oil', letter: 'P', target: 0, red: 3, higherIsBetter: false, source: 'oilOverdue' },
];

export function defaultKpis(texts: DefaultKpiTexts): KpiData {
  return {
    defs: DEFAULTS.map((d) => ({ ...d, name: texts.names[d.id] ?? d.id, unit: texts.units[d.id] ?? '', categories: texts.categories[d.id] ?? [] })),
    entries: [],
  };
}

/** Klíč hodnoty kategorie ukazatele. */
export const categoryKey = (def: KpiDef, category: string) => `${def.id}|${category}`;

/** Hodnota ukazatele v zápisu: přímo, u kategorií součet; null = nezapsáno. */
export function kpiValue(entry: KpiEntry | undefined, def: KpiDef): number | null {
  if (!entry) return null;
  if (def.categories.length) {
    const values = def.categories.map((c) => entry.values[categoryKey(def, c)]).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  return entry.values[def.id] ?? null;
}

/** Stav hodnoty: v cíli zelená, za hranicí červená, mezi nimi žlutá. */
export function kpiStatus(def: KpiDef, value: number): KpiStatus {
  const better = (a: number, b: number) => (def.higherIsBetter ? a >= b : a <= b);
  if (better(value, def.target)) return 'green';
  if (def.red !== null && !better(value, def.red)) return 'red';
  return 'yellow';
}

const RANK: Record<KpiStatus, number> = { green: 0, yellow: 1, red: 2 };
const worst = (statuses: KpiStatus[]): KpiStatus | null => (statuses.length ? statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : null);

/** Stav dne v kalendáři: barva, nezapsaný pracovní den, bez dat (víkend, před prvním zápisem) nebo budoucí. */
export type DayState = KpiStatus | 'missing' | 'weekend' | 'none' | 'future';

export const isWeekend = (day: DayNumber) => weekday(day) >= 6;

export function entryOf(data: KpiData, day: DayNumber): KpiEntry | undefined {
  return data.entries.find((e) => e.day === day);
}

/** Stav písmene v zapsaném dni: nejhorší z jeho ukazatelů (bez zapsané hodnoty se nepočítá). */
export function letterStatus(data: KpiData, letter: Letter, entry: KpiEntry): KpiStatus | null {
  return worst(
    data.defs
      .filter((d) => d.letter === letter)
      .flatMap((d) => {
        const v = kpiValue(entry, d);
        return v === null ? [] : [kpiStatus(d, v)];
      }),
  );
}

/**
 * Stav dne písmene. Zapsaný den má barvu podle ukazatelů; nezapsaný pracovní den po prvním zápisu je „chybí“;
 * víkend bez zápisu a dny před prvním zápisem jsou bez dat; dny po dnešku budoucí.
 */
export function dayState(data: KpiData, letter: Letter, day: DayNumber, today: DayNumber): DayState {
  const entry = entryOf(data, day);
  if (entry) return letterStatus(data, letter, entry) ?? 'none';
  if (isWeekend(day)) return 'weekend';
  if (day >= today) return 'future';
  const first = data.entries[0]?.day;
  if (first === undefined || day < first) return 'none';
  return 'missing';
}

/** Dny měsíce (1 … 28–31). */
export function monthDays(year: number, month: number): DayNumber[] {
  const first = dayFromParts(year, month, 1)!;
  const next = month === 12 ? dayFromParts(year + 1, 1, 1)! : dayFromParts(year, month + 1, 1)!;
  return Array.from({ length: next - first }, (_, k) => first + k);
}

/** Podíl zelených dní, od kterého je měsíc zelený / žlutý. */
export const MONTH_GREEN = 0.9;
export const MONTH_YELLOW = 0.75;

export interface MonthSummary {
  /** Zapsané dny s barvou. */
  days: number;
  green: number;
  /** null = žádný zapsaný den. */
  status: KpiStatus | null;
}

/** Měsíc písmene: podle podílu zelených dní ze zapsaných (aspoň 90 % zelená, aspoň 75 % žlutá, jinak červená). */
export function monthSummary(data: KpiData, letter: Letter, year: number, month: number): MonthSummary {
  const days = new Set(monthDays(year, month));
  const statuses = data.entries.filter((e) => days.has(e.day)).flatMap((e) => {
    const s = letterStatus(data, letter, e);
    return s ? [s] : [];
  });
  const green = statuses.filter((s) => s === 'green').length;
  const share = statuses.length ? green / statuses.length : 0;
  return { days: statuses.length, green, status: statuses.length === 0 ? null : share >= MONTH_GREEN ? 'green' : share >= MONTH_YELLOW ? 'yellow' : 'red' };
}

/** Sloupec Paretova grafu: kategorie ukazatele, nebo ukazatel bez kategorií (součet hodnot = počet událostí). */
export interface ParetoBar {
  key: string;
  label: string;
  value: number;
  /** Kumulativní podíl včetně tohoto sloupce (0–1). */
  cumulative: number;
}

/**
 * Pareto písmene za období from–to (včetně): ukazatel s kategoriemi přispívá součtem za každou kategorii,
 * ukazatel bez kategorií svým součtem (např. úrazy). Jen nenulové sloupce, seřazené sestupně.
 */
export function paretoOf(data: KpiData, letter: Letter, from: DayNumber, to: DayNumber): ParetoBar[] {
  const entries = data.entries.filter((e) => e.day >= from && e.day <= to);
  const sum = (key: string) => entries.reduce((total, e) => total + (e.values[key] ?? 0), 0);
  const bars = data.defs
    .filter((d) => d.letter === letter)
    .flatMap((def) => (def.categories.length ? def.categories.map((c) => ({ key: categoryKey(def, c), label: c })) : [{ key: def.id, label: def.name }]))
    .map((b) => ({ ...b, value: sum(b.key) }));
  const sorted = bars.filter((b) => b.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((t, b) => t + b.value, 0);
  let running = 0;
  return sorted.map((b) => {
    running += b.value;
    return { ...b, cumulative: running / total };
  });
}

/** Denní hodnota ukazatele se stavem. */
export interface DailyBar {
  day: DayNumber;
  value: number;
  status: KpiStatus;
}

/** Posledních `count` zapsaných dní ukazatele do dne `to` (včetně), od nejstaršího. */
export function dailyBars(data: KpiData, def: KpiDef, to: DayNumber, count: number): DailyBar[] {
  const bars: DailyBar[] = [];
  for (const entry of [...data.entries].filter((e) => e.day <= to).sort((a, b) => b.day - a.day)) {
    const value = kpiValue(entry, def);
    if (value === null) continue;
    bars.push({ day: entry.day, value, status: kpiStatus(def, value) });
    if (bars.length === count) break;
  }
  return bars.reverse();
}

/** Den, který se na ranní poradě zapisuje: předchozí pracovní den (v pondělí pátek). */
export function previousWorkday(today: DayNumber): DayNumber {
  let day = today - 1;
  while (isWeekend(day)) day--;
  return day;
}

/** Zápis dne (nahradí dřívější zápis téhož dne). */
export function withEntry(data: KpiData, entry: KpiEntry): KpiData {
  return { ...data, entries: [...data.entries.filter((e) => e.day !== entry.day), entry].sort((a, b) => a.day - b.day) };
}

export function withoutEntry(data: KpiData, day: DayNumber): KpiData {
  return { ...data, entries: data.entries.filter((e) => e.day !== day) };
}

/** Nový ukazatel s volným ID. */
export function addDef(data: KpiData, letter: Letter, name: string): KpiData {
  let n = data.defs.length + 1;
  while (data.defs.some((d) => d.id === `k${n}`)) n++;
  const def: KpiDef = { id: `k${n}`, letter, name, unit: '', target: 0, red: null, higherIsBetter: false, source: 'manual', categories: [] };
  return { ...data, defs: [...data.defs, def] };
}

export function updateDef(data: KpiData, id: string, change: (def: KpiDef) => KpiDef): KpiData {
  return { ...data, defs: data.defs.map((d) => (d.id === id ? change(d) : d)) };
}

/** Odebere ukazatel (zapsané hodnoty v souboru zůstanou, jen se nezobrazují). */
export function removeDef(data: KpiData, id: string): KpiData {
  return { ...data, defs: data.defs.filter((d) => d.id !== id) };
}

// --- Soubor KPI.xlsx ---

const COLUMNS = {
  id: ['ID'],
  letter: ['Písmeno', 'Letter'],
  name: ['Ukazatel', 'KPI'],
  unit: ['Jednotka', 'Unit'],
  target: ['Cíl', 'Target'],
  red: ['Červená za', 'Red beyond'],
  direction: ['Lepší je', 'Better'],
  source: ['Zdroj', 'Source'],
  categories: ['Kategorie', 'Categories'],
  day: ['Datum', 'Date'],
  category: ['Kategorie', 'Category'],
  value: ['Hodnota', 'Value'],
  author: ['Zapsal', 'Author'],
  at: ['Kdy', 'When'],
} as const;

const HIGHER = 'více';
const LOWER = 'méně';

const formatDate = (day: DayNumber) => {
  const [y, m, d] = dayToIso(day).split('-');
  return `${d}.${m}.${y}`;
};

export interface KpiSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

/** Listy souboru: „Ukazatele“ (definice), „Hodnoty“ (den × ukazatel × kategorie) a „Dny“ (kdo a kdy zapsal). */
export function kpiSheets(data: KpiData): KpiSheet[] {
  const byId = new Map(data.defs.map((d) => [d.id, d]));
  return [
    {
      name: 'Ukazatele',
      header: [COLUMNS.id[0], COLUMNS.letter[0], COLUMNS.name[0], COLUMNS.unit[0], COLUMNS.target[0], COLUMNS.red[0], COLUMNS.direction[0], COLUMNS.source[0], COLUMNS.categories[0]],
      rows: data.defs.map((d) => [d.id, d.letter, d.name, d.unit, d.target, d.red, d.higherIsBetter ? HIGHER : LOWER, d.source, d.categories.join('; ')]),
    },
    {
      name: 'Hodnoty',
      header: [COLUMNS.day[0], COLUMNS.id[0], COLUMNS.name[0], COLUMNS.category[0], COLUMNS.value[0]],
      rows: data.entries.flatMap((e) =>
        Object.entries(e.values).map(([key, value]) => {
          const [id, category = ''] = key.split('|');
          return [formatDate(e.day), id!, byId.get(id!)?.name ?? '', category, value];
        }),
      ),
    },
    {
      name: 'Dny',
      header: [COLUMNS.day[0], COLUMNS.author[0], COLUMNS.at[0]],
      rows: data.entries.map((e) => [formatDate(e.day), e.author, e.at]),
    },
  ];
}

export type KpiResult = { ok: true; value: KpiData } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Načte KPI ze souboru; listy se hledají podle sloupců. Bez listu ukazatelů zůstane seznam prázdný. */
export function parseKpiWorkbook(sheets: readonly { name: string; data: Cell[][] }[]): KpiResult {
  const find = (required: readonly (readonly string[])[], except?: unknown) => {
    for (const sheet of sheets) {
      const header = (sheet.data[0] ?? []).map((c) => cellText(c));
      const cols = required.map((a) => findColumn(header, a));
      if (cols.every((c) => c !== -1) && sheet !== except) return { sheet, header, rows: sheet.data.slice(1), cols };
    }
    return null;
  };
  const defsSheet = find([COLUMNS.id, COLUMNS.letter, COLUMNS.name, COLUMNS.target]);
  const valuesSheet = find([COLUMNS.day, COLUMNS.id, COLUMNS.value], defsSheet?.sheet);
  if (!defsSheet && !valuesSheet) return { ok: false, error: 'missingColumns', columns: [COLUMNS.id[0], COLUMNS.letter[0], COLUMNS.name[0], COLUMNS.target[0]] };

  const defs: KpiDef[] = [];
  if (defsSheet) {
    const [idC, letterC, nameC, targetC] = defsSheet.cols as [number, number, number, number];
    const col = (aliases: readonly string[]) => findColumn(defsSheet.header, aliases);
    const [unitC, redC, dirC, sourceC, catC] = [col(COLUMNS.unit), col(COLUMNS.red), col(COLUMNS.direction), col(COLUMNS.source), col(COLUMNS.categories)];
    const text = (row: Cell[], c: number) => (c === -1 ? '' : cellText(row[c]));
    for (const row of defsSheet.rows) {
      const id = cellText(row[idC]);
      const letter = cellText(row[letterC]).toUpperCase() as Letter;
      if (!id || !LETTERS.includes(letter) || defs.some((d) => d.id === id)) continue;
      const source = text(row, sourceC) as KpiSource;
      defs.push({
        id,
        letter,
        name: cellText(row[nameC]),
        unit: text(row, unitC),
        target: cellNumber(row[targetC]) ?? 0,
        red: redC === -1 ? null : cellNumber(row[redC]),
        higherIsBetter: text(row, dirC).toLowerCase() === HIGHER,
        source: KPI_SOURCES.includes(source) ? source : 'manual',
        categories: text(row, catC)
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean),
      });
    }
  }

  const entries = new Map<DayNumber, KpiEntry>();
  const entry = (day: DayNumber) => {
    let e = entries.get(day);
    if (!e) entries.set(day, (e = { day, author: '', at: '', values: {} }));
    return e;
  };
  if (valuesSheet) {
    const [dayC, idC, valueC] = valuesSheet.cols as [number, number, number];
    const catC = findColumn(valuesSheet.header, COLUMNS.category);
    for (const row of valuesSheet.rows) {
      const day = cellDay(row[dayC]);
      const id = cellText(row[idC]);
      const value = cellNumber(row[valueC]);
      if (day === null || !id || value === null) continue;
      const category = catC === -1 ? '' : cellText(row[catC]);
      entry(day).values[category ? `${id}|${category}` : id] = value;
    }
  }
  const daysSheet = find([COLUMNS.day, COLUMNS.author], valuesSheet?.sheet);
  if (daysSheet) {
    const [dayC, authorC] = daysSheet.cols as [number, number];
    const atC = findColumn(daysSheet.header, COLUMNS.at);
    for (const row of daysSheet.rows) {
      const day = cellDay(row[dayC]);
      if (day === null) continue;
      const e = entry(day);
      e.author = cellText(row[authorC]);
      e.at = atC === -1 ? '' : cellText(row[atC]);
    }
  }
  return { ok: true, value: { defs, entries: [...entries.values()].sort((a, b) => a.day - b.day) } };
}
