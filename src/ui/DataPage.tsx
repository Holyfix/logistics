import { useMemo } from 'react';
import { dayToIso } from '../core/dates';
import { formatDate, formatQuantity } from '../core/format';
import type { BomData } from '../core/bom';
import { mappingTemplate } from '../core/mappingTemplate';
import { excludedLocationsIn, STOCK_ZONES, stockByItem, stockItemCount } from '../core/stock';
import type { DataIssue } from '../core/table';
import { useI18n } from '../i18n/I18nProvider';
import { downloadReport } from '../platform/download';
import { useData } from './data/DataProvider';
import { FolderPicker } from './data/FolderPicker';
import { DataMapPanel, MappingCheckPanel, useMappingCheck } from './data/MappingPanels';

function IssueList({ issues, count }: { issues: DataIssue[]; count: number }) {
  const { t } = useI18n();
  return (
    <ul className="issues">
      {issues.slice(0, 5).map((i, k) => (
        <li key={k}>
          {i.sheet && `${t.data.issue.sheet} ${i.sheet}, `}
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
  const mappingCheck = useMappingCheck();
  const exports = useMemo(() => (data ? [...data.exports].reverse() : []), [data]);
  const current = data?.exports.at(-1);
  const missing = useMemo(
    () => (current && data?.master ? current.items.filter((item) => !data.master!.data.items.has(item)).length : (current?.items.length ?? 0)),
    [current, data],
  );

  // Projekty hotových dílů v kusovníku jen podle mapování, např. „P100 (40), bez projektu (16)“.
  const projectOf = useMemo(() => new Map([...(data?.master?.data.items.values() ?? [])].map((m) => [m.item.toUpperCase(), m.project])), [data]);
  const bomProjects = (bom: BomData) => {
    const counts = new Map<string, number>();
    for (const parent of bom.parents.keys()) {
      const project = projectOf.get(parent) ?? '';
      counts.set(project, (counts.get(project) ?? 0) + 1);
    }
    return [...counts]
      .sort(([a], [b]) => (a ? (b ? a.localeCompare(b, 'cs') : -1) : 1))
      .map(([project, n]) => `${project || t.data.bom.noProject} (${formatQuantity(n, locale)})`)
      .join(', ');
  };

  const coverageUnmapped = useMemo(
    () => data?.coverage.reduce((n, c) => n + c.report.rows.filter((r) => !data.master?.data.byCustomerKey.has(r.customerKey)).length, 0) ?? 0,
    [data],
  );

  const stockFacts = useMemo(() => {
    if (!data?.stock) return null;
    const byItem = stockByItem(data.stock.data);
    return {
      excluded: excludedLocationsIn(data.stock.data),
      items: stockItemCount(data.stock.data),
      withStock: byItem.size,
      pieces: [...byItem.values()].reduce((a, b) => a + b, 0),
    };
  }, [data]);

  // Šablona: všechny díly mapování + díly, které v něm chybí (bez mapování díly z aktuálního exportu odvolávek).
  const downloadTemplate = () => {
    const missingParts = mappingCheck
      ? mappingCheck.parts.filter((p) => p.notInMapping).map((p) => ({ item: p.item, customerNumber: p.customerNumber, description: p.description }))
      : (current?.items.map((item, i) => ({ item, customerNumber: '', description: current.descriptions[i] ?? '' })) ?? []);
    void downloadReport('Item_Mapping.xlsx', mappingTemplate(data?.master?.data, missingParts, t.data.master.templateTexts));
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
                {data.coverage.length > 0 && (
                  <>
                    <dt>{t.data.master.coverageMissing}</dt>
                    <dd>{formatQuantity(coverageUnmapped, locale)}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p>{t.data.master.none}</p>
            )}
            {data.master && data.master.data.issueCount > 0 && <IssueList issues={data.master.data.issues} count={data.master.data.issueCount} />}
            {(data.master || current) && (
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

          <MappingCheckPanel />

          <div className="panel">
            <h2>{t.data.coverage.heading}</h2>
            {data.coverage.length === 0 ? (
              <p>{t.data.coverage.none}</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.data.coverage.location}</th>
                      <th>{t.data.coverage.project}</th>
                      <th>{t.data.coverage.file}</th>
                      <th>{t.data.coverage.format}</th>
                      <th className="n">{t.data.coverage.rows}</th>
                      <th>{t.data.coverage.days}</th>
                      <th>{t.data.coverage.modified}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.coverage.map((c) => (
                      <tr key={c.path}>
                        <td>{c.location || '—'}</td>
                        <td>{c.project || '—'}</td>
                        <td>{c.fileName}</td>
                        <td>{t.data.coverage.formats[c.report.format]}</td>
                        <td className="n">{formatQuantity(c.report.rows.length, locale)}</td>
                        <td>
                          {formatDate(dayToIso(c.report.days[0]!), locale)} – {formatDate(dayToIso(c.report.days.at(-1)!), locale)}
                        </td>
                        <td>{new Date(c.lastModified).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>{t.data.stock.heading}</h2>
            {data.stock && stockFacts ? (
              <dl className="facts">
                <dt>{t.data.stock.file}</dt>
                <dd>{data.stock.path}</dd>
                <dt>{t.data.stock.modified}</dt>
                <dd>{new Date(data.stock.lastModified).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</dd>
                <dt>{t.data.stock.rows}</dt>
                <dd>{formatQuantity(data.stock.data.rows.length, locale)}</dd>
                <dt>{t.data.stock.items}</dt>
                <dd>{formatQuantity(stockFacts.items, locale)}</dd>
                <dt>{t.data.stock.zoneItems}</dt>
                <dd>
                  {formatQuantity(stockFacts.withStock, locale)} ({formatQuantity(stockFacts.pieces, locale)} {t.calloffs.table.unit})
                </dd>
                <dt>{t.data.stock.qtyColumn}</dt>
                <dd>{data.stock.data.qtyColumn}</dd>
                <dt>{t.data.stock.zones}</dt>
                <dd>{STOCK_ZONES.join(', ')}</dd>
                <dt>{t.data.stock.excluded}</dt>
                <dd>{stockFacts.excluded.length > 0 ? stockFacts.excluded.join(', ') : <span className="muted">{t.data.stock.noExcluded}</span>}</dd>
              </dl>
            ) : (
              <p>{t.data.stock.none}</p>
            )}
            {data.stock && data.stock.data.issueCount > 0 && <IssueList issues={data.stock.data.issues} count={data.stock.data.issueCount} />}
            <p className="muted">{t.data.stock.rule}</p>
          </div>

          <div className="panel">
            <h2>{t.data.bom.heading}</h2>
            {data.boms.length === 0 ? (
              <p>{t.data.bom.none}</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.data.bom.file}</th>
                      <th className="n">{t.data.bom.products}</th>
                      <th className="n">{t.data.bom.components}</th>
                      <th>{t.data.bom.projects}</th>
                      <th>{t.data.bom.modified}</th>
                      <th>{t.data.calloffs.issues}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.boms.map((b) => (
                      <tr key={b.path}>
                        <td>{b.path}</td>
                        <td className="n">{formatQuantity(b.data.parents.size, locale)}</td>
                        <td className="n">{formatQuantity(new Set([...b.data.parents.values()].flat().map((c) => c.item)).size, locale)}</td>
                        <td className="wrap">{bomProjects(b.data)}</td>
                        <td>{new Date(b.lastModified).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="wrap">{b.data.issueCount === 0 ? <span className="muted">{t.data.calloffs.noIssues}</span> : <IssueList issues={b.data.issues} count={b.data.issueCount} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.master && (
              <p className="muted">
                {data.master.data.columns.has('kind')
                  ? `${t.data.bom.marked}: ${formatQuantity([...data.master.data.items.values()].filter((m) => m.kind === 'PG').length, locale)}`
                  : t.data.bom.noColumn}
              </p>
            )}
          </div>

          <div className="panel">
            <h2>{t.data.planning.heading}</h2>
            {data.plans.length === 0 && !data.planSettings && !data.oil ? (
              <p>{t.data.planning.none}</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.data.planning.file}</th>
                      <th>{t.data.planning.content}</th>
                      <th>{t.data.bom.modified}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.planSettings && (
                      <tr>
                        <td>{data.planSettings.path}</td>
                        <td>
                          {t.data.planning.settings}: {formatQuantity(data.planSettings.settings.lines.length, locale)} {t.data.planning.lines},{' '}
                          {formatQuantity(data.planSettings.settings.destinations.length, locale)} {t.data.planning.destinations}
                        </td>
                        <td>{new Date(data.planSettings.lastModified).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      </tr>
                    )}
                    {data.oil && (
                      <tr>
                        <td>{data.oil.path}</td>
                        <td>
                          OIL: {formatQuantity(data.oil.list.items.length, locale)} {t.data.planning.oilItems}
                        </td>
                        <td>{new Date(data.oil.lastModified).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      </tr>
                    )}
                    {data.plans.map((p) => (
                      <tr key={p.path}>
                        <td>{p.path}</td>
                        <td>
                          {p.plan.line} {p.plan.project}: {formatQuantity(Object.keys(p.plan.cells).length, locale)} {t.data.planning.cells}
                        </td>
                        <td>{new Date(p.lastModified).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.master && <p className="muted">{data.master.data.hasLineColumn ? t.data.planning.lineColumn : t.data.planning.noLineColumn}</p>}
          </div>

          {data.failed.length > 0 && (
            <div className="panel">
              <h2>{t.data.failed.heading}</h2>
              <ul className="issues">
                {data.failed.map((f) => (
                  <li key={f.path}>
                    <strong>{f.path}</strong>: {t.data.failed[f.reason]}
                    {f.detail && ` (${f.detail})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <DataMapPanel />

      <div className="panel">
        <h2>{t.data.structure.heading}</h2>
        <ul className="features">
          <li>{t.data.structure.calloffs}</li>
          <li>{t.data.structure.master}</li>
          <li>{t.data.structure.coverage}</li>
          <li>{t.data.structure.stock}</li>
          <li>{t.data.structure.bom}</li>
          <li>{t.data.structure.planning}</li>
        </ul>
      </div>
    </section>
  );
}
