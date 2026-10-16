// Kmenová data dílů (mapování): tabulka, kterou udržuje uživatel (Excel nebo CSV ve sdílené složce).

import { findColumn } from './csv';
import { cellNumber, cellText, MAX_ISSUES, type DataIssue, type DataTable } from './table';

export const MASTER_COLUMNS = {
  item: ['Item Number', 'Díl', 'Číslo dílu', 'Item', 'Part Number'],
  customerNumber: ['Customer Number', 'Číslo zákazníka', 'Customer Item Number'],
  description: ['Description', 'Item Description', 'Popis'],
  variant: ['Variant', 'Varianta'],
  type: ['Type', 'Typ'],
  kind: ['Item Type', 'Druh dílu', 'Druh', 'Kind'],
  project: ['Project', 'Projekt'],
  customer: ['Zákazník', 'Customer'],
  side: ['Strana', 'Side', 'Řízení'],
  safetyStock: ['Safety Stock', 'Pojistná zásoba'],
  safetyTime: ['Safety Time', 'Pojistná doba'],
  orderMultiple: ['Order Multiple', 'Balení', 'Kusů v balení'],
  componentCoverage: ['Component Coverage', 'Coverage Component', 'Coverage komponent', 'Komponenta'],
  line: ['Line', 'Linka', 'Výrobní linka', 'Production Line'],
  category: ['Category', 'Kategorie'],
} as const;

/** Hodnoty, které ve sloupci Component Coverage znamenají „sledovat“. */
const YES = new Set(['ano', 'a', 'yes', 'y', 'x', '1', 'true', 'pravda']);

export const SIDES = ['LHD', 'RHD'] as const;

/** Druh dílu: PG = nakupovaný, SFG = mezivýroba (WIP), FG = hotový výrobek. */
export const ITEM_KINDS = ['FG', 'SFG', 'PG'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Druh dílu z textu (PG, SFG, FG; připustí i WIP a Purchased/Finished); neznámý text = null, prázdný = ''. */
export function kindOf(value: string): ItemKind | '' | null {
  const v = value.trim().toUpperCase();
  if (!v) return '';
  if ((ITEM_KINDS as readonly string[]).includes(v)) return v as ItemKind;
  if (v === 'WIP') return 'SFG';
  if (v === 'PURCHASED') return 'PG';
  if (v === 'FINISHED') return 'FG';
  return null;
}

/** Strana pro výrobu: LHD nebo RHD podle začátku (např. „RHD HUD“ je RHD); jinak prázdná. */
export function sideGroup(side: string): string {
  return /^\s*(LHD|RHD)\b/i.exec(side)?.[1]?.toUpperCase() ?? '';
}

export interface MasterItem {
  item: string;
  /** Číslo dílu u zákazníka, jak je v mapování. */
  customerNumber: string;
  /** Normalizované číslo zákazníka pro párování se soubory zákazníka (customerKey). */
  customerKey: string;
  description: string;
  variant: string;
  type: string;
  /** Druh dílu (PG, SFG, FG); prázdný = neuvedeno. */
  kind: ItemKind | '';
  project: string;
  customer: string;
  /** LHD / RHD: ze sloupce Strana, jinak ze začátku varianty (např. „LHD HUD“). */
  side: string;
  safetyStock: number | null;
  safetyTime: number | null;
  /** Kusů v plném balení; podle něj se náš sklad dělí na plná a neúplná balení. */
  orderMultiple: number | null;
  /** Komponenta se zobrazuje v modulu Komponenty (sloupec Component Coverage). */
  componentCoverage: boolean;
  /** Výrobní linka, na které se díl vyrábí (ASSEMBLY, FOA, SLH, IMM), velkými písmeny; prázdné = neuvedeno. */
  line: string;
  /** Druh výrobku nebo komponenty (např. DP = door panel, HB), jak ho uživatel zapíše; prázdné = neuvedeno. */
  category: string;
}

/** Sloupec mapování (klíč z MASTER_COLUMNS). */
export type MasterField = keyof typeof MASTER_COLUMNS;

export interface MasterData {
  items: Map<string, MasterItem>;
  /** Sloupce, které soubor mapování obsahuje. */
  columns: ReadonlySet<MasterField>;
  /** Díly podle normalizovaného čísla zákazníka. */
  byCustomerKey: Map<string, MasterItem>;
  /** Mapování má sloupec Component Coverage (jinak se v Komponentách zobrazí všechny nakupované komponenty). */
  hasComponentColumn: boolean;
  /** Mapování má sloupec Line (jinak se do plánu montáže berou všechny hotové díly s projektem a stranou). */
  hasLineColumn: boolean;
  issueCount: number;
  issues: DataIssue[];
}

export type MasterResult = { ok: true; value: MasterData } | { ok: false; error: 'missingColumns'; columns: string[] };

/**
 * Dlouhé číslo zákazníka začínající „A“ rozdělené na číslo dílu (11 znaků), variantu (4 znaky, např. „9051“,
 * „8R01“) a písmenné označení (aspoň 3 písmena, např. „ERS“), které zákazník píše před variantu i za ni.
 * Doplňující nuly a pomlčky se vynechají („  00009051“ → varianta „9051“); jiný zbytek (`middle`) zůstane.
 * null, když číslo tento tvar nemá.
 */
function splitCustomerNumber(value: string): { part: string; middle: string; variant: string; tag: string } | null {
  const compact = value.replace(/[\s-]+/g, '').toUpperCase();
  if (compact.length < 15 || !compact.startsWith('A')) return null;
  let rest = compact.slice(11);
  let tag = '';
  // Po odebrání označení musí zbýt varianta (aspoň 4 znaky, ne samé doplňující nuly).
  const leavesVariant = (remaining: string) => remaining.length >= 4 && /[^0]/.test(remaining);
  const trailing = /[A-Z]{3,}$/.exec(rest);
  if (trailing && leavesVariant(rest.slice(0, -trailing[0].length))) {
    tag = trailing[0];
    rest = rest.slice(0, -tag.length);
  } else {
    const leading = /^0*([A-Z]{3,})/.exec(rest);
    if (leading && leavesVariant(rest.slice(leading[0].length))) {
      tag = leading[1]!;
      rest = rest.slice(leading[0].length);
    }
  }
  return { part: compact.slice(0, 11), middle: rest.slice(0, -4).replace(/^0+/, ''), variant: rest.slice(-4), tag };
}

/**
 * Číslo dílu zákazníka v jednotné podobě: velká písmena bez mezer. U dlouhých čísel začínajících „A“ (číslo dílu
 * + doplněná varianta, např. „A1234567890  00001234“) se vynechají doplňující nuly a pomlčky mezi číslem dílu
 * a variantou, aby se shodovala různá zápisová pravidla v souborech zákazníka. Písmenné označení (např. „ERS“)
 * zůstane, před variantou i za ní: „A1234567890 ERS 8R01“ = „A1234567890 8R01 ERS“, ale jiný díl než
 * „A1234567890 8R01“.
 */
export function customerKey(value: string): string {
  const split = splitCustomerNumber(value);
  if (split) return split.part + split.middle + split.variant + split.tag;
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Jednotný zápis čísla zákazníka pro zobrazení: „A1234567890 1234“ (bez doplňujících nul barvy), „A1234567890 8R01 ERS“. */
export function customerDisplay(value: string): string {
  const split = splitCustomerNumber(value);
  if (split) return [split.part, split.middle, split.variant, split.tag].filter(Boolean).join(' ');
  return value.trim().replace(/\s+/g, ' ');
}

function sideOf(side: string, variant: string): string {
  const explicit = side.toUpperCase();
  if (explicit) return explicit;
  const first = variant.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return (SIDES as readonly string[]).includes(first) ? first : '';
}

/** Linky výroby; ve sloupci Line se přijímají i běžné zkratky a české názvy. */
export const LINES = ['ASSEMBLY', 'FOA', 'SLH', 'IMM'] as const;
export type LineId = (typeof LINES)[number];

const LINE_ALIASES: Record<string, LineId> = {
  ASSEMBLY: 'ASSEMBLY',
  ASSY: 'ASSEMBLY',
  MONTAZ: 'ASSEMBLY',
  FOA: 'FOA',
  FOAM: 'FOA',
  FOAMING: 'FOA',
  SLH: 'SLH',
  SLUSH: 'SLH',
  IMM: 'IMM',
  VSTRIKOVANI: 'IMM',
  VSTRIKOLISOVNA: 'IMM',
};

/** Linka z textu ve sloupci Line: známá zkratka nebo název se převede na kód linky, jiný text zůstane velkými písmeny. */
export function lineOf(value: string): string {
  const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  return LINE_ALIASES[key.split(/\s+/)[0] ?? ''] ?? key;
}

export function parseMasterData(table: DataTable): MasterResult {
  const col = Object.fromEntries(
    Object.entries(MASTER_COLUMNS).map(([key, aliases]) => [key, findColumn(table.header, aliases)]),
  ) as Record<keyof typeof MASTER_COLUMNS, number>;
  if (col.item === -1) return { ok: false, error: 'missingColumns', columns: [MASTER_COLUMNS.item[0]] };

  const items = new Map<string, MasterItem>();
  const byCustomerKey = new Map<string, MasterItem>();
  const issues: DataIssue[] = [];
  let issueCount = 0;
  const issue = (i: DataIssue) => {
    issueCount++;
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  const text = (row: DataTable['rows'][number], c: number) => (c === -1 ? '' : cellText(row[c]));

  table.rows.forEach((row, index) => {
    const rowNo = index + 2;
    const item = text(row, col.item);
    if (!item) return;
    if (items.has(item)) issue({ row: rowNo, column: MASTER_COLUMNS.item[0], value: item, message: 'duplicateItem' });
    const variant = text(row, col.variant);
    const side = sideOf(text(row, col.side), variant);
    if (col.side !== -1 && side && !sideGroup(side)) {
      issue({ row: rowNo, column: MASTER_COLUMNS.side[0], value: side, message: 'unknownSide' });
    }
    const customerNumber = text(row, col.customerNumber);
    const number = (c: number) => (c === -1 ? null : cellNumber(row[c]));
    const kind = kindOf(text(row, col.kind));
    if (kind === null) issue({ row: rowNo, column: MASTER_COLUMNS.kind[0], value: text(row, col.kind), message: 'unknownKind' });
    const entry: MasterItem = {
      item,
      customerNumber,
      customerKey: customerKey(customerNumber),
      description: text(row, col.description),
      variant,
      type: text(row, col.type),
      kind: kind ?? '',
      project: text(row, col.project),
      customer: text(row, col.customer),
      side,
      safetyStock: number(col.safetyStock),
      safetyTime: number(col.safetyTime),
      orderMultiple: number(col.orderMultiple),
      componentCoverage: YES.has(text(row, col.componentCoverage).toLowerCase()),
      line: lineOf(text(row, col.line)),
      category: text(row, col.category).replace(/\s+/g, ' '),
    };
    items.set(item, entry);
    if (entry.customerKey) {
      const other = byCustomerKey.get(entry.customerKey);
      if (other && other.item !== item) {
        issue({ row: rowNo, column: MASTER_COLUMNS.customerNumber[0], value: `${customerNumber} (${other.item})`, message: 'duplicateCustomerNumber' });
      } else {
        byCustomerKey.set(entry.customerKey, entry);
      }
    }
  });

  const columns = new Set((Object.keys(col) as MasterField[]).filter((key) => col[key] !== -1));
  return { ok: true, value: { items, byCustomerKey, columns, hasComponentColumn: col.componentCoverage !== -1, hasLineColumn: col.line !== -1, issueCount, issues } };
}
