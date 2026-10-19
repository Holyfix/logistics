import { useMemo, useState, type ReactNode } from 'react';
import { ITEM_FIELDS, MISSING_MASTER, type ItemField, type ItemFilter } from '../../core/calloffs/filter';
import type { CallOffExport } from '../../core/calloffs/parse';
import { summarize, visibleNodes, type SummaryNode } from '../../core/calloffs/summary';
import { summaryReport } from '../../core/calloffs/summaryReport';
import { buildCurrentRows, buildPeriods, DEFAULT_WEEKS, type PeriodCount } from '../../core/calloffs/views';
import { formatDate, formatQuantity, formatSigned } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadReport } from '../../platform/download';
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

  const periods = useMemo(() => buildPeriods(current, 'week', range), [current, range]);
  const currentRows = useMemo(() => buildCurrentRows(current, previous, items, periods), [current, previous, items, periods]);
  const tree = useMemo(() => summarize(currentRows, master), [currentRows, master]);
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
        out.push([...ITEM_FIELDS.map((f) => p[f] ?? ''), n.items, ...n.values, n.total, n.diff]);
        walk(n.children, p);
      });
    walk(tree, {});
    return {
      fileName: `${t.calloffs.export.fileName}_${ts.fileName}_CW${current.week}-${current.year}`,
      sheetName: ts.tab,
      header: [ts.project, ts.category, ts.side, ts.variant, ts.items, ...periods.map((p) => p.label), t.calloffs.table.total, previous ? `${ts.diff} CW ${previous.week}` : ts.diff],
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
    const sheets = summaryReport(rows, tree, currentRows, periods, master, {
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
      none,
      sheetSummary: tr.sheetSummary,
      sheetItems: tr.sheetItems,
    });
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
                  <tr key={n.key} className={`summary-level-${n.level}`}>
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
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-col">{t.calloffs.table.sum}</td>
                  {totals.map((v, k) => (
                    <td key={periods[k]!.start} className="n">
                      {formatQuantity(v, locale)}
                    </td>
                  ))}
                  <td className="n">{formatQuantity(total, locale)}</td>
                  <td className="n">{diff === null ? '—' : formatSigned(diff, locale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted">{ts.note}</p>
      </div>
    </div>
  );
}
