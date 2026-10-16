import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

/** Karta oblasti podle názvu. */
const card = (title: string) => screen.getAllByRole('link').find((a) => a.querySelector('.dash-card-title')?.textContent?.trim() === title)!;
const lines = (title: string) => [...card(title).querySelectorAll('.dash-lines li')].map((li) => li.textContent);

describe('DashboardPage', () => {
  afterEach(cleanup);

  it('karta za oblast: stav, hlavní číslo, nejnaléhavější položky', () => {
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
    // Zákazník: FG-L chybí zítra i s transitem (hoří), FG-R jen bez transitu.
    expect(card('Zákazník').className).toContain('dash-crit');
    expect(card('Zákazník').querySelector('.dash-main')!.textContent).toBe('1 dílů chybí dnes nebo zítra');
    expect(card('Zákazník').querySelector('.dash-counters')!.textContent).toBe('1 čeká na transit0 později');
    expect(lines('Zákazník')).toEqual(['FG-L P1zítra · 50 ks', 'FG-R P1 · čeká na transitzítra · 30 ks']);
    expect(card('Zákazník').getAttribute('href')).toBe('#coverage');
    // Pokrytí po projektech: P1 nepokrytý zítra (FG-L 50 ks), bez transitu také zítra (FG-R).
    const projectRow = screen.getByText('Pokrytí po projektech').closest('.panel')!.querySelector('tbody tr')!;
    expect(projectRow.textContent).toContain('P1');
    expect(projectRow.textContent).toContain('zítra');
    expect(projectRow.textContent).toContain('50 ks');
    // Komponenty bez kusovníku.
    expect(card('Komponenty').textContent).toContain('Kusovník není načtený.');
    // OIL: po termínu, termín do 7 dní, později; hotové ne.
    expect(card('OIL').className).toContain('dash-crit');
    expect(card('OIL').querySelector('.dash-counters')!.textContent).toBe('1 termín do 7 dní3 otevřených');
    expect(lines('OIL')).toEqual(['2 Po termínu · NákupPo 12. 10. · posun 1×', '3 Tento týden · KvalitaPá 16. 10.', '1 Později · LogistikaPá 30. 10.']);
    // Odvolávky a data.
    expect(lines('Odvolávky')[0]).toBe('FG-L +100 ks (+100 %)');
    expect(card('Data').className).toContain('dash-warn');
    expect(lines('Data')).toContain('Sklad Stock_1.csvstarý · 13. 10.');
    expect(screen.getByText(/hoří/).closest('.dash-summary')!.textContent).toContain('2 hoří');
  });
});
