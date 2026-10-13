import { describe, expect, it } from 'vitest';
import { parseBom } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { parseCsv } from '../csv';
import { dayFromParts } from '../dates';
import { parseMasterData } from '../masterdata';
import { buildComponents, COMPONENT_DAYS } from './compute';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const today = day(13);

const bom = parseBom([
  ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
  ['Parent', 'FG-1', 'PANEL LHD', null, 'EA', 'L'],
  ['1', 'SUB-1', 'INTERMEDIATE', 1, 'EA', 'L'],
  ['.2', 'CLIP-1', 'CLIP', 2, 'EA', 'P'],
  ['.2', 'RESIN', 'RESIN', 0.5, 'KG', 'P'],
  ['Parent', 'FG-2', 'PANEL RHD', null, 'EA', 'L'],
  ['1', 'CLIP-1', 'CLIP', 1, 'EA', 'P'],
]);
if (!bom.ok) throw new Error();

// FG-1: odvolávky 13., 14., 16. 10.; FG-2: 13. a 14. 10.; den před horizontem se nepočítá.
const callOffs = {
  items: ['FG-1', 'FG-2'],
  offsets: Int32Array.from([0, 4, 6]),
  days: Int32Array.from([day(12), day(13), day(14), day(16), day(13), day(14)]),
  qty: Float64Array.from([50, 10, 0, 7, 3, 4]),
} as unknown as CallOffExport;

const mapping = (extra = '') =>
  parseMasterData(parseCsv(`Item Number;Customer Number;Description;Project${extra ? ';Component Coverage' : ''}\nFG-1;C1;PANEL LHD;P1${extra ? ';' : ''}\nCLIP-1;;CLIP;${extra ? ';Ano' : ''}\nSUB-1;;INTERMEDIATE;${extra ? ';' : ''}`));

describe('buildComponents', () => {
  it('poptávka hotových dílů po dnech z odvolávek od dneška', () => {
    const m = mapping();
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, callOffs, stock: new Map([['CLIP-1', 40]]), today });
    expect(t.days).toHaveLength(COMPONENT_DAYS);
    const [fg1, fg2] = t.products;
    expect(fg1!.qty.slice(0, 4)).toEqual([10, 0, 0, 7]);
    expect(fg1!.project).toBe('P1');
    expect(fg2!.qty.slice(0, 3)).toEqual([3, 4, 0]);
  });

  it('bez sloupce v mapování: nakupované komponenty; spotřeba × kusovník a pokrytí ze skladu', () => {
    const m = mapping();
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, callOffs, stock: new Map([['CLIP-1', 40]]), today });
    expect(t.byMapping).toBe(false);
    expect(t.components.map((c) => c.item)).toEqual(['RESIN', 'CLIP-1']);
    const clip = t.components[1]!;
    // FG-1 × 2 + FG-2 × 1: 13. 10. 20 + 3, 14. 10. 0 + 4, 15. 10. 0, 16. 10. 14
    expect(clip.usage.slice(0, 4)).toEqual([23, 4, 0, 14]);
    expect(clip.balance.slice(0, 4)).toEqual([17, 13, 13, -1]);
    expect(clip.shortDay).toBe(3);
    expect(clip.products).toEqual(['FG-1', 'FG-2']);
    expect(clip.projects).toEqual(['P1']);
    // pryskyřice v kg, sklad v souboru není → 0, hned v záporu
    expect(t.components[0]).toMatchObject({ um: 'KG', stock: 0, shortDay: 0 });
    expect(t.components[0]!.usage[0]).toBe(5);
  });

  it('se sloupcem Component Coverage jen označené; mezivýroba bez označení se nezobrazí', () => {
    const m = mapping('x');
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, callOffs, stock: undefined, today });
    expect(t.byMapping).toBe(true);
    expect(t.components.map((c) => c.item)).toEqual(['CLIP-1']);
    expect(t.components[0]!.stock).toBeNull();
    expect(t.markedNotInBom).toEqual([]);
  });
});

describe('dny výroby a pokrytí zákazníka (čistý rozpad)', () => {
  // A: 100 ks každý pracovní den. A = 1× S (mezivýroba), S = 2× K (nákup). Sklad A 150, S 100, K 400.
  const monday = dayFromParts(2026, 10, 12)!;
  const tree = parseBom([
    ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
    ['Parent', 'A', 'PRODUCT', null, 'EA', 'L'],
    ['1', 'S', 'SUB', 1, 'EA', 'L'],
    ['.2', 'K', 'PART', 2, 'EA', 'P'],
  ]);
  if (!tree.ok) throw new Error();
  const workdays = Array.from({ length: 14 }, (_, k) => monday + k).filter((d) => (d - monday) % 7 < 5);
  const calls = { items: ['A'], offsets: Int32Array.from([0, workdays.length]), days: Int32Array.from(workdays), qty: Float64Array.from(workdays.map(() => 100)) } as unknown as CallOffExport;
  const m = parseMasterData(parseCsv('Item Number;Component Coverage\nK;Ano\nS;Ano'));
  if (!m.ok) throw new Error();
  const t = buildComponents({ bom: tree.value, master: m.value, callOffs: calls, stock: new Map([['A', 150], ['S', 100], ['K', 400]]), today: monday });
  const k = t.components.find((c) => c.item === 'K')!;

  it('samotná komponenta: 200 ks za den výroby, 400 ks stačí na 2 dny, chybí od středy', () => {
    expect(k.avgDaily).toBe(200);
    expect(k.productionDays).toBe(2);
    expect(k.shortDay).toBe(2);
  });

  it('zákazník: nejdřív hotové díly a mezivýroba ze skladu, K chybí až v pátek', () => {
    expect(tree.value.trees.get('A')).toEqual([{ item: 'S', qty: 1, children: [{ item: 'K', qty: 2, children: [] }] }]);
    expect(k.customerKnown).toBe(true);
    expect(k.customerShortDay).toBe(4);
  });

  it('u vyráběného dílu s komponentami se pokrytí zákazníka neurčuje', () => {
    expect(t.components.find((c) => c.item === 'S')).toMatchObject({ customerKnown: false, customerShortDay: null });
  });
});

describe('Zákazník pokryt do podle souboru sekvencéra (fix) a odvolávek', () => {
  // A: odvolávky 100 ks každý pracovní den. A = 1× S (mezivýroba), S = 2× K (nákup). Náš sklad A 150, S 100, K 400.
  const monday = dayFromParts(2026, 10, 12)!;
  const tree = parseBom([
    ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
    ['Parent', 'A', 'PRODUCT', null, 'EA', 'L'],
    ['1', 'S', 'SUB', 1, 'EA', 'L'],
    ['.2', 'K', 'PART', 2, 'EA', 'P'],
  ]);
  if (!tree.ok) throw new Error();
  const workdays = Array.from({ length: 14 }, (_, k) => monday + k).filter((d) => (d - monday) % 7 < 5);
  const calls = { items: ['A'], offsets: Int32Array.from([0, workdays.length]), days: Int32Array.from(workdays), qty: Float64Array.from(workdays.map(() => 100)) } as unknown as CallOffExport;
  const m = parseMasterData(parseCsv('Item Number;Customer Number;Component Coverage\nA;CA;\nK;;Ano'));
  if (!m.ok) throw new Error();
  const sequencer = (days: number[], balance: number[], transit: number[], stock: number): CoverageSource => ({
    path: 'Coverage/X/P/r.xlsx',
    fileName: 'r.xlsx',
    location: 'X',
    project: 'P',
    lastModified: 0,
    report: {
      format: 'overview',
      sheet: 's',
      days,
      rows: [{ customerNumber: 'CA', customerKey: 'CA', supplierItem: '', description: '', customerStock: stock, balance, transit, firstUncovered: '', uncoveredAt: '' }],
      issueCount: 0,
      issues: [],
    },
  });
  const build = (seq: CoverageSource) =>
    buildComponents({ bom: tree.value, master: m.value, coverage: [seq], callOffs: calls, stock: new Map([['A', 150], ['S', 100], ['K', 400]]), today: monday });

  it('sekvencér vystačí do konce souboru; za ním zbytek u sekvencéru, pak odvolávky na nás', () => {
    // sklad 200, do středy spotřeba 200, ve středu dorazí transit 100 → stav se transitem po, st = 100
    const t = build(sequencer([monday, monday + 2], [100, 0], [0, 100], 200));
    const a = t.products[0]!;
    expect(a.fixed.slice(0, 4)).toEqual([true, true, true, false]);
    // čt 100 pokryje zbytek u sekvencéru, od pátku odvolávky na nás
    expect(a.netQty).toEqual([0, 0, 0, 0, 100, 0, 0, 100, 100, 100, 100, 100, 0, 0]);
    // náš sklad A 150 (pá, po), S 100 (po, út), pak K: út 100, st 200 → 100, čt chybí → pokryto do st 21. 10.
    const k = t.components.find((c) => c.item === 'K')!;
    expect(k.customerShortDay).toBe(10);
    // vlastní pokrytí komponenty podle odvolávek se nemění
    expect(k.shortDay).toBe(2);
  });

  it('chybějící množství podle souboru je požadavek; pozdější transit ho nesnižuje', () => {
    // stav se transitem: po 50, út −30, st −80, čt −20 (dorazil transit) → požadavek 0, 30, 50, 0
    const t = build(sequencer([monday, monday + 1, monday + 2, monday + 3], [50, -30, -80, -120], [0, 0, 0, 100], 100));
    // pá za koncem souboru: u sekvencéru zbývá −20 + 80 dodaných = 60 ks, z odvolávky 100 zbude na nás 40
    expect(t.products[0]!.netQty.slice(0, 5)).toEqual([0, 30, 50, 0, 40]);
  });

  it('chybějící množství ze dnů před dneškem patří do dneška', () => {
    const t = buildComponents({
      bom: tree.value,
      master: m.value,
      coverage: [sequencer([monday - 1, monday, monday + 1], [-40, -60, -60], [0, 0, 0], 0)],
      callOffs: calls,
      stock: new Map(),
      today: monday,
    });
    expect(t.products[0]!.netQty.slice(0, 3)).toEqual([60, 0, 100]);
  });
});
