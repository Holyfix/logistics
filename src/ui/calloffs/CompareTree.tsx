import { useMemo, useState } from 'react';
import { useCrosshair } from '../useCrosshair';
import type { CompareRow } from '../../core/calloffs/compare';
import { ITEM_FIELDS, type ItemField } from '../../core/calloffs/filter';
import { summarize, visibleNodes, type SummaryNode } from '../../core/calloffs/summary';
import { changeOf, type Period } from '../../core/calloffs/views';
import { formatPercent, formatQuantity, formatSigned } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from './ExportButtons';

type View = 'total' | 'weeks';

interface Props {
  rows: readonly CompareRow[];
  periods: readonly Period[];
  master: ReadonlyMap<string, MasterItem> | undefined;
  labelA: string;
  labelB: string;
  fileBase: string;
}

/**
 * Porovnání dvou exportů po projektech: stejný strom Projekt → Kategorie → Strana → Varianta jako v Přehledu po
 * projektech, u každého uzlu součet staršího a novějšího exportu, rozdíl a změna v %, nebo rozdíl po týdnech.
 */
export function CompareTree({ rows, periods, master, labelA, labelB, fileBase }: Props) {
  const { t, locale } = useI18n();
  const tc = t.calloffs.compare;
  const ts = t.calloffs.summary;
  const [view, setView] = useState<View>('total');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const crosshair = useCrosshair();

  // Novější export jako „aktuální“ a starší jako „předchozí“: strom pak nese oba součty i rozdíl.
  const tree = useMemo(
    () => summarize(rows.map((r) => ({ item: r.item, description: r.description, values: r.newer, previous: r.older, total: r.newerTotal })), master),
    [rows, master],
  );
  const all = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: readonly SummaryNode[]) => nodes.forEach((n) => n.children.length && (keys.push(n.key), walk(n.children)));
    walk(tree);
    return keys;
  }, [tree]);
  const expanded = new Set(all.filter((k) => !collapsed.has(k)));
  const shown = visibleNodes(tree, expanded);

  const none: Record<ItemField, string> = { project: ts.noProject, category: ts.noCategory, side: ts.noSide, variant: ts.noVariant };
  const label = (n: SummaryNode) => n.label || none[n.field];
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // Sbalí uzly zvoleného údaje a hlubší (např. „Kategorie“ = vidět projekty a jejich kategorie).
  const collapseTo = (field: ItemField) => {
    const from = ITEM_FIELDS.indexOf(field);
    const keys: string[] = [];
    const walk = (nodes: readonly SummaryNode[]) => nodes.forEach((n) => (ITEM_FIELDS.indexOf(n.field) >= from && n.children.length ? keys.push(n.key) : null, walk(n.children)));
    walk(tree);
    setCollapsed(new Set(keys));
  };

  const older = (n: SummaryNode) => n.previousTotal ?? 0;
  const diffOf = (n: SummaryNode) => n.total - older(n);
  const pct = (a: number, b: number) => (a === 0 ? null : ((b - a) / a) * 100);
  const pctText = (value: number | null) => (value === null ? '—' : formatPercent(value, locale, true));
  const diffSpan = (d: number) => (d === 0 ? <span className="muted">0</span> : <span className={d > 0 ? 'delta-up' : 'delta-down'}>{formatSigned(d, locale)}</span>);
  const weekDiff = (n: SummaryNode, k: number) => n.values[k]! - (n.previousValues?.[k] ?? 0);
  const sumOlder = tree.reduce((s, n) => s + older(n), 0);
  const sumNewer = tree.reduce((s, n) => s + n.total, 0);
  const sumWeeks = periods.map((_, k) => tree.reduce((s, n) => s + weekDiff(n, k), 0));

  const buildExport = (): ExportTable => {
    const out: (string | number | null)[][] = [];
    const walk = (nodes: readonly SummaryNode[], path: Partial<Record<ItemField, string>>) =>
      nodes.forEach((n) => {
        const p = { ...path, [n.field]: label(n) };
        const fields = ITEM_FIELDS.map((f) => p[f] ?? '');
        const pc = pct(older(n), n.total);
        out.push(
          view === 'total'
            ? [...fields, n.items, older(n), n.total, diffOf(n), pc === null ? null : Math.round(pc * 10) / 10]
            : [...fields, n.items, ...periods.map((_, k) => weekDiff(n, k)), diffOf(n)],
        );
        walk(n.children, p);
      });
    walk(tree, {});
    return {
      fileName: `${fileBase}_${tc.projectsFileName}`,
      sheetName: tc.projectsHeading,
      header: [ts.project, ts.category, ts.side, ts.variant, ts.items, ...(view === 'total' ? [labelA, labelB, tc.difference, `${tc.change} %`] : [...periods.map((p) => p.label), t.calloffs.table.total])],
      rows: out,
    };
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tc.projectsHeading}</h2>
        <span className="muted">
          {labelB} vs {labelA}, {t.calloffs.table.unit}
        </span>
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
        <span className="segmented" role="group" aria-label={`${tc.view}: ${tc.projectsHeading}`}>
          {(['total', 'weeks'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'total' ? tc.viewTotal : tc.viewWeeks}
            </button>
          ))}
        </span>
        <ExportButtons build={buildExport} />
      </div>
      {tree.length === 0 ? (
        <p>{t.calloffs.table.empty}</p>
      ) : (
        <div className="table-scroll table-tall">
          <table className="table table-data summary-tree" aria-label={tc.projectsHeading} {...crosshair.tableProps}>
            <thead>
              <tr>
                <th className="sticky-col">{ts.tree}</th>
                {view === 'total' ? (
                  <>
                    <th className="n">{labelA}</th>
                    <th className="n">{labelB}</th>
                    <th className="n">{tc.difference}</th>
                    <th className="n">{tc.change}</th>
                  </>
                ) : (
                  <>
                    {periods.map((p) => (
                      <th key={p.start} className="n">
                        {p.label}
                      </th>
                    ))}
                    <th className="n">{t.calloffs.table.total}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((n) => (
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
                      <small className="muted">
                        {' '}
                        · {formatQuantity(n.items, locale)} {ts.parts}
                      </small>
                    </span>
                  </td>
                  {view === 'total' ? (
                    <>
                      <td className="n">{formatQuantity(older(n), locale)}</td>
                      <td className="n">{formatQuantity(n.total, locale)}</td>
                      <td className="n">
                        <strong>{diffSpan(diffOf(n))}</strong>
                      </td>
                      <td className="n">{pctText(pct(older(n), n.total))}</td>
                    </>
                  ) : (
                    <>
                      {periods.map((p, k) => {
                        const a = n.previousValues?.[k] ?? 0;
                        const b = n.values[k]!;
                        return (
                          <td key={p.start} className={`n${changeOf(b, a)?.significant ? ' cell-changed' : ''}`} title={`${labelA}: ${formatQuantity(a, locale)}\n${labelB}: ${formatQuantity(b, locale)}`}>
                            {diffSpan(b - a)}
                          </td>
                        );
                      })}
                      <td className="n">
                        <strong>{diffSpan(diffOf(n))}</strong>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">{t.calloffs.table.sum}</td>
                {view === 'total' ? (
                  <>
                    <td className="n">{formatQuantity(sumOlder, locale)}</td>
                    <td className="n">{formatQuantity(sumNewer, locale)}</td>
                    <td className="n">{formatSigned(sumNewer - sumOlder, locale)}</td>
                    <td className="n">{pctText(pct(sumOlder, sumNewer))}</td>
                  </>
                ) : (
                  <>
                    {sumWeeks.map((v, k) => (
                      <td key={periods[k]!.start} className="n">
                        {formatSigned(v, locale)}
                      </td>
                    ))}
                    <td className="n">{formatSigned(sumNewer - sumOlder, locale)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="muted">{tc.projectsNote}</p>
    </div>
  );
}
