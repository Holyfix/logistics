import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { dayFromParts } from '../../core/dates';
import type { PackItem } from '../../core/packaging';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { PackagingPage } from './PackagingPage';
import { PackagingProvider } from './drafts';

const day = (n: number) => dayFromParts(2026, 11, n)!;
const today = day(12); // čtvrtek

const item = (id: number, title: string, steps: PackItem['steps'], extra: Partial<PackItem> = {}): PackItem => ({ id, title, project: 'P100', note: '', created: day(1), cancelled: false, steps, comments: [], shifts: [], ...extra });

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
    oil: null,
    kpi: null,
    packaging: {
      path: 'Obaly/Obaly.xlsx',
      lastModified: 0,
      list: {
        items: [
          item(1, 'Rack IP', [
            { text: 'Výpočet množství', owner: 'Novák', due: day(5), done: day(5) },
            { text: 'Potvrzení termínu', owner: 'Svoboda', due: day(10), done: null },
            { text: 'Dodání', owner: 'Svoboda', due: null, done: null },
          ]),
          item(2, 'KLT 3dílné', [{ text: 'Hledání dodavatele', owner: 'Černá', due: day(13), done: null }], { project: 'P200', note: 'Prototyp hotový' }),
          item(3, 'Kryt hotový', [{ text: 'Dodání', owner: 'Novák', due: day(3), done: day(3) }]),
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
        <PackagingProvider>
          <PackagingPage today={today} />
        </PackagingProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

const kpi = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains('kpi-label'))!.parentElement!.querySelector('.kpi-value')!.textContent;
const row = (text: string) => screen.getAllByText(text).find((el) => el.tagName === 'STRONG' && el.closest('tr')?.classList.contains('oil-row'))!.closest('tr')!;

describe('PackagingPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('na co se čeká, kdo a do kdy; splnění kroku posune bod dál; posun termínu s důvodem', () => {
    renderPage();
    expect(kpi('Otevřené body')).toBe('2');
    expect(kpi('Po termínu')).toBe('1');
    expect(kpi('Tento týden')).toBe('1');
    expect(kpi('Kroky bez termínu')).toBe('1');
    // Hotový bod ve výchozím filtru není; po termínu nahoře.
    expect(screen.queryByText('Kryt hotový')).toBeNull();
    const rows = screen.getAllByRole('row').filter((r) => r.classList.contains('oil-row'));
    expect(rows.map((r) => r.className.match(/pack-(\w+)/)![1])).toEqual(['overdue', 'week']);
    const rack = row('Rack IP');
    expect(within(rack).getByText('Potvrzení termínu').tagName).toBe('STRONG');
    expect(rack.textContent).toContain('Svoboda');
    expect(rack.textContent).toContain('po termínu 2 d');
    expect(rack.textContent).toContain('✓ Výpočet množství');
    expect(rack.querySelectorAll('.pack-dot').length).toBe(3);
    expect(row('KLT 3dílné').textContent).toContain('P200 · Prototyp hotový');

    // Detail: splnit aktuální krok → čeká se na Dodání (bez termínu).
    fireEvent.click(rack);
    fireEvent.click(screen.getByRole('button', { name: 'Splněno 2' }));
    expect(within(row('Rack IP')).getByText('Dodání').tagName).toBe('STRONG');
    expect(kpi('Po termínu')).toBe('0');
    expect(screen.getByText('Neuložené změny')).toBeTruthy();

    // Termín poprvé se nastaví hned; změna je posun s důvodem a jménem.
    fireEvent.change(screen.getByLabelText('Termín 3'), { target: { value: '2026-11-20' } });
    expect(row('Rack IP').textContent).toContain('CW 47');
    fireEvent.change(screen.getByLabelText('Termín 3'), { target: { value: '2026-11-27' } });
    const shift = screen.getByRole('button', { name: 'Posunout termín' }) as HTMLButtonElement;
    expect(shift.disabled).toBe(true);
    fireEvent.change(screen.getAllByLabelText('Vaše jméno')[0]!, { target: { value: 'Novák' } });
    fireEvent.change(screen.getByLabelText('Důvod posunu 3'), { target: { value: 'dodavatel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Posunout termín' }));
    expect(row('Rack IP').textContent).toContain('posunuto 1×');
    expect(screen.getByText(/dodavatel$/)).toBeTruthy();

    // Nový krok a filtr Kdo podle aktuálního kroku.
    fireEvent.click(screen.getByRole('button', { name: '+ Přidat krok' }));
    expect(screen.getByLabelText('Krok 4')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Kdo'), { target: { value: 'Černá' } });
    expect(screen.getAllByRole('row').filter((r) => r.classList.contains('oil-row')).map((r) => r.textContent)).toHaveLength(2); // otevřený detail zůstává
  });

  it('nový bod a filtr Hotové', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Hotové' }));
    expect(row('Kryt hotový').className).toContain('pack-done');
    fireEvent.click(screen.getByRole('button', { name: '+ Nový bod' }));
    expect(screen.getByLabelText('Krok 1')).toBeTruthy();
    expect(kpi('Otevřené body')).toBe('3');
  });
});
