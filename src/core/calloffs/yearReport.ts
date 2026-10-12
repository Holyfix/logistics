// Sešit „Odvolávky od začátku roku“ pro reporting: souhrn po týdnech a tabulky po dílech.

import type { MasterItem } from '../masterdata';
import { filterItems, type ItemFilter } from './filter';
import type { CallOffExport } from './parse';
import { buildYearRows, buildYearWeeks, fulfillment, yearItems, yearTotals, type YearRow } from './year';

export type ReportCell = string | number | null;

export interface ReportSheet {
  name: string;
  header: string[];
  rows: ReportCell[][];
  /** Kolik prvních sloupců zůstane při posunu vidět. */
  stickyColumns: number;
}

export interface YearReportLabels {
  sheets: { summary: string; demand: string; shipped: string; difference: string };
  week: string;
  source: string;
  demand: string;
  shipped: string;
  difference: string;
  fulfillment: string;
  outlook: string;
  total: string;
  item: string;
  description: string;
  customer: string;
  project: string;
  side: string;
  notes: readonly string[];
}

export interface YearReport {
  year: number;
  /** Poslední export roku, ze kterého je výhled. */
  latest: CallOffExport;
  sheets: ReportSheet[];
}

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/**
 * Přehled od prvního exportu v roce nejnovějšího exportu: požadavek každého týdne z jeho exportu,
 * odesláno z kumulativů a výhled z posledního exportu do konce roku. Díly se filtrují stejně jako na stránce.
 */
export function buildYearReport(
  exports: readonly CallOffExport[],
  master: ReadonlyMap<string, MasterItem> | undefined,
  filter: ItemFilter,
  labels: YearReportLabels,
): YearReport | null {
  const latest = exports.at(-1);
  if (!latest) return null;
  const year = latest.year;
  const weeks = buildYearWeeks(exports, year, 'year');
  const union = yearItems(weeks);
  const descriptions = new Map(union.items.map((item, i) => [item, union.descriptions[i]!]));
  const items = filterItems(union.items, union.descriptions, master, filter);
  const rows = buildYearRows(
    weeks,
    items,
    items.map((item) => descriptions.get(item)!),
  ).filter((r) => r.demand.some((v) => v !== 0) || r.shipped.some((v) => v));
  const totals = yearTotals(weeks, rows);

  const weekHeader = weeks.map((w) => (w.outlook ? `${w.label} (${labels.outlook})` : w.label));
  const known = (k: number) => totals.shipped[k] !== null;
  const knownDemand = sum(totals.demand.map((d, k) => (known(k) ? d : 0)));
  const totalShipped = sum(totals.shipped);
  const anyShipped = totals.shipped.some((v) => v !== null);
  const difference = totals.shipped.map((s, k) => (s === null ? null : s - totals.demand[k]!));

  const summary: ReportSheet = {
    name: labels.sheets.summary,
    header: [labels.week, ...weekHeader, labels.total],
    rows: [
      [labels.source, ...weeks.map((w) => (w.source ? `CW ${w.source.week}/${w.source.year}` : null)), null],
      [labels.demand, ...totals.demand, sum(totals.demand)],
      [labels.shipped, ...totals.shipped, anyShipped ? totalShipped : null],
      [labels.difference, ...difference, anyShipped ? totalShipped - knownDemand : null],
      [
        `${labels.fulfillment} %`,
        ...totals.shipped.map((s, k) => round1(fulfillment([totals.demand[k]!], [s]))),
        round1(fulfillment(totals.demand, totals.shipped)),
      ],
      [],
      ...labels.notes.map((note) => [note]),
    ],
    stickyColumns: 1,
  };

  const itemSheet = (name: string, value: (r: YearRow, k: number) => number | null): ReportSheet => ({
    name,
    header: [labels.item, labels.description, labels.customer, labels.project, labels.side, ...weekHeader, labels.total],
    rows: rows.map((r) => {
      const m = master?.get(r.item);
      const values = weeks.map((_, k) => value(r, k));
      return [
        r.item,
        r.description,
        m?.customer ?? '',
        m?.project ?? '',
        m?.side ?? '',
        ...values,
        values.every((v) => v === null) ? null : sum(values),
      ];
    }),
    stickyColumns: 1,
  });

  return {
    year,
    latest,
    sheets: [
      summary,
      itemSheet(labels.sheets.demand, (r, k) => r.demand[k]!),
      itemSheet(labels.sheets.shipped, (r, k) => r.shipped[k]!),
      itemSheet(labels.sheets.difference, (r, k) => {
        const s = r.shipped[k]!;
        return s === null ? null : s - r.demand[k]!;
      }),
    ],
  };
}
