// Kalendářní data jako čísla dní od 1. 1. 1970 (bez časového pásma) a kalendářní týdny ISO 8601.

const MS_PER_DAY = 86_400_000;

/** Den jako celé číslo (dny od 1. 1. 1970 v UTC). */
export type DayNumber = number;

export function dayFromParts(year: number, month: number, day: number): DayNumber | null {
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ms / MS_PER_DAY;
}

/** Přečte datum ve tvaru DD.MM.YYYY, D.M.YYYY nebo YYYY-MM-DD. */
export function parseDay(input: string): DayNumber | null {
  const s = input.trim();
  let m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(s);
  if (m) return dayFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return dayFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Den z objektu Date (bere kalendářní datum v UTC, jak ho vrací čtení Excelu). */
export function dayFromDate(date: Date): DayNumber {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

export function dayToIso(day: DayNumber): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Den v týdnu: 1 = pondělí … 7 = neděle. */
export function weekday(day: DayNumber): number {
  // 1. 1. 1970 byl čtvrtek.
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

/** Pondělí týdne, do kterého den patří. */
export function mondayOf(day: DayNumber): DayNumber {
  return day - weekday(day) + 1;
}

export interface IsoWeek {
  year: number;
  week: number;
}

/** Kalendářní týden podle ISO 8601 (týden patří do roku, ve kterém leží jeho čtvrtek). */
export function isoWeek(day: DayNumber): IsoWeek {
  const thursday = mondayOf(day) + 3;
  const year = new Date(thursday * MS_PER_DAY).getUTCFullYear();
  const jan1 = dayFromParts(year, 1, 1)!;
  return { year, week: Math.floor((thursday - jan1) / 7) + 1 };
}

/** Pondělí daného ISO týdne. */
export function mondayOfIsoWeek(year: number, week: number): DayNumber {
  const jan4 = dayFromParts(year, 1, 4)!;
  return mondayOf(jan4) + (week - 1) * 7;
}

/** Popisek týdne, např. „CW 42“ nebo „CW 42/2026“. */
export function weekLabel(day: DayNumber, withYear = false): string {
  const { year, week } = isoWeek(day);
  return withYear ? `CW ${week}/${year}` : `CW ${week}`;
}
