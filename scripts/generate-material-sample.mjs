// Vytvoří smyšlená ukázková data pro kartu Sekvence v Komponentách: Order Status Matrix a klíč MC/MF (složka
// Sekvence). Použití: node scripts/generate-material-sample.mjs
import { mkdirSync } from 'node:fs';
import writeXlsxFile from 'write-excel-file/node';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(rnd() * list.length)];

const DIR = 'sample-data/Sekvence';
const DOORS = [
  ['FL', 'FRT LH'],
  ['FR', 'FRT RH'],
  ['RL', 'RR LH'],
  ['RR', 'RR RH'],
];
const TRIMS = ['SR1', 'SR2'];
const COLORS = ['C11', 'C22'];
const FRONT = ['FL', 'FR'];

// Čísla dílů Maincarrieru a Middlefieldu podle výbavy, dveří a barvy; vyhřívaná výbava (-HT) jen u předních dveří.
const code = (base, trim, door) => base + TRIMS.indexOf(trim) * 10 + DOORS.findIndex((d) => d[0] === door);
const cell = (value) => (value === null || value === undefined ? null : { value });

// Klíč MC/MF: Side, Item Number, Type, Colour (jako ručně vedený klíč; zadní dveře bez vyhřívané varianty).
const key = [['Side', 'Item Number', 'Type', 'Colour', 'Type_colour', 'Description']];
for (const [kind, base] of [
  ['MC', 6200100],
  ['MF', 7300100],
])
  for (const [door, pos] of DOORS)
    for (const trim of TRIMS)
      for (const heated of FRONT.includes(door) ? [false, true] : [false])
        for (const color of COLORS) {
          const type = `${trim}${heated ? '-HT' : ''}`;
          const item = `${code(base + (heated ? 50 : 0), trim, door)}-${color}`;
          key.push([door, item, type, color, `${type}${color}`, `ASSY ${kind} ${trim}${heated ? ' HEAT.' : ''} ${pos}`]);
        }
mkdirSync(DIR, { recursive: true });
await writeXlsxFile(key.map((row) => row.map(cell)), { sheet: 'MC_MF' }).toFile(`${DIR}/MC_MF_Item_Mapping_P500.xlsx`);

// Vozy: výbava, barva, montáž u zákazníka každých 12 minut od 13. 10. 2026 6:00 (směny 6–22 h).
const cars = [];
let minute = 6 * 60;
let day = 13;
for (let i = 0; i < 160; i++) {
  if (minute >= 22 * 60) {
    day++;
    minute = 6 * 60;
  }
  cars.push({ pn: `V${String(1000001 + i)}`, trim: pick(TRIMS), color: pick(COLORS), day, minute, hb: rnd() < 0.3 });
  minute += 12;
}

// Order Status Matrix: všechny vozy, stav po dveřích (první vozy už zabalené a odeslané).
const STATUS = ['60 - Shipped', '50 - Packed', '45 - Passed Q-Gate', '40 - Passed Cobot', '30 - Sequencelabel printed', '20 - Container planned'];
const matrix = [
  [null, 'Report includes records'],
  [],
  ['Lot', null, 'Production number', null, 'Option Type', 'MC / MF', null, null, 'Planned customer built', null, 'Status FL', 'Status FR', null, null, 'Status RL', null, null, null, null, 'Status RR', null, null, 'Status HB'],
];
cars.forEach((c, i) => {
  const s = () => STATUS[Math.min(STATUS.length - 1, Math.floor(i / 6) + (rnd() < 0.3 ? 1 : 0))];
  matrix.push([
    String(20000 + Math.floor(i / 4)),
    null,
    c.pn,
    null,
    `${c.trim}${rnd() < 0.4 ? '-HT' : ''}`,
    `${c.color} / ${c.color}`,
    null,
    null,
    new Date(Date.UTC(2026, 9, c.day, Math.floor(c.minute / 60), c.minute % 60)),
    null,
    s(),
    s(),
    null,
    null,
    s(),
    null,
    null,
    null,
    null,
    s(),
    null,
    null,
    c.hb ? s() : null,
  ]);
});
await writeXlsxFile(
  matrix.map((row) => row.map((v) => (v === null || v === undefined ? null : v instanceof Date ? { value: v, type: Date, format: 'dd.mm.yyyy hh:mm' } : { value: v }))),
  { sheet: 'OrderStatusMatrixOverview' },
).toFile(`${DIR}/OrderStatusMatrixOverview.xlsx`);

console.log(`Ukázková data pro Sekvenci: ${DIR}`);
