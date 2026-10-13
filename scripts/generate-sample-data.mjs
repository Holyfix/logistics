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
const master = [
  'Item Number;Customer Number;Description;Variant;Type;Project;Safety Stock;Safety Time;Order Multiple',
  ...items
    .filter((it) => it.project)
    .map((it, idx) => [it.item, customerNumber(idx), it.description, it.side + (idx % 4 === 1 ? ' HUD' : ''), it.description.split(' ')[1], it.project, 0, 0, [8, 12, 16, 24][idx % 4]].join(';')),
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

console.log(`Vytvořeno: 3 exporty, ${items.length} dílů, mapování pro ${items.length - 1} dílů, coverage ve 3 formátech.`);
