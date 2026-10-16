import { useMemo, useState } from 'react';
import { formatQuantity } from '../../core/format';
import {
  CHECK_MODULES,
  CHECKED_FIELDS,
  checkCount,
  checkMapping,
  MODULE_FIELDS,
  type CheckedField,
  type CheckModule,
  type ColumnIssue,
  type MappingCheck,
  type PartIssue,
} from '../../core/mappingCheck';
import type { Messages } from '../../i18n/cs';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsxSheets } from '../../platform/download';
import { useData } from './DataProvider';

/** Kolik dílů ukázat na stránce (všechny jsou v Excelu). */
const SHOWN_ROWS = 100;

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

/** Text problému se sloupcem: chybí v souboru, nebo v něm není nic označené. */
function columnText(t: Messages, c: ColumnIssue): string {
  const tc = t.data.check;
  const col = tc.columnNames[c.column];
  if (c.kind === 'noneMarked') return c.column === 'line' ? tc.noneAssembly : tc.noneComponent;
  return tc.columnMissing.replace('{column}', col).replace('{modules}', c.modules.map((m) => tc.moduleNames[m]).join(', '));
}

/**
 * Kontrola mapování po modulech: souhrn (modul × sloupec), seznam dílů s tím, co v Item_Mapping doplnit a kvůli
 * kterým modulům, filtr podle modulu a export do Excelu.
 */
export function MappingCheckPanel() {
  const { t, locale } = useI18n();
  const tc = t.data.check;
  const check = useMappingCheck();
  const [module, setModule] = useState<CheckModule | ''>('');

  const field = (f: CheckedField) => `${tc.fieldNames[f]} (${tc.columnNames[f]})`;
  const fill = (p: PartIssue) => (p.notInMapping ? tc.newRow : p.fields.map((f) => field(f.field)).join(', '));
  const modules = (list: readonly CheckModule[]) => list.map((m) => tc.moduleNames[m]).join(', ');

  const download = (c: MappingCheck) => {
    const active = CHECK_MODULES.filter((m) => c.modules[m].active);
    void downloadXlsxSheets(`${tc.fileName}.xlsx`, [
      {
        name: tc.sheetParts,
        header: [tc.item, tc.customerNumber, tc.description, tc.project, tc.fill, tc.modules, tc.folder],
        rows: c.parts.map((p) => [p.item, p.customerNumber, p.description, p.project, fill(p), modules(p.modules), p.folder]),
        stickyColumns: 1,
      },
      {
        name: tc.sheetModules,
        header: [tc.module, tc.notInMapping, ...CHECKED_FIELDS.map(field), tc.total],
        rows: active.map((m) => [
          tc.moduleNames[m],
          c.modules[m].notInMapping,
          ...CHECKED_FIELDS.map((f) => (MODULE_FIELDS[m].includes(f) ? (c.modules[m].fields[f] ?? 0) : null)),
          c.modules[m].parts,
        ]),
      },
      { name: tc.sheetColumns, header: [tc.column, tc.modules, tc.problem], rows: c.columns.map((x) => [tc.columnNames[x.column], modules(x.modules), columnText(t, x)]) },
    ]);
  };

  const body = (c: MappingCheck) => {
    const active = CHECK_MODULES.filter((m) => c.modules[m].active);
    const shown = c.parts.filter((p) => !module || p.modules.includes(module));
    return (
      <>
        {c.columns.length > 0 && (
          <ul className="check-columns">
            {c.columns.map((x) => (
              <li key={`${x.column}|${x.kind}`} className="banner-inline">
                <strong>{tc.columnNames[x.column]}</strong> – {columnText(t, x)}
              </li>
            ))}
          </ul>
        )}

        <h3>{tc.byModule}</h3>
        <div className="table-scroll">
          <table className="table check-matrix">
            <thead>
              <tr>
                <th>{tc.module}</th>
                <th className="n">{tc.notInMapping}</th>
                {CHECKED_FIELDS.map((f) => (
                  <th key={f} className="n" title={tc.columnNames[f]}>
                    {tc.fieldNames[f]}
                  </th>
                ))}
                <th className="n">{tc.total}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => {
                const s = c.modules[m];
                const cell = (n: number) => (n > 0 ? <b className="check-bad">{formatQuantity(n, locale)}</b> : <span className="check-ok">✓</span>);
                return (
                  <tr key={m} className={module === m ? 'check-selected' : undefined} onClick={() => setModule(module === m ? '' : m)}>
                    <td>
                      <strong>{tc.moduleNames[m]}</strong>
                      <small className="muted cell-note">{tc.moduleNotes[m]}</small>
                    </td>
                    <td className="n">{cell(s.notInMapping)}</td>
                    {CHECKED_FIELDS.map((f) => (
                      <td key={f} className="n">
                        {MODULE_FIELDS[m].includes(f) ? cell(s.fields[f] ?? 0) : <span className="muted" title={tc.notNeeded}>·</span>}
                      </td>
                    ))}
                    <td className="n">{cell(s.parts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">{tc.matrixNote}</p>

        {c.parts.length > 0 && (
          <>
            <h3>{tc.partsHeading}</h3>
            <div className="segmented" role="group" aria-label={tc.module}>
              <button type="button" aria-pressed={module === ''} onClick={() => setModule('')}>
                {tc.all} ({formatQuantity(c.parts.length, locale)})
              </button>
              {active.map((m) => (
                <button key={m} type="button" aria-pressed={module === m} onClick={() => setModule(m)}>
                  {tc.moduleNames[m]} ({formatQuantity(c.modules[m].parts, locale)})
                </button>
              ))}
            </div>
            <div className="table-scroll">
              <table className="table check-parts">
                <thead>
                  <tr>
                    <th>{tc.item}</th>
                    <th>{tc.customerNumber}</th>
                    <th>{tc.description}</th>
                    <th>{tc.project}</th>
                    <th>{tc.fill}</th>
                    <th>{tc.modules}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, SHOWN_ROWS).map((p) => (
                    <tr key={p.key}>
                      <td>
                        <strong>{p.item || '—'}</strong>
                      </td>
                      <td>{p.customerNumber}</td>
                      <td className="wrap">{p.description}</td>
                      <td>{p.project || <span className="muted">—</span>}</td>
                      <td className="wrap">
                        {p.notInMapping ? (
                          <>
                            <span className="check-chip check-chip-new">{tc.newRow}</span>
                            {p.folder && <small className="muted cell-note">{tc.folderHint.replace('{folder}', p.folder)}</small>}
                          </>
                        ) : (
                          p.fields.map((f) => (
                            <span key={f.field} className="check-chip" title={`${tc.neededBy}: ${modules(f.modules)}`}>
                              {field(f.field)}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="wrap">{modules(p.modules)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > SHOWN_ROWS && <p className="muted">{tc.more.replace('{n}', formatQuantity(shown.length - SHOWN_ROWS, locale))}</p>}
          </>
        )}
        <div className="actions-row">
          <button type="button" className="button" onClick={() => download(c)}>
            ⤓ {tc.download}
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="panel">
      <h2>{tc.heading}</h2>
      <p className="muted">{tc.lead}</p>
      {check === null ? <p>{tc.noMaster}</p> : checkCount(check) === 0 ? <p>{tc.ok}</p> : body(check)}
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

/** Upozornění v modulu: co v mapování chybí pro tento modul (aplikace to nedoplňuje odjinud); odkaz na Kontrolu mapování. */
export function MappingNotice({ module }: { module: CheckModule }) {
  const { t, locale } = useI18n();
  const { state } = useData();
  const check = useMappingCheck();
  if (!state.data) return null;
  const tc = t.data.check;
  const n = check ? checkCount(check, module) : 0;
  if (check && n === 0) return null;
  const columns = check?.columns.filter((c) => c.modules.includes(module)) ?? [];
  const parts = check?.modules[module].parts ?? 0;
  return (
    <p className="banner-inline mapping-notice" role="status">
      {check === null
        ? tc.noMaster
        : [
            parts > 0 ? tc.notice.replace('{module}', tc.moduleNames[module]).replace('{n}', formatQuantity(parts, locale)) : '',
            ...columns.map((c) => columnText(t, c)),
          ]
            .filter(Boolean)
            .join(' ')}{' '}
      <a href="#data">{tc.noticeLink} →</a>
    </p>
  );
}
