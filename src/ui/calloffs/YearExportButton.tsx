import { useState } from 'react';
import type { ItemFilter } from '../../core/calloffs/filter';
import type { CallOffExport } from '../../core/calloffs/parse';
import { buildYearReport } from '../../core/calloffs/yearReport';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsxSheets } from '../../platform/download';

interface Props {
  exports: readonly CallOffExport[];
  master: ReadonlyMap<string, MasterItem> | undefined;
  filter: ItemFilter;
}

/** Sešit od začátku roku pro reporting; počítá se až po kliknutí. */
export function YearExportButton({ exports, master, filter }: Props) {
  const { t } = useI18n();
  const ty = t.calloffs.yearExport;
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const report = buildYearReport(exports, master, filter, {
        ...ty,
        total: t.calloffs.table.total,
        item: t.calloffs.table.item,
        description: t.calloffs.table.description,
        project: t.calloffs.table.project,
        category: t.calloffs.table.category,
        side: t.calloffs.table.side,
        variant: t.calloffs.table.variant,
      });
      if (report) await downloadXlsxSheets(`${ty.fileName}_${report.year}_CW${report.latest.week}.xlsx`, report.sheets);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="button button-small" onClick={() => void download()} disabled={busy} title={ty.title}>
      ⤓ {ty.button}
    </button>
  );
}
