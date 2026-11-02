import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

/**
 * Zvýraznění řádku a sloupce kliknutím na buňku tabulky (jako kříž v Excelu). Druhý klik na stejnou buňku zvýraznění
 * zruší; klik na záhlaví zvýrazní jen sloupec. Tlačítka a odkazy v buňkách (rozbalení stromu…) fungují dál bez zvýraznění.
 * Řádek i buňky sloupce se označí atributem přímo na prvcích (aplikace nesmí vkládat styly, viz Content-Security-Policy);
 * sloupec se označí znovu po každém vykreslení, takže platí i pro nově zobrazené řádky (rozbalený strom, jiný filtr).
 * Zvýraznění je průhledná vrstva nad pozadím, takže barvy buněk (změna, záporné číslo, víkend) zůstanou vidět.
 */
export function useCrosshair(): { tableProps: { ref: RefObject<HTMLTableElement | null>; onClick: (e: MouseEvent<HTMLTableElement>) => void } } {
  const table = useRef<HTMLTableElement | null>(null);
  const row = useRef<HTMLTableRowElement | null>(null);
  const [column, setColumn] = useState<number | null>(null);

  useLayoutEffect(() => {
    const t = table.current;
    if (!t) return;
    t.querySelectorAll('[data-crosshair-col]').forEach((cell) => cell.removeAttribute('data-crosshair-col'));
    if (column === null) return;
    for (const tr of t.rows) tr.cells[column]?.setAttribute('data-crosshair-col', '');
  });

  const onClick = (e: MouseEvent<HTMLTableElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, label')) return;
    const cell = target.closest('td, th');
    if (!(cell instanceof HTMLTableCellElement) || !e.currentTarget.contains(cell)) return;
    const nextRow = cell.closest('thead') ? null : (cell.parentElement as HTMLTableRowElement);
    row.current?.removeAttribute('data-crosshair');
    if (row.current === nextRow && column === cell.cellIndex) {
      row.current = null;
      setColumn(null);
      return;
    }
    nextRow?.setAttribute('data-crosshair', '');
    row.current = nextRow;
    setColumn(cell.cellIndex);
  };

  return { tableProps: { ref: table, onClick } };
}
