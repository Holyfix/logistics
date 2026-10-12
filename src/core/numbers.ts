// Čtení čísel z exportů v českém i anglickém formátu.

/**
 * Převede text na číslo. Zvládne „1 905,0“ (mezera nebo pevná mezera jako oddělovač tisíců),
 * „1.905,0“, „1,905.0“ i „1905“. Vrátí null pro prázdnou nebo neplatnou hodnotu.
 */
export function parseNumber(input: string): number | null {
  let s = input.replace(/[\s\u00a0\u202f']/g, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Desetinný oddělovač je ten, který je víc vpravo.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  return Number(s);
}
