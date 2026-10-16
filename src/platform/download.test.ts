import { describe, expect, it } from 'vitest';
import { insertListValidations, listValidationsXml, safeFileName } from './download';

describe('download', () => {
  it('název souboru bez diakritiky', () => {
    expect(safeFileName('Odvolávky přehled.xlsx')).toBe('Odvolavky_prehled.xlsx');
  });

  it('výběr ze seznamu jako dataValidations listu', () => {
    expect(listValidationsXml([{ from: { row: 2, column: 2 }, to: { row: 30, column: 28 }, values: ['FG', 'SFG', 'PG'] }])).toBe(
      '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="B2:AB30"><formula1>&quot;FG,SFG,PG&quot;</formula1></dataValidation></dataValidations>',
    );
  });

  it('seznam se vloží za všechna podmíněná formátování a před okraje stránky', () => {
    const xml = '<worksheet><sheetData/><conditionalFormatting sqref="A1"/><conditionalFormatting sqref="B1"/><pageMargins left="0.7"/><pageSetup/></worksheet>';
    const out = insertListValidations(xml, [{ from: { row: 1, column: 1 }, to: { row: 2, column: 1 }, values: ['A'] }]);
    expect(out.replace(/<dataValidations.*<\/dataValidations>/, '<DV/>')).toBe('<worksheet><sheetData/><conditionalFormatting sqref="A1"/><conditionalFormatting sqref="B1"/><DV/><pageMargins left="0.7"/><pageSetup/></worksheet>');
    expect(insertListValidations('<worksheet><sheetData/></worksheet>', [{ from: { row: 1, column: 1 }, to: { row: 1, column: 1 }, values: ['A'] }])).toMatch(/<sheetData\/><dataValidations .*<\/worksheet>$/);
    expect(insertListValidations(xml, [])).toBe(xml);
  });
});
