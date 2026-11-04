// Dveře vozu a čas stavby (pro Sekvenci: Order Status Matrix a klíč MC/MF).

import { dayFromParts, type DayNumber } from '../dates';

/** Čas jako minuty od 1. 1. 1970 (den × 1440 + minuta dne), bez časového pásma. */
export type Stamp = number;

export const MINUTES_PER_DAY = 1440;

export const dayOfStamp = (stamp: Stamp): DayNumber => Math.floor(stamp / MINUTES_PER_DAY);

/** Dveře vozu: přední levé / pravé, zadní levé / pravé, zadní výklopné. */
export type Door = 'FL' | 'FR' | 'RL' | 'RR' | 'HB';
export const DOORS: readonly Door[] = ['FL', 'FR', 'RL', 'RR', 'HB'];

/** Datum a čas „dd/mm/yyyy hh:mm(:ss)“ nebo „dd.mm.yyyy hh:mm“. */
export function parseStamp(text: string): Stamp | null {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(text.trim());
  if (!m) return null;
  const day = dayFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  if (day === null) return null;
  return day * MINUTES_PER_DAY + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
}
