// Dashboard: co je dnes potřeba řešit, z dat ostatních modulů (Coverage, Komponenty, Odvolávky, OIL) a čerstvost dat.

import type { CallOffExport } from './calloffs/parse';
import { buildCurrentRows, buildPeriods, changeOf, DEFAULT_WEEKS } from './calloffs/views';
import { COMPONENT_SOON_DAYS, type ComponentTable } from './components/compute';
import { SHORTAGE_DAYS, type CoverageTable } from './coverage/compute';
import type { DayNumber } from './dates';
import { statusOf, type OilItem, type OilList, type OilStatus } from './oil';

/** crit = hoří (dnes nebo zítra), warn = pozor, info = pro informaci. */
export type Severity = 'crit' | 'warn' | 'info';

const RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };
export const bySeverity = (a: { severity: Severity }, b: { severity: Severity }) => RANK[a.severity] - RANK[b.severity];

/** Do kolika dní od dneška se chybějící komponenta hlásí jako „pozor“ (dál jen pro informaci). */
export const COMPONENT_WARN_DAYS = 7;

function firstShort(values: readonly (number | null)[], from: number): number | null {
  for (let k = from; k < values.length; k++) if ((values[k] ?? 0) < -1e-9) return k;
  return null;
}

export interface ComponentAlert {
  item: string;
  description: string;
  /** První den, kdy komponenta podle odvolávek chybí. */
  day: DayNumber;
  /** Kolik kusů ten den chybí. */
  missing: number;
  /** Zákazník pokryt do (první den, kdy u zákazníka chybí některý hotový díl s komponentou); null = neznámo / pokryt. */
  customerShortDay: DayNumber | null;
  products: string[];
  severity: Severity;
}

/** Komponenty, které podle odvolávek dojdou: crit do 2 dnů, warn do týdne, info později v horizontu. */
export function componentAlerts(table: ComponentTable): ComponentAlert[] {
  return table.components
    .flatMap((c): ComponentAlert[] => {
      if (c.shortDay === null) return [];
      const severity: Severity = c.shortDay < COMPONENT_SOON_DAYS ? 'crit' : c.shortDay < COMPONENT_WARN_DAYS ? 'warn' : 'info';
      return [
        {
          item: c.item,
          description: c.description,
          day: table.days[c.shortDay]!,
          missing: -c.balance[c.shortDay]!,
          customerShortDay: c.customerShortDay === null ? null : table.days[c.customerShortDay]!,
          products: c.products,
          severity,
        },
      ];
    })
    .sort((a, b) => bySeverity(a, b) || a.day - b.day || b.missing - a.missing);
}

export interface CallOffAlert {
  item: string;
  description: string;
  /** Změna součtu za týdny, které jsou v obou exportech (kusy). */
  diff: number;
  /** Změna v procentech; null, když dřív nic nebylo. */
  percent: number | null;
  /** Počet týdnů s významnou změnou (od 20 %). */
  changedWeeks: number;
  severity: Severity;
}

export interface CallOffDigest {
  week: number;
  year: number;
  previous: { week: number; year: number } | null;
  /** Díly s významnou změnou, od největší změny. */
  alerts: CallOffAlert[];
  changes: number;
}

/**
 * Změny odvolávek proti předchozímu exportu (příštích 12 týdnů, jako modul Odvolávky).
 * warn = změna o 50 % a víc, info = ostatní významné změny.
 */
export function callOffDigest(current: CallOffExport, previous: CallOffExport | undefined): CallOffDigest {
  const periods = buildPeriods(current, 'week', DEFAULT_WEEKS);
  const rows = buildCurrentRows(current, previous, current.items, periods);
  let changes = 0;
  const alerts: CallOffAlert[] = [];
  for (const row of rows) {
    let now = 0;
    let before = 0;
    let changedWeeks = 0;
    row.values.forEach((v, k) => {
      const p = row.previous[k];
      if (p === null || p === undefined) return;
      now += v;
      before += p;
      if (changeOf(v, p)?.significant) changedWeeks++;
    });
    changes += changedWeeks;
    const diff = now - before;
    const percent = before === 0 ? null : (diff / before) * 100;
    if (changedWeeks === 0) continue;
    const big = percent === null ? diff !== 0 : Math.abs(percent) >= 50;
    alerts.push({ item: row.item, description: row.description, diff, percent, changedWeeks, severity: big ? 'warn' : 'info' });
  }
  alerts.sort((a, b) => bySeverity(a, b) || Math.abs(b.diff) - Math.abs(a.diff));
  return {
    week: current.week,
    year: current.year,
    previous: previous ? { week: previous.week, year: previous.year } : null,
    alerts,
    changes,
  };
}

export type SourceKind = 'calloffs' | 'coverage' | 'stock' | 'bom' | 'master';

export interface Freshness {
  kind: SourceKind;
  /** Název souboru (u coverage destinace a projekt). */
  label: string;
  /** Čas změny souboru (ms od 1. 1. 1970); null, když není známý. */
  modified: number | null;
  /** Týden exportu odvolávek. */
  week?: { week: number; year: number };
  /** Soubor chybí nebo je starý. */
  stale: boolean;
  missing: boolean;
}

/** Kolik hodin smí být starý sklad a coverage od zákazníka, než se hlásí jako starý. */
export const FRESH_HOURS = 24;

export interface FreshnessInputs {
  callOffs: CallOffExport | undefined;
  coverage: readonly { location: string; project: string; fileName: string; lastModified: number }[];
  stock: { path: string; lastModified: number } | null;
  boms: readonly { path: string; lastModified: number }[];
  master: { path: string } | null;
  today: DayNumber;
  now: number;
}

const fileName = (path: string) => path.split('/').pop() ?? path;

/**
 * Čerstvost načtených dat: odvolávky z minulého týdne nebo starší, sklad a soubory coverage starší než 24 hodin
 * se hlásí jako staré. Kusovník a mapování jen informativně.
 */
export function dataFreshness({ callOffs, coverage, stock, boms, master, today, now }: FreshnessInputs): Freshness[] {
  const old = (modified: number) => now - modified > FRESH_HOURS * 3_600_000;
  const list: Freshness[] = [
    callOffs
      ? { kind: 'calloffs', label: callOffs.fileName, modified: null, week: { week: callOffs.week, year: callOffs.year }, stale: today - callOffs.exportDay >= 7, missing: false }
      : { kind: 'calloffs', label: '', modified: null, stale: true, missing: true },
    stock
      ? { kind: 'stock', label: fileName(stock.path), modified: stock.lastModified, stale: old(stock.lastModified), missing: false }
      : { kind: 'stock', label: '', modified: null, stale: true, missing: true },
  ];
  if (coverage.length === 0) list.push({ kind: 'coverage', label: '', modified: null, stale: true, missing: true });
  for (const c of coverage) list.push({ kind: 'coverage', label: [c.location, c.project].filter(Boolean).join(' / ') || c.fileName, modified: c.lastModified, stale: old(c.lastModified), missing: false });
  const bom = boms[0];
  list.push(bom ? { kind: 'bom', label: fileName(bom.path), modified: bom.lastModified, stale: false, missing: false } : { kind: 'bom', label: '', modified: null, stale: false, missing: true });
  list.push(master ? { kind: 'master', label: fileName(master.path), modified: null, stale: false, missing: false } : { kind: 'master', label: '', modified: null, stale: true, missing: true });
  return list;
}

/** Do kolika dní od dneška se termín bodu OIL hlásí jako „pozor“. */
export const OIL_SOON_DAYS = 7;

export interface OilAlert {
  item: OilItem;
  status: OilStatus;
  severity: Severity;
}

/**
 * Otevřené body OIL podle nejbližšího termínu: hoří = po termínu, pozor = termín do 7 dní (včetně dneška),
 * pro informaci = později nebo bez termínu. Hotové a zrušené body se nehlásí.
 */
export function oilAlerts(list: OilList, today: DayNumber): OilAlert[] {
  return list.items
    .flatMap((item): OilAlert[] => {
      const status = statusOf(item, today);
      if (status === 'done' || status === 'cancelled') return [];
      const severity: Severity = status === 'overdue' ? 'crit' : item.due !== null && item.due < today + OIL_SOON_DAYS ? 'warn' : 'info';
      return [{ item, status, severity }];
    })
    .sort((a, b) => bySeverity(a, b) || (a.item.due ?? Infinity) - (b.item.due ?? Infinity) || a.item.id - b.item.id);
}

/** Pokrytí projektu: poslední pokrytý den a kolik dní od dneška to je. */
export interface CoverageSpan {
  /** Poslední den, kdy mají všechny díly projektu zůstatek 0 a víc; null = nepokryto už dnes. */
  until: DayNumber | null;
  /** Počet pokrytých dní od dneška (dnes včetně); 0 = nepokryto už dnes. */
  days: number;
  /** Pokryto po celý horizont souboru (skutečné pokrytí může být delší). */
  whole: boolean;
}

export interface ProjectCoverage {
  project: string;
  withTransit: CoverageSpan;
  withoutTransit: CoverageSpan;
  /**
   * crit = s transitem pokryto méně než 2 dny (chybí dnes nebo zítra), warn = méně než 2 dny jen bez transitu
   * (čeká na transit), null = v pořádku.
   */
  severity: 'crit' | 'warn' | null;
}

/**
 * Pokrytí po projektech od dneška: do kdy mají všechny díly projektu zůstatek 0 a víc a kolik dní to je, s transitem
 * i bez. `withTransit` a `withoutTransit` jsou stejná data (stejné pořadí řádků) s transitem a bez.
 */
export function projectCoverage(withTransit: CoverageTable, withoutTransit: CoverageTable, today: DayNumber): ProjectCoverage[] {
  const days = withTransit.days;
  const from = days.findIndex((d) => d >= today);
  if (from === -1) return [];
  const groups = new Map<string, number[]>();
  withTransit.lines.forEach((line, i) => groups.set(line.project, [...(groups.get(line.project) ?? []), i]));

  const span = (table: CoverageTable, rows: number[]): CoverageSpan => {
    const ks = rows.map((i) => firstShort(table.lines[i]!.values, from)).filter((k): k is number => k !== null);
    if (ks.length) {
      const k = Math.min(...ks);
      return { until: k > from ? days[k - 1]! : null, days: days[k]! - today, whole: false };
    }
    let last = -1;
    for (const i of rows) table.lines[i]!.values.forEach((v, d) => v !== null && d > last && (last = d));
    return last >= from ? { until: days[last]!, days: days[last]! - today + 1, whole: true } : { until: null, days: 0, whole: true };
  };

  return [...groups.entries()]
    .map(([project, rows]): ProjectCoverage => {
      const withT = span(withTransit, rows);
      const plain = span(withoutTransit, rows);
      const short = (c: CoverageSpan) => !c.whole && c.days < SHORTAGE_DAYS;
      const severity = short(withT) ? 'crit' : short(plain) ? 'warn' : null;
      return { project, withTransit: withT, withoutTransit: plain, severity };
    })
    .sort(
      (a, b) =>
        Number(a.withoutTransit.whole) - Number(b.withoutTransit.whole) ||
        a.withoutTransit.days - b.withoutTransit.days ||
        a.withTransit.days - b.withTransit.days ||
        a.project.localeCompare(b.project, 'cs'),
    );
}
