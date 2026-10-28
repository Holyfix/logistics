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
const value = (label: string) => tile(label).querySelector('.kpi-value')!.textContent!.replace(/\u00a0/g, ' ');
const panel = (heading: string) => screen.getByRole('heading', { name: heading }).closest('.panel') as HTMLElement;
const texts = (rows: Iterable<Element>) => [...rows].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(/\u00a0/g, ' ')));

describe('InventoryPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('dlaždice v Kč: hodnota, doplnit do minima, nad maximem, nad celou potřebu, bez potřeby, blokováno', () => {
    renderPage();
    expect(value('Hodnota zásob')).toBe('4 550 Kč');
    expect(tile('Hodnota zásob').textContent).toMatch(/z toho externí 1\s000 Kč/);
    // FG-1: do minima 50 chybí 15 ks po 100 Kč
    expect(value('Doplnit do minima')).toBe('1 500 Kč');
    expect(value('Nad maximem (20 dní)')).toBe('0 Kč');
    // PG-1: 2000 ks, celá potřeba 200 ks → 1800 ks po 0,5 Kč
    expect(value('Nad celou potřebu')).toBe('900 Kč');
    // PG-2 má jen blokovanou zásobu: bez potřeby 0 Kč, blokace v Blokováno
    expect(value('Bez potřeby')).toBe('0 Kč');
    expect(value('Blokováno')).toBe('600 Kč');
    expect(tile('Blokováno').textContent).toMatch(/kvalita 500 Kč · inventura 100 Kč/);
    // žádné karty ani dlouhé tabulky dílů
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('kam jsou peníze, dosah v Kč, po projektech a žebříčky', () => {
    renderPage();
    expect(screen.getByRole('img', { name: /^Potřebná \(do 20 dní\) 3\s600 Kč, Nad maximem, spotřebuje se 0 Kč, Nad celou potřebu 900 Kč, Bez potřeby 0 Kč, Blokováno 600 Kč, Mimo mapování 50 Kč$/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^FG: kritické 0 Kč, nízké 3\s500 Kč/ })).toBeTruthy();
    expect(texts(panel('Po projektech').querySelectorAll('tbody tr, tfoot tr'))).toEqual([
      ['P1', '4 500 Kč', '–', '900 Kč', '–', '500 Kč', ''],
      ['bez projektu', '50 Kč', '–', '–', '–', '100 Kč', ''],
      ['Celkem', '4 550 Kč', '–', '900 Kč', '–', '600 Kč', ''],
    ]);
    expect(texts(panel('Nejvíc peněz nad potřebou').querySelectorAll('tr'))).toEqual([['PG-1CLIP · P1', '900 Kčnad celou potřebu']]);
    expect(within(panel('Bez potřeby')).getByText('Nic.')).toBeTruthy();
    expect(texts(panel('Blokováno').querySelectorAll('tr'))).toEqual([
      ['FG-1PANEL LHD · QH', '500 Kčkvalita'],
      ['PG-2OLD CLIP · DIFF', '100 Kčinventura'],
    ]);
    expect(screen.getByRole('button', { name: 'Excel – všechny díly' })).toBeTruthy();
  });

  it('sklad jen interní a filtr druhu', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Sklad'), { target: { value: 'internal' } });
    expect(tile('Hodnota zásob').textContent).toMatch(/3\s550 Kč.*z toho externí 0 Kč/);
    fireEvent.change(screen.getByLabelText('Druh'), { target: { value: 'PG' } });
    expect(value('Hodnota zásob')).toBe('1 000 Kč');
    expect(value('Blokováno')).toBe('100 Kč');
  });

  it('bez souboru skladu odkáže na Data', () => {
    renderPage({ ...state, data: { ...state.data!, stock: null } });
    expect(screen.getByText(/Soubor skladu \(Stock\) není načtený/)).toBeTruthy();
  });
});
