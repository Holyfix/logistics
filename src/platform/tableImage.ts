// Tabulka jako obrázek (PNG) pro vložení do e-mailu nebo chatu: vykreslí se přímo na plátno (bez knihoven a bez
// vkládaných stylů, které aplikace kvůli Content-Security-Policy nesmí), zkopíruje se do schránky, jinak se stáhne.

import type { ImageColumn, ImageTable } from '../core/tableImage';
import { downloadBlob } from './download';

const PAD = 16;
const ROW = 22;
const HEAD = 24;
const SUB = 18;
const C = { ink: '#13202A', muted: '#6F7E8B', header: '#1D5C9E', headerText: '#FFFFFF', subHeader: '#DCE6F1', grid: '#E5EAEE', background: '#FFFFFF' };

/** Písmo aplikace (stejné jako na stránce), aby obrázek vypadal jako tabulka v aplikaci. */
function fonts(): { body: string; display: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    body: style.getPropertyValue('--font-body').trim() || 'system-ui, sans-serif',
    display: style.getPropertyValue('--font-display').trim() || 'system-ui, sans-serif',
  };
}

/** Text zkrácený na šířku se třemi tečkami. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}

/** Sloupce s `fit` zúží na nejširší text (záhlaví tučně, buňky podle tučnosti), nejvýš na zadanou šířku. */
function fitColumns(table: ImageTable, f: { body: string; display: string }): ImageColumn[] {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return table.columns;
  return table.columns.map((col, k) => {
    if (!col.fit) return col;
    ctx.font = `700 12px ${f.display}`;
    let widest = ctx.measureText(col.label).width;
    for (const row of table.rows) {
      const cell = row[k];
      if (!cell?.text) continue;
      ctx.font = `${cell.bold ? 700 : 400} 12px ${f.body}`;
      widest = Math.max(widest, ctx.measureText(cell.text).width);
    }
    return { ...col, width: Math.min(col.width, Math.ceil(widest) + 14) };
  });
}

/** Vykreslí tabulku na plátno a vrátí PNG; ostrý obrázek i na displejích s vyšší hustotou (dvojnásobné rozlišení). */
export async function tableImage(table: ImageTable): Promise<Blob> {
  await document.fonts?.ready;
  const f = fonts();
  const columns = fitColumns(table, f);
  const hasSub = columns.some((c) => c.sub);
  const width = PAD * 2 + columns.reduce((s, c) => s + c.width, 0);
  const top = PAD + 24 + 18 + 10;
  const headHeight = HEAD + (hasSub ? SUB : 0);
  const height = top + headHeight + table.rows.length * ROW + (table.note ? 28 : 0) + PAD;
  // Plátno má v prohlížečích omezenou velikost; velkou tabulku vykreslí v menším měřítku.
  const scale = Math.min(2, 16000 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.scale(scale, scale);
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = C.ink;
  ctx.font = `700 18px ${f.display}`;
  ctx.fillText(table.title, PAD, PAD + 10);
  ctx.fillStyle = C.muted;
  ctx.font = `400 12px ${f.body}`;
  ctx.fillText(fit(ctx, table.subtitle, width - PAD * 2), PAD, PAD + 32);

  const text = (value: string, x: number, w: number, y: number, align: ImageColumn['align']) => {
    const s = fit(ctx, value, w - 12);
    const tx = align === 'left' ? x + 6 : align === 'right' ? x + w - 6 : x + w / 2;
    ctx.textAlign = align;
    ctx.fillText(s, tx, y);
  };

  // Záhlaví.
  let x = PAD;
  for (const col of columns) {
    ctx.fillStyle = col.headerBackground ?? C.header;
    ctx.fillRect(x, top, col.width, HEAD);
    ctx.fillStyle = C.headerText;
    ctx.font = `700 12px ${f.display}`;
    text(col.label, x, col.width, top + HEAD / 2, col.align);
    if (hasSub) {
      ctx.fillStyle = col.subBackground ?? C.subHeader;
      ctx.fillRect(x, top + HEAD, col.width, SUB);
      ctx.fillStyle = C.ink;
      ctx.font = `400 10px ${f.body}`;
      text(col.sub ?? '', x, col.width, top + HEAD + SUB / 2, col.align);
    }
    x += col.width;
  }
  ctx.fillStyle = C.header;
  ctx.fillRect(PAD, top + headHeight - 2, width - PAD * 2, 2);

  // Řádky.
  table.rows.forEach((row, r) => {
    const y = top + headHeight + r * ROW;
    let cx = PAD;
    row.forEach((cell, k) => {
      const col = columns[k]!;
      if (cell.background) {
        ctx.fillStyle = cell.background;
        ctx.fillRect(cx, y, col.width, ROW);
      }
      ctx.fillStyle = cell.color ?? C.ink;
      ctx.font = `${cell.bold ? 700 : 400} 12px ${f.body}`;
      text(cell.text, cx, col.width, y + ROW / 2, col.align);
      cx += col.width;
    });
    ctx.fillStyle = C.grid;
    ctx.fillRect(PAD, y + ROW - 1, width - PAD * 2, 1);
  });

  // Rámeček zvýrazněných sloupců přes celou výšku tabulky.
  x = PAD;
  for (const col of columns) {
    if (col.edge) {
      ctx.fillStyle = col.edge;
      ctx.fillRect(x - 1, top, 2, headHeight + table.rows.length * ROW);
      ctx.fillRect(x + col.width - 1, top, 2, headHeight + table.rows.length * ROW);
    }
    x += col.width;
  }

  if (table.note) {
    ctx.fillStyle = C.muted;
    ctx.font = `italic 400 11px ${f.body}`;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, table.note, width - PAD * 2), PAD, top + headHeight + table.rows.length * ROW + 16);
  }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png'));
}

/**
 * Zkopíruje obrázek tabulky do schránky; když prohlížeč kopírování obrázků nepovolí (starší prohlížeč, stránka mimo
 * https), obrázek stáhne jako soubor. Vrátí, co se stalo.
 */
export async function copyTableImage(table: ImageTable, fileName: string): Promise<'copied' | 'downloaded'> {
  // Obrázek se do schránky předá jako příslib hned při kliknutí (prohlížeč povolí zápis jen krátce po kliknutí).
  const blob = tableImage(table);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    downloadBlob(fileName, await blob);
    return 'downloaded';
  }
}
