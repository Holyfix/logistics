import { describe, expect, it } from 'vitest';
import { dayFromParts } from './dates';
import { defaultKpis, withDetails, withEntry, type KpiData, type KpiDetail } from './kpi';
import { letterSummary, nokGroups, nokPoints } from './kpiAnalysis';

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

  it('co se opakuje: dny, body a ukazatele podle projektu, dílu, osoby a příčiny', () => {
    const points = nokPoints(data, day(1), day(31), { letter: '', kpiId: '' });
    const summary = (dim: 'project' | 'item' | 'person' | 'cause') => nokGroups(points, dim).map((g) => [g.value, g.days.length, g.points, g.kpis.map((k) => k.id).join(',')]);
    expect(summary('project')).toEqual([
      ['P300', 3, 3, 'd_customer,d_linestop'],
      ['P100', 2, 2, 'd_customer'],
    ]);
    expect(summary('item')[0]).toEqual(['900101', 2, 2, 'd_customer']);
    // osoba „Nákup / Logistika“ patří k oběma; příčina bez rozdílu velikosti písmen
    expect(summary('person')).toEqual([
      ['Nákup', 2, 2, 'd_linestop'],
      ['Logistika', 1, 1, 'd_linestop'],
    ]);
    expect(summary('cause').slice(0, 2)).toEqual([
      ['Lokalita A', 2, 2, 'd_customer'],
      ['zpoždění dodavatele', 2, 2, 'd_linestop'],
    ]);
  });

  it('souhrn písmene: červené dny z pracovních dní období', () => {
    expect(letterSummary(data, 'D', day(5), day(11))).toEqual({ red: 4, off: 4, workdays: 5 });
  });
});
