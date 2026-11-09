// Launch: náběh nových projektů – projekty, fáze, úkoly a milníky s termínem, odpovědným a plněním.
// Ukládá se jako Excel do složky Launch ve sdílené složce (list úkolů a milníků a list projektů).

import { findColumn } from './csv';
import { dayFromParts, dayToIso, type DayNumber } from './dates';
import { cellDay, cellNumber, cellText, type Cell } from './table';

/** task = úkol s začátkem a koncem (pruh), milestone = milník k jednomu dni (kosočtverec). */
export type LaunchKind = 'task' | 'milestone';

export interface LaunchItem {
  /** Číslo řádku (1, 2, 3 …), nemění se. */
  id: number;
  project: string;
  /** Fáze v projektu (např. Produkční testy, Kvalita, SOP); prázdná = přímo pod projektem. */
  phase: string;
  name: string;
  kind: LaunchKind;
  /** Začátek úkolu; u milníku null. */
  start: DayNumber | null;
  /** Konec úkolu nebo den milníku; null = zatím bez termínu. */
  end: DayNumber | null;
  /** Původní termín před prvním posunem; null = termín se neposunul. */
  baseline: DayNumber | null;
  owner: string;
  /** Zákaznický termín (z plánu zákazníka, plnění neovlivníme) – jinak interní úkol či milník. */
  customer: boolean;
  /** Milník, ke kterému bod vede (od teď do milníku); termín se drží termínu milníku. null = samostatný řádek. */
  parent: number | null;
  /** Plnění 0–100 %; u zákaznických termínů se nepočítá. */
  progress: number;
  note: string;
}

export interface LaunchProject {
  name: string;
  description: string;
}

export interface LaunchPlan {
  projects: LaunchProject[];
  items: LaunchItem[];
}

export const emptyLaunch = (): LaunchPlan => ({ projects: [], items: [] });

/**
 * Stav interního řádku podle plnění: done = 100 %, overdue = po termínu, advanced = 50–99 %, started = 1–49 %,
 * open = 0 %, nodate = bez termínu. Zákaznický termín má vždy customer (barva podle fáze, plnění neovlivníme).
 */
export type LaunchStatus = 'done' | 'overdue' | 'advanced' | 'started' | 'open' | 'nodate' | 'customer';

/** Stavy interních řádků v pořadí pro legendu. */
export const INTERNAL_STATUSES = ['overdue', 'open', 'started', 'advanced', 'done'] as const;

const band = (progress: number): LaunchStatus => (progress >= 100 ? 'done' : progress >= 50 ? 'advanced' : progress > 0 ? 'started' : 'open');

export function statusOf(item: LaunchItem, today: DayNumber): LaunchStatus {
  if (item.customer) return 'customer';
  if (item.progress >= 100) return 'done';
  if (item.end === null) return 'nodate';
  if (item.end < today) return 'overdue';
  return band(item.progress);
}

export const internalOf = (items: readonly LaunchItem[]) => items.filter((i) => !i.customer);

/** Stav skupiny (projekt, fáze) z interních řádků: po termínu, když je něco po termínu, jinak podle průměrného plnění. */
export function groupStatus(items: readonly LaunchItem[], today: DayNumber): LaunchStatus {
  const internal = internalOf(items);
  if (internal.length === 0) return 'customer';
  const states = internal.map((i) => statusOf(i, today));
  if (states.includes('overdue')) return 'overdue';
  if (states.every((s) => s === 'nodate')) return 'nodate';
  return band(progressOf(internal) ?? 0);
}

/** Zákaznický termín, který už proběhl. */
export const isPassed = (item: LaunchItem, today: DayNumber) => item.customer && item.end !== null && item.end < today;

/** Posun termínu ve dnech proti původnímu (kladný = později); 0 bez posunu. */
export const shiftDays = (item: LaunchItem) => (item.baseline === null || item.end === null ? 0 : item.end - item.baseline);

/** Od kdy do kdy skupina trvá (začátky úkolů a termíny); null, když nemá žádné datum. */
export function spanOf(items: readonly LaunchItem[]): { start: DayNumber; end: DayNumber } | null {
  const days = items.flatMap((i) => [i.start, i.end]).filter((d): d is DayNumber => d !== null);
  return days.length ? { start: Math.min(...days), end: Math.max(...days) } : null;
}

/** Plnění skupiny: průměr plnění interních úkolů a milníků (zaokrouhleno); null, když interní nemá. */
export function progressOf(items: readonly LaunchItem[]): number | null {
  const internal = internalOf(items);
  return internal.length ? Math.round(internal.reduce((s, i) => s + i.progress, 0) / internal.length) : null;
}

/**
 * Jak daleko jsou termíny zákazníka podle data: kolik procent doby od prvního do posledního termínu už uplynulo
 * (0 % před prvním, 100 % po posledním). Plnění zákaznických termínů neovlivníme, proto se počítá jen z kalendáře.
 */
export function timeProgress(items: readonly LaunchItem[], today: DayNumber): number | null {
  const span = spanOf(items);
  if (!span) return null;
  if (today < span.start) return 0;
  if (today >= span.end) return 100;
  return Math.round(((today - span.start) / (span.end - span.start)) * 100);
}

/** Barva zákaznických termínů podle fáze: pořadí fáze se zákaznickými termíny v projektu (0, 1, 2 …). */
export function customerColors(items: readonly LaunchItem[]): Map<string, number> {
  const colors = new Map<string, number>();
  for (const g of phasesOf(items.filter((i) => i.customer))) colors.set(g.phase, colors.size);
  return colors;
}

/** Datum, podle kterého se řadí (začátek úkolu, jinak termín); bez data na konec. */
const sortDay = (i: LaunchItem) => i.start ?? i.end ?? Infinity;

/** Fáze projektu v pořadí podle nejdřívějšího data (fáze bez dat na konci, prázdná fáze jako ostatní). */
export function phasesOf(items: readonly LaunchItem[]): { phase: string; items: LaunchItem[] }[] {
  const groups = new Map<string, LaunchItem[]>();
  for (const item of [...items].sort((a, b) => sortDay(a) - sortDay(b) || (a.end ?? Infinity) - (b.end ?? Infinity) || a.id - b.id)) {
    const list = groups.get(item.phase) ?? [];
    list.push(item);
    groups.set(item.phase, list);
  }
  return [...groups].map(([phase, list]) => ({ phase, items: list }));
}

// --- Úpravy ---

const nextId = (plan: LaunchPlan) => Math.max(0, ...plan.items.map((i) => i.id)) + 1;

/** Nový projekt s volným názvem („Nový projekt“, „Nový projekt 2“ …). */
export function addProject(plan: LaunchPlan, base: string): { plan: LaunchPlan; name: string } {
  let name = base;
  for (let n = 2; plan.projects.some((p) => p.name === name); n++) name = `${base} ${n}`;
  return {
    plan: { ...plan, projects: [...plan.projects, { name, description: '' }] },
    name,
  };
}

/** Přejmenování projektu i u jeho řádků; prázdný nebo už použitý název se nepřijme (null). */
export function renameProject(plan: LaunchPlan, from: string, to: string): LaunchPlan | null {
  const name = to.trim();
  if (!name || (name !== from && plan.projects.some((p) => p.name === name))) return null;
  return {
    projects: plan.projects.map((p) => (p.name === from ? { ...p, name } : p)),
    items: plan.items.map((i) => (i.project === from ? { ...i, project: name } : i)),
  };
}

export function updateProject(plan: LaunchPlan, name: string, change: (p: LaunchProject) => LaunchProject): LaunchPlan {
  return {
    ...plan,
    projects: plan.projects.map((p) => (p.name === name ? change(p) : p)),
  };
}

/** Smaže projekt i se všemi úkoly a milníky. */
export function removeProject(plan: LaunchPlan, name: string): LaunchPlan {
  return {
    projects: plan.projects.filter((p) => p.name !== name),
    items: plan.items.filter((i) => i.project !== name),
  };
}

/**
 * Nový úkol (od dneška na 2 týdny) nebo milník (dnes) v projektu; interní, pokud se neřekne jinak. Fáze jako
 * u posledního řádku projektu stejného druhu (zákaznický / interní).
 */
export function addItem(plan: LaunchPlan, project: string, kind: LaunchKind, today: DayNumber, customer = false): { plan: LaunchPlan; id: number } {
  const id = nextId(plan);
  const last = plan.items.filter((i) => i.project === project && i.customer === customer).at(-1);
  const item: LaunchItem = {
    id,
    project,
    phase: last?.phase ?? '',
    name: '',
    kind,
    start: kind === 'task' ? today : null,
    end: kind === 'task' ? today + 13 : today,
    baseline: null,
    owner: '',
    customer,
    parent: null,
    progress: 0,
    note: '',
  };
  return { plan: { ...plan, items: [...plan.items, item] }, id };
}

/**
 * Vlastní bod k milníku: interní úkol od dneška (nejpozději od termínu milníku) do termínu milníku, ve stejné fázi.
 * Termín bodu se pak drží termínu milníku. Bez milníku s termínem se nic nepřidá (null).
 */
export function addLinked(plan: LaunchPlan, parentId: number, today: DayNumber): { plan: LaunchPlan; id: number } | null {
  const parent = plan.items.find((i) => i.id === parentId);
  if (!parent || parent.kind !== 'milestone' || parent.end === null) return null;
  const id = nextId(plan);
  const item: LaunchItem = {
    id,
    project: parent.project,
    phase: parent.phase,
    name: '',
    kind: 'task',
    start: Math.min(today, parent.end),
    end: parent.end,
    baseline: null,
    owner: '',
    customer: false,
    parent: parent.id,
    progress: 0,
    note: '',
  };
  return { plan: { ...plan, items: [...plan.items, item] }, id };
}

/** Body navázané na milníky: ID milníku → body (podle začátku). */
export function linkedItems(items: readonly LaunchItem[]): Map<number, LaunchItem[]> {
  const map = new Map<number, LaunchItem[]>();
  for (const item of [...items].sort((a, b) => (a.start ?? a.end ?? Infinity) - (b.start ?? b.end ?? Infinity) || a.id - b.id)) {
    if (item.parent === null) continue;
    map.set(item.parent, [...(map.get(item.parent) ?? []), item]);
  }
  return map;
}

/** Úprava řádku; posun termínu milníku posune i termín bodů, které na něj navazují. */
export function updateItem(plan: LaunchPlan, id: number, change: (item: LaunchItem) => LaunchItem): LaunchPlan {
  const before = plan.items.find((i) => i.id === id);
  const after = before ? change(before) : null;
  const moved = before && after && after.kind === 'milestone' && after.end !== null && after.end !== before.end;
  return {
    ...plan,
    items: plan.items.map((i) => (i.id === id ? after! : moved && i.parent === id ? withEnd(i, after.end) : i)),
  };
}

/** Smaže řádek; body navázané na smazaný milník zůstanou jako samostatné řádky. */
export function removeItem(plan: LaunchPlan, id: number): LaunchPlan {
  return { ...plan, items: plan.items.filter((i) => i.id !== id).map((i) => (i.parent === id ? { ...i, parent: null } : i)) };
}

/** Nový termín; první změna existujícího termínu si zapamatuje původní termín (návrat na něj posun zruší). */
export function withEnd(item: LaunchItem, end: DayNumber | null): LaunchItem {
  if (end === item.end) return item;
  const baseline = item.baseline ?? (item.end !== null && end !== null ? item.end : null);
  const start = item.start !== null && end !== null && item.start > end ? end : item.start;
  return { ...item, end, start, baseline: baseline === end ? null : baseline };
}

/** Nový začátek úkolu; začátek po konci posune konec (jako posun termínu). */
export function withStart(item: LaunchItem, start: DayNumber | null): LaunchItem {
  const next = { ...item, start };
  return start !== null && item.end !== null && start > item.end ? withEnd(next, start) : next;
}

/** Změna typu: milník nemá začátek, úkol dostane začátek v den termínu. */
export function withKind(item: LaunchItem, kind: LaunchKind): LaunchItem {
  if (kind === item.kind) return item;
  return {
    ...item,
    kind,
    start: kind === 'milestone' ? null : (item.end ?? item.start),
  };
}

export const clampProgress = (value: number) => Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));

// --- Časová osa ---

export type LaunchScale = 'week' | 'month' | 'quarter';

/** Šířka dne v pixelech podle měřítka. */
export const DAY_WIDTH: Record<LaunchScale, number> = {
  week: 14,
  month: 5,
  quarter: 1.6,
};

const ymd = (day: DayNumber) => {
  const [y, m, d] = dayToIso(day).split('-').map(Number) as [number, number, number];
  return { y, m, d };
};
export const monthStart = (day: DayNumber) => {
  const { y, m } = ymd(day);
  return dayFromParts(y, m, 1)!;
};
/** První den následujícího měsíce. */
export const nextMonth = (day: DayNumber) => {
  const { y, m } = ymd(day);
  return m === 12 ? dayFromParts(y + 1, 1, 1)! : dayFromParts(y, m + 1, 1)!;
};

/** Rozsah osy: celé měsíce od nejdřívějšího po nejpozdější datum, vždy včetně dneška (a týden rezervy na obou stranách). */
export function timelineRange(items: readonly LaunchItem[], today: DayNumber): { from: DayNumber; to: DayNumber } {
  const span = spanOf(items);
  const first = Math.min(span?.start ?? today, today) - 7;
  const last = Math.max(span?.end ?? today, today) + 7;
  return { from: monthStart(first), to: nextMonth(last) };
}

// --- Soubor Launch.xlsx ---

const COLUMNS = {
  id: ['ID', 'Číslo', 'No.'],
  project: ['Projekt', 'Project'],
  phase: ['Fáze', 'Phase'],
  name: ['Název', 'Úkol', 'Name', 'Task'],
  kind: ['Typ', 'Type'],
  start: ['Začátek', 'Start'],
  end: ['Konec / termín', 'Termín', 'Konec', 'End', 'Due'],
  baseline: ['Původní termín', 'Baseline'],
  owner: ['Odpovědný', 'Owner', 'Responsible'],
  source: ['Zdroj', 'Source'],
  parent: ['Navazuje na', 'Linked to'],
  progress: ['Plnění (%)', 'Plnění', 'Progress'],
  status: ['Stav', 'Status'],
  note: ['Poznámka', 'Note'],
  description: ['Popis', 'Description'],
} as const;

const KIND_TEXT: Record<LaunchKind, string> = {
  task: 'Úkol',
  milestone: 'Milník',
};
const STATUS_TEXT: Record<LaunchStatus, string> = {
  done: 'Hotovo',
  overdue: 'Po termínu',
  advanced: 'Rozpracováno 50–99 %',
  started: 'Rozpracováno 1–49 %',
  open: 'Nezahájeno',
  nodate: 'Bez termínu',
  customer: 'Termín zákazníka',
};
const SOURCE_TEXT = { customer: 'Zákazník', internal: 'Interní' };

const formatDate = (day: DayNumber | null) => {
  if (day === null) return null;
  const { y, m, d } = ymd(day);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
};

export interface LaunchSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

/** Listy souboru: „Launch“ (úkoly a milníky po projektech a fázích) a „Projekty“. Stav je jen pro čtení v Excelu. */
export function launchSheets(plan: LaunchPlan, today: DayNumber): LaunchSheet[] {
  const order = new Map(plan.projects.map((p, k) => [p.name, k]));
  const items = plan.projects.flatMap((p) => phasesOf(plan.items.filter((i) => i.project === p.name)).flatMap((g) => g.items));
  const orphans = plan.items.filter((i) => !order.has(i.project));
  return [
    {
      name: 'Launch',
      header: [
        COLUMNS.id[0],
        COLUMNS.project[0],
        COLUMNS.phase[0],
        COLUMNS.name[0],
        COLUMNS.kind[0],
        COLUMNS.start[0],
        COLUMNS.end[0],
        COLUMNS.baseline[0],
        COLUMNS.owner[0],
        COLUMNS.source[0],
        COLUMNS.parent[0],
        COLUMNS.progress[0],
        COLUMNS.status[0],
        COLUMNS.note[0],
      ],
      rows: [...items, ...orphans].map((i) => [
        i.id,
        i.project,
        i.phase || null,
        i.name,
        KIND_TEXT[i.kind],
        formatDate(i.start),
        formatDate(i.end),
        formatDate(i.baseline),
        i.owner || null,
        i.customer ? SOURCE_TEXT.customer : SOURCE_TEXT.internal,
        i.parent,
        i.customer ? null : i.progress,
        STATUS_TEXT[statusOf(i, today)],
        i.note || null,
      ]),
    },
    {
      name: 'Projekty',
      header: [COLUMNS.project[0], COLUMNS.description[0]],
      rows: plan.projects.map((p) => [p.name, p.description || null]),
    },
  ];
}

export type LaunchResult = { ok: true; value: LaunchPlan } | { ok: false; error: 'missingColumns'; columns: string[] };

const kindOf = (text: string): LaunchKind => (/^(mil|mile)/i.test(text.trim()) ? 'milestone' : 'task');

/** Načte Launch ze souboru; listy se hledají podle sloupců. Projekty bez listu Projekty se vezmou z řádků. */
export function parseLaunchWorkbook(sheets: readonly { name: string; data: Cell[][] }[]): LaunchResult {
  const find = (required: readonly (readonly string[])[]) => {
    for (const sheet of sheets) {
      const header = (sheet.data[0] ?? []).map((c) => cellText(c));
      const cols = required.map((a) => findColumn(header, a));
      if (cols.every((c) => c !== -1)) return { header, rows: sheet.data.slice(1), cols };
    }
    return null;
  };
  const required = [COLUMNS.id, COLUMNS.project, COLUMNS.name, COLUMNS.end];
  const main = find(required);
  if (!main)
    return {
      ok: false,
      error: 'missingColumns',
      columns: required.map((c) => c[0]),
    };
  const [idC, projectC, nameC, endC] = main.cols as [number, number, number, number];
  const col = (aliases: readonly string[]) => findColumn(main.header, aliases);
  const phaseC = col(COLUMNS.phase);
  const kindC = col(COLUMNS.kind);
  const startC = col(COLUMNS.start);
  const baselineC = col(COLUMNS.baseline);
  const ownerC = col(COLUMNS.owner);
  const sourceC = col(COLUMNS.source);
  const parentC = col(COLUMNS.parent);
  const progressC = col(COLUMNS.progress);
  const noteC = col(COLUMNS.note);
  const text = (c: number, row: Cell[]) => (c === -1 ? '' : cellText(row[c]));
  const day = (c: number, row: Cell[]) => (c === -1 ? null : cellDay(row[c]));

  const items: LaunchItem[] = [];
  const ids = new Set<number>();
  for (const row of main.rows) {
    const id = cellNumber(row[idC]);
    const project = cellText(row[projectC]);
    if (id === null || id <= 0 || ids.has(Math.round(id)) || !project) continue;
    ids.add(Math.round(id));
    const kind = kindOf(text(kindC, row));
    const end = cellDay(row[endC]);
    const baseline = day(baselineC, row);
    items.push({
      id: Math.round(id),
      project,
      phase: text(phaseC, row),
      name: cellText(row[nameC]),
      kind,
      start: kind === 'task' ? day(startC, row) : null,
      end,
      baseline: baseline === end ? null : baseline,
      owner: text(ownerC, row),
      // Bez sloupce Zdroj jsou milníky termíny zákazníka a úkoly interní.
      customer: sourceC === -1 ? kind === 'milestone' : /^(z[aá]k|cust)/i.test(text(sourceC, row)),
      parent: parentC === -1 ? null : cellNumber(row[parentC]),
      progress: clampProgress(progressC === -1 ? 0 : (cellNumber(row[progressC]) ?? 0)),
      note: text(noteC, row),
    });
  }

  // Navázat lze jen na milník ve stejném projektu (jinak samostatný řádek).
  for (const item of items) {
    const parent = items.find((i) => i.id === item.parent);
    if (!parent || parent === item || parent.kind !== 'milestone' || parent.project !== item.project) item.parent = null;
  }

  const projects: LaunchProject[] = [];
  const list = find([COLUMNS.project, COLUMNS.description]);
  if (list && list !== main) {
    const [p, d] = list.cols as [number, number];
    for (const row of list.rows) {
      const name = cellText(row[p]);
      if (name && !projects.some((x) => x.name === name)) projects.push({ name, description: cellText(row[d]) });
    }
  }
  for (const item of items) if (!projects.some((p) => p.name === item.project)) projects.push({ name: item.project, description: '' });
  return { ok: true, value: { projects, items } };
}

// --- Přehled ---

export interface LaunchSummary {
  projects: number;
  items: number;
  /** Nehotové interní úkoly a milníky s termínem v minulosti. */
  overdue: number;
  /** Nejbližší milník od dneška: zákaznický, nebo nehotový interní. */
  next: LaunchItem | null;
  /** Průměrné plnění interních úkolů a milníků; null bez interních. */
  progress: number | null;
}

export function launchSummary(plan: LaunchPlan, today: DayNumber): LaunchSummary {
  const next = plan.items.filter((i) => i.kind === 'milestone' && (i.customer || i.progress < 100) && i.end !== null && i.end >= today).sort((a, b) => a.end! - b.end! || a.id - b.id)[0];
  return {
    projects: plan.projects.length,
    items: plan.items.length,
    overdue: plan.items.filter((i) => statusOf(i, today) === 'overdue').length,
    next: next ?? null,
    progress: progressOf(plan.items),
  };
}
