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
// Coverage od sekvencéra (stav u zákazníka vč. transitu): FG-L chybí od čt 15. 10. 80 ks, FG-R od pá 16. 10. 30 ks.
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

  it('přehled linek: nepokryté díly a pokrytí zákazníka s plánem a bez něj', () => {
    renderPage();
    const tr = screen.getByRole('button', { name: 'P1' }).closest('tr')!;
    const texts = [...tr.querySelectorAll('td')].map((td) => td.textContent);
    // FG-L: zákazník + náš sklad 20 vydrží do středy (ve čtvrtek -60), FG-R do čtvrtka.
    expect(texts).toEqual(['ASSEMBLY', 'P1', '2 / 2', 'St 14. 10.bez plánu: St 14. 10.', '0', 'Zatím neuloženo']);
    expect(within(screen.getByRole('table')).getByText('FOA').closest('tr')!.textContent).toContain('připravujeme');
  });

  it('plán jako coverage: plán vlevo, kusy se přičtou do celé coverage, automatické směny podle strany', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'P1' }));
    expect(screen.getByRole('tab', { name: 'ASSEMBLY' }).getAttribute('aria-selected')).toBe('true');
    expect(kpi('Nepokryté díly')).toBe('2');
    expect(kpi('Pokryto do (nejhorší díl)')).toBe('St 14. 10.');
    // Výchozí 2 plánovací dny po směnách vlevo, vpravo coverage po dnech do 25. 10.
    expect(document.querySelectorAll('th.plan-shift').length).toBe(6);
    const row = (item: string) => input(`${item} Po 12. 10. R`).closest('tr')!;
    const cov = (item: string) => [...row(item).querySelectorAll('td.plan-cov')].slice(0, 5).map((td) => td.textContent);
    expect(row('FG-L').querySelectorAll('td.plan-cov').length).toBe(14);
    expect(cov('FG-L')).toEqual(['20', '30', '20', '-60', '-60']);

    // 70 ks v úterý na noční: čtvrtek −60 → 10 (plán se přičte do všech dnů).
    fireEvent.change(input('FG-L Út 13. 10. N'), { target: { value: '70' } });
    expect(cov('FG-L')).toEqual(['90', '100', '90', '10', '10']);
    expect(kpi('Nepokryté díly')).toBe('1');
    expect(screen.getAllByText('Neuložené změny').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'ASSEMBLY •' })).toBeTruthy();

    // Odpolední směna automaticky RHD: FG-R se doplní sám (chybí 30 ks).
    const auto = (label: string) => screen.getByRole('combobox', { name: `Automaticky ${label}` }) as HTMLSelectElement;
    fireEvent.change(auto('Po 12. 10. O'), { target: { value: 'RHD' } });
    expect(input('FG-R Po 12. 10. O').value).toBe('30');
    expect(input('FG-L Po 12. 10. O').value).toBe('');
    expect(input('FG-R Po 12. 10. O').closest('td')!.className).toContain('cell-auto');
    expect(kpi('Nepokryté díly')).toBe('0');

    // Přepsáním čísla je směna ruční: v pátek chybí 10 ks.
    fireEvent.change(input('FG-R Po 12. 10. O'), { target: { value: '20' } });
    expect(auto('Po 12. 10. O').value).toBe('');
    expect(cov('FG-R')[4]).toBe('-10');
    expect(row('FG-R').querySelectorAll('td.plan-cov')[4]!.className).toContain('cell-negative');

    // Noční obě strany: doplní zbylých 10 ks FG-R.
    fireEvent.change(auto('Po 12. 10. N'), { target: { value: 'BOTH' } });
    expect(input('FG-R Po 12. 10. N').value).toBe('10');
    expect(kpi('Nepokryté díly')).toBe('0');

    // Plánovací dny: přidat třetí, ubrat jde jen po úterý (tam je plán).
    fireEvent.click(screen.getByRole('button', { name: 'Přidat plánovací den' }));
    expect(document.querySelectorAll('th.plan-shift').length).toBe(9);
    fireEvent.click(screen.getByRole('button', { name: 'Ubrat plánovací den' }));
    expect(document.querySelectorAll('th.plan-shift').length).toBe(6);
    expect((screen.getByRole('button', { name: 'Ubrat plánovací den' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ručně zadaná kapacita směny a kapacity linek', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'ASSEMBLY' }));
    fireEvent.change(input('Kapacita směny Út 13. 10. R'), { target: { value: '80' } });
    expect(input('Kapacita směny Út 13. 10. R').closest('td')!.className).toContain('cell-manual');

    fireEvent.click(screen.getByRole('tab', { name: /Kapacity/ }));
    fireEvent.change(input('Ks za směnu ASSEMBLY P1'), { target: { value: '120' } });
    expect(screen.getByRole('tab', { name: 'Kapacity •' })).toBeTruthy();
  });
});
