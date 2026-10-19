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
const master = parseMasterData(parseCsv('Item Number;Projekt;Kategorie;Strana;Varianta\n1001;P100;DP;LHD;SR2\n1002;P300;DP;RHD;'));
if (!master.ok) throw new Error();

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: { folderName: 'data', exports: [cw41, cw42], master: { path: 'kmenova-data.csv', data: master.value }, coverage: [], stock: null, boms: [], plans: [], planSettings: null, oil: null, kpi: null, failed: [], loadedAt: 0 },
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
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: '__missing__' } });
    rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows.filter((r) => r.closest('tbody')).map((r) => r.querySelector('strong')?.textContent)).toEqual(['1003']);
    // zákazník už se nenabízí
    expect(screen.queryByLabelText('Zákazník')).toBeNull();
  });

  it('navazující filtry: varianta jen tam, kde ji díly mají', () => {
    renderPage(state);
    expect(screen.getByLabelText('Varianta')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: 'P300' } });
    expect(screen.queryByLabelText('Varianta')).toBeNull();
    const side = screen.getByLabelText('Strana') as HTMLSelectElement;
    expect([...side.options].map((o) => o.value)).toEqual(['', 'RHD']);
  });

  it('filtry i obráceně: vybraná varianta zúží projekty', () => {
    renderPage(state);
    fireEvent.change(screen.getByLabelText('Varianta'), { target: { value: 'SR2' } });
    const projects = [...(screen.getByLabelText('Projekt') as HTMLSelectElement).options].map((o) => o.value);
    expect(projects).toEqual(['', 'P100', '__missing__']);
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

  it('přehled od začátku roku je jen jako export do Excelu', () => {
    renderPage(state);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Aktuální odvolávky', 'Přehled po projektech', 'Porovnání exportů']);
    expect(screen.getByRole('button', { name: /Excel od začátku roku/ })).toBeTruthy();
  });

  it('porovná dva exporty po týdnech, po dílech a v matici vývoje', () => {
    renderPage(state);
    fireEvent.click(screen.getByRole('tab', { name: 'Porovnání exportů' }));
    const [summary, items, matrix] = screen.getAllByRole('table');
    const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells(within(summary!).getByText('Rozdíl').closest('tr')!)).toEqual(['Rozdíl', '+50', '+50']);
    // Jen změněné díly.
    const itemRows = () => within(items!).getAllByRole('row').filter((r) => r.closest('tbody'));
    expect(itemRows().map((r) => r.querySelector('strong')?.textContent)).toEqual(['1001']);
    expect(screen.getByLabelText(/Jen změněné díly/).closest('label')!.textContent).toContain('(1 z 3)');
    fireEvent.click(screen.getByLabelText(/Jen změněné díly/));
    expect(itemRows()).toHaveLength(3);
    // Matice: CW 43 starší export neobsahuje, CW 42 vzrostl o třetinu.
    const last = within(matrix!).getByText('CW 42/2026').closest('tr')!;
    expect(cells(last)).toEqual(['CW 42/2026', '200▲ +33,3 %', '7']);
    expect(cells(within(matrix!).getByText('CW 41/2026').closest('tr')!)).toEqual(['CW 41/2026', '150', '·']);
  });

  it('jen změněné díly: v součtu skryje díl, jehož změny v týdnech se vyrovnají', () => {
    const older = exportOf('Odvolavky_CW41.csv', ['2001,SHIFT,12.10.2026,10', '2001,SHIFT,19.10.2026,20', '2002,SAME,12.10.2026,5']);
    const newer = exportOf('Odvolavky_CW42.csv', ['2001,SHIFT,12.10.2026,20', '2001,SHIFT,19.10.2026,10', '2002,SAME,12.10.2026,5']);
    renderPage({ ...state, data: { ...state.data!, exports: [older, newer], master: null } });
    fireEvent.click(screen.getByRole('tab', { name: 'Porovnání exportů' }));
    const items = () => screen.getAllByRole('table')[1]!;
    expect(screen.getByText('Žádný díl se mezi vybranými exporty nezměnil.')).toBeTruthy();
    expect(screen.getByText(/Jen změněné díly/).textContent).toContain('(0 z 2)');
    fireEvent.click(screen.getByRole('button', { name: 'Rozdíl po týdnech' }));
    expect(within(items()).getByText('2001')).toBeTruthy();
    expect(within(items()).queryByText('2002')).toBeNull();
  });

  it('porovnání s jedním exportem vysvětlí, co chybí', () => {
    renderPage({ ...state, data: { ...state.data!, exports: [cw42] } });
    fireEvent.click(screen.getByRole('tab', { name: 'Porovnání exportů' }));
    expect(screen.getByText(/aspoň dva exporty/)).toBeTruthy();
  });

  it('ukáže všechny díly najednou', () => {
    const many = exportOf('Odvolavky_CW42.csv', Array.from({ length: 250 }, (_, i) => `${5000 + i},PART,12.10.2026,1`));
    renderPage({ ...state, data: { ...state.data!, exports: [many], master: null } });
    const body = within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.closest('tbody'));
    expect(body).toHaveLength(250);
  });

  it('bez dat nabídne výběr složky', () => {
    renderPage({ ...state, status: 'noFolder', data: null });
    expect(screen.getByRole('link', { name: 'Vybrat složku s exporty' }).getAttribute('href')).toBe('#data');
  });

  it('přehled po projektech: projekt → kategorie → strana → varianta se součty po týdnech', () => {
    renderPage(state);
    fireEvent.click(screen.getByRole('tab', { name: 'Přehled po projektech' }));
    const table = screen.getByRole('table');
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 4).map((td) => td.textContent));
    expect(rows.slice(0, 4)).toEqual([
      ['▾P100 · 1 dílů', '150', '0', '150'],
      ['▾DP · 1 dílů', '150', '0', '150'],
      ['▾LHD · 1 dílů', '150', '0', '150'],
      ['SR2 · 1 dílů', '150', '0', '150'],
    ]);
    // P300 bez varianty: strana je poslední úroveň
    expect(rows.map((r) => r[0])).toContain('RHD · 1 dílů');
    expect(rows.map((r) => r[0])).toContain('▾bez projektu · 1 dílů');
    // Změna proti CW 41 u projektu P100: +50.
    expect(table.querySelector('tbody tr')!.lastElementChild!.textContent).toBe('+50');
    // Jen projekty.
    fireEvent.click(screen.getByRole('button', { name: 'Projekty' }));
    expect([...table.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent)).toEqual(['▸P100 · 1 dílů', '▸P300 · 1 dílů', '▸bez projektu · 1 dílů']);
  });
});
