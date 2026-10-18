import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { dayFromParts } from '../../core/dates';
import { defaultKpis, withEntry, type KpiData } from '../../core/kpi';
import { cs } from '../../i18n/cs';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { OilProvider } from '../oil/OilProvider';
import { KpiPage } from './KpiPage';

const day = (n: number) => dayFromParts(2026, 10, n)!;

let kpi: KpiData = defaultKpis(cs.kpi.defaults);
kpi = withEntry(kpi, { day: day(1), author: 'Novák', at: '2.10.2026 7:30', values: { s_injury: 0, 'q_claims|Záměna dílu': 0, c_premium: 0 } });
kpi = withEntry(kpi, { day: day(2), author: 'Novák', at: '5.10.2026 7:30', values: { s_injury: 1, 'q_claims|Záměna dílu': 0, c_premium: 6000 } });

const state = (data: KpiData | null): DataState => ({
  status: 'ready',
  folderName: 'data',
  progress: null,
  error: '',
  data: {
    folderName: 'data',
    exports: [],
    master: null,
    coverage: [],
    stock: null,
    boms: [],
    plans: [],
    planSettings: null,
    oil: null,
    kpi: data && { path: 'KPI/KPI.xlsx', lastModified: 0, data },
    failed: [],
    loadedAt: 1,
  },
});

function renderPage(data: KpiData | null = kpi) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={state(data)}>
        <OilProvider>
          <KpiPage today={day(6)} />
        </OilProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

/** Políčko dne v písmenu (podle čísla dne). */
const cell = (letter: string, n: number) => [...document.querySelectorAll('.kpi-card')].find((c) => c.querySelector('.kpi-letter')!.textContent === letter)!.querySelectorAll('.kpi-cell')[n - 1]!;

describe('KpiPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('písmena SQCDP v pořadí, dny podle zápisu', () => {
    renderPage();
    expect([...document.querySelectorAll('.kpi-card:not(.kpi-chart-card) .kpi-letter')].map((l) => l.textContent)).toEqual(['S', 'Q', 'C', 'D', 'P']);
    expect(cell('S', 1).className).toContain('kpi-green');
    expect(cell('S', 2).className).toContain('kpi-red');
    expect(cell('S', 3).className).toContain('kpi-weekend'); // sobota bez zápisu
    expect(cell('S', 5).className).toContain('kpi-missing'); // pondělí bez zápisu
    expect(cell('S', 7).className).toContain('kpi-future');
    // říjen má 31 dní – všechna políčka jsou dny
    expect(document.querySelectorAll('.kpi-card')[0]!.querySelectorAll('.kpi-pad')).toHaveLength(0);
    expect(screen.getAllByText('v cíli 1 z 2 dní')[0]).toBeTruthy();
  });

  it('karty: přehled, zápis dne, ukazatele a cíle', () => {
    renderPage();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Přehled', 'Zápis dne', 'Ukazatele a cíle']);
    expect(screen.queryByLabelText('Úrazy v logistice')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Ukazatele a cíle' }));
    expect(screen.getByRole('button', { name: '+ Ukazatel' })).toBeTruthy();
    expect(document.querySelector('.kpi-letters')).toBeNull();
  });

  it('zápis nabízí předchozí pracovní den, stav se počítá při psaní', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Zapsat Po 5. 10.' }));
    expect(screen.getByRole('tab', { name: 'Zápis dne' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: /Zápis za den Po 5\. 10\./ })).toBeTruthy();
    expect(screen.getByText(/Den zatím není zapsaný/)).toBeTruthy();
    const injuries = screen.getByLabelText('Úrazy v logistice') as HTMLInputElement;
    expect(injuries.value).toBe('0');
    const row = injuries.closest('tr')!;
    expect(row.querySelector('.kpi-dot')!.className).toContain('kpi-green');
    fireEvent.change(injuries, { target: { value: '1' } });
    expect(row.querySelector('.kpi-dot')!.className).toContain('kpi-red');
    // kategorie: pole pro každou kategorii
    expect(screen.getByLabelText('Logistické reklamace: Záměna dílu')).toBeTruthy();
    // nezapsané pracovní dny od prvního zápisu (víkend se nenabízí)
    expect([...document.querySelectorAll('.kpi-missing-days button')].map((b) => b.textContent)).toEqual(['Po 5. 10.']);
  });

  it('kliknutí na den otevře jeho zápis v kartě Zápis dne', () => {
    renderPage();
    // popisek dne v písmenu vyjmenuje ukazatele mimo cíl
    expect(cell('S', 2).getAttribute('title')).toBe('Pá 2. 10. – mimo cíl\n• Úrazy v logistice: 1 počet (≤ 0 · červená nad 0)');
    fireEvent.click(cell('Q', 2));
    expect(screen.getByRole('heading', { level: 2, name: /Zápis za den Pá 2\. 10\./ })).toBeTruthy();
    expect(screen.getByText('Zapsáno: Novák 5.10.2026 7:30')).toBeTruthy();
    expect((screen.getByLabelText('Úrazy v logistice') as HTMLInputElement).value).toBe('1');
  });

  it('pruh měsíců a přepnutí měsíce', () => {
    renderPage();
    const months = document.querySelectorAll('.kpi-card')[0]!.querySelectorAll('.kpi-month');
    expect(months).toHaveLength(12);
    // říjen: 1 z 2 zapsaných dní zelený → červená; listopad budoucí
    expect(months[9]!.className).toContain('kpi-red');
    expect(months[10]!.className).toContain('kpi-future');
    fireEvent.click(screen.getByRole('button', { name: 'Předchozí měsíc' }));
    expect(screen.getByText('Září 2026')).toBeTruthy();
  });

  it('pod S a Q Pareto kategorií za období, pod C, D, P denní sloupce ukazatele', () => {
    renderPage();
    const charts = () => [...document.querySelectorAll('.kpi-chart-card')];
    expect(charts().map((c) => c.querySelector('h3')!.textContent)).toEqual([
      'S Pareto · Leden–říjen 2026',
      'Q Pareto · Leden–říjen 2026',
      'C posledních 7 zapsaných dní',
      'D posledních 7 zapsaných dní',
      'P posledních 7 zapsaných dní',
    ]);
    // S: 1 úraz; Q: žádná reklamace
    expect(charts()[0]!.querySelector('title')!.textContent).toBe('Úrazy v logistice: 1, kumulativně 100 %');
    expect(charts()[1]!.textContent).toContain('Za období žádné události.');
    fireEvent.click(screen.getByRole('button', { name: 'Měsíc' }));
    expect(charts()[0]!.querySelector('h3')!.textContent).toBe('S Pareto · Říjen 2026');
    // C, D, P: všechny ukazatele písmene po dnech, barva podle stavu, klik otevře zápis
    const c = charts()[2]!;
    expect([...c.querySelectorAll('.kpi-days-head span')].map((x) => x.textContent)).toEqual(['Čt 1.', 'Pá 2.']);
    expect([...c.querySelectorAll('.kpi-days-cell')].map((x) => [x.textContent, x.className.replace('kpi-days-cell ', '')])).toEqual([
      ['0', 'kpi-green'],
      ['6k', 'kpi-red'],
    ]);
    expect(c.querySelector('.kpi-days-cell.kpi-red')!.getAttribute('title')).toMatch(/^Pá 2\. 10\. – Náklady na mimořádné přepravy: 6\s000 Kč – mimo cíl$/);
    // D: v zápisech chybí – písmeno nemá hodnoty
    expect(charts()[3]!.textContent).toContain('Zatím žádné zapsané dny.');
    fireEvent.click(c.querySelector('.kpi-days-cell.kpi-red')!);
    expect(screen.getByRole('heading', { level: 2, name: /Zápis za den Pá 2\. 10\./ })).toBeTruthy();
  });

  it('bez souboru KPI: úvodní sada ukazatelů', () => {
    renderPage(null);
    fireEvent.click(screen.getByRole('tab', { name: 'Zápis dne' }));
    expect(screen.getByLabelText('Chybí u zákazníka v prvních 2 dnech')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Přehled' }));
    expect(cell('S', 1).className).toContain('kpi-none');
  });
});
