import { describe, expect, it } from 'vitest';
import { dayFromParts } from '../dates';
import type { CoverageLine } from './compute';
import { coverageReport, type CoverageReportTexts } from './report';

const day = (n: number) => dayFromParts(2026, 10, n)!;
const texts = {
  title: 'Coverage',
  subtitle: 'Export',
  filters: 'Filtry: žádné',
  note: 'Pozn.',
  weekdays: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'],
  item: 'Díl',
  customerNumber: 'Číslo zákazníka',
  description: 'Popis',
  location: 'Destinace',
  project: 'Projekt',
  category: 'Kategorie',
  side: 'Strana',
  variant: 'Varianta',
  customerStock: 'Sklad zákazníka',
  transit: 'Transit',
  ourStock: 'Náš sklad',
  firstUncovered: 'První nepokryté',
  sheetLines: 'Coverage',
  sheetSides: 'Strany',
  sideNone: 'Bez strany',
} satisfies CoverageReportTexts;

const line = {
  id: '1',
  location: 'L',
  project: 'P1',
  item: 'FG-1',
  customerNumber: 'C1',
  fileCustomerNumber: 'C1',
  description: 'PANEL',
  variant: '',
  side: 'LHD',
  category: 'DP',
  customerStock: 20,
  transit: 5,
  extraTransit: 0,
  ourStock: null,
  firstUncovered: '',
  uncoveredAt: '',
  values: [10, -5, null],
} as CoverageLine;

describe('coverageReport', () => {
  // pá 16. 10., so 17. 10., ne 18. 10.
  const days = [day(16), day(17), day(18)];
  const [sheet, sides] = coverageReport([line], [{ side: 'LHD', values: [10, -5, 0] }], days, texts, { ourStock: false });

  it('záhlaví se zkratkou a datem dne, ukotvené záhlaví a díl', () => {
    const header = sheet!.data[4]!;
    expect(header.slice(-3).map((c) => c?.value)).toEqual(['Pá', 'So', 'Ne']);
    expect(sheet!.data[5]!.slice(-3).map((c) => c?.value)).toEqual(['16.10.', '17.10.', '18.10.']);
    expect(sheet).toMatchObject({ name: 'Coverage', stickyRows: 6, stickyColumns: 3 });
  });

  it('záporné pokrytí červeně, víkend šedě, den mimo horizont prázdný', () => {
    const row = sheet!.data[6]!;
    const [fri, sat, sun] = row.slice(-3);
    expect(fri).toMatchObject({ value: 10, type: Number });
    expect(fri!.backgroundColor).toBeUndefined();
    expect(sat).toMatchObject({ value: -5, textColor: '#B42D2D', backgroundColor: '#FDECEC' });
    expect(sun).toMatchObject({ value: '', backgroundColor: '#ECEFF3' });
    expect(row[0]).toMatchObject({ value: 'FG-1', fontWeight: 'bold' });
  });

  it('list se souhrnem po stranách', () => {
    expect(sides!.name).toBe('Strany');
    expect(sides!.data[6]!.map((c) => c?.value)).toEqual(['LHD', 10, -5, 0]);
  });
});
