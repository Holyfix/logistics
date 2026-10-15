import { useMemo, useState, type ReactNode } from 'react';
import type { CallOffExport } from '../../core/calloffs/parse';
import { summarize, visibleNodes, type SummaryNode } from '../../core/calloffs/summary';
import { buildCurrentRows, buildPeriods, DEFAULT_WEEKS, type PeriodCount } from '../../core/calloffs/views';
import { formatQuantity, formatSigned } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from './ExportButtons';

const RANGES: PeriodCount[] = [12, 26, 52, 'all'];

interface Props {
  current: CallOffExport;
  previous: CallOffExport | undefined;
  items: string[];
  master: ReadonlyMap<string, MasterItem> | undefined;
  filters: ReactNode;
}

/** Přehled po projektech: Projekt → Kategorie → Strana se součty odvolávek po týdnech. */
export function SummaryView({ current, previous, items, master, filters }: Props) {
  const { t, locale } = useI18n();
  const ts = t.calloffs.summary;
  const [range, setRange] = useState<PeriodCount>(DEFAULT_WEEKS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const periods = useMemo(() => buildPeriods(current, 'week', range), [current, range]);
  const tree = useMemo(() => summarize(buildCurrentRows(current, previous, items, periods), master), [current, previous, items, periods, master]);
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
  const backlog = tree.reduce((s, n) => s + n.backlog, 0);
  const diff = previous ? tree.reduce((s, n) => s + (n.diff ?? 0), 0) : null;

  const none = [ts.noProject, ts.noCategory, ts.noSide];
  const label = (n: SummaryNode) => n.label || none[n.level]!;
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const collapseTo = (level: number) => {
    const keys: string[] = [];
    const walk = (nodes: readonly SummaryNode[]) => nodes.forEach((n) => (n.level >= level && n.children.length ? keys.push(n.key) : null, walk(n.children)));
    walk(tree);
    setCollapsed(new Set(keys));
  };

  const buildExport = (): ExportTable => {
    const out: (string | number | null)[][] = [];
    const walk = (nodes: readonly SummaryNode[], path: string[]) =>
      nodes.forEach((n) => {
        const p = [...path, label(n)];
        out.push([p[0] ?? '', n.level >= 1 ? (p[1] ?? '') : '', n.level >= 2 ? (p[2] ?? '') : '', n.items, n.backlog, ...n.values, n.total, n.diff]);
        walk(n.children, p);
      });
    walk(tree, []);
    return {
      fileName: `${t.calloffs.export.fileName}_${ts.fileName}_CW${current.week}-${current.year}`,
      sheetName: ts.tab,
      header: [ts.project, ts.category, ts.side, ts.items, t.calloffs.table.backlog, ...periods.map((p) => p.label), t.calloffs.table.total, previous ? `${ts.diff} CW ${previous.week}` : ts.diff],
      rows: out,
    };
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
            <button type="button" onClick={() => collapseTo(0)}>
              {ts.depthProjects}
            </button>
            <button type="button" onClick={() => collapseTo(1)}>
              {ts.depthCategories}
            </button>
            <button type="button" onClick={() => setCollapsed(new Set())}>
              {ts.depthSides}
            </button>
          </span>
          <ExportButtons build={buildExport} />
        </div>
        {tree.length === 0 ? (
          <p>{t.calloffs.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data summary-tree">
              <thead>
                <tr>
                  <th className="sticky-col">{ts.tree}</th>
                  <th className="n">{t.calloffs.table.backlog}</th>
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
                    <td className="n">{n.backlog ? formatQuantity(n.backlog, locale) : <span className="muted">—</span>}</td>
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
                  <td className="n">{formatQuantity(backlog, locale)}</td>
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
