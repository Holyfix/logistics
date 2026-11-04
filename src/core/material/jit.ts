// JIT Overview z ERP: zakázky po dveřích (Production number × dveře) s pozicemi; dveřní panel je pozice, která je
// v kusovníku dveřních panelů. Export má každý řádek celý v uvozovkách (uvnitř zdvojené), proto se čte dvakrát.

import { findColumn, parseCsv, type Table } from '../csv';
import { dayFromParts, type DayNumber } from '../dates';

/** Čas jako minuty od 1. 1. 1970 (den × 1440 + minuta dne), bez časového pásma. */
export type Stamp = number;

export const MINUTES_PER_DAY = 1440;

export const dayOfStamp = (stamp: Stamp): DayNumber => Math.floor(stamp / MINUTES_PER_DAY);

/** Dveře vozu: přední levé / pravé, zadní levé / pravé, zadní výklopné. */
export type Door = 'FL' | 'FR' | 'RL' | 'RR' | 'HB';
export const DOORS: readonly Door[] = ['FL', 'FR', 'RL', 'RR', 'HB'];

export const JIT_COLUMNS = {
  order: ['JIT order number'],
  item: ['Item'],
  productionNumber: ['Production number'],
  assembly: ['Assembly date'],
  status: ['Last priority'],
  position: ['Article number (Pos)'],
  positionDescription: ['Article description (Pos)'],
} as const;

/** Pozice JIT zakázky (jeden řádek exportu). */
export interface JitPosition {
  /** Zakázka na jedny dveře: JIT order number + Item. */
  order: string;
  productionNumber: string;
  /** Montáž u zákazníka; null, když datum chybí nebo je neplatné. */
  assembly: Stamp | null;
  /** Stav zakázky v ERP (Last priority). */
  status: string;
  article: string;
  description: string;
}

export type JitResult = { ok: true; value: JitPosition[] } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Datum a čas „dd/mm/yyyy hh:mm(:ss)“ nebo „dd.mm.yyyy hh:mm“. */
export function parseStamp(text: string): Stamp | null {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(text.trim());
  if (!m) return null;
  const day = dayFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  if (day === null) return null;
  return day * MINUTES_PER_DAY + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
}

/** Tabulka z textu exportu; řádky zabalené celé do uvozovek se rozbalí. */
export function jitTable(text: string): Table {
  const outer = parseCsv(text);
  if (outer.header.length !== 1 || !outer.header[0]!.includes(',')) return outer;
  return parseCsv([outer.header[0]!, ...outer.rows.map((r) => r[0] ?? '')].join('\n'), ',');
}

export function parseJit(text: string): JitResult {
  const table = jitTable(text);
  const col = Object.fromEntries(Object.entries(JIT_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)])) as Record<
    keyof typeof JIT_COLUMNS,
    number
  >;
  const missing = Object.entries(col)
    .filter(([, index]) => index === -1)
    .map(([key]) => JIT_COLUMNS[key as keyof typeof JIT_COLUMNS][0]);
  if (missing.length > 0) return { ok: false, error: 'missingColumns', columns: missing };
  const text_ = (row: string[], c: number) => (row[c] ?? '').trim();
  const value = table.rows
    .filter((row) => text_(row, col.productionNumber) && text_(row, col.position))
    .map((row) => ({
      order: `${text_(row, col.order)}/${text_(row, col.item)}`,
      productionNumber: text_(row, col.productionNumber).toUpperCase(),
      assembly: parseStamp(text_(row, col.assembly)),
      status: text_(row, col.status),
      article: text_(row, col.position).toUpperCase(),
      description: text_(row, col.positionDescription),
    }));
  return { ok: true, value };
}

/** Dveře z popisu dveřního panelu: „… FRT LH“ = FL, „… RR RH“ = RR, „HB“ = výklopné dveře. */
export function doorOf(description: string): Door | null {
  const d = description.toUpperCase();
  const m = /\b(FRT|RR)\s*(LH|RH)\b/.exec(d);
  if (m) return `${m[1] === 'FRT' ? 'F' : 'R'}${m[2] === 'LH' ? 'L' : 'R'}` as Door;
  return /\bHB\b/.test(d) ? 'HB' : null;
}
