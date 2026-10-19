import { useMemo, useState, type ReactNode } from 'react';
import type { CallOffExport } from '../../core/calloffs/parse';
import {
  buildCurrentRows,
  buildPeriods,
  changeOf,
  countSignificantChanges,
  DEFAULT_WEEKS,
  type Granularity,
  type Period,
  type PeriodCount,
} from '../../core/calloffs/views';
import { dayToIso, weekday } from '../../core/dates';
import { formatDayShort, formatQuantity, type Locale } from '../../core/format';
import type { MasterItem } from '../../core/masterdata';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from './ExportButtons';
import { ItemFieldCells, ItemFieldHeaders, itemFieldValues, useItemFieldLabels } from './ItemFields';

const RANGES: Record<Granularity, PeriodCount[]> = { week: [12, 26, 52, 'all'], day: [15, 30, 60] };

function signed(value: number, locale: Locale): string {
  const abs = formatQuantity(Math.abs(value), locale);
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs;
}

interface Props {
  current: CallOffExport;
  previous: CallOffExport | undefined;
  items: string[];
  master: ReadonlyMap<string, MasterItem> | undefined;
  /** Filtry dílů; zobrazí se mezi ukazateli a tabulkou. */
  filters: ReactNode;
}

export function CurrentView({ current, previous, items, master, filters }: Props) {
  const { t, locale } = useI18n();
  const fieldLabels = useItemFieldLabels();
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [range, setRange] = useState<Record<Granularity, PeriodCount>>({ week: DEFAULT_WEEKS, day: 15 });
  const count = range[granularity];

  const periods = useMemo(() => buildPeriods(current, granularity, count), [current, granularity, count]);
  const rows = useMemo(() => buildCurrentRows(current, previous, items, periods), [current, previous, items, periods]);

  const totals = periods.map((_, k) => rows.reduce((sum, r) => sum + r.values[k]!, 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const significant = countSignificantChanges(rows);

  const periodTitle = (p: Period) => {
    if (granularity === 'week') return p.label;
    return `${t.calloffs.weekdays[weekday(p.start) - 1]} ${formatDayShort(dayToIso(p.start), locale)}`;
  };

  const buildExport = (): ExportTable => {
    const unit = granularity === 'week' ? t.calloffs.granularity.week : t.calloffs.granularity.day;
    return {
      fileName: `${t.calloffs.export.fileName}_CW${current.week}-${current.year}_${unit.toLowerCase()}`,
      sheetName: `CW ${current.week}`,
      header: [
        t.calloffs.table.item,
        t.calloffs.table.description,
        ...fieldLabels,
        ...periods.map((p) => (granularity === 'week' ? p.label : dayToIso(p.start))),
        t.calloffs.table.total,
      ],
      rows: rows.map((r) => {
        return [r.item, r.description, ...itemFieldValues(master?.get(r.item)), ...r.values, r.total];
      }),
    };
  };

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{t.calloffs.kpi.items}</span>
          <span className="kpi-value">{formatQuantity(rows.length, locale)}</span>
          <span className="kpi-note">{t.calloffs.kpi.itemsNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t.calloffs.kpi.demand}</span>
          <span className="kpi-value">{formatQuantity(total, locale)}</span>
          <span className="kpi-note">
            {t.calloffs.table.unit}, {periodTitle(periods[0]!)} – {periodTitle(periods.at(-1)!)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t.calloffs.kpi.changes}</span>
          <span className="kpi-value">{previous ? formatQuantity(significant, locale) : '—'}</span>
          <span className="kpi-note">{previous ? `${t.calloffs.kpi.changesNote} CW ${previous.week}` : t.calloffs.table.noPrevious}</span>
        </div>
      </div>

      {filters}

      <div className="panel">
        <div className="panel-head">
          <h2>{t.calloffs.table.heading}</h2>
          <span className="muted">
            {t.calloffs.currentExport} CW {current.week}/{current.year}, {t.calloffs.table.unit}
          </span>
          <label className="inline-field">
            <span>{t.calloffs.range.label}</span>
            <select
              value={String(count)}
              onChange={(e) => {
                const value = e.target.value === 'all' ? 'all' : Number(e.target.value);
                setRange((r) => ({ ...r, [granularity]: value }));
              }}
            >
              {RANGES[granularity].map((option) => (
                <option key={option} value={String(option)}>
                  {option === 'all' ? t.calloffs.range.all : `${option} ${granularity === 'week' ? t.calloffs.range.weeks : t.calloffs.range.days}`}
                </option>
              ))}
            </select>
          </label>
          <span className="segmented" role="group" aria-label={t.calloffs.granularity.label}>
            {(['week', 'day'] as const).map((g) => (
              <button key={g} type="button" aria-pressed={granularity === g} onClick={() => setGranularity(g)}>
                {t.calloffs.granularity[g]}
              </button>
            ))}
          </span>
          <ExportButtons build={buildExport} />
        </div>
        {rows.length === 0 ? (
          <p>{t.calloffs.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data">
              <thead>
                <tr>
                  <th className="sticky-col">{t.calloffs.table.item}</th>
                  <th>{t.calloffs.table.description}</th>
                  <ItemFieldHeaders />
                  {periods.map((p) => (
                    <th key={p.start} className="n">
                      {periodTitle(p)}
                    </th>
                  ))}
                  <th className="n">{t.calloffs.table.total}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = master?.get(r.item);
                  return (
                    <tr key={r.item}>
                      <td className="sticky-col">
                        <strong>{r.item}</strong>
                      </td>
                      <td className="desc">{r.description}</td>
                      <ItemFieldCells m={m} />
                      {r.values.map((v, k) => {
                        const prev = r.previous[k]!;
                        const change = changeOf(v, prev);
                        const title = prev === null ? undefined : `${t.calloffs.table.previous} CW ${previous?.week}: ${formatQuantity(prev, locale)}`;
                        return (
                          <td key={periods[k]!.start} className={`n${change?.significant ? ' cell-changed' : ''}`} title={title}>
                            {v ? formatQuantity(v, locale) : <span className="muted">0</span>}
                            {change && (change.significant || Math.abs(change.percent ?? 100) >= 10) && (
                              <span className={`delta ${change.diff > 0 ? 'delta-up' : 'delta-down'}`}>
                                {change.diff > 0 ? '▲' : '▼'} {signed(change.diff, locale)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="n">
                        <strong>{formatQuantity(r.total, locale)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-col">{t.calloffs.table.sum}</td>
                  <td />
                  {fieldLabels.map((label) => (
                    <td key={label} />
                  ))}
                  {totals.map((v, k) => (
                    <td key={periods[k]!.start} className="n">
                      {formatQuantity(v, locale)}
                    </td>
                  ))}
                  <td className="n">{formatQuantity(total, locale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted">{previous ? t.calloffs.table.changeNote : t.calloffs.table.noPrevious}</p>
      </div>
    </div>
  );
}
