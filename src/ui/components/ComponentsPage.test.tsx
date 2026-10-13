import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseBom } from '../../core/bom';
import type { CallOffExport } from '../../core/calloffs/parse';
import { parseCsv } from '../../core/csv';
import { dayFromParts } from '../../core/dates';
import { parseMasterData } from '../../core/masterdata';
import { parseStock } from '../../core/stock';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { HubPage } from '../HubPage';
import { ComponentsPage } from './ComponentsPage';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const bom = parseBom([
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
  ['Parent', 'FG-1', 'PANEL LHD', null, 'EA', 'L'],
  ['1', 'SUB-1', 'INTERMEDIATE', 1, 'EA', 'L'],
  ['.2', 'CLIP-1', 'CLIP', 2, 'EA', 'P'],
  ['.2', 'RESIN', 'RESIN', 0.25, 'KG', 'P'],
  ['Parent', 'FG-2', 'PANEL RHD', null, 'EA', 'L'],
  ['1', 'RESIN', 'RESIN', 0.5, 'KG', 'P'],
]);
const master = parseMasterData(parseCsv('Item Number;Project;Component Coverage\nFG-1;P1;\nFG-2;P2;\nCLIP-1;;Ano\nRESIN;;Ano\nSUB-1;;'));
const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nCLIP-1;A-01;PURCH;30\nRESIN;B-01;PURCH;100'));
if (!bom.ok || !master.ok || !stock.ok) throw new Error();
const callOffs = {
  items: ['FG-1'],
  offsets: Int32Array.from([0, 3]),
  days: Int32Array.from([day(13), day(14), day(15)]),
  qty: Float64Array.from([5, 5, 10]),
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
    boms: [{ path: 'BOM/MBOM_P1.xlsx', lastModified: 0, data: bom.value }],
    failed: [],
    loadedAt: 0,
  },
};

function renderWith(node: React.ReactNode, initial: DataState = state) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={initial}>{node}</DataProvider>
    </I18nProvider>,
  );
}

const rows = (table: number) => [...screen.getAllByRole('table')[table]!.querySelectorAll('tbody tr')];
const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent);

describe('ComponentsPage', () => {
  afterEach(cleanup);

  it('pokrytí označených komponent ze skladu a odvolávek přes kusovník', () => {
    renderWith(<ComponentsPage today={day(13)} />);
    const [clip, resin] = rows(0);
    // spona: sklad 30, spotřeba 10, 10, 20 → 20, 10, −10
    // spotřeba 40 za 10 dní výroby (po–pá) → Ø 4, sklad 30 → 7,5 dne výroby; zákazník pokryt do středy (bez skladu hotových dílů)
    expect(cells(clip!).slice(0, 9)).toEqual(['CLIP-1', 'CLIP', 'EA', 'nákup', '30', '40', '4', '7,5 dne výrobychybí od Čt 15. 10.', 'St 14. 10.']);
    expect(cells(clip!).slice(9, 12)).toEqual(['20', '10', '-10']);
    expect(clip!.querySelectorAll('td')[11]!.className).toContain('cell-negative');
    // pryskyřice v kg na desetinná místa
    expect(cells(resin!).slice(4, 12)).toEqual(['100', '5', '0,5', '200,0 dne výrobycelý horizont', 'celý horizont', '98,75', '97,5', '95']);
    // mezivýroba bez označení se nezobrazí
    expect(screen.queryByText('SUB-1')).toBeNull();
    // pořadí ukazatelů: v záporu do 2 dnů, v záporu do 14 dní, …
    const kpis = [...document.querySelectorAll('.kpi')].map((k) => `${k.querySelector('.kpi-label')!.textContent}=${k.querySelector('.kpi-value')!.textContent}`);
    expect(kpis.slice(0, 2)).toEqual(['V záporu do 2 dnů=0', 'V záporu do 14 dní=1']);
  });

  it('poptávka hotových dílů z odvolávek', () => {
    renderWith(<ComponentsPage today={day(13)} />);
    const [fg] = rows(1);
    expect(cells(fg!).slice(0, 7)).toEqual(['FG-1', 'PANEL LHD', 'P1', '20', '5', '5', '10']);
    expect(document.querySelector('.source-info')!.textContent).toContain('odvolávky CW 42/2026');
  });

  it('poptávka hotových dílů se řídí filtrem komponent', () => {
    renderWith(<ComponentsPage today={day(13)} />);
    const shown = () => rows(1).map((r) => cells(r)[0]);
    expect(shown()).toEqual(['FG-1', 'FG-2']);
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: 'P2' } });
    expect(shown()).toEqual(['FG-2']);
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: '' } });
    // komponenta vybraná hledáním: jen hotové díly, které ji mají v kusovníku
    fireEvent.change(screen.getByLabelText('Komponenta nebo popis'), { target: { value: 'clip' } });
    expect(shown()).toEqual(['FG-1']);
    expect(screen.getByText(/zobrazeno 1 \/ 2/)).toBeTruthy();
    // kliknutí na číslo komponenty ji vybere
    fireEvent.change(screen.getByLabelText('Komponenta nebo popis'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'RESIN' }));
    expect((screen.getByLabelText('Komponenta nebo popis') as HTMLInputElement).value).toBe('RESIN');
    expect(shown()).toEqual(['FG-1', 'FG-2']);
    // projekt a komponenta dohromady
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: 'P1' } });
    expect(shown()).toEqual(['FG-1']);
  });

  it('filtr jen v záporu a hledání', () => {
    renderWith(<ComponentsPage today={day(13)} />);
    fireEvent.click(screen.getByLabelText('Jen v záporu'));
    expect(rows(0).map((r) => cells(r)[0])).toEqual(['CLIP-1']);
    fireEvent.click(screen.getByLabelText('Jen v záporu'));
    fireEvent.change(screen.getByLabelText('Komponenta nebo popis'), { target: { value: 'resin' } });
    expect(rows(0).map((r) => cells(r)[0])).toEqual(['RESIN']);
  });

  it('bez kusovníku odkáže na Data; rozcestník ukáže komponenty v záporu', () => {
    renderWith(<ComponentsPage />, { ...state, data: { ...state.data!, boms: [] } });
    expect(screen.getByRole('link', { name: 'Otevřít Data' }).getAttribute('href')).toBe('#data');
    cleanup();
    renderWith(<HubPage />);
    const metric = screen.getByRole('link', { name: /Komponenty/ }).querySelector('.metric');
    expect(metric!.textContent).toMatch(/^(1 díl nepokrytý|[2-4] různé díly nepokryté|\d+ různých dílů nepokrytých) na 2 dny$/);
  });
});
