// Vytvoří smyšlená ukázková data ve formátu exportu odvolávek a kmenových dat.
// Použití: node scripts/generate-sample-data.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

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

const master = ['Item Number;Item Description;Zákazník;Projekt;Strana', ...items.filter((it) => it.project).map((it) => [it.item, it.description, it.customer, it.project, it.side].join(';'))];
writeFileSync('sample-data/kmenova-data.csv', '﻿' + master.join('\r\n') + '\r\n');
console.log(`Vytvořeno: 3 exporty, ${items.length} dílů, kmenová data pro ${items.length - 1} dílů.`);
