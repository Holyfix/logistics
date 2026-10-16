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

export interface CustomerAlert {
  id: string;
  item: string;
  customerNumber: string;
  description: string;
  project: string;
  location: string;
  /** První den, kdy u zákazníka chybí (s transitem; u „čeká na transit“ bez transitu). */
  day: DayNumber;
  /** Kolik kusů ten den chybí. */
  missing: number;
  /** Chybí jen bez transitu: s transitem je zákazník v nejbližších dnech pokrytý. */
  transitOnly: boolean;
  severity: Severity;
}

function firstShort(values: readonly (number | null)[], from: number): number | null {
  for (let k = from; k < values.length; k++) if ((values[k] ?? 0) < -1e-9) return k;
  return null;
}

/**
 * Díly, kterým u zákazníka chybí kusy (od dneška): crit = i s transitem dnes nebo zítra, warn = dnes nebo zítra jen
 * bez transitu (čeká na transit), info = s transitem později v horizontu souboru. `withTransit` a `withoutTransit` jsou
 * stejná data (stejné pořadí řádků) s transitem a bez něj.
 */
export function customerAlerts(withTransit: CoverageTable, withoutTransit: CoverageTable, today: DayNumber): CustomerAlert[] {
  const days = withTransit.days;
  const from = days.findIndex((d) => d >= today);
  if (from === -1) return [];
  const soon = (k: number) => days[k]! < today + SHORTAGE_DAYS;
  const alerts: CustomerAlert[] = [];
  withTransit.lines.forEach((line, i) => {
    const plain = withoutTransit.lines[i]!;
    const k = firstShort(line.values, from);
    const kPlain = firstShort(plain.values, from);
    const base = { id: line.id, item: line.item, customerNumber: line.customerNumber, description: line.description, project: line.project, location: line.location };
    if (k !== null && soon(k)) alerts.push({ ...base, day: days[k]!, missing: -line.values[k]!, transitOnly: false, severity: 'crit' });
    else if (kPlain !== null && soon(kPlain)) alerts.push({ ...base, day: days[kPlain]!, missing: -plain.values[kPlain]!, transitOnly: true, severity: 'warn' });
    else if (k !== null) alerts.push({ ...base, day: days[k]!, missing: -line.values[k]!, transitOnly: false, severity: 'info' });
  });
  return alerts.sort((a, b) => bySeverity(a, b) || a.day - b.day || b.missing - a.missing);
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
  /** Nedodáno po termínu podle aktuálního exportu. */
  backlog: number;
  severity: Severity;
}

export interface CallOffDigest {
  week: number;
  year: number;
  previous: { week: number; year: number } | null;
  /** Díly s významnou změnou nebo nedodaným množstvím, od největší změny. */
  alerts: CallOffAlert[];
  changes: number;
  backlogPieces: number;
  backlogParts: number;
}

/**
 * Změny odvolávek proti předchozímu exportu (příštích 12 týdnů, jako modul Odvolávky) a nedodáno po termínu.
 * warn = nedodáno po termínu nebo změna o 50 % a víc, info = ostatní významné změny.
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
    if (changedWeeks === 0 && row.backlog <= 0) continue;
    const big = percent === null ? diff !== 0 : Math.abs(percent) >= 50;
    alerts.push({ item: row.item, description: row.description, diff, percent, changedWeeks, backlog: row.backlog, severity: row.backlog > 0 || (changedWeeks > 0 && big) ? 'warn' : 'info' });
  }
  alerts.sort((a, b) => bySeverity(a, b) || b.backlog - a.backlog || Math.abs(b.diff) - Math.abs(a.diff));
  const withBacklog = rows.filter((r) => r.backlog > 0);
  return {
    week: current.week,
    year: current.year,
    previous: previous ? { week: previous.week, year: previous.year } : null,
    alerts,
    changes,
    backlogPieces: withBacklog.reduce((s, r) => s + r.backlog, 0),
    backlogParts: withBacklog.length,
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

/** Do kolika dní od dneška se nepokrytý projekt hlásí jako „pozor“ (dál jen pro informaci). */
export const PROJECT_WARN_DAYS = 7;

export interface ProjectCoverage {
  project: string;
  /** Počet dílů projektu v souborech coverage. */
  parts: number;
  /** Poslední pokrytý den (s transitem); null = nepokryto už dnes. */
  coveredUntil: DayNumber | null;
  /** První nepokrytý den (s transitem); null = pokryto po celý horizont souboru. */
  firstShort: DayNumber | null;
  /** Kolik kusů první nepokrytý den chybí (součet za díly projektu). */
  missing: number;
  /** Kolik dílů první nepokrytý den chybí. */
  shortParts: number;
  /** První nepokrytý den bez transitu; null = bez transitu pokryto po celý horizont. */
  firstShortPlain: DayNumber | null;
  /** Poslední den, který soubory projektu obsahují. */
  horizon: DayNumber | null;
  /** crit = nepokryto dnes nebo zítra, warn = do 7 dní, info = později, null = pokryto po celý horizont. */
  severity: Severity | null;
}

/**
 * Pokrytí po projektech od dneška: do kdy je projekt pokrytý (s transitem), první nepokrytý den a kolik kusů ten den
 * chybí (součet záporných zůstatků dílů projektu). `withTransit` a `withoutTransit` jsou stejná data s transitem a bez.
 */
export function projectCoverage(withTransit: CoverageTable, withoutTransit: CoverageTable, today: DayNumber): ProjectCoverage[] {
  const days = withTransit.days;
  const from = days.findIndex((d) => d >= today);
  if (from === -1) return [];
  const groups = new Map<string, number[]>();
  withTransit.lines.forEach((line, i) => groups.set(line.project, [...(groups.get(line.project) ?? []), i]));
  const firstOf = (table: CoverageTable, rows: number[]) => {
    const ks = rows.map((i) => firstShort(table.lines[i]!.values, from)).filter((k): k is number => k !== null);
    return ks.length ? Math.min(...ks) : null;
  };
  return [...groups.entries()]
    .map(([project, rows]): ProjectCoverage => {
      const k = firstOf(withTransit, rows);
      const kPlain = firstOf(withoutTransit, rows);
      let last = -1;
      for (const i of rows) withTransit.lines[i]!.values.forEach((v, d) => v !== null && d > last && (last = d));
      const short = k === null ? [] : rows.map((i) => withTransit.lines[i]!.values[k] ?? 0).filter((v) => v < -1e-9);
      const day = k === null ? null : days[k]!;
      const severity: Severity | null = day === null ? null : day < today + SHORTAGE_DAYS ? 'crit' : day < today + PROJECT_WARN_DAYS ? 'warn' : 'info';
      return {
        project,
        parts: rows.length,
        coveredUntil: k === null ? (last >= from ? days[last]! : null) : k > from ? days[k - 1]! : null,
        firstShort: day,
        missing: short.reduce((a, b) => a - b, 0),
        shortParts: short.length,
        firstShortPlain: kPlain === null ? null : days[kPlain]!,
        horizon: last >= 0 ? days[last]! : null,
        severity,
      };
    })
    .sort((a, b) => (a.firstShort ?? Infinity) - (b.firstShort ?? Infinity) || b.missing - a.missing || a.project.localeCompare(b.project, 'cs'));
}
