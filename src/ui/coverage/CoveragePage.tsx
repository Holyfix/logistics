import { useMemo, useState } from 'react';
import {
  buildCoverage,
  coverageOptions,
  EMPTY_COVERAGE_FILTER,
  filterCoverage,
  summarizeByVariant,
  type CoverageFilter,
  type CoverageLine,
} from '../../core/coverage/compute';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from '../calloffs/ExportButtons';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';

type RowsMode = 'all' | 'negativeAny' | 'negativeOn';

const NO_SOURCES: never[] = [];

function isNegative(v: number | null | undefined): boolean {
  return v !== null && v !== undefined && v < 0;
}

export function CoveragePage() {
  const { t, locale } = useI18n();
  const tc = t.coverage;
  const { state } = useData();
  const sources = state.data?.coverage ?? NO_SOURCES;
  const master = state.data?.master?.data;

  const [transit, setTransit] = useState(true);
  const [filter, setFilter] = useState<Omit<CoverageFilter, 'rows'>>(EMPTY_COVERAGE_FILTER);
  const [rowsMode, setRowsMode] = useState<RowsMode>('all');
  const [day, setDay] = useState<DayNumber | null>(null);

  const table = useMemo(() => buildCoverage(sources, master, { transit }), [sources, master, transit]);
  const options = useMemo(() => coverageOptions(table), [table]);
  const selectedDay = day !== null && table.days.includes(day) ? day : (table.days[0] ?? 0);
  const lines = useMemo(
    () => filterCoverage(table, { ...filter, rows: rowsMode === 'negativeOn' ? { kind: 'negativeOn', day: selectedDay } : { kind: rowsMode } }),
    [table, filter, rowsMode, selectedDay],
  );
  const summary = useMemo(() => summarizeByVariant(table.days, lines), [table.days, lines]);

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const multipleLocations = options.locations.length > 1;

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="coverage" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.coverage.title}</h1>
        <p className="lead">{t.modules.coverage.description}</p>
      </div>
    </div>
  );

  if (sources.length === 0) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{state.status === 'loading' ? t.data.folder.loading : tc.noData}</p>
          {state.status !== 'loading' && (
            <p>
              <a className="button button-primary" href="#data">
                {tc.noDataAction}
              </a>
            </p>
          )}
        </div>
      </section>
    );
  }

  const newest = Math.max(...sources.map((s) => s.lastModified));
  const set = (key: keyof Omit<CoverageFilter, 'rows'>) => (value: string) => setFilter((f) => ({ ...f, [key]: value }));
  const select = (key: 'location' | 'project' | 'variant', label: string, values: string[]) => (
    <label className="field">
      <span>{label}</span>
      <select value={filter[key]} onChange={(e) => set(key)(e.target.value)}>
        <option value="">{tc.filters.all}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );

  const firstNegative = lines.filter((l) => isNegative(l.values[0])).length;
  const anyNegative = lines.filter((l) => l.values.some(isNegative)).length;
  const transitNote = transit ? tc.kpi.withTransit : tc.kpi.withoutTransit;
  const itemLabel = (l: CoverageLine) => l.item || l.customerNumber;

  const fileBase = `${tc.export.fileName}_${dayToIso(table.days[0] ?? 0)}${transit ? '_transit' : ''}`;
  const buildLinesExport = (): ExportTable => ({
    fileName: fileBase,
    sheetName: tc.export.sheet,
    header: [
      tc.table.item,
      tc.table.customerNumber,
      tc.table.description,
      tc.table.location,
      tc.table.project,
      tc.table.variant,
      tc.table.customerStock,
      tc.table.transit,
      tc.table.firstUncovered,
      ...table.days.map(dayToIso),
    ],
    rows: lines.map((l) => [
      l.item,
      l.customerNumber,
      l.description,
      l.location,
      l.project,
      l.variant,
      l.customerStock,
      l.transit,
      [l.uncoveredAt.replace('T', ' '), l.firstUncovered].filter(Boolean).join(' · '),
      ...l.values,
    ]),
  });
  const buildSummaryExport = (): ExportTable => ({
    fileName: `${fileBase}_${tc.export.summarySheet.toLowerCase()}`,
    sheetName: tc.export.summarySheet,
    header: [tc.summary.variant, ...table.days.map(dayToIso)],
    rows: summary.map((s) => [s.variant || tc.summary.none, ...s.values]),
  });

  const valueCell = (v: number | null, key: number) => (
    <td key={key} className={`n${isNegative(v) ? ' cell-negative' : ''}`}>
      {v === null ? <span className="muted">—</span> : formatQuantity(v, locale)}
    </td>
  );

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head-row">
        {head}
        <p className="muted source-info">
          {tc.sources}: <strong>{sources.length}</strong> · {tc.updated}{' '}
          <strong>{new Date(newest).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</strong>
        </p>
      </div>

      <div className="filters" role="group" aria-label={tc.filters.label}>
        {select('location', tc.filters.location, options.locations)}
        {select('project', tc.filters.project, options.projects)}
        {select('variant', tc.filters.variant, options.variants)}
        <label className="field field-wide">
          <span>{tc.filters.search}</span>
          <input type="search" value={filter.query} placeholder={tc.filters.searchPlaceholder} onChange={(e) => set('query')(e.target.value)} />
        </label>
        <button type="button" className="link-button" onClick={() => setFilter(EMPTY_COVERAGE_FILTER)}>
          {tc.filters.reset}
        </button>
      </div>

      <div className="filters" role="group" aria-label={tc.options.label}>
        <label className="check-field">
          <input type="checkbox" checked={transit} onChange={(e) => setTransit(e.target.checked)} />
          {tc.options.transit}
        </label>
        <label className="field">
          <span>{tc.options.rows}</span>
          <select value={rowsMode} onChange={(e) => setRowsMode(e.target.value as RowsMode)}>
            <option value="all">{tc.options.all}</option>
            <option value="negativeAny">{tc.options.negativeAny}</option>
            <option value="negativeOn">{tc.options.negativeOn}</option>
          </select>
        </label>
        {rowsMode === 'negativeOn' && (
          <label className="field">
            <span>{tc.options.day}</span>
            <select value={selectedDay} onChange={(e) => setDay(Number(e.target.value))}>
              {table.days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.items}</span>
          <span className="kpi-value">{formatQuantity(lines.length, locale)}</span>
          <span className="kpi-note">{tc.kpi.itemsNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">
            {tc.kpi.negativeFirst} ({table.days[0] !== undefined ? dayLabel(table.days[0]) : '—'})
          </span>
          <span className="kpi-value">{formatQuantity(firstNegative, locale)}</span>
          <span className="kpi-note">{transitNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.negativeAny}</span>
          <span className="kpi-value">{formatQuantity(anyNegative, locale)}</span>
          <span className="kpi-note">{transitNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.unmapped}</span>
          <span className="kpi-value">{formatQuantity(options.unmapped, locale)}</span>
          <span className="kpi-note">{tc.kpi.unmappedNote}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.summary.heading}</h2>
          <span className="muted">{tc.table.sub}</span>
          <span className="panel-actions">
            <ExportButtons build={buildSummaryExport} />
          </span>
        </div>
        <div className="table-scroll">
          <table className="table table-data">
            <thead>
              <tr>
                <th className="sticky-col">{tc.summary.variant}</th>
                {table.days.map((d) => (
                  <th key={d} className="n">
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.variant}>
                  <td className="sticky-col">{s.variant || <span className="muted">{tc.summary.none}</span>}</td>
                  {s.values.map((v, k) => valueCell(v, k))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.table.heading}</h2>
          <span className="muted">{tc.table.sub}</span>
          <span className="panel-actions">
            <ExportButtons build={buildLinesExport} />
          </span>
        </div>
        {lines.length === 0 ? (
          <p>{tc.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data">
              <thead>
                <tr>
                  <th className="sticky-col">{tc.table.item}</th>
                  <th>{tc.table.description}</th>
                  {multipleLocations && <th>{tc.table.location}</th>}
                  <th>{tc.table.project}</th>
                  <th>{tc.table.variant}</th>
                  <th className="n">{tc.table.customerStock}</th>
                  <th className="n">{tc.table.transit}</th>
                  <th>{tc.table.firstUncovered}</th>
                  {table.days.map((d) => (
                    <th key={d} className="n">
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="sticky-col" title={`${tc.table.customerNumber}: ${l.customerNumber}`}>
                      <strong>{itemLabel(l)}</strong>
                      {!l.item && <small className="muted cell-note">{tc.table.unmapped}</small>}
                    </td>
                    <td className="desc">{l.description}</td>
                    {multipleLocations && <td>{l.location || '—'}</td>}
                    <td>{l.project || '—'}</td>
                    <td>{l.variant ? <span className="chip">{l.variant}</span> : '—'}</td>
                    <td className="n">{formatQuantity(l.customerStock, locale)}</td>
                    <td className="n">{l.transit ? formatQuantity(l.transit, locale) : <span className="muted">0</span>}</td>
                    <td>
                      {l.uncoveredAt ? (
                        <>
                          {formatDayShort(l.uncoveredAt.slice(0, 10), locale)} {l.uncoveredAt.slice(11, 16)}
                          {l.firstUncovered && <small className="muted cell-note">{l.firstUncovered}</small>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {l.values.map((v, k) => valueCell(v, k))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">{tc.table.note}</p>
      </div>
    </section>
  );
}
