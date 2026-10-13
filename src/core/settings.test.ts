import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseSettings } from './settings';

describe('parseSettings', () => {
  it('načte vyloučené lokace a zóny skladu; záhlaví a neznámé klíče přeskočí', () => {
    const s = parseSettings(parseCsv('Setting;Value\nStock excluded locations;EXT-01, ext-02\nSklad vyloučené lokace;EXT-03;EXT-01\nStock zones;sale,purch\nNeco jineho;1'));
    expect(s).toEqual({ stockZones: ['SALE', 'PURCH'], stockExcludedLocations: ['EXT-01', 'EXT-02', 'EXT-03'], unknown: ['Neco jineho'] });
  });

  it('soubor bez záhlaví a bez zón: zóny zůstanou výchozí', () => {
    expect(parseSettings(parseCsv('Stock excluded locations;EXT-01'))).toEqual({ stockZones: null, stockExcludedLocations: ['EXT-01'], unknown: [] });
  });
});
