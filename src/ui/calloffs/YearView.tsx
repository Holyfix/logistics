import { useMemo, useState } from 'react';
import { filterItems, type ItemFilter } from '../../core/calloffs/filter';
import type { CallOffExport } from '../../core/calloffs/parse';
import { buildYearRows, buildYearWeeks, exportYears, fulfillment, yearItems, yearTotals, type YearRow, type YearWeek } from '../../core/calloffs/year';
import { formatQuantity, type Locale } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { BarLineChart } from '../charts/BarLineChart';
import { ExportButtons, type ExportTable } from './ExportButtons';

type Mode = 'demand' | 'shipped' | 'difference';

const OUTLOOK_WEEKS = 12;

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

  const allWeeks = useMemo(() => buildYearWeeks(exports, year, year === years[0] ? OUTLOOK_WEEKS : 0), [exports, year, years]);
  const weeks = useMemo(() => allWeeks.filter((w) => !w.outlook), [allWeeks]);
  const rows = useMemo(() => {
    const union = yearItems(allWeeks);
    const items = filterItems(union.items, union.descriptions, master, filter);
    const descriptions = new Map(union.items.map((item, i) => [item, union.descriptions[i]!]));
    return buildYearRows(
      allWeeks,
      items,
      items.map((item) => descriptions.get(item)!),
    );
  }, [allWeeks, master, filter]);

  const n = weeks.length;
  const chartTotals = useMemo(() => yearTotals(allWeeks, rows), [allWeeks, rows]);
  const demandW = chartTotals.demand.slice(0, n);
  const shippedW = chartTotals.shipped.slice(0, n);
  // Díly bez požadavku i odeslání v roce se nezobrazují.
  const itemRows = rows.filter((r) => r.demand.slice(0, n).some((v) => v !== 0) || r.shipped.slice(0, n).some((v) => v));

  const shippedWeeks = weeks.filter((w) => w.shipped);
  const lastShipped = shippedWeeks.at(-1);
  const knownDemand = sum(demandW.map((d, k) => (shippedW[k] === null ? 0 : d)));
  const totalShipped = sum(shippedW);
  const ownCount = weeks.filter((w) => w.own).length;
  const missingWeeks = weeks.filter((w) => !w.own);

  const weekHead = (w: YearWeek) => (w.own ? w.label : `${w.label}*`);
  const weekTitle = (w: YearWeek) => (w.own ? undefined : w.source ? `${ty.fromExport} CW ${w.source.week}/${w.source.year}` : undefined);
  const range = (list: readonly YearWeek[]) => (list.length ? `CW ${list[0]!.week}–${list.at(-1)!.week}/${year}` : '');
  const modeLabel = { demand: ty.demand, shipped: ty.shipped, difference: ty.difference };

  const cell = (m: Mode, demand: number, shipped: number | null) => {
    const v = valueOf(m, demand, shipped);
    if (v === null) return <span className="muted">—</span>;
    if (m === 'difference') return v === 0 ? <span className="muted">0</span> : <span className={v > 0 ? 'delta-up' : 'delta-down'}>{signed(v, locale)}</span>;
    return v ? formatQuantity(v, locale) : <span className="muted">0</span>;
  };

  const rowTotal = (r: YearRow) => {
    if (mode === 'demand') return sum(r.demand.slice(0, n));
    const values = r.shipped.slice(0, n).map((s, k) => valueOf(mode, r.demand[k]!, s));
    return values.every((v) => v === null) ? null : sum(values);
  };

  const fileBase = `${ty.fileName}_${year}`;

  const buildSummaryExport = (): ExportTable => ({
    fileName: `${fileBase}_${t.calloffs.year.week.toLowerCase()}`,
    sheetName: String(year),
    header: [ty.week, ...weeks.map((w) => w.label), t.calloffs.table.total],
    rows: [
      [ty.demand, ...demandW, sum(demandW)],
      [ty.shipped, ...shippedW, totalShipped],
      [ty.difference, ...shippedW.map((s, k) => (s === null ? null : s - demandW[k]!)), totalShipped - knownDemand],
      [`${ty.fulfillment} %`, ...shippedW.map((s, k) => round1(fulfillment([demandW[k]!], [s]))), round1(fulfillment(demandW, shippedW))],
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
      ...weeks.map((w) => w.label),
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

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">
            {ty.demand} {range(weeks)}
          </span>
          <span className="kpi-value">{formatQuantity(sum(demandW), locale)}</span>
          <span className="kpi-note">{ty.demandNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">
            {ty.shipped} {range(shippedWeeks)}
          </span>
          <span className="kpi-value">{lastShipped ? formatQuantity(totalShipped, locale) : '—'}</span>
          <span className="kpi-note">{ty.shippedNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ty.fulfillment}</span>
          <span className="kpi-value">{percent(fulfillment(demandW, shippedW), locale)}</span>
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
            categories={allWeeks.map((w) => w.label)}
            bars={chartTotals.demand}
            line={chartTotals.shipped}
            barName={ty.demand}
            lineName={ty.shipped}
            format={(v) => formatQuantity(v, locale)}
            {...(allWeeks.length > n ? { region: { from: n, label: ty.outlook } } : {})}
          />
        </div>
        <div className="table-scroll">
          <table className="table table-data table-auto">
            <thead>
              <tr>
                <th className="sticky-col">{ty.week}</th>
                {weeks.map((w) => (
                  <th key={w.start} className="n" title={weekTitle(w)}>
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
                    <td key={w.start} className="n">
                      {cell(m, demandW[k]!, shippedW[k]!)}
                    </td>
                  ))}
                  <td className="n">
                    <strong>{cell(m, m === 'demand' ? sum(demandW) : knownDemand, lastShipped ? totalShipped : null)}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="sticky-col">{ty.fulfillment}</td>
                {weeks.map((w, k) => (
                  <td key={w.start} className="n">
                    {percent(fulfillment([demandW[k]!], [shippedW[k]!]), locale)}
                  </td>
                ))}
                <td className="n">
                  <strong>{percent(fulfillment(demandW, shippedW), locale)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ty.itemsHeading}</h2>
          <span className="muted">
            {range(weeks)}, {t.calloffs.table.unit} · {formatQuantity(itemRows.length, locale)} {ty.itemsNote}
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
                    <th key={w.start} className="n" title={weekTitle(w)}>
                      {weekHead(w)}
                    </th>
                  ))}
                  <th className="n">{t.calloffs.table.total}</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map((r) => {
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
                        const title = `${ty.demand}: ${formatQuantity(r.demand[k]!, locale)}\n${ty.shipped}: ${shipped === null ? '—' : formatQuantity(shipped, locale)}`;
                        return (
                          <td key={w.start} className="n" title={title}>
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
        <p className="muted">{ty.note}</p>
      </div>
    </div>
  );
}
