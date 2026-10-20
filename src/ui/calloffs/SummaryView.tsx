import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ITEM_FIELDS, MISSING_MASTER, type ItemField, type ItemFilter } from '../../core/calloffs/filter';
import type { CallOffExport } from '../../core/calloffs/parse';
import { summarize, visibleNodes, type PerShift, type SummaryNode } from '../../core/calloffs/summary';
import { summaryReport } from '../../core/calloffs/summaryReport';
import { buildCurrentRows, buildPeriods, DEFAULT_WEEKS, type PeriodCount } from '../../core/calloffs/views';
import { formatDate, formatQuantity, formatSigned } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { categoryOutput } from '../../core/planning/settings';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadReport } from '../../platform/download';
import { usePlanSettings } from '../planning/PlanningProvider';
import { ExportButtons, type ExportTable } from './ExportButtons';

const RANGES: PeriodCount[] = [12, 26, 52, 'all'];

interface Props {
  current: CallOffExport;
  previous: CallOffExport | undefined;
  items: string[];
  master: ReadonlyMap<string, MasterItem> | undefined;
  /** Zvolené filtry (do záhlaví reportu). */
  filter: ItemFilter;
  filters: ReactNode;
}

/** Přehled po projektech: Projekt → Kategorie → Strana → Varianta se součty odvolávek po týdnech. */
export function SummaryView({ current, previous, items, master, filter, filters }: Props) {
  const { t, locale } = useI18n();
  const ts = t.calloffs.summary;
  const [range, setRange] = useState<PeriodCount>(DEFAULT_WEEKS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Směny: kusy ÷ výkon za směnu kategorie (Plánování → Kapacity); zapnuté, když je nějaký výkon vyplněný.
  const settings = usePlanSettings();
  const perShift = useMemo<PerShift>(() => (item) => {
    const m = master?.get(item);
    return m ? categoryOutput(settings, m.project, m.category) : null;
  }, [master, settings]);
  const [showShifts, setShowShifts] = useState(settings.outputs.length > 0);

  const periods = useMemo(() => buildPeriods(current, 'week', range), [current, range]);
  const currentRows = useMemo(() => buildCurrentRows(current, previous, items, periods), [current, previous, items, periods]);
  const tree = useMemo(() => summarize(currentRows, master, perShift), [currentRows, master, perShift]);
  const all = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: readonly SummaryNode[]) => nodes.forEach((n) => n.children.length && (keys.push(n.key), walk(n.children)));
    walk(tree);
    return keys;
  }, [tree]);
  const expanded = new Set(all.filter((k) => !collapsed.has(k)));
  const rows = visibleNodes(tree, expanded);
  const totals = periods.map((_, k) => tree.reduce((s, n) => s + n.values[k]!, 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const diff = previous ? tree.reduce((s, n) => s + (n.diff ?? 0), 0) : null;
  // Součet směn dílů s výkonem (díly bez výkonu jsou v upozornění pod tabulkou).
  const totalShifts = tree.some((n) => n.shifts) ? periods.map((_, k) => tree.reduce((s, n) => s + (n.shifts?.[k] ?? 0), 0)) : null;
  // Kategorie, kde některé díly výkon za směnu nemají.
  const missingOutputs = tree.flatMap((p) => p.children.filter((c) => c.field === 'category' && c.label && c.shiftsMissing > 0).map((c) => `${p.label || ts.noProject} · ${c.label}`));
  const shiftText = (v: number | null) => (v === null ? '—' : v.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

  const none: Record<ItemField, string> = { project: ts.noProject, category: ts.noCategory, side: ts.noSide, variant: ts.noVariant };
  const label = (n: SummaryNode) => n.label || none[n.field];
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Sbalí uzly zvoleného údaje a dalších (např. „Kategorie“ = vidět projekty a jejich kategorie).
  const collapseTo = (field: ItemField) => {
    const from = ITEM_FIELDS.indexOf(field);
    const keys: string[] = [];
    const walk = (nodes: readonly SummaryNode[]) => nodes.forEach((n) => (ITEM_FIELDS.indexOf(n.field) >= from && n.children.length ? keys.push(n.key) : null, walk(n.children)));
    walk(tree);
    setCollapsed(new Set(keys));
  };

  const buildExport = (): ExportTable => {
    const out: (string | number | null)[][] = [];
    // Každý řádek s údaji své větve (přeskočená strana nebo varianta zůstane prázdná).
    const walk = (nodes: readonly SummaryNode[], path: Partial<Record<ItemField, string>>) =>
      nodes.forEach((n) => {
        const p = { ...path, [n.field]: label(n) };
        const fields = ITEM_FIELDS.map((f) => p[f] ?? '');
        if (!showShifts) out.push([...fields, n.items, ...n.values, n.total, n.diff]);
        else {
          out.push([...fields, n.items, n.perShift, ts.pcs, ...n.values, n.total, n.diff]);
          out.push([...fields, n.items, n.perShift, ts.shiftsUnit, ...(n.shifts ? n.shifts.map((v) => Math.round(v * 10) / 10) : periods.map(() => null)), n.shifts ? Math.round(n.shifts.reduce((a, b) => a + b, 0) * 10) / 10 : null, null]);
        }
        walk(n.children, p);
      });
    walk(tree, {});
    return {
      fileName: `${t.calloffs.export.fileName}_${ts.fileName}_CW${current.week}-${current.year}`,
      sheetName: ts.tab,
      header: [
        ts.project,
        ts.category,
        ts.side,
        ts.variant,
        ts.items,
        ...(showShifts ? [ts.perShift, ts.unit] : []),
        ...periods.map((p) => p.label),
        t.calloffs.table.total,
        previous ? `${ts.diff} CW ${previous.week}` : ts.diff,
      ],
      rows: out,
    };
  };

  // Report pro vedení: přehled v úrovni, jak je tabulka právě rozbalená, a list se všemi díly.
  const downloadManagement = () => {
    const tr = ts.report;
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const fill = (text: string, week: number, year: number) => text.replace('{week}', String(week)).replace('{year}', String(year));
    const subtitle = [fill(tr.subtitle, current.week, current.year).replace('{date}', formatDate(iso, locale)), previous ? fill(tr.against, previous.week, previous.year) : null]
      .filter(Boolean)
      .join(' · ');
    const tf = t.calloffs.filters;
    const chosen = [
      ...ITEM_FIELDS.map((f) => (filter[f] ? `${tf[f]}: ${filter[f] === MISSING_MASTER ? tr.missing : filter[f]}` : null)),
      filter.query.trim() ? `${tr.search}: „${filter.query.trim()}“` : null,
    ].filter(Boolean);
    const sheets = summaryReport(tree, currentRows, periods, master, {
      title: tr.title,
      subtitle,
      filters: chosen.length ? `${tr.filters}: ${chosen.join(' · ')}` : tr.filtersNone,
      note: tr.note,
      tree: ts.tree,
      project: ts.project,
      category: ts.category,
      side: ts.side,
      variant: ts.variant,
      item: tr.item,
      description: tr.description,
      total: tr.total,
      diff: tr.diff,
      diffPercent: tr.diffPercent,
      sum: tr.sum,
      unit: ts.unit,
      pcs: ts.pcs,
      shifts: ts.shiftsUnit,
      perShift: ts.perShift,
      missingOutput: ts.missingOutput,
      none,
      sheetSummary: tr.sheetSummary,
      sheetItems: tr.sheetItems,
    }, { expanded, ...(showShifts ? { perShift } : {}) });
    return downloadReport(`${t.calloffs.export.fileName}_${ts.fileName}_CW${current.week}-${current.year}.xlsx`, sheets);
  };

  return (
    <div className="stack">
      {filters}
      <div className="panel">
        <div className="panel-head">
          <h2>{ts.heading}</h2>
          <span className="muted">
            {t.calloffs.currentExport} CW {current.week}/{current.year}, {t.calloffs.table.unit}
          </span>
          <label className="inline-field">
            <span>{t.calloffs.range.label}</span>
            <select value={String(range)} onChange={(e) => setRange(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              {RANGES.map((r) => (
                <option key={r} value={String(r)}>
                  {r === 'all' ? t.calloffs.range.all : `${r} ${t.calloffs.range.weeks}`}
                </option>
              ))}
            </select>
          </label>
          <span className="segmented" role="group" aria-label={ts.depth}>
            <button type="button" onClick={() => collapseTo('project')}>
              {ts.depthProjects}
            </button>
            <button type="button" onClick={() => collapseTo('category')}>
              {ts.depthCategories}
            </button>
            <button type="button" onClick={() => collapseTo('side')}>
              {ts.depthSides}
            </button>
            <button type="button" onClick={() => setCollapsed(new Set())}>
              {ts.depthVariants}
            </button>
          </span>
          <label className="check-field">
            <input type="checkbox" checked={showShifts} onChange={(e) => setShowShifts(e.target.checked)} />
            {ts.showShifts}
          </label>
          <ExportButtons build={buildExport} excel={downloadManagement} excelTitle={ts.report.buttonTitle} />
        </div>
        {tree.length === 0 ? (
          <p>{t.calloffs.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data summary-tree">
              <thead>
                <tr>
                  <th className="sticky-col">{ts.tree}</th>
                  {showShifts && <th className="n">{ts.perShift}</th>}
                  {periods.map((p) => (
                    <th key={p.start} className="n">
                      {p.label}
                    </th>
                  ))}
                  <th className="n">{t.calloffs.table.total}</th>
                  <th className="n">{previous ? `${ts.diff} CW ${previous.week}` : ts.diff}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <Fragment key={n.key}>
                    <tr className={`summary-level-${n.level}${showShifts ? ' summary-with-shifts' : ''}`}>
                      <td className="sticky-col">
                        <span className="summary-label" style={{ paddingLeft: `${n.level * 18}px` }}>
                          {n.children.length > 0 ? (
                            <button type="button" className="summary-toggle" aria-expanded={expanded.has(n.key)} aria-label={`${label(n)}: ${expanded.has(n.key) ? ts.collapse : ts.expand}`} onClick={() => toggle(n.key)}>
                              {expanded.has(n.key) ? '▾' : '▸'}
                            </button>
                          ) : (
                            <span className="summary-toggle" aria-hidden="true" />
                          )}
                          <span className={n.label ? undefined : 'muted'}>{label(n)}</span>
                          <small className="muted"> · {formatQuantity(n.items, locale)} {ts.parts}</small>
                        </span>
                      </td>
                      {showShifts && <td className="n">{n.perShift !== null ? formatQuantity(n.perShift, locale) : n.shiftsMissing > 0 ? <span className="muted">{ts.missingOutput}</span> : ''}</td>}
                      {n.values.map((v, k) => (
                        <td key={periods[k]!.start} className="n">
                          {v ? formatQuantity(v, locale) : <span className="muted">0</span>}
                        </td>
                      ))}
                      <td className="n">
                        <strong>{formatQuantity(n.total, locale)}</strong>
                      </td>
                      <td className="n">{n.diff === null ? '—' : n.diff === 0 ? <span className="muted">0</span> : <span className={n.diff > 0 ? 'delta-up' : 'delta-down'}>{formatSigned(n.diff, locale)}</span>}</td>
                    </tr>
                    {showShifts && (
                      <tr className={`summary-level-${n.level} summary-shifts`}>
                        <td className="sticky-col">
                          <span className="summary-label" style={{ paddingLeft: `${n.level * 18 + 26}px` }}>
                            {ts.shiftsRow}
                          </span>
                        </td>
                        <td />
                        {periods.map((p, k) => (
                          <td key={p.start} className="n">
                            {shiftText(n.shifts ? n.shifts[k]! : null)}
                          </td>
                        ))}
                        <td className="n">
                          <strong>{shiftText(n.shifts ? n.shifts.reduce((a, b) => a + b, 0) : null)}</strong>
                        </td>
                        <td />
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-col">{t.calloffs.table.sum}</td>
                  {showShifts && <td />}
                  {totals.map((v, k) => (
                    <td key={periods[k]!.start} className="n">
                      {formatQuantity(v, locale)}
                    </td>
                  ))}
                  <td className="n">{formatQuantity(total, locale)}</td>
                  <td className="n">{diff === null ? '—' : formatSigned(diff, locale)}</td>
                </tr>
                {showShifts && (
                  <tr className="summary-shifts">
                    <td className="sticky-col">{ts.shiftsRow}</td>
                    <td />
                    {periods.map((p, k) => (
                      <td key={p.start} className="n">
                        {shiftText(totalShifts ? totalShifts[k]! : null)}
                      </td>
                    ))}
                    <td className="n">{shiftText(totalShifts ? totalShifts.reduce((a, b) => a + b, 0) : null)}</td>
                    <td />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
        {showShifts && missingOutputs.length > 0 && <p className="banner-inline">{ts.missingOutputs.replace('{list}', missingOutputs.join(', '))}</p>}
        <p className="muted">{ts.note}</p>
      </div>
    </div>
  );
}
