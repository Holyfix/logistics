import { describe, expect, it } from 'vitest';
import { detectDelimiter, findColumn, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('čte export s BOM, uvozovkami a čárkou jako oddělovačem', () => {
    const text = '\ufeffItem Number,Discrete Qty,Date\r\n900100,"1 905,0",12.10.2026\r\nY1,"752,0",13.10.2026\r\n';
    expect(parseCsv(text)).toEqual({
      header: ['Item Number', 'Discrete Qty', 'Date'],
      rows: [
        ['900100', '1 905,0', '12.10.2026'],
        ['Y1', '752,0', '13.10.2026'],
      ],
    });
  });

  it('zvládne zdvojené uvozovky, oddělovač v uvozovkách a středník', () => {
    const t = parseCsv('a;b\n"x ""y""";"1;2"\n\n');
    expect(t.rows).toEqual([['x "y"', '1;2']]);
  });

  it('rozpozná oddělovač podle hlavičky', () => {
    expect(detectDelimiter('a;b;c\n1,0;2;3')).toBe(';');
    expect(detectDelimiter('a,b,"c;d"\n')).toBe(',');
  });
});

describe('toCsv', () => {
  it('zapíše BOM a uvozovky jen kde je potřeba', () => {
    expect(toCsv(['Díl', 'Popis'], [['1001', 'A;B'], ['1002', null]])).toBe('\ufeffDíl;Popis\r\n1001;"A;B"\r\n1002;\r\n');
  });
});

describe('findColumn', () => {
  it('najde sloupec bez ohledu na diakritiku a velikost písmen', () => {
    expect(findColumn(['Item Number', 'Zákazník'], ['zakaznik', 'customer'])).toBe(1);
    expect(findColumn(['A'], ['B'])).toBe(-1);
  });
});
