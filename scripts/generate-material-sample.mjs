// Vytvoří smyšlená ukázková data pro kartu Sekvence v Komponentách: JIT Overview a Order Status Matrix (složka
// Sekvence) a kusovník dveřních panelů (složka BOM). Použití: node scripts/generate-material-sample.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import writeXlsxFile from 'write-excel-file/node';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(rnd() * list.length)];

const DIR = 'sample-data/Sekvence';
const BOM_DIR = 'sample-data/BOM';
const DOORS = [
  ['FL', 'FRT LH'],
  ['FR', 'FRT RH'],
  ['RL', 'RR LH'],
  ['RR', 'RR RH'],
];
const TRIMS = ['SR1', 'SR2'];
const COLORS = ['C11', 'C22'];

// Čísla dílů: dveřní panel, Maincarrier a Middlefield podle výbavy, dveří a barvy.
const code = (base, trim, door) => base + TRIMS.indexOf(trim) * 10 + DOORS.findIndex((d) => d[0] === door);
const panelOf = (trim, door, color) => `${code(5100100, trim, door)}-${color}`;
const mcOf = (trim, door, color) => `${code(6200100, trim, door)}-${color}`;
const mfOf = (trim, door, color) => `${code(7300100, trim, door)}-${color}`;

// Kusovník: panel → MC (vyráběný, s díly pod sebou), MF (nakupovaný) a drobné díly.
const bom = [['Level', 'Component Item', 'Description', 'Project', 'Quantity Per', 'UM', 'P = Purchased / L = Line manufactured', 'Start Eff', 'End Eff']];
const cell = (value) => (value === null ? null : { value });
for (const trim of TRIMS)
  for (const [door, pos] of DOORS)
    for (const color of COLORS) {
      bom.push(['Parent', panelOf(trim, door, color), `ASSY DP ${trim} ${pos}`, 'P500', null, 'EA', 'L', null, null]);
      bom.push(['1', mcOf(trim, door, color), `ASSY MC ${trim} ${pos}`, 'P500', 1, 'EA', 'L', '01.01.2025', null]);
      bom.push(['.2', `${code(6290100, trim, door)}`, `MC RAW ${pos}`, 'P500', 1, 'EA', 'L', null, null]);
      bom.push(['..3', '1000500', 'GRANULATE PP', 'P500', 0.7, 'KG', 'P', null, null]);
      bom.push(['1', mfOf(trim, door, color), `ASSY MF ${trim} ${pos}`, 'P500', 1, 'EA', 'P', '01.01.2025', null]);
      // Starší Middlefield s ukončenou platností: kusovník ho vynechá.
      bom.push(['1', `${code(7390100, trim, door)}-${color}`, `ASSY MF OLD ${pos}`, 'P500', 1, 'EA', 'P', '01.01.2024', '31.12.2025']);
      bom.push(['1', '1000600', 'METAL CLIP', 'P500', 8, 'EA', 'P', null, null]);
    }
mkdirSync(DIR, { recursive: true });
mkdirSync(BOM_DIR, { recursive: true });
await writeXlsxFile(bom.map((row) => row.map(cell)), { sheet: 'MBOM' }).toFile(`${BOM_DIR}/MBOM_DOOR_PANEL_P500.xlsx`);

// Vozy: výbava, barva, montáž u zákazníka každých 12 minut od 13. 10. 2026 6:00 (směny 6–22 h).
const pad = (n) => String(n).padStart(2, '0');
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
const stamp = (c) => `${pad(c.day)}/10/2026 ${pad(Math.floor(c.minute / 60))}:${pad(c.minute % 60)}:00`;

// JIT Overview: jen prvních 110 vozů (ERP vydává zakázky postupně); každý řádek celý v uvozovkách jako export.
const header = ['Selected', 'Client', 'Plant', 'JIT order number', 'Item', 'Last priority', 'Production number', 'Sequence number', 'Assembly date', 'Article number', 'Article description', 'Article number (Pos)', 'Article description (Pos)'];
const line = (cells) => `"${cells.map((c, i) => (i === 0 ? c : `""${c}""`)).join(',')}"`;
const lines = [line(header)];
cars.slice(0, 110).forEach((c, i) => {
  const status = i < 12 ? 'Passed Cobot' : i < 30 ? 'Sequencelabel printed' : 'Container planned';
  const doors = [...DOORS.map(([door, pos]) => ({ door, pos })), ...(c.hb ? [{ door: 'HB', pos: 'HB' }] : [])];
  doors.forEach(({ door, pos }, item) => {
    const order = String(500000 + i);
    const base = ['False', '1', '1000', order, String(item + 1), status, c.pn, String(9000000 + i), stamp(c), `D-${door}`, `DOOR ${door}`];
    if (door === 'HB') lines.push(line([...base, '5199900', 'ASSY HB TRIM SR1']));
    else lines.push(line([...base, panelOf(c.trim, door, c.color), `ASSY DP ${c.trim} ${pos}`]));
    lines.push(line([...base, '8100200', 'WINDOW SWITCH']));
    lines.push(line([...base, '8100300', 'SPEAKER GRILL']));
  });
});
writeFileSync(`${DIR}/JIT_Overview.csv`, `${lines.join('\r\n')}\r\n`);

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

console.log(`Ukázková data pro Sekvenci: ${DIR} a ${BOM_DIR}/MBOM_DOOR_PANEL_P500.xlsx`);
