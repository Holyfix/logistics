import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dayFromParts } from '../core/dates';
import { I18nProvider } from '../i18n/I18nProvider';
import { MaterialApp } from './MaterialApp';

const line = (cells: string[]) => `"${cells.map((c, i) => (i === 0 ? c : `""${c}""`)).join(',')}"`;
const jit = [
  line(['JIT order number', 'Item', 'Last priority', 'Production number', 'Assembly date', 'Article number (Pos)', 'Article description (Pos)']),
  line(['1', '1', 'Container planned', 'V1', '05/11/2026 08:00:00', 'P-FL', 'ASSY DP SR1 FRT LH']),
  line(['2', '1', 'Container planned', 'V2', '05/11/2026 09:00:00', 'P-FL', 'ASSY DP SR1 FRT LH']),
  line(['3', '1', 'Container planned', 'V3', '06/11/2026 07:00:00', 'P-FL', 'ASSY DP SR1 FRT LH']),
].join('\r\n');
const matrix = ['Lot;Production number;Option Type;MC / MF;Planned customer built;Status FL;Status FR;Status RL;Status RR;Status HB', '7;V1;SR1;C1 / C1;05.11.2026 08:00;20 - Container planned;;;;', '7;V2;SR1;C1 / C1;05.11.2026 09:00;30 - Sequencelabel printed;;;;', '8;V3;SR1;C1 / C1;06.11.2026 07:00;20 - Container planned;;;;', '8;V9;SR1;C1 / C1;06.11.2026 08:00;20 - Container planned;;;;'].join('\n');
const bom = ['Level;Component Item;Description;Quantity Per', 'Parent;P-FL;ASSY DP SR1 FRT LH;', '1;MC-1;ASSY MC SR1 FRT LH;1', '1;MF-1;ASSY MF SR1 FRT LH;1'].join('\n');

function renderApp() {
  localStorage.setItem('logistics-locale', 'cs');
  return render(
    <I18nProvider>
      <MaterialApp today={dayFromParts(2026, 11, 5)!} />
    </I18nProvider>,
  );
}

const rowOf = (item: string) => screen.getAllByText(item).find((el) => el.tagName === 'STRONG')!.closest('tr')!;
const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent);

describe('MaterialApp', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('Matrix: vozy z matice, panel z JIT, barva dveří podle skladu; Díly a sklad se zadáním skladu', async () => {
    renderApp();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([matrix], 'Matrix.csv'), new File([jit], 'JIT_Overview.csv'), new File([bom], 'BOM.csv')] } });
    await waitFor(() => expect(screen.getByText('V9')).toBeTruthy());
    expect(screen.getByText(/Order Status Matrix: 4 vozů/)).toBeTruthy();
    // bez skladu chybí; V9 není v JIT
    const door = (pn: string) => rowOf(pn).querySelectorAll('td')[5]!;
    expect(door('V1').className).toContain('mat-short');
    expect(door('V1').textContent).toBe('20 - Container plannedMC ✗ · MF ✗');
    expect(door('V9').className).toContain('mat-unknown');
    expect(door('V9').textContent).toBe('20 - Container plannednení v JIT');
    // sklad MC 2 a MF 5 v kartě Díly a sklad
    fireEvent.click(screen.getByRole('tab', { name: 'Díly a sklad' }));
    fireEvent.change(screen.getByLabelText('Sklad MC-1'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('Sklad MC-1'));
    expect(cells(rowOf('MC-1')).slice(3)).toEqual(['3', 'Čt 5. 11. 09:00 · V2 FLChybí od Pá 6. 11. 07:00 · V3 FL', '0', '-1']);
    expect(JSON.parse(localStorage.getItem('material-stock')!).items).toEqual({ 'MC-1': 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Vložit sklad z Excelu' }));
    fireEvent.change(screen.getByLabelText('Vložit sklad z Excelu'), { target: { value: 'MF-1\t5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Použít' }));
    // detail: dveře se zbývajícím skladem
    fireEvent.click(rowOf('MC-1'));
    const detail = within(screen.getByRole('region', { name: 'Zakázky MC-1' }));
    expect(detail.getAllByRole('row').slice(1).map((r) => cells(r).at(-1))).toEqual(['1', '0', '-1']);
    // zpět v Matrixu: V1 a V2 pokryté, V3 chybí MC
    fireEvent.click(screen.getByRole('tab', { name: 'Matrix' }));
    expect(door('V2').className).toContain('mat-ok');
    expect(door('V3').textContent).toBe('20 - Container plannedMC ✗ · MF ✓');
  });
});
