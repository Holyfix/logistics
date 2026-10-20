// Seskupení řádků v Excelu (tlačítka −/+ vlevo a 1 2 3 nahoře): doplněk knihovny write-excel-file, který řádkům listu
// nastaví úroveň (outlineLevel), skrytí sbalených řádků a značku sbalení. Souhrnný řádek je nad skupinou (projekt nad
// svými kategoriemi), ne pod ní, jak je v Excelu výchozí.

import type { RowOutline } from '../core/calloffs/summaryReport';

type Attributes = Record<string, string | number>;

/** Atributy řádku `<row>` podle seskupení (beze změny, když řádek ve skupině není). */
export function outlineAttributes(attributes: Attributes, outline: RowOutline | undefined): Attributes {
  if (!outline || (!outline.level && !outline.hidden && !outline.collapsed)) return attributes;
  return {
    ...attributes,
    ...(outline.level ? { outlineLevel: outline.level } : {}),
    ...(outline.hidden ? { hidden: 1 } : {}),
    ...(outline.collapsed ? { collapsed: 1 } : {}),
  };
}

/**
 * Do listu se seskupením doplní `<sheetPr><outlinePr summaryBelow="0"/></sheetPr>` (první prvek listu) a nejvyšší
 * úroveň `<sheetFormatPr outlineLevelRow>` (před sloupci a daty), aby Excel ukázal tlačítka 1 2 3.
 */
export function outlineSheetXml(xml: string, outline: readonly (RowOutline | undefined)[] | undefined): string {
  const levels = Math.max(0, ...(outline ?? []).map((o) => o?.level ?? 0));
  if (!levels || xml.includes('<sheetPr') || xml.includes('<sheetFormatPr')) return xml;
  const format = `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${levels}"/>`;
  const withFormat = xml.includes('<cols') ? xml.replace('<cols', `${format}<cols`) : xml.replace('<sheetData', `${format}<sheetData`);
  return withFormat.replace(/(<worksheet\b[^>]*>)/, '$1<sheetPr><outlinePr summaryBelow="0"/></sheetPr>');
}

/** Doplněk knihovny write-excel-file: seskupení řádků po listech (index listu → řádky). */
export function outlineFeature(outlines: readonly ((RowOutline | undefined)[] | undefined)[]) {
  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform: (xml: string, _options: unknown, { sheetIndex }: { sheetIndex: number }) => outlineSheetXml(xml, outlines[sheetIndex]),
          transformElementAttributes: (tagName: string, attributes: Attributes, index: number | undefined, _options: unknown, { sheetIndex }: { sheetIndex: number }) =>
            tagName === 'row' && index !== undefined ? outlineAttributes(attributes, outlines[sheetIndex]?.[index]) : attributes,
        },
      },
    },
  };
}
