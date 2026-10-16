import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CoverageSource } from '../../core/coverage/compute';
import type { CoverageReport } from '../../core/coverage/parse';
import { dayFromParts } from '../../core/dates';
import { parseCoverageWorkbook } from '../../core/coverage/parse';
import { parseCsv } from '../../core/csv';
import { parseMasterData } from '../../core/masterdata';
import { parseStock } from '../../core/stock';
import type { Cell } from '../../core/table';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { HubPage } from '../HubPage';
import { CoveragePage } from './CoveragePage';

const d = (day: number) => new Date(Date.UTC(2026, 9, day));
const block = ['Disposable Stock', 'Demand', 'In Transit', 'Stock End of the Day'];
const fixed = ['Customer Item Number', 'Item description', 'Open Orders', 'Stock in Lokalita 07:00'];
// 0001: sklad 10, poptávka 6/6 → 4, −2; transit 5 → 9, 3.  0002: sklad 50, poptávka 5/5 → 45, 40.
const rows: Cell[][] = [
  [null, null, null, null, d(13), null, null, null, d(14), null, null, null],
  [...fixed, ...block, ...block],
  ['A1234567890      0001', 'DOOR LHD', 0, 10, 10, 6, 5, 4, 4, 6, null, -2],
  ['A1234567890      0002', 'DOOR RHD', 0, 50, 50, 5, null, 45, 45, 5, null, 40],
];
const parsed = parseCoverageWorkbook([{ name: 'Coverage Report Overview', data: rows }]);
if (!parsed.ok) throw new Error();
const source: CoverageSource = { path: 'Coverage/Lokalita A/P100/r.xlsx', fileName: 'r.xlsx', location: 'Lokalita A', project: 'P100', lastModified: 0, report: parsed.value };
const master = parseMasterData(parseCsv('Item Number;Customer Number;Description;Variant;Project\n900100;A1234567890  00000001;DOOR LHD;LHD;P100'));
if (!master.ok) throw new Error();

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: { folderName: 'data', exports: [], master: { path: 'Item_Mapping.csv', data: master.value }, coverage: [source], stock: null, boms: [], plans: [], planSettings: null, oil: null, failed: [], loadedAt: 0 },
};

function renderWith(node: React.ReactNode, initial: DataState = state) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={initial}>{node}</DataProvider>
    </I18nProvider>,
  );
}

const lineTable = () => screen.getAllByRole('table')[1]!;
const bodyRows = () => within(lineTable()).getAllByRole('row').filter((r) => r.closest('tbody'));
const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent);

describe('CoveragePage', () => {
  afterEach(cleanup);

  it('ukáže pokrytí po dnech s transitem a záporné hodnoty zvýrazní', () => {
    renderWith(<CoveragePage />);
    const [mapped, unmapped] = bodyRows();
    expect(cells(mapped!).slice(-2)).toEqual(['9', '3']);
    expect(cells(unmapped!)[0]).toBe('—není v mapování');
    expect(cells(unmapped!)[1]).toBe('A1234567890 0002');
    // jednotný zápis čísla zákazníka, zápis ze souboru v nápovědě
    expect(cells(mapped!).slice(0, 2)).toEqual(['900100', 'A1234567890 0001']);
    expect(mapped!.querySelectorAll('td')[1]!.title).toBe('V souboru zákazníka: A1234567890      0001');
    fireEvent.click(screen.getByLabelText('Přičíst transit'));
    expect(cells(bodyRows()[0]!).slice(-2)).toEqual(['4', '-2']);
    expect(bodyRows()[0]!.querySelector('.cell-negative')).not.toBeNull();
  });

  it('ukazatele: chybějící kusy v prvních 2 dnech, záporné v horizontu, díly, bez mapování', () => {
    renderWith(<CoveragePage />);
    const kpis = () => [...document.querySelectorAll('.kpi')].map((k) => k.querySelector('.kpi-label')!.textContent);
    expect(kpis()).toEqual(['Chybí v prvních 2 dnech (Út 13. 10., St 14. 10.)', 'V záporu v horizontu', 'Dílů', 'Bez mapování']);
    const first = () => document.querySelector('.kpi')!;
    expect(first().querySelector('.kpi-value')!.textContent).toBe('0 ks');
    fireEvent.click(screen.getByLabelText('Přičíst transit'));
    expect(first().querySelector('.kpi-value')!.textContent).toBe('2 ks');
    expect(first().querySelector('.kpi-note')!.textContent).toBe('dílů v záporu: 1, bez transitu');
  });

  it('záporné kdykoli a ke zvolenému dni', () => {
    renderWith(<CoveragePage />);
    fireEvent.click(screen.getByLabelText('Přičíst transit'));
    fireEvent.change(screen.getByLabelText('Zobrazit'), { target: { value: 'negativeAny' } });
    expect(bodyRows().map((r) => r.querySelector('strong')?.textContent)).toEqual(['900100']);
    fireEvent.change(screen.getByLabelText('Zobrazit'), { target: { value: 'negativeOn' } });
    expect(screen.getByText('Filtru neodpovídá žádný díl.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Den'), { target: { value: String(parsed.value.days[1]) } });
    expect(bodyRows()).toHaveLength(1);
  });

  it('souhrn po variantách', () => {
    renderWith(<CoveragePage />);
    const summary = screen.getAllByRole('table')[0]!;
    expect(cells(within(summary).getByText('LHD').closest('tr')!)).toEqual(['LHD', '9', '3']);
    expect(cells(within(summary).getByText('Bez varianty').closest('tr')!)).toEqual(['Bez varianty', '45', '40']);
  });

  it('filtr destinace ukáže jen díly z vybrané destinace', () => {
    const other: CoverageSource = { ...source, path: 'Coverage/Lokalita B/P200/r.xlsx', location: 'Lokalita B', project: 'P200' };
    renderWith(<CoveragePage />, { ...state, data: { ...state.data!, coverage: [source, other] } });
    expect(bodyRows()).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Destinace'), { target: { value: 'Lokalita B' } });
    expect(bodyRows()).toHaveLength(2);
    expect(bodyRows().map((r) => r.querySelectorAll('td')[3]!.textContent)).toEqual(['Lokalita B', 'Lokalita B']);
    fireEvent.change(screen.getByLabelText('Destinace'), { target: { value: 'Lokalita A' } });
    expect(bodyRows().map((r) => r.querySelectorAll('td')[3]!.textContent)).toEqual(['Lokalita A', 'Lokalita A']);
  });

  it('projekt z adresy (odkaz z Dashboardu) nastaví filtr projektu', () => {
    const other: CoverageSource = { ...source, path: 'Coverage/Lokalita B/P200/r.xlsx', location: 'Lokalita B', project: 'P200' };
    location.hash = '#coverage?project=P200';
    try {
      renderWith(<CoveragePage />, { ...state, data: { ...state.data!, coverage: [source, other] } });
      expect((screen.getByLabelText('Projekt') as HTMLSelectElement).value).toBe('P200');
      // Ze 4 řádků zůstane jen díl bez mapování ze souboru P200 (díl z mapování patří podle mapování k P100).
      expect(bodyRows()).toHaveLength(1);
    } finally {
      location.hash = '';
    }
  });

  it('víkend, hranice 2 dnů a den prvního nepokrytí se stavem 0 nebo víc', () => {
    const day = (n: number) => dayFromParts(2026, 10, n)!;
    const report: CoverageReport = {
      format: 'articles',
      sheet: 'articles',
      days: [day(13), day(14), day(17)],
      rows: [
        { customerNumber: 'C1', customerKey: 'C1', supplierItem: '', description: 'A', customerStock: 5, balance: [5, 0, -1], transit: [0, 0, 0], firstUncovered: '1', uncoveredAt: '2026-10-14T08:00' },
        { customerNumber: 'C2', customerKey: 'C2', supplierItem: '', description: 'B', customerStock: 5, balance: [5, -2, -3], transit: [0, 0, 0], firstUncovered: '2', uncoveredAt: '2026-10-14T09:00' },
      ],
      issueCount: 0,
      issues: [],
    };
    renderWith(<CoveragePage today={day(13)} />, { ...state, data: { ...state.data!, coverage: [{ ...source, report }] } });
    const heads = [...lineTable().querySelectorAll('thead th')].slice(-3);
    expect(heads.map((h) => h.className)).toEqual(['n', 'n col-boundary', 'n col-weekend']);
    const [first, second] = bodyRows();
    const dayCells = (row: HTMLElement) => [...row.querySelectorAll('td')].slice(-3).map((td) => td.className);
    // 14. 10. je den prvního nepokrytí a stav je 0 → zvýraznit; u druhého dílu je záporný → červeně
    expect(dayCells(first!)).toEqual(['n', 'n col-boundary cell-uncovered', 'n col-weekend cell-negative']);
    expect(dayCells(second!)).toEqual(['n', 'n col-boundary cell-negative', 'n col-weekend cell-negative']);
    expect(screen.getByText('Hranice pokrytí 2 dny (dnes + 1)')).toBeTruthy();
  });

  it('náš sklad: sloupec a přepínač jen s načteným skladem', () => {
    renderWith(<CoveragePage />);
    expect(screen.queryByLabelText('Přičíst náš sklad')).toBeNull();
    expect(screen.queryByText('Náš sklad')).toBeNull();
    cleanup();
    // karanténa (LAB) a záporná lokace se nepočítají
    const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\n900100;A-01;SALE;12\n900100;B-01;PURCH;3\n900100;HOLD;LAB;50\n900100;L-01;WRKC;-4'));
    if (!stock.ok) throw new Error();
    renderWith(<CoveragePage />, { ...state, data: { ...state.data!, stock: { path: 'Stock_1.csv', lastModified: 0, data: stock.value } } });
    const heads = [...lineTable().querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads.slice(6, 10)).toEqual(['Sklad zákazníka', 'Transit', 'Náš sklad', 'První nepokryté']);
    const [mapped, unmapped] = bodyRows();
    expect(cells(mapped!)[8]).toBe('15');
    expect(cells(unmapped!)[8]).toBe('—');
    expect(cells(mapped!).slice(-2)).toEqual(['9', '3']);
    fireEvent.click(screen.getByLabelText('Přičíst náš sklad'));
    expect(cells(bodyRows()[0]!).slice(-2)).toEqual(['24', '18']);
    expect(document.querySelector('.kpi-note')!.textContent).toBe('dílů v záporu: 0, s transitem, s naším skladem');
    expect(screen.getByText(/v zónách INCOME, MEZ, PRE, PURCH, SALE, WRKC .* \(žádné\)\./)).toBeTruthy();
  });

  it('bez souborů odkáže na Data', () => {
    renderWith(<CoveragePage />, { ...state, data: { ...state.data!, coverage: [] } });
    expect(screen.getByRole('link', { name: 'Otevřít Data' }).getAttribute('href')).toBe('#data');
  });

  it('na rozcestníku chybějící kusy v prvních 2 dnech bez transitu a s transitem', () => {
    renderWith(<HubPage />);
    const metric = screen.getByRole('link', { name: /Coverage/ }).querySelector('.metric')!;
    // bez transitu chybí 2 ks (stav 4, −2), s transitem nic (9, 3) → jen pozor
    expect([...metric.querySelectorAll('b')].map((b) => b.parentElement!.textContent)).toEqual(['2 ks bez transitu', '0 ks s transitem']);
    expect(metric.querySelector('.dot-warn')).not.toBeNull();
    expect(metric.getAttribute('title')).toBe('Chybějící kusy v prvních 2 dnech podle souborů zákazníka: bez transitu 2 ks (dílů 1), s transitem 0 ks (dílů 0)');
  });
});
