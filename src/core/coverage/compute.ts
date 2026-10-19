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
  /** Doplněný transit ze složky Transit (už přičtený v report.rows[].transit), po pořadí řádku. */
  extraTransit?: ReadonlyMap<number, number>;
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
  /** Popis z mapování; u dílu, který v mapování není, ze souboru (jen aby šel poznat). */
  description: string;
  variant: string;
  side: string;
  /** Kategorie z mapování (sloupec Category). */
  category: string;
  customerStock: number;
  /** Transit celkem za horizont souboru (včetně doplněného). */
  transit: number;
  /** Z toho doplněný transit ze složky Transit (naše expedice, které soubor zákazníka ještě nemá). */
  extraTransit: number;
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

/** Filtry podle dílu (ovlivňují se navzájem v libovolném pořadí): Destinace, Projekt, Kategorie, Strana, Varianta. */
export const COVERAGE_FIELDS = ['location', 'project', 'category', 'side', 'variant'] as const;
export type CoverageField = (typeof COVERAGE_FIELDS)[number];

export type CoverageFilter = Record<CoverageField, string> & { query: string; rows: RowFilter };

export const EMPTY_COVERAGE_FILTER: CoverageFilter = { location: '', project: '', category: '', side: '', variant: '', query: '', rows: { kind: 'all' } };

/** Řádek odpovídá filtrům podle dílu; `except` = bez filtru tohoto údaje (pro jeho nabídku). */
function matches(line: CoverageLine, filter: Omit<CoverageFilter, 'rows'>, except?: CoverageField): boolean {
  return COVERAGE_FIELDS.every((field) => field === except || !filter[field] || line[field] === filter[field]);
}

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
        description: m ? m.description : row.description,
        variant: m?.variant ?? '',
        side: m?.side ?? '',
        category: m?.category ?? '',
        customerStock: row.customerStock,
        transit: row.transit.at(-1) ?? 0,
        extraTransit: source.extraTransit?.get(index) ?? 0,
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
    if (!matches(line, filter)) return false;
    if (query && !`${line.item} ${line.customerNumber} ${line.customerNumber.replace(/\s+/g, '')} ${line.fileCustomerNumber} ${line.description}`.toLowerCase().includes(query)) return false;
    if (filter.rows.kind === 'negativeAny') return line.values.some(isNegative);
    if (filter.rows.kind === 'negativeOn') return isNegative(line.values[dayIndex]);
    return true;
  });
}

/**
 * Hodnoty pro výběr ve filtrech: jen ty, které odpovídají ostatním vybraným filtrům (projekty destinace, kategorie
 * projektu, projekty kategorie …). Prázdný seznam = díly ve výběru údaj nemají (filtr se nezobrazí).
 */
export function coverageOptions(table: CoverageTable, filter: Omit<CoverageFilter, 'rows'> = EMPTY_COVERAGE_FILTER) {
  const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
  const of = (field: CoverageField) => sorted(table.lines.filter((l) => matches(l, filter, field)).map((l) => l[field]));
  return {
    locations: of('location'),
    projects: of('project'),
    categories: of('category'),
    sides: of('side'),
    variants: of('variant'),
    unmapped: table.lines.filter((l) => !l.item).length,
  };
}

export interface SideSummary {
  side: string;
  values: number[];
}

/** Součet pokrytí po stranách LHD / RHD (dny mimo horizont souboru se nepočítají). */
export function summarizeBySide(days: readonly DayNumber[], lines: readonly CoverageLine[]): SideSummary[] {
  const groups = new Map<string, number[]>();
  for (const line of lines) {
    const values = groups.get(line.side) ?? days.map(() => 0);
    line.values.forEach((v, k) => {
      values[k]! += v ?? 0;
    });
    groups.set(line.side, values);
  }
  // Díly bez strany (kategorie bez stran nebo bez mapování) jsou na konci.
  return [...groups.entries()]
    .map(([side, values]) => ({ side, values }))
    .sort((a, b) => Number(!a.side) - Number(!b.side) || a.side.localeCompare(b.side, 'cs'));
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
