import { describe, expect, it } from 'vitest';
import { mergeBoms, parseBom } from './bom';
import type { Cell } from './table';

// Smyšlený odsazený kusovník ve formátu z ERP (dva hotové díly).
const rows: Cell[][] = [
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture', 'Start Eff'],
  ['Parent', 'FG-1', 'ASSY PANEL LHD', null, 'EA', 'L', null],
  ['1', 'SCREW-1', 'SCREW', 3, 'EA', 'P', '09.12.2024'],
  ['1', 'SUB-1', 'ASSY PANEL', 1, 'EA', 'L', '09.12.2024'],
  ['.2', 'SUB-2', 'CARRIER', 2, 'EA', 'L', '09.12.2024'],
  ['..3', 1000100, 'GRANULATE', 0.5, 'KG', 'P', '09.12.2024'],
  ['..3', 'SCREW-1', 'SCREW', 2, 'EA', 'P', '09.12.2024'],
  ['.2', 'CLIP-1', 'CLIP', 4, 'EA', 'P', '09.12.2024'],
  ['1', 'LABEL', 'LABEL', 1, 'EA', 'P', '09.12.2024'],
  ['Parent', 'FG-2', 'ASSY PANEL RHD', null, 'EA', 'L', null],
  ['1', 'SUB-1', 'ASSY PANEL', 1, 'EA', 'L', '09.12.2024'],
  ['.2', 'CLIP-1', 'CLIP', 4, 'EA', 'P', '09.12.2024'],
  ['1', 'X', 'BAD', 'abc', 'EA', 'P', null],
];

describe('parseBom', () => {
  it('rozpadne víceúrovňový kusovník na množství na 1 ks hotového dílu', () => {
    const r = parseBom(rows);
    if (!r.ok) throw new Error();
    const fg1 = new Map(r.value.parents.get('FG-1')!.map((c) => [c.item, c]));
    // šroub přímo 3× a v nosiči 2 × 2 = 4× → 7
    expect(fg1.get('SCREW-1')).toEqual({ item: 'SCREW-1', qty: 7, level: 1 });
    expect(fg1.get('1000100')).toEqual({ item: '1000100', qty: 1, level: 3 });
    expect(fg1.get('CLIP-1')!.qty).toBe(4);
    expect(fg1.get('SUB-2')!.qty).toBe(2);
    expect(fg1.get('LABEL')!.qty).toBe(1);
    expect(r.value.parents.get('FG-2')!.map((c) => c.item)).toEqual(['SUB-1', 'CLIP-1']);
    expect(r.value.info.get('1000100')).toEqual({ description: 'GRANULATE', um: 'KG', source: 'P', project: '' });
    expect(r.value.issues).toEqual([{ row: 13, column: 'Quantity Per', value: 'abc', message: 'invalidNumber' }]);
  });

  it('úroveň 0 je hotový díl stejně jako „Parent“', () => {
    const r = parseBom([rows[0]!, ['0', 'FG-9', 'X', null, 'EA', 'L', null], ['1', 'K-9', 'K', 2, 'EA', 'P', null]]);
    if (!r.ok) throw new Error();
    expect(r.value.parents.get('FG-9')).toEqual([{ item: 'K-9', qty: 2, level: 1 }]);
    expect(r.value.issueCount).toBe(0);
  });

  it('druh dílu ze sloupce s vysvětlivkou a projekt z kusovníku', () => {
    const r = parseBom([
      ['Level', 'Component Item', 'Description', 'Project', 'Quantity Per', 'UM', 'P = Purchased / L = Line manufactured'],
      ['Parent', 'FG-7', 'COCKPIT', 'OV1', null, 'EA', 'L'],
      ['1', 2266346, 'NUT', 'W1', 2, 'EA', 'P'],
    ]);
    if (!r.ok) throw new Error();
    expect(r.value.info.get('FG-7')).toMatchObject({ source: 'L', project: 'OV1' });
    expect(r.value.info.get('2266346')).toMatchObject({ source: 'P', project: 'W1' });
  });

  it('bez záhlaví vrátí chybějící sloupce', () => {
    expect(parseBom([['A', 'B']])).toEqual({ ok: false, error: 'missingColumns', columns: ['Level', 'Component Item'] });
  });

  it('hotový díl ve víc souborech: platí první (nejnovější) soubor', () => {
    const a = parseBom(rows.slice(0, 9));
    const b = parseBom([rows[0]!, ['Parent', 'FG-1', 'OLD', null, 'EA', 'L', null], ['1', 'OLD-1', 'OLD', 1, 'EA', 'P', null]]);
    if (!a.ok || !b.ok) throw new Error();
    expect(mergeBoms([a.value, b.value]).parents.get('FG-1')!.map((c) => c.item)).not.toContain('OLD-1');
  });
});
