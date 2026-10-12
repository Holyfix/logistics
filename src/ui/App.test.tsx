import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nProvider';
import { App } from './App';

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe('App', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('přepne jazyk a zapamatuje si ho', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Čeština' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Přehled' })).toBeTruthy();
    expect(localStorage.getItem('logistics-locale')).toBe('cs');
    expect(document.documentElement.lang).toBe('cs');
    expect(document.title).toBe('Logistics · Logistický přehled');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
  });

  it('upozorní, když prohlížeč neumí číst složky', () => {
    renderApp();
    expect(screen.getByRole('alert').textContent).toMatch(/Edge|Chrome/);
  });
});
