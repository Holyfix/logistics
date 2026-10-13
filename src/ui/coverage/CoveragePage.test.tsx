import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CoverageSource } from '../../core/coverage/compute';
import { parseCoverageWorkbook } from '../../core/coverage/parse';
import { parseCsv } from '../../core/csv';
import { parseMasterData } from '../../core/masterdata';
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
  data: { folderName: 'data', exports: [], master: { path: 'Item_Mapping.csv', data: master.value }, coverage: [source], failed: [], loadedAt: 0 },
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
    expect(cells(unmapped!)[0]).toContain('A1234567890      0002');
    expect(cells(unmapped!)[0]).toContain('není v mapování');
    fireEvent.click(screen.getByLabelText('Přičíst transit'));
    expect(cells(bodyRows()[0]!).slice(-2)).toEqual(['4', '-2']);
    expect(bodyRows()[0]!.querySelector('.cell-negative')).not.toBeNull();
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
    expect(bodyRows().map((r) => r.querySelectorAll('td')[2]!.textContent)).toEqual(['Lokalita B', 'Lokalita B']);
    fireEvent.change(screen.getByLabelText('Destinace'), { target: { value: 'Lokalita A' } });
    expect(bodyRows().map((r) => r.querySelectorAll('td')[2]!.textContent)).toEqual(['Lokalita A', 'Lokalita A']);
  });

  it('bez souborů odkáže na Data', () => {
    renderWith(<CoveragePage />, { ...state, data: { ...state.data!, coverage: [] } });
    expect(screen.getByRole('link', { name: 'Otevřít Data' }).getAttribute('href')).toBe('#data');
  });

  it('na rozcestníku počet dílů v záporu do 2 dnů', () => {
    renderWith(<HubPage />);
    const metric = screen.getByRole('link', { name: /Coverage/ }).querySelector('.metric')!;
    expect(metric.textContent).toBe('0 do 2 dnů');
    expect(metric.querySelector('.dot-ok')).not.toBeNull();
  });
});
