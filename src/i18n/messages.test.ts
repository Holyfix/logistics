import { describe, expect, it } from 'vitest';
import { cs } from './cs';
import { en } from './en';

function leaves(value: unknown, path = ''): [string, unknown][] {
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [[path, value]];
}

describe('překlady', () => {
  it('čeština a angličtina mají stejné klíče', () => {
    expect(leaves(en).map(([key]) => key)).toEqual(leaves(cs).map(([key]) => key));
  });

  it('žádný text není prázdný', () => {
    for (const [key, text] of [...leaves(cs), ...leaves(en)]) {
      expect(typeof text === 'string' && text.trim().length > 0, key).toBe(true);
    }
  });
});
