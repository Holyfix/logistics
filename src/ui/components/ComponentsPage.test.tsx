import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseBom } from '../../core/bom';
import type { CallOffExport } from '../../core/calloffs/parse';
import type { CoverageSource } from '../../core/coverage/compute';
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
const master = parseMasterData(
  parseCsv('Item Number;Item Type;Description;Project;Category\nFG-1;FG;PANEL LHD;P1;DP\nFG-2;FG;PANEL RHD;P2;HB\nCLIP-1;PG;CLIP;;\nRESIN;PG;RESIN;;\nSUB-1;SFG;INTERMEDIATE;P1;'),
);
const stock = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nCLIP-1;A-01;PURCH;30\nRESIN;B-01;PURCH;100'));
if (!bom.ok || !master.ok || !stock.ok) throw new Error();
const callOffs = {
  items: ['FG-1'],
  descriptions: [''],
  offsets: Int32Array.from([0, 3]),
  days: Int32Array.from([day(13), day(14), day(15)]),
  qty: Float64Array.from([5, 5, 10]),
  backlog: Float64Array.from([0]),
  cumShipped: Float64Array.from([0]),
  hasCumShipped: false,
  week: 42,
  year: 2026,
  firstDay: day(13),
  lastDay: day(15),
  exportDay: day(12),
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
    plans: [],
    planSettings: null,
    oil: null,
    kpi: null,
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
    // spona: sklad 30, potřeba 10, 10, 20 → 20, 10, −10; pokryto do středy; zásoba 30 ÷ (40 za 5 dní výroby v prvních 7 dnech) = 3,75
    // bez souboru coverage sklad a transit u zákazníka neznáme → Zákazník pokryt do „—“
    expect(cells(clip!).slice(0, 8)).toEqual(['CLIP-1', 'CLIP', 'EA', 'nákup', '30', '40', 'St 14. 10.zásoba 3,8 dne výroby', '—']);
    expect(cells(clip!).slice(8, 11)).toEqual(['20', '10', '-10']);
    expect(clip!.querySelectorAll('td')[10]!.className).toContain('cell-negative');
    expect(clip!.querySelectorAll('td.cell-customer')).toHaveLength(0);
    // pryskyřice v kg na desetinná místa
    expect(cells(resin!).slice(4, 11)).toEqual(['100', '5', 'Po 26. 10. a délezásoba 100,0 dne výroby', '—', '98,75', '97,5', '95']);
    // mezivýroba bez označení se nezobrazí
    expect(screen.queryByText('SUB-1')).toBeNull();
    // pořadí ukazatelů: v záporu do 2 dnů, v záporu do 14 dní, …
    const kpis = [...document.querySelectorAll('.kpi')].map((k) => `${k.querySelector('.kpi-label')!.textContent}=${k.querySelector('.kpi-value')!.textContent}`);
    expect(kpis.slice(0, 2)).toEqual(['V záporu do 2 dnů=0', 'V záporu do 14 dní=1']);
  });

  it('potřeba výroby hotových dílů z odvolávek', () => {
    renderWith(<ComponentsPage today={day(13)} />);
    const [fg] = rows(1);
    expect(cells(fg!).slice(0, 7)).toEqual(['FG-1', 'PANEL LHD', 'P1', '20', '5', '5', '10']);
    // součet dnů jako poslední řádek
    const total = screen.getAllByRole('table')[1]!.querySelector('tfoot tr')!;
    expect(cells(total).slice(0, 7)).toEqual(['Celkem', '', '', '20', '5', '5', '10']);
    expect(document.querySelector('.source-info')!.textContent).toContain('odvolávky CW 42/2026');
  });

  it('náš sklad hotových dílů se odečte jen se zaškrtnutím', () => {
    const withFg = parseStock(parseCsv('Item Number;Location;Zone ID;Qty On Hand - Inv Detail\nCLIP-1;A-01;PURCH;30\nRESIN;B-01;PURCH;100\nFG-1;F-01;SALE;5'));
    if (!withFg.ok) throw new Error();
    renderWith(<ComponentsPage today={day(13)} />, { ...state, data: { ...state.data!, stock: { path: 'Stock_1.csv', lastModified: 0, data: withFg.value } } });
    // výchozí: jen odvolávky a sklad komponenty → spona 20, 10, −10; tabulka odvolávek ukazuje čistý požadavek
    expect(cells(rows(1)[0]!).slice(3, 7)).toEqual(['20', '5', '5', '10']);
    expect(cells(rows(0).find((r) => cells(r)[0] === 'CLIP-1')!).slice(8, 11)).toEqual(['20', '10', '-10']);
    // se zaškrtnutím: 5 ks FG-1 pokryje první den → výroba 0, 5, 10 → spona 30, 20, 0
    fireEvent.click(screen.getByLabelText('Odečíst náš sklad hotových dílů a mezivýroby'));
    expect(cells(rows(0).find((r) => cells(r)[0] === 'CLIP-1')!).slice(8, 11)).toEqual(['30', '20', '0']);
    expect(cells(rows(1)[0]!).slice(3, 7)).toEqual(['20', '5', '5', '10']);
  });

  it('rámeček: zákazník pokrytý hotovými díly (jeho sklad + transit), se zaškrtnutím i naším skladem', () => {
    // FG-1 u zákazníka: út 13. 10. 15, st 14. 10. 5, čt 15. 10. −5 → chybí ve čtvrtek 5 ks, za koncem souboru nic
    const coverage = {
      path: 'Coverage/L/P1/c.xlsx',
      fileName: 'c.xlsx',
      location: 'L',
      project: 'P1',
      lastModified: 0,
      report: {
        format: 'articles',
        sheet: 'articles',
        days: [day(13), day(14), day(15)],
        rows: [{ customerNumber: '', customerKey: '', supplierItem: 'FG-1', description: '', customerStock: 20, balance: [15, 5, -5], transit: [0, 0, 0], firstUncovered: '', uncoveredAt: '' }],
        issueCount: 0,
        issues: [],
      },
    } as CoverageSource;
    renderWith(<ComponentsPage today={day(13)} />, { ...state, data: { ...state.data!, coverage: [coverage] } });
    const clip = rows(0).find((r) => cells(r)[0] === 'CLIP-1')!;
    // u zákazníka chybí ve čtvrtek → pokryto do středy (rámeček)
    expect(cells(clip)[7]).toBe('St 14. 10.');
    expect(clip.querySelectorAll('td')[9]!.className).toContain('cell-customer');
    expect(clip.querySelectorAll('td.cell-customer')).toHaveLength(1);
  });

  it('pokryto do i přes víkend: poslední pokrytý den může být neděle', () => {
    // FG-1: pá 16. 10. 10 ks, po 19. 10. 10 ks → spona 20 + 20; sklad 30 → pá 10, so 10, ne 10, po −10
    const weekendCalls = { ...callOffs, offsets: Int32Array.from([0, 2]), days: Int32Array.from([day(16), day(19)]), qty: Float64Array.from([10, 10]) } as unknown as CallOffExport;
    renderWith(<ComponentsPage today={day(16)} />, { ...state, data: { ...state.data!, exports: [weekendCalls] } });
    const clip = rows(0).find((r) => cells(r)[0] === 'CLIP-1')!;
    expect(cells(clip)[6]).toMatch(/^Ne 18\. 10\./);
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

  it('navazující filtry Projekt a Kategorie podle hotových dílů', () => {
    renderWith(<ComponentsPage today={day(13)} />);
    const options = () => [...(screen.getByLabelText('Kategorie') as HTMLSelectElement).options].map((o) => o.value);
    expect(options()).toEqual(['', 'DP', 'HB']);
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: 'P2' } });
    // P2 má jen hotový díl FG-2 (HB) a v něm jen RESIN
    expect(options()).toEqual(['', 'HB']);
    expect(rows(0).map((r) => cells(r)[0])).toEqual(['RESIN']);
    // i obráceně: kategorie DP nabídne jen projekt P1
    fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'DP' } });
    expect([...(screen.getByLabelText('Projekt') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'P1']);
    expect(rows(0).map((r) => cells(r)[0]).sort()).toEqual(['CLIP-1', 'RESIN']);
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
    expect(metric!.textContent).toMatch(/^\d+ nepokryto na 2 dny$/);
  });
});
