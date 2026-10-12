import { describe, expect, it } from 'vitest';
import { parseNumber } from './numbers';

describe('parseNumber', () => {
  it.each([
    ['1 905,0', 1905],
    ['137 898,0', 137898],
    ['752,0', 752],
    ['1.905,5', 1905.5],
    ['1,905.5', 1905.5],
    ['42', 42],
    ['-3', -3],
  ])('%s → %d', (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });

  it('vrátí null pro prázdnou nebo neplatnou hodnotu', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1,2,3x')).toBeNull();
  });
});
