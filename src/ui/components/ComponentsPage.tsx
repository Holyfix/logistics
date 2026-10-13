import { useMemo, useState } from 'react';
import { COMPONENT_SOON_DAYS, type ComponentLine } from '../../core/components/compute';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatAmount, formatDayShort, formatOneDecimal, formatQuantity } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from '../calloffs/ExportButtons';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { localToday, useComponents } from './useComponents';

export function ComponentsPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tc = t.components;
  const { state } = useData();
  const table = useComponents(today);

  const [project, setProject] = useState('');
  const [query, setQuery] = useState('');
  const [onlyShort, setOnlyShort] = useState(false);

  const projects = useMemo(() => [...new Set(table?.components.flatMap((c) => c.projects) ?? [])].sort((a, b) => a.localeCompare(b, 'cs')), [table]);
  const lines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (table?.components ?? []).filter(
      (c) =>
        (!project || c.projects.includes(project)) &&
        (!onlyShort || c.shortDay !== null) &&
        (!q || `${c.item} ${c.description}`.toLowerCase().includes(q)),
    );
  }, [table, project, query, onlyShort]);

  // Poptávka hotových dílů podle filtru komponent: projekt omezí hotové díly na projekt; hledání nebo „jen v záporu“
  // na hotové díly, které vybrané komponenty mají v kusovníku.
  const byComponent = query.trim() !== '' || onlyShort;
  const shownProducts = useMemo(() => {
    const used = byComponent ? new Set(lines.flatMap((c) => c.products)) : null;
    return (table?.products ?? []).filter((p) => (!project || p.project === project) && (!used || used.has(p.item)));
  }, [table, lines, project, byComponent]);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="components" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.components.title}</h1>
        <p className="lead">{t.modules.components.description}</p>
      </div>
    </div>
  );

  if (!table) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{state.status === 'loading' ? t.data.folder.loading : tc.noBom}</p>
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

  const { days, products } = table;
  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const weekend = (d: DayNumber) => (weekday(d) >= 6 ? ' col-weekend' : '');
  const amount = (v: number, um: string) => formatAmount(v, locale, um);
  const sourceLabel = (c: ComponentLine) => (c.source === 'P' ? tc.table.purchased : c.source ? tc.table.made : '—');
  const short = table.components.filter((c) => c.shortDay !== null).length;
  const soon = table.components.filter((c) => c.shortDay !== null && c.shortDay < COMPONENT_SOON_DAYS).length;
  const callOffs = state.data?.exports.at(-1);
  const noDemand = products.filter((p) => p.qty.every((q) => q === 0)).length;
  const boms = state.data?.boms.length ?? 0;
  const fileBase = `${tc.export.fileName}_${dayToIso(today)}`;
  const productionDays = (c: ComponentLine) => (c.productionDays === null ? tc.table.noUsage : `${formatOneDecimal(c.productionDays, locale)} ${tc.table.productionDays}`);
  /** Poslední pracovní den před indexem dne (pro „pokryt do“); null, když chybí už dnes. */
  const coveredUntil = (short: number): DayNumber | null => {
    for (let k = short - 1; k >= 0; k--) if (weekday(days[k]!) <= 5) return days[k]!;
    return null;
  };
  const customerText = (c: ComponentLine) => {
    if (!c.customerKnown) return '—';
    if (c.customerShortDay === null) return tc.table.whole;
    const until = coveredUntil(c.customerShortDay);
    return until === null ? tc.table.notCovered : dayLabel(until);
  };

  const buildExport = (): ExportTable => ({
    fileName: fileBase,
    sheetName: tc.export.sheet,
    header: [
      tc.table.item,
      tc.table.description,
      tc.table.um,
      tc.table.source,
      tc.table.stock,
      tc.table.usage,
      tc.table.avgDaily,
      tc.table.productionDaysHead,
      tc.table.until,
      tc.table.customer,
      tc.table.products,
      ...days.map(dayToIso),
    ],
    rows: lines.map((c) => [
      c.item,
      c.description,
      c.um,
      sourceLabel(c),
      c.stock,
      round(c.usage.reduce((a, b) => a + b, 0)),
      round(c.avgDaily),
      c.productionDays === null ? null : Math.round(c.productionDays * 10) / 10,
      c.shortDay === null ? tc.table.whole : dayToIso(days[c.shortDay]!),
      customerText(c),
      c.products.join(', '),
      ...c.balance.map(round),
    ]),
  });
  const buildDemandExport = (): ExportTable => ({
    fileName: `${fileBase}_${tc.export.demandSheet.toLowerCase()}`,
    sheetName: tc.export.demandSheet,
    header: [tc.demand.item, tc.demand.description, tc.demand.project, tc.demand.total, ...days.map(dayToIso)],
    rows: shownProducts.map((p) => [p.item, p.description, p.project, p.qty.reduce((a, b) => a + b, 0), ...p.qty]),
  });

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head-row">
        {head}
        <p className="muted source-info">
          {tc.sources}: <strong>{boms}</strong> · <strong>{products.length}</strong> {tc.products} · {tc.callOffs}{' '}
          <strong>{callOffs ? `CW ${callOffs.week}/${callOffs.year}` : '—'}</strong>
        </p>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.soon}</span>
          <span className="kpi-value">{formatQuantity(soon, locale)}</span>
          <span className="kpi-note">{tc.kpi.soonNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.short}</span>
          <span className="kpi-value">{formatQuantity(short, locale)}</span>
          <span className="kpi-note">
            {tc.kpi.shortNote} {dayLabel(days.at(-1)!)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.tracked}</span>
          <span className="kpi-value">{formatQuantity(table.components.length, locale)}</span>
          <span className="kpi-note">{table.byMapping ? tc.kpi.byMapping : tc.kpi.allPurchased}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tc.kpi.demand}</span>
          <span className="kpi-value">{formatQuantity(products.length, locale)}</span>
          <span className="kpi-note">
            {tc.kpi.demandNote}, {tc.kpi.noDemand}: {formatQuantity(noDemand, locale)}
          </span>
        </div>
      </div>

      <div className="filters" role="group" aria-label={tc.filters.label}>
        <label className="field">
          <span>{tc.filters.project}</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{tc.filters.all}</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-wide">
          <span>{tc.filters.search}</span>
          <input type="search" value={query} placeholder={tc.filters.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
          {tc.filters.onlyShort}
        </label>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setProject('');
            setQuery('');
            setOnlyShort(false);
          }}
        >
          {tc.filters.reset}
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.table.heading}</h2>
          <span className="muted">{tc.table.sub}</span>
          <span className="panel-actions">
            <ExportButtons build={buildExport} />
          </span>
        </div>
        {!state.data?.stock && <p className="muted">{tc.table.noStock}</p>}
        {lines.length === 0 ? (
          <p>{tc.table.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data">
              <thead>
                <tr>
                  <th className="sticky-col">{tc.table.item}</th>
                  <th>{tc.table.description}</th>
                  <th>{tc.table.um}</th>
                  <th>{tc.table.source}</th>
                  <th className="n">{tc.table.stock}</th>
                  <th className="n">{tc.table.usage}</th>
                  <th className="n">{tc.table.avgDaily}</th>
                  <th>{tc.table.until}</th>
                  <th title={tc.table.customerTitle}>
                    {tc.table.customer}
                    <span className="th-note">{tc.table.customerNote}</span>
                  </th>
                  {days.map((d) => (
                    <th key={d} className={`n${weekend(d)}`}>
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((c) => (
                  <tr key={c.item}>
                    <td className="sticky-col">
                      <button type="button" className="link-button cell-link" title={tc.table.select} onClick={() => setQuery(c.item)}>
                        <strong>{c.item}</strong>
                      </button>
                    </td>
                    <td className="desc" title={`${tc.table.products}: ${c.products.join(', ')}`}>
                      {c.description}
                    </td>
                    <td>{c.um}</td>
                    <td>{sourceLabel(c)}</td>
                    <td className="n">{c.stock === null ? <span className="muted">—</span> : amount(c.stock, c.um)}</td>
                    <td className="n">{amount(c.usage.reduce((a, b) => a + b, 0), c.um)}</td>
                    <td className="n">{amount(c.avgDaily, c.um)}</td>
                    <td className="cell-until">
                      <strong>{productionDays(c)}</strong>
                      {c.shortDay === null ? (
                        <small className="muted cell-note">{tc.table.whole}</small>
                      ) : (
                        <small className="cell-note cell-short">
                          {tc.table.shortFrom} {dayLabel(days[c.shortDay]!)}
                        </small>
                      )}
                    </td>
                    <td className="muted" title={tc.table.customerTitle}>
                      {customerText(c)}
                    </td>
                    {c.balance.map((v, k) => (
                      <td key={k} className={`n${weekend(days[k]!)}${v < -1e-9 ? ' cell-negative' : ''}`}>
                        {amount(v, c.um)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {table.markedNotInBom.length > 0 && (
          <p className="muted">
            {tc.table.markedNotInBom}: {table.markedNotInBom.join(', ')}
          </p>
        )}
        <p className="muted">{tc.table.note}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.demand.heading}</h2>
          <span className="muted">
            {tc.demand.sub}
            {shownProducts.length !== products.length && ` · ${tc.demand.shown} ${formatQuantity(shownProducts.length, locale)} / ${formatQuantity(products.length, locale)}`}
          </span>
          <span className="panel-actions">
            <ExportButtons build={buildDemandExport} />
          </span>
        </div>
        <div className="table-scroll table-tall">
          <table className="table table-data">
            <thead>
              <tr>
                <th className="sticky-col">{tc.demand.item}</th>
                <th>{tc.demand.description}</th>
                <th>{tc.demand.project}</th>
                <th className="n">{tc.demand.total}</th>
                {days.map((d) => (
                  <th key={d} className={`n${weekend(d)}`}>
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownProducts.map((p) => (
                <tr key={p.item}>
                  <td className="sticky-col">
                    <strong>{p.item}</strong>
                  </td>
                  <td className="desc">{p.description}</td>
                  <td>{p.project || '—'}</td>
                  <td className="n">{formatQuantity(p.qty.reduce((a, b) => a + b, 0), locale)}</td>
                  {p.qty.map((q, k) => (
                    <td key={k} className={`n${weekend(days[k]!)}`}>
                      {q === 0 ? <span className="muted">0</span> : formatQuantity(q, locale)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!callOffs && <p className="muted">{tc.demand.noCallOffs}</p>}
        {shownProducts.length === 0 && <p>{tc.demand.empty}</p>}
        <p className="muted">{tc.demand.note}</p>
      </div>
    </section>
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
