import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CallOffExport } from '../../core/calloffs/parse';
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
const callOffs = {
  items: ['FG-L', 'FG-R'],
  descriptions: ['', ''],
  offsets: Int32Array.from([0, 1, 2]),
  days: Int32Array.from([day(15), day(16)]),
  qty: Float64Array.from([80, 30]),
  week: 42,
  year: 2026,
} as unknown as CallOffExport;

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: {
    folderName: 'data',
    exports: [callOffs],
    master: { path: 'Item_Mapping.csv', data: master.value },
    coverage: [],
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

  it('přehled linek: potřeba na 7 dní, nepokryté díly a pokrytí zákazníka', () => {
    renderPage();
    const row = screen.getByRole('button', { name: 'P1' }).closest('tr')!;
    const texts = [...row.querySelectorAll('td')].map((td) => td.textContent);
    // FG-L: 80 ks na čtvrtek (sklad 20), FG-R: 30 ks na pátek; bez plánu chybí oba, zákazník pokryt do středy.
    expect(texts).toEqual(['ASSEMBLY', 'P1', '110', '0', '0 %', '2 / 2', 'St 14. 10.', 'Zatím neuloženo']);
    expect(within(screen.getByRole('table')).getByText('FOA').closest('tr')!.textContent).toContain('připravujeme');
  });

  it('návrh plánu podle termínu výroby, ruční úprava a neuložené změny', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'P1' }));
    expect(screen.getByRole('tab', { name: 'ASSEMBLY' }).getAttribute('aria-selected')).toBe('true');
    expect(kpi('Nepokryté díly')).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout plán' }));
    // FG-L: potřeba čt 15. 10. → odjezd út 13. 10. 6:00 → 60 ks (po odečtu skladu) najednou v pondělní ranní.
    expect(input('FG-L Po 12. 10. R').value).toBe('60');
    // FG-R: potřeba pá 16. 10. → odjezd st 14. 10. 6:00 → úterní ranní.
    expect(input('FG-R Út 13. 10. R').value).toBe('30');
    expect(kpi('Nepokryté díly')).toBe('0');
    expect(screen.getAllByText('Neuložené změny').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'ASSEMBLY •' })).toBeTruthy();

    fireEvent.change(input('FG-R Út 13. 10. R'), { target: { value: '10' } });
    expect(kpi('Nepokryté díly')).toBe('1');
    const row = input('FG-R Út 13. 10. R').closest('tr')!;
    expect(within(row).getByText('Čt 15. 10.')).toBeTruthy();
  });

  it('ručně zadaná kapacita směny a kapacity linek', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'ASSEMBLY' }));
    fireEvent.change(input('Kapacita směny So 17. 10. R'), { target: { value: '80' } });
    expect(input('Kapacita směny So 17. 10. R').closest('td')!.className).toContain('cell-manual');

    fireEvent.click(screen.getByRole('tab', { name: /Kapacity/ }));
    fireEvent.change(input('Ks za směnu ASSEMBLY P1'), { target: { value: '120' } });
    expect(screen.getByRole('tab', { name: 'Kapacity •' })).toBeTruthy();
    expect(screen.getByText('Ostatní (bez souboru coverage)')).toBeTruthy();
  });
});
