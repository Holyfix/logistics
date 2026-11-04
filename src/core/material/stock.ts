// Ručně zadaný sklad MC a MF: vložení dvou sloupců z Excelu (díl a množství).

import { parseNumber } from '../numbers';

/**
 * Řádky „díl<TAB>množství“ (nebo oddělené středníkem); řádek bez čísla (např. záhlaví) se přeskočí. Stejný díl
 * víckrát se sečte (sklad z víc lokací).
 */
export function parseStockPaste(text: string): Map<string, number> {
  const stock = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/\t|;/).map((c) => c.trim());
    const item = (cells[0] ?? '').toUpperCase();
    const qty = cells.length > 1 ? parseNumber(cells[cells.length - 1]!) : null;
    if (!item || qty === null) continue;
    stock.set(item, (stock.get(item) ?? 0) + qty);
  }
  return stock;
}
