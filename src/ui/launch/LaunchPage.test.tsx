import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { dayFromParts } from '../../core/dates';
import type { LaunchItem } from '../../core/launch';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { LaunchPage } from './LaunchPage';
import { LaunchProvider } from './LaunchProvider';

const day = (m: number, d: number, y = 2026) => dayFromParts(y, m, d)!;
const today = day(11, 6);

const item = (over: Partial<LaunchItem>): LaunchItem => ({
  id: 1,
  project: 'Projekt A',
  phase: '',
  name: '',
  kind: 'task',
  start: null,
  end: null,
  baseline: null,
  owner: '',
  customer: false,
  parent: null,
  progress: 0,
  note: '',
  ...over,
});

const state = (withLaunch = true): DataState => ({
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
    ...(withLaunch
      ? {
          launch: {
            path: 'Launch/Launch.xlsx',
            lastModified: 0,
            plan: {
              projects: [
                { name: 'Projekt A', description: 'Zákazník 1' },
                { name: 'Projekt B', description: '' },
              ],
              items: [
                item({ id: 1, phase: 'Testy', name: 'Díly pro test 1', kind: 'milestone', end: day(1, 11, 2027), customer: true }),
                item({ id: 2, phase: 'Testy', name: 'Obaly schválené', start: day(10, 20), end: day(11, 3), progress: 50, owner: 'Nákup' }),
                item({ id: 3, phase: 'Kvalita', name: 'Díly s PPA', kind: 'milestone', end: day(11, 11), baseline: day(11, 4), owner: 'Kvalita' }),
                item({ id: 4, project: 'Projekt B', name: 'SOP', kind: 'milestone', end: day(5, 1, 2027), progress: 100 }),
                item({ id: 5, phase: 'Kvalita', name: 'PPA zákazník', kind: 'milestone', end: day(11, 1), customer: true }),
              ],
            },
          },
        }
      : {}),
    failed: [],
    loadedAt: 1,
  },
});

function renderPage(withLaunch = true) {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={state(withLaunch)}>
        <LaunchProvider>
          <LaunchPage today={today} />
        </LaunchProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

const kpi = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains('kpi-label'))!.parentElement!;
const names = () =>
  screen
    .getAllByRole('row')
    .slice(2)
    .map((r) => r.querySelector('.gantt-name')?.textContent?.replace(/[▸▾✎]/g, '').trim())
    .filter(Boolean);
const row = (name: string) => screen.getAllByRole('row').find((r) => r.querySelector('.gantt-name')?.textContent?.includes(name))!;

describe('LaunchPage', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('Gantt: zákaznické termíny barvou podle fáze, interní podle plnění, posun termínu a přehled nahoře', () => {
    renderPage();
    expect(names()).toEqual(['Projekt AZákazník 1', 'Testy', 'Obaly schválené', 'Díly pro test 1', 'Kvalita', 'PPA zákazník', 'Díly s PPA', 'Projekt B', 'SOP']);
    // Projekt: plnění jen z interních řádků, termín = nejpozdější datum, po termínu kvůli internímu úkolu.
    expect(row('Projekt A').querySelector('.gantt-progress')!.textContent).toBe('25 %');
    expect(row('Projekt A').querySelector('.gantt-due')!.textContent).toBe('11. 1. 2027');
    expect(row('Projekt A').querySelector('.gantt-sum')!.classList.contains('gantt-overdue')).toBe(true);
    // Interní: barva podle plnění.
    expect(row('Obaly schválené').querySelector('.gantt-bar')!.className).toContain('gantt-overdue');
    expect(row('Díly s PPA').querySelector('.gantt-ms')!.className).toContain('gantt-open');
    expect(row('SOP').querySelector('.gantt-ms')!.className).toContain('gantt-done');
    // Zákaznické: barva podle fáze (Kvalita má první zákaznický termín), proběhlé světle, bez plnění.
    expect(row('PPA zákazník').querySelector('.gantt-ms')!.className).toContain('gantt-c0 gantt-passed');
    expect(row('Díly pro test 1').querySelector('.gantt-ms')!.className).toContain('gantt-c1');
    expect(row('Díly pro test 1').querySelector('.gantt-progress')!.textContent).toBe('—');
    expect(row('Díly pro test 1').querySelector('.gantt-owner')!.textContent).toBe('zákazník');
    expect(row('Kvalita').querySelector('.gantt-swatch')!.className).toContain('gantt-c0');
    expect(row('Díly s PPA').querySelector('.gantt-base')).toBeTruthy();
    expect(row('Díly s PPA').querySelector('.gantt-shift')!.textContent).toBe('posun +7 d');
    expect(screen.getByText('Dnes')).toBeTruthy();
    expect(kpi('Po termínu').querySelector('.kpi-value')!.textContent).toBe('1');
    expect(kpi('Plnění interních').querySelector('.kpi-value')!.textContent).toBe('50 %');
    expect(kpi('Nejbližší milník').querySelector('.kpi-value')!.textContent).toBe('11. 11. 2026');
    expect(kpi('Nejbližší milník').querySelector('.kpi-note')!.textContent).toBe('za 5 d · Projekt A · Díly s PPA');
  });

  it('klik na projekt a fázi je sbalí; bod ve sbaleném projektu otevře řádek; filtry', () => {
    renderPage();
    fireEvent.click(row('Testy'));
    expect(names()).toEqual(['Projekt AZákazník 1', 'Testy', 'Kvalita', 'PPA zákazník', 'Díly s PPA', 'Projekt B', 'SOP']);
    fireEvent.click(row('Projekt A'));
    expect(names()).toEqual(['Projekt AZákazník 1', 'Projekt B', 'SOP']);
    // Ve sbaleném projektu jsou body vidět a kliknutím se řádek otevře (projekt i fáze se rozbalí).
    fireEvent.click(within(row('Projekt A')).getByRole('button', { name: /^Díly pro test 1 · / }));
    expect(screen.getByRole('group', { name: 'Úprava: Díly pro test 1' })).toBeTruthy();
    expect(names()).toContain('Obaly schválené');
    fireEvent.click(within(screen.getByRole('group', { name: 'Úprava: Díly pro test 1' })).getByRole('button', { name: 'Zavřít' }));
    fireEvent.change(screen.getByLabelText('Odpovědný'), { target: { value: 'Kvalita' } });
    expect(names()).toEqual(['Projekt AZákazník 1', 'Kvalita', 'Díly s PPA']);
    fireEvent.change(screen.getByLabelText('Odpovědný'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Po termínu' }));
    expect(names()).toEqual(['Projekt AZákazník 1', 'Testy', 'Obaly schválené']);
  });

  it('úprava: klik na bod v Ganttu, posun termínu, zdroj, plnění a typ; nový projekt; smazání', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(within(row('Díly pro test 1')).getByRole('button', { name: /^Díly pro test 1 · / }));
    const detail = screen.getByRole('group', { name: 'Úprava: Díly pro test 1' });
    fireEvent.change(within(detail).getByLabelText('Termín'), { target: { value: '2027-01-18' } });
    expect(within(detail).getByText(/Posunuto o \+7 d proti původnímu termínu 11\. 1\. 2027\./)).toBeTruthy();
    // Termín zákazníka plnění nemá; po přepnutí na interní ano.
    expect(within(detail).queryByRole('button', { name: '75' })).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Interní' }));
    fireEvent.click(within(detail).getByRole('button', { name: '75' }));
    expect(row('Díly pro test 1').querySelector('.gantt-progress')!.textContent).toBe('75 %');
    expect(row('Díly pro test 1').querySelector('.gantt-ms')!.className).toContain('gantt-advanced');
    fireEvent.click(within(detail).getByRole('button', { name: 'Úkol' }));
    expect(within(detail).getByLabelText('Začátek')).toHaveProperty('value', '2027-01-18');
    expect(screen.getByText('Neuložené změny')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+ Nový projekt' }));
    const project = screen.getByRole('group', { name: 'Projekt: Nový projekt' });
    fireEvent.change(within(project).getByLabelText('Název projektu'), { target: { value: 'Projekt B' } });
    fireEvent.blur(within(project).getByLabelText('Název projektu'));
    expect(within(project).getByText('Název je prázdný nebo už ho má jiný projekt.')).toBeTruthy();
    fireEvent.change(within(project).getByLabelText('Název projektu'), { target: { value: 'Projekt C' } });
    fireEvent.blur(within(project).getByLabelText('Název projektu'));
    const renamed = screen.getByRole('group', { name: 'Projekt: Projekt C' });
    fireEvent.click(within(renamed).getByRole('button', { name: '+ Termín zákazníka' }));
    const ms = screen.getByRole('group', { name: 'Úprava: (bez názvu)' });
    expect(within(ms).getByRole('button', { name: 'Zákazník' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(within(ms).getByLabelText('Název'), { target: { value: 'Kick-off' } });
    expect(names().slice(-2)).toEqual(['Projekt C', 'Kick-off']);
    fireEvent.click(within(screen.getByRole('group', { name: 'Úprava: Kick-off' })).getByRole('button', { name: 'Smazat' }));
    expect(names().slice(-2)).toEqual(['Projekt C', 'Projekt zatím nemá úkoly ani milníky – přidáte je přes  u projektu.']);
    fireEvent.click(screen.getByRole('button', { name: 'Upravit projekt: Projekt C' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Projekt: Projekt C' })).getByRole('button', { name: 'Smazat projekt' }));
    expect(names()).not.toContain('Projekt C');
  });

  it('vlastní bod k milníku: čára od dneška pod milníkem, termín se drží milníku', () => {
    renderPage();
    fireEvent.click(within(row('Díly pro test 1')).getByRole('button', { name: /^Díly pro test 1 · / }));
    fireEvent.click(screen.getByRole('button', { name: '+ Vlastní bod do tohoto milníku' }));
    const detail = screen.getByRole('group', { name: 'Úprava: (bez názvu)' });
    fireEvent.change(within(detail).getByLabelText('Název'), { target: { value: 'Obaly k dispozici' } });
    expect(names()).toEqual(['Projekt AZákazník 1', 'Testy', 'Obaly schválené', 'Díly pro test 1', '↳Obaly k dispozici', 'Kvalita', 'PPA zákazník', 'Díly s PPA', 'Projekt B', 'SOP']);
    const line = row('Obaly k dispozici').querySelector('.gantt-bar')!;
    expect(line.className).toContain('gantt-line');
    expect(line.className).toContain('gantt-open');
    expect(within(row('Obaly k dispozici')).getByText('11. 1. 2027')).toBeTruthy();
    const editor = screen.getByRole('group', { name: 'Úprava: Obaly k dispozici' });
    expect(within(editor).getByLabelText('Začátek')).toHaveProperty('value', '2026-11-06');
    expect(within(editor).getByLabelText('Konec')).toHaveProperty('disabled', true);
    expect(within(editor).getByText(/Navazuje na milník „Díly pro test 1“ \(11\. 1\. 2027\)\./)).toBeTruthy();
    // Posun milníku posune i bod.
    fireEvent.click(within(row('Díly pro test 1')).getByRole('button', { name: /^Díly pro test 1 · / }));
    fireEvent.change(within(screen.getByRole('group', { name: 'Úprava: Díly pro test 1' })).getByLabelText('Termín'), { target: { value: '2027-01-25' } });
    expect(within(row('Obaly k dispozici')).getByText('25. 1. 2027')).toBeTruthy();
  });

  it('bez souboru: prázdný Launch s výzvou založit projekt', () => {
    renderPage(false);
    expect(screen.getByText('Zatím žádný projekt. Začněte tlačítkem Nový projekt.')).toBeTruthy();
  });
});
