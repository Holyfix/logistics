import { describe, expect, it } from 'vitest';
import { findForbiddenFiles } from './check-no-data.mjs';

describe('findForbiddenFiles', () => {
  it('odmítne datové soubory mimo sample-data/', () => {
    expect(
      findForbiddenFiles([
        'exporty/odvolavky.csv',
        'docs/zasoby.XLSX',
        'src/core/format.ts',
        'sample-data/odvolavky_smyslene.csv',
      ]),
    ).toEqual(['exporty/odvolavky.csv', 'docs/zasoby.XLSX']);
  });

  it('povolí repozitář bez datových souborů', () => {
    expect(findForbiddenFiles(['README.md', 'package.json'])).toEqual([]);
  });
});
