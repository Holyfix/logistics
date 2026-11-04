import { describe, expect, it } from 'vitest';
import { parseBom } from '../bom';
import { dayFromParts } from '../dates';
import { buildMaterialCoverage, partKind } from './coverage';
import { doorOf, MINUTES_PER_DAY, parseJit, parseStamp } from './jit';
import { parseStatusMatrix, statusCode } from './matrix';
import { parseStockPaste } from './stock';

const day = (n: number) => dayFromParts(2026, 11, n)!;
const at = (n: number, h: number, m = 0) => day(n) * MINUTES_PER_DAY + h * 60 + m;

// Smyšlený JIT export: každý řádek celý v uvozovkách, uvnitř zdvojené uvozovky (jako export z ERP).
const header = ['JIT order number', 'Item', 'Last priority', 'Production number', 'Assembly date', 'Article number (Pos)', 'Article description (Pos)'];
const line = (cells: string[]) => `"${cells.map((c, i) => (i === 0 ? c : `""${c}""`)).join(',')}"`;
const jitText = [
  line(header),
  line(['100', '1', 'Container planned', 'T0001', '05/11/2026 08:00:00', 'PANEL-FL-A', 'ASSY DP SR1 FRT LH']),
  line(['100', '1', 'Container planned', 'T0001', '05/11/2026 08:00:00', 'SWITCH-1', 'WINDOW SWITCH']),
  line(['100', '2', 'Container planned', 'T0001', '05/11/2026 08:00:00', 'PANEL-RR-A', 'ASSY DP SR1 RR RH']),
  line(['101', '1', 'Passed Cobot', 'T0002', '06/11/2026 10:30:00', 'PANEL-FL-A', 'ASSY DP SR1 FRT LH']),
  line(['102', '1', 'Container planned', 'T0003', '01/05/2018 06:00:00', 'PANEL-FL-A', 'ASSY DP SR1 FRT LH']),
  line(['103', '1', 'Container planned', 'T0004', '07/11/2026 12:00:00', 'UNKNOWN', 'SOMETHING']),
].join('\r\n');

const bom = parseBom([
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'Purchase/Manufacture'],
  ['Parent', 'PANEL-FL-A', 'ASSY DP SR1 FRT LH', null, 'L'],
  ['1', 'MC-FL-1', 'ASSY MC SR1 FRT LH', 1, 'L'],
  ['.2', 'MC-RAW', 'MC FRT LH', 1, 'L'],
  ['1', 'MF-FL-1', 'ASSY MF SR1 FRT LH', 1, 'P'],
  ['1', 'CLIP', 'METAL CLIP', 8, 'P'],
  ['Parent', 'PANEL-RR-A', 'ASSY DP SR1 RR RH', null, 'L'],
  ['1', 'MC-RR-1', 'ASSY MC SR1 RR RH', 1, 'L'],
  ['1', 'MF-RR-1', 'ASSY MF SR1 RR RH', 1, 'P'],
]);
if (!bom.ok) throw new Error();

describe('JIT Overview', () => {
  it('rozbalí řádky v uvozovkách; čas montáže, stav, pozice', () => {
    const r = parseJit(jitText);
    if (!r.ok) throw new Error();
    expect(r.value).toHaveLength(6);
    expect(r.value[0]).toEqual({ order: '100/1', productionNumber: 'T0001', assembly: at(5, 8), status: 'Container planned', article: 'PANEL-FL-A', description: 'ASSY DP SR1 FRT LH' });
    expect(parseStamp('06/11/2026 22:50:00')).toBe(at(6, 22, 50));
    expect(parseStamp('1.12.2026')).toBe(dayFromParts(2026, 12, 1)! * MINUTES_PER_DAY);
    expect(parseJit('a,b\n1,2')).toMatchObject({ ok: false });
  });

  it('dveře z popisu panelu, druh dílu z popisu v kusovníku', () => {
    expect(['ASSY DP SR2 FRT LH', 'ASSY DP BASIS HEAT FRTRH', 'ASSY DP SR1 RR LH', 'ASSY DP SR2 RR RH', 'ASSY HB TRIM PVC', 'X'].map(doorOf)).toEqual(['FL', 'FR', 'RL', 'RR', 'HB', null]);
    expect(['ASSY MC TRIM TPO FRT LH', 'ASSY MF SR2 RR RH', 'MAP POCKET'].map(partKind)).toEqual(['MC', 'MF', null]);
  });
});

describe('Order Status Matrix', () => {
  it('záhlaví pod titulkem, stav po dveřích, plánovaná stavba', () => {
    const r = parseStatusMatrix([
      [null, 'Report includes 2 records'],
      ['Lot', null, 'Production number', 'Option Type', 'Planned customer built', 'Status FL', 'Status FR', 'Status RL', 'Status RR', 'Status HB'],
      ['1', null, 't0001', 'SR1', new Date(Date.UTC(2026, 10, 5, 8, 0)), '20 - Container planned', '50 - Packed', '20 - Container planned', '60 - Shipped', '20 - Container planned'],
    ]);
    if (!r.ok) throw new Error();
    expect(r.value.get('T0001')).toEqual({
      productionNumber: 'T0001',
      planned: at(5, 8),
      optionType: 'SR1',
      status: { FL: '20 - Container planned', FR: '50 - Packed', RL: '20 - Container planned', RR: '60 - Shipped', HB: '20 - Container planned' },
    });
    expect(statusCode('45 - Passed Q-Gate')).toBe(45);
  });
});

describe('pokrytí MC a MF', () => {
  const jit = parseJit(jitText);
  if (!jit.ok) throw new Error();
  const matrix = new Map([['T0001', { productionNumber: 'T0001', planned: null, optionType: 'SR1', status: { FL: '30 - Sequencelabel printed', RR: '60 - Shipped' } }]]);

  it('MC a MF z panelu na úrovni 1; potřeba v čase montáže, po termínu zvlášť; pokryto do zakázky', () => {
    const t = buildMaterialCoverage({ positions: jit.value, bom: bom.value, matrix, stock: new Map([['MC-FL-1', 2]]), today: day(5) });
    expect(t.days).toEqual([day(5), day(6)]);
    expect(t.orders).toBe(5);
    expect(t.counted).toBe(4);
    expect(t.withoutPanel).toEqual(['T0004 (103/1)']);
    expect(t.productionNumbers).toBe(4);
    const mc = t.parts.find((p) => p.item === 'MC-FL-1')!;
    // po termínu T0003 (2018), pak T0001 5. 11. a T0002 6. 11.; sklad 2 → chybí od T0002
    expect(mc).toMatchObject({ kind: 'MC', description: 'ASSY MC SR1 FRT LH', stock: 2, total: 3, overdue: 1, perDay: [1, 1], balance: [0, -1] });
    expect(mc.lastCovered).toMatchObject({ productionNumber: 'T0001', door: 'FL', status: '30 - Sequencelabel printed' });
    expect(mc.firstShort).toMatchObject({ productionNumber: 'T0002', status: 'Passed Cobot', assembly: at(6, 10, 30) });
    // jen MC a MF, ne mezivýroba pod MC ani spona
    expect(t.parts.map((p) => p.item).sort()).toEqual(['MC-FL-1', 'MC-RR-1', 'MF-FL-1', 'MF-RR-1']);
    // nezadaný sklad = 0: chybí od první zakázky
    expect(t.parts.find((p) => p.item === 'MF-RR-1')).toMatchObject({ stock: null, lastCovered: null, firstShort: { productionNumber: 'T0001', door: 'RR', status: '60 - Shipped' } });
  });

  it('volitelně bez zabalených a odeslaných dveří podle matice', () => {
    const t = buildMaterialCoverage({ positions: jit.value, bom: bom.value, matrix, stock: new Map(), today: day(5), skipDone: true });
    expect(t.skippedDone).toBe(1);
    expect(t.parts.find((p) => p.item === 'MC-RR-1')).toBeUndefined();
  });
});

describe('vložení skladu z Excelu', () => {
  it('díl a množství po řádcích, záhlaví se přeskočí, stejný díl se sečte', () => {
    expect([...parseStockPaste('Díl\tMnožství\nmc-fl-1\t12\nMF-FL-1;3\nMC-FL-1\t1 000\n\n')]).toEqual([
      ['MC-FL-1', 1012],
      ['MF-FL-1', 3],
    ]);
  });
});
