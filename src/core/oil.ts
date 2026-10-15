// OIL (Open Issue List): otevřené body, opatření, odpovědný, termín a plnění po krocích 0/25/50/75/100 %.
// Ukládá se jako Excel do složky OIL ve sdílené složce (list bodů, komentáře a historie posunů termínu).

import { findColumn } from './csv';
import { dayToIso, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

export const PROGRESS_STEPS = [0, 25, 50, 75, 100] as const;
export type Progress = (typeof PROGRESS_STEPS)[number];

/** Komentář k bodu: kdy (místní čas „d.m.rrrr h:mm“), kdo a co. */
export interface OilComment {
  at: string;
  author: string;
  text: string;
}

/** Posun termínu: z kterého dne na který, kdo, kdy a proč. */
export interface OilShift {
  at: string;
  author: string;
  from: DayNumber;
  to: DayNumber;
  reason: string;
}

export interface OilItem {
  /** Číslo bodu (1, 2, 3 …), nemění se. */
  id: number;
  problem: string;
  action: string;
  owner: string;
  opened: DayNumber;
  /** Termín dokončení; null = zatím bez termínu. */
  due: DayNumber | null;
  progress: Progress;
  cancelled: boolean;
  /** Den, kdy bod dosáhl 100 %. */
  closed: DayNumber | null;
  comments: OilComment[];
  shifts: OilShift[];
}

export interface OilList {
  items: OilItem[];
}

export const emptyOil = (): OilList => ({ items: [] });

/** done = hotovo, cancelled = zrušeno, overdue = po termínu, progress = rozpracováno v termínu, open = nezahájeno v termínu. */
export type OilStatus = 'done' | 'cancelled' | 'overdue' | 'progress' | 'open';

export function statusOf(item: OilItem, today: DayNumber): OilStatus {
  if (item.cancelled) return 'cancelled';
  if (item.progress === 100) return 'done';
  if (item.due !== null && item.due < today) return 'overdue';
  return item.progress > 0 ? 'progress' : 'open';
}

/** Původní termín: první termín bodu (před všemi posuny). */
export function originalDue(item: OilItem): DayNumber | null {
  return item.shifts[0]?.from ?? item.due;
}

/** Čas pro komentář a posun: místní „d.m.rrrr h:mm“. */
export function stamp(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function addItem(list: OilList, today: DayNumber): { list: OilList; id: number } {
  const id = Math.max(0, ...list.items.map((i) => i.id)) + 1;
  const item: OilItem = { id, problem: '', action: '', owner: '', opened: today, due: null, progress: 0, cancelled: false, closed: null, comments: [], shifts: [] };
  return { list: { items: [...list.items, item] }, id };
}

export function updateItem(list: OilList, id: number, change: (item: OilItem) => OilItem): OilList {
  return { items: list.items.map((i) => (i.id === id ? change(i) : i)) };
}

/** Jednotliví odpovědní z pole Odpovědný („A / B“, „A, B“ nebo „A; B“). */
export function ownerNames(owner: string): string[] {
  return owner
    .split(/[/,;]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Trvalé smazání bodu včetně komentářů a posunů (na rozdíl od zrušení, které bod v seznamu ponechá). */
export function removeItem(list: OilList, id: number): OilList {
  return { items: list.items.filter((i) => i.id !== id) };
}

/** Plnění: 100 % uzavře bod (den uzavření), méně ho zase otevře. */
export function withProgress(item: OilItem, progress: Progress, today: DayNumber): OilItem {
  return { ...item, progress, closed: progress === 100 ? (item.closed ?? today) : null };
}

/** Další krok plnění (po 100 % zůstane 100 %). */
export function nextProgress(progress: Progress): Progress {
  return PROGRESS_STEPS[Math.min(PROGRESS_STEPS.length - 1, PROGRESS_STEPS.indexOf(progress) + 1)]!;
}

/**
 * Nový termín. První termín se jen nastaví; změna existujícího termínu je posun a zapíše se do historie
 * (kdo, kdy, z kterého dne na který a důvod).
 */
export function withDue(item: OilItem, due: DayNumber, reason: string, author: string, at: string): OilItem {
  if (item.due === null) return { ...item, due };
  if (item.due === due) return item;
  return { ...item, due, shifts: [...item.shifts, { at, author, from: item.due, to: due, reason: reason.trim() }] };
}

export function withComment(item: OilItem, text: string, author: string, at: string): OilItem {
  return { ...item, comments: [...item.comments, { at, author, text: text.trim() }] };
}

// --- Soubor OIL.xlsx ---

const COLUMNS = {
  id: ['Číslo', 'ID', 'No.'],
  problem: ['Problém', 'Problem', 'Issue'],
  action: ['Opatření', 'Action'],
  owner: ['Odpovědný', 'Owner', 'Responsible'],
  opened: ['Otevřeno', 'Opened'],
  due: ['Termín', 'Due'],
  progress: ['Plnění (%)', 'Plnění', 'Progress'],
  status: ['Stav', 'Status'],
  closed: ['Uzavřeno', 'Closed'],
  at: ['Kdy', 'When'],
  author: ['Kdo', 'Who'],
  text: ['Komentář', 'Comment'],
  from: ['Z', 'From'],
  to: ['Na', 'To'],
  reason: ['Důvod', 'Reason'],
} as const;

const STATUS_TEXT: Record<OilStatus, string> = { done: 'Hotovo', cancelled: 'Zrušeno', overdue: 'Po termínu', progress: 'Rozpracováno', open: 'Nezahájeno' };

const formatDate = (day: DayNumber | null) => {
  if (day === null) return null;
  const [y, m, d] = dayToIso(day).split('-');
  return `${d}.${m}.${y}`;
};

export interface OilSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

/** Listy souboru: „OIL“ (body), „Komentáře“ a „Posuny termínu“. Stav a počet posunů jsou pro čtení v Excelu. */
export function oilSheets(list: OilList, today: DayNumber): OilSheet[] {
  const items = [...list.items].sort((a, b) => a.id - b.id);
  return [
    {
      name: 'OIL',
      header: [COLUMNS.id[0], COLUMNS.problem[0], COLUMNS.action[0], COLUMNS.owner[0], COLUMNS.opened[0], COLUMNS.due[0], 'Původní termín', 'Posunů termínu', COLUMNS.progress[0], COLUMNS.status[0], COLUMNS.closed[0], 'Poslední komentář'],
      rows: items.map((i) => [
        i.id,
        i.problem,
        i.action,
        i.owner,
        formatDate(i.opened),
        formatDate(i.due),
        formatDate(originalDue(i)),
        i.shifts.length,
        i.progress,
        STATUS_TEXT[statusOf(i, today)],
        formatDate(i.closed),
        i.comments.at(-1)?.text ?? null,
      ]),
    },
    {
      name: 'Komentáře',
      header: [COLUMNS.id[0], COLUMNS.at[0], COLUMNS.author[0], COLUMNS.text[0]],
      rows: items.flatMap((i) => i.comments.map((c) => [i.id, c.at, c.author, c.text])),
    },
    {
      name: 'Posuny termínu',
      header: [COLUMNS.id[0], COLUMNS.at[0], COLUMNS.author[0], COLUMNS.from[0], COLUMNS.to[0], COLUMNS.reason[0]],
      rows: items.flatMap((i) => i.shifts.map((s) => [i.id, s.at, s.author, formatDate(s.from), formatDate(s.to), s.reason])),
    },
  ];
}

export type OilResult = { ok: true; value: OilList } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Čas z buňky: text „d.m.rrrr h:mm“, nebo datum s časem z Excelu. */
function stampOf(cell: Cell | undefined): string {
  // Excel čte datum s časem jako UTC se stejnými číslicemi, jaké jsou v buňce.
  if (cell instanceof Date)
    return Number.isNaN(cell.getTime())
      ? ''
      : `${cell.getUTCDate()}.${cell.getUTCMonth() + 1}.${cell.getUTCFullYear()} ${cell.getUTCHours()}:${String(cell.getUTCMinutes()).padStart(2, '0')}`;
  return cellText(cell);
}

const progressOf = (value: number | null): Progress => PROGRESS_STEPS.reduce((best, p) => (Math.abs(p - (value ?? 0)) < Math.abs(best - (value ?? 0)) ? p : best), 0 as Progress);

/** Načte OIL ze souboru; listy se hledají podle sloupců. */
export function parseOilWorkbook(sheets: readonly { name: string; data: Cell[][] }[]): OilResult {
  const find = (required: readonly (readonly string[])[]) => {
    for (const sheet of sheets) {
      const header = (sheet.data[0] ?? []).map((c) => cellText(c));
      const cols = required.map((a) => findColumn(header, a));
      if (cols.every((c) => c !== -1)) return { header, rows: sheet.data.slice(1), cols };
    }
    return null;
  };
  const main = find([COLUMNS.id, COLUMNS.problem, COLUMNS.due, COLUMNS.progress]);
  if (!main) return { ok: false, error: 'missingColumns', columns: [COLUMNS.id[0], COLUMNS.problem[0], COLUMNS.due[0], COLUMNS.progress[0]] };
  const col = (aliases: readonly string[]) => findColumn(main.header, aliases);
  const [idC, problemC, dueC, progressC] = main.cols as [number, number, number, number];
  const text = (c: number, row: Cell[]) => (c === -1 ? '' : cellText(row[c]));
  const actionC = col(COLUMNS.action);
  const ownerC = col(COLUMNS.owner);
  const openedC = col(COLUMNS.opened);
  const statusC = col(COLUMNS.status);
  const closedC = col(COLUMNS.closed);

  const items = new Map<number, OilItem>();
  for (const row of main.rows) {
    const id = cellNumber(row[idC]);
    if (id === null || id <= 0 || items.has(id)) continue;
    const progress = progressOf(cellNumber(row[progressC]));
    const opened = (openedC === -1 ? null : cellDay(row[openedC])) ?? cellDay(row[dueC]) ?? 0;
    items.set(id, {
      id: Math.round(id),
      problem: cellText(row[problemC]),
      action: text(actionC, row),
      owner: text(ownerC, row),
      opened,
      due: cellDay(row[dueC]),
      progress,
      cancelled: statusC !== -1 && /zru[sš]|cancel/i.test(cellText(row[statusC])),
      closed: progress === 100 ? ((closedC === -1 ? null : cellDay(row[closedC])) ?? opened) : null,
      comments: [],
      shifts: [],
    });
  }

  const comments = find([COLUMNS.id, COLUMNS.at, COLUMNS.author, COLUMNS.text]);
  if (comments && comments !== main) {
    const [i, at, author, text] = comments.cols as [number, number, number, number];
    for (const row of comments.rows) {
      const item = items.get(cellNumber(row[i]) ?? -1);
      if (item && cellText(row[text])) item.comments.push({ at: stampOf(row[at]), author: cellText(row[author]), text: cellText(row[text]) });
    }
  }
  const shifts = find([COLUMNS.id, COLUMNS.at, COLUMNS.from, COLUMNS.to, COLUMNS.reason]);
  if (shifts && shifts !== main) {
    const [i, at, from, to, reason] = shifts.cols as [number, number, number, number, number];
    const authorC = findColumn(shifts.header, COLUMNS.author);
    for (const row of shifts.rows) {
      const item = items.get(cellNumber(row[i]) ?? -1);
      const f = cellDay(row[from]);
      const t = cellDay(row[to]);
      if (item && f !== null && t !== null) item.shifts.push({ at: stampOf(row[at]), author: authorC === -1 ? '' : cellText(row[authorC]), from: f, to: t, reason: cellText(row[reason]) });
    }
  }
  return { ok: true, value: { items: [...items.values()].sort((a, b) => a.id - b.id) } };
}
