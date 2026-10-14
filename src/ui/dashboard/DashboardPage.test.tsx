import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { parseCallOffExport, type CallOffExport } from '../../core/calloffs/parse';
import type { CoverageSource } from '../../core/coverage/compute';
import { parseCsv } from '../../core/csv';
import { dayFromParts } from '../../core/dates';
import { parseMasterData } from '../../core/masterdata';
import { parseStock } from '../../core/stock';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { OilProvider } from '../oil/OilProvider';
import { DashboardPage } from './DashboardPage';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const master = parseMasterData(parseCsv('Item Number;Customer Number;Project\nFG-L;;P1\nFG-R;;P1'));
const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nFG-L;A-01;SALE;20'));
if (!master.ok || !stock.ok) throw new Error();

function exportOf(name: string, rows: [string, string, number][]): CallOffExport {
  const r = parseCallOffExport(parseCsv(['Item Number,Date,Discrete Qty', ...rows.map((r) => r.join(','))].join('\n')), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const row = (item: string, balance: number[], transit: number) => ({
  customerNumber: '',
  customerKey: '',
  supplierItem: item,
  description: '',
  customerStock: 0,
  balance,
  transit: balance.map(() => transit),
  firstUncovered: '',
  uncoveredAt: '',
});
// FG-L chybí zítra i s transitem; FG-R chybí zítra jen bez transitu.
const now = Date.UTC(2026, 9, 14, 10);
const coverage = {
  path: 'Coverage/Lokalita A/P1/c.xlsx',
  fileName: 'c.xlsx',
  location: 'Lokalita A',
  project: 'P1',
  lastModified: now - 2 * 3_600_000,
  report: { format: 'articles', sheet: 'articles', days: [14, 15, 16].map(day), rows: [row('FG-L', [10, -50, -50], 0), row('FG-R', [10, -30, -30], 40)], issueCount: 0, issues: [] },
} as CoverageSource;

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: {
    folderName: 'data',
    exports: [exportOf('CW41.csv', [['FG-L', '12.10.2026', 100]]), exportOf('CW42.csv', [['FG-L', '12.10.2026', 200]])],
    master: { path: 'Item_Mapping.csv', data: master.value },
    coverage: [coverage],
    stock: { path: 'Stock_1.csv', lastModified: now - 30 * 3_600_000, data: stock.value },
    boms: [],
    plans: [],
    planSettings: null,
    oil: {
      path: 'OIL/OIL.xlsx',
      lastModified: now,
      list: {
        items: [
          { id: 1, problem: 'Později', action: '', owner: 'Logistika', opened: day(1), due: day(30), progress: 0, cancelled: false, closed: null, comments: [], shifts: [] },
          { id: 2, problem: 'Po termínu', action: '', owner: 'Nákup', opened: day(1), due: day(12), progress: 25, cancelled: false, closed: null, comments: [], shifts: [{ at: '', author: '', from: day(9), to: day(12), reason: 'x' }] },
          { id: 3, problem: 'Tento týden', action: '', owner: 'Kvalita', opened: day(1), due: day(16), progress: 50, cancelled: false, closed: null, comments: [], shifts: [] },
          { id: 4, problem: 'Hotovo', action: '', owner: '', opened: day(1), due: day(2), progress: 100, cancelled: false, closed: day(2), comments: [], shifts: [] },
        ],
      },
    },
    failed: [],
    loadedAt: 1,
  },
};

const kpi = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains('kpi-label'))!.closest('.kpi')!;

describe('DashboardPage', () => {
  afterEach(cleanup);

  it('dlaždice a seznamy', () => {
    localStorage.setItem('logistics-locale', 'cs');
    render(
      <I18nProvider>
        <DataProvider initial={state}>
          <OilProvider>
            <DashboardPage today={day(14)} now={now} />
          </OilProvider>
        </DataProvider>
      </I18nProvider>,
    );
    expect(kpi('Coverage').querySelector('.kpi-value')!.textContent).toBe('1 ');
    expect(kpi('Coverage').textContent).toContain('čeká na transit 1');
    expect(kpi('Komponenty').textContent).toContain('Kusovník není načtený.');
    expect(kpi('Čerstvost dat').textContent).toContain('Sklad');

    const panel = screen.getByRole('heading', { name: 'Kritické díly u zákazníka' }).closest('.panel') as HTMLElement;
    const rows = [...panel.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      [' FG-L', 'P1Lokalita A', 'zítra', '50 ks'],
      [' FG-Rčeká na transit', 'P1Lokalita A', 'zítra', '30 ks'],
    ]);
    expect(kpi('OIL').querySelector('.kpi-value')!.textContent).toBe('1 ');
    expect(kpi('OIL').textContent).toContain('termín do 7 dní 1 · otevřených 3');
    const oil = screen.getByRole('heading', { name: 'OIL: nejbližší termíny' }).closest('.panel') as HTMLElement;
    expect([...oil.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[1]!.textContent)).toEqual(['Po termínu', 'Tento týden', 'Později']);
    expect(within(oil).getByText('posunuto 1×')).toBeTruthy();

    const changes = screen.getByRole('heading', { name: 'Změny v odvolávkách' }).closest('.panel') as HTMLElement;
    expect(within(changes).getByText('+100')).toBeTruthy();

  });
});
