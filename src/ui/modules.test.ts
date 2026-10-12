import { describe, expect, it } from 'vitest';
import { cs } from '../i18n/cs';
import { en } from '../i18n/en';
import { GROUPS, MODULES } from './modules';

describe('katalog modulů', () => {
  it('má jedinečná id a každý modul patří do existující skupiny', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODULES) expect(GROUPS).toContain(m.group);
  });

  it('každá skupina má aspoň jeden modul', () => {
    for (const g of GROUPS) expect(MODULES.some((m) => m.group === g), g).toBe(true);
  });

  it('každý modul má texty v obou jazycích', () => {
    for (const m of MODULES) {
      for (const dict of [cs, en]) {
        const text = dict.modules[m.id];
        expect(text.title.length, m.id).toBeGreaterThan(0);
        expect(text.features.length, m.id).toBeGreaterThan(0);
      }
    }
  });
});
