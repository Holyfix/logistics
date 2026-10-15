import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFiles, MAX_DEPTH, versionedName, writeFile } from './folder';

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

/**
 * Složka se soubory podle názvu. Nahradit soubor `locked` nejde (zápis selže jako u OneDrivu nebo Excelu),
 * `failures` určuje, kolikrát selže zápis do souboru `OIL.xlsx`; nové soubory jdou zapsat, když není `noCreate`.
 */
function memoryDir({ failures = 0, error = 'NoModificationAllowedError', noCreate = false, noRemove = false, canMove = true } = {}) {
  const files = new Map<string, { content: string; modified: number }>([['OIL.xlsx', { content: 'starý', modified: 5 }]]);
  let left = failures;
  let clock = 10;
  const handle = (initial: string): FileSystemFileHandle => {
    let name = initial;
    const h = {
      getFile: async () => new File([files.get(name)!.content], name, { lastModified: files.get(name)!.modified }),
      createWritable: async () => {
        const fails = name === 'OIL.xlsx' ? left-- > 0 : noCreate;
        if (fails) throw new DOMException('An attempt was made to write to a file or directory which could not be modified', error);
        let next = '';
        return { write: async (b: Blob) => void (next = await b.text()), close: async () => void files.set(name, { content: next, modified: clock++ }), abort: async () => undefined };
      },
      ...(canMove && {
        move: async (to: string) => {
          files.set(to, files.get(name)!);
          files.delete(name);
          name = to;
        },
      }),
    };
    return h as unknown as FileSystemFileHandle;
  };
  const dir = {
    getDirectoryHandle: async () => dir,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('not found', 'NotFoundError');
        files.set(name, { content: '', modified: 0 });
      }
      return handle(name);
    },
    removeEntry: async (name: string) => {
      if (noRemove && name === 'OIL.xlsx') throw new DOMException('in use', 'NoModificationAllowedError');
      files.delete(name);
    },
  } as unknown as FileSystemDirectoryHandle;
  return { dir, files };
}

const NOW = () => new Date(2026, 9, 15, 8, 12, 30);

describe('writeFile', () => {
  afterEach(() => vi.useRealTimers());

  it('název s časem', () => {
    expect(versionedName('OIL.xlsx', NOW())).toBe('OIL_20261015-081230.xlsx');
    expect(versionedName('OIL_20261014-070000.xlsx', NOW())).toBe('OIL_20261015-081230.xlsx');
  });

  it('dočasně zamčený soubor (OneDrive) zkusí zapsat znovu', async () => {
    vi.useFakeTimers();
    const { dir, files } = memoryDir({ failures: 2 });
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5, false, NOW);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 'saved', path: 'OIL/OIL.xlsx' });
    expect(files.get('OIL.xlsx')!.content).toBe('nový');
  });

  it('původní soubor nejde nahradit: uloží nový soubor, původní smaže a nový přejmenuje zpět', async () => {
    vi.useFakeTimers();
    const { dir, files } = memoryDir({ failures: 9 });
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5, false, NOW);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 'saved', path: 'OIL/OIL.xlsx' });
    expect([...files.keys()]).toEqual(['OIL.xlsx']);
    expect(files.get('OIL.xlsx')!.content).toBe('nový');
  });

  it('původní soubor nejde smazat: platí nový soubor s časem v názvu', async () => {
    vi.useFakeTimers();
    const { dir, files } = memoryDir({ failures: 9, noRemove: true });
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5, false, NOW);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 'saved', path: 'OIL/OIL_20261015-081230.xlsx' });
    expect(files.get('OIL.xlsx')!.content).toBe('starý');
    expect(files.get('OIL_20261015-081230.xlsx')!.content).toBe('nový');
  });

  it('bez přejmenování (starší prohlížeč) zůstane nový soubor s časem v názvu', async () => {
    vi.useFakeTimers();
    const { dir, files } = memoryDir({ failures: 9, canMove: false });
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5, false, NOW);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 'saved', path: 'OIL/OIL_20261015-081230.xlsx' });
    expect([...files.keys()]).toEqual(['OIL_20261015-081230.xlsx']);
  });

  it('nejde zapsat ani nový soubor: locked, původní beze změny a bez prázdného souboru', async () => {
    vi.useFakeTimers();
    const { dir, files } = memoryDir({ failures: 9, noCreate: true });
    const result = writeFile(dir, 'OIL/OIL.xlsx', new Blob(['nový']), 5, false, NOW);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: 'locked', path: 'OIL/OIL.xlsx' });
    expect([...files.keys()]).toEqual(['OIL.xlsx']);
    expect(files.get('OIL.xlsx')!.content).toBe('starý');
  });

  it('jiná chyba se nepřekládá', async () => {
    const { dir } = memoryDir({ failures: 1, error: 'QuotaExceededError' });
    await expect(writeFile(dir, 'OIL/OIL.xlsx', new Blob(['x']), 5)).rejects.toThrow();
  });

  it('soubor mezitím změnil někdo jiný: konflikt', async () => {
    const { dir } = memoryDir();
    expect(await writeFile(dir, 'OIL/OIL.xlsx', new Blob(['x']), 3)).toEqual({ status: 'conflict', path: 'OIL/OIL.xlsx', lastModified: 5 });
  });
});
