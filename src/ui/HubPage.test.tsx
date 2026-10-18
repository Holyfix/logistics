import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseCallOffExport, type CallOffExport } from '../core/calloffs/parse';
import { parseCsv } from '../core/csv';
import { I18nProvider } from '../i18n/I18nProvider';
import { DataProvider, type DataState } from './data/DataProvider';
import { HubPage } from './HubPage';
import { OilProvider } from './oil/OilProvider';
import type { OilList } from '../core/oil';
import { dayFromParts } from '../core/dates';
import { defaultKpis, previousWorkday, withEntry, type KpiData } from '../core/kpi';
import { cs } from '../i18n/cs';
import { localToday } from './components/useComponents';

function exportOf(name: string, lines: string[]): CallOffExport {
  const r = parseCallOffExport(parseCsv(['Item Number,Date,Discrete Qty', ...lines].join('\n')), name);
  if (!r.ok) throw new Error();
  return r.value;
}

const cw41 = exportOf('Odvolavky_CW41.csv', ['1001,12.10.2026,100', '1002,13.10.2026,50']);
const cw42 = exportOf('Odvolavky_CW42.csv', ['1001,12.10.2026,150', '1002,13.10.2026,50']);

function renderHub(exports: CallOffExport[] | null, oil: OilList | null = null, kpi: KpiData | null = null) {
  localStorage.setItem('logistics-locale', 'cs');
  const state: DataState = {
    status: exports ? 'ready' : 'noFolder',
    folderName: 'data',
    progress: null,
    error: '',
    data: exports ? { folderName: 'data', exports, master: null, coverage: [], stock: null, boms: [], plans: [], planSettings: null, oil: oil && { path: 'OIL/OIL.xlsx', lastModified: 0, list: oil }, kpi: kpi && { path: 'KPI/KPI.xlsx', lastModified: 0, data: kpi }, failed: [], loadedAt: 0 } : null,
  };
  return render(
    <I18nProvider>
      <DataProvider initial={state}>
        <OilProvider>
          <HubPage />
        </OilProvider>
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

  it('u OIL ukáže body po termínu', () => {
    const day = (offset: number) => dayFromParts(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())! + offset;
    const item = (id: number, due: number, progress: 0 | 100 = 0) => ({ id, problem: '', action: '', owner: '', opened: day(-30), due: day(due), progress, cancelled: false, closed: null, comments: [], shifts: [] });
    renderHub([cw42], { items: [item(1, -2), item(2, 3), item(3, -5, 100), item(4, 20)] });
    const metric = screen.getByRole('link', { name: /OIL/ }).querySelector('.metric')!;
    expect(metric.textContent).toBe('1 po termínu');
    expect(metric.querySelector('.dot-crit')).not.toBeNull();
    expect(metric.getAttribute('title')).toBe('OIL: 1 po termínu, 1 termín do 7 dní, 3 otevřených');
  });

  it('u KPI písmena SQCDP obarvená podle předchozího pracovního dne', () => {
    const day = previousWorkday(localToday());
    const kpi = withEntry(defaultKpis(cs.kpi.defaults), { day, author: '', at: '', values: { s_injury: 1, 'q_claims|Záměna dílu': 0, d_customer: 5 } });
    renderHub([cw42], null, kpi);
    const badges = [...screen.getByRole('link', { name: /KPI/ }).querySelectorAll('.hub-kpi-letter')];
    expect(badges.map((b) => b.textContent)).toEqual(['S', 'Q', 'C', 'D', 'P']);
    expect(badges.map((b) => b.className.replace('hub-kpi-letter ', ''))).toEqual(['hub-kpi-red', 'hub-kpi-green', 'hub-kpi-none', 'hub-kpi-yellow', 'hub-kpi-none']);
  });

  it('u KPI bez zápisu jsou písmena šedá', () => {
    renderHub([cw42]);
    const badges = [...screen.getByRole('link', { name: /KPI/ }).querySelectorAll('.hub-kpi-letter')];
    expect(badges.every((b) => b.className.includes('hub-kpi-none'))).toBe(true);
  });

  it('bez dat číslo nezobrazí', () => {
    renderHub(null);
    expect(callOffsLink().querySelector('.metric')).toBeNull();
  });
});
