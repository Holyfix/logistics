// Kusovník (BOM) z ERP: víceúrovňový rozpad hotových dílů na komponenty.

import { findColumn } from './csv';
import { cellNumber, cellText, MAX_ISSUES, type Cell, type DataIssue } from './table';

export const BOM_COLUMNS = {
  level: ['Level', 'Úroveň'],
  item: ['Component Item', 'Component', 'Komponenta', 'Item Number'],
  description: ['Description', 'Popis'],
  qty: ['Quantity Per', 'Qty Per', 'Množství'],
  um: ['UM', 'Unit of Measure', 'MJ'],
  source: ['Purchase/Manufacture', 'Pur/Mfg', 'P/M', 'P = Purchased / L = Line manufactured', 'Purchased/Manufactured'],
  project: ['Project', 'Projekt'],
} as const;

/** Komponenta s množstvím na 1 ks hotového dílu (přes všechny úrovně). */
export interface BomComponent {
  item: string;
  /** Množství na 1 ks hotového dílu: součin „Quantity Per“ po cestě od hotového dílu, sečtený přes všechny výskyty. */
  qty: number;
  /** Nejnižší úroveň, na které se komponenta v hotovém dílu vyskytuje (1 = přímo pod hotovým dílem). */
  level: number;
}

/** Uzel stromu kusovníku: díl s množstvím na 1 ks nadřazeného dílu a díly pod ním. */
export interface BomNode {
  item: string;
  /** Quantity Per: množství na 1 ks nadřazeného dílu. */
  qty: number;
  children: BomNode[];
}

export interface BomItemInfo {
  description: string;
  um: string;
  /** P = nakupovaný, L/M = vyráběný (podle sloupce Purchase/Manufacture). */
  source: string;
  /** Projekt ze sloupce Project v kusovníku (pokud ho export obsahuje). */
  project: string;
}

export interface BomData {
  /** Hotové díly (řádky „Parent“) a jejich rozpad. */
  parents: Map<string, BomComponent[]>;
  /** Strom kusovníku po hotových dílech (přímé komponenty hotového dílu a pod nimi další úrovně). */
  trees: Map<string, BomNode[]>;
  /** Popis, jednotka a druh podle čísla dílu (komponenty i hotové díly). */
  info: Map<string, BomItemInfo>;
  issueCount: number;
  issues: DataIssue[];
}

export type BomResult = { ok: true; value: BomData } | { ok: false; error: 'missingColumns'; columns: string[] };

const PARENT = 'parent';

/** Úroveň z textu „1“, „.2“, „..3“ … nebo „Parent“ / „0“ (hotový díl). */
function levelOf(cell: Cell | undefined): number | null {
  const text = cellText(cell).toLowerCase();
  if (text === PARENT) return 0;
  const n = Number(text.replace(/^\.+/, ''));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Načte odsazený kusovník: řádek „Parent“ začíná hotový díl, pod ním komponenty s úrovní 1, .2, ..3 …
 * Množství na hotový díl je součin „Quantity Per“ od hotového dílu dolů. Záhlaví může být v prvních 10 řádcích.
 */
export function parseBom(data: readonly Cell[][]): BomResult {
  const headerIndex = data.slice(0, 10).findIndex((row) => {
    const header = row.map((c) => cellText(c));
    return findColumn(header, BOM_COLUMNS.level) !== -1 && findColumn(header, BOM_COLUMNS.item) !== -1;
  });
  if (headerIndex === -1) return { ok: false, error: 'missingColumns', columns: [BOM_COLUMNS.level[0], BOM_COLUMNS.item[0]] };
  const header = data[headerIndex]!.map((c) => cellText(c));
  const col = Object.fromEntries(Object.entries(BOM_COLUMNS).map(([key, aliases]) => [key, findColumn(header, aliases)])) as Record<
    keyof typeof BOM_COLUMNS,
    number
  >;
  // Druh dílu může mít v záhlaví i vysvětlivku, např. „P = Purchased / L = Line manufactured“.
  if (col.source === -1) col.source = header.findIndex((h) => /purchas/i.test(h));
  if (col.qty === -1) return { ok: false, error: 'missingColumns', columns: [BOM_COLUMNS.qty[0]] };

  const parents = new Map<string, BomComponent[]>();
  const trees = new Map<string, BomNode[]>();
  const info = new Map<string, BomItemInfo>();
  const issues: DataIssue[] = [];
  let issueCount = 0;
  const issue = (i: DataIssue) => {
    issueCount++;
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  const text = (row: readonly Cell[], c: number) => (c === -1 ? '' : cellText(row[c]));

  let current: Map<string, BomComponent> | null = null;
  // Množství na 1 ks hotového dílu pro poslední komponentu na každé úrovni (index = úroveň).
  let path: number[] = [1];
  // Seznam potomků pro poslední díl na každé úrovni (index 0 = hotový díl).
  let nodes: BomNode[][] = [];

  const finish = (parent: string | null, components: Map<string, BomComponent> | null) => {
    if (parent && components) parents.set(parent, [...components.values()]);
  };
  let parent: string | null = null;

  for (let r = headerIndex + 1; r < data.length; r++) {
    const row = data[r]!;
    const rowNo = r + 1;
    const item = text(row, col.item).toUpperCase();
    if (!item) continue;
    const level = levelOf(row[col.level]);
    if (level === null) {
      issue({ row: rowNo, column: BOM_COLUMNS.level[0], value: text(row, col.level), message: 'invalidNumber' });
      continue;
    }
    if (!info.has(item))
      info.set(item, { description: text(row, col.description), um: text(row, col.um).toUpperCase(), source: text(row, col.source).toUpperCase(), project: text(row, col.project) });
    if (level === 0) {
      finish(parent, current);
      parent = item;
      // Stejný hotový díl dvakrát v jednom souboru: platí poslední výskyt.
      current = new Map();
      path = [1];
      nodes = [[]];
      trees.set(item, nodes[0]!);
      continue;
    }
    if (!current) {
      issue({ row: rowNo, column: BOM_COLUMNS.level[0], value: text(row, col.level), message: 'missingValue' });
      continue;
    }
    const qtyPer = cellNumber(row[col.qty]);
    if (qtyPer === null) {
      issue({ row: rowNo, column: BOM_COLUMNS.qty[0], value: text(row, col.qty), message: 'invalidNumber' });
      continue;
    }
    // Přeskočená úroveň (např. z 1 rovnou na 3) se počítá od nejbližší vyšší známé úrovně.
    const above = path[Math.min(level - 1, path.length - 1)]!;
    const qty = above * qtyPer;
    path = path.slice(0, level);
    path[level] = qty;
    const node: BomNode = { item, qty: qtyPer, children: [] };
    nodes[Math.min(level - 1, nodes.length - 1)]!.push(node);
    nodes = nodes.slice(0, level);
    nodes[level] = node.children;
    const existing = current.get(item);
    if (existing) {
      existing.qty += qty;
      existing.level = Math.min(existing.level, level);
    } else {
      current.set(item, { item, qty, level });
    }
  }
  finish(parent, current);

  return { ok: true, value: { parents, trees, info, issueCount, issues } };
}

/** Spojí kusovníky z víc souborů; když je hotový díl ve víc souborech, platí soubor uvedený dřív (nejnovější). */
export function mergeBoms(boms: readonly BomData[]): BomData {
  const parents = new Map<string, BomComponent[]>();
  const trees = new Map<string, BomNode[]>();
  const info = new Map<string, BomItemInfo>();
  for (const bom of boms) {
    for (const [parent, components] of bom.parents) {
      if (parents.has(parent)) continue;
      parents.set(parent, components);
      trees.set(parent, bom.trees.get(parent) ?? []);
    }
    for (const [item, i] of bom.info) if (!info.has(item)) info.set(item, i);
  }
  return { parents, trees, info, issueCount: boms.reduce((n, b) => n + b.issueCount, 0), issues: boms.flatMap((b) => b.issues).slice(0, MAX_ISSUES) };
}

/** Díl z kusovníku pod hotovým dílem: nakupovaný (P), nebo vyráběný (mezivýroba). */
export interface BomPart {
  item: string;
  description: string;
  purchased: boolean;
}

/**
 * Komponenty všech kusovníků (bez hotových dílů nahoře) s rozlišením nakupovaný / vyráběný podle sloupce
 * Purchase/Manufacture (P = nakupovaný, jiný údaj = vyráběný); bez údaje je nakupovaný díl, pod kterým už nic není.
 */
export function bomParts(boms: readonly BomData[]): BomPart[] {
  const parts = new Map<string, BomPart>();
  for (const bom of boms) {
    const walk = (nodes: readonly BomNode[]) => {
      for (const node of nodes) {
        const source = bom.info.get(node.item)?.source ?? '';
        const purchased = source === 'P' || (!source && node.children.length === 0);
        const known = parts.get(node.item);
        // Díl, který je někde vyráběný (má pod sebou díly nebo je označený jako vyráběný), je vyráběný.
        if (!known) parts.set(node.item, { item: node.item, description: bom.info.get(node.item)?.description ?? '', purchased });
        else if (!purchased) known.purchased = false;
        walk(node.children);
      }
    };
    for (const tree of bom.trees.values()) walk(tree);
  }
  return [...parts.values()];
}
