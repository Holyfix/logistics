// Čtení souborů pokrytí od zákazníka. Každý zákazník posílá jiný formát; všechny se převedou
// na stejnou podobu: zůstatek bez transitu na konci každého dne a transit k dispozici k danému dni.

import { findColumn, normalizeHeader } from '../csv';
import { cellDay, cellNumber, cellText, MAX_ISSUES, type Cell, type DataIssue } from '../table';
import { dayFromParts, type DayNumber } from '../dates';
import { customerKey } from '../masterdata';

export type CoverageFormat = 'overview' | 'articles' | 'bestand';

export interface CoverageRow {
  /** Číslo dílu zákazníka, jak je v souboru. */
  customerNumber: string;
  customerKey: string;
  /** Číslo dílu dodavatele, pokud ho soubor obsahuje. */
  supplierItem: string;
  description: string;
  /** Sklad u zákazníka na začátku (bez otevřených objednávek). */
  customerStock: number;
  /** Zůstatek bez transitu na konci každého dne (indexy jako CoverageReport.days). */
  balance: number[];
  /** Transit, který je u zákazníka k dispozici k danému dni (součet od prvního dne). */
  transit: number[];
  /** Číslo výroby, pro kterou díl poprvé chybí. */
  firstUncovered: string;
  /** Kdy díl poprvé chybí, „YYYY-MM-DDTHH:mm“, nebo prázdné. */
  uncoveredAt: string;
}

export interface CoverageReport {
  format: CoverageFormat;
  sheet: string;
  days: DayNumber[];
  rows: CoverageRow[];
  issueCount: number;
  issues: DataIssue[];
}

export interface Sheet {
  name: string;
  data: Cell[][];
}

export type CoverageResult = { ok: true; value: CoverageReport } | { ok: false; error: 'unknownFormat' };

/** Datum v záhlaví nebo buňce: Excel datum, „2026.10.13“, „13.10.2026“ nebo „2026-10-13“. */
function dayOf(cell: Cell | undefined): DayNumber | null {
  const m = typeof cell === 'string' ? /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(cell.trim()) : null;
  if (m) return dayFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  return cellDay(cell);
}

function dateTimeText(cell: Cell | undefined): string {
  // Text „2026.10.20 18:12“ (jak ho posílá zákazník) → „2026-10-20T18:12“.
  const m = typeof cell === 'string' ? /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})/.exec(cell.trim()) : null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]!.padStart(2, '0')}:${m[5]}`;
  // Excel ukládá čas jako zlomek dne, proto se zaokrouhlí na celé minuty (08:55:59,99 → 08:56).
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return new Date(Math.round(cell.getTime() / 60_000) * 60_000).toISOString().slice(0, 16);
  return cellText(cell);
}

/**
 * Formát „Coverage Report Overview“: dva řádky záhlaví. Ve druhém jsou pevné sloupce a pro každý den
 * blok „Disposable Stock / Demand / In Transit / Stock End of the Day“, v prvním je nad blokem datum.
 * Konečný stav dne bývá vzorec s přepínačem transitu, proto se zůstatek počítá ze skladu a poptávky.
 */
function parseOverview(sheet: Sheet): CoverageReport | null {
  const headerIndex = sheet.data.slice(0, 6).findIndex((row) => {
    const names = row.map((c) => normalizeHeader(cellText(c)));
    return names.includes('disposable stock') && names.includes('stock end of the day');
  });
  if (headerIndex < 1) return null;
  const header = sheet.data[headerIndex]!.map((c) => cellText(c));
  const dateRow = sheet.data[headerIndex - 1]!;
  const names = header.map(normalizeHeader);

  const blocks: { day: DayNumber; disposable: number; demand: number; transit: number }[] = [];
  names.forEach((name, c) => {
    if (name !== 'disposable stock') return;
    const day = cellDay(dateRow[c]);
    if (day === null) return;
    const demand = names.indexOf('demand', c);
    const transit = names.indexOf('in transit', c);
    blocks.push({ day, disposable: c, demand: demand === c + 1 ? demand : -1, transit: transit === c + 2 ? transit : -1 });
  });
  if (blocks.length === 0) return null;

  const col = {
    customer: findColumn(header, ['Customer Item Number', 'Customer Number']),
    item: findColumn(header, ['Item number', 'Supplier Item Number']),
    description: findColumn(header, ['Item description', 'Description']),
    uncoveredAt: findColumn(header, ['First uncovered IB-Plan', 'First uncovered']),
    uncoveredNo: findColumn(header, ['First uncovered Prod No']),
    openOrders: findColumn(header, ['Open Orders']),
    // „Stock in <místo> 07:00“: sklad u zákazníka k ranní hodině.
    stock: names.findIndex((n) => /^stock in .+ \d{1,2} \d{2}$/.test(n)),
  };
  if (col.customer === -1) return null;

  const issues: DataIssue[] = [];
  let issueCount = 0;
  const rows: CoverageRow[] = [];
  sheet.data.slice(headerIndex + 1).forEach((row, i) => {
    const customerNumber = cellText(row[col.customer]);
    if (!customerNumber) return;
    // Bez sloupce se skladem platí „Disposable Stock“ prvního dne (sklad už bez otevřených objednávek).
    const stockCell = col.stock === -1 ? row[blocks[0]!.disposable] : row[col.stock];
    const stock = cellNumber(stockCell);
    if (stock === null) {
      issueCount++;
      if (issues.length < MAX_ISSUES) issues.push({ row: headerIndex + i + 2, column: header[col.stock] ?? '', value: cellText(stockCell), message: 'invalidNumber' });
    }
    const customerStock = (stock ?? 0) - (col.stock === -1 ? 0 : (cellNumber(row[col.openOrders]) ?? 0));
    let demand = 0;
    let transit = 0;
    const balance: number[] = [];
    const transitByDay: number[] = [];
    for (const block of blocks) {
      demand += block.demand === -1 ? 0 : (cellNumber(row[block.demand]) ?? 0);
      transit += block.transit === -1 ? 0 : (cellNumber(row[block.transit]) ?? 0);
      balance.push(customerStock - demand);
      transitByDay.push(transit);
    }
    rows.push({
      customerNumber,
      customerKey: customerKey(customerNumber),
      supplierItem: col.item === -1 ? '' : cellText(row[col.item]),
      description: col.description === -1 ? '' : cellText(row[col.description]),
      customerStock,
      balance,
      transit: transitByDay,
      firstUncovered: col.uncoveredNo === -1 ? '' : cellText(row[col.uncoveredNo]),
      uncoveredAt: col.uncoveredAt === -1 ? '' : dateTimeText(row[col.uncoveredAt]),
    });
  });

  return { format: 'overview', sheet: sheet.name, days: blocks.map((b) => b.day), rows, issueCount, issues };
}

/**
 * Formát „articles“: jedno záhlaví, pevné sloupce a za nimi dny (datum jako text „2026.10.13“).
 * Hodnota dne je konečný stav včetně transitu („Stock in transit“ a „Further stock in transit“),
 * proto se transit odečte. Pod daty bývá pomocný blok s kumulovanou poptávkou bez čísla dílu;
 * řádky bez čísla dílu zákazníka se přeskočí.
 */
function parseArticles(sheet: Sheet): CoverageReport | null {
  const headerIndex = sheet.data.slice(0, 6).findIndex((row) => {
    const names = row.map((c) => normalizeHeader(cellText(c)));
    return names.includes('customer item') && names.includes('stock in transit') && names.includes('stock');
  });
  if (headerIndex === -1) return null;
  const header = sheet.data[headerIndex]!.map((c) => cellText(c));
  const col = {
    customer: findColumn(header, ['Customer Item']),
    item: findColumn(header, ['Item number']),
    description: findColumn(header, ['Item description']),
    stock: findColumn(header, ['Stock']),
    transit: findColumn(header, ['Stock in transit']),
    further: findColumn(header, ['Further stock in transit']),
    uncoveredAt: findColumn(header, ['First uncovered IB-Plan', 'First uncovered']),
    uncoveredNo: findColumn(header, ['First uncovered Prod No']),
  };
  const body = sheet.data.slice(headerIndex + 1).filter((row) => cellText(row[col.customer]) !== '');
  const dayColumns = dayColumnsOf(sheet.data[headerIndex]!, body);
  if (dayColumns.length === 0) return null;

  const rows: CoverageRow[] = body.map((row) => {
    const customerNumber = cellText(row[col.customer]);
    const transit = (cellNumber(row[col.transit]) ?? 0) + (col.further === -1 ? 0 : (cellNumber(row[col.further]) ?? 0));
    const balance = dayValues(row, dayColumns, (cellNumber(row[col.stock]) ?? 0) + transit).map((v) => v - transit);
    return {
      customerNumber,
      customerKey: customerKey(customerNumber),
      supplierItem: col.item === -1 ? '' : cellText(row[col.item]),
      description: col.description === -1 ? '' : cellText(row[col.description]),
      customerStock: cellNumber(row[col.stock]) ?? 0,
      balance,
      transit: dayColumns.map(() => transit),
      firstUncovered: col.uncoveredNo === -1 ? '' : cellText(row[col.uncoveredNo]),
      uncoveredAt: col.uncoveredAt === -1 ? '' : dateTimeText(row[col.uncoveredAt]),
    };
  });
  return { format: 'articles', sheet: sheet.name, days: dayColumns.map((d) => d.day), rows, issueCount: 0, issues: [] };
}

/**
 * Formát „bestand“: nad záhlavím údaje o souboru (KLIENT, čas), záhlaví s německými názvy sloupců
 * (ARTIKEL = naše číslo dílu, SACHNUMMER = číslo zákazníka, Bestand, Avisiert = transit, Gesperrt)
 * a dny jako datumy. Stav dne transit neobsahuje. V souboru bývají i řádky jiných klientů;
 * použijí se jen řádky klienta uvedeného nahoře v souboru (název není v aplikaci napevno).
 */
function parseBestand(sheet: Sheet): CoverageReport | null {
  const headerIndex = sheet.data.slice(0, 10).findIndex((row) => {
    const names = row.map((c) => normalizeHeader(cellText(c)));
    return names.includes('artikel') && names.includes('sachnummer') && names.includes('bestand');
  });
  if (headerIndex === -1) return null;
  const header = sheet.data[headerIndex]!.map((c) => cellText(c));
  const col = {
    client: findColumn(header, ['KUNDE']),
    item: findColumn(header, ['ARTIKEL']),
    customer: findColumn(header, ['SACHNUMMER']),
    description: findColumn(header, ['BEZEICHNUNG']),
    stock: findColumn(header, ['Bestand']),
    transit: findColumn(header, ['Avisiert']),
    uncoveredNo: findColumn(header, ['Erste Fehlende']),
    uncoveredAt: findColumn(header, ['PlanZeit']),
  };
  // „KLIENT:“ v hlavičce souboru, hodnota je v další neprázdné buňce řádku.
  let client = '';
  for (const row of sheet.data.slice(0, headerIndex)) {
    const index = row.findIndex((c) => normalizeHeader(cellText(c)) === 'klient');
    const value = index === -1 ? undefined : row.slice(index + 1).find((c) => cellText(c) !== '');
    if (value !== undefined) client = cellText(value).toUpperCase();
  }
  const body = sheet.data
    .slice(headerIndex + 1)
    .filter((row) => cellText(row[col.customer]) !== '')
    .filter((row) => !client || col.client === -1 || cellText(row[col.client]).toUpperCase() === client);
  const dayColumns = dayColumnsOf(sheet.data[headerIndex]!, body);
  if (dayColumns.length === 0) return null;

  const rows: CoverageRow[] = body.map((row) => {
    const customerNumber = cellText(row[col.customer]);
    const transit = col.transit === -1 ? 0 : (cellNumber(row[col.transit]) ?? 0);
    const stock = cellNumber(row[col.stock]) ?? 0;
    return {
      customerNumber,
      customerKey: customerKey(customerNumber),
      supplierItem: col.item === -1 ? '' : cellText(row[col.item]),
      description: col.description === -1 ? '' : cellText(row[col.description]),
      customerStock: stock,
      balance: dayValues(row, dayColumns, stock),
      transit: dayColumns.map(() => transit),
      firstUncovered: col.uncoveredNo === -1 ? '' : cellText(row[col.uncoveredNo]),
      uncoveredAt: col.uncoveredAt === -1 ? '' : dateTimeText(row[col.uncoveredAt]),
    };
  });

  return { format: 'bestand', sheet: sheet.name, days: dayColumns.map((d) => d.day), rows, issueCount: 0, issues: [] };
}

/** Sloupce dnů: datum v záhlaví a aspoň jedna hodnota (prázdné sloupce se starým datem se vynechají). */
function dayColumnsOf(header: readonly Cell[], body: readonly Cell[][]): { day: DayNumber; c: number }[] {
  return header
    .flatMap((cell, c) => {
      const day = dayOf(cell);
      return day !== null && body.some((row) => cellNumber(row[c]) !== null) ? [{ day, c }] : [];
    })
    .sort((a, b) => a.day - b.day);
}

/** Hodnoty po dnech; prázdný den převezme předchozí stav (na začátku `start`). */
function dayValues(row: readonly Cell[], columns: readonly { c: number }[], start: number): number[] {
  let last = start;
  return columns.map(({ c }) => (last = cellNumber(row[c]) ?? last));
}

/** Najde v sešitu list ve známém formátu a převede ho. */
export function parseCoverageWorkbook(sheets: readonly Sheet[]): CoverageResult {
  for (const sheet of sheets) {
    const report = parseOverview(sheet) ?? parseArticles(sheet) ?? parseBestand(sheet);
    if (report) return { ok: true, value: report };
  }
  return { ok: false, error: 'unknownFormat' };
}
