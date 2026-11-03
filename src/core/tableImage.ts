// Tabulka pro obrázek (kopírovat jako obrázek): popis sloupců a buněk; vykreslí ji platform/tableImage.

export interface ImageCell {
  text: string;
  color?: string;
  background?: string;
  bold?: boolean;
}

export interface ImageColumn {
  label: string;
  /** Druhý řádek záhlaví (např. datum dne). */
  sub?: string;
  /** Šířka sloupce; s `fit` nejvyšší šířka (sloupec se zúží na obsah, delší text se zkrátí). */
  width: number;
  /** Šířka podle obsahu (záhlaví i buněk), nejvýš `width`. */
  fit?: boolean;
  align: 'left' | 'right' | 'center';
  headerBackground?: string;
  subBackground?: string;
  /** Barva rámečku sloupce zleva i zprava (např. hranice pokrytí). */
  edge?: string;
}

export interface ImageTable {
  title: string;
  subtitle: string;
  columns: ImageColumn[];
  rows: ImageCell[][];
  note?: string;
}
