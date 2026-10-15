import { describe, expect, it } from 'vitest';
import { newerOil } from './loader';

/** Kořen se složkou OIL a soubory podle názvu a času změny. */
function rootWith(files: Record<string, number>): FileSystemDirectoryHandle {
  const oil = {
    kind: 'directory',
    async *values() {
      for (const [name, modified] of Object.entries(files)) yield { kind: 'file', name, getFile: async () => new File(['x'], name, { lastModified: modified }) };
    },
  };
  return { getDirectoryHandle: async (name: string) => (name === 'OIL' ? oil : Promise.reject(new DOMException('x', 'NotFoundError'))) } as unknown as FileSystemDirectoryHandle;
}

const parse = async (path: string) => ({ items: [{ id: path.length } as never] });

describe('newerOil', () => {
  it('nejnovější soubor OIL ve složce, jen když je novější než načtený', async () => {
    const root = rootWith({ 'OIL.xlsx': 5, 'OIL_20261015-081230.xlsx': 9, 'poznamky.csv': 99 });
    expect(await newerOil(root, { path: 'OIL/OIL.xlsx', lastModified: 5, list: { items: [] } }, parse)).toMatchObject({ path: 'OIL/OIL_20261015-081230.xlsx', lastModified: 9 });
    expect(await newerOil(root, { path: 'OIL/OIL_20261015-081230.xlsx', lastModified: 9, list: { items: [] } }, parse)).toBeNull();
    // Bez načteného OIL se vezme složka OIL v kořeni.
    expect(await newerOil(root, null, parse)).toMatchObject({ lastModified: 9 });
  });

  it('bez složky OIL nic', async () => {
    expect(await newerOil({ getDirectoryHandle: async () => Promise.reject(new Error()) } as unknown as FileSystemDirectoryHandle, null, parse)).toBeNull();
  });
});
