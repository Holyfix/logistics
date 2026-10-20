import { describe, expect, it } from 'vitest';
import { outlineAttributes, outlineSheetXml } from './xlsxOutline';

describe('seskupení řádků v Excelu', () => {
  it('úroveň, skrytí a sbalení řádku; řádek mimo skupinu beze změny', () => {
    expect(outlineAttributes({ r: 3 }, { level: 1, hidden: true })).toEqual({ r: 3, outlineLevel: 1, hidden: 1 });
    expect(outlineAttributes({ r: 2 }, { level: 0, collapsed: true })).toEqual({ r: 2, collapsed: 1 });
    expect(outlineAttributes({ r: 1 }, undefined)).toEqual({ r: 1 });
    expect(outlineAttributes({ r: 1 }, { level: 0 })).toEqual({ r: 1 });
  });

  it('list se skupinou: souhrnný řádek nad skupinou a nejvyšší úroveň; list bez skupiny beze změny', () => {
    const xml = '<worksheet a="1"><sheetViews/><cols/><sheetData/></worksheet>';
    expect(outlineSheetXml(xml, [undefined, { level: 0 }, { level: 2 }])).toBe(
      '<worksheet a="1"><sheetPr><outlinePr summaryBelow="0"/></sheetPr><sheetViews/><sheetFormatPr defaultRowHeight="15" outlineLevelRow="2"/><cols/><sheetData/></worksheet>',
    );
    expect(outlineSheetXml(xml, [{ level: 0 }])).toBe(xml);
    expect(outlineSheetXml(xml, undefined)).toBe(xml);
  });
});
