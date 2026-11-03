import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import type { CoverageLine } from './compute';
import { coverageLinesImage, coverageSidesImage, IMAGE_MAX_ROWS, type CoverageImageTexts } from './image';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const texts: CoverageImageTexts = {
  title: 'Coverage',
  subtitle: 'Export',
  note: 'Pozn.',
  weekdays: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'],
  item: 'Díl',
  description: 'Popis',
  project: 'Projekt',
  side: 'Strana',
  sideNone: 'Bez strany',
};
const line = (item: string) => ({ item, customerNumber: 'C1', description: 'PANEL', project: 'P1', side: 'LHD', values: [10, -5, null] }) as CoverageLine;
// pá 16. 10., so 17. 10., ne 18. 10.
const days = [day(16), day(17), day(18)];
const format = (v: number) => String(v);

describe('coverage jako obrázek', () => {
  it('sloupce dnů se zkratkou a datem, hranice 2 dny zeleně, záporné červeně, víkend šedě', () => {
    const image = coverageLinesImage([line('FG-1')], days, texts, format, day(16), (n) => `+${n}`);
    expect(image.columns.slice(4).map((c) => [c.label, c.sub, c.edge])).toEqual([
      ['Pá', '16.10.', '#2E8B3E'],
      ['So', '17.10.', undefined],
      ['Ne', '18.10.', undefined],
    ]);
    expect(image.rows[0]!.slice(0, 4).map((c) => c.text)).toEqual(['FG-1', 'PANEL', 'P1', 'LHD']);
    const [fri, sat, sun] = image.rows[0]!.slice(4);
    expect(fri).toEqual({ text: '10' });
    expect(sat).toMatchObject({ text: '-5', color: '#B42D2D', background: '#FDECEC', bold: true });
    expect(sun).toEqual({ text: '', background: '#ECEFF3' });
    expect(image.note).toBe('Pozn.');
  });

  it('nejvýš IMAGE_MAX_ROWS dílů, zbytek v poznámce; souhrn po stranách', () => {
    const many = Array.from({ length: IMAGE_MAX_ROWS + 2 }, (_, i) => line(`FG-${i}`));
    const image = coverageLinesImage(many, days, texts, format, null, (n) => `a dalších ${n}`);
    expect(image.rows).toHaveLength(IMAGE_MAX_ROWS);
    expect(image.note).toBe('a dalších 2 · Pozn.');
    const sides = coverageSidesImage([{ side: '', values: [1, 2, 3] }], days, texts, format, null);
    expect(sides.rows[0]![0]).toMatchObject({ text: 'Bez strany' });
  });
});
