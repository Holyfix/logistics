// Tvary písmen SQCDP pro kalendář: 9 řádků × 7 sloupců, „#“ = políčko dne (31 políček, čísluje se po řádcích).

import type { Letter } from '../../core/kpi';

export const LETTER_SHAPES: Record<Letter, readonly string[]> = {
  S: ['.######', '##....#', '##.....', '##.....', '.#####.', '.....##', '.....##', '#....##', '######.'],
  Q: ['.#####.', '##...##', '#.....#', '#.....#', '#.....#', '#...#.#', '##..###', '.######', '.....##'],
  C: ['.######', '##..###', '##.....', '##.....', '##.....', '##.....', '##....#', '##....#', '.######'],
  D: ['#####..', '##...#.', '##....#', '##....#', '##....#', '##....#', '##....#', '##...#.', '#####..'],
  P: ['#######', '##....#', '##....#', '##....#', '#######', '##.....', '##.....', '##.....', '##.....'],
};

/** Políčko tvaru: řádek, sloupec a zaoblení rohů (vnější rohy písmene). */
export interface ShapeCell {
  row: number;
  col: number;
  /** Zaoblené rohy: levý horní, pravý horní, pravý dolní, levý dolní. */
  round: [boolean, boolean, boolean, boolean];
}

/** Políčka písmene v pořadí dnů (po řádcích zleva doprava). */
export function shapeCells(letter: Letter): ShapeCell[] {
  const rows = LETTER_SHAPES[letter];
  const has = (r: number, c: number) => rows[r]?.[c] === '#';
  const cells: ShapeCell[] = [];
  rows.forEach((line, row) =>
    [...line].forEach((ch, col) => {
      if (ch !== '#') return;
      cells.push({
        row,
        col,
        round: [!has(row - 1, col) && !has(row, col - 1), !has(row - 1, col) && !has(row, col + 1), !has(row + 1, col) && !has(row, col + 1), !has(row + 1, col) && !has(row, col - 1)],
      });
    }),
  );
  return cells;
}
