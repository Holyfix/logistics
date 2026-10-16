// Pokrytí na jednotlivé dny ze souborů zákazníka, spojené s mapováním dílů.

import type { DayNumber } from '../dates';
import { customerDisplay, type MasterData } from '../masterdata';
import type { CoverageReport } from './parse';

/** Načtený soubor pokrytí; destinace a projekt jsou z cesty ve sdílené složce. */
export interface CoverageSource {
  path: string;
  fileName: string;
  location: string;
  project: string;
  lastModified: number;
  report: CoverageReport;
}

export interface CoverageOptions {
  /** Přičíst transit, který zákazník uvádí v souboru. */
  transit: boolean;
  /** Přičíst náš sklad (stejné množství ke všem dnům). */
  ourStock?: boolean;
}

export interface CoverageLine {
  id: string;
  location: string;
  project: string;
  /** Naše číslo dílu z mapování; prázdné, když díl v mapování chybí. */
  item: string;
  /** Číslo zákazníka v jednotném zápisu „A1234567890 1234“ (z mapování, jinak ze souboru). */
  customerNumber: string;
  /** Číslo zákazníka tak, jak je v souboru (každý formát ho zapisuje jinak). */
  fileCustomerNumber: string;
  description: string;
  variant: string;
  side: string;
  /** Kategorie z mapování (sloupec Category). */
  category: string;
  customerStock: number;
  /** Transit celkem za horizont souboru. */
  transit: number;
  /** Náš sklad dílu; null, když sklad není načtený nebo díl není v mapování. */
  ourStock: number | null;
  firstUncovered: string;
  uncoveredAt: string;
  /** Pokrytí na konci dne; null, když soubor den neobsahuje (je mimo jeho horizont). */
  values: (number | null)[];
}

export interface CoverageTable {
  days: DayNumber[];
  lines: CoverageLine[];
}

export type RowFilter = { kind: 'all' } | { kind: 'negativeAny' } | { kind: 'negativeOn'; day: DayNumber };

export interface CoverageFilter {
  location: string;
  project: string;
  variant: string;
  category: string;
  query: string;
  rows: RowFilter;
}

export const EMPTY_COVERAGE_FILTER: CoverageFilter = { location: '', project: '', variant: '', category: '', query: '', rows: { kind: 'all' } };

/** Hodnota pro dny mezi dny souboru: platí poslední známý stav (např. víkend bez poptávky). */
function valueOn(days: readonly DayNumber[], values: readonly number[], day: DayNumber): number | null {
  let result: number | null = null;
  for (let k = 0; k < days.length && days[k]! <= day; k++) result = values[k]!;
  return result;
}

/**
 * Pokrytí po dílech a dnech. `stock` je náš sklad po dílech (viz stockByItem); s volbou `ourStock`
 * se přičte ke všem dnům v horizontu souboru.
 */
export function buildCoverage(
  sources: readonly CoverageSource[],
  master: MasterData | undefined,
  options: CoverageOptions,
  stock?: ReadonlyMap<string, number>,
): CoverageTable {
  const days = [...new Set(sources.flatMap((s) => s.report.days))].sort((a, b) => a - b);
  const lines: CoverageLine[] = [];
  for (const source of sources) {
    const { report } = source;
    for (const [index, row] of report.rows.entries()) {
      const m = master?.byCustomerKey.get(row.customerKey) ?? (row.supplierItem ? master?.items.get(row.supplierItem) : undefined);
      const ourStock = stock && m ? (stock.get(m.item.toUpperCase()) ?? 0) : null;
      const added = options.ourStock ? (ourStock ?? 0) : 0;
      const totals = row.balance.map((b, k) => b + (options.transit ? row.transit[k]! : 0) + added);
      lines.push({
        // Pořadí řádku zaručí jednoznačný klíč i pro řádky bez čísla zákazníka.
        id: `${source.path}|${index}|${row.customerKey}`,
        location: source.location,
        // Vlastnosti dílu jen z mapování (bez zálohy ze složky); co chybí, hlásí Kontrola mapování.
        project: m?.project ?? '',
        item: m?.item ?? '',
        customerNumber: customerDisplay(m?.customerNumber || row.customerNumber),
        fileCustomerNumber: row.customerNumber,
        description: m?.description || row.description,
        variant: m?.variant ?? '',
        side: m?.side ?? '',
        category: m?.category ?? '',
        customerStock: row.customerStock,
        transit: row.transit.at(-1) ?? 0,
        ourStock,
        firstUncovered: row.firstUncovered,
        uncoveredAt: row.uncoveredAt,
        values: days.map((day) => (day > report.days.at(-1)! ? null : valueOn(report.days, totals, day))),
      });
    }
  }
  // Díly bez projektu (není v mapování nebo nemá vyplněný projekt) na konec destinace.
  lines.sort((a, b) => a.location.localeCompare(b.location) || Number(!a.project) - Number(!b.project) || a.project.localeCompare(b.project) || (a.item || a.customerNumber).localeCompare(b.item || b.customerNumber, 'en', { numeric: true }));
  return { days, lines };
}

function isNegative(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && value < 0;
}

export function filterCoverage(table: CoverageTable, filter: CoverageFilter): CoverageLine[] {
  const query = filter.query.trim().toLowerCase();
  const dayIndex = filter.rows.kind === 'negativeOn' ? table.days.indexOf(filter.rows.day) : -1;
  return table.lines.filter((line) => {
    if (filter.location && line.location !== filter.location) return false;
    if (filter.project && line.project !== filter.project) return false;
    if (filter.variant && line.variant !== filter.variant) return false;
    if (filter.category && line.category !== filter.category) return false;
    if (query && !`${line.item} ${line.customerNumber} ${line.customerNumber.replace(/\s+/g, '')} ${line.fileCustomerNumber} ${line.description}`.toLowerCase().includes(query)) return false;
    if (filter.rows.kind === 'negativeAny') return line.values.some(isNegative);
    if (filter.rows.kind === 'negativeOn') return isNegative(line.values[dayIndex]);
    return true;
  });
}

/** Hodnoty pro výběr ve filtrech. */
export function coverageOptions(table: CoverageTable) {
  const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  return {
    locations: sorted(table.lines.map((l) => l.location)),
    projects: sorted(table.lines.map((l) => l.project)),
    variants: sorted(table.lines.map((l) => l.variant)),
    categories: sorted(table.lines.map((l) => l.category)),
    unmapped: table.lines.filter((l) => !l.item).length,
  };
}

export interface VariantSummary {
  variant: string;
  values: number[];
}

/** Součet pokrytí po variantách (dny mimo horizont souboru se nepočítají). */
export function summarizeByVariant(days: readonly DayNumber[], lines: readonly CoverageLine[]): VariantSummary[] {
  const groups = new Map<string, number[]>();
  for (const line of lines) {
    const values = groups.get(line.variant) ?? days.map(() => 0);
    line.values.forEach((v, k) => {
      values[k]! += v ?? 0;
    });
    groups.set(line.variant, values);
  }
  // Díly bez varianty (bez mapování) jsou na konci.
  return [...groups.entries()]
    .map(([variant, values]) => ({ variant, values }))
    .sort((a, b) => Number(!a.variant) - Number(!b.variant) || a.variant.localeCompare(b.variant, 'cs'));
}

/** Za kolik prvních dnů se počítají chybějící kusy (modul Coverage i rozcestník). */
export const SHORTAGE_DAYS = 2;

/**
 * Chybějící kusy v prvních `days` dnech: u každého dílu nejhorší záporný stav v těch dnech
 * (stav je kumulativní, takže je to celé chybějící množství), sečteno přes díly.
 */
export function shortage(lines: readonly CoverageLine[], days: number): { pieces: number; parts: number } {
  let pieces = 0;
  let parts = 0;
  for (const line of lines) {
    const worst = Math.min(0, ...line.values.slice(0, days).filter((v): v is number => v !== null));
    if (worst < 0) {
      pieces -= worst;
      parts++;
    }
  }
  return { pieces, parts };
}
