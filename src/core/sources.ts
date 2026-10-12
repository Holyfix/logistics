// Rozpoznání souborů ve sdílené složce podle cesty a názvu.

export type SourceKind = 'calloffs' | 'masterdata' | 'ignored';
export type SourceFormat = 'csv' | 'xlsx';

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function formatOf(path: string): SourceFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/**
 * Kmenová data: soubor s „kmenov“ nebo „master“ v názvu.
 * Odvolávky: soubor ve složce „odvolavky“ / „call-offs“, nebo s „odvolavk“ / „call-off“ v názvu.
 * Dočasné soubory Excelu (~$…) se ignorují.
 */
export function classifyPath(path: string): SourceKind {
  if (!formatOf(path)) return 'ignored';
  const parts = normalize(path).split('/');
  const name = parts[parts.length - 1]!;
  if (name.startsWith('~$')) return 'ignored';
  if (/kmenov|master/.test(name)) return 'masterdata';
  const folders = parts.slice(0, -1);
  if (folders.some((f) => /^(odvolavky|call-?offs?)$/.test(f)) || /odvolavk|call-?off/.test(name)) return 'calloffs';
  return 'ignored';
}
