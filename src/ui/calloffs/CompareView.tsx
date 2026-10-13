import { useMemo, useState, type ReactNode } from 'react';
import { buildCompareRows, buildMatrix, compareItems, comparePeriods, type CompareRow } from '../../core/calloffs/compare';
import { filterItems, type ItemFilter } from '../../core/calloffs/filter';
import type { CallOffExport } from '../../core/calloffs/parse';
import { changeOf, type PeriodCount } from '../../core/calloffs/views';
import { formatPercent, formatQuantity, formatSigned } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from './ExportButtons';

const RANGES: PeriodCount[] = [12, 26, 'all'];
/** Od jaké změny proti předchozímu exportu se buňka matice zvýrazní (v %). */
const MATRIX_THRESHOLD = 5;

type ItemView = 'total' | 'weeks';

const exportName = (e: CallOffExport) => `CW ${e.week}/${e.year}`;

interface Props {
  exports: readonly CallOffExport[];
  filter: ItemFilter;
  master: ReadonlyMap<string, MasterItem> | undefined;
  /** Filtry dílů; zobrazí se pod výběrem exportů. */
  filters: ReactNode;
}

export function CompareView({ exports, filter, master, filters }: Props) {
  const { t, locale } = useI18n();
  const tc = t.calloffs.compare;
  const [olderDay, setOlderDay] = useState(exports.at(-2)?.exportDay);
  const [newerDay, setNewerDay] = useState(exports.at(-1)?.exportDay);
  const [range, setRange] = useState<PeriodCount>(12);
  const [view, setView] = useState<ItemView>('total');
  const [onlyChanged, setOnlyChanged] = useState(true);

  // Výběr se vždy srovná tak, aby starší byl opravdu starší.
  // Po novém načtení složky nemusí vybraný export existovat; pak platí výchozí dvojice.
  const picked = [exports.find((e) => e.exportDay === olderDay) ?? exports.at(-2), exports.find((e) => e.exportDay === newerDay) ?? exports.at(-1)];
  const [older, newer] = picked[0] && picked[1] && picked[0].exportDay > picked[1].exportDay ? [picked[1], picked[0]] : picked;

  const periods = useMemo(() => (older && newer && older !== newer ? comparePeriods(older, newer, range) : []), [older, newer, range]);
  const items = useMemo(() => {
    if (!older || !newer) return { items: [], descriptions: [] };
    const union = compareItems(older, newer);
    const filtered = filterItems(union.items, union.descriptions, master, filter);
    const descriptions = new Map(union.items.map((item, i) => [item, union.descriptions[i]!]));
    return { items: filtered, descriptions: filtered.map((item) => descriptions.get(item)!) };
  }, [older, newer, master, filter]);
  const rows = useMemo(
    () => (older && newer && periods.length ? buildCompareRows(older, newer, items.items, items.descriptions, periods) : []),
    [older, newer, items, periods],
  );
  const matrix = useMemo(() => (newer ? buildMatrix(exports, newer, items.items) : null), [exports, newer, items]);

  if (exports.length < 2) {
    return (
      <div className="panel">
        <p>{tc.onlyOne}</p>
      </div>
    );
  }

  const exportSelect = (label: string, value: number | undefined, onChange: (day: number) => void) => (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[...exports].reverse().map((e) => (
          <option key={e.exportDay} value={e.exportDay}>
            {exportName(e)} ({e.fileName})
          </option>
        ))}
      </select>
    </label>
  );

  const selection = (
    <div className="filters" role="group" aria-label={t.calloffs.tabs.compare}>
      {exportSelect(tc.older, picked[0]?.exportDay, setOlderDay)}
      {exportSelect(tc.newer, picked[1]?.exportDay, setNewerDay)}
      <label className="field">
        <span>{t.calloffs.range.label}</span>
        <select value={String(range)} onChange={(e) => setRange(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          {RANGES.map((r) => (
            <option key={r} value={String(r)}>
              {r === 'all' ? t.calloffs.range.all : `${r} ${t.calloffs.range.weeks}`}
            </option>
          ))}
        </select>
      </label>
      {periods.length > 0 && (
        <p className="muted filters-note">
          {tc.weeksNote}: {periods[0]!.label} – {periods.at(-1)!.label}.
        </p>
      )}
    </div>
  );

  if (!older || !newer || older === newer || periods.length === 0) {
    return (
      <div className="stack">
        {selection}
        {filters}
        <div className="panel">
          <p>{older === newer ? tc.same : tc.noOverlap}</p>
        </div>
      </div>
    );
  }

  const olderTotals = periods.map((_, k) => rows.reduce((s, r) => s + r.older[k]!, 0));
  const newerTotals = periods.map((_, k) => rows.reduce((s, r) => s + r.newer[k]!, 0));
  const olderSum = olderTotals.reduce((a, b) => a + b, 0);
  const newerSum = newerTotals.reduce((a, b) => a + b, 0);
  // Změněný díl: v zobrazení Součet má nenulový rozdíl součtu, po týdnech změnu aspoň v jednom týdnu.
  const changedInWeeks = rows.filter((r) => r.older.some((v, k) => v !== r.newer[k]));
  const changed = view === 'total' ? rows.filter((r) => r.diff !== 0) : changedInWeeks;
  const shownRows = onlyChanged ? changed : rows;
  const pct = (a: number, b: number) => (a === 0 ? null : ((b - a) / a) * 100);
  const pctText = (value: number | null) => (value === null ? '—' : formatPercent(value, locale, true));
  const diffSpan = (d: number) => (d === 0 ? <span className="muted">0</span> : <span className={d > 0 ? 'delta-up' : 'delta-down'}>{formatSigned(d, locale)}</span>);
  const labelA = exportName(older);
  const labelB = exportName(newer);
  const fileBase = `${tc.fileName}_CW${older.week}-${older.year}_CW${newer.week}-${newer.year}`;
  const masterCols = (item: string) => {
    const m = master?.get(item);
    return [m?.customer ?? '', m?.project ?? '', m?.side ?? ''];
  };

  const buildSummaryExport = (): ExportTable => ({
    fileName: `${fileBase}_${tc.week.toLowerCase()}`,
    sheetName: `${labelB} vs ${labelA}`.replace(/\//g, '-'),
    header: [tc.week, ...periods.map((p) => p.label), t.calloffs.table.total],
    rows: [
      [labelA, ...olderTotals, olderSum],
      [labelB, ...newerTotals, newerSum],
      [tc.difference, ...newerTotals.map((v, k) => v - olderTotals[k]!), newerSum - olderSum],
      [`${tc.change} %`, ...newerTotals.map((v, k) => round1(pct(olderTotals[k]!, v))), round1(pct(olderSum, newerSum))],
    ],
  });

  const itemHeader = [t.calloffs.table.item, t.calloffs.table.description, t.calloffs.table.customer, t.calloffs.table.project, t.calloffs.table.side];
  const buildItemsExport = (): ExportTable =>
    view === 'total'
      ? {
          fileName: `${fileBase}_${tc.viewTotal.toLowerCase()}`,
          sheetName: tc.viewTotal,
          header: [...itemHeader, labelA, labelB, tc.difference, `${tc.change} %`],
          rows: shownRows.map((r) => [r.item, r.description, ...masterCols(r.item), r.olderTotal, r.newerTotal, r.diff, round1(r.percent)]),
        }
      : {
          fileName: `${fileBase}_${tc.difference.toLowerCase()}`,
          sheetName: tc.viewWeeks,
          header: [...itemHeader, ...periods.map((p) => p.label), t.calloffs.table.total],
          rows: shownRows.map((r) => [r.item, r.description, ...masterCols(r.item), ...r.newer.map((v, k) => v - r.older[k]!), r.diff]),
        };

  const buildMatrixExport = (): ExportTable => ({
    fileName: `${tc.matrixFileName}_CW${newer.week}-${newer.year}`,
    sheetName: tc.matrixHeading,
    header: [tc.exportRow, ...matrix!.periods.map((p) => p.label)],
    rows: matrix!.exports.map((e, i) => [exportName(e), ...matrix!.values[i]!]),
  });

  const itemCell = (r: CompareRow, k: number) => {
    const a = r.older[k]!;
    const b = r.newer[k]!;
    const change = changeOf(b, a);
    return (
      <td key={periods[k]!.start} className={`n${change?.significant ? ' cell-changed' : ''}`} title={`${labelA}: ${formatQuantity(a, locale)}\n${labelB}: ${formatQuantity(b, locale)}`}>
        {diffSpan(b - a)}
      </td>
    );
  };

  return (
    <div className="stack">
      {selection}
      {filters}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{labelA}</span>
          <span className="kpi-value">{formatQuantity(olderSum, locale)}</span>
          <span className="kpi-note">
            {t.calloffs.table.unit}, {periods[0]!.label} – {periods.at(-1)!.label}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{labelB}</span>
          <span className="kpi-value">{formatQuantity(newerSum, locale)}</span>
          <span className="kpi-note">
            {t.calloffs.table.unit}, {periods[0]!.label} – {periods.at(-1)!.label}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpiDiff}</span>
          <span className="kpi-value">{formatSigned(newerSum - olderSum, locale)}</span>
          <span className="kpi-note">{pctText(pct(olderSum, newerSum))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpiItems}</span>
          <span className="kpi-value">{formatQuantity(changedInWeeks.length, locale)}</span>
          <span className="kpi-note">
            {tc.kpiItemsNote} ({formatQuantity(rows.length, locale)})
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.summaryHeading}</h2>
          <span className="muted">{t.calloffs.table.unit}</span>
          <span className="panel-actions">
            <ExportButtons build={buildSummaryExport} />
          </span>
        </div>
        <div className="table-scroll">
          <table className="table table-data">
            <thead>
              <tr>
                <th className="sticky-col">{tc.week}</th>
                {periods.map((p) => (
                  <th key={p.start} className="n">
                    {p.label}
                  </th>
                ))}
                <th className="n">{t.calloffs.table.total}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky-col">{labelA}</td>
                {olderTotals.map((v, k) => (
                  <td key={periods[k]!.start} className="n">
                    {formatQuantity(v, locale)}
                  </td>
                ))}
                <td className="n">
                  <strong>{formatQuantity(olderSum, locale)}</strong>
                </td>
              </tr>
              <tr>
                <td className="sticky-col">{labelB}</td>
                {newerTotals.map((v, k) => (
                  <td key={periods[k]!.start} className="n">
                    {formatQuantity(v, locale)}
                  </td>
                ))}
                <td className="n">
                  <strong>{formatQuantity(newerSum, locale)}</strong>
                </td>
              </tr>
              <tr>
                <td className="sticky-col">{tc.difference}</td>
                {newerTotals.map((v, k) => (
                  <td key={periods[k]!.start} className="n">
                    {diffSpan(v - olderTotals[k]!)}
                  </td>
                ))}
                <td className="n">
                  <strong>{diffSpan(newerSum - olderSum)}</strong>
                </td>
              </tr>
              <tr>
                <td className="sticky-col">{tc.change}</td>
                {newerTotals.map((v, k) => (
                  <td key={periods[k]!.start} className="n">
                    {pctText(pct(olderTotals[k]!, v))}
                  </td>
                ))}
                <td className="n">
                  <strong>{pctText(pct(olderSum, newerSum))}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.itemsHeading}</h2>
          <span className="muted">
            {tc.itemsNote}, {t.calloffs.table.unit}
          </span>
          <label className="check-field panel-actions">
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
            {tc.onlyChanged} ({formatQuantity(changed.length, locale)} {tc.of} {formatQuantity(rows.length, locale)})
          </label>
          <span className="segmented" role="group" aria-label={tc.view}>
            {(['total', 'weeks'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'total' ? tc.viewTotal : tc.viewWeeks}
              </button>
            ))}
          </span>
          <ExportButtons build={buildItemsExport} />
        </div>
        {shownRows.length === 0 ? (
          <p>{rows.length > 0 ? tc.noChanges : t.calloffs.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data">
              <thead>
                <tr>
                  <th className="sticky-col">{t.calloffs.table.item}</th>
                  <th>{t.calloffs.table.description}</th>
                  <th>{t.calloffs.table.project}</th>
                  <th>{t.calloffs.table.side}</th>
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
                {shownRows.map((r) => {
                  const m = master?.get(r.item);
                  return (
                    <tr key={r.item}>
                      <td className="sticky-col">
                        <strong>{r.item}</strong>
                      </td>
                      <td className="desc">{r.description}</td>
                      <td>{m?.project ?? '—'}</td>
                      <td>{m?.side ? <span className="chip">{m.side}</span> : '—'}</td>
                      {view === 'total' ? (
                        <>
                          <td className="n">{formatQuantity(r.olderTotal, locale)}</td>
                          <td className="n">{formatQuantity(r.newerTotal, locale)}</td>
                          <td className="n">
                            <strong>{diffSpan(r.diff)}</strong>
                          </td>
                          <td className="n">{pctText(r.percent)}</td>
                        </>
                      ) : (
                        <>
                          {periods.map((_, k) => itemCell(r, k))}
                          <td className="n">
                            <strong>{diffSpan(r.diff)}</strong>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {matrix && (
        <div className="panel">
          <div className="panel-head">
            <h2>{tc.matrixHeading}</h2>
            <span className="muted">{tc.matrixSub}</span>
            <span className="panel-actions">
              <ExportButtons build={buildMatrixExport} />
            </span>
          </div>
          <p className="muted">{tc.matrixHelp}</p>
          <div className="table-scroll">
            <table className="table table-data">
              <thead>
                <tr>
                  <th className="sticky-col">{tc.exportRow}</th>
                  {matrix.periods.map((p) => (
                    <th key={p.start} className="n">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.exports.map((e, i) => (
                  <tr key={e.exportDay}>
                    <td className="sticky-col">
                      <strong>{exportName(e)}</strong>
                    </td>
                    {matrix.values[i]!.map((v, k) => {
                      const key = matrix.periods[k]!.start;
                      if (v === null)
                        return (
                          <td key={key} className="n muted">
                            ·
                          </td>
                        );
                      const prev = i > 0 ? matrix.values[i - 1]![k]! : null;
                      const change = changeOf(v, prev, MATRIX_THRESHOLD);
                      const prevName = i > 0 ? exportName(matrix.exports[i - 1]!) : '';
                      const title = change ? `${prevName}: ${formatQuantity(prev!, locale)} → ${formatSigned(change.diff, locale)}` : undefined;
                      return (
                        <td key={key} className={`n${change?.significant ? ' cell-changed' : ''}`} title={title}>
                          {formatQuantity(v, locale)}
                          {change?.significant && (
                            <span className={`delta ${change.diff > 0 ? 'delta-up' : 'delta-down'}`}>
                              {change.diff > 0 ? '▲' : '▼'} {change.percent === null ? formatSigned(change.diff, locale) : formatPercent(change.percent, locale, true)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
