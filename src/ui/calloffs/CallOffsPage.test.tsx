import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseCallOffExport, type CallOffExport } from '../../core/calloffs/parse';
import { parseCsv } from '../../core/csv';
import { parseMasterData } from '../../core/masterdata';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { CallOffsPage } from './CallOffsPage';

function exportOf(name: string, lines: string[]): CallOffExport {
  const r = parseCallOffExport(parseCsv(['Item Number,Item Description,Date,Discrete Qty', ...lines].join('\n')), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const cw41 = exportOf('Odvolavky_CW41.csv', ['1001,DOOR LH,12.10.2026,100', '1002,IP RHD,13.10.2026,50']);
const cw42 = exportOf('Odvolavky_CW42.csv', ['1001,DOOR LH,12.10.2026,150', '1002,IP RHD,13.10.2026,50', '1003,GLOVEBOX,19.10.2026,7']);
const master = parseMasterData(parseCsv('Item Number;Zákazník;Projekt;Strana\n1001;Zákazník A;P100;LHD\n1002;Zákazník B;P300;RHD'));
if (!master.ok) throw new Error();

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: { folderName: 'data', exports: [cw41, cw42], master: { path: 'kmenova-data.csv', data: master.value }, failed: [], loadedAt: 0 },
};

function renderPage(initial: DataState) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={initial}>
        <CallOffsPage />
      </DataProvider>
    </I18nProvider>,
  );
}

describe('CallOffsPage', () => {
  afterEach(cleanup);

  it('ukáže aktuální export po týdnech se změnou proti předchozímu', () => {
    renderPage(state);
    expect(screen.getAllByText(/CW 42\/2026/).length).toBeGreaterThan(0);
    const table = screen.getByRole('table');
    const row = within(table).getByText('1001').closest('tr')!;
    expect(row.textContent).toContain('150');
    expect(row.textContent).toContain('▲ +50');
    expect(row.querySelector('.cell-changed')).not.toBeNull();
    expect(within(table).getByText('1003')).toBeTruthy();
  });

  it('filtruje podle kmenových dat a ukáže díly bez nich', () => {
    renderPage(state);
    fireEvent.change(screen.getByLabelText('Strana'), { target: { value: 'RHD' } });
    let rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('1002')]));
    expect(rows.some((r) => r.textContent?.includes('1001'))).toBe(false);

    fireEvent.change(screen.getByLabelText('Strana'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Zákazník'), { target: { value: '__missing__' } });
    rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.filter((r) => r.closest('tbody')).map((r) => r.querySelector('strong')?.textContent)).toEqual(['1003']);
  });

  it('ukáže celý horizont exportu', () => {
    renderPage(state);
    fireEvent.change(screen.getByLabelText('Rozsah'), { target: { value: 'all' } });
    expect(screen.getByRole('columnheader', { name: 'CW 43' })).toBeTruthy();
  });

  it('přepne na dny', () => {
    renderPage(state);
    fireEvent.click(screen.getByRole('button', { name: 'Dny' }));
    expect(screen.getByRole('columnheader', { name: 'Po 12. 10.' })).toBeTruthy();
  });

  it('přehled roku: požadavek každého týdne z jeho exportu', () => {
    renderPage(state);
    fireEvent.click(screen.getByRole('tab', { name: 'Přehled od začátku roku' }));
    const [summary, items] = screen.getAllByRole('table');
    const demand = within(summary!).getByText('Požadováno').closest('tr')!;
    expect([...demand.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Požadováno', '0', '200', '200']);
    const row = within(items!).getByText('1001').closest('tr')!;
    expect(row.textContent).toContain('150');
    // Díl bez požadavku v týdnech roku se nezobrazí.
    expect(within(items!).queryByText('1003')).toBeNull();
    // Bez kumulativů nejde odeslané množství spočítat.
    fireEvent.click(screen.getByRole('button', { name: 'Rozdíl' }));
    expect(within(items!).getByText('1001').closest('tr')!.textContent).toContain('—');
  });

  it('bez dat nabídne výběr složky', () => {
    renderPage({ ...state, status: 'noFolder', data: null });
    expect(screen.getByRole('link', { name: 'Vybrat složku s exporty' }).getAttribute('href')).toBe('#data');
  });
});
