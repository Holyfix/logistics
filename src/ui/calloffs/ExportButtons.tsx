import { useState } from 'react';
import { toCsv } from '../../core/csv';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadCsv, downloadXlsx } from '../../platform/download';

export interface ExportTable {
  fileName: string;
  sheetName: string;
  header: string[];
  rows: (string | number | null)[][];
}

/**
 * Stažení tabulky v Excelu nebo CSV. Tabulka se sestaví až po kliknutí. `excel` nahradí prostý sešit formátovaným
 * reportem (CSV zůstává jako tabulka).
 */
export function ExportButtons({ build, excel: report, excelTitle }: { build: () => ExportTable; excel?: () => Promise<void>; excelTitle?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const excel = async () => {
    setBusy(true);
    try {
      if (report) return await report();
      const table = build();
      await downloadXlsx(`${table.fileName}.xlsx`, table.sheetName, table.header, table.rows);
    } finally {
      setBusy(false);
    }
  };
  const csv = () => {
    const table = build();
    downloadCsv(`${table.fileName}.csv`, toCsv(table.header, table.rows));
  };

  return (
    <span className="actions-row">
      <button type="button" className="button button-small" onClick={() => void excel()} disabled={busy} title={excelTitle}>
        ⤓ {t.calloffs.export.excel}
      </button>
      <button type="button" className="button button-small" onClick={csv}>
        ⤓ {t.calloffs.export.csv}
      </button>
    </span>
  );
}
