import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { dayFromParts } from '../../core/dates';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { OilPage } from './OilPage';
import { OilProvider } from './OilProvider';

const day = (n: number) => dayFromParts(2026, 10, n)!;

const state: DataState = {
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
    oil: {
      path: 'OIL/OIL.xlsx',
      lastModified: 0,
      list: {
        items: [
          { id: 1, problem: 'Chybí obaly', action: 'Objednat', owner: 'Logistika', opened: day(1), due: day(10), progress: 50, cancelled: false, closed: null, comments: [], shifts: [] },
          { id: 2, problem: 'Hotová věc', action: '', owner: 'Kvalita', opened: day(1), due: day(5), progress: 100, cancelled: false, closed: day(5), comments: [], shifts: [] },
        ],
      },
    },
    failed: [],
    loadedAt: 1,
  },
};

function renderPage() {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={state}>
        <OilProvider>
          <OilPage today={day(14)} />
        </OilProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

const kpi = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains('kpi-label'))!.parentElement!.querySelector('.kpi-value')!.textContent;
const row = (text: string) => screen.getAllByText(text).find((el) => el.tagName === 'STRONG')!.closest('tr')!;

describe('OilPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('body podle stavu, plnění kliknutím, posun termínu s důvodem a komentář', () => {
    renderPage();
    expect(kpi('Otevřené body')).toBe('1');
    expect(kpi('Po termínu')).toBe('1');
    // Výchozí filtr Otevřené: hotový bod není vidět.
    expect(screen.queryByText('Hotová věc')).toBeNull();
    expect(row('Chybí obaly').className).toContain('oil-overdue');

    // Kliknutí na kolečko: 50 → 75 %.
    fireEvent.click(within(row('Chybí obaly')).getByRole('button', { name: /Plnění 1: 50 %/ }));
    expect(within(row('Chybí obaly')).getByText('75 %')).toBeTruthy();
    expect(screen.getAllByText('Neuložené změny').length).toBeGreaterThan(0);

    // Detail: posun termínu vyžaduje jméno a důvod.
    fireEvent.click(row('Chybí obaly'));
    const detail = screen.getByRole('group', { name: 'Detail bodu 1' });
    fireEvent.change(within(detail).getByLabelText('Nový termín'), { target: { value: '2026-10-21' } });
    const shift = within(detail).getByRole('button', { name: 'Posunout termín' }) as HTMLButtonElement;
    expect(shift.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('pro komentáře a posuny'), { target: { value: 'Logistika' } });
    fireEvent.change(within(detail).getByLabelText('Důvod posunu'), { target: { value: 'Pozdní dodávka' } });
    expect(shift.disabled).toBe(false);
    fireEvent.click(shift);
    expect(within(row('Chybí obaly')).getByText('posunuto 1×')).toBeTruthy();
    expect(row('Chybí obaly').className).toContain('oil-progress');
    expect(within(detail).getByText(/Pozdní dodávka/)).toBeTruthy();
    expect(kpi('Posunuté termíny')).toBe('1 / 1');

    fireEvent.change(within(detail).getByLabelText('Přidat komentář'), { target: { value: 'Objednáno u dodavatele' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Přidat komentář' }));
    expect(within(detail).getByText(/Objednáno u dodavatele/)).toBeTruthy();
    expect(localStorage.getItem('logistics-user-name')).toBe('Logistika');

    // Nový bod a filtr Hotové.
    fireEvent.click(screen.getByRole('button', { name: '+ Nový bod' }));
    expect(screen.getByRole('group', { name: 'Detail bodu 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hotové' }));
    expect(row('Hotová věc').className).toContain('oil-done');
  });

  it('v seznamu jen první odstavec problému; trvalé smazání po potvrzení', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Vše' }));
    fireEvent.click(row('Chybí obaly'));
    const detail = screen.getByRole('group', { name: 'Detail bodu 1' });
    fireEvent.change(within(detail).getByLabelText('Problém'), { target: { value: 'Chybí obaly\n\nPříčina: málo vozíků' } });
    expect(row('Chybí obaly')).toBeTruthy();
    expect(screen.queryByText(/málo vozíků/, { selector: 'strong' })).toBeNull();

    // Plnění tlačítky PDCA: Check = 75 %, v seznamu písmeno fáze.
    fireEvent.click(within(detail).getByRole('button', { name: 'Check 75 %' }));
    expect(within(detail).getByRole('button', { name: 'Check 75 %' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(row('Chybí obaly')).getByText('C')).toBeTruthy();
    // Kritérium fáze a otázka pro další krok.
    expect(within(detail).getByText(/máme důkaz, že to funguje/)).toBeTruthy();
    expect(within(detail).getByText('Je to standard a můžeme bod uzavřít?')).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: 'Zavřít' }));

    // Smazání: bez potvrzení se nic nestane, po potvrzení bod zmizí.
    fireEvent.click(row('Hotová věc'));
    const confirm = window.confirm;
    try {
      window.confirm = () => false;
      fireEvent.click(screen.getByRole('button', { name: 'Smazat trvale' }));
      expect(row('Hotová věc')).toBeTruthy();
      window.confirm = () => true;
      fireEvent.click(screen.getByRole('button', { name: 'Smazat trvale' }));
    } finally {
      window.confirm = confirm;
    }
    expect(screen.queryByText('Hotová věc')).toBeNull();
    expect(screen.getAllByText('Neuložené změny').length).toBeGreaterThan(0);
  });
});
