// Obaly – sledování bodů: každý bod (nový obal, úprava, nákup) má řadu kroků s odpovědným a termínem. Aktuální krok
// je první nesplněný: na něj se čeká. Ukládá se jako Excel do složky Obaly ve sdílené složce (body, kroky, komentáře
// a historie posunů termínu). Umí načíst i checklist ve tvaru „Description | Status | Step 0 | Step 1 …“.

import { findColumn } from './csv';
import { dayFromParts, dayToIso, mondayOf, mondayOfIsoWeek, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

export interface PackStep {
  text: string;
  owner: string;
  /** Termín; null = zatím bez termínu. */
  due: DayNumber | null;
  /** Den splnění; null = nesplněno. */
  done: DayNumber | null;
}

/** Komentář k bodu: kdy (místní čas „d.m.rrrr h:mm“), kdo a co. */
export interface PackComment {
  at: string;
  author: string;
  text: string;
}

/** Posun termínu kroku: který krok (text), z kterého dne na který, kdo, kdy a proč. */
export interface PackShift {
  at: string;
  author: string;
  step: string;
  from: DayNumber;
  to: DayNumber;
  reason: string;
}

export interface PackItem {
  /** Číslo bodu (1, 2, 3 …), nemění se. */
  id: number;
  title: string;
  project: string;
  /** Stav / poznámka volným textem (např. „Prototyp hotový“). */
  note: string;
  created: DayNumber;
  cancelled: boolean;
  steps: PackStep[];
  comments: PackComment[];
  shifts: PackShift[];
}

export interface PackList {
  items: PackItem[];
}

export const emptyPackaging = (): PackList => ({ items: [] });

/** done = všechny kroky splněné, cancelled = zrušeno, overdue = aktuální krok po termínu, week = termín do konce týdne, open = ostatní. */
export type PackStatus = 'done' | 'cancelled' | 'overdue' | 'week' | 'open';

/** Pořadí aktuálního kroku (první nesplněný); -1 = bez kroků nebo vše splněno. */
export function currentIndex(item: PackItem): number {
  return item.steps.findIndex((s) => s.done === null);
}

export function currentStep(item: PackItem): PackStep | null {
  return item.steps[currentIndex(item)] ?? null;
}

/** Poslední splněný krok (podle pořadí kroků). */
export function lastDone(item: PackItem): PackStep | null {
  return item.steps.filter((s) => s.done !== null).at(-1) ?? null;
}

/** Neděle týdne, do kterého den patří. */
export const endOfWeek = (day: DayNumber): DayNumber => mondayOf(day) + 6;

export function statusOf(item: PackItem, today: DayNumber): PackStatus {
  if (item.cancelled) return 'cancelled';
  const step = currentStep(item);
  if (!step) return item.steps.length ? 'done' : 'open';
  if (step.due === null) return 'open';
  if (step.due < today) return 'overdue';
  return step.due <= endOfWeek(today) ? 'week' : 'open';
}

/** Čas pro komentář a posun: místní „d.m.rrrr h:mm“. */
export function stamp(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export const emptyStep = (): PackStep => ({ text: '', owner: '', due: null, done: null });

export function addItem(list: PackList, today: DayNumber): { list: PackList; id: number } {
  const id = Math.max(0, ...list.items.map((i) => i.id)) + 1;
  const item: PackItem = { id, title: '', project: '', note: '', created: today, cancelled: false, steps: [emptyStep()], comments: [], shifts: [] };
  return { list: { items: [...list.items, item] }, id };
}

/** Přidá body z importu na konec seznamu s novými čísly. */
export function appendItems(list: PackList, items: readonly PackItem[]): PackList {
  let id = Math.max(0, ...list.items.map((i) => i.id));
  return { items: [...list.items, ...items.map((i) => ({ ...i, id: ++id }))] };
}

export function updateItem(list: PackList, id: number, change: (item: PackItem) => PackItem): PackList {
  return { items: list.items.map((i) => (i.id === id ? change(i) : i)) };
}

export function removeItem(list: PackList, id: number): PackList {
  return { items: list.items.filter((i) => i.id !== id) };
}

export function updateStep(item: PackItem, index: number, change: (step: PackStep) => PackStep): PackItem {
  return { ...item, steps: item.steps.map((s, k) => (k === index ? change(s) : s)) };
}

export function addStep(item: PackItem): PackItem {
  return { ...item, steps: [...item.steps, emptyStep()] };
}

export function removeStep(item: PackItem, index: number): PackItem {
  return { ...item, steps: item.steps.filter((_, k) => k !== index) };
}

/** Posune krok o jedno místo nahoru (-1) nebo dolů (+1). */
export function moveStep(item: PackItem, index: number, by: -1 | 1): PackItem {
  const to = index + by;
  if (to < 0 || to >= item.steps.length) return item;
  const steps = [...item.steps];
  [steps[index], steps[to]] = [steps[to]!, steps[index]!];
  return { ...item, steps };
}

/** Splněno / nesplněno: splnění zapíše dnešní den. */
export function withDone(item: PackItem, index: number, done: boolean, today: DayNumber): PackItem {
  return updateStep(item, index, (s) => ({ ...s, done: done ? (s.done ?? today) : null }));
}

/** Nový termín kroku. První termín se jen nastaví; změna existujícího se zapíše do historie posunů. */
export function withDue(item: PackItem, index: number, due: DayNumber | null, reason: string, author: string, at: string): PackItem {
  const step = item.steps[index];
  if (!step || step.due === due) return item;
  const next = updateStep(item, index, (s) => ({ ...s, due }));
  if (step.due === null || due === null) return next;
  return { ...next, shifts: [...next.shifts, { at, author, step: step.text, from: step.due, to: due, reason: reason.trim() }] };
}

export function withComment(item: PackItem, text: string, author: string, at: string): PackItem {
  return { ...item, comments: [...item.comments, { at, author, text: text.trim() }] };
}

export function withoutComment(item: PackItem, index: number): PackItem {
  return { ...item, comments: item.comments.filter((_, k) => k !== index) };
}

/** Jednotliví odpovědní z pole Odpovědný („A / B“, „A + B“, „A, B“). */
export function ownerNames(owner: string): string[] {
  return owner
    .split(/[/,;+]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

// --- Text kroku z checklistu: „Create PR/PO - 20.11. (Novák)“ → text, termín, odpovědný ---

/** Den z „16.11.“ (rok nejblíž dnešku), „16.11.2026“, „CW50“ / „CW 50“ / „CW02/27“ (pátek týdne); jinak null. */
export function parseLooseDay(token: string, today: DayNumber): DayNumber | null {
  const s = token.trim();
  let m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})?$/.exec(s);
  if (m) {
    const [day, month] = [Number(m[1]), Number(m[2])];
    if (m[3]) return dayFromParts(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), month, day);
    const year = Number(dayToIso(today).slice(0, 4));
    const options = [year - 1, year, year + 1].map((y) => dayFromParts(y, month, day)).filter((d): d is DayNumber => d !== null);
    return options.sort((a, b) => Math.abs(a - today) - Math.abs(b - today))[0] ?? null;
  }
  m = /^(?:CW|KW|KT)\s?(\d{1,2})(?:\s?\/\s?(\d{4}|\d{2}))?$/i.exec(s);
  if (m) {
    const week = Number(m[1]);
    if (week < 1 || week > 53) return null;
    const year = m[2] ? (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])) : null;
    if (year !== null) return mondayOfIsoWeek(year, week) + 4;
    // Bez roku: týden nejblíž dnešku.
    const y = Number(dayToIso(today).slice(0, 4));
    return [y - 1, y, y + 1].map((yy) => mondayOfIsoWeek(yy, week) + 4).sort((a, b) => Math.abs(a - today) - Math.abs(b - today))[0]!;
  }
  return null;
}

const DATE_TOKEN = /(\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{4})?|(?:CW|KW|KT)\s?\d{1,2}(?:\s?\/\s?\d{2,4})?)/gi;

/**
 * Krok z textu checklistu. Jeden termín (datum nebo CW) a jméno v závorce na konci se oddělí do polí; text s více
 * termíny zůstane celý (doplní se ručně).
 */
export function parseStepText(raw: string, today: DayNumber): PackStep {
  let text = raw.replace(/\s+/g, ' ').trim();
  let owner = '';
  // Jméno v závorce: písmena, tečky, mezery, „+“ a „/“ (ne „(300pcs)“ apod.).
  const ownerMatch = /\(([\p{L}][\p{L}. +/-]*)\)\s*$/u.exec(text) ?? /\(([\p{L}][\p{L}. +/-]*)\)/u.exec(text);
  const dates = text.match(DATE_TOKEN) ?? [];
  if (dates.length > 1) return { text, owner: '', due: null, done: null };
  if (ownerMatch && !/\d/.test(ownerMatch[1]!)) {
    owner = ownerMatch[1]!.trim();
    text = (text.slice(0, ownerMatch.index) + text.slice(ownerMatch.index + ownerMatch[0].length)).trim();
  }
  let due: DayNumber | null = null;
  if (dates.length === 1) {
    due = parseLooseDay(dates[0]!, today);
    if (due !== null) {
      // Text bez termínu a oddělovače na konci („… - 20.11.“, „… – CW50“).
      text = text.replace(dates[0]!, ' ').replace(/\s+/g, ' ').trim().replace(/\s*[-–—,:]$/, '').trim();
    }
  }
  return { text, owner, due, done: null };
}

// --- Soubor Obaly.xlsx ---

const COLUMNS = {
  id: ['Číslo', 'ID', 'No.'],
  title: ['Bod', 'Item', 'Popis bodu'],
  project: ['Projekt', 'Project'],
  note: ['Stav', 'Status', 'Poznámka'],
  created: ['Založeno', 'Created'],
  state: ['Stav bodu', 'State'],
  order: ['Pořadí', 'Order'],
  step: ['Krok', 'Step'],
  owner: ['Odpovědný', 'Owner', 'Responsible'],
  due: ['Termín', 'Due'],
  done: ['Splněno', 'Done'],
  at: ['Kdy', 'When'],
  author: ['Kdo', 'Who'],
  text: ['Komentář', 'Comment'],
  from: ['Z', 'From'],
  to: ['Na', 'To'],
  reason: ['Důvod', 'Reason'],
} as const;

const STATE_TEXT: Record<PackStatus, string> = { done: 'Hotovo', cancelled: 'Zrušeno', overdue: 'Po termínu', week: 'Tento týden', open: 'Otevřeno' };

const formatDate = (day: DayNumber | null) => {
  if (day === null) return null;
  const [y, m, d] = dayToIso(day).split('-');
  return `${d}.${m}.${y}`;
};

export interface PackSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

/** Listy souboru: „Obaly“ (body, s aktuálním krokem pro čtení v Excelu), „Kroky“, „Komentáře“ a „Posuny termínu“. */
export function packagingSheets(list: PackList, today: DayNumber): PackSheet[] {
  const items = [...list.items].sort((a, b) => a.id - b.id);
  return [
    {
      name: 'Obaly',
      header: [COLUMNS.id[0], COLUMNS.title[0], COLUMNS.project[0], COLUMNS.note[0], COLUMNS.created[0], COLUMNS.state[0], 'Čeká se na', 'Kdo', 'Termín kroku', 'Kroky splněno'],
      rows: items.map((i) => {
        const step = currentStep(i);
        return [
          i.id,
          i.title,
          i.project,
          i.note,
          formatDate(i.created),
          STATE_TEXT[statusOf(i, today)],
          step?.text ?? null,
          step?.owner ?? null,
          formatDate(step?.due ?? null),
          `${i.steps.filter((s) => s.done !== null).length}/${i.steps.length}`,
        ];
      }),
    },
    {
      name: 'Kroky',
      header: [COLUMNS.id[0], COLUMNS.order[0], COLUMNS.step[0], COLUMNS.owner[0], COLUMNS.due[0], COLUMNS.done[0]],
      rows: items.flatMap((i) => i.steps.map((s, k) => [i.id, k + 1, s.text, s.owner, formatDate(s.due), formatDate(s.done)])),
    },
    {
      name: 'Komentáře',
      header: [COLUMNS.id[0], COLUMNS.at[0], COLUMNS.author[0], COLUMNS.text[0]],
      rows: items.flatMap((i) => i.comments.map((c) => [i.id, c.at, c.author, c.text])),
    },
    {
      name: 'Posuny termínu',
      header: [COLUMNS.id[0], COLUMNS.step[0], COLUMNS.at[0], COLUMNS.author[0], COLUMNS.from[0], COLUMNS.to[0], COLUMNS.reason[0]],
      rows: items.flatMap((i) => i.shifts.map((s) => [i.id, s.step, s.at, s.author, formatDate(s.from), formatDate(s.to), s.reason])),
    },
  ];
}

export type PackagingResult = { ok: true; value: PackList; source: 'app' | 'checklist' } | { ok: false; error: 'missingColumns'; columns: string[] };

/** Čas z buňky: text „d.m.rrrr h:mm“, nebo datum s časem z Excelu. */
function stampOf(cell: Cell | undefined): string {
  if (cell instanceof Date)
    return Number.isNaN(cell.getTime())
      ? ''
      : `${cell.getUTCDate()}.${cell.getUTCMonth() + 1}.${cell.getUTCFullYear()} ${cell.getUTCHours()}:${String(cell.getUTCMinutes()).padStart(2, '0')}`;
  return cellText(cell);
}

type Sheet = { name: string; data: Cell[][] };

function findSheet(sheets: readonly Sheet[], required: readonly (readonly string[])[]) {
  for (const sheet of sheets) {
    const header = (sheet.data[0] ?? []).map((c) => cellText(c));
    const cols = required.map((a) => findColumn(header, a));
    if (cols.every((c) => c !== -1)) return { sheet, header, rows: sheet.data.slice(1), cols };
  }
  return null;
}

/**
 * Checklist: list se sloupcem „Description“ / „Popis“ a sloupci „Step 0“, „Step 1“ … (nebo „Krok 1“ …); sloupec
 * „Status“ = stav bodu. Text kroku se rozdělí na krok, termín a odpovědného. Bod se stavem DONE / Hotovo bez kroků
 * má jeden splněný krok.
 */
export function parseChecklist(sheets: readonly Sheet[], today: DayNumber): PackList | null {
  for (const sheet of sheets) {
    const header = (sheet.data[0] ?? []).map((c) => cellText(c));
    const descC = findColumn(header, ['Description', 'Popis', 'Bod']);
    const stepCols = header.map((h, k) => (/^(step|krok)\s*\d+$/i.test(h) ? k : -1)).filter((k) => k !== -1);
    if (descC === -1 || stepCols.length === 0) continue;
    const statusC = findColumn(header, ['Status', 'Stav']);
    const projectC = findColumn(header, ['Project', 'Projekt']);
    const items: PackItem[] = [];
    for (const row of sheet.data.slice(1)) {
      const title = cellText(row[descC]).replace(/\s+/g, ' ');
      if (!title) continue;
      const note = statusC === -1 ? '' : cellText(row[statusC]).replace(/\s+/g, ' ');
      const steps = stepCols.map((k) => cellText(row[k])).filter(Boolean).map((t) => parseStepText(t, today));
      if (steps.length === 0 && /^(done|hotovo)$/i.test(note)) steps.push({ text: note, owner: '', due: null, done: today });
      items.push({ id: items.length + 1, title, project: projectC === -1 ? '' : cellText(row[projectC]), note, created: today, cancelled: false, steps, comments: [], shifts: [] });
    }
    return { items };
  }
  return null;
}

/** Načte Obaly ze souboru aplikace, nebo checklist (Description | Status | Step 0 …). */
export function parsePackagingWorkbook(sheets: readonly Sheet[], today: DayNumber): PackagingResult {
  const main = findSheet(sheets, [COLUMNS.id, COLUMNS.title]);
  const stepsSheet = findSheet(sheets, [COLUMNS.id, COLUMNS.order, COLUMNS.step]);
  if (!main || !stepsSheet) {
    const checklist = parseChecklist(sheets, today);
    if (checklist) return { ok: true, value: checklist, source: 'checklist' };
    return { ok: false, error: 'missingColumns', columns: [COLUMNS.id[0], COLUMNS.title[0], COLUMNS.step[0]] };
  }
  const col = (aliases: readonly string[]) => findColumn(main.header, aliases);
  const [idC, titleC] = main.cols as [number, number];
  const projectC = col(COLUMNS.project);
  const noteC = col(COLUMNS.note);
  const createdC = col(COLUMNS.created);
  const stateC = col(COLUMNS.state);
  const items = new Map<number, PackItem>();
  for (const row of main.rows) {
    const id = cellNumber(row[idC]);
    if (id === null || id <= 0 || items.has(Math.round(id))) continue;
    items.set(Math.round(id), {
      id: Math.round(id),
      title: cellText(row[titleC]),
      project: projectC === -1 ? '' : cellText(row[projectC]),
      note: noteC === -1 ? '' : cellText(row[noteC]),
      created: (createdC === -1 ? null : cellDay(row[createdC])) ?? today,
      cancelled: stateC !== -1 && /zru[sš]|cancel/i.test(cellText(row[stateC])),
      steps: [],
      comments: [],
      shifts: [],
    });
  }

  const [si, so, ss] = stepsSheet.cols as [number, number, number];
  const ownerC = findColumn(stepsSheet.header, COLUMNS.owner);
  const dueC = findColumn(stepsSheet.header, COLUMNS.due);
  const doneC = findColumn(stepsSheet.header, COLUMNS.done);
  const ordered = new Map<number, { order: number; step: PackStep }[]>();
  for (const row of stepsSheet.rows) {
    const id = Math.round(cellNumber(row[si]) ?? -1);
    if (!items.has(id)) continue;
    const step: PackStep = {
      text: cellText(row[ss]),
      owner: ownerC === -1 ? '' : cellText(row[ownerC]),
      due: dueC === -1 ? null : cellDay(row[dueC]),
      done: doneC === -1 ? null : cellDay(row[doneC]),
    };
    ordered.set(id, [...(ordered.get(id) ?? []), { order: cellNumber(row[so]) ?? Infinity, step }]);
  }
  for (const [id, list] of ordered) items.get(id)!.steps = list.sort((a, b) => a.order - b.order).map((x) => x.step);

  const comments = findSheet(sheets, [COLUMNS.id, COLUMNS.at, COLUMNS.author, COLUMNS.text]);
  if (comments && comments.sheet !== main.sheet) {
    const [i, at, author, text] = comments.cols as [number, number, number, number];
    for (const row of comments.rows) {
      const item = items.get(Math.round(cellNumber(row[i]) ?? -1));
      if (item && cellText(row[text])) item.comments.push({ at: stampOf(row[at]), author: cellText(row[author]), text: cellText(row[text]) });
    }
  }
  const shifts = findSheet(sheets, [COLUMNS.id, COLUMNS.at, COLUMNS.from, COLUMNS.to]);
  if (shifts && shifts.sheet !== main.sheet) {
    const [i, at, from, to] = shifts.cols as [number, number, number, number];
    const authorC = findColumn(shifts.header, COLUMNS.author);
    const stepC = findColumn(shifts.header, COLUMNS.step);
    const reasonC = findColumn(shifts.header, COLUMNS.reason);
    for (const row of shifts.rows) {
      const item = items.get(Math.round(cellNumber(row[i]) ?? -1));
      const f = cellDay(row[from]);
      const t = cellDay(row[to]);
      if (item && f !== null && t !== null)
        item.shifts.push({
          at: stampOf(row[at]),
          author: authorC === -1 ? '' : cellText(row[authorC]),
          step: stepC === -1 ? '' : cellText(row[stepC]),
          from: f,
          to: t,
          reason: reasonC === -1 ? '' : cellText(row[reasonC]),
        });
    }
  }
  return { ok: true, value: { items: [...items.values()].sort((a, b) => a.id - b.id) }, source: 'app' };
}
