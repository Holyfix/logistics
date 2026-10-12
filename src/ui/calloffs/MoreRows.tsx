import { useState } from 'react';
import { formatQuantity } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';

/** Kolik řádků se vykreslí najednou; velké tabulky (stovky dílů × desítky týdnů) jinak zdržují. */
export const ROW_STEP = 200;

export function useRowLimit() {
  return useState(ROW_STEP);
}

interface Props {
  shown: number;
  total: number;
  onLimit: (limit: number) => void;
}

/** Pod tabulkou: kolik dílů je vidět a tlačítka pro zobrazení dalších. */
export function MoreRows({ shown, total, onLimit }: Props) {
  const { t, locale } = useI18n();
  if (shown >= total) return null;
  return (
    <div className="more-rows">
      <span className="muted">
        {t.calloffs.table.shown} {formatQuantity(shown, locale)} {t.calloffs.table.shownOf} {formatQuantity(total, locale)} {t.calloffs.table.shownItems}
      </span>
      <button type="button" className="button button-small" onClick={() => onLimit(shown + ROW_STEP)}>
        {t.calloffs.table.showMore} {Math.min(ROW_STEP, total - shown)}
      </button>
      <button type="button" className="button button-small" onClick={() => onLimit(Infinity)}>
        {t.calloffs.table.showAll}
      </button>
    </div>
  );
}
