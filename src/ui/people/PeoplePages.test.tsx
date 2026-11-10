import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { dayFromParts } from '../../core/dates';
import type { SkillData } from '../../core/skills';
import type { VacationData } from '../../core/vacations';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { SkillsProvider, VacationsProvider } from './drafts';
import { SkillsPage } from './SkillsPage';
import { VacationsPage } from './VacationsPage';

const day = (m: number, d: number, y = 2026) => dayFromParts(y, m, d)!;
const today = day(11, 10);

const vacations: VacationData = {
  people: [
    { name: 'Anna', team: 'Sklad' },
    { name: 'Petr', team: 'Expedice' },
  ],
  allowances: [{ person: 'Anna', year: 2026, entitlement: 25, carryOver: 3 }],
  entries: [
    { id: 1, person: 'Anna', from: day(11, 9), to: day(11, 12), half: false, status: 'approved', note: '' },
    { id: 2, person: 'Petr', from: day(11, 10), to: day(11, 10), half: false, status: 'planned', note: '' },
  ],
  maxAway: 1,
};

const skills: SkillData = {
  people: [
    { name: 'Anna', team: 'Sklad' },
    { name: 'Petr', team: 'Sklad' },
  ],
  activities: [{ name: 'VZV', area: 'Sklad', minQualified: 2 }],
  levels: { 'Anna|VZV': 4 },
  trainings: [{ name: 'BOZP', validityMonths: 12 }],
  records: [{ person: 'Anna', training: 'BOZP', date: day(11, 1, 2025), validUntil: day(11, 1) }],
};

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
    vacations: { path: 'Lide/Dovolene.xlsx', lastModified: 0, data: vacations },
    skills: { path: 'Lide/SkillMatrix.xlsx', lastModified: 0, data: skills },
    failed: [],
    loadedAt: 1,
  },
};

function renderPage(page: 'vacations' | 'skills') {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={state}>
        <VacationsProvider>
          <SkillsProvider>{page === 'vacations' ? <VacationsPage today={today} /> : <SkillsPage today={today} />}</SkillsProvider>
        </VacationsProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

const kpi = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains('kpi-label'))!.parentElement!;

describe('Dovolené', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('přehled, kalendář se souběhem nad limitem, nárok a schválení', () => {
    renderPage('vacations');
    expect(kpi('Dnes na dovolené').querySelector('.kpi-value')!.textContent).toBe('2');
    expect(kpi('Dnes na dovolené').querySelector('.kpi-note')!.textContent).toBe('Anna, Petr');
    const calendar = screen.getByRole('table', { name: /Kalendář/ });
    const anna = within(calendar).getByText('Anna').closest('tr')!;
    const cells = anna.querySelectorAll('td.vac-cell');
    expect(cells[8]!.className).toContain('vac-approved'); // 9. 11.
    expect(cells[13]!.className).toContain('vac-off'); // 14. 11. sobota
    const counts = calendar.querySelectorAll('tfoot td.vac-count');
    expect(counts[9]!.textContent).toBe('2');
    expect(counts[9]!.className).toContain('vac-over');
    // Nárok Anny: 25 + 3, vyčerpáno 9.–10. 11., naplánováno 11.–12. 11.
    const balance = screen.getByDisplayValue('25').closest('tr')!;
    expect([...balance.querySelectorAll('td.n')].slice(2).map((td) => td.textContent)).toEqual(['28', '2', '2', '24']);
    fireEvent.click(screen.getByRole('button', { name: 'Schválit' }));
    expect(screen.queryByRole('button', { name: 'Schválit' })).toBeNull();
    expect(screen.getByText('Neuložené změny')).toBeTruthy();
  });

  it('klik na pracovní den přidá dovolenou, editor ji upraví a smaže', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage('vacations');
    const calendar = screen.getByRole('table', { name: /Kalendář/ });
    const petr = within(calendar).getByText('Petr').closest('tr')!;
    fireEvent.click(petr.querySelectorAll('td.vac-cell')[19]!); // 20. 11.
    const editor = screen.getByRole('group', { name: 'Dovolená: Petr' });
    fireEvent.change(within(editor).getByLabelText('Do'), { target: { value: '2026-11-24' } });
    expect(within(editor).getByText('Pracovních dní: 3')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Schváleno' }));
    expect(petr.querySelectorAll('td.vac-cell')[23]!.className).toContain('vac-approved');
    fireEvent.click(within(editor).getByRole('button', { name: 'Smazat' }));
    expect(petr.querySelectorAll('td.vac-cell')[23]!.className).not.toContain('vac-approved');
  });

  it('přidání osoby a obsazené jméno', () => {
    renderPage('vacations');
    const input = screen.getByLabelText('Jméno nové osoby');
    fireEvent.change(input, { target: { value: 'Anna' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Přidat' }));
    expect(screen.getByText('Jméno je prázdné nebo už existuje.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Jan' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Přidat' }));
    expect(screen.getAllByDisplayValue('Jan')).toHaveLength(1);
  });
});

describe('Skill Matrix', () => {
  afterEach(cleanup);

  it('matice: klik zvýší úroveň, zástupnost a školení po platnosti', () => {
    renderPage('skills');
    expect(kpi('Bez zástupu').querySelector('.kpi-value')!.textContent).toBe('1');
    expect(kpi('Školení po platnosti').querySelector('.kpi-value')!.textContent).toBe('1');
    const matrix = screen.getByRole('table', { name: 'Matice dovedností' });
    expect(matrix.querySelector('tfoot strong')!.textContent).toBe('1/2');
    const petr = within(matrix).getByRole('button', { name: /^Petr · VZV: 0/ });
    for (let i = 0; i < 3; i++) fireEvent.click(within(matrix).getByRole('button', { name: /^Petr · VZV:/ }));
    expect(within(matrix).getByRole('button', { name: /^Petr · VZV: 3 – Samostatně/ })).toBeTruthy();
    expect(petr).toBeTruthy();
    expect(matrix.querySelector('tfoot strong')!.textContent).toBe('2/2');
    expect(kpi('Bez zástupu').querySelector('.kpi-value')!.textContent).toBe('0');
    // Školení: nové datum absolvování dopočítá platnost a zruší propadlé.
    const cell = screen.getByLabelText('Anna · BOZP');
    expect(cell.closest('td')!.className).toContain('skill-expired');
    fireEvent.change(cell, { target: { value: '2026-11-05' } });
    expect(cell.closest('td')!.className).toContain('skill-ok');
    expect(within(cell.closest('td')!).getByText('do 5. 11. 2027')).toBeTruthy();
  });
});
