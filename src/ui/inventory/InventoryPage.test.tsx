import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseBom } from '../../core/bom';
import { parseCallOffExport } from '../../core/calloffs/parse';
import { parseCsv } from '../../core/csv';
import { dayFromParts } from '../../core/dates';
import { parseMasterData } from '../../core/masterdata';
import { parseStock } from '../../core/stock';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { InventoryPage } from './InventoryPage';

const day = (n: number) => dayFromParts(2026, 10, n)!;

const master = parseMasterData(parseCsv('Item Number;Customer Number;Description;Project;Category;Item Type\nFG-1;C1;PANEL LHD;P1;DP;FG\nPG-1;;CLIP;;;PG\nPG-2;;OLD CLIP;;;PG'));
const bom = parseBom([
  ['Level', 'Component Item', 'Quantity Per', 'Purchase/Manufacture'],
  ['Parent', 'FG-1', null, 'L'],
  ['1', 'PG-1', 2, 'P'],
]);
const calls = parseCallOffExport(parseCsv(['Item Number,Date,Discrete Qty', ...[12, 13, 14, 15, 16, 19, 20, 21, 22, 23].map((d) => `FG-1,${d}.10.2026,10`)].join('\n')), 'Odvolavky_CW42.csv');
const stock = parseStock(
  parseCsv(
    [
      'Site,Item Number,Description,Status,Standard Cost,Qty On Hand - Inv Detail,Location,OID Date (Last Transaction Date),ABC Class',
      '1000,FG-1,PANEL,WH.F,100,25,A-01,10/10/26,A',
      '1000DE,FG-1,PANEL,WH.F,100,10,SEQ-1,10/11/26,A',
      '1000,FG-1,PANEL,QH,100,5,Q-01,10/01/26,A',
      '1000,PG-1,CLIP,WH.P,"0,5",2000,C-01,10/09/26,B',
      '1000,PG-2,OLD CLIP,DIFF,2,50,C-03,12/15/25,C',
      '1000,PAL-1,PALLET,WH.P,10,5,P-01,10/09/26,C',
    ].join('\n'),
  ),
);
if (!master.ok || !bom.ok || !calls.ok || !stock.ok) throw new Error();

const state: DataState = {
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: {
    folderName: 'data',
    exports: [calls.value],
    master: { path: 'Item_Mapping.csv', data: master.value },
    coverage: [],
    stock: { path: 'Stock_12.10.2026.csv', lastModified: 0, data: stock.value },
    boms: [{ path: 'BOM/MBOM.xlsx', lastModified: 0, data: bom.value }],
    plans: [],
    planSettings: null,
    oil: null,
    kpi: null,
    failed: [],
    loadedAt: 1,
  },
};

function renderPage(initial: DataState = state) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={initial}>
        <InventoryPage today={day(12)} />
      </DataProvider>
    </I18nProvider>,
  );
}

const tile = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains('kpi-label'))!.closest('.kpi')!;
const rowOf = (item: string) => screen.getAllByText(item).find((el) => el.tagName === 'STRONG')!.closest('tr')!;

describe('InventoryPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('přehled: hodnota s externí zvlášť, kritické, nadbytek, blokace a rozložení podle dosahu', () => {
    renderPage();
    expect(tile('Hodnota zásob').textContent).toMatch(/4\s550 Kč.*z toho externí 1\s000 Kč/);
    expect(tile('Kritické · pod 2 dny').querySelector('.kpi-value')!.textContent).toBe('0');
    expect(tile('Pod minimem · 5 dní').querySelector('.kpi-value')!.textContent).toBe('1');
    expect(tile('Nadbytek · nad 40 dní').querySelector('.kpi-value')!.textContent).toBe('1');
    // bez potřeby: PG-2 (jen blokovaná zásoba, není v kusovníku); nad celou potřebu: PG-1 1800 ks po 0,5 Kč
    expect(tile('Bez potřeby').textContent).toMatch(/^Bez potřeby1dílů · 100 Kč, z toho není v kusovníku 100 Kč$/);
    expect(tile('Nad celou potřebu').textContent).toMatch(/900 Kč1 díl · zásoba/);
    expect(tile('Blokováno').textContent).toMatch(/600 Kč.*kvalita 500 Kč · inventura 100 Kč/);
    expect(screen.getByRole('img', { name: /^FG: kritické 0, nízké 1/ })).toBeTruthy();
    // díly mimo pásmo v pořádku: nízké, nadbytek, bez potřeby
    const fg = rowOf('FG-1');
    expect([...fg.querySelectorAll('td')].map((td) => td.textContent!.replace(/\u00a0/g, ' '))).toEqual([
      'FG-1', 'PANEL LHD', 'FG', 'A', '35z toho externí 10', '5', '50', '100', '3 d', '15', '—', '—', '3 500 Kč', 'nízké',
    ]);
    expect(rowOf('PG-1').textContent).toContain('nadbytek');
    expect(rowOf('PG-2').textContent).toContain('bez potřebynení v kusovníku');
    // lokace po kliknutí
    fireEvent.click(fg);
    const detail = fg.nextElementSibling as HTMLElement;
    expect(within(detail).getByText('SEQ-1').closest('td')!.textContent).toBe('SEQ-1 externí');
    expect(within(detail).getByText('QH').closest('td')!.textContent).toBe('QH kvalita');
  });

  it('sklad jen interní nebo jen externí; karta Díly s pásmem a hledáním; karta Blokace', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Sklad'), { target: { value: 'internal' } });
    expect(tile('Hodnota zásob').textContent).toMatch(/3\s550 Kč.*z toho externí 0 Kč/);
    fireEvent.click(screen.getByRole('tab', { name: 'Díly' }));
    expect(screen.getByText('4 díly')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Pásmo'), { target: { value: 'other' } });
    expect(rowOf('PAL-1').textContent).toContain('ostatní');
    fireEvent.change(screen.getByLabelText('Pásmo'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Hledat'), { target: { value: 'clip' } });
    expect(screen.getByText('2 díly')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Blokace' }));
    const rows = [...document.querySelectorAll('.inv-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 6).map((td) => td.textContent));
    expect(rows).toEqual([
      ['FG-1', 'PANEL LHD', 'FG', 'kvalita', 'QH', 'Q-01'],
      ['PG-2', 'OLD CLIP', 'PG', 'inventura', 'DIFF', 'C-03'],
    ]);
  });

  it('bez souboru skladu odkáže na Data', () => {
    renderPage({ ...state, data: { ...state.data!, stock: null } });
    expect(screen.getByText(/Soubor skladu \(Stock\) není načtený/)).toBeTruthy();
  });
});
