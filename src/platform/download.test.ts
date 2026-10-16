import { describe, expect, it } from 'vitest';
import { safeFileName } from './download';

describe('download', () => {
  it('název souboru bez diakritiky', () => {
    expect(safeFileName('Odvolávky přehled.xlsx')).toBe('Odvolavky_prehled.xlsx');
  });
});
