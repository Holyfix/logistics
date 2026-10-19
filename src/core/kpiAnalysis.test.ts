import { describe, expect, it } from 'vitest';
import { dayFromParts } from './dates';
import { defaultKpis, withDetails, withEntry, type KpiData, type KpiDetail } from './kpi';
import { detailGroups, letterDays, letterSummary, nokPoints, offKpis, type DetailGroup } from './kpiAnalysis';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const texts = { names: { d_linestop: 'Zastavení linky', d_customer: 'Chybí u zákazníka' }, units: {}, categories: {} };
const detail = (n: number, kpiId: string, over: Partial<KpiDetail>): KpiDetail => ({ day: day(n), kpiId, project: '', item: '', person: '', qty: null, cause: '', source: 'manual', ...over });

let data: KpiData = defaultKpis(texts);
for (const [n, linestop, customer] of [[6, 25, 0], [7, 0, 12], [8, 40, 0], [9, 0, 31]] as const)
  data = withEntry(data, { day: day(n), author: '', at: '', values: { d_linestop: linestop, d_customer: customer } });
data = withDetails(data, day(6), ['d_linestop'], [detail(6, 'd_linestop', { project: 'P300', item: 'K-1002', person: 'Nákup', qty: 25, cause: 'Zpoždění dodavatele' })]);
data = withDetails(data, day(8), ['d_linestop'], [detail(8, 'd_linestop', { project: 'P300', item: 'K-1002', person: 'Nákup / Logistika', qty: 40, cause: 'zpoždění dodavatele' })]);
data = withDetails(data, day(7), ['d_customer'], [detail(7, 'd_customer', { project: 'P100', item: '900101', qty: 12, cause: 'Lokalita A', source: 'auto' })]);
data = withDetails(data, day(9), ['d_customer'], [
  detail(9, 'd_customer', { project: 'P100', item: '900101', qty: 18, cause: 'Lokalita A', source: 'auto' }),
  detail(9, 'd_customer', { project: 'P300', item: '900111', qty: 13, cause: 'Lokalita B', source: 'auto' }),
]);

describe('rozbor KPI', () => {
  it('body mimo cíl za období s detaily, od nejnovějšího', () => {
    const points = nokPoints(data, day(6), day(12), { letter: 'D', kpiId: '' });
    expect(points.map((p) => [p.day, p.def.id, p.value, p.status, p.details.length])).toEqual([
      [day(9), 'd_customer', 31, 'red', 2],
      [day(8), 'd_linestop', 40, 'red', 1],
      [day(7), 'd_customer', 12, 'red', 1],
      [day(6), 'd_linestop', 25, 'red', 1],
    ]);
    expect(nokPoints(data, day(6), day(7), { letter: '', kpiId: 'd_linestop' }).map((p) => p.day)).toEqual([day(6)]);
  });

  it('ukazatele mimo cíl: dny s nejhorším stavem a body', () => {
    const off = offKpis(nokPoints(data, day(1), day(31), { letter: '', kpiId: '' }));
    expect(off.map((k) => [k.def.id, [...k.days.keys()].sort((a, b) => a - b), k.points.length])).toEqual([
      ['d_customer', [day(7), day(9)], 2],
      ['d_linestop', [day(6), day(8)], 2],
    ]);
  });

  it('skupiny ukazatele: projekt → díly s dny a nejvyšším množstvím; osoby a projekty se rozdělí', () => {
    const points = nokPoints(data, day(1), day(31), { letter: '', kpiId: '' });
    const customer = points.filter((p) => p.def.id === 'd_customer');
    const linestop = points.filter((p) => p.def.id === 'd_linestop');
    const summary = (groups: DetailGroup[]) => groups.map((g) => [g.value, g.days.size, g.maxQty, g.items.map((i) => `${i.label}|${i.note}|${i.days.length}|${i.maxQty}`)]);
    expect(summary(detailGroups(customer, 'project'))).toEqual([
      ['P100', 2, 18, ['900101|Lokalita A|2|18']],
      ['P300', 1, 13, ['900111|Lokalita B|1|13']],
    ]);
    expect(summary(detailGroups(linestop, 'person')).map((g) => [g[0], g[1]])).toEqual([
      ['Nákup', 2],
      ['Logistika', 1],
    ]);
    // příčina bez rozdílu velikosti písmen; díl s poznámkou
    expect(summary(detailGroups(linestop, 'cause'))).toEqual([['zpoždění dodavatele', 2, 40, ['K-1002|zpoždění dodavatele · P300 · Nákup / Logistika|2|40']]]);
    // dodavatel z mapování; bez něj skupina bez údaje
    expect(summary(detailGroups(linestop, 'supplier', (item) => (item === 'K-1002' ? 'Alfa' : ''))).map((g) => [g[0], g[1]])).toEqual([['Alfa', 2]]);
    expect(detailGroups(linestop, 'supplier').map((g) => g.value)).toEqual(['']);
  });

  it('bod bez detailu patří do skupiny bez údaje (na konci)', () => {
    const withBare = withEntry(data, { day: day(12), author: '', at: '', values: { d_linestop: 30 } });
    const groups = detailGroups(nokPoints(withBare, day(1), day(31), { letter: '', kpiId: 'd_linestop' }), 'project');
    expect(groups.map((g) => [g.value, g.days.size, g.items.length])).toEqual([
      ['P300', 2, 1],
      ['', 1, 0],
    ]);
  });

  it('souhrn písmene: červené dny z pracovních dní období', () => {
    expect(letterSummary(data, 'D', day(5), day(11))).toEqual({ red: 4, off: 4, workdays: 5 });
  });

  it('stav písmene po dnech: barva zápisu, nezapsaný pracovní den, víkend, budoucnost', () => {
    expect(letterDays(data, 'D', day(5), day(11), day(10)).map((d) => d.state)).toEqual(['missing', 'red', 'red', 'red', 'red', 'weekend', 'future']);
  });
});
