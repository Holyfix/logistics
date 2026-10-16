// Potřeba zákazníka na nás po dnech: soubor sekvencéra (sklad + transit − plán zákazníka), dál odvolávky.
// Používají ji Komponenty i Plánování.

import type { CallOffExport } from './calloffs/parse';
import type { CoverageSource } from './coverage/compute';
import type { DayNumber } from './dates';
import type { MasterData } from './masterdata';

/** Odvolávky po dnech pro díly (velkými písmeny). */
export function callOffDemand(exp: CallOffExport | undefined): Map<string, Map<DayNumber, number>> {
  const result = new Map<string, Map<DayNumber, number>>();
  if (!exp) return result;
  exp.items.forEach((item, i) => {
    const byDay = new Map<DayNumber, number>();
    for (let k = exp.offsets[i]!; k < exp.offsets[i + 1]!; k++) byDay.set(exp.days[k]!, (byDay.get(exp.days[k]!) ?? 0) + exp.qty[k]!);
    result.set(item.toUpperCase(), byDay);
  });
  return result;
}

/** Stav u sekvencéru se skladem a transitem po dnech jeho souboru, po našich číslech hotových dílů (přes mapování). */
export interface SequencerPlan {
  /** Stav (sklad + transit − kumulovaná spotřeba) na konci dne; mezi dny souboru platí poslední známý stav. */
  balance: (day: DayNumber) => number;
  fileDays: DayNumber[];
  last: DayNumber;
  /** Destinace (složka souboru coverage), ve kterých díl je. */
  locations: string[];
  /** Popis dílu ze souboru coverage. */
  description: string;
}

export function sequencerPlans(sources: readonly CoverageSource[], master: MasterData | undefined): Map<string, SequencerPlan> {
  const rows = new Map<string, { days: readonly DayNumber[]; values: number[]; initial: number; location: string; description: string }[]>();
  for (const { report, location } of sources) {
    if (report.days.length === 0) continue;
    for (const row of report.rows) {
      const m = master?.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master?.items.get(row.supplierItem) : undefined);
      const item = (m?.item ?? row.supplierItem).toUpperCase();
      if (!item) continue;
      const values = row.balance.map((b, k) => b + row.transit[k]!);
      const list = rows.get(item) ?? [];
      list.push({ days: report.days, values, initial: row.customerStock + (row.transit[0] ?? 0), location, description: row.description });
      rows.set(item, list);
    }
  }
  const result = new Map<string, SequencerPlan>();
  for (const [item, list] of rows) {
    const valueOn = (r: (typeof list)[number], day: DayNumber) => {
      let value = r.initial;
      for (let k = 0; k < r.days.length && r.days[k]! <= day; k++) value = r.values[k]!;
      return value;
    };
    result.set(item, {
      balance: (day) => list.reduce((sum, r) => sum + valueOn(r, day), 0),
      fileDays: [...new Set(list.flatMap((r) => r.days))].sort((x, y) => x - y),
      last: Math.max(...list.map((r) => r.days.at(-1)!)),
      locations: [...new Set(list.map((r) => r.location))],
      description: list.find((r) => r.description)?.description ?? '',
    });
  }
  return result;
}

/**
 * Požadavek na nás po dnech horizontu. Ve dnech souboru sekvencéra je kumulovaný požadavek největší dosavadní
 * chybějící množství (záporný stav); když se stav později zlepší (dorazí transit), požadavek se nesnižuje.
 * Chybějící množství ze dnů před dneškem patří do dneška. Za koncem souboru se odvolávky kryjí nejdřív zbytkem
 * u sekvencéru (stav posledního dne + to, co jsme měli dodat), zbytek je požadavek na nás.
 */
export function customerNeed(qty: readonly number[], days: readonly DayNumber[], plan: SequencerPlan | undefined): { need: number[]; fixed: boolean[] } {
  if (!plan) return { need: [...qty], fixed: qty.map(() => false) };
  let required = 0;
  for (const d of plan.fileDays) if (d < days[0]!) required = Math.max(required, -plan.balance(d));
  let counted = 0;
  let leftover: number | null = null;
  const need: number[] = [];
  const fixed: boolean[] = [];
  days.forEach((d, k) => {
    if (d <= plan.last) {
      required = Math.max(required, -plan.balance(d));
      need.push(required - counted);
      counted = required;
      fixed.push(true);
    } else {
      leftover ??= Math.max(0, plan.balance(plan.last) + required);
      const fromSequencer = Math.min(leftover, qty[k]!);
      leftover -= fromSequencer;
      need.push(qty[k]! - fromSequencer);
      fixed.push(false);
    }
  });
  return { need, fixed };
}
