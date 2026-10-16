// Sloupce s údaji z mapování v tabulkách odvolávek: Projekt, Kategorie, Strana, Varianta.

import { ITEM_FIELDS } from '../../core/calloffs/filter';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';

/** Hodnoty pro export (prázdné, když díl údaj nemá). */
export function itemFieldValues(m: MasterItem | undefined): string[] {
  return ITEM_FIELDS.map((field) => m?.[field] ?? '');
}

/** Záhlaví sloupců pro export. */
export function useItemFieldLabels(): string[] {
  const { t } = useI18n();
  return ITEM_FIELDS.map((field) => t.calloffs.table[field]);
}

export function ItemFieldHeaders() {
  const labels = useItemFieldLabels();
  return (
    <>
      {labels.map((label) => (
        <th key={label}>{label}</th>
      ))}
    </>
  );
}

/** Projekt a kategorie jako text, strana a varianta jako štítek; chybějící údaj pomlčkou. */
export function ItemFieldCells({ m }: { m: MasterItem | undefined }) {
  return (
    <>
      {ITEM_FIELDS.map((field) => {
        const value = m?.[field];
        return <td key={field}>{!value ? <span className="muted">—</span> : field === 'side' || field === 'variant' ? <span className="chip">{value}</span> : value}</td>;
      })}
    </>
  );
}
