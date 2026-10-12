import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { masterDataTemplate, parseMasterData } from './masterdata';

describe('parseMasterData', () => {
  it('čte české i anglické názvy sloupců a sjednotí stranu', () => {
    const r = parseMasterData(parseCsv('Díl;Zákazník;Projekt;Strana\n1001;Zákazník A;P100;lhd\n1002;Zákazník B;P300;XYZ\n1001;Zákazník A;P100;RHD'));
    if (!r.ok) throw new Error();
    expect(r.value.items.get('1002')).toEqual({ item: '1002', description: '', customer: 'Zákazník B', project: 'P300', side: 'XYZ' });
    expect(r.value.items.get('1001')?.side).toBe('RHD');
    expect(r.value.issues.map((i) => i.message)).toEqual(['unknownSide', 'duplicateItem']);
  });

  it('vyžaduje sloupec s číslem dílu', () => {
    expect(parseMasterData(parseCsv('Projekt\nP100'))).toEqual({ ok: false, error: 'missingColumns', columns: ['Item Number'] });
  });
});

describe('masterDataTemplate', () => {
  it('předvyplní známé hodnoty', () => {
    const existing = new Map([['1', { item: '1', description: 'X', customer: 'A', project: 'P', side: 'LHD' }]]);
    const t = masterDataTemplate(
      [
        { item: '1', description: 'Popis 1' },
        { item: '2', description: 'Popis 2' },
      ],
      existing,
    );
    expect(t.rows).toEqual([
      ['1', 'X', 'A', 'P', 'LHD'],
      ['2', 'Popis 2', '', '', ''],
    ]);
  });
});
