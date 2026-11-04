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
    const badges = (pn: string) => [...door(pn).querySelectorAll('.mat-badge')].map((b) => `${b.textContent} ${b.className.split('mat-badge-')[1]}`);
    expect(door('V1').className).toContain('mat-s20');
    expect(door('V2').className).toContain('mat-s30');
    expect(badges('V1')).toEqual(['MF short']);
    expect(badges('V9')).toEqual(['MF unknown']);
    // sloupec Materiál: jen Middlefield, Maincarrier se nepočítá
    const material = (pn: string) => rowOf(pn).querySelector('td.mat-missing')!.textContent;
    expect(material('V1')).toBe('FL: MF-1');
    expect(material('V9')).toBe('není v JIT');
    // sklad MF 1 v kartě Díly a sklad
    fireEvent.click(screen.getByRole('tab', { name: 'Díly a sklad' }));
    expect(screen.queryByLabelText('Sklad MC-1')).toBeNull();
    fireEvent.change(screen.getByLabelText('Sklad MF-1'), { target: { value: '1' } });
    fireEvent.blur(screen.getByLabelText('Sklad MF-1'));
    expect(cells(rowOf('MF-1')).slice(3)).toEqual(['3', 'Čt 5. 11. 08:00 · V1 FLChybí od Čt 5. 11. 09:00 · V2 FL', '-1', '-2']);
    expect(JSON.parse(localStorage.getItem('material-stock')!).items).toEqual({ 'MF-1': 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Vložit sklad z Excelu' }));
    fireEvent.change(screen.getByLabelText('Vložit sklad z Excelu'), { target: { value: 'MF-1\t2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Použít' }));
    // detail: dveře se zbývajícím skladem
    fireEvent.click(rowOf('MF-1'));
    const detail = within(screen.getByRole('region', { name: 'Zakázky MF-1' }));
    expect(detail.getAllByRole('row').slice(1).map((r) => cells(r).at(-1))).toEqual(['1', '0', '-1']);
    // zpět v Matrixu: V1 a V2 pokryté, V3 chybí
    fireEvent.click(screen.getByRole('tab', { name: 'Matrix' }));
    expect(badges('V2')).toEqual(['MF ok']);
    expect(material('V2')).toBe('vše na skladě');
    expect(badges('V3')).toEqual(['MF short']);
    expect(material('V3')).toBe('FL: MF-1');
  });

  it('Matrix: filtry podle sloupců matice, dne stavby, stavu a dílu MF', async () => {
    renderApp();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([matrix], 'Matrix.csv'), new File([jit], 'JIT_Overview.csv'), new File([bom], 'BOM.csv')] } });
    await waitFor(() => expect(screen.getByText('V9')).toBeTruthy());
    const shown = () => [...document.querySelectorAll('.mat-matrix tbody td.sticky-col')].map((td) => td.textContent);
    expect(shown()).toEqual(['V1', 'V2', 'V3', 'V9']);
    fireEvent.change(screen.getByLabelText('Lot'), { target: { value: '8' } });
    expect(shown()).toEqual(['V3', 'V9']);
    expect(screen.getByText('Zobrazeno 2 z 4 vozů')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lot'), { target: { value: '' } });
    const day = screen.getByLabelText('Den stavby') as HTMLSelectElement;
    expect([...day.options].map((o) => o.text)).toEqual(['Vše', 'Čt 5. 11.', 'Pá 6. 11.']);
    fireEvent.change(day, { target: { value: day.options[1]!.value } });
    expect(shown()).toEqual(['V1', 'V2']);
    fireEvent.change(screen.getByLabelText('Stav dveří'), { target: { value: '30 - Sequencelabel printed' } });
    expect(shown()).toEqual(['V2']);
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit filtry' }));
    expect(shown()).toEqual(['V1', 'V2', 'V3', 'V9']);
    // hledání podle dílu MF: vozy, které ho potřebují (V9 není v JIT)
    fireEvent.change(screen.getByLabelText('Production number, Lot nebo díl MF'), { target: { value: 'mf-1' } });
    expect(shown()).toEqual(['V1', 'V2', 'V3']);
  });
});
