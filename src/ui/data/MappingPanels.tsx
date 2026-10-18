import { useMemo, useState } from 'react';
import { bomParts } from '../../core/bom';
import { formatQuantity } from '../../core/format';
import {
  CHECK_MODULES,
  CHECKED_FIELDS,
  checkCount,
  checkMapping,
  KIND_FIELDS,
  MODULE_FIELDS,
  type CheckedField,
  type CheckModule,
  type ColumnIssue,
  type FieldIssue,
  type MappingCheck,
  type PartIssue,
} from '../../core/mappingCheck';
import { ITEM_KINDS, type ItemKind } from '../../core/masterdata';
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
        ? checkMapping(data.master.data, { coverage: data.coverage, callOffs: data.exports.at(-1), bomParts: bomParts(data.boms.map((b) => b.data)) })
        : null,
    [data],
  );
}

/** Text problému se sloupcem: chybí v souboru (a kdo ho potřebuje), nebo v něm není nic označené. */
function columnText(t: Messages, c: ColumnIssue): string {
  const tc = t.data.check;
  if (c.kind === 'noneMarked') return tc.noneAssembly;
  if (c.column === 'kind') return tc.kindMissing;
  const who = [...c.modules.map((m) => tc.moduleNames[m]), ...c.kinds.map((k) => tc.kindParts.replace('{kind}', k))].join(', ');
  return tc.columnMissing.replace('{modules}', who);
}

/** Filtr seznamu dílů: modul, druh dílu, nebo díly bez druhu. */
type PartFilter = '' | CheckModule | ItemKind | 'none';

/** Sloupce v souhrnu po modulech (číslo zákazníka moduly nepotřebují – díl z Coverage se podle něj spojí). */
const MODULE_COLUMNS = CHECKED_FIELDS.filter((f) => f !== 'customerNumber');
/** Sloupce v souhrnu podle druhu dílu (druh je u nich vyplněný). */
const KIND_COLUMNS = CHECKED_FIELDS.filter((f) => f !== 'kind');

/**
 * Kontrola mapování: co vyplnit podle druhu dílu (FG, SFG, PG) a co chybí po modulech, seznam dílů s tím, co
 * v Item_Mapping doplnit a proč (moduly / druh), filtr a export do Excelu.
 */
export function MappingCheckPanel() {
  const { t, locale } = useI18n();
  const tc = t.data.check;
  const check = useMappingCheck();
  const [filter, setFilter] = useState<PartFilter>('');
  // Seznam dílů je sbalený; rozbalí se kliknutím na nadpis nebo na řádek v souhrnu.
  const [partsOpen, setPartsOpen] = useState(false);
  const pick = (f: PartFilter) => {
    setFilter(filter === f ? '' : f);
    setPartsOpen(true);
  };

  const field = (f: CheckedField) => `${tc.fieldNames[f]} (${tc.columnNames[f]})`;
  const fill = (p: PartIssue) => (p.notInMapping ? tc.newRow : p.fields.map((f) => field(f.field)).join(', '));
  const modules = (list: readonly CheckModule[]) => list.map((m) => tc.moduleNames[m]).join(', ');
  const why = (p: PartIssue, f: FieldIssue) =>
    [f.modules.length ? `${tc.neededBy}: ${modules(f.modules)}` : '', f.byKind ? tc.byKind.replace('{kind}', p.kind) : ''].filter(Boolean).join(' · ');
  const matches = (p: PartIssue, f: PartFilter) =>
    !f || (f === 'none' ? !p.notInMapping && !p.kind : (ITEM_KINDS as readonly string[]).includes(f) ? (p.kind || p.suggestedKind) === f : p.modules.includes(f as CheckModule));
  const cell = (n: number) => (n > 0 ? <b className="check-bad">{formatQuantity(n, locale)}</b> : <span className="check-ok">✓</span>);
  const dot = <span className="muted" title={tc.notNeeded}>·</span>;

  const download = (c: MappingCheck) => {
    const active = CHECK_MODULES.filter((m) => c.modules[m].active);
    void downloadXlsxSheets(`${tc.fileName}.xlsx`, [
      {
        name: tc.sheetParts,
        header: [tc.item, tc.kind, tc.customerNumber, tc.description, tc.project, tc.fill, tc.modules, tc.folder],
        rows: c.parts.map((p) => [p.item, p.kind || p.suggestedKind, p.customerNumber, p.description, p.project, fill(p), modules(p.modules), p.folder]),
        stickyColumns: 1,
      },
      {
        name: tc.sheetKinds,
        header: [tc.kind, tc.kindTotal, ...KIND_COLUMNS.map(field), tc.total],
        rows: ITEM_KINDS.map((k) => [
          tc.kindNames[k],
          c.kinds[k].total,
          ...KIND_COLUMNS.map((f) => (KIND_FIELDS[k].includes(f) ? (c.kinds[k].fields[f] ?? 0) : null)),
          c.kinds[k].parts,
        ]),
      },
      {
        name: tc.sheetModules,
        header: [tc.module, tc.notInMapping, ...MODULE_COLUMNS.map(field), tc.total],
        rows: active.map((m) => [
          tc.moduleNames[m],
          c.modules[m].notInMapping,
          ...MODULE_COLUMNS.map((f) => (MODULE_FIELDS[m].includes(f) || (f === 'kind' && c.hasKind) ? (c.modules[m].fields[f] ?? 0) : null)),
          c.modules[m].parts,
        ]),
      },
      {
        name: tc.sheetColumns,
        header: [tc.column, tc.problem],
        rows: c.columns.map((x) => [tc.columnNames[x.column], columnText(t, x)]),
      },
    ]);
  };

  const body = (c: MappingCheck) => {
    const active = CHECK_MODULES.filter((m) => c.modules[m].active);
    const shown = c.parts.filter((p) => matches(p, filter));
    const filterName = (f: PartFilter) => (f === 'none' ? tc.noKind : (ITEM_KINDS as readonly string[]).includes(f) ? f : tc.moduleNames[f as CheckModule]);
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

        {c.hasKind && (
          <>
            <h3>{tc.byKindHeading}</h3>
            <div className="table-scroll">
              <table className="table check-matrix">
                <thead>
                  <tr>
                    <th>{tc.kind}</th>
                    <th className="n">{tc.kindTotal}</th>
                    {KIND_COLUMNS.map((f) => (
                      <th key={f} className="n" title={tc.columnNames[f]}>
                        {tc.fieldNames[f]}
                      </th>
                    ))}
                    <th className="n">{tc.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {ITEM_KINDS.map((k) => (
                    <tr key={k} className={filter === k ? 'check-selected' : undefined} onClick={() => pick(k)}>
                      <td>
                        <strong>{k}</strong>
                        <small className="muted cell-note">{tc.kindNames[k]}</small>
                      </td>
                      <td className="n">{formatQuantity(c.kinds[k].total, locale)}</td>
                      {KIND_COLUMNS.map((f) => (
                        <td key={f} className="n">
                          {KIND_FIELDS[k].includes(f) ? cell(c.kinds[k].fields[f] ?? 0) : dot}
                        </td>
                      ))}
                      <td className="n">{cell(c.kinds[k].parts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">{tc.kindNote}</p>
          </>
        )}

        <h3>{tc.byModule}</h3>
        <div className="table-scroll">
          <table className="table check-matrix">
            <thead>
              <tr>
                <th>{tc.module}</th>
                <th className="n">{tc.notInMapping}</th>
                {MODULE_COLUMNS.map((f) => (
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
                return (
                  <tr key={m} className={filter === m ? 'check-selected' : undefined} onClick={() => pick(m)}>
                    <td>
                      <strong>{tc.moduleNames[m]}</strong>
                      <small className="muted cell-note">{tc.moduleNotes[m]}</small>
                    </td>
                    <td className="n">{cell(s.notInMapping)}</td>
                    {MODULE_COLUMNS.map((f) => (
                      <td key={f} className="n">
                        {MODULE_FIELDS[m].includes(f) || (f === 'kind' && c.hasKind) ? cell(s.fields[f] ?? 0) : dot}
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
          <details className="check-parts-box" open={partsOpen} onToggle={(e) => setPartsOpen(e.currentTarget.open)}>
            <summary>
              {tc.partsHeading} ({formatQuantity(shown.length, locale)}
              {filter && ` · ${filterName(filter)}`})
            </summary>
            <div className="segmented check-filter" role="group" aria-label={tc.filter}>
              <button type="button" aria-pressed={filter === ''} onClick={() => setFilter('')}>
                {tc.all} ({formatQuantity(c.parts.length, locale)})
              </button>
              {active.map((m) => (
                <button key={m} type="button" aria-pressed={filter === m} onClick={() => setFilter(m)}>
                  {tc.moduleNames[m]} ({formatQuantity(c.modules[m].parts, locale)})
                </button>
              ))}
              {c.hasKind &&
                ([...ITEM_KINDS, 'none'] as const).map((k) => {
                  const n = c.parts.filter((p) => matches(p, k)).length;
                  return n > 0 ? (
                    <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {filterName(k)} ({formatQuantity(n, locale)})
                    </button>
                  ) : null;
                })}
            </div>
            <div className="table-scroll">
              <table className="table check-parts">
                <thead>
                  <tr>
                    <th>{tc.item}</th>
                    <th>{tc.kind}</th>
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
                      <td>{p.kind || (p.suggestedKind ? <span className="muted" title={tc.suggestedKind}>{p.suggestedKind}</span> : <span className="muted">—</span>)}</td>
                      <td>{p.customerNumber}</td>
                      <td className="wrap">{p.description}</td>
                      <td>{p.project || <span className="muted">—</span>}</td>
                      <td className="wrap">
                        {p.notInMapping ? (
                          <>
                            <span className="check-chip check-chip-new">{p.suggestedKind ? tc.newRowSheet.replace('{kind}', p.suggestedKind) : tc.newRow}</span>
                            {p.folder && <small className="muted cell-note">{tc.folderHint.replace('{folder}', p.folder)}</small>}
                          </>
                        ) : (
                          p.fields.map((f) => (
                            <span key={f.field} className="check-chip" title={why(p, f)}>
                              {field(f.field)}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="wrap">{p.modules.length ? modules(p.modules) : <span className="muted">{tc.unused}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > SHOWN_ROWS && <p className="muted">{tc.more.replace('{n}', formatQuantity(shown.length - SHOWN_ROWS, locale))}</p>}
          </details>
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
