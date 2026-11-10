import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha512 } from './sha512';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('sha512', () => {
  it('odpovídá standardu pro různé délky (přes hranici bloku)', () => {
    expect(hex(sha512(new TextEncoder().encode('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    for (const n of [0, 1, 68, 111, 112, 127, 128, 129, 300]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
      expect(hex(sha512(data)), String(n)).toBe(createHash('sha512').update(data).digest('hex'));
    }
  });
});
