import { useMemo } from 'react';
import { mergeBoms } from '../../core/bom';
import { buildComponents, type ComponentTable } from '../../core/components/compute';
import { dayFromParts, type DayNumber } from '../../core/dates';
import { stockByItem } from '../../core/stock';
import { useData } from '../data/DataProvider';

/** Dnešní den podle místního času počítače. */
export function localToday(): DayNumber {
  const now = new Date();
  return dayFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())!;
}

/** Pokrytí komponent z načtených dat; null, když není načtený žádný kusovník. */
export function useComponents(today: DayNumber): ComponentTable | null {
  const { state } = useData();
  const data = state.data;
  return useMemo(() => {
    if (!data?.boms.length) return null;
    return buildComponents({
      bom: mergeBoms(data.boms.map((b) => b.data)),
      master: data.master?.data,
      coverage: data.coverage,
      callOffs: data.exports.at(-1),
      stock: data.stock ? stockByItem(data.stock.data) : undefined,
      today,
    });
  }, [data, today]);
}
