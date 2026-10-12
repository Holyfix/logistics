import { describe, expect, it } from 'vitest';
import { decodeText } from './text';

describe('decodeText', () => {
  it('čte UTF-8 a odstraní BOM', () => {
    expect(decodeText(new TextEncoder().encode('\ufeffOdvolávky'))).toBe('Odvolávky');
  });

  it('pozná Windows-1250', () => {
    // „Zákazník“ ve Windows-1250
    expect(decodeText(new Uint8Array([0x5a, 0xe1, 0x6b, 0x61, 0x7a, 0x6e, 0xed, 0x6b]))).toBe('Zákazník');
  });
});
