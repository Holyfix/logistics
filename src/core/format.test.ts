import { describe, expect, it } from 'vitest';
import { formatDate, formatQuantity } from './format';

describe('formatQuantity', () => {
  it('odděluje tisíce podle jazyka', () => {
    expect(formatQuantity(152300, 'cs')).toMatch(/^152\s300$/u);
    expect(formatQuantity(152300, 'en')).toBe('152,300');
  });

  it('zaokrouhluje na celé kusy', () => {
    expect(formatQuantity(419.6, 'en')).toBe('420');
  });
});

describe('formatDate', () => {
  it('formátuje kalendářní datum bez posunu o den', () => {
    expect(formatDate('2026-10-12', 'cs')).toMatch(/^12\.\s?10\.\s?2026$/u);
    expect(formatDate('2026-10-12', 'en')).toBe('12/10/2026');
  });

  it('odmítne neplatné datum', () => {
    expect(() => formatDate('12.10.2026', 'cs')).toThrow(/Neplatné datum/);
    expect(() => formatDate('2026-02-30', 'cs')).toThrow(/Neplatné datum/);
  });
});
