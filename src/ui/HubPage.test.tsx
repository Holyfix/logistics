import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseCallOffExport, type CallOffExport } from '../core/calloffs/parse';
import { parseCsv } from '../core/csv';
import { I18nProvider } from '../i18n/I18nProvider';
import { DataProvider, type DataState } from './data/DataProvider';
import { HubPage } from './HubPage';

function exportOf(name: string, lines: string[]): CallOffExport {
  const r = parseCallOffExport(parseCsv(['Item Number,Date,Discrete Qty', ...lines].join('\n')), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const cw41 = exportOf('Odvolavky_CW41.csv', ['1001,12.10.2026,100', '1002,13.10.2026,50']);
const cw42 = exportOf('Odvolavky_CW42.csv', ['1001,12.10.2026,150', '1002,13.10.2026,50']);

function renderHub(exports: CallOffExport[] | null) {
  localStorage.setItem('logistics-locale', 'cs');
  const state: DataState = {
    status: exports ? 'ready' : 'noFolder',
    folderName: 'data',
    progress: null,
    error: '',
    data: exports ? { folderName: 'data', exports, master: null, coverage: [], failed: [], loadedAt: 0 } : null,
  };
  return render(
    <I18nProvider>
      <DataProvider initial={state}>
        <HubPage />
      </DataProvider>
    </I18nProvider>,
  );
}

const callOffsLink = () => screen.getByRole('link', { name: /Call-offs/ });

describe('HubPage', () => {
  afterEach(cleanup);

  it('u Call-offs ukáže počet významných změn proti předchozímu exportu', () => {
    renderHub([cw41, cw42]);
    const metric = callOffsLink().querySelector('.metric')!;
    expect(metric.textContent).toBe('1 změna');
    expect(metric.querySelector('.dot-warn')).not.toBeNull();
    expect(metric.getAttribute('title')).toContain('CW 42/2026 proti exportu CW 41/2026');
  });

  it('s jedním exportem ukáže týden aktuálního exportu', () => {
    renderHub([cw42]);
    expect(callOffsLink().querySelector('.metric')!.textContent).toBe('CW 42 aktuální export');
  });

  it('bez dat číslo nezobrazí', () => {
    renderHub(null);
    expect(callOffsLink().querySelector('.metric')).toBeNull();
  });
});
