import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseBom } from '../../core/bom';
import { parseCsv } from '../../core/csv';
import { dayFromParts } from '../../core/dates';
import { parseSequenceCsv } from '../../core/material/sequence';
import { parseStock } from '../../core/stock';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { ComponentsPage } from './ComponentsPage';

const line = (cells: string[]) => `"${cells.map((c, i) => (i === 0 ? c : `""${c}""`)).join(',')}"`;
const jit = parseSequenceCsv(
  [
    line(['JIT order number', 'Item', 'Last priority', 'Production number', 'Assembly date', 'Article number (Pos)', 'Article description (Pos)']),
    line(['1', '1', 'Container planned', 'V1', '05/11/2026 08:00:00', 'P-FL', 'ASSY DP SR1 FRT LH']),
    line(['2', '1', 'Container planned', 'V2', '05/11/2026 09:00:00', 'P-FL', 'ASSY DP SR1 FRT LH']),
    line(['3', '1', 'Container planned', 'V3', '06/11/2026 07:00:00', 'P-FL', 'ASSY DP SR1 FRT LH']),
  ].join('\r\n'),
);
const matrix = parseSequenceCsv(
  [
    'Lot;Production number;Option Type;MC / MF;Planned customer built;Status FL;Status FR;Status RL;Status RR;Status HB',
    '6;V0;SR1;C1 / C1;04.11.2026 08:00;60 - Shipped;;;;',
    '7;V1;SR1;C1 / C1;05.11.2026 08:00;20 - Container planned;;;;',
    '7;V2;SR1;C1 / C1;05.11.2026 09:00;30 - Sequencelabel printed;;;;',
    '8;V3;SR1;C1 / C1;06.11.2026 07:00;20 - Container planned;;;;',
    '8;V9;SR1;C1 / C1;06.11.2026 08:00;20 - Container planned;;;;',
  ].join('\n'),
);
const bom = parseBom([
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
  ['Parent', 'P-FL', 'ASSY DP SR1 FRT LH', null, 'EA', 'L'],
  ['1', 'MC-1', 'ASSY MC SR1 FRT LH', 1, 'EA', 'L'],
  ['1', 'MF-1', 'ASSY MF SR1 FRT LH', 1, 'EA', 'P'],
]);
const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nMF-1;A-01;PURCH;2\nMC-1;A-02;PURCH;10'));
// Klíč MC/MF: MF podle dveří, výbavy a barvy (bez JIT)
const key = parseSequenceCsv('Side;Item Number;Type;Colour;Description\nFL;MF-K1;SR1;C1;ASSY MF SR1 FRT LH\nFL;MC-K1;SR1;C1;ASSY MC SR1 FRT LH');
if (jit.type !== 'jit' || matrix.type !== 'matrix' || key.type !== 'key' || !bom.ok || !stock.ok) throw new Error();

const state = (sequence: boolean, withKey = false): DataState => ({
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: {
    folderName: 'data',
    exports: [],
    master: null,
    coverage: [],
    stock: { path: 'Stock_1.csv', lastModified: 0, data: stock.value },
    boms: [{ path: 'BOM/MBOM_DP.xlsx', lastModified: 0, data: bom.value }],
    plans: [],
    planSettings: null,
    oil: null,
    kpi: null,
    ...(sequence
      ? {
          sequence: {
            matrix: { path: 'Sekvence/OrderStatusMatrixOverview.xlsx', lastModified: 0, orders: matrix.orders },
            jit: withKey ? null : { path: 'Sekvence/JIT_Overview.csv', lastModified: 0, positions: jit.positions },
            key: withKey ? { path: 'Sekvence/MC_MF_klic.xlsx', lastModified: 0, key: key.key } : null,
          },
        }
      : {}),
    failed: [],
    loadedAt: 0,
  },
});

function renderPage(withSequence = true, withKey = false) {
  localStorage.setItem('logistics-locale', 'cs');
  render(
    <I18nProvider>
      <DataProvider initial={state(withSequence, withKey)}>
        <ComponentsPage today={dayFromParts(2026, 11, 5)!} />
      </DataProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Sekvence' }));
}

const rowOf = (pn: string) => screen.getAllByText(pn).find((el) => el.tagName === 'STRONG')!.closest('tr')!;
const badges = (pn: string) => [...rowOf(pn).querySelectorAll('td')[5]!.querySelectorAll('.mat-badge')].map((b) => `${b.textContent} ${b.className.split('mat-badge-')[1]}`);
const material = (pn: string) => rowOf(pn).querySelector('td.mat-missing')!.textContent;
const shown = () => [...document.querySelectorAll('.mat-matrix tbody td.sticky-col')].map((td) => td.textContent);

describe('Komponenty – karta Sekvence', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('matice a JIT ze složky Sekvence, MC a MF z kusovníku a sklad ze souboru skladu', () => {
    renderPage();
    expect(screen.getByText(/OrderStatusMatrixOverview\.xlsx · klíč MC\/MF: — · JIT Overview: JIT_Overview\.csv · sklad: Stock_1\.csv/)).toBeTruthy();
    expect(shown()).toEqual(['V0', 'V1', 'V2', 'V3', 'V9']);
    // V0 je odeslaný: nepočítá se; sklad MF 2 pokryje V1 a V2, V3 chybí MF; MC 10 pokryje všechny; V9 není v JIT
    expect(badges('V0')).toEqual([]);
    expect(badges('V1')).toEqual(['MC ok', 'MF ok']);
    expect(badges('V2')).toEqual(['MC ok', 'MF ok']);
    expect(badges('V3')).toEqual(['MC ok', 'MF short']);
    expect(badges('V9')).toEqual(['MC unknown', 'MF unknown']);
    expect(material('V2')).toBe('vše na skladě');
    expect(material('V3')).toBe('FL: MF MF-1');
    expect(material('V9')).toBe('díly neurčeny');
    expect(screen.getByText(/z toho 1 zabalených nebo odeslaných/)).toBeTruthy();
    expect(screen.getByText('chybí dílů: MC 0 · MF 1')).toBeTruthy();
    // filtry: Lot a MC / MF ve filtrech nejsou; nevyrobené carsety (aspoň jedny dveře ve stavu 45 a méně)
    expect(screen.queryByLabelText('Lot')).toBeNull();
    expect(screen.queryByLabelText('MC / MF')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Jen nevyrobené carsety/));
    expect(shown()).toEqual(['V1', 'V2', 'V3', 'V9']);
    expect(screen.getByText('Zobrazeno 4 z 5 vozů')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit filtry' }));
    expect(shown()).toEqual(['V0', 'V1', 'V2', 'V3', 'V9']);
    fireEvent.change(screen.getByLabelText('Production number, Lot nebo díl'), { target: { value: 'mc-1' } });
    expect(shown()).toEqual(['V1', 'V2', 'V3']);
    fireEvent.click(screen.getByLabelText('Jen vozy s nepokrytými dveřmi'));
    expect(shown()).toEqual(['V3']);
  });

  it('lokace, které se do skladu nepočítají, zvlášť pro MC a MF; volba se pamatuje', () => {
    renderPage();
    expect(screen.getByText('Lokace skladu: nepočítá se MC 0 · MF 0 lokací')).toBeTruthy();
    // MC: jen lokace se skladem MC (A-01 má jen MF)
    expect(screen.getByText('Maincarrier: nepočítá se 0 z 1 lokací (0 ks)')).toBeTruthy();
    expect(screen.queryByLabelText('Nepočítat A-01')).toBeNull();
    fireEvent.click(screen.getByLabelText('Nepočítat A-02'));
    expect(badges('V1')).toEqual(['MC short', 'MF ok']);
    // MF: jiný seznam a jiný výběr
    fireEvent.click(screen.getByRole('button', { name: 'Middlefield' }));
    expect(screen.queryByLabelText('Nepočítat A-02')).toBeNull();
    fireEvent.click(screen.getByLabelText('Nepočítat A-01'));
    expect(screen.getByText('Middlefield: nepočítá se 1 z 1 lokací (2 ks)')).toBeTruthy();
    expect(screen.getByText('Lokace skladu: nepočítá se MC 1 · MF 1 lokací')).toBeTruthy();
    expect(badges('V1')).toEqual(['MC short', 'MF short']);
    expect(JSON.parse(localStorage.getItem('sequence-excluded-locations-mc')!)).toEqual(['A-02']);
    expect(JSON.parse(localStorage.getItem('sequence-excluded-locations')!)).toEqual(['A-01']);
    cleanup();
    renderPage();
    expect(badges('V1')).toEqual(['MC short', 'MF short']);
    fireEvent.click(screen.getByLabelText('Nepočítat A-02'));
    expect(badges('V1')).toEqual(['MC ok', 'MF short']);
  });

  it('klíč MC/MF místo JIT: MC a MF podle výbavy, dveří a barvy', () => {
    renderPage(true, true);
    expect(screen.getByText(/klíč MC\/MF: MC_MF_klic\.xlsx · JIT Overview: —/)).toBeTruthy();
    // MC-K1 ani MF-K1 skladem nejsou: všechny počítané dveře chybí, i V9, který v JIT není
    expect(badges('V1')).toEqual(['MC short', 'MF short']);
    expect(badges('V9')).toEqual(['MC short', 'MF short']);
    expect(material('V9')).toBe('FL: MC MC-K1, MF MF-K1');
    expect(rowOf('V1').querySelectorAll('td')[5]!.title).toBe('MC MC-K1 (z klíče): zbývá skladu -1\nMF MF-K1 (z klíče): zbývá skladu -1');
  });

  it('bez souborů ve složce Sekvence poradí, co uložit', () => {
    renderPage(false);
    expect(screen.getByText(/uložte do sdílené složky Sekvence/)).toBeTruthy();
  });
});
