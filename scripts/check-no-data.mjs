// Kontrola, že ve veřejném repozitáři nejsou datové soubory (exporty z ERP apod.).
// Smyšlená testovací data jsou povolená jen ve složce sample-data/.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DATA_EXTENSIONS = ['.csv', '.tsv', '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.edi'];
export const ALLOWED_DIR = 'sample-data/';

/** Vrátí cesty k datovým souborům, které leží mimo povolenou složku. */
export function findForbiddenFiles(paths) {
  return paths.filter((path) => {
    const lower = path.toLowerCase();
    return DATA_EXTENSIONS.some((ext) => lower.endsWith(ext)) && !path.startsWith(ALLOWED_DIR);
  });
}

function trackedFiles() {
  // Sledované soubory i nové soubory, které ještě nejsou v .gitignore.
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf-8',
  });
  return out.split('\0').filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const forbidden = findForbiddenFiles(trackedFiles());
  if (forbidden.length > 0) {
    console.error('Datové soubory mimo sample-data/ nesmí být v repozitáři:');
    for (const path of forbidden) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log('Kontrola datových souborů: OK');
}
