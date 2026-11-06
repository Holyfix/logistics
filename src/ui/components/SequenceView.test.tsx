import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseBom } from '../../core/bom';
import { parseCsv } from '../../core/csv';
import { dayFromParts } from '../../core/dates';
import type { PartKey } from '../../core/material/partKey';
import { parseSequenceCsv } from '../../core/material/sequence';
import { parseStock } from '../../core/stock';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { ComponentsPage } from './ComponentsPage';
import { DataPage } from '../DataPage';

const matrix = parseSequenceCsv(
  [
    'Lot;Production number;Option Type;MC / MF;Planned customer built;Status FL;Status FR;Status RL;Status RR;Status HB',
    '6;V0;SR2;C1 / C1;04.11.2026 08:00;60 - Shipped;;;;',
    '7;V1;SR2;C1 / C1;05.11.2026 08:00;20 - Container planned;;;;',
    '7;V2;SR2;C1 / C1;05.11.2026 09:00;30 - Sequencelabel printed;;;;',
    '8;V3;SR2;C1 / C1;06.11.2026 07:00;20 - Container planned;;;;',
    // FR v klíči není
    '8;V9;SR2;C1 / C1;06.11.2026 08:00;;20 - Container planned;;;',
  ].join('\n'),
);
// Klíč MC/MF: díl podle dveří, výbavy a barvy
const key = parseSequenceCsv('Side;Item Number;Type;Colour;Description\nFL;MF-1;SR2;C1;ASSY MF SR1 FRT LH\nFL;MC-1;SR2;C1;ASSY MC SR1 FRT LH');
const onlyMf = parseSequenceCsv('Side;Item Number;Type;Colour;Description\nFL;MF-1;SR2;C1;ASSY MF SR1 FRT LH');
// Komponenty se bez kusovníku nezobrazí; Sekvence ho nepotřebuje.
const bom = parseBom([
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
  ['Parent', 'FG-1', 'PANEL', null, 'EA', 'L'],
  ['1', 'CLIP', 'CLIP', 1, 'EA', 'P'],
]);
const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nMF-1;A-01;PURCH;2\nMC-1;A-02;PURCH;10'));
if (matrix.type !== 'matrix' || key.type !== 'key' || onlyMf.type !== 'key' || !bom.ok || !stock.ok) throw new Error();

const state = (sequence: boolean, partKey: PartKey = key.key): DataState => ({
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
    boms: [{ path: 'BOM/MBOM_X.xlsx', lastModified: 0, data: bom.value }],
    plans: [],
    planSettings: null,
    oil: null,
    kpi: null,
    ...(sequence
      ? {
          sequence: {
            matrix: { path: 'Sekvence/OrderStatusMatrixOverview.xlsx', lastModified: 0, orders: matrix.orders },
            key: { path: 'Sekvence/MC_MF_klic.xlsx', lastModified: 0, key: partKey },
          },
        }
      : {}),
    failed: [],
    loadedAt: 0,
  },
});

function renderPage(withSequence = true, partKey?: PartKey) {
  localStorage.setItem('logistics-locale', 'cs');
  render(
    <I18nProvider>
      <DataProvider initial={state(withSequence, partKey)}>
        <ComponentsPage today={dayFromParts(2026, 11, 5)!} />
      </DataProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Sekvence' }));
}

const rowOf = (pn: string) => screen.getAllByText(pn).find((el) => el.tagName === 'STRONG')!.closest('tr')!;
const doorCell = (pn: string, door: number) => rowOf(pn).querySelectorAll('td')[5 + door]!;
const badges = (pn: string, door = 0) => [...doorCell(pn, door).querySelectorAll('.mat-badge')].map((b) => `${b.textContent} ${b.className.split('mat-badge-')[1]}`);
const material = (pn: string) => rowOf(pn).querySelector('td.mat-missing')!.textContent;
const shown = () => [...document.querySelectorAll('.mat-matrix tbody td.sticky-col')].map((td) => td.textContent);

describe('Komponenty – karta Sekvence', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('matice a klíč ze složky Sekvence, sklad ze souboru skladu', () => {
    renderPage();
    expect(screen.getByText(/OrderStatusMatrixOverview\.xlsx · klíč MC\/MF: MC_MF_klic\.xlsx · sklad: Stock_1\.csv/)).toBeTruthy();
    expect(shown()).toEqual(['V0', 'V1', 'V2', 'V3', 'V9']);
    // V0 je odeslaný: nepočítá se; sklad MF 2 pokryje V1 a V2, V3 chybí MF; MC 10 pokryje všechny; V9 FR v klíči není
    expect(badges('V0')).toEqual([]);
    expect(badges('V1')).toEqual(['MC ok', 'MF ok']);
    expect(badges('V2')).toEqual(['MC ok', 'MF ok']);
    expect(badges('V3')).toEqual(['MC ok', 'MF short']);
    expect(badges('V9', 1)).toEqual(['MC unknown', 'MF unknown']);
    expect(material('V2')).toBe('vše na skladě');
    expect(material('V3')).toBe('FL: MF MF-1');
    expect(material('V9')).toBe('chybí v klíči: MC FR · MF FR');
    expect(doorCell('V1', 0).title).toBe('MC MC-1: zbývá skladu 9\nMF MF-1: zbývá skladu 1');
    expect(screen.getByText(/z toho 1 zabalených nebo odeslaných/)).toBeTruthy();
    expect(screen.getByText('chybí dílů: MC 0 · MF 1')).toBeTruthy();
    expect(screen.getByText(/nepočítají se do potřeby · MC 1 · MF 1 · 2 kombinací chybí v klíči/)).toBeTruthy();
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

  it('díl, který v klíči chybí, je šedý a do potřeby se nepočítá', () => {
    // klíč jen s MF: MC nejde určit
    renderPage(true, onlyMf.key);
    // sklad MF-1 2: V1 a V2 pokryté, V3 chybí; MC šedý u všech a nikde se nepočítá jako chybějící
    expect(badges('V1')).toEqual(['MC unknown', 'MF ok']);
    expect(material('V1')).toBe('chybí v klíči: MC FL');
    expect(material('V3')).toBe('FL: MF MF-1 · chybí v klíči: MC FL');
    expect(rowOf('V1').className).not.toContain('mat-car-short');
    expect(screen.getByText('chybí dílů: MC 0 · MF 1')).toBeTruthy();
  });

  it('chybějící klíč: odkaz z Sekvence a seznam kombinací v modulu Data', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Kontrola klíče →' }).getAttribute('href')).toBe('#data');
    cleanup();
    localStorage.setItem('logistics-locale', 'cs');
    render(
      <I18nProvider>
        <DataProvider initial={state(true)}>
          <DataPage />
        </DataProvider>
      </I18nProvider>,
    );
    // V9 FR v klíči není: MC i MF
    expect(screen.getByText('Chybí v klíči MC/MF: 2 kombinací (MC 1 · MF 1) · 2 dveří se nepočítá')).toBeTruthy();
    const rows = [...document.querySelectorAll('.check-parts-box tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(0, 5).map((td) => td.textContent));
    expect(rows).toEqual([
      ['MC', 'FR', 'SR2', 'C1', '1'],
      ['MF', 'FR', 'SR2', 'C1', '1'],
    ]);
  });

  it('pohled Díly MC a MF: stav skladu po dnech jako list Coverage v exportu', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Díly MC a MF' }));
    // filtry vozů v pohledu na díly nejsou
    expect(screen.queryByLabelText(/Jen nevyrobené carsety/)).toBeNull();
    const table = document.querySelector('.mat-parts')!;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Díl', 'Druh', 'Popis', 'Sklad', 'Potřeba', 'Chybí od', 'Čt 5. 11.', 'Pá 6. 11.']);
    // jeden seznam bez skupin: nahoře díly, které chybí nejdřív
    const rows = () => [...table.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    expect(rows()).toEqual([
      ['MF-1', 'MF', 'ASSY MF SR1 FRT LH', '2', '3', 'Pá 6. 11. 07:00 · V3 FL', '0', '-1'],
      ['MC-1', 'MC', 'ASSY MC SR1 FRT LH', '10', '3', 'pokryto', '8', '7'],
    ]);
    expect(table.querySelectorAll('tbody td.cell-negative')).toHaveLength(1);
    expect(table.querySelector('thead th.col-boundary')!.textContent).toBe('Pá 6. 11.');
    // filtr druhu nahoře
    const kindFilter = within(screen.getByRole('group', { name: 'Zobrazit díly' }));
    fireEvent.click(kindFilter.getByRole('button', { name: 'Maincarrier' }));
    expect(rows().map((r) => r[0])).toEqual(['MC-1']);
    fireEvent.click(kindFilter.getByRole('button', { name: 'Vše' }));
    fireEvent.click(screen.getByLabelText('Jen chybějící díly'));
    expect(rows().map((r) => r[0])).toEqual(['MF-1']);
  });

  it('MC u SR1, SR1-HT, TPO a TPO-HT: jen modrý štítek MC, do zásoby se nepočítá', () => {
    localStorage.setItem('logistics-locale', 'cs');
    const tpoMatrix = parseSequenceCsv(
      ['Lot;Production number;Option Type;MC / MF;Planned customer built;Status FL;Status FR;Status RL;Status RR;Status HB', '7;V7;SR1-HT;C1-ASQ / C1;05.11.2026 08:00;20 - Container planned;;;;'].join('\n'),
    );
    const tpoKey = parseSequenceCsv('Side;Item Number;Type;Colour;Description\nFL;MF-HT;SR1-HT;C1;ASSY MF SR1 HEAT. FRT LH');
    if (tpoMatrix.type !== 'matrix' || tpoKey.type !== 'key') throw new Error();
    const base = state(true);
    render(
      <I18nProvider>
        <DataProvider initial={{ ...base, data: { ...base.data!, sequence: { matrix: { path: 'Sekvence/m.xlsx', lastModified: 0, orders: tpoMatrix.orders }, key: { path: 'Sekvence/k.xlsx', lastModified: 0, key: tpoKey.key } } } }}>
          <ComponentsPage today={dayFromParts(2026, 11, 5)!} />
        </DataProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Sekvence' }));
    expect(badges('V7')).toEqual(['MC tpo', 'MF short']);
    expect(material('V7')).toBe('FL: MF MF-HT');
    // MC TPO se nehlásí jako chybějící v klíči ani nechybí
    expect(screen.getByText('chybí dílů: MC 0 · MF 1')).toBeTruthy();
    expect(screen.getByText(/nepočítají se do potřeby · MC 0 · MF 0 · 0 kombinací chybí v klíči/)).toBeTruthy();
    expect(screen.getByText('TPO Maincarrier (SR1, SR1-HT, TPO, TPO-HT) – modře, do zásoby se nepočítá')).toBeTruthy();
  });

  it('bez souborů ve složce Sekvence poradí, co uložit', () => {
    renderPage(false);
    expect(screen.getByText(/uložte do sdílené složky Sekvence/)).toBeTruthy();
  });
});
