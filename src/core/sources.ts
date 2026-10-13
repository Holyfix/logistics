// Rozpoznání souborů ve sdílené složce podle cesty a názvu.

export type SourceKind = 'calloffs' | 'masterdata' | 'coverage' | 'stock' | 'settings' | 'ignored';
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
  // .xlsm je sešit s makry; data se čtou stejně jako z .xlsx (makra se nespouští).
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
  return null;
}

/**
 * Kmenová data (mapování dílů): soubor s „kmenov“, „master“ nebo „mapping“ v názvu.
 * Coverage: Excel ve složce „coverage“ (i v podsložkách destinace a projektu).
 * Odvolávky: soubor ve složce „odvolavky“ / „call-offs“, nebo s „odvolavk“ / „call-off“ v názvu.
 * Náš sklad: soubor ve složce „stock“ / „sklad“, nebo s názvem začínajícím „stock“ / „sklad“ (např. Stock_13.10.2026.csv).
 * Nastavení: soubor s názvem začínajícím „settings“ / „nastaveni“ (např. Settings.csv).
 * Dočasné soubory Excelu (~$…) se ignorují.
 */
export function classifyPath(path: string): SourceKind {
  if (!formatOf(path)) return 'ignored';
  const parts = normalize(path).split('/');
  const name = parts[parts.length - 1]!;
  if (name.startsWith('~$')) return 'ignored';
  if (/kmenov|master|mapping/.test(name)) return 'masterdata';
  if (/^(settings|nastaveni)/.test(name)) return 'settings';
  const folders = parts.slice(0, -1);
  if (folders.includes('coverage')) return formatOf(path) === 'xlsx' ? 'coverage' : 'ignored';
  if (folders.some((f) => /^(odvolavky|call-?offs?)$/.test(f)) || /odvolavk|call-?off/.test(name)) return 'calloffs';
  if (folders.some((f) => /^(stock|sklad)$/.test(f)) || /^(stock|sklad)/.test(name)) return 'stock';
  return 'ignored';
}

/**
 * Destinace a projekt z cesty souboru coverage: Coverage/<destinace>/<projekt>/soubor.xlsx.
 * Chybějící úroveň zůstane prázdná. Názvy se berou ze složek, aplikace je nemá napevno.
 */
export function coverageScope(path: string): { location: string; project: string } {
  const parts = path.split('/');
  const index = parts.findIndex((p) => normalize(p) === 'coverage');
  const folders = index === -1 ? [] : parts.slice(index + 1, -1);
  return { location: folders[0] ?? '', project: folders[1] ?? '' };
}
