import { useMemo, useState } from 'react';
import {
  buildCoverage,
  coverageOptions,
  EMPTY_COVERAGE_FILTER,
  filterCoverage,
  SHORTAGE_DAYS,
  shortage,
  summarizeBySide,
  type CoverageField,
  type CoverageFilter,
} from '../../core/coverage/compute';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { excludedLocationsIn, STOCK_ZONES, stockByItem } from '../../core/stock';
import type { TransitEntry } from '../../core/transit';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from '../calloffs/ExportButtons';
import { useData } from '../data/DataProvider';
import { localToday } from '../components/useComponents';
import { Icon } from '../icons';
import { MappingNotice } from '../data/MappingPanels';

type RowsMode = 'all' | 'negativeAny' | 'negativeOn';

const NO_SOURCES: never[] = [];

function isNegative(v: number | null | undefined): boolean {
  return v !== null && v !== undefined && v < 0;
}


/** Projekt z adresy #coverage?project=P1 (odkaz z Dashboardu); jinak prázdný. */
function projectFromHash(): string {
  return new URLSearchParams(location.hash.split('?')[1] ?? '').get('project') ?? '';
}

export function CoveragePage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tc = t.coverage;
  const { state } = useData();
  const sources = state.data?.coverage ?? NO_SOURCES;
  const master = state.data?.master?.data;
  const stockData = state.data?.stock?.data;
  const stock = useMemo(() => (stockData ? stockByItem(stockData) : undefined), [stockData]);
  const excludedLocations = useMemo(() => (stockData ? excludedLocationsIn(stockData) : []), [stockData]);

  const [transit, setTransit] = useState(true);
  const [ourStock, setOurStock] = useState(false);
  const [filter, setFilter] = useState<Omit<CoverageFilter, 'rows'>>(() => ({ ...EMPTY_COVERAGE_FILTER, project: projectFromHash() }));
  const [rowsMode, setRowsMode] = useState<RowsMode>('all');
  const [day, setDay] = useState<DayNumber | null>(null);

  const withStock = ourStock && stock !== undefined;
  const table = useMemo(() => buildCoverage(sources, master, { transit, ourStock: withStock }, stock), [sources, master, transit, withStock, stock]);
  const options = useMemo(() => coverageOptions(table, filter), [table, filter]);
  const selectedDay = day !== null && table.days.includes(day) ? day : (table.days[0] ?? 0);
  const lines = useMemo(
    () => filterCoverage(table, { ...filter, rows: rowsMode === 'negativeOn' ? { kind: 'negativeOn', day: selectedDay } : { kind: rowsMode } }),
    [table, filter, rowsMode, selectedDay],
  );
  const summary = useMemo(() => summarizeBySide(table.days, lines), [table.days, lines]);

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;

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
  const set = (key: CoverageField | 'query') => (value: string) => setFilter((f) => ({ ...f, [key]: value }));
  // Kategorie, strana a varianta se nabídnou, jen když je díly ve výběru mají (nebo je filtr nastavený).
  const shown = (key: CoverageField, values: string[]) => values.length > 0 || filter[key] !== '';
  const select = (key: CoverageField, label: string, values: string[]) => (
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

  const soon = shortage(lines, SHORTAGE_DAYS);
  const anyNegative = lines.filter((l) => l.values.some(isNegative)).length;
  const lastDay = table.days.at(-1);
  const transitNote = `${transit ? tc.kpi.withTransit : tc.kpi.withoutTransit}${withStock ? `, ${tc.kpi.withStock}` : ''}`;

  const fileBase = `${tc.export.fileName}_${dayToIso(table.days[0] ?? 0)}${transit ? '_transit' : ''}${withStock ? '_sklad' : ''}`;
  const buildLinesExport = (): ExportTable => ({
    fileName: fileBase,
    sheetName: tc.export.sheet,
    header: [
      tc.table.item,
      tc.table.customerNumber,
      tc.table.description,
      tc.table.location,
      tc.table.project,
      tc.table.category,
      tc.table.side,
      tc.table.variant,
      tc.table.customerStock,
      tc.table.transit,
      ...(stock ? [tc.table.ourStock] : []),
      tc.table.firstUncovered,
      ...table.days.map(dayToIso),
    ],
    rows: lines.map((l) => [
      l.item,
      l.customerNumber,
      l.description,
      l.location,
      l.project,
      l.category,
      l.side,
      l.variant,
      l.customerStock,
      l.transit,
      ...(stock ? [l.ourStock] : []),
      [l.uncoveredAt.replace('T', ' '), l.firstUncovered].filter(Boolean).join(' · '),
      ...l.values,
    ]),
  });
  const buildSummaryExport = (): ExportTable => ({
    fileName: `${fileBase}_${tc.export.summarySheet.toLowerCase()}`,
    sheetName: tc.export.summarySheet,
    header: [tc.summary.side, ...table.days.map(dayToIso)],
    rows: summary.map((s) => [s.side || tc.summary.none, ...s.values]),
  });

  // Hranice pokrytí 2 dny: konec zítřka (dnes + 1).
  const boundary = today + 1;
  const dayClass = (d: DayNumber) => `${weekday(d) >= 6 ? ' col-weekend' : ''}${d === boundary ? ' col-boundary' : ''}`;
  const dayHead = (d: DayNumber) => (
    <th key={d} className={`n${dayClass(d)}`} title={d === boundary ? tc.legend.boundary : undefined}>
      {dayLabel(d)}
    </th>
  );
  /** Buňka pokrytí; `uncoveredDay` je den, kdy zákazník hlásí první nepokrytí. */
  const valueCell = (v: number | null, k: number, uncoveredDay: DayNumber | null = null) => {
    const day = table.days[k]!;
    const state = isNegative(v) ? ' cell-negative' : v !== null && day === uncoveredDay ? ' cell-uncovered' : '';
    return (
      <td key={k} className={`n${dayClass(day)}${state}`} title={state === ' cell-uncovered' ? tc.legend.uncovered : undefined}>
        {v === null ? <span className="muted">—</span> : formatQuantity(v, locale)}
      </td>
    );
  };

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head-row">
        {head}
        <p className="muted source-info">
          {tc.sources}: <strong>{sources.length}</strong> · {tc.updated}{' '}
          <strong>{new Date(newest).toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</strong>
        </p>
      </div>
      <MappingNotice module="coverage" />
      {state.data?.transit && <ExtraTransit entries={state.data.transit.entries} />}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">
            {tc.kpi.shortage}
            {table.days.length > 0 && ` (${table.days.slice(0, SHORTAGE_DAYS).map(dayLabel).join(', ')})`}
          </span>
          <span className="kpi-value">
            {formatQuantity(soon.pieces, locale)} {t.calloffs.table.unit}
          </span>
          <span className="kpi-note">
            {tc.kpi.shortageParts}: {formatQuantity(soon.parts, locale)}, {transitNote}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.negativeAny}</span>
          <span className="kpi-value">{formatQuantity(anyNegative, locale)}</span>
          <span className="kpi-note">
            {tc.kpi.negativeAnyNote}
            {lastDay !== undefined && ` ${dayLabel(lastDay)}`}, {transitNote}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.items}</span>
          <span className="kpi-value">{formatQuantity(lines.length, locale)}</span>
          <span className="kpi-note">{tc.kpi.itemsNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.unmapped}</span>
          <span className="kpi-value">{formatQuantity(options.unmapped, locale)}</span>
          <span className="kpi-note">{tc.kpi.unmappedNote}</span>
        </div>
      </div>

      {/* Filtry hned nad souhrnem a tabulkou, aby se nemuselo posouvat na začátek stránky. */}
      <div className="filters" role="group" aria-label={tc.filters.label}>
        {select('location', tc.filters.location, options.locations)}
        {select('project', tc.filters.project, options.projects)}
        {shown('category', options.categories) && select('category', tc.filters.category, options.categories)}
        {shown('side', options.sides) && select('side', tc.filters.side, options.sides)}
        {shown('variant', options.variants) && select('variant', tc.filters.variant, options.variants)}
        <label className="field field-wide">
          <span>{tc.filters.search}</span>
          <input type="search" value={filter.query} placeholder={tc.filters.searchPlaceholder} onChange={(e) => set('query')(e.target.value)} />
        </label>
        <button type="button" className="link-button" onClick={() => setFilter(EMPTY_COVERAGE_FILTER)}>
          {tc.filters.reset}
        </button>
        <span className="filters-break" role="presentation" />
        <label className="check-field">
          <input type="checkbox" checked={transit} onChange={(e) => setTransit(e.target.checked)} />
          {tc.options.transit}
        </label>
        {stock && (
          <label className="check-field">
            <input type="checkbox" checked={ourStock} onChange={(e) => setOurStock(e.target.checked)} />
            {tc.options.ourStock}
          </label>
        )}
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
                <th className="sticky-col">{tc.summary.side}</th>
                {table.days.map(dayHead)}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.side}>
                  <td className="sticky-col">{s.side || <span className="muted">{tc.summary.none}</span>}</td>
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
                  <th>{tc.table.customerNumber}</th>
                  <th>{tc.table.description}</th>
                  <th>{tc.table.location}</th>
                  <th>{tc.table.project}</th>
                  <th className="n">{tc.table.customerStock}</th>
                  <th className="n">{tc.table.transit}</th>
                  {stock && <th className="n">{tc.table.ourStock}</th>}
                  <th>{tc.table.firstUncovered}</th>
                  {table.days.map(dayHead)}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="sticky-col">
                      <strong>{l.item || '—'}</strong>
                      {!l.item && <small className="muted cell-note">{tc.table.unmapped}</small>}
                    </td>
                    <td title={l.fileCustomerNumber !== l.customerNumber ? `${tc.table.fileCustomerNumber}: ${l.fileCustomerNumber}` : undefined}>{l.customerNumber}</td>
                    <td className="desc">{l.description}</td>
                    <td>{l.location || '—'}</td>
                    <td>{l.project || '—'}</td>
                    <td className="n">{formatQuantity(l.customerStock, locale)}</td>
                    <td className="n">
                      {l.transit ? formatQuantity(l.transit, locale) : <span className="muted">0</span>}
                      {l.extraTransit > 0 && <small className="cell-note">{tc.extraTransit.cell.replace('{n}', formatQuantity(l.extraTransit, locale))}</small>}
                    </td>
                    {stock && (
                      <td className="n">{l.ourStock === null ? <span className="muted">—</span> : l.ourStock ? formatQuantity(l.ourStock, locale) : <span className="muted">0</span>}</td>
                    )}
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
                    {l.values.map((v, k) => valueCell(v, k, l.uncoveredAt ? parseDay(l.uncoveredAt) : null))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="cov-legend">
          <li>
            <i className="swatch swatch-negative" /> {tc.legend.negative}
          </li>
          <li>
            <i className="swatch swatch-uncovered" /> {tc.legend.uncovered}
          </li>
          <li>
            <i className="swatch swatch-weekend" /> {tc.legend.weekend}
          </li>
          <li>
            <i className="swatch swatch-boundary" /> {tc.legend.boundary}
          </li>
        </ul>
        <p className="muted">
          {tc.table.note}
          {stock &&
            ` ${tc.table.ourStockNote
              .replace('{zones}', STOCK_ZONES.join(', '))
              .replace('{excluded}', excludedLocations.length > 0 ? excludedLocations.join(', ') : tc.table.ourStockNoExclusions)}`}
        </p>
      </div>
    </section>
  );
}

/** Doplněný transit ze složky Transit: kolik se přičetlo a proč se něco nepřičetlo. */
function ExtraTransit({ entries }: { entries: TransitEntry[] }) {
  const { t, locale } = useI18n();
  const te = t.coverage.extraTransit;
  const added = entries.filter((e) => e.status === 'added');
  const skipped = entries.length - added.length;
  return (
    <details className="panel extra-transit">
      <summary>
        {te.summary.replace('{added}', formatQuantity(added.length, locale)).replace('{pcs}', formatQuantity(added.reduce((s, e) => s + e.row.qty, 0), locale))}
        {skipped > 0 && te.skipped.replace('{n}', formatQuantity(skipped, locale))}
        {' · '}
        <span className="link-button">{te.details}</span>
      </summary>
      <p className="muted">{te.note}</p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{te.item}</th>
              <th className="n">{te.qty}</th>
              <th>{te.day}</th>
              <th>{te.shipment}</th>
              <th>{te.coverage}</th>
              <th>{te.status}</th>
              <th>{te.file}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, k) => (
              <tr key={k}>
                <td>
                  <strong>{e.row.item}</strong>
                </td>
                <td className="n">{formatQuantity(e.row.qty, locale)}</td>
                <td>
                  {formatDayShort(dayToIso(e.row.day), locale)} {e.row.time}
                </td>
                <td>{e.row.shipment || '—'}</td>
                <td>{[e.location, e.project].filter(Boolean).join(' / ') || '—'}</td>
                <td className={e.status === 'added' ? undefined : 'cell-short'}>{te.statuses[e.status]}</td>
                <td className="muted">{e.file.split('/').pop()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
