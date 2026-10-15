import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFiles, MAX_DEPTH, writeFile } from './folder';

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

/** Složka s jedním souborem, jehož zápis selže `failures`krát s chybou `error`. */
function writableDir(failures: number, error = 'NoModificationAllowedError') {
  let content = 'starý';
  let modified = 5;
  let left = failures;
  const file = {
    getFile: async () => new File([content], 'OIL.xlsx', { lastModified: modified }),
    createWritable: async () => {
      if (left-- > 0) throw new DOMException('An attempt was made to write to a file or directory which could not be modified', error);
      let next = '';
      return { write: async (b: Blob) => void (next = await b.text()), close: async () => void ((content = next), (modified = 9)), abort: async () => undefined };
    },
  };
  const dir = { getDirectoryHandle: async () => dir, getFileHandle: async () => file } as unknown as FileSystemDirectoryHandle;
  return { dir, content: () => content };
}

describe('writeFile', () => {
  afterEach(() => vi.useRealTimers());

  it('dočasně zamčený soubor (OneDrive) zkusí zapsat znovu', async () => {
    vi.useFakeTimers();
    const { dir, content } = writableDir(2);
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: 'saved', path: 'OIL/OIL.xlsx', lastModified: 9 });
    expect(content()).toBe('nový');
  });

  it('soubor otevřený v Excelu nebo jen pro čtení: po 3 pokusech vrátí locked a nic nezmění', async () => {
    vi.useFakeTimers();
    const { dir, content } = writableDir(5);
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: 'locked', path: 'OIL/OIL.xlsx' });
    expect(content()).toBe('starý');
  });

  it('jiná chyba se nepřekládá', async () => {
    const { dir } = writableDir(1, 'QuotaExceededError');
    await expect(writeFile(dir, 'OIL/OIL.xlsx', new Blob(['x']), 5)).rejects.toThrow();
  });

  it('soubor mezitím změnil někdo jiný: konflikt', async () => {
    const { dir } = writableDir(0);
    expect(await writeFile(dir, 'OIL/OIL.xlsx', new Blob(['x']), 3)).toEqual({ status: 'conflict', path: 'OIL/OIL.xlsx', lastModified: 5 });
  });
});
