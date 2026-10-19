import { describe, expect, it } from 'vitest';
import { dayFromParts } from './dates';
import {
  addDef,
  hasResults,
  dayState,
  defaultKpis,
  kpiSheets,
  kpiStatus,
  kpiValue,
  monthSummary,
  paretoOf,
  parseKpiWorkbook,
  previousWorkday,
  recentEntries,
  withEntry,
  withValues,
  type KpiData,
  type KpiDef,
} from './kpi';
import type { Cell } from './table';

const day = (d: number) => dayFromParts(2026, 10, d)!;
const def = (over: Partial<KpiDef>): KpiDef => ({ id: 'x', letter: 'D', name: 'X', unit: '', target: 0, red: 10, higherIsBetter: false, source: 'manual', categories: [], timing: 'result', ...over });
const texts = { names: { s_injury: 'Úrazy', q_claims: 'Reklamace' }, units: {}, categories: { q_claims: ['Záměna', 'Obal'], s_nearmiss: ['Skoronehoda'] } };

describe('stav ukazatele', () => {
  it('v cíli zelená, do hranice žlutá, za ní červená; bez hranice jen žlutá; i „více je lépe“', () => {
    const d = def({ target: 0, red: 10 });
    expect([0, 5, 10, 11].map((v) => kpiStatus(d, v))).toEqual(['green', 'yellow', 'yellow', 'red']);
    expect(kpiStatus(def({ target: 0, red: 0 }), 1)).toBe('red');
    expect(kpiStatus(def({ target: 0, red: null }), 99)).toBe('yellow');
    const up = def({ target: 95, red: 90, higherIsBetter: true });
    expect([100, 95, 92, 89].map((v) => kpiStatus(up, v))).toEqual(['green', 'green', 'yellow', 'red']);
  });

  it('hodnota s kategoriemi je součet kategorií', () => {
    const d = def({ id: 'q', categories: ['A', 'B'] });
    expect(kpiValue({ day: 0, author: '', at: '', values: { 'q|A': 2, 'q|B': 1 } }, d)).toBe(3);
    expect(kpiValue({ day: 0, author: '', at: '', values: {} }, d)).toBeNull();
    expect(kpiValue(undefined, d)).toBeNull();
  });
});

describe('kalendář po písmenech', () => {
  const base = defaultKpis(texts);
  // čt 1. 10. zapsáno v cíli, pá 2. 10. reklamace → Q červená, po 5. 10. skoronehoda → S žlutá
  let data: KpiData = withEntry(base, { day: day(1), author: 'A', at: '', values: { s_injury: 0, 'q_claims|Záměna': 0 } });
  data = withEntry(data, { day: day(2), author: 'A', at: '', values: { s_injury: 0, 'q_claims|Záměna': 1 } });
  data = withEntry(data, { day: day(5), author: 'A', at: '', values: { s_injury: 0, 's_nearmiss|Skoronehoda': 1, 'q_claims|Záměna': 0 } });
  const today = day(8);

  it('stav dne: barva ze zápisu, nezapsaný pracovní den, víkend a dny před prvním zápisem bez dat, budoucí', () => {
    expect(dayState(data, 'Q', day(1), today)).toBe('green');
    expect(dayState(data, 'Q', day(2), today)).toBe('red');
    expect(dayState(data, 'S', day(5), today)).toBe('yellow');
    expect(dayState(data, 'S', day(3), today)).toBe('weekend'); // sobota bez zápisu
    expect(dayState(data, 'S', day(6), today)).toBe('missing'); // út bez zápisu
    expect(dayState(data, 'S', day(8), today)).toBe('future');
    expect(dayState(data, 'S', day(30) - 30, today)).toBe('none'); // před prvním zápisem
    // písmeno bez zapsaných hodnot v zapsaném dni nemá barvu
    expect(dayState(data, 'C', day(1), today)).toBe('none');
  });

  it('víkend se zápisem má barvu', () => {
    const weekend = withEntry(data, { day: day(4), author: 'A', at: '', values: { s_injury: 1 } });
    expect(dayState(weekend, 'S', day(4), today)).toBe('red');
  });

  it('měsíc podle podílu zelených dní: ≥ 90 % zelená, ≥ 75 % žlutá, jinak červená', () => {
    expect(monthSummary(data, 'Q', 2026, 10)).toEqual({ days: 3, green: 2, status: 'red' });
    expect(monthSummary(data, 'S', 2026, 10)).toEqual({ days: 3, green: 2, status: 'red' });
    expect(monthSummary(data, 'S', 2026, 9).status).toBeNull();
    let many = base;
    for (let d = 1; d <= 10; d++) many = withEntry(many, { day: day(d), author: '', at: '', values: { s_injury: d === 10 ? 1 : 0 } });
    expect(monthSummary(many, 'S', 2026, 10)).toEqual({ days: 10, green: 9, status: 'green' });
    many = withEntry(many, { day: day(11), author: '', at: '', values: { s_injury: 1 } });
    many = withEntry(many, { day: day(12), author: '', at: '', values: { s_injury: 1 } });
    expect(monthSummary(many, 'S', 2026, 10).status).toBe('yellow');
  });

  it('zapisuje se předchozí pracovní den (v pondělí pátek)', () => {
    expect(previousWorkday(day(14))).toBe(day(13)); // st → út
    expect(previousWorkday(day(12))).toBe(day(9)); // po → pá
    expect(previousWorkday(day(11))).toBe(day(9)); // ne → pá
  });
});

describe('soubor KPI.xlsx', () => {
  it('ukazatele, hodnoty a dny se načtou zpět beze ztráty', () => {
    let data = defaultKpis(texts);
    data = addDef(data, 'C', 'Přesčasy');
    data = withEntry(data, { day: day(1), author: 'Novák', at: '2.10.2026 7:30', values: { s_injury: 0, 'q_claims|Záměna': 2, 'q_claims|Obal': 0, d_customer: 15 } });
    const sheets = kpiSheets(data).map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] }));
    expect(sheets.map((s) => s.name)).toEqual(['Ukazatele', 'Hodnoty', 'Dny', 'Detaily']);
    const back = parseKpiWorkbook(sheets);
    if (!back.ok) throw new Error();
    expect(back.value).toEqual(data);
    expect(back.value.defs.at(-1)).toMatchObject({ id: 'k11', letter: 'C', name: 'Přesčasy', red: null });
  });

  it('soubor bez potřebných sloupců', () => {
    expect(parseKpiWorkbook([{ name: 'List1', data: [['A', 'B']] }])).toMatchObject({ ok: false, error: 'missingColumns' });
  });
});

describe('grafy', () => {
  it('Pareto: kategorie i ukazatel bez kategorií sčítá, sestupně s kumulací', () => {
    let data: KpiData = {
      defs: [def({ id: 'q', letter: 'Q', name: 'Reklamace', categories: ['Záměna', 'Obal', 'Etiketa'] }), def({ id: 'late', letter: 'Q', name: 'Pozdě', target: 0, red: 5 })],
      entries: [],
      details: [],
    };
    data = withEntry(data, { day: day(1), author: '', at: '', values: { 'q|Záměna': 1, 'q|Obal': 3, late: 2 } });
    data = withEntry(data, { day: day(2), author: '', at: '', values: { 'q|Záměna': 2, late: 0 } });
    data = withEntry(data, { day: day(20), author: '', at: '', values: { 'q|Záměna': 9 } });
    const bars = paretoOf(data, 'Q', day(1), day(10));
    expect(bars.map((b) => [b.label, b.value])).toEqual([
      ['Záměna', 3],
      ['Obal', 3],
      ['Pozdě', 2],
    ]);
    expect(bars.map((b) => Math.round(b.cumulative * 100))).toEqual([38, 75, 100]);
    expect(paretoOf(data, 'S', day(1), day(31))).toEqual([]);
  });

  it('poslední zapsané dny písmene (dny bez hodnot písmene se přeskočí)', () => {
    const d = def({ id: 'c', letter: 'C', target: 0, red: 10 });
    let data: KpiData = { defs: [d], entries: [], details: [] };
    for (const n of [7, 1, 2, 5, 6]) data = withEntry(data, { day: day(n), author: '', at: '', values: { c: n } });
    data = withEntry(data, { day: day(8), author: '', at: '', values: {} });
    expect(recentEntries(data, 'C', day(6), 3).map((e) => e.day)).toEqual([day(2), day(5), day(6)]);
    expect(recentEntries(data, 'C', day(31), 7)).toHaveLength(5);
    expect(recentEntries(data, 'D', day(31), 7)).toEqual([]);
  });
});

describe('den hodnoty: výsledek dne a stav v den zápisu', () => {
  it('výchozí: ruční ukazatele výsledek dne, automatické stav v den zápisu', () => {
    const d = defaultKpis(texts).defs;
    expect(d.filter((x) => x.timing === 'state').map((x) => x.id)).toEqual(['d_customer', 'd_components', 'p_oil']);
  });

  it('zápis po částech: výsledky k jednomu dni, stav k druhému, ostatní hodnoty dne zůstanou', () => {
    let data = defaultKpis(texts);
    data = withValues(data, day(5), ['s_injury'], { s_injury: 1 }, 'A', 'ráno');
    data = withValues(data, day(6), ['d_customer'], { d_customer: 31 }, 'A', 'ráno');
    // další den se k 6. 10. dopíšou výsledky; stav zůstane
    data = withValues(data, day(6), ['s_injury'], { s_injury: 0 }, 'B', 'ráno');
    expect(data.entries.map((e) => [e.day, e.values, e.author])).toEqual([
      [day(5), { s_injury: 1 }, 'A'],
      [day(6), { d_customer: 31, s_injury: 0 }, 'B'],
    ]);
    expect(hasResults(data, day(5))).toBe(true);
    expect(hasResults(withValues(data, day(7), ['d_customer'], { d_customer: 1 }, 'A', ''), day(7))).toBe(false);
    // smazání všech hodnot dne odebere zápis
    expect(withValues(data, day(5), ['s_injury'], {}, 'A', '').entries.map((e) => e.day)).toEqual([day(6)]);
  });

  it('soubor: sloupec Den hodnoty se uloží a načte; starší soubor bez něj podle zdroje', () => {
    const data = defaultKpis(texts);
    const sheets = kpiSheets({ ...data, defs: data.defs.map((d) => (d.id === 's_injury' ? { ...d, timing: 'state' as const } : d)) });
    const defsSheet = sheets[0]!;
    expect(defsSheet.header.at(-1)).toBe('Den hodnoty');
    const parsed = parseKpiWorkbook(sheets.map((s) => ({ name: s.name, data: [s.header, ...s.rows] as Cell[][] })));
    if (!parsed.ok) throw new Error();
    expect(parsed.value.defs.filter((d) => d.timing === 'state').map((d) => d.id)).toEqual(['s_injury', 'd_customer', 'd_components', 'p_oil']);
    const old = parseKpiWorkbook([{ name: 'Ukazatele', data: [['ID', 'Písmeno', 'Ukazatel', 'Cíl', 'Zdroj'], ['a', 'S', 'A', 0, 'manual'], ['b', 'D', 'B', 0, 'coverageShortage']] }]);
    if (!old.ok) throw new Error();
    expect(old.value.defs.map((d) => d.timing)).toEqual(['result', 'state']);
  });
});
