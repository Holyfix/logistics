import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import { buildMaterialCoverage, carMissing, carUndetermined, missingKeys, shortages } from './coverage';
import { MINUTES_PER_DAY, parseStamp } from './doors';
import { parseStatusMatrix, statusCode } from './matrix';
import { keyType, lookupPart, partColour, partKind, parsePartKey } from './partKey';
import { parseSequenceCsv, parseSequenceSheets } from './sequence';
import { sequenceReport } from './report';
import type { ReportCell } from '../calloffs/summaryReport';

const day = (n: number) => dayFromParts(2026, 11, n)!;
const at = (n: number, h: number, m = 0) => day(n) * MINUTES_PER_DAY + h * 60 + m;

describe('čas a druh dílu', () => {
  it('datum a čas stavby, druh dílu z popisu', () => {
    expect(parseStamp('06/11/2026 22:50:00')).toBe(at(6, 22, 50));
    expect(parseStamp('1.12.2026')).toBe(dayFromParts(2026, 12, 1)! * MINUTES_PER_DAY);
    expect(parseStamp('x')).toBeNull();
    expect(['ASSY MC TRIM TPO FRT LH', 'ASSY MF SR2 RR RH', 'MAP POCKET', 'ASSY MC/MF'].map(partKind)).toEqual(['MC', 'MF', null, null]);
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

describe('pokrytí MC a MF podle matice a klíče', () => {
  const key = parsePartKey([
    ['Side', 'Item Number', 'Type', 'Colour', 'Description'],
    ['FL', 'MC-FL-1', 'SR1', 'C1', 'ASSY MC SR1 FRT LH'],
    ['FL', 'MF-FL-1', 'SR1', 'C1', 'ASSY MF SR1 FRT LH'],
    ['RR', 'MC-RR-1', 'SR1', 'C1', 'ASSY MC SR1 RR RH'],
    ['RR', 'MF-RR-1', 'SR1', 'C1', 'ASSY MF SR1 RR RH'],
  ]);
  if (!key.ok) throw new Error();
  const car = (lot: string, pn: string, planned: number | null, status: Record<string, string>) => ({ lot, productionNumber: pn, planned, optionType: 'SR1', colors: 'C1 / C1', status });
  const matrix = new Map(
    [
      // zabalený vůz: nepočítá se
      car('09', 'T0000', at(4, 8), { FL: '50 - Packed' }),
      car('10', 'T0001', at(5, 8), { FL: '30 - Sequencelabel printed', RR: '45 - Passed Q-Gate' }),
      car('10', 'T0002', at(6, 10, 30), { FL: '20 - Container planned' }),
      // FR v klíči není; výklopné dveře MC ani MF nemají
      car('11', 'T0009', at(6, 11), { FR: '20 - Container planned', HB: '20 - Container planned' }),
    ].map((c) => [c.productionNumber, c]),
  );
  const none = { MC: new Map<string, number>(), MF: new Map<string, number>() };

  it('vozy v pořadí stavby; sklad (zvlášť MC a MF) se spotřebovává v pořadí stavby', () => {
    const t = buildMaterialCoverage({ matrix, key: key.value, stock: { MC: new Map([['MC-FL-1', 1]]), MF: new Map([['MF-FL-1', 1]]) }, today: day(5) });
    expect(t.cars.map((c) => c.productionNumber)).toEqual(['T0000', 'T0001', 'T0002', 'T0009']);
    expect(t).toMatchObject({ doors: 6, skippedDone: 1, known: 3, unknown: 1, unknownByKind: { MC: 1, MF: 1 } });
    expect(t.days).toEqual([day(5), day(6)]);
    const [t0, t1, t2, t9] = t.cars;
    expect(t0!.doors.FL).toMatchObject({ state: 'skipped', parts: [] });
    // MC a MF pokryté (sklad 1), na RR bez skladu chybí
    expect(t1!.doors.FL).toMatchObject({ status: '30 - Sequencelabel printed', state: 'ok' });
    expect(t1!.doors.FL!.parts).toEqual([
      { item: 'MC-FL-1', kind: 'MC', qty: 1, left: 0 },
      { item: 'MF-FL-1', kind: 'MF', qty: 1, left: 0 },
    ]);
    expect(t1!.doors.RR).toMatchObject({ state: 'short', parts: [{ item: 'MC-RR-1', left: -1 }, { item: 'MF-RR-1', left: -1 }] });
    expect(t2!.doors.FL).toMatchObject({ state: 'short', parts: [{ item: 'MC-FL-1', left: -1 }, { item: 'MF-FL-1', left: -1 }] });
    expect(t9!.doors.FR).toMatchObject({ state: 'unknown', unknown: ['MC', 'MF'] });
    expect(t9!.doors.HB).toMatchObject({ state: 'none', unknown: [] });
    expect(t9!.short).toBe(false);
    const mf = t.parts.find((p) => p.item === 'MF-FL-1')!;
    expect(mf).toMatchObject({ kind: 'MF', description: 'ASSY MF SR1 FRT LH', stock: 1, total: 2, overdue: 0, perDay: [1, 1], balance: [0, -1] });
    expect(mf.lastCovered).toMatchObject({ productionNumber: 'T0001', door: 'FL' });
    expect(mf.firstShort).toMatchObject({ productionNumber: 'T0002', door: 'FL', status: '20 - Container planned', planned: at(6, 10, 30) });
    expect(t.parts.map((p) => p.item)).toEqual(['MC-RR-1', 'MC-FL-1', 'MF-RR-1', 'MF-FL-1']);
    // sloupec Materiál a prioritní seznam
    expect(carMissing(t1!)).toEqual([
      { door: 'RR', kind: 'MC', item: 'MC-RR-1' },
      { door: 'RR', kind: 'MF', item: 'MF-RR-1' },
    ]);
    const list = shortages(t.parts);
    expect(list.map((s) => [s.part.item, s.missing, s.demands.map((d) => `${d.productionNumber} ${d.door} ${d.missing}`)])).toEqual([
      ['MC-RR-1', 1, ['T0001 RR 1']],
      ['MF-RR-1', 1, ['T0001 RR 1']],
      ['MC-FL-1', 1, ['T0002 FL 1']],
      ['MF-FL-1', 1, ['T0002 FL 1']],
    ]);
  });

  it('zabalené a odeslané dveře (stav 50+) se do potřeby nepočítají', () => {
    const shipped = new Map(matrix).set('T0001', { ...matrix.get('T0001')!, status: { FL: '30 - Sequencelabel printed', RR: '60 - Shipped' } });
    const t = buildMaterialCoverage({ matrix: shipped, key: key.value, stock: none, today: day(5) });
    expect(t.skippedDone).toBe(2);
    expect(t.cars[1]!.doors.RR).toMatchObject({ state: 'skipped', parts: [] });
    expect(t.parts.find((p) => p.item === 'MF-RR-1' || p.item === 'MC-RR-1')).toBeUndefined();
  });
});

describe('soubory ze složky Sekvence', () => {
  it('Order Status Matrix a klíč MC/MF podle obsahu', () => {
    const csv = parseSequenceCsv('Production number;Planned customer built;Status FL\nT1;05.11.2026 08:00;20 - Container planned');
    expect(csv.type === 'matrix' && [...csv.orders.keys()]).toEqual(['T1']);
    // bez sloupců stavu dveří to matice není
    expect(parseSequenceCsv('Production number;Planned customer built\nT1;05.11.2026 08:00')).toEqual({ type: 'unknown' });
    expect(parseSequenceSheets([[['Item'], ['A']], [[null, 'Report'], ['Production number', 'Status RR'], ['t2', '30 - Sequencelabel printed']]])).toMatchObject({ type: 'matrix' });
    expect(parseSequenceCsv('Side;Item Number;Type;Colour;Description\nFL;MF-1;SR1;C1;ASSY MF')).toMatchObject({ type: 'key' });
  });
});

describe('klíč MC/MF (dveře, výbava, barva)', () => {
  const key = parsePartKey([
    ['MC/MF klíč'],
    ['Side', 'Item Number', 'Type', 'Colour', 'Type_colour', 'Description'],
    ['FL', 'MF-KEY-FL', 'SR1', 'C1', 'SR1C1', 'ASSY MF SR1 FRT LH'],
    ['FL', 'MF-KEY-FL-HT', 'SR1-HT', 'C1', 'SR1-HTC1', 'ASSY MF SR1 HEAT. FRT LH'],
    ['FL', 'MC-KEY-FL', 'SR1', 'C9', 'SR1C9', 'ASSY MC SR1 FRT LH'],
    ['RL', 'MF-KEY-RL', 'SR1', 'C2', 'SR1C2', 'ASSY MF SR1 RR LH'],
    // bez barvy: platí jen pro vůz bez barvy, ne pro všechny barvy
    ['RL', 'MC-KEY-RL', 'SR1', null, 'SR1', 'ASSY MC SR1 RR LH'],
    // stejná kombinace se dvěma různými díly: nejednoznačné, nepoužije se
    ['FR', 'MF-A', 'SR1', 'C1', 'SR1C1', 'ASSY MF SR1 FRT RH'],
    ['FR', 'MF-B', 'SR1', 'C1', 'SR1C1', 'ASSY MF SR1 FRT RH'],
    // popis bez MC/MF i s oběma: ignoruje se
    ['FL', 'X-1', 'SR1', 'C1', 'SR1C1', 'MAP POCKET'],
    ['FR', 'X-2', 'SR1', 'C9', 'SR1C9', 'ASSY MC/MF FRT RH'],
  ]);
  if (!key.ok) throw new Error();

  it('jen přesná shoda dveří, výbavy a barvy; výjimka -HT jen u zadních dveří', () => {
    expect(key.value.entries.size).toBe(5);
    expect([...key.value.conflicts]).toEqual(['MF|FR|SR1|C1']);
    expect([partColour('C9 / C1', 'MC'), partColour('C9 / C1', 'MF'), partColour('C1', 'MF')]).toEqual(['C9', 'C1', 'C1']);
    expect(lookupPart(key.value, 'MF', 'FL', 'SR1', 'C9 / C1')?.item).toBe('MF-KEY-FL');
    expect(lookupPart(key.value, 'MC', 'FL', 'SR1', 'C9 / C1')?.item).toBe('MC-KEY-FL');
    expect(lookupPart(key.value, 'MF', 'FL', 'sr1-ht', 'C9 / C1')?.item).toBe('MF-KEY-FL-HT');
    // přední dveře: bez přesného řádku -HT nic
    expect(lookupPart(key.value, 'MC', 'FL', 'SR1-HT', 'C9 / C1')).toBeNull();
    // zadní dveře: SR1-HT se hledá i jako SR1
    expect(lookupPart(key.value, 'MF', 'RL', 'SR1-HT', 'C9 / C2')?.item).toBe('MF-KEY-RL');
    // jiná barva ani řádek bez barvy neplatí
    expect(lookupPart(key.value, 'MF', 'RL', 'SR1', 'C9 / C3')).toBeNull();
    expect(lookupPart(key.value, 'MC', 'RL', 'SR1', 'C7 / C2')).toBeNull();
    // nejednoznačná kombinace
    expect(lookupPart(key.value, 'MF', 'FR', 'SR1', 'C9 / C1')).toBeNull();
    expect(parsePartKey([['Item Number', 'Type']])).toEqual({ ok: false, error: 'missingColumns', columns: ['Side', 'Item Number', 'Type', 'Colour'] });
  });

  it('výbava pro doplnění klíče: u zadních dveří bez -HT', () => {
    expect([keyType('RL', 'SR2-HT'), keyType('RR', 'sr2-ht'), keyType('FL', 'SR2-HT'), keyType('RL', 'SR2')]).toEqual(['SR2', 'sr2', 'SR2-HT', 'SR2']);
  });

  it('co v klíči přesně není, chybí v klíči a nepočítá se', () => {
    const matrix = new Map(
      [
        { lot: '10', productionNumber: 'T0001', planned: at(5, 8), optionType: 'SR1', colors: 'C9 / C1', status: { FL: '20 - Container planned', RR: '20 - Container planned' } },
        { lot: '11', productionNumber: 'T0009', planned: at(6, 11), optionType: 'SR1-HT', colors: 'C9 / C1', status: { FL: '20 - Container planned', FR: '20 - Container planned' } },
      ].map((c) => [c.productionNumber, c]),
    );
    const stock = { MC: new Map([['MC-KEY-FL', 5]]), MF: new Map([['MF-KEY-FL', 1]]) };
    const t = buildMaterialCoverage({ matrix, key: key.value, stock, today: day(5) });
    const [t1, t9] = t.cars;
    expect(t1!.doors.FL).toMatchObject({ state: 'ok', unknown: [] });
    expect(t1!.doors.FL!.parts).toEqual([
      { item: 'MC-KEY-FL', kind: 'MC', qty: 1, left: 4 },
      { item: 'MF-KEY-FL', kind: 'MF', qty: 1, left: 0 },
    ]);
    expect(t1!.doors.RR).toMatchObject({ state: 'unknown', parts: [], unknown: ['MC', 'MF'] });
    expect(t9!.doors.FL).toMatchObject({ state: 'short', parts: [{ item: 'MF-KEY-FL-HT', left: -1 }], unknown: ['MC'] });
    expect(t9!.doors.FR).toMatchObject({ state: 'unknown', unknown: ['MC', 'MF'] });
    expect(t).toMatchObject({ known: 1, unknown: 3, unknownByKind: { MC: 3, MF: 2 } });
    expect(carUndetermined(t9!)).toEqual([
      { kind: 'MC', doors: ['FL', 'FR'] },
      { kind: 'MF', doors: ['FR'] },
    ]);
    // neurčené díly se nepočítají do potřeby
    expect(t.parts.map((p) => p.item)).toEqual(['MC-KEY-FL', 'MF-KEY-FL-HT', 'MF-KEY-FL']);
    expect(missingKeys(t.cars).map((m) => `${m.kind} ${m.door} ${m.optionType} ${m.colour} ${m.doors}`)).toEqual([
      'MC RR SR1 C9 1',
      'MC FL SR1-HT C9 1',
      'MC FR SR1-HT C9 1',
      'MF RR SR1 C1 1',
      'MF FR SR1-HT C1 1',
    ]);
    expect(t.parts.find((p) => p.item === 'MF-KEY-FL-HT')).toMatchObject({ kind: 'MF', description: 'ASSY MF SR1 HEAT. FRT LH' });
  });
});

describe('export Sekvence', () => {
  const key = parsePartKey([
    ['Side', 'Item Number', 'Type', 'Colour', 'Description'],
    ['FL', 'MC-1', 'SR1', 'C1', 'ASSY MC'],
    ['FL', 'MF-1', 'SR1', 'C1', 'ASSY MF'],
  ]);
  if (!key.ok) throw new Error();
  const car = (pn: string, planned: number) => ({ lot: '1', productionNumber: pn, planned, optionType: 'SR1', colors: 'C1 / C1', status: { FL: '20 - Container planned' } });
  const matrix = new Map([car('T1', at(5, 8)), car('T2', at(6, 8)), car('T3', at(6, 9))].map((c) => [c.productionNumber, c]));
  const t = buildMaterialCoverage({ matrix, key: key.value, stock: { MC: new Map([['MC-1', 5]]), MF: new Map([['MF-1', 1]]) }, today: day(5) });
  const texts = {
    title: 'Sekvence',
    subtitle: 'sub',
    filters: 'filtry',
    note: 'pozn.',
    weekdays: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'],
    kinds: { MC: 'Maincarrier', MF: 'Middlefield' },
    item: 'Díl',
    description: 'Popis',
    stock: 'Sklad',
    total: 'Potřeba',
    overdue: 'Po termínu',
    shortFrom: 'Chybí od',
    sum: 'Celkem',
    sheetCoverage: 'Coverage',
    sheetDemand: 'Potreba po dnech',
    sheetMatrix: 'Matrix',
    lot: 'Lot',
    productionNumber: 'Production number',
    optionType: 'Option Type',
    colors: 'MC / MF',
    planned: 'Planned customer built',
    status: 'Status',
    material: 'Materiál',
    matrixNote: 'pozn. matice',
    sheetPrio: 'PRIO Sorting',
    order: 'Pořadí',
    kind: 'Druh',
    firstNeed: 'První potřeba',
    prioNote: 'pozn. prio',
  };
  const [matrixSheet, coverage, demand, prio] = sequenceReport(t.parts, t.days, texts, {
    boundary: day(6),
    shortText: (p) => (p.firstShort ? `od ${p.firstShort.productionNumber}` : ''),
    needText: (p) => `poprvé ${p.demands[0]!.productionNumber}`,
    cars: t.cars,
    carTexts: (car) => ({ planned: `stavba ${car.productionNumber}`, material: car.short ? 'FL: chybí' : 'vše na skladě', tone: car.short ? 'short' : 'ok' }),
  });
  const values = (row: (ReportCell | null)[] | undefined) => (row ?? []).map((c) => c?.value ?? null);

  it('list Matrix: vozy jako v aplikaci, stav dveří v barvě matice a štítky MC a MF', () => {
    expect(matrixSheet!.name).toBe('Matrix');
    expect(values(matrixSheet!.data[4]).slice(0, 8)).toEqual(['Lot', 'Production number', 'Option Type', 'MC / MF', 'Planned customer built', 'Status FL', 'MC', 'MF']);
    expect(values(matrixSheet!.data[4]).at(-1)).toBe('Materiál');
    // T1 má MC i MF na skladě; T3 chybí MF
    const t1 = matrixSheet!.data[5]!;
    expect(values(t1).slice(0, 8)).toEqual(['1', 'T1', 'SR1', 'C1 / C1', 'stavba T1', '20 - Container planned', 'MC', 'MF']);
    expect(t1[5]).toMatchObject({ backgroundColor: '#FFA500' });
    expect([t1[6], t1[7]]).toMatchObject([{ backgroundColor: '#2E8B3E' }, { backgroundColor: '#2E8B3E' }]);
    const t3 = matrixSheet!.data[7]!;
    expect(t3[1]).toMatchObject({ value: 'T3', textColor: '#B42D2D' });
    expect([t3[6], t3[7]]).toMatchObject([{ backgroundColor: '#2E8B3E' }, { backgroundColor: '#C62828' }]);
    expect(t3.at(-1)).toMatchObject({ value: 'FL: chybí', textColor: '#B42D2D' });
  });

  it('list Coverage: stav skladu na konci dne po druzích, záporné červeně, zítřek orámovaný', () => {
    expect([coverage!.name, demand!.name]).toEqual(['Coverage', 'Potreba po dnech']);
    expect(values(coverage!.data[4])).toEqual(['Díl', 'Popis', 'Sklad', 'Potřeba', 'Chybí od', 'Čt', 'Pá']);
    expect(values(coverage!.data[6])[0]).toBe('Maincarrier');
    expect(values(coverage!.data[7])).toEqual(['MC-1', 'ASSY MC', 5, 3, '', 4, 2]);
    expect(values(coverage!.data[8])[0]).toBe('Middlefield');
    expect(values(coverage!.data[9])).toEqual(['MF-1', 'ASSY MF', 1, 3, 'od T2', 0, -2]);
    expect(coverage!.data[9]![6]).toMatchObject({ backgroundColor: '#FDECEC', leftBorderColor: '#2E8B3E' });
  });

  it('list Potřeba po dnech: kusy sečtené po dnech, červeně nepokryté dny, součet za druh', () => {
    expect(values(demand!.data[7])).toEqual(['MC-1', 'ASSY MC', 5, 3, '', 1, 2]);
    expect(values(demand!.data[8])).toEqual(['Celkem Maincarrier', '', '', 3, '', 1, 2]);
    expect(values(demand!.data[10])).toEqual(['MF-1', 'ASSY MF', 1, 3, 'od T2', 1, 2]);
    expect(demand!.data[10]![5]).not.toHaveProperty('textColor');
    expect(demand!.data[10]![6]).toMatchObject({ textColor: '#B42D2D' });
  });

  it('list PRIO Sorting: reference a kusy po dnech podle první potřeby, s pořadím a druhem', () => {
    expect(prio!.name).toBe('PRIO Sorting');
    expect(values(prio!.data[4])).toEqual(['Pořadí', 'Díl', 'Druh', 'Popis', 'Sklad', 'Potřeba', 'První potřeba', 'Čt', 'Pá']);
    expect(values(prio!.data[6])).toEqual([1, 'MC-1', 'MC', 'ASSY MC', 5, 3, 'poprvé T1', 1, 2]);
    expect(values(prio!.data[7])).toEqual([2, 'MF-1', 'MF', 'ASSY MF', 1, 3, 'poprvé T1', 1, 2]);
    expect(prio!.data[6]![8]).toMatchObject({ leftBorderColor: '#2E8B3E' });
  });
});
