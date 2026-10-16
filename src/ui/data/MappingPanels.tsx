import { useMemo, type ReactNode } from 'react';
import { formatQuantity } from '../../core/format';
import { checkCount, checkMapping, type MappingCheck } from '../../core/mappingCheck';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsxSheets } from '../../platform/download';
import { useData } from './DataProvider';

/** Kolik řádků každé části kontroly ukázat na stránce (všechny jsou v Excelu). */
const SHOWN_ROWS = 50;

/** Kontrola mapování z načtených dat; null, když mapování není načtené. */
export function useMappingCheck(): MappingCheck | null {
  const { state } = useData();
  const data = state.data;
  return useMemo(() => (data?.master ? checkMapping(data.master.data, data.coverage, data.exports.at(-1)) : null), [data]);
}

function Section({ title, count, note, header, rows }: { title: string; count: number; note: string; header: string[]; rows: ReactNode[][] }) {
  const { t, locale } = useI18n();
  if (count === 0) return null;
  return (
    <details className="check-section">
      <summary>
        {title} <span className="check-count">{formatQuantity(count, locale)}</span>
      </summary>
      <p className="muted">{note}</p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {header.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN_ROWS).map((cells, k) => (
              <tr key={k}>
                {cells.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN_ROWS && <p className="muted">{t.data.check.more.replace('{n}', formatQuantity(rows.length - SHOWN_ROWS, locale))}</p>}
    </details>
  );
}

/** Kontrola mapování: díly bez mapování, s nevyplněnými údaji a s jiným projektem, než je složka Coverage. */
export function MappingCheckPanel() {
  const { t } = useI18n();
  const tc = t.data.check;
  const check = useMappingCheck();

  const tables = (c: MappingCheck) => ({
    missing: {
      header: [tc.item, tc.customerNumber, tc.description, tc.folderProject, tc.sources],
      rows: c.missing.map((p) => [p.item, p.customerNumber, p.description, p.project, p.sources.map((s) => tc.sourceNames[s]).join(', ')]),
    },
    incomplete: {
      header: [tc.item, tc.description, tc.project, tc.fields],
      rows: c.incomplete.map((p) => [p.item, p.description, p.project, p.missing.map((f) => tc.fieldNames[f]).join(', ')]),
    },
    mismatch: {
      header: [tc.item, tc.description, tc.mapping, tc.folders],
      rows: c.mismatch.map((p) => [p.item, p.description, p.mapping, p.folders.join(', ')]),
    },
  });

  const download = (c: MappingCheck) => {
    const x = tables(c);
    void downloadXlsxSheets(`${tc.fileName}.xlsx`, [
      { name: tc.missing, header: x.missing.header, rows: x.missing.rows },
      { name: tc.incomplete, header: x.incomplete.header, rows: x.incomplete.rows },
      { name: tc.mismatch, header: x.mismatch.header, rows: x.mismatch.rows },
    ]);
  };

  return (
    <div className="panel">
      <h2>{tc.heading}</h2>
      <p className="muted">{tc.lead}</p>
      {check === null ? (
        <p>{tc.noMaster}</p>
      ) : (
        <>
          {check.missingColumns.length > 0 && (
            <p className="banner-inline">
              {tc.columns}: <strong>{check.missingColumns.map((f) => tc.fieldNames[f]).join(', ')}</strong>
            </p>
          )}
          {checkCount(check) === 0 ? (
            <p>{tc.ok}</p>
          ) : (
            <>
              {(() => {
                const x = tables(check);
                return (
                  <>
                    <Section title={tc.missing} count={check.missing.length} note={tc.missingNote} {...x.missing} />
                    <Section title={tc.incomplete} count={check.incomplete.length} note={tc.incompleteNote} {...x.incomplete} />
                    <Section title={tc.mismatch} count={check.mismatch.length} note={tc.mismatchNote} {...x.mismatch} />
                  </>
                );
              })()}
              <div className="actions-row">
                <button type="button" className="button" onClick={() => download(check)}>
                  ⤓ {tc.download}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Mapa dat: odkud aplikace bere soubory a jednotlivé údaje o dílu. */
export function DataMapPanel() {
  const { t } = useI18n();
  const tm = t.data.map;
  const table = (header: string[], rows: readonly (readonly string[])[]) => (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {header.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, k) => (
                <td key={k} className="wrap">
                  {k === 0 ? <strong>{c}</strong> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="panel">
      <h2>{tm.heading}</h2>
      <p className="muted">{tm.lead}</p>
      <h3>{tm.filesHeading}</h3>
      {table([tm.file, tm.takes, tm.key], tm.files)}
      <h3>{tm.fieldsHeading}</h3>
      {table([tm.field, tm.source, tm.fallback, tm.usage], tm.fields)}
    </div>
  );
}
