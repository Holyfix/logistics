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
  return useMemo(
    () =>
      data?.master
        ? checkMapping(data.master.data, { coverage: data.coverage, callOffs: data.exports.at(-1), bomParents: data.boms.flatMap((b) => [...b.data.parents.keys()]) })
        : null,
    [data],
  );
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

/** Kontrola mapování: díly bez mapování a díly s nevyplněnými údaji (aplikace je nedoplňuje odjinud). */
export function MappingCheckPanel() {
  const { t } = useI18n();
  const tc = t.data.check;
  const check = useMappingCheck();

  const tables = (c: MappingCheck) => ({
    missing: {
      header: [tc.item, tc.customerNumber, tc.description, tc.folder, tc.sources],
      rows: c.missing.map((p) => [p.item, p.customerNumber, p.description, p.folder, p.sources.map((s) => tc.sourceNames[s]).join(', ')]),
    },
    incomplete: {
      header: [tc.item, tc.description, tc.project, tc.fields],
      rows: c.incomplete.map((p) => [p.item, p.description, p.project, p.missing.map((f) => tc.fieldNames[f]).join(', ')]),
    },
  });

  const download = (c: MappingCheck) => {
    const x = tables(c);
    void downloadXlsxSheets(`${tc.fileName}.xlsx`, [
      { name: tc.missing, header: x.missing.header, rows: x.missing.rows },
      { name: tc.incomplete, header: x.incomplete.header, rows: x.incomplete.rows },
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

/** Upozornění v modulu: v mapování chybí údaje u dílů (aplikace je nedoplňuje odjinud); odkaz na Kontrolu mapování. */
export function MappingNotice() {
  const { t, locale } = useI18n();
  const { state } = useData();
  const check = useMappingCheck();
  if (!state.data) return null;
  const n = check ? checkCount(check) : 0;
  const columns = check?.missingColumns.length ?? 0;
  if (check && n === 0 && columns === 0) return null;
  const tc = t.data.check;
  return (
    <p className="banner-inline mapping-notice" role="status">
      {check === null
        ? tc.noMaster
        : n > 0
          ? tc.notice.replace('{n}', formatQuantity(n, locale))
          : `${tc.columns}: ${check.missingColumns.map((f) => tc.fieldNames[f]).join(', ')}.`}{' '}
      <a href="#data">{tc.noticeLink} →</a>
    </p>
  );
}
