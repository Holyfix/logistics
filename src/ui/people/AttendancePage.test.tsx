import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { parseAttendanceSheets } from '../../core/attendance';
import { decryptOffice, isEncryptedOffice, OfficeCryptoError } from '../../core/officeCrypto';
import type { Cell } from '../../core/table';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DataProvider, type DataState } from '../data/DataProvider';
import { AttendancePage } from './AttendancePage';
import { AttendanceProvider } from './AttendanceProvider';

// Worker v testu nahradí přímé rozšifrování a zpracování (stejné funkce jako ve workeru).
vi.mock('../../platform/loader', () => ({
  parseAttendance: async (file: { path: string; buffer: ArrayBuffer }, password: string) => {
    const encrypted = isEncryptedOffice(file.buffer);
    try {
      const plain = encrypted ? await decryptOffice(file.buffer, password) : file.buffer;
      const sheets = await readXlsxFile(Buffer.from(plain));
      return { id: 0, kind: 'attendance', encrypted, result: parseAttendanceSheets(sheets.map((s) => s.data as Cell[][])) };
    } catch (error) {
      return { id: 0, kind: 'attendance', encrypted, result: { ok: false, error: error instanceof OfficeCryptoError ? error.code : 'corrupt', columns: [] } };
    }
  },
}));

const sample = readFileSync('sample-data/Lide/Dochazka/pruchody_vzor_11-2026.xlsx');
const buffer = sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength);

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
    attendance: [{ path: 'Lide/Dochazka/pruchody_vzor_11-2026.xlsx', lastModified: 0, buffer }],
    failed: [],
    loadedAt: 1,
  },
};

function renderPage() {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <DataProvider initial={state}>
        <AttendanceProvider>
          <AttendancePage />
        </AttendanceProvider>
      </DataProvider>
    </I18nProvider>,
  );
}

describe('Docházka', () => {
  afterEach(cleanup);

  it('zamčená: špatné heslo nahlásí, správné odemkne přehled; Zamknout data zase skryje', async () => {
    renderPage();
    expect(screen.getByText(/Docházka je zamčená/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Heslo'), { target: { value: 'spatne' } });
    fireEvent.click(screen.getByRole('button', { name: 'Odemknout' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Špatné heslo.');
    fireEvent.change(screen.getByLabelText('Heslo'), { target: { value: 'vzor2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Odemknout' }));
    const table = await screen.findByRole('table', { name: 'Souhrn po lidech' }, { timeout: 5000 });
    const row = within(table).getByText('Nováková Jana').closest('tr')!;
    // Fond do dneška, odprac., saldo | evidence, uznáno, k uznání | HO, sl. cesta | dovolená, lékař, nemoc, NV (nuly prázdné).
    expect([...row.querySelectorAll('td.n')].map((td) => td.textContent)).toEqual(['56,0', '53,5', '+1,5', '+1,5', '1,5', '', '1,5', '', '', '0,5', '', '']);
    const kpi = screen.getAllByText('Home office').find((el) => el.classList.contains('kpi-label'))!.parentElement!;
    expect(kpi.querySelector('.kpi-value')!.textContent).toBe('1,5');
    // Kalendář: 9. 11. home office, 10. 11. půl dne HO.
    const calendar = screen.getByRole('table', { name: 'Kalendář měsíce' });
    const cells = within(calendar).getByText('Nováková Jana').closest('tr')!.querySelectorAll('td.att-cell');
    expect(cells[8]!.textContent).toBe('HO');
    expect(cells[9]!.textContent).toBe('½HO');
    expect(cells[2]!.className).toContain('att-L');
    // Řazení podle dovolené: Kučera první.
    fireEvent.click(within(table).getByRole('button', { name: 'Dovolená' }));
    expect(within(table).getAllByRole('row')[2]!.textContent).toContain('Kučera Petr');
    fireEvent.click(screen.getByRole('button', { name: '🔒 Zamknout' }));
    await waitFor(() => expect(screen.queryByText('Nováková Jana')).toBeNull());
    expect(screen.getByText(/Docházka je zamčená/)).toBeTruthy();
  }, 20000);
});
