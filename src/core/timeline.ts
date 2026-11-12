// Časová osa (Gantt) sdílená moduly Launch a Obaly: měřítko, šířka dne a rozsah osy po celých měsících.

import { dayFromParts, dayToIso, type DayNumber } from './dates';

export const TIMELINE_SCALES = ['week', 'month', 'quarter'] as const;
export type TimelineScale = (typeof TIMELINE_SCALES)[number];

/** Šířka dne v pixelech podle měřítka. */
export const DAY_WIDTH: Record<TimelineScale, number> = {
  week: 14,
  month: 5,
  quarter: 1.6,
};

const ymd = (day: DayNumber) => {
  const [y, m, d] = dayToIso(day).split('-').map(Number) as [number, number, number];
  return { y, m, d };
};

export const monthStart = (day: DayNumber) => {
  const { y, m } = ymd(day);
  return dayFromParts(y, m, 1)!;
};

/** První den následujícího měsíce. */
export const nextMonth = (day: DayNumber) => {
  const { y, m } = ymd(day);
  return m === 12 ? dayFromParts(y + 1, 1, 1)! : dayFromParts(y, m + 1, 1)!;
};

/** Rozsah osy: celé měsíce od nejdřívějšího po nejpozdější den, vždy včetně dneška (a týden rezervy na obou stranách). */
export function rangeOfDays(days: readonly DayNumber[], today: DayNumber): { from: DayNumber; to: DayNumber } {
  const first = Math.min(today, ...days) - 7;
  const last = Math.max(today, ...days) + 7;
  return { from: monthStart(first), to: nextMonth(last) };
}
