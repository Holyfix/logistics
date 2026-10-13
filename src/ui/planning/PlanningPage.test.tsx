import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CoverageSource } from '../../core/coverage/compute';
import { parseCsv } from '../../core/csv';
import { dayFromParts } from '../../core/dates';
import { parseMasterData } from '../../core/masterdata';
import { parseStock } from '../../core/stock';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { PlanningPage } from './PlanningPage';
import { PlanningProvider } from './PlanningProvider';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const master = parseMasterData(parseCsv('Item Number;Customer Number;Project;Variant;Line\nFG-L;A1234567890  00001234;P1;LHD;ASSEMBLY\nFG-R;;P1;RHD;Montáž\nK1;;;;'));
const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nFG-L;A-01;SALE;20'));
if (!master.ok || !stock.ok) throw new Error();
// Coverage od sekvencéra: FG-L chybí od čt 15. 10. 80 ks, FG-R od pá 16. 10. 30 ks.
const covDays = [13, 14, 15, 16, 19].map(day);
const row = (item: string, balance: number[]) => ({
  customerNumber: '',
  customerKey: '',
  supplierItem: item,
  description: '',
  customerStock: 0,
  balance,
  transit: balance.map(() => 0),
  firstUncovered: '',
  uncoveredAt: '',
});
const coverage = {
  path: 'Coverage/Lokalita A/P1/c.xlsx',
  fileName: 'c.xlsx',
  location: 'Lokalita A',
  project: 'P1',
  lastModified: 0,
  report: { format: 'articles', sheet: 'articles', days: covDays, rows: [row('FG-L', [10, 0, -80, -80, -80]), row('FG-R', [50, 20, 0, -30, -30])], issueCount: 0, issues: [] },
} as CoverageSource;

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: {
    folderName: 'data',
    exports: [],
    master: { path: 'Item_Mapping.csv', data: master.value },
    coverage: [coverage],
    stock: { path: 'Stock_1.csv', lastModified: 0, data: stock.value },
    boms: [],
    plans: [],
    planSettings: {
      path: 'Plan/Kapacity.xlsx',
      lastModified: 0,
      settings: { firstShiftStart: 360, lines: [{ line: 'ASSEMBLY', project: 'P1', perShift: 100, shifts: ['R', 'O', 'N'] }], destinations: [] },
    },
    failed: [],
    loadedAt: 1,
  },
};

function renderPage() {
  localStorage.setItem('logistics-locale', 'cs');
  // Pondělí 12. 10. v 5:00, před ranní směnou.
  return render(
    <I18nProvider>
      <DataProvider initial={state}>
        <PlanningProvider>
          <PlanningPage today={day(12)} now={day(12) * 1440 + 300} />
        </PlanningProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

const input = (label: string) => screen.getByRole('textbox', { name: label }) as HTMLInputElement;
const kpi = (label: string) => screen.getByText(label).parentElement!.querySelector('.kpi-value')!.textContent;

describe('PlanningPage', () => {
  afterEach(cleanup);

  it('přehled linek: chybějící kusy podle coverage a pokrytí s plánem', () => {
    renderPage();
    const tr = screen.getByRole('button', { name: 'P1' }).closest('tr')!;
    const texts = [...tr.querySelectorAll('td')].map((td) => td.textContent);
    // FG-L chybí 80 − sklad 20 = 60 ks, FG-R 30 ks; bez plánu je zákazník pokrytý do středy.
    expect(texts).toEqual(['ASSEMBLY', 'P1', '90', '0', '0 %', '2 / 2', 'St 14. 10.', 'Zatím neuloženo']);
    expect(within(screen.getByRole('table')).getByText('FOA').closest('tr')!.textContent).toContain('připravujeme');
  });

  it('plán na zbývající směny dneška a zítřek, návrh podle prvních chybějících dnů a ruční úprava', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'P1' }));
    expect(screen.getByRole('tab', { name: 'ASSEMBLY' }).getAttribute('aria-selected')).toBe('true');
    expect(kpi('Díly s chybějícími kusy')).toBe('2');
    // Jen dnes a zítra: 6 směn.
    expect(document.querySelectorAll('th.plan-shift').length).toBe(6);
    const fgL = input('FG-L Po 12. 10. R').closest('tr')!;
    expect([...fgL.querySelectorAll('td')].slice(1, 6).map((td) => td.textContent)).toEqual(['LHD', '20', '60', 'Čt 15. 10.', 'St 14. 10.']);

    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout plán' }));
    // Ranní směna: nejdřív FG-L (chybí od čtvrtka), pak FG-R (od pátku).
    expect(input('FG-L Po 12. 10. R').value).toBe('60');
    expect(input('FG-R Po 12. 10. R').value).toBe('30');
    expect(input('FG-L Út 13. 10. R').value).toBe('');
    expect(kpi('Odeslání po termínu')).toBe('0');
    expect(screen.getAllByText('celý soubor coverage').length).toBe(2);
    expect(screen.getAllByText('Neuložené změny').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'ASSEMBLY •' })).toBeTruthy();

    // Méně kusů FG-R: zákazník pokrytý do čtvrtka a odeslání do st 6:00 nestihne.
    fireEvent.change(input('FG-R Po 12. 10. R'), { target: { value: '10' } });
    expect(kpi('Odeslání po termínu')).toBe('1');
    expect(within(input('FG-R Po 12. 10. R').closest('tr')!).getByText('Čt 15. 10.')).toBeTruthy();
  });

  it('ručně zadaná kapacita směny a kapacity linek', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'ASSEMBLY' }));
    fireEvent.change(input('Kapacita směny Út 13. 10. R'), { target: { value: '80' } });
    expect(input('Kapacita směny Út 13. 10. R').closest('td')!.className).toContain('cell-manual');

    fireEvent.click(screen.getByRole('tab', { name: /Kapacity/ }));
    fireEvent.change(input('Ks za směnu ASSEMBLY P1'), { target: { value: '120' } });
    expect(screen.getByRole('tab', { name: 'Kapacity •' })).toBeTruthy();
    expect(screen.getByText('Lokalita A')).toBeTruthy();
  });
});
