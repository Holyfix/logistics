import { useMemo, useState } from 'react';
import { filterItems, type ItemFilter } from '../../core/calloffs/filter';
import type { CallOffExport } from '../../core/calloffs/parse';
import {
  buildYearRows,
  buildYearWeeks,
  exportYears,
  fulfillment,
  yearItems,
  yearTotals,
  type Outlook,
  type YearRow,
  type YearWeek,
} from '../../core/calloffs/year';
import { formatQuantity, type Locale } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { BarLineChart } from '../charts/BarLineChart';
import { ExportButtons, type ExportTable } from './ExportButtons';
import { MoreRows, useRowLimit } from './MoreRows';

type Mode = 'demand' | 'shipped' | 'difference';

const OUTLOOKS: Outlook[] = ['year', 'all', 'none'];

function signed(value: number, locale: Locale): string {
  const abs = formatQuantity(Math.abs(value), locale);
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs;
}

function percent(value: number | null, locale: Locale): string {
  if (value === null) return '—';
  return `${value.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 1 })} %`;
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** Hodnota buňky podle režimu; null, když ji nejde spočítat. */
function valueOf(mode: Mode, demand: number, shipped: number | null): number | null {
  if (mode === 'demand') return demand;
  if (shipped === null) return null;
  return mode === 'shipped' ? shipped : shipped - demand;
}

/** Rozsah týdnů, např. „CW 40–53/2026“ nebo „CW 43/2026 – CW 16/2028“. */
function rangeOf(list: readonly YearWeek[]): string {
  const a = list[0];
  const b = list.at(-1);
  if (!a || !b) return '';
  return a.year === b.year ? `CW ${a.week}–${b.week}/${b.year}` : `CW ${a.week}/${a.year} – CW ${b.week}/${b.year}`;
}

interface Props {
  exports: readonly CallOffExport[];
  filter: ItemFilter;
  master: ReadonlyMap<string, MasterItem> | undefined;
}

export function YearView({ exports, filter, master }: Props) {
  const { t, locale } = useI18n();
  const ty = t.calloffs.year;
  const years = useMemo(() => exportYears(exports), [exports]);
  const [selectedYear, setYear] = useState(years[0]!);
  const year = years.includes(selectedYear) ? selectedYear : years[0]!;
  const [mode, setMode] = useState<Mode>('demand');
  const [outlook, setOutlook] = useState<Outlook>('year');
  const [limit, setLimit] = useRowLimit();
  // Výhled má smysl jen za posledním exportem, tedy v nejnovějším roce.
  const hasOutlook = year === years[0];

  const weeks = useMemo(() => buildYearWeeks(exports, year, hasOutlook ? outlook : 'none'), [exports, year, hasOutlook, outlook]);
  const rows = useMemo(() => {
    const union = yearItems(weeks);
    const items = filterItems(union.items, union.descriptions, master, filter);
    const descriptions = new Map(union.items.map((item, i) => [item, union.descriptions[i]!]));
    return buildYearRows(
      weeks,
      items,
      items.map((item) => descriptions.get(item)!),
    );
  }, [weeks, master, filter]);

  const totals = useMemo(() => yearTotals(weeks, rows), [weeks, rows]);
  // Díly bez požadavku i odeslání v zobrazených týdnech se nezobrazují.
  const itemRows = useMemo(() => rows.filter((r) => r.demand.some((v) => v !== 0) || r.shipped.some((v) => v)), [rows]);

  const pastWeeks = weeks.filter((w) => !w.outlook);
  const outlookWeeks = weeks.filter((w) => w.outlook);
  const n = pastWeeks.length;
  const pastDemand = totals.demand.slice(0, n);
  const outlookDemand = sum(totals.demand.slice(n));
  const shippedWeeks = weeks.filter((w) => w.shipped);
  const knownDemand = sum(totals.demand.map((d, k) => (totals.shipped[k] === null ? 0 : d)));
  const totalShipped = sum(totals.shipped);
  const ownCount = pastWeeks.filter((w) => w.own).length;
  const missingWeeks = pastWeeks.filter((w) => !w.own);
  const latest = pastWeeks.at(-1)?.source;

  const colClass = (w: YearWeek) => (w.outlook ? 'n col-outlook' : 'n');
  const weekHead = (w: YearWeek) => (w.own || w.outlook ? w.label : `${w.label}*`);
  const weekTitle = (w: YearWeek) => {
    if (w.own || !w.source) return undefined;
    return `${w.outlook ? ty.outlookTitle : ty.fromExport} CW ${w.source.week}/${w.source.year}`;
  };
  const exportHead = (w: YearWeek) => (w.outlook ? `${w.label} (${ty.outlookLabel.toLowerCase()})` : w.label);
  const modeLabel = { demand: ty.demand, shipped: ty.shipped, difference: ty.difference };

  const cell = (m: Mode, demand: number, shipped: number | null) => {
    const v = valueOf(m, demand, shipped);
    if (v === null) return <span className="muted">—</span>;
    if (m === 'difference') return v === 0 ? <span className="muted">0</span> : <span className={v > 0 ? 'delta-up' : 'delta-down'}>{signed(v, locale)}</span>;
    return v ? formatQuantity(v, locale) : <span className="muted">0</span>;
  };

  const rowTotal = (r: YearRow) => {
    if (mode === 'demand') return sum(r.demand);
    const values = r.shipped.map((s, k) => valueOf(mode, r.demand[k]!, s));
    return values.every((v) => v === null) ? null : sum(values);
  };

  const fileBase = `${ty.fileName}_${year}`;

  const buildSummaryExport = (): ExportTable => ({
    fileName: `${fileBase}_${ty.week.toLowerCase()}`,
    sheetName: String(year),
    header: [ty.week, ...weeks.map(exportHead), t.calloffs.table.total],
    rows: [
      [ty.demand, ...totals.demand, sum(totals.demand)],
      [ty.shipped, ...totals.shipped, totalShipped],
      [ty.difference, ...totals.shipped.map((s, k) => (s === null ? null : s - totals.demand[k]!)), totalShipped - knownDemand],
      [`${ty.fulfillment} %`, ...totals.shipped.map((s, k) => round1(fulfillment([totals.demand[k]!], [s]))), round1(fulfillment(totals.demand, totals.shipped))],
    ],
  });

  const buildItemsExport = (): ExportTable => ({
    fileName: `${fileBase}_${modeLabel[mode].toLowerCase()}`,
    sheetName: `${modeLabel[mode]} ${year}`,
    header: [
      t.calloffs.table.item,
      t.calloffs.table.description,
      t.calloffs.table.customer,
      t.calloffs.table.project,
      t.calloffs.table.side,
      ...weeks.map(exportHead),
      t.calloffs.table.total,
    ],
    rows: itemRows.map((r) => {
      const m = master?.get(r.item);
      return [
        r.item,
        r.description,
        m?.customer ?? '',
        m?.project ?? '',
        m?.side ?? '',
        ...weeks.map((_, k) => valueOf(mode, r.demand[k]!, r.shipped[k]!)),
        rowTotal(r),
      ];
    }),
  });

  return (
    <div className="stack">
      <div className="view-options">
        {years.length > 1 && (
          <label className="inline-field">
            <span>{ty.year}</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
        {hasOutlook && (
          <label className="inline-field">
            <span>{ty.outlookLabel}</span>
            <select value={outlook} onChange={(e) => setOutlook(e.target.value as Outlook)}>
              {OUTLOOKS.map((o) => (
                <option key={o} value={o}>
                  {ty.outlookOptions[o]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">
            {ty.demand} {rangeOf(pastWeeks)}
          </span>
          <span className="kpi-value">{formatQuantity(sum(pastDemand), locale)}</span>
          <span className="kpi-note">{ty.demandNote}</span>
        </div>
        {outlookWeeks.length > 0 && (
          <div className="kpi">
            <span className="kpi-label">
              {ty.outlookLabel} {rangeOf(outlookWeeks)}
            </span>
            <span className="kpi-value">{formatQuantity(outlookDemand, locale)}</span>
            <span className="kpi-note">
              {ty.outlookNote}
              {latest && ` CW ${latest.week}/${latest.year}`}
            </span>
          </div>
        )}
        <div className="kpi">
          <span className="kpi-label">
            {ty.shipped} {rangeOf(shippedWeeks)}
          </span>
          <span className="kpi-value">{shippedWeeks.length ? formatQuantity(totalShipped, locale) : '—'}</span>
          <span className="kpi-note">{ty.shippedNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ty.fulfillment}</span>
          <span className="kpi-value">{percent(fulfillment(totals.demand, totals.shipped), locale)}</span>
          <span className="kpi-note">{ty.fulfillmentNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ty.exports}</span>
          <span className="kpi-value">
            {ownCount} {ty.exportsOf} {n}
          </span>
          <span className="kpi-note">
            {ty.exportsNote}
            {missingWeeks.length > 0 && `. ${ty.missing}: ${missingWeeks.map((w) => w.label).join(', ')}`}
          </span>
        </div>
      </div>

      {exports.length === 1 && <p className="banner">{ty.onlyOne}</p>}

      <div className="panel">
        <div className="panel-head">
          <h2>{ty.chartHeading}</h2>
          <span className="muted">{ty.chartSub}</span>
          <span className="panel-actions">
            <ExportButtons build={buildSummaryExport} />
          </span>
        </div>
        <ul className="legend">
          <li>
            <i className="legend-bar" /> {ty.demand}
          </li>
          <li>
            <i className="legend-line" /> {ty.shipped}
          </li>
        </ul>
        <div className="table-scroll">
          <BarLineChart
            label={ty.chartHeading}
            categories={weeks.map((w) => w.label)}
            bars={totals.demand}
            line={totals.shipped}
            barName={ty.demand}
            lineName={ty.shipped}
            format={(v) => formatQuantity(v, locale)}
            {...(outlookWeeks.length > 0 ? { region: { from: n, label: ty.outlook } } : {})}
          />
        </div>
        <div className="table-scroll">
          <table className={`table table-data${weeks.length < 12 ? ' table-auto' : ''}`}>
            <thead>
              <tr>
                <th className="sticky-col">{ty.week}</th>
                {weeks.map((w) => (
                  <th key={w.start} className={colClass(w)} title={weekTitle(w)}>
                    {weekHead(w)}
                  </th>
                ))}
                <th className="n">{t.calloffs.table.total}</th>
              </tr>
            </thead>
            <tbody>
              {(['demand', 'shipped', 'difference'] as const).map((m) => (
                <tr key={m}>
                  <td className="sticky-col">{modeLabel[m]}</td>
                  {weeks.map((w, k) => (
                    <td key={w.start} className={colClass(w)}>
                      {cell(m, totals.demand[k]!, totals.shipped[k]!)}
                    </td>
                  ))}
                  <td className="n">
                    <strong>{cell(m, m === 'demand' ? sum(totals.demand) : knownDemand, shippedWeeks.length ? totalShipped : null)}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="sticky-col">{ty.fulfillment}</td>
                {weeks.map((w, k) => (
                  <td key={w.start} className={colClass(w)}>
                    {percent(fulfillment([totals.demand[k]!], [totals.shipped[k]!]), locale)}
                  </td>
                ))}
                <td className="n">
                  <strong>{percent(fulfillment(totals.demand, totals.shipped), locale)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {outlookWeeks.length > 0 && <p className="muted">{ty.outlookLegend}</p>}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ty.itemsHeading}</h2>
          <span className="muted">
            {rangeOf(weeks)}, {t.calloffs.table.unit} · {formatQuantity(itemRows.length, locale)} {ty.itemsNote}
          </span>
          <span className="segmented panel-actions" role="group" aria-label={ty.mode}>
            {(['demand', 'shipped', 'difference'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {modeLabel[m]}
              </button>
            ))}
          </span>
          <ExportButtons build={buildItemsExport} />
        </div>
        {itemRows.length === 0 ? (
          <p>{t.calloffs.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data">
              <thead>
                <tr>
                  <th className="sticky-col">{t.calloffs.table.item}</th>
                  <th>{t.calloffs.table.description}</th>
                  <th>{t.calloffs.table.project}</th>
                  <th>{t.calloffs.table.side}</th>
                  {weeks.map((w) => (
                    <th key={w.start} className={colClass(w)} title={weekTitle(w)}>
                      {weekHead(w)}
                    </th>
                  ))}
                  <th className="n">{t.calloffs.table.total}</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.slice(0, limit).map((r) => {
                  const m = master?.get(r.item);
                  const total = rowTotal(r);
                  return (
                    <tr key={r.item}>
                      <td className="sticky-col">
                        <strong>{r.item}</strong>
                      </td>
                      <td className="desc">{r.description}</td>
                      <td>{m?.project ?? '—'}</td>
                      <td>{m?.side ? <span className="chip">{m.side}</span> : '—'}</td>
                      {weeks.map((w, k) => {
                        const shipped = r.shipped[k]!;
                        // Výhled nemá odesláno, popisek by jen opakoval číslo v buňce.
                        const title = w.outlook
                          ? undefined
                          : `${ty.demand}: ${formatQuantity(r.demand[k]!, locale)}\n${ty.shipped}: ${shipped === null ? '—' : formatQuantity(shipped, locale)}`;
                        return (
                          <td key={w.start} className={colClass(w)} title={title}>
                            {cell(mode, r.demand[k]!, shipped)}
                          </td>
                        );
                      })}
                      <td className="n">
                        <strong>{total === null ? '—' : mode === 'difference' ? signed(total, locale) : formatQuantity(total, locale)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <MoreRows shown={Math.min(limit, itemRows.length)} total={itemRows.length} onLimit={setLimit} />
        <p className="muted">
          {ty.note}
          {outlookWeeks.length > 0 && ` ${ty.outlookLegend}`}
        </p>
      </div>
    </div>
  );
}
