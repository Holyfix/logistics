import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { OilList } from '../../core/oil';
import type { LoadedData } from '../../platform/loader';
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

function renderPage(checkOil?: () => Promise<LoadedData['oil']>) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={state} checkOil={checkOil}>
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
    vi.useRealTimers();
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

  it('novější OIL ve složce (uložil ho kolega) se načte sám; s neuloženými změnami se nabídne', async () => {
    vi.useFakeTimers();
    const saved = state.data!.oil!;
    const newer: OilList = {
      items: saved.list.items.map((i) => (i.id === 1 ? { ...i, comments: [{ at: '15.10.2026 9:00', author: 'Kolegyně', text: 'Dodavatel potvrdil' }] } : i)),
    };
    let next: LoadedData['oil'] = { ...saved, lastModified: 10, list: newer };
    renderPage(async () => {
      const result = next;
      next = null;
      return result;
    });
    expect(row('Chybí obaly').querySelectorAll('td')[6]!.textContent).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(row('Chybí obaly').querySelectorAll('td')[6]!.textContent).toBe('1');

    // S neuloženými změnami: novější verze se jen nabídne.
    fireEvent.click(within(row('Chybí obaly')).getByRole('button', { name: /Plnění 1/ }));
    next = { ...saved, lastModified: 20, list: { items: newer.items.map((i) => ({ ...i, owner: 'Nákup' })) } };
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(within(row('Chybí obaly')).getByText('75 %')).toBeTruthy();
    expect(within(row('Chybí obaly')).getByText('Logistika')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Načíst novější a zahodit mé změny' }));
    expect(within(row('Chybí obaly')).getByText('Nákup')).toBeTruthy();
    expect(within(row('Chybí obaly')).getByText('50 %')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Načíst novější a zahodit mé změny' })).toBeNull();
  });
});
