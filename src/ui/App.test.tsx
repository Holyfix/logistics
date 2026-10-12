import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nProvider';
import { App } from './App';
import { DataProvider } from './data/DataProvider';
import { MODULES } from './modules';

function renderApp() {
  return render(
    <I18nProvider>
      <DataProvider>
        <App />
      </DataProvider>
    </I18nProvider>,
  );
}

function navigate(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });
  afterEach(cleanup);

  it('přepne jazyk a zapamatuje si ho', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Čeština' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Rozcestník' })).toBeTruthy();
    expect(localStorage.getItem('logistics-locale')).toBe('cs');
    expect(document.documentElement.lang).toBe('cs');
    expect(document.title).toBe('Rozcestník · Logistics');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('ukáže na rozcestníku dlaždici pro každý modul', () => {
    renderApp();
    for (const m of MODULES) {
      expect(document.querySelector(`a.hub-item[href="#${m.id}"]`), m.id).not.toBeNull();
    }
  });

  it('otevře modul z dlaždice a vrátí se na rozcestník', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Čeština' }));
    navigate('#calloffs');
    expect(screen.getByRole('heading', { level: 1, name: 'Call-offs' })).toBeTruthy();
    expect(document.title).toBe('Call-offs · Logistics');

    navigate('');
    expect(screen.getByRole('heading', { level: 1, name: 'Rozcestník' })).toBeTruthy();
  });

  it('neznámá adresa vede na rozcestník', () => {
    window.location.hash = '#neexistuje';
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('upozorní, když si prohlížeč neumí zapamatovat složku', () => {
    renderApp();
    expect(screen.getByRole('status').textContent).toMatch(/Edge|Chrome/);
  });
});
