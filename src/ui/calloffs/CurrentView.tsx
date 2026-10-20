import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { CallOffExport } from '../../core/calloffs/parse';
import { shiftsOf, type PerShift } from '../../core/calloffs/summary';
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
import { categoryOutput } from '../../core/planning/settings';
import { useI18n } from '../../i18n/I18nProvider';
import { usePlanSettings } from '../planning/PlanningProvider';
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
  const ts = t.calloffs.summary;
  const fieldLabels = useItemFieldLabels();
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [range, setRange] = useState<Record<Granularity, PeriodCount>>({ week: DEFAULT_WEEKS, day: 15 });
  const count = range[granularity];

  const periods = useMemo(() => buildPeriods(current, granularity, count), [current, granularity, count]);
  const rows = useMemo(() => buildCurrentRows(current, previous, items, periods), [current, previous, items, periods]);

  const totals = periods.map((_, k) => rows.reduce((sum, r) => sum + r.values[k]!, 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const significant = countSignificantChanges(rows);

  // Směny: kusy ÷ výkon za směnu kategorie dílu (Plánování → Kapacity).
  const settings = usePlanSettings();
  const perShift = useMemo<PerShift>(() => (item) => {
    const m = master?.get(item);
    return m ? categoryOutput(settings, m.project, m.category) : null;
  }, [master, settings]);
  const [showShifts, setShowShifts] = useState(settings.outputs.length > 0);
  const totalShifts = shiftsOf(rows, perShift, periods.length)?.values ?? null;
  const shiftText = (v: number | null) => (v === null ? '—' : v.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const round = (v: number) => Math.round(v * 10) / 10;

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
        ...(showShifts ? [ts.unit] : []),
        ...periods.map((p) => (granularity === 'week' ? p.label : dayToIso(p.start))),
        t.calloffs.table.total,
      ],
      rows: rows.flatMap((r) => {
        const fields = [r.item, r.description, ...itemFieldValues(master?.get(r.item))];
        if (!showShifts) return [[...fields, ...r.values, r.total]];
        const shifts = shiftsOf([r], perShift, periods.length)?.values ?? null;
        return [
          [...fields, ts.pcs, ...r.values, r.total],
          [...fields, ts.shiftsUnit, ...(shifts ? shifts.map(round) : periods.map(() => null)), shifts ? round(shifts.reduce((a, b) => a + b, 0)) : null],
        ];
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
          <label className="check-field">
            <input type="checkbox" checked={showShifts} onChange={(e) => setShowShifts(e.target.checked)} />
            {ts.showShifts}
          </label>
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
                  const shifts = showShifts ? (shiftsOf([r], perShift, periods.length)?.values ?? null) : null;
                  return (
                    <Fragment key={r.item}>
                      <tr className={showShifts ? 'summary-with-shifts' : undefined}>
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
                      {showShifts && (
                        <tr className="summary-shifts">
                          <td className="sticky-col">{ts.shiftsRow}</td>
                          <td className="muted">{m && categoryOutput(settings, m.project, m.category) !== null ? `${formatQuantity(categoryOutput(settings, m.project, m.category)!, locale)} ${ts.perShiftShort}` : ts.missingOutput}</td>
                          {fieldLabels.map((label) => (
                            <td key={label} />
                          ))}
                          {periods.map((p, k) => (
                            <td key={p.start} className="n">
                              {shiftText(shifts ? shifts[k]! : null)}
                            </td>
                          ))}
                          <td className="n">
                            <strong>{shiftText(shifts ? shifts.reduce((a, b) => a + b, 0) : null)}</strong>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
                {showShifts && (
                  <tr className="summary-shifts">
                    <td className="sticky-col">{ts.shiftsRow}</td>
                    <td />
                    {fieldLabels.map((label) => (
                      <td key={label} />
                    ))}
                    {periods.map((p, k) => (
                      <td key={p.start} className="n">
                        {shiftText(totalShifts ? totalShifts[k]! : null)}
                      </td>
                    ))}
                    <td className="n">{shiftText(totalShifts ? totalShifts.reduce((a, b) => a + b, 0) : null)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted">{previous ? t.calloffs.table.changeNote : t.calloffs.table.noPrevious}</p>
      </div>
    </div>
  );
}
