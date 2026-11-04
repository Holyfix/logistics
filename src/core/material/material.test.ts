import { describe, expect, it } from 'vitest';
import { parseBom } from '../bom';
import { dayFromParts } from '../dates';
import { buildMaterialCoverage, carMissing, isMiddlefield, shortages } from './coverage';
import { doorOf, MINUTES_PER_DAY, parseJit, parseStamp } from './jit';
import { parseStatusMatrix, statusCode } from './matrix';
import { parseSequenceCsv, parseSequenceSheets } from './sequence';

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

  it('dveře z popisu panelu, Middlefield z popisu v kusovníku', () => {
    expect(['ASSY DP SR2 FRT LH', 'ASSY DP BASIS HEAT FRTRH', 'ASSY DP SR1 RR LH', 'ASSY DP SR2 RR RH', 'ASSY HB TRIM PVC', 'X'].map(doorOf)).toEqual(['FL', 'FR', 'RL', 'RR', 'HB', null]);
    expect(['ASSY MC TRIM TPO FRT LH', 'ASSY MF SR2 RR RH', 'MAP POCKET'].map(isMiddlefield)).toEqual([false, true, false]);
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
      lot: '1',
      productionNumber: 'T0001',
      colors: '',
      planned: at(5, 8),
      optionType: 'SR1',
      status: { FL: '20 - Container planned', FR: '50 - Packed', RL: '20 - Container planned', RR: '60 - Shipped', HB: '20 - Container planned' },
    });
    expect(statusCode('45 - Passed Q-Gate')).toBe(45);
    // čas stavby jako pořadové číslo Excelu (buňka bez formátu data)
    const n = parseStatusMatrix([['Production number', 'Planned customer built', 'Status FL'], ['T1', 46331 + 8 / 24, '20 - Container planned']]);
    if (!n.ok) throw new Error();
    expect(n.value.get('T1')!.planned).toBe(at(5, 8));
    // Excel uloží 6:12 jako 6:11:59,999: zaokrouhlí se na minuty
    const d = parseStatusMatrix([['Production number', 'Planned customer built', 'Status FL'], ['T1', new Date(Date.UTC(2026, 10, 5, 8, 12) - 1), '20 - Container planned']]);
    if (!d.ok) throw new Error();
    expect(d.value.get('T1')!.planned).toBe(at(5, 8, 12));
  });
});

describe('pokrytí MF podle matice', () => {
  const jit = parseJit(jitText);
  if (!jit.ok) throw new Error();
  const car = (lot: string, pn: string, planned: number | null, status: Record<string, string>) => ({ lot, productionNumber: pn, planned, optionType: 'SR1', colors: 'C1 / C1', status });
  const matrix = new Map(
    [
      // zabalený vůz, který už v JIT není: nepočítá se (ani mezi neznámé)
      car('09', 'T0000', at(4, 8), { FL: '50 - Packed' }),
      car('10', 'T0001', at(5, 8), { FL: '30 - Sequencelabel printed', RR: '45 - Passed Q-Gate' }),
      car('10', 'T0002', at(6, 10, 30), { FL: '20 - Container planned' }),
      // vůz, který v JIT ještě není: dveřní panel neznáme
      car('11', 'T0009', at(6, 11), { FL: '20 - Container planned', HB: '20 - Container planned' }),
    ].map((c) => [c.productionNumber, c]),
  );

  it('vozy z matice, dveřní panel z JIT, MF z kusovníku (MC se nepočítá); sklad se spotřebovává v pořadí stavby', () => {
    const t = buildMaterialCoverage({ matrix, positions: jit.value, bom: bom.value, stock: new Map([['MF-FL-1', 1]]), today: day(5) });
    // stará zakázka z JIT (T0003, 2018) v matici není, takže se nepočítá
    expect(t.cars.map((c) => c.productionNumber)).toEqual(['T0000', 'T0001', 'T0002', 'T0009']);
    // T0009 HB: výklopné dveře MF nemají, nepočítají se mezi neznámé; T0000 je zabalený
    expect(t).toMatchObject({ doors: 6, known: 3, unknown: 1, skippedDone: 1 });
    expect(t.days).toEqual([day(5), day(6)]);
    const [t0, t1, t2, t9] = t.cars;
    expect(t0!.doors.FL).toMatchObject({ panel: null, state: 'skipped', parts: [] });
    // MF pokrytý (sklad 1), na RR bez skladu chybí
    expect(t1!.doors.FL).toMatchObject({ status: '30 - Sequencelabel printed', panel: 'PANEL-FL-A', state: 'ok', parts: [{ item: 'MF-FL-1', qty: 1, left: 0 }] });
    expect(t1!.doors.RR).toMatchObject({ state: 'short', parts: [{ item: 'MF-RR-1', qty: 1, left: -1 }] });
    expect(t2!.doors.FL).toMatchObject({ state: 'short', parts: [{ item: 'MF-FL-1', left: -1 }] });
    expect(t9!.doors.FL).toMatchObject({ panel: null, state: 'unknown' });
    expect(t9!.doors.HB).toMatchObject({ panel: null, state: 'none' });
    expect(t9!.short).toBe(false);
    const mf = t.parts.find((p) => p.item === 'MF-FL-1')!;
    expect(mf).toMatchObject({ stock: 1, total: 2, overdue: 0, perDay: [1, 1], balance: [0, -1] });
    expect(mf.lastCovered).toMatchObject({ productionNumber: 'T0001', door: 'FL' });
    expect(mf.firstShort).toMatchObject({ productionNumber: 'T0002', door: 'FL', status: '20 - Container planned', planned: at(6, 10, 30) });
    expect(t.parts.map((p) => p.item)).toEqual(['MF-RR-1', 'MF-FL-1']);
    // sloupec Materiál a prioritní seznam
    expect(carMissing(t1!)).toEqual([{ door: 'RR', item: 'MF-RR-1' }]);
    const list = shortages(t.parts);
    expect(list.map((s) => [s.part.item, s.missing, s.demands.map((d) => `${d.productionNumber} ${d.door} ${d.missing}`)])).toEqual([
      ['MF-RR-1', 1, ['T0001 RR 1']],
      ['MF-FL-1', 1, ['T0002 FL 1']],
    ]);
  });

  it('zabalené a odeslané dveře (stav 50+) se do potřeby nepočítají', () => {
    const shipped = new Map(matrix).set('T0001', { ...matrix.get('T0001')!, status: { FL: '30 - Sequencelabel printed', RR: '60 - Shipped' } });
    const t = buildMaterialCoverage({ matrix: shipped, positions: jit.value, bom: bom.value, stock: new Map(), today: day(5) });
    expect(t.skippedDone).toBe(2);
    expect(t.cars[1]!.doors.RR).toMatchObject({ panel: 'PANEL-RR-A', state: 'skipped', parts: [] });
    expect(t.parts.find((p) => p.item === 'MF-RR-1')).toBeUndefined();
  });
});

describe('soubory ze složky Sekvence', () => {
  it('JIT Overview a Order Status Matrix podle obsahu', () => {
    expect(parseSequenceCsv(jitText)).toMatchObject({ type: 'jit' });
    const csv = parseSequenceCsv('Production number;Planned customer built;Status FL\nT1;05.11.2026 08:00;20 - Container planned');
    expect(csv.type === 'matrix' && [...csv.orders.keys()]).toEqual(['T1']);
    // bez sloupců stavu dveří to matice není
    expect(parseSequenceCsv('Production number;Planned customer built\nT1;05.11.2026 08:00')).toEqual({ type: 'unknown' });
    expect(parseSequenceSheets([[['Item'], ['A']], [[null, 'Report'], ['Production number', 'Status RR'], ['t2', '30 - Sequencelabel printed']]])).toMatchObject({ type: 'matrix' });
  });
});
