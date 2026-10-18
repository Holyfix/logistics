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
kpi = withEntry(kpi, { day: day(1), author: 'Novák', at: '2.10.2026 7:30', values: { s_injury: 0, 'q_claims|Záměna dílu': 0 } });
kpi = withEntry(kpi, { day: day(2), author: 'Novák', at: '5.10.2026 7:30', values: { s_injury: 1, 'q_claims|Záměna dílu': 0 } });

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
    expect([...document.querySelectorAll('.kpi-letter')].map((l) => l.textContent)).toEqual(['S', 'Q', 'C', 'D', 'P']);
    expect(cell('S', 1).className).toContain('kpi-green');
    expect(cell('S', 2).className).toContain('kpi-red');
    expect(cell('S', 3).className).toContain('kpi-none'); // sobota
    expect(cell('S', 5).className).toContain('kpi-missing'); // pondělí bez zápisu
    expect(cell('S', 7).className).toContain('kpi-future');
    // říjen má 31 dní – všechna políčka jsou dny
    expect(document.querySelectorAll('.kpi-card')[0]!.querySelectorAll('.kpi-pad')).toHaveLength(0);
    expect(screen.getAllByText('v cíli 1 z 2 dní')[0]).toBeTruthy();
  });

  it('zápis nabízí předchozí pracovní den, stav se počítá při psaní', () => {
    renderPage();
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
  });

  it('kliknutí na den otevře jeho zápis', () => {
    renderPage();
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

  it('bez souboru KPI: úvodní sada ukazatelů', () => {
    renderPage(null);
    expect(screen.getByLabelText('Chybí u zákazníka v prvních 2 dnech')).toBeTruthy();
    expect(cell('S', 1).className).toContain('kpi-none');
  });
});
