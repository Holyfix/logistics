import { describe, expect, it } from 'vitest';
import { parseBom } from '../bom';
import type { CallOffExport } from '../calloffs/parse';
import type { CoverageSource } from '../coverage/compute';
import { parseCsv } from '../csv';
import { dayFromParts } from '../dates';
import { parseMasterData } from '../masterdata';
import { buildComponents, COMPONENT_DAYS, stockDaysOf } from './compute';

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
  parseMasterData(parseCsv(`Item Number;Customer Number;Description;Project${extra ? ';Item Type' : ''}\nFG-1;C1;PANEL LHD;P1${extra ? ';FG' : ''}\nCLIP-1;;CLIP;${extra ? ';PG' : ''}\nSUB-1;;INTERMEDIATE;${extra ? ';SFG' : ''}`));

describe('buildComponents', () => {
  it('potřeba z odvolávek od dneška, bez souboru sekvencéra stejná i pro Zákazník pokryt do', () => {
    const m = mapping();
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, callOffs, stock: new Map([['CLIP-1', 40], ['FG-2', 5]]), today, netOwnStock: true });
    expect(t.days).toHaveLength(COMPONENT_DAYS);
    const [fg1, fg2] = t.products;
    expect(fg1!.callOffs.slice(0, 4)).toEqual([10, 0, 0, 7]);
    expect(fg1!.customerNeed.slice(0, 4)).toEqual([10, 0, 0, 7]);
    expect(fg1!.project).toBe('P1');
    // FG-2: odvolávky 3 a 4, náš sklad 5 → výroba 0 a 2
    expect(fg2!.callOffs.slice(0, 3)).toEqual([3, 4, 0]);
    expect(fg2!.production.slice(0, 3)).toEqual([0, 2, 0]);
  });

  it('bez druhu dílu (Item Type) se nesleduje nic (bez zálohy z kusovníku); spotřeba × kusovník a pokrytí ze skladu', () => {
    const none = mapping();
    if (!none.ok) throw new Error();
    const empty = buildComponents({ bom: bom.value, master: none.value, callOffs, stock: new Map([['CLIP-1', 40]]), today });
    expect(empty.byMapping).toBe(false);
    expect(empty.components).toEqual([]);
    const m = parseMasterData(parseCsv('Item Number;Customer Number;Description;Project;Item Type\nFG-1;C1;PANEL LHD;P1;FG\nCLIP-1;;CLIP;;PG\nRESIN;;RESIN;;PG'));
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, callOffs, stock: new Map([['CLIP-1', 40]]), today });
    // bez skladu hotových dílů je potřeba výroby stejná jako odvolávky
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

  it('sledují se všechny nakupované díly (PG); mezivýroba (SFG) se nezobrazí', () => {
    const m = mapping('x');
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: bom.value, master: m.value, callOffs, stock: undefined, today });
    expect(t.byMapping).toBe(true);
    expect(t.components.map((c) => c.item)).toEqual(['CLIP-1']);
    expect(t.components[0]!.stock).toBeNull();
  });
});

describe('odečet našeho skladu hotových dílů a mezivýroby', () => {
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
  const m = parseMasterData(parseCsv('Item Number;Item Type\nK;PG\nS;SFG'));
  if (!m.ok) throw new Error();
  const stock = new Map([['A', 150], ['S', 100], ['K', 400]]);
  const net = buildComponents({ bom: tree.value, master: m.value, callOffs: calls, stock, today: monday, netOwnStock: true });
  const gross = buildComponents({ bom: tree.value, master: m.value, callOffs: calls, stock, today: monday, netOwnStock: false });

  it('nejdřív hotové díly (150), pak mezivýroba (100), teprve potom K; K chybí až v pátek', () => {
    expect(tree.value.trees.get('A')).toEqual([{ item: 'S', qty: 1, children: [{ item: 'K', qty: 2, children: [] }] }]);
    expect(net.products[0]!.production.slice(0, 5)).toEqual([0, 50, 100, 100, 100]);
    const k = net.components.find((c) => c.item === 'K')!;
    expect(k.usage.slice(0, 5)).toEqual([0, 0, 100, 200, 200]);
    expect(k.balance.slice(0, 5)).toEqual([400, 400, 300, 100, -100]);
    expect(k.shortDay).toBe(4);
    // zásoba 400: st 100 a čt 200 celé, pá 100 z 200 → 2,5 dne potřeby
    expect(k.stockDays).toBe(2.5);
    expect(k.stockLastsHorizon).toBe(false);
    // mezivýroba (SFG) se nesleduje
    expect(net.components.map((c) => c.item)).toEqual(['K']);
  });

  it('bez odečtu skladu: K se spotřebuje už od pondělí a chybí ve středu', () => {
    const k = gross.components.find((c) => c.item === 'K')!;
    expect(gross.products[0]!.production.slice(0, 3)).toEqual([100, 100, 100]);
    expect(k.usage.slice(0, 3)).toEqual([200, 200, 200]);
    expect(k.shortDay).toBe(2);
  });
});

describe('Zákazník pokryt do: sklad a transit u zákazníka podle souboru coverage', () => {
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
  const m = parseMasterData(parseCsv('Item Number;Customer Number;Item Type\nA;CA;FG\nK;;PG'));
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

  it('výchozí výpočet: potřeba podle coverage (zákazník + transit), ne podle odvolávek; náš sklad komponenty', () => {
    const t = build(sequencer([monday, monday + 2], [100, 0], [0, 100], 200));
    const k = t.components.find((c) => c.item === 'K')!;
    // zákazník pokrytý do čtvrtka: K se nespotřebuje; pá a po 100 ks hotového dílu = 200 K → v úterý chybí
    expect(k.balance.slice(0, 9)).toEqual([400, 400, 400, 400, 200, 200, 200, 0, -200]);
    expect(k.shortDay).toBe(8);
    // zásoba 400 na pá a po (po 200) → 2 dny potřeby; potřeba výroby = co chybí zákazníkovi
    expect(k.stockDays).toBe(2);
    expect(t.products[0]!.production.slice(0, 5)).toEqual([0, 0, 0, 0, 100]);
  });

  it('Zákazník pokryt do: hotové díly u zákazníka + transit', () => {
    // stav se transitem po 100, st 100 → za koncem souboru (čt) zbytek 100 u zákazníka, od pátku odvolávky na nás
    const t = build(sequencer([monday, monday + 2], [100, 0], [0, 100], 200));
    const a = t.products[0]!;
    expect(a.customerNeed).toEqual([0, 0, 0, 0, 100, 0, 0, 100, 100, 100, 100, 100, 0, 0]);
    // zákazníkovi chybí od pátku (index 4), u komponenty stejně
    expect(a.customerShortDay).toBe(4);
    expect(t.components.find((c) => c.item === 'K')!.customerShortDay).toBe(4);
  });

  it('se zaškrtnutím Odečíst náš sklad: navíc náš sklad hotových dílů', () => {
    const t = buildComponents({ bom: tree.value, master: m.value, coverage: [sequencer([monday, monday + 2], [100, 0], [0, 100], 200)], callOffs: calls, stock: new Map([['A', 150], ['S', 100], ['K', 400]]), today: monday, netOwnStock: true });
    // náš sklad A 150: pá 100, po 50 → chybí v pondělí (index 7)
    expect(t.products[0]!.customerShortDay).toBe(7);
    expect(t.components.find((c) => c.item === 'K')!.customerShortDay).toBe(7);
  });

  it('chybějící množství podle souboru; pozdější transit ho nesnižuje', () => {
    // stav se transitem: po 50, út −30, st −80, čt −20 (dorazil transit) → požadavek 0, 30, 50, 0
    const t = build(sequencer([monday, monday + 1, monday + 2, monday + 3], [50, -30, -80, -120], [0, 0, 0, 100], 100));
    // pá za koncem souboru: u zákazníka zbývá −20 + 80 dodaných = 60 ks, z odvolávky 100 zbude na nás 40
    expect(t.products[0]!.customerNeed.slice(0, 5)).toEqual([0, 30, 50, 0, 40]);
  });

  it('chybějící množství ze dnů před dneškem patří do dneška', () => {
    const t = build(sequencer([monday - 1, monday, monday + 1], [-40, -60, -60], [0, 0, 0], 0));
    expect(t.products[0]!.customerNeed.slice(0, 3)).toEqual([60, 0, 100]);
  });

  it('každý hotový díl zvlášť: chybí-li 1 ks jednoho dílu, den není pokrytý, i když je součet v plusu', () => {
    const two = parseBom([
      ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
      ['Parent', 'A', 'A', null, 'EA', 'L'],
      ['1', 'K', 'K', 1, 'EA', 'P'],
      ['Parent', 'B', 'B', null, 'EA', 'L'],
      ['1', 'K', 'K', 1, 'EA', 'P'],
    ]);
    const mm = parseMasterData(parseCsv('Item Number;Customer Number;Item Type\nA;CA;FG\nB;CB;FG\nK;;PG'));
    if (!two.ok || !mm.ok) throw new Error();
    const seq = sequencer([monday, monday + 1, monday + 2, monday + 3], [10, 10, 10, -5], [0, 0, 0, 0], 10);
    const rowB = { ...seq.report.rows[0]!, customerNumber: 'CB', customerKey: 'CB', balance: [5, -1, -1, -1] };
    const t = buildComponents({ bom: two.value, master: mm.value, coverage: [{ ...seq, report: { ...seq.report, rows: [...seq.report.rows, rowB] } }], callOffs: undefined, stock: new Map([['K', 3]]), today: monday });
    // A: 10 ks v plusu až do středy, B: v úterý chybí 1 ks → komponenta: zákazník nepokrytý od úterý
    expect(t.products.map((p) => p.customerShortDay)).toEqual([3, 1]);
    expect(t.components[0]!.customerShortDay).toBe(1);
  });
});

describe('kategorie komponent', () => {
  it('kategorie hotových dílů, ve kterých komponenta je', () => {
    const monday = dayFromParts(2026, 10, 12)!;
    const tree = parseBom([
      ['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture'],
      ['Parent', 'A', 'PRODUCT', null, 'EA', 'L'],
      ['.1', 'K', 'PART', 2, 'EA', 'P'],
      ['Parent', 'B', 'PRODUCT', null, 'EA', 'L'],
      ['.1', 'K', 'PART', 1, 'EA', 'P'],
    ]);
    if (!tree.ok) throw new Error();
    const m = parseMasterData(parseCsv('Item Number;Item Type;Category\nA;FG;DP\nB;FG;HB\nK;PG;CLIP'));
    if (!m.ok) throw new Error();
    const t = buildComponents({ bom: tree.value, master: m.value, callOffs: undefined, stock: undefined, today: monday });
    expect(t.products.map((p) => [p.item, p.category])).toEqual([
      ['A', 'DP'],
      ['B', 'HB'],
    ]);
    // jen kategorie hotových dílů (vlastní kategorie komponenty se nepoužívá)
    expect(t.components.find((c) => c.item === 'K')!.categories).toEqual(['DP', 'HB']);
  });
});

describe('zásoba ve dnech potřeby', () => {
  it('od prvního dne s potřebou, dny bez potřeby se nepočítají, poslední den podílem', () => {
    // coverage kumulativně po −100, út −200 → potřeba 100 a 100; sklad 150 → 1,5 dne
    expect(stockDaysOf(150, [0, 100, 0, 100, 100])).toEqual({ stockDays: 1.5, stockLastsHorizon: false });
    expect(stockDaysOf(0, [0, 50])).toEqual({ stockDays: 0, stockLastsHorizon: false });
    expect(stockDaysOf(1000, [100, 0, 100])).toEqual({ stockDays: 2, stockLastsHorizon: true });
    expect(stockDaysOf(10, [0, 0])).toEqual({ stockDays: 0, stockLastsHorizon: true });
    expect(stockDaysOf(-20, [10])).toEqual({ stockDays: 0, stockLastsHorizon: false });
  });
});
