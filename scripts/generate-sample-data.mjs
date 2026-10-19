// Vytvoří smyšlená ukázková data ve formátu exportu odvolávek a kmenových dat.
// Použití: node scripts/generate-sample-data.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import writeXlsxFile from 'write-excel-file/node';

const NBSP = ' ';
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const PROJECTS = [
  ['P100', 'Zákazník A', 'ASSY DOOR PANEL', 'SO100', 'S100'],
  ['P200', 'Zákazník A', 'MAP POCKET', 'SO200', 'S100'],
  ['P300', 'Zákazník B', 'ASM IP', 'SO300', 'S300'],
  ['P400', 'Zákazník C', 'ASSY GLOVEBOX', 'SO400', 'S400'],
];
const items = [];
let number = 900100;
for (const [project, customer, kind, so, shipTo] of PROJECTS) {
  for (const side of ['LHD', 'RHD']) {
    for (const variant of ['BASIS', 'PREMIUM']) {
      items.push({ item: String(number++), description: `${kind} ${variant} ${side} ${project}`, project, customer, side, so, shipTo, base: Math.round(20 + rnd() * 180) });
    }
  }
}
items.push({ item: 'X0001-9051', description: 'SPARE PART NEW', project: '', customer: '', side: '', so: 'SO900', shipTo: 'S900', base: 3 });

const qty = (n) => `"${n.toLocaleString('en-US').replace(/,/g, NBSP)},0"`;
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
const mondayOfWeek = (week) => new Date(Date.UTC(2026, 0, 5 + (week - 2) * 7));

const header = 'Item Number,Item Description,Date,Time,Schedule Type,Interval,Reference,Discrete Qty,Cumulative Qty,Cum Shipped,Net Cumulative Quantity,Sales Order,Line,Release,Carline,Site,Ship-To';

mkdirSync('sample-data/odvolavky', { recursive: true });
for (const week of [40, 41, 42]) {
  const start = mondayOfWeek(week);
  const lines = [header];
  items.forEach((it, idx) => {
    let cum = 50_000 + idx * 1000 + (week - 40) * it.base * 5;
    const shipped = cum - Math.round(it.base * (rnd() < 0.3 ? 2 : 0));
    // Denně na 4 týdny, pak týdně (pondělí) na půl roku.
    for (let d = 0; d < 26 * 7; d++) {
      const date = new Date(start.getTime() + d * 86_400_000);
      const dow = date.getUTCDay();
      const daily = d < 28;
      if (daily ? dow === 0 || dow === 6 : dow !== 1) continue;
      const factor = 1 + (rnd() - 0.5) * (week === 42 && d < 14 ? 0.6 : 0.1);
      const q = Math.max(1, Math.round((daily ? it.base : it.base * 5) * factor));
      cum += q;
      lines.push([it.item, it.description, fmtDate(date), '', 3, 'D', '', qty(q), qty(cum), qty(shipped), qty(Math.max(0, cum - shipped)), it.so, idx + 1, '000001', 'C1', '1000', it.shipTo].join(','));
    }
  });
  writeFileSync(`sample-data/odvolavky/Odvolavky_CW${week}.csv`, '﻿' + lines.join('\r\n') + '\r\n');
}

// Mapování dílů ve formátu Item_Mapping: číslo zákazníka je smyšlené (A + 10 číslic, mezery, varianta).
const customerNumber = (idx) => `A90000000${String(10 + (idx % 4)).padStart(2, '0')}  0000${String(1000 + idx)}`;
// Komponenty z kusovníku: nakupované díly (PG), sledované v modulu Komponenty.
const COMPONENTS = [
  { item: 'K-1001', description: 'SCREW M5 BLACK', um: 'EA', source: 'P', qty: 6, supplier: 'Dodavatel Alfa' },
  { item: 'K-1002', description: 'CLIP PANEL', um: 'EA', source: 'P', qty: 4, supplier: 'Dodavatel Alfa' },
  { item: 'K-1003', description: 'LABEL', um: 'EA', source: 'P', qty: 1 },
  { item: 'K-2001', description: 'GRANULATE PP', um: 'KG', source: 'P', qty: 0.85, sub: true, supplier: 'Dodavatel Beta' },
  { item: 'K-2002', description: 'FOAM PAD', um: 'EA', source: 'P', qty: 2, sub: true, supplier: 'Dodavatel Gama' },
];
// Kategorie hotového dílu podle druhu výrobku v popisu; varianta jen u dveřních panelů projektu P100 (BASIS / PREMIUM).
const CATEGORY = { DOOR: 'DP', POCKET: 'MP', IP: 'IP', GLOVEBOX: 'GB' };
const master = [
  'Item Number;Item Type;Customer Number;Description;Project;Category;Side;Variant;Line;Order Multiple;Supplier',
  ...items
    .filter((it) => it.project)
    .map((it, idx) => {
      const variant = it.project === 'P100' ? (it.description.includes('PREMIUM') ? 'PREMIUM' : 'BASIS') : '';
      return [it.item, 'FG', customerNumber(idx), it.description, it.project, CATEGORY[it.description.split(' ')[1]], it.side, variant, 'ASSEMBLY', [8, 12, 16, 24][idx % 4], ''].join(';');
    }),
  // Nakupované díly (PG) se sledují v modulu Komponenty, mezivýroba (SFG) ne; dodavatel u PG (jeden bez dodavatele).
  ...COMPONENTS.map((c) => [c.item, 'PG', '', c.description, '', '', '', '', '', '', c.supplier ?? ''].join(';')),
  'S-0100;SFG;;CARRIER SUB-ASSY;P100;;;;FOA;;',
  // Doběhlý nakupovaný díl: na skladě, ale bez potřeby.
  'K-0900;PG;;TRIM OLD VERSION;;;;;;;',
];
writeFileSync('sample-data/Item_Mapping.csv', '\ufeff' + master.join('\r\n') + '\r\n');

// Coverage ve formátu „Coverage Report Overview“: dva řádky záhlaví, pro každý den blok čtyř sloupců.
// Konečný stav dne je v souboru vzorec; aplikace ho počítá ze skladu a poptávky, proto stačí uložená čísla.
const covDays = [12, 13, 14, 15, 16, 19, 20, 21, 22, 23].map((day) => new Date(Date.UTC(2026, 9, day)));
const fixed = ['Customer Item Number', 'Customer Item Number 2', 'Supplier', 'Item number', 'Item description', 'First\nuncovered\nIB-Plan', 'First uncovered Prod No', 'Further stock in transit', 'Delivery\nnotes\nin transit', 'QHold', 'Open Orders', 'Stock in Lokalita A 07:00'];
const bold = (value) => ({ value, fontWeight: 'bold' });
const covRows = [
  [...fixed.map(() => null), ...covDays.flatMap((date) => [{ value: date, type: Date, format: 'dd.mm.yyyy' }, null, null, null])],
  [...fixed.map(bold), ...covDays.flatMap(() => ['Disposable Stock', 'Demand', 'In\nTransit', 'Stock End of the Day'].map(bold))],
];
items.filter((it) => it.project === 'P100' || it.project === 'P200').forEach((it, idx) => {
  const cn = customerNumber(idx);
  const stock = Math.round(it.base * (1.5 + rnd() * 7));
  const openOrders = rnd() < 0.2 ? 2 : 0;
  let balance = stock - openOrders;
  const transit = rnd() < 0.5 ? Math.round(it.base * 0.6) : 0;
  const cells = [];
  let firstUncovered = null;
  covDays.forEach((date, k) => {
    const demand = Math.round(it.base * (0.6 + rnd() * 0.8));
    const disposable = balance;
    balance -= demand;
    if (balance + transit < 0 && !firstUncovered) firstUncovered = new Date(date.getTime() + (6 + Math.floor(rnd() * 12)) * 3_600_000);
    cells.push({ value: disposable, type: Number }, { value: demand, type: Number }, k === 0 && transit ? { value: transit, type: Number } : null, { value: balance, type: Number });
  });
  covRows.push([
    { value: cn.replace('  0000', '      '), type: String },
    { value: cn.replace('  0000', '-'), type: String },
    null,
    null,
    { value: it.description, type: String },
    firstUncovered ? { value: firstUncovered, type: Date, format: 'dd.mm.yyyy hh:mm' } : null,
    firstUncovered ? { value: `08${String(70000 + idx * 37)}`, type: String } : null,
    null,
    transit ? { value: String(26000000 + idx), type: String } : null,
    { value: 0, type: Number },
    { value: openOrders, type: Number },
    { value: stock, type: Number },
    ...cells,
  ]);
});
mkdirSync('sample-data/Coverage/Lokalita A/P100', { recursive: true });
await writeXlsxFile(covRows, { sheet: 'Coverage Report Overview' }).toFile('sample-data/Coverage/Lokalita A/P100/Coverage_Report_P100.xlsx');

// Coverage ve formátu „articles“: dny jako text „2026.10.13“, stav dne včetně transitu.
const artDays = Array.from({ length: 14 }, (_, k) => new Date(Date.UTC(2026, 9, 13 + k)));
const ymd = (date) => `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
const artRows = [
  [
    ...['Site', 'Client', 'Supplier', 'Customer Item', 'Item number', 'Item description', 'Stock', 'First uncovered IB-Plan', 'First uncovered Prod No', 'Further stock in transit', 'Stock in transit', 'Delivery notes in transit'].map(bold),
    ...artDays.map((date) => bold(ymd(date))),
  ],
];
items.filter((it) => it.project === 'P300' || it.project === 'P400').forEach((it, i) => {
  const idx = i + 8;
  const stock = Math.round(it.base * (2 + rnd() * 6));
  const transit = rnd() < 0.4 ? Math.round(it.base * 0.8) : 0;
  let balance = stock + transit;
  let firstUncovered = null;
  const days = artDays.map((date) => {
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    balance -= weekend ? 0 : Math.round(it.base * (0.6 + rnd() * 0.8));
    if (balance < 0 && !firstUncovered) firstUncovered = `${ymd(date)} ${pad(6 + Math.floor(rnd() * 12))}:${pad(Math.floor(rnd() * 60))}`;
    return { value: balance, type: Number };
  });
  artRows.push([
    { value: 'S1', type: String },
    { value: 'Dodavatel', type: String },
    { value: '100200', type: String },
    { value: customerNumber(idx).replace('  0000', '      '), type: String },
    { value: it.item, type: String },
    { value: it.description, type: String },
    { value: stock, type: Number },
    firstUncovered ? { value: firstUncovered, type: String } : null,
    firstUncovered ? { value: 5700000 + idx * 41, type: Number } : null,
    null,
    { value: transit, type: Number },
    null,
    ...days,
  ]);
});
mkdirSync('sample-data/Coverage/Lokalita B/P300', { recursive: true });
await writeXlsxFile(artRows, { sheet: 'articles' }).toFile('sample-data/Coverage/Lokalita B/P300/Coverage_Report_P300.xlsx');

// Coverage ve formátu „bestand“: hlavička s klientem, záhlaví na 4. řádku, stav dne bez transitu.
// Řádky jiného klienta se v aplikaci vynechají.
const bestandRows = [
  [null, { value: 'KLIENT:', type: String }, { value: 'KLIENT A', type: String }],
  [null, { value: 'Čas:', type: String }, { value: '2026-10-13 06:54:44', type: String }],
  [],
  [
    ...['KUNDE', 'ARTIKEL', 'SACHNUMMER', 'BEZEICHNUNG', 'Bestand', 'False', 'Avisiert', 'Gesperrt', 'Erste Fehlende', 'PlanZeit'].map(bold),
    ...artDays.map((date) => ({ value: date, type: Date, format: 'dd.mm.yyyy', fontWeight: 'bold' })),
  ],
];
items.filter((it) => it.project === 'P200').forEach((it, i) => {
  const idx = i + 4;
  const stock = Math.round(it.base * (2 + rnd() * 6));
  const transit = rnd() < 0.5 ? Math.round(it.base * 0.7) : 0;
  let balance = stock;
  let firstUncovered = null;
  const days = artDays.map((date) => {
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    balance -= weekend ? 0 : Math.round(it.base * (0.6 + rnd() * 0.8));
    if (balance + transit < 0 && !firstUncovered) firstUncovered = new Date(date.getTime() + (6 + Math.floor(rnd() * 12)) * 3_600_000);
    return { value: balance, type: Number };
  });
  bestandRows.push([
    { value: 'KLIENT A', type: String },
    { value: it.item, type: String },
    { value: customerNumber(idx), type: String },
    { value: it.description, type: String },
    { value: stock, type: Number },
    { value: 0, type: Number },
    { value: transit, type: Number },
    { value: 0, type: Number },
    firstUncovered ? { value: 4700000 + idx * 53, type: Number } : null,
    firstUncovered ? { value: firstUncovered, type: Date, format: 'dd.mm.yyyy hh:mm' } : null,
    ...days,
  ]);
  bestandRows.push([{ value: 'KLIENT B', type: String }, { value: `8${it.item.slice(1)}`, type: String }, { value: `B${it.item}`, type: String }, { value: 'CIZÍ DÍL', type: String }, { value: 5, type: Number }]);
});
mkdirSync('sample-data/Coverage/Lokalita C/P200', { recursive: true });
await writeXlsxFile(bestandRows, { sheet: 'bestand' }).toFile('sample-data/Coverage/Lokalita C/P200/bestand_P200.xlsx');

// Náš sklad ve formátu exportu zásob po lokacích: hotové díly v zónách SALE/PURCH, výroba a blokace jinde.
// Cena za jednotku, závod (jiný než 1000 = externí sklad, sekvencér u zákazníka), datum poslední transakce (m/d/rr) a ABC.
const czQty = (n) => `"${n.toLocaleString('en-US').replace(/,/g, NBSP)},0"`;
const czCost = (n) => `"${n.toFixed(2).replace('.', ',')}"`;
const moved = (daysAgo) => {
  const d = new Date(Date.UTC(2026, 9, 13 - daysAgo));
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;
};
const stockLines = ['Site,Item Number,Description,Unit of Measure,Status,Standard Cost,Qty On Hand - Inv Detail,Location,Zone ID,Area ID,Warehouse ID,OID Date (Last Transaction Date),ABC Class'];
const stockLine = (it, um, status, cost, qty, location, site, zone, area, daysAgo, abc) =>
  stockLines.push([site || '1000', it.item, it.description, um, status, czCost(cost), czQty(qty), location, zone, area, 'WH1', moved(daysAgo), abc].join(','));
items
  .filter((it) => it.project)
  .forEach((it, idx) => {
    const pack = [8, 12, 16, 24][idx % 4];
    const cost = 600 + (idx % 7) * 450;
    const abc = ['A', 'B', 'B', 'C'][idx % 4];
    const full = Math.floor(rnd() * 4);
    for (let k = 0; k < full; k++) stockLine(it, 'EA', 'WH.F', cost, pack, `A-0${k + 1}`, '', 'SALE', 'WRH', 1 + k, abc);
    if (idx % 3 === 0) stockLine(it, 'EA', 'WH.P', cost, Math.ceil(pack / 2), 'B-01', '', 'PURCH', 'WRH', 2, abc);
    stockLine(it, 'EA', 'Prod-O', cost, Math.round(rnd() * 30), 'L-01', '', 'WRKC', 'PROD', 0, abc);
    // Sekvencér u zákazníka: díly jsou stále naše (externí lokace).
    if (idx % 2 === 0) stockLine(it, 'EA', 'WH.F', cost, pack * 2, 'SEQ-EXT', '1000DE', 'SEQ', 'WRH', 1, abc);
    if (idx % 5 === 0) stockLine(it, 'EA', 'QH', cost, 2, 'Q-HOLD', '', 'LAB', 'PROD', 20, abc);
    if (idx % 7 === 0) stockLine(it, 'EA', 'DIFF', cost, 1, 'CYCLE-01', '', 'CYCLE', 'WRH', 40, abc);
  });
// Sklad komponent (nákup) s různým pokrytím.
COMPONENTS.forEach((c, k) => {
  const qty = [80_000, 20_000, 15_000, 3_000, 0][k];
  stockLine(c, c.um, 'WH.P', [0.35, 0.8, 0.05, 42, 12][k], qty, `C-0${k + 1}`, '', 'PURCH', 'WRH', 3 + k, ['B', 'A', 'C', 'A', 'B'][k]);
});
stockLine({ item: 'S-0100', description: 'CARRIER SUB-ASSY' }, 'EA', 'WH.P', 310, 40, 'F-01', '', 'WRKC', 'PROD', 1, 'A');
stockLine(COMPONENTS[1], 'EA', 'ClaimS-O', 0.8, 500, 'CLAIM-01', '', 'CLAIM', 'WRH', 9, 'A');
// Doběhlý díl bez pohybu přes rok a obaly mimo mapování.
stockLine({ item: 'K-0900', description: 'TRIM OLD VERSION' }, 'EA', 'WH.P', 95, 1_400, 'C-09', '', 'PURCH', 'WRH', 420, 'C');
stockLine({ item: 'PAL-1200', description: 'PALLET 1200x800' }, 'EA', 'WH.P', 180, 60, 'PACK-01', '', 'PURCH', 'WRH', 15, 'C');
writeFileSync('sample-data/Stock_13.10.2026.csv', '\ufeff' + stockLines.join('\r\n') + '\r\n');

// Doplněný transit: ranní expedice, kterou soubor coverage ještě nemá (export transakcí, výdej je záporný).
mkdirSync('sample-data/Transit', { recursive: true });
const transitLines = ['Site,Item Number,Item Description,Transaction Number,Transaction Type,Effective Date,Time,Quantity Change,Address,Shipper Number'];
items
  .filter((it) => it.project === 'P100')
  .slice(0, 2)
  .forEach((it, k) => transitLines.push(['1000', it.item, it.description, 9001 + k, 'ISS-DO', '13.10.2026', '05:40', -[48, 24][k], '1000DE', 'SD-0001'].join(',')));
writeFileSync('sample-data/Transit/Transit_13.10.2026.csv', '\ufeff' + transitLines.join('\r\n') + '\r\n');

// Kusovník ve formátu exportu z ERP: odsazené úrovně, množství na nadřazený díl.
const bomRows = [['Level', 'Component Item', 'Description', 'Quantity Per', 'UM', 'Purchase/Manufacture', 'Start Eff'].map(bold)];
const text = (value) => ({ value, type: String });
for (const it of items.filter((i) => i.project === 'P100' || i.project === 'P300')) {
  bomRows.push([text('Parent'), text(it.item), text(it.description), null, text('EA'), text('L'), null]);
  for (const c of COMPONENTS.filter((x) => !x.sub)) bomRows.push([text('1'), text(c.item), text(c.description), { value: c.qty, type: Number }, text(c.um), text(c.source), text('01.01.2026')]);
  bomRows.push([text('1'), text('S-0100'), text('CARRIER SUB-ASSY'), { value: 1, type: Number }, text('EA'), text('L'), text('01.01.2026')]);
  for (const c of COMPONENTS.filter((x) => x.sub)) bomRows.push([text('.2'), text(c.item), text(c.description), { value: c.qty, type: Number }, text(c.um), text(c.source), text('01.01.2026')]);
}
mkdirSync('sample-data/BOM', { recursive: true });
await writeXlsxFile(bomRows, { sheet: 'Sheet1' }).toFile('sample-data/BOM/MBOM_ASSY_PANEL.xlsx');

// Nastavení plánování: kapacita montáže po projektech (s rezervou nad průměrnou denní potřebou) a doprava podle destinace.
const head = (values) => values.map(bold);
const capacityRows = PROJECTS.map(([project]) => {
  const daily = items.filter((it) => it.project === project).reduce((sum, it) => sum + it.base, 0);
  return [text('ASSEMBLY'), text(project), { value: Math.ceil((daily * 1.15) / 3 / 10) * 10, type: Number }, text(project === 'P400' ? 'R O' : 'R O N')];
});
mkdirSync('sample-data/Plan', { recursive: true });
await writeXlsxFile([
  { sheet: 'Linky', data: [head(['Linka', 'Projekt', 'Ks za směnu', 'Směny po–pá']), ...capacityRows] },
  {
    sheet: 'Destinace',
    data: [
      head(['Destinace', 'Pokrytí u zákazníka (dny)', 'Transit (h)', 'Příjezd']),
      [text('Lokalita A'), { value: 2, type: Number }, { value: 24, type: Number }, text('06:00')],
      [text('Lokalita B'), { value: 2, type: Number }, { value: 24, type: Number }, text('06:00')],
      [text('Lokalita C'), { value: 2, type: Number }, { value: 48, type: Number }, text('06:00')],
      [null, { value: 2, type: Number }, { value: 24, type: Number }, text('06:00')],
    ],
  },
  { sheet: 'Směny', data: [head(['Ranní směna od']), [text('06:00')]] },
]).toFile('sample-data/Plan/Kapacity.xlsx');

console.log(`Vytvořeno: 3 exporty, ${items.length} dílů, mapování pro ${items.length - 1} dílů, coverage ve 3 formátech, sklad, kusovník.`);
