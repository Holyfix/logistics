// Coverage jako obrázek (kopírovat do e-mailu nebo chatu): díly nebo souhrn po stranách se dny, záporné pokrytí
// červeně, víkendy šedě, den dnes + 1 (hranice pokrytí 2 dny) zeleně – stejné barvy jako Excel z Coverage.

import type { ImageCell, ImageColumn, ImageTable } from '../tableImage';
import { dayToIso, weekday, type DayNumber } from '../dates';
import type { CoverageLine } from './compute';

export interface CoverageImageTexts {
  title: string;
  subtitle: string;
  note: string;
  weekdays: readonly string[];
  item: string;
  description: string;
  project: string;
  side: string;
  sideNone: string;
}

const C = { weekendHead: '#4F7BAA', weekendSub: '#C9D6E4', weekend: '#ECEFF3', negative: '#FDECEC', down: '#B42D2D', boundary: '#2E8B3E', boundarySub: '#DDF0DF', muted: '#6F7E8B' };

/** Nejvíc řádků v obrázku; zbytek se uvede v poznámce (obrázek by byl nečitelný). */
export const IMAGE_MAX_ROWS = 300;

function dayColumns(days: readonly DayNumber[], boundary: DayNumber | null, texts: CoverageImageTexts): ImageColumn[] {
  return days.map((d) => {
    const weekend = weekday(d) >= 6;
    const [, m, day] = dayToIso(d).split('-');
    return {
      label: texts.weekdays[weekday(d) - 1] ?? '',
      sub: `${Number(day)}.${Number(m)}.`,
      width: 50,
      align: 'right' as const,
      ...(weekend ? { headerBackground: C.weekendHead, subBackground: C.weekendSub } : {}),
      ...(d === boundary ? { headerBackground: C.boundary, subBackground: C.boundarySub, edge: C.boundary } : {}),
    };
  });
}

function valueCells(values: readonly (number | null)[], days: readonly DayNumber[], format: (v: number) => string): ImageCell[] {
  return values.map((v, k) => {
    const weekend = weekday(days[k]!) >= 6 ? { background: C.weekend } : {};
    if (v === null) return { text: '', ...weekend };
    if (v < 0) return { text: format(v), color: C.down, background: C.negative, bold: true };
    return { text: format(v), ...weekend };
  });
}

/** Díly: číslo, popis, projekt, strana a pokrytí po dnech (nejvýš IMAGE_MAX_ROWS řádků). */
export function coverageLinesImage(
  lines: readonly CoverageLine[],
  days: readonly DayNumber[],
  texts: CoverageImageTexts,
  format: (v: number) => string,
  boundary: DayNumber | null,
  more: (n: number) => string,
): ImageTable {
  const shown = lines.slice(0, IMAGE_MAX_ROWS);
  return {
    title: texts.title,
    subtitle: texts.subtitle,
    columns: [
      // Šířka podle obsahu: číslo dílu celé, popis jen tak široký, jak je potřeba.
      { label: texts.item, width: 240, fit: true, align: 'left' },
      { label: texts.description, width: 260, fit: true, align: 'left' },
      { label: texts.project, width: 120, fit: true, align: 'left' },
      { label: texts.side, width: 80, fit: true, align: 'left' },
      ...dayColumns(days, boundary, texts),
    ],
    rows: shown.map((l) => [
      { text: l.item || l.customerNumber, bold: true, ...(l.item ? {} : { color: C.muted }) },
      { text: l.description },
      { text: l.project },
      { text: l.side },
      ...valueCells(l.values, days, format),
    ]),
    note: [lines.length > shown.length ? more(lines.length - shown.length) : '', texts.note].filter(Boolean).join(' · '),
  };
}

/** Souhrn po stranách. */
export function coverageSidesImage(
  sides: readonly { side: string; values: (number | null)[] }[],
  days: readonly DayNumber[],
  texts: CoverageImageTexts,
  format: (v: number) => string,
  boundary: DayNumber | null,
): ImageTable {
  return {
    title: texts.title,
    subtitle: texts.subtitle,
    columns: [{ label: texts.side, width: 160, fit: true, align: 'left' }, ...dayColumns(days, boundary, texts)],
    rows: sides.map((s) => [
      { text: s.side || texts.sideNone, bold: true, ...(s.side ? {} : { color: C.muted }) },
      ...valueCells(s.values, days, format),
    ]),
    note: texts.note,
  };
}
