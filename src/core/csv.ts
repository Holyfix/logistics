// Čtení a zápis CSV. Čisté funkce bez závislosti na prohlížeči.

export interface Table {
  header: string[];
  rows: string[][];
}

const DELIMITERS = [';', ',', '\t'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/** Odhadne oddělovač podle hlavičky (znak mimo uvozovky, který se v ní vyskytuje nejčastěji). */
export function detectDelimiter(text: string): Delimiter {
  const end = text.search(/\r?\n/);
  const line = end === -1 ? text : text.slice(0, end);
  let best: Delimiter = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Rozdělí CSV text na řádky a buňky (RFC 4180: uvozovky, zdvojené uvozovky, CRLF i LF).
 * Odstraní BOM na začátku a prázdné řádky.
 */
export function parseCsv(input: string, delimiter: Delimiter = detectDelimiter(input)): Table {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      cell += ch;
    }
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  const [header = [], ...body] = rows;
  return { header: header.map((h) => h.trim()), rows: body };
}

/** Zapíše tabulku jako CSV pro český Excel: oddělovač ';', BOM, uvozovky jen kde je potřeba. */
export function toCsv(header: string[], rows: (string | number | null)[][], delimiter: Delimiter = ';'): string {
  const escape = (value: string | number | null): string => {
    const s = value === null ? '' : String(value);
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header, ...rows].map((r) => r.map(escape).join(delimiter));
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

/** Normalizuje název sloupce pro porovnání: malá písmena, bez diakritiky a mezer navíc. */
export function normalizeHeader(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Najde index sloupce podle seznamu možných názvů. */
export function findColumn(header: string[], aliases: readonly string[]): number {
  const normalized = header.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(normalizeHeader(alias));
    if (index !== -1) return index;
  }
  return -1;
}
