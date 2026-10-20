// Nastavení plánování (karta Kapacity): kapacita linek po projektech, začátek směn a doprava k zákazníkovi.
// Ukládá se do sdílené složky jako Plan/Kapacity.xlsx, aby platilo pro všechny plánovače.

import { findColumn } from '../csv';
import { cellNumber, cellText, type Cell } from '../table';

export const SHIFT_CODES = ['R', 'O', 'N'] as const;
export type ShiftCode = (typeof SHIFT_CODES)[number];

/** Délka směny v minutách. */
export const SHIFT_MINUTES = 480;

/** Kapacita linky pro projekt: kusů za směnu a směny, které se v pracovní dny (po–pá) jedou. */
export interface LineCapacity {
  line: string;
  project: string;
  perShift: number;
  shifts: ShiftCode[];
}

/** Doprava k zákazníkovi podle destinace (složky souboru coverage). */
export interface Destination {
  /** Název destinace; prázdný = ostatní (díly bez souboru coverage nebo destinace bez vlastního řádku). */
  location: string;
  /** Kolik dní pokrytí musí zákazník mít na skladě, když dorazí auto. */
  coverDays: number;
  /** Doba přepravy v hodinách. */
  transitHours: number;
  /** Čas příjezdu k zákazníkovi v minutách od půlnoci. */
  arrival: number;
}

/** Výkon za směnu podle projektu a kategorie (přepočet odvolávek na směny); prázdný projekt = všechny projekty. */
export interface CategoryOutput {
  project: string;
  category: string;
  perShift: number;
}

export interface PlanSettings {
  /** Začátek ranní směny v minutách od půlnoci; směny R, O, N jdou po 8 hodinách za sebou. */
  firstShiftStart: number;
  lines: LineCapacity[];
  destinations: Destination[];
  outputs: CategoryOutput[];
}

export const DEFAULT_SETTINGS: PlanSettings = { firstShiftStart: 360, lines: [], destinations: [], outputs: [] };
export const DEFAULT_TRANSPORT: Omit<Destination, 'location'> = { coverDays: 2, transitHours: 24, arrival: 360 };
export const DEFAULT_SHIFTS: ShiftCode[] = [...SHIFT_CODES];

export const PLAN_FOLDER = 'Plan';
export const SETTINGS_FILE = 'Kapacity.xlsx';

const sameKey = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Kapacita linky pro projekt; bez řádku v nastavení 0 ks a všechny tři směny. */
export function lineCapacity(settings: PlanSettings, line: string, project: string): LineCapacity {
  return settings.lines.find((l) => sameKey(l.line, line) && sameKey(l.project, project)) ?? { line, project, perShift: 0, shifts: DEFAULT_SHIFTS };
}

/** Kusů za směnu pro projekt a kategorii: řádek projektu, jinak řádek kategorie bez projektu; null = nevyplněno. */
export function categoryOutput(settings: PlanSettings, project: string, category: string): number | null {
  if (!category) return null;
  const rows = settings.outputs.filter((o) => o.perShift > 0 && sameKey(o.category, category));
  return (rows.find((o) => o.project && sameKey(o.project, project)) ?? rows.find((o) => !o.project))?.perShift ?? null;
}

/** Doprava pro destinaci: vlastní řádek, jinak řádek „ostatní“, jinak výchozí 2 dny pokrytí, 24 h, příjezd 6:00. */
export function destinationOf(settings: PlanSettings, location: string): Destination {
  return (
    settings.destinations.find((d) => d.location && sameKey(d.location, location)) ??
    settings.destinations.find((d) => !d.location) ?? { location: '', ...DEFAULT_TRANSPORT }
  );
}

/** Čas z buňky: „6:00“, „06:00“, „6“, zlomek dne z Excelu (0,25) nebo datum s časem. */
export function parseTime(cell: Cell | undefined): number | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell.getUTCHours() * 60 + cell.getUTCMinutes();
  if (typeof cell === 'number') {
    if (cell >= 0 && cell < 1) return Math.round(cell * 1440);
    return cell >= 0 && cell <= 24 ? Math.round(cell * 60) : null;
  }
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(cellText(cell));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  return minutes <= 1440 ? minutes : null;
}

export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Směny z textu „R O N“, „R,O“ nebo počtu směn (2 = R a O). */
export function parseShifts(cell: Cell | undefined): ShiftCode[] {
  if (typeof cell === 'number') return SHIFT_CODES.slice(0, Math.max(0, Math.min(3, Math.round(cell))));
  const text = cellText(cell).toUpperCase();
  if (/^\d$/.test(text)) return SHIFT_CODES.slice(0, Math.min(3, Number(text)));
  return SHIFT_CODES.filter((code) => text.split(/[\s,;+/]+/).includes(code));
}

/** List sešitu: název, záhlaví a řádky (stejný tvar jako export do Excelu). */
export interface PlanSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

const COLUMNS = {
  line: ['Linka', 'Line'],
  project: ['Projekt', 'Project'],
  perShift: ['Ks za směnu', 'Pcs per shift', 'Kapacita'],
  shifts: ['Směny po–pá', 'Směny', 'Shifts'],
  location: ['Destinace', 'Destination'],
  coverDays: ['Pokrytí u zákazníka (dny)', 'Pokrytí', 'Coverage days'],
  transit: ['Transit (h)', 'Transit'],
  arrival: ['Příjezd', 'Arrival'],
  firstShift: ['Ranní směna od', 'First shift start'],
  category: ['Kategorie', 'Category'],
} as const;

export function settingsSheets(settings: PlanSettings): PlanSheet[] {
  return [
    {
      name: 'Linky',
      header: [COLUMNS.line[0], COLUMNS.project[0], COLUMNS.perShift[0], COLUMNS.shifts[0]],
      rows: settings.lines.map((l) => [l.line, l.project, l.perShift, l.shifts.join(' ')]),
    },
    {
      name: 'Destinace',
      header: [COLUMNS.location[0], COLUMNS.coverDays[0], COLUMNS.transit[0], COLUMNS.arrival[0]],
      rows: settings.destinations.map((d) => [d.location, d.coverDays, d.transitHours, formatTime(d.arrival)]),
    },
    { name: 'Směny', header: [COLUMNS.firstShift[0]], rows: [[formatTime(settings.firstShiftStart)]] },
    {
      name: 'Výkon kategorií',
      header: [COLUMNS.project[0], COLUMNS.category[0], COLUMNS.perShift[0]],
      rows: settings.outputs.filter((o) => o.perShift > 0).map((o) => [o.project, o.category, o.perShift]),
    },
  ];
}

/** Načte nastavení ze sešitu Kapacity.xlsx; chybějící list nebo hodnota = výchozí nastavení. */
export function parseSettings(sheets: readonly { name: string; data: Cell[][] }[]): PlanSettings {
  const table = (...aliases: (readonly string[])[]) => {
    for (const sheet of sheets) {
      const header = (sheet.data[0] ?? []).map((c) => cellText(c));
      const cols = aliases.map((a) => findColumn(header, a));
      if (cols[0] !== -1) return { cols, rows: sheet.data.slice(1) };
    }
    return null;
  };

  const lines: LineCapacity[] = [];
  // Starší soubor může mít sloupec „Ks v balení“; balení se teď bere jen z mapování (Order Multiple), sloupec se ignoruje.
  const lineTable = table(COLUMNS.line, COLUMNS.project, COLUMNS.perShift, COLUMNS.shifts);
  for (const row of lineTable?.rows ?? []) {
    const [line, project, perShift, shifts] = lineTable!.cols;
    const name = cellText(row[line!]).toUpperCase();
    if (!name) continue;
    lines.push({
      line: name,
      project: project === -1 ? '' : cellText(row[project!]),
      perShift: Math.max(0, (perShift === -1 ? null : cellNumber(row[perShift!])) ?? 0),
      shifts: shifts === -1 ? DEFAULT_SHIFTS : parseShifts(row[shifts!]),
    });
  }

  const destinations: Destination[] = [];
  const destTable = table(COLUMNS.location, COLUMNS.coverDays, COLUMNS.transit, COLUMNS.arrival);
  for (const row of destTable?.rows ?? []) {
    const [location, coverDays, transit, arrival] = destTable!.cols;
    const cover = coverDays === -1 ? null : cellNumber(row[coverDays!]);
    const hours = transit === -1 ? null : cellNumber(row[transit!]);
    if (!cellText(row[location!]) && cover === null && hours === null) continue;
    destinations.push({
      location: cellText(row[location!]),
      coverDays: cover ?? DEFAULT_TRANSPORT.coverDays,
      transitHours: hours ?? DEFAULT_TRANSPORT.transitHours,
      arrival: (arrival === -1 ? null : parseTime(row[arrival!])) ?? DEFAULT_TRANSPORT.arrival,
    });
  }

  const shiftTable = table(COLUMNS.firstShift);
  const firstShiftStart = parseTime(shiftTable?.rows[0]?.[shiftTable.cols[0]!]) ?? DEFAULT_SETTINGS.firstShiftStart;
  const outputs: CategoryOutput[] = [];
  const outputTable = table(COLUMNS.category, COLUMNS.project, COLUMNS.perShift);
  for (const row of outputTable?.rows ?? []) {
    const [category, project, perShift] = outputTable!.cols;
    const value = perShift === -1 ? null : cellNumber(row[perShift!]);
    if (!cellText(row[category!]) || value === null || value <= 0) continue;
    outputs.push({ project: project === -1 ? '' : cellText(row[project!]), category: cellText(row[category!]), perShift: value });
  }
  return { firstShiftStart, lines, destinations, outputs };
}
