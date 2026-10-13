import { describe, expect, it } from 'vitest';
import { listFiles, MAX_DEPTH } from './folder';

type Tree = { [name: string]: Tree | string };

/** Napodobenina složky z File System Access API. */
function fakeDir(tree: Tree): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    async *values() {
      for (const [name, value] of Object.entries(tree)) {
        if (typeof value === 'string') {
          yield { kind: 'file', name, getFile: async () => new File([value], name, { lastModified: 1 }) };
        } else {
          yield { ...fakeDir(value), name };
        }
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('listFiles', () => {
  it('najde soubory coverage ve 4. úrovni (Coverage/<destinace>/<projekt>/soubor)', async () => {
    const handle = fakeDir({
      'Item_Mapping.xlsx': 'm',
      Coverage: { 'Lokalita A': { P100: { 'report.xlsx': 'r' } } },
      Hluboko: { a: { b: { c: { d: { e: { 'moc.csv': 'x' } } } } } },
    });
    const paths = (await listFiles({ kind: 'handle', name: 'Logistics', handle })).map((f) => f.path).sort();
    expect(paths).toEqual(['Coverage/Lokalita A/P100/report.xlsx', 'Item_Mapping.xlsx']);
    expect(MAX_DEPTH).toBe(6);
  });
});
