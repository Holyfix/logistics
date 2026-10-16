import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseCallOffExport, type CallOffExport } from './calloffs/parse';
import type { ComponentLine, ComponentTable } from './components/compute';
import type { CoverageLine, CoverageTable } from './coverage/compute';
import { callOffDigest, componentAlerts, customerAlerts, dataFreshness, oilAlerts, projectCoverage } from './dashboard';
import { addItem, emptyOil, updateItem } from './oil';
import { dayFromParts } from './dates';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const TODAY = day(14);

const line = (id: string, values: (number | null)[]): CoverageLine =>
  ({ id, item: id, customerNumber: `C-${id}`, description: '', project: 'P1', location: 'L', values }) as CoverageLine;
const table = (lines: CoverageLine[]): CoverageTable => ({ days: [day(13), day(14), day(15), day(16), day(19)], lines });

describe('kritické díly u zákazníka', () => {
  it('od dneška: i s transitem dnes/zítra = hoří, jen bez transitu = čeká na transit, později = informace', () => {
    const withTransit = table([
      line('A', [-5, -10, -20, -20, -20]), // včerejšek se nepočítá, chybí od dneška
      line('B', [5, 5, 5, -30, -30]), // s transitem až v pátek
      line('C', [5, 5, 5, 5, 5]),
      line('D', [5, 5, 5, 5, 5]),
    ]);
    const withoutTransit = table([
      line('A', [-5, -10, -20, -20, -20]),
      line('B', [5, 5, -40, -40, -40]), // bez transitu zítra
      line('C', [5, 5, 5, 5, -1]), // bez transitu až později → nic
      line('D', [5, 5, 5, 5, 5]),
    ]);
    const alerts = customerAlerts(withTransit, withoutTransit, TODAY);
    expect(alerts.map((a) => [a.item, a.severity, a.day, a.missing, a.transitOnly])).toEqual([
      ['A', 'crit', day(14), 10, false],
      ['B', 'warn', day(15), 40, true],
    ]);
    const later = customerAlerts(table([line('E', [5, 5, 5, -3, -3])]), table([line('E', [5, 5, 5, -3, -3])]), TODAY);
    expect(later.map((a) => [a.severity, a.day, a.missing])).toEqual([['info', day(16), 3]]);
  });
});

describe('kritické komponenty', () => {
  it('do 2 dnů hoří, do týdne pozor, později informace; zákazník pokryt do', () => {
    const comp = (item: string, shortDay: number | null, customerShortDay: number | null = null) =>
      ({ item, description: '', balance: Array.from({ length: 14 }, (_, k) => (shortDay !== null && k >= shortDay ? -7 : 3)), shortDay, customerShortDay, products: ['FG'] }) as unknown as ComponentLine;
    const t: ComponentTable = {
      days: Array.from({ length: 14 }, (_, k) => TODAY + k),
      products: [],
      components: [comp('A', 9), comp('B', 1, 3), comp('C', null), comp('D', 4)],
      byMapping: true,
      markedNotInBom: [],
    };
    expect(componentAlerts(t).map((a) => [a.item, a.severity, a.day, a.missing, a.customerShortDay])).toEqual([
      ['B', 'crit', TODAY + 1, 7, TODAY + 3],
      ['D', 'warn', TODAY + 4, 7, null],
      ['A', 'info', TODAY + 9, 7, null],
    ]);
  });
});

function exportOf(name: string, rows: [string, string, number][]): CallOffExport {
  const r = parseCallOffExport(parseCsv(['Item Number,Date,Discrete Qty', ...rows.map((r) => r.join(','))].join('\n')), name);
  if (!r.ok) throw new Error();
  return r.value;
}

describe('změny v odvolávkách', () => {
  it('díly s významnou změnou, od největší; velká změna = pozor', () => {
    const prev = exportOf('CW41.csv', [
      ['A', '12.10.2026', 100],
      ['B', '12.10.2026', 100],
      ['C', '12.10.2026', 100],
    ]);
    const cur = exportOf('CW42.csv', [
      ['A', '12.10.2026', 200],
      ['B', '12.10.2026', 75],
      ['C', '12.10.2026', 105],
    ]);
    const d = callOffDigest(cur, prev);
    expect(d.previous).toEqual({ week: 41, year: 2026 });
    expect(d.changes).toBe(2);
    expect(d.alerts.map((a) => [a.item, a.severity, a.diff, a.changedWeeks])).toEqual([
      ['A', 'warn', 100, 1],
      ['B', 'info', -25, 1],
    ]);
    expect(callOffDigest(cur, undefined)).toMatchObject({ previous: null, changes: 0, alerts: [] });
  });
});

describe('pokrytí po projektech', () => {
  it('do kdy je projekt pokrytý a kolik dní, s transitem i bez', () => {
    const p = (project: string, l: CoverageLine): CoverageLine => ({ ...l, project });
    // Dny 13., 14. (dnes), 15., 16., 19.
    const withTransit = table([
      p('A', line('a1', [5, 5, 5, -3, -8])),
      p('A', line('a2', [5, 5, 4, -2, null])),
      p('B', line('b1', [9, -1, -4, -4, -4])),
      p('C', line('c1', [-5, 2, 2, 2, 2])),
      p('D', line('d1', [1, 1, 1, 1, -1])),
    ]);
    const withoutTransit = table(withTransit.lines.map((l) => (l.project === 'C' ? { ...l, values: [-5, 2, -1, -1, -1] } : l)));
    const result = projectCoverage(withTransit, withoutTransit, TODAY);
    expect(result.map((r) => [r.project, r.withTransit.until, r.withTransit.days, r.severity])).toEqual([
      ['B', null, 0, 'crit'],
      ['A', day(15), 2, null],
      ['D', day(16), 5, null],
      ['C', day(19), 6, null],
    ]);
    // C: s transitem celý horizont (14.–19. = 6 dní), bez transitu jen dnes.
    expect(result.find((r) => r.project === 'C')).toMatchObject({ withTransit: { whole: true }, withoutTransit: { until: day(14), days: 1, whole: false } });
  });
});

describe('OIL na dashboardu', () => {
  it('po termínu hoří, termín do 7 dní pozor, později nebo bez termínu informace; hotové a zrušené ne', () => {
    let list = emptyOil();
    for (let k = 0; k < 6; k++) list = addItem(list, day(1)).list;
    const set = (id: number, change: object) => (list = updateItem(list, id, (i) => ({ ...i, ...change })));
    set(1, { due: day(25) });
    set(2, { due: day(13) });
    set(3, { due: day(20) });
    set(4, { due: day(14), progress: 100 });
    set(5, { due: day(10), cancelled: true });
    set(6, { due: null });
    expect(oilAlerts(list, TODAY).map((a) => [a.item.id, a.severity])).toEqual([
      [2, 'crit'],
      [3, 'warn'],
      [1, 'info'],
      [6, 'info'],
    ]);
  });
});

describe('čerstvost dat', () => {
  it('sklad a coverage starší než 24 h, odvolávky z minulého týdne nebo chybějící soubory', () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const h = (hours: number) => now - hours * 3_600_000;
    const callOffs = exportOf('CW41.csv', [['A', '12.10.2026', 1]]);
    const list = dataFreshness({
      callOffs,
      coverage: [
        { location: 'L1', project: 'P1', fileName: 'a.xlsx', lastModified: h(2) },
        { location: 'L2', project: 'P2', fileName: 'b.xlsx', lastModified: h(30) },
      ],
      stock: { path: 'Sklad/Stock.csv', lastModified: h(5) },
      boms: [],
      master: null,
      today: day(19),
      now,
    });
    expect(list.map((f) => [f.kind, f.label, f.stale, f.missing])).toEqual([
      ['calloffs', 'CW41.csv', true, false],
      ['stock', 'Stock.csv', false, false],
      ['coverage', 'L1 / P1', false, false],
      ['coverage', 'L2 / P2', true, false],
      ['bom', '', false, true],
      ['master', '', true, true],
    ]);
  });
});
