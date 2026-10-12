import { useMemo } from 'react';
import { dayToIso } from '../core/dates';
import { formatDate, formatQuantity } from '../core/format';
import { masterDataTemplate } from '../core/masterdata';
import type { DataIssue } from '../core/table';
import { useI18n } from '../i18n/I18nProvider';
import { downloadXlsx } from '../platform/download';
import { useData } from './data/DataProvider';
import { FolderPicker } from './data/FolderPicker';

function IssueList({ issues, count }: { issues: DataIssue[]; count: number }) {
  const { t } = useI18n();
  return (
    <ul className="issues">
      {issues.slice(0, 5).map((i, k) => (
        <li key={k}>
          {i.row > 1 && `${t.data.issue.row} ${i.row}: `}
          {i.column && `${i.column} – `}
          {t.data.issue[i.message]}
          {i.value && ` („${i.value}“)`}
        </li>
      ))}
      {count > 5 && (
        <li>
          {t.data.issue.more} {count - 5}
        </li>
      )}
    </ul>
  );
}

export function DataPage() {
  const { t, locale } = useI18n();
  const { state, rememberFolder } = useData();
  const data = state.data;
  const exports = useMemo(() => (data ? [...data.exports].reverse() : []), [data]);
  const current = data?.exports.at(-1);
  const missing = useMemo(
    () => (current && data?.master ? current.items.filter((item) => !data.master!.data.items.has(item)).length : (current?.items.length ?? 0)),
    [current, data],
  );

  const downloadTemplate = () => {
    if (!current) return;
    const parts = current.items.map((item, i) => ({ item, description: current.descriptions[i]! }));
    const { header, rows } = masterDataTemplate(parts, data?.master?.data.items);
    void downloadXlsx('kmenova-data.xlsx', 'Kmenová data', header, rows);
  };

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head">
        <h1 id="page-title">{t.modules.data.title}</h1>
        <p className="lead">{t.data.intro}</p>
      </div>

      <div className="panel">
        <h2>{t.data.folder.heading}</h2>
        <p>
          {state.folderName ? (
            <>
              {t.data.folder.current}: <strong>{state.folderName}</strong>
              {data && state.status === 'ready' && (
                <span className="muted">
                  {' '}
                  · {t.data.folder.loadedAt} {new Date(data.loadedAt).toLocaleTimeString(locale === 'cs' ? 'cs-CZ' : 'en-GB')}
                </span>
              )}
            </>
          ) : (
            t.data.folder.none
          )}
        </p>
        {state.status === 'needsPermission' && <p>{t.data.folder.grantNote}</p>}
        {!rememberFolder && <p className="muted">{t.data.folder.fallbackNote}</p>}
        {state.status === 'loading' && (
          <div className="progress" role="status">
            <span>{t.data.folder.loading}</span>
            {state.progress && state.progress.total > 0 && (
              <>
                <progress max={state.progress.total} value={state.progress.done} />
                <span className="muted">
                  {state.progress.done} / {state.progress.total}
                </span>
              </>
            )}
          </div>
        )}
        {state.status === 'error' && (
          <p className="error" role="alert">
            {t.data.folder.error}: {state.error}
          </p>
        )}
        <FolderPicker />
      </div>

      {data && (
        <>
          <div className="panel">
            <h2>{t.data.calloffs.heading}</h2>
            {exports.length === 0 ? (
              <p>{t.data.calloffs.none}</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.data.calloffs.file}</th>
                      <th>{t.data.calloffs.week}</th>
                      <th className="n">{t.data.calloffs.rows}</th>
                      <th className="n">{t.data.calloffs.items}</th>
                      <th>{t.data.calloffs.range}</th>
                      <th>{t.data.calloffs.issues}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exports.map((e) => (
                      <tr key={e.exportDay}>
                        <td>{e.fileName}</td>
                        <td>
                          CW {e.week}/{e.year}
                        </td>
                        <td className="n">{formatQuantity(e.rowCount, locale)}</td>
                        <td className="n">{formatQuantity(e.items.length, locale)}</td>
                        <td>
                          {formatDate(dayToIso(e.firstDay), locale)} – {formatDate(dayToIso(e.lastDay), locale)}
                        </td>
                        <td className="wrap">{e.issueCount === 0 ? <span className="muted">{t.data.calloffs.noIssues}</span> : <IssueList issues={e.issues} count={e.issueCount} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>{t.data.master.heading}</h2>
            {data.master ? (
              <dl className="facts">
                <dt>{t.data.master.file}</dt>
                <dd>{data.master.path}</dd>
                <dt>{t.data.master.items}</dt>
                <dd>{formatQuantity(data.master.data.items.size, locale)}</dd>
                {current && (
                  <>
                    <dt>{t.data.master.missing}</dt>
                    <dd>{formatQuantity(missing, locale)}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p>{t.data.master.none}</p>
            )}
            {data.master && data.master.data.issueCount > 0 && <IssueList issues={data.master.data.issues} count={data.master.data.issueCount} />}
            {current && (
              <>
                <p className="muted">{t.data.master.templateNote}</p>
                <div className="actions-row">
                  <button type="button" className="button" onClick={downloadTemplate}>
                    {t.data.master.template}
                  </button>
                </div>
              </>
            )}
          </div>

          {data.failed.length > 0 && (
            <div className="panel">
              <h2>{t.data.failed.heading}</h2>
              <ul className="issues">
                {data.failed.map((f) => (
                  <li key={f.path}>
                    <strong>{f.path}</strong>: {t.data.failed[f.reason]} ({f.detail})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="panel">
        <h2>{t.data.structure.heading}</h2>
        <ul className="features">
          <li>{t.data.structure.calloffs}</li>
          <li>{t.data.structure.master}</li>
        </ul>
      </div>
    </section>
  );
}
