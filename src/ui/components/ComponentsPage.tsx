import { useMemo, useState } from 'react';
import { COMPONENT_SOON_DAYS, type ComponentLine } from '../../core/components/compute';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatAmount, formatDayShort, formatOneDecimal, formatQuantity } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import { ExportButtons, type ExportTable } from '../calloffs/ExportButtons';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { localToday, useComponents } from './useComponents';

/** Za kolik prvních dnů se ukazuje potřeba komponenty. */
const NEED_DAYS = 7;

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

export function ComponentsPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tc = t.components;
  const { state } = useData();
  const [netOwnStock, setNetOwnStock] = useState(true);
  const table = useComponents(today, netOwnStock);

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

  // Hotové díly podle filtru komponent: projekt omezí hotové díly na projekt; hledání nebo „jen v záporu“
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
  const toProduce = products.filter((p) => p.production.some((q) => q > 0)).length;
  const withoutProject = products.filter((p) => !p.project).map((p) => p.item);
  const boms = state.data?.boms.length ?? 0;
  const fileBase = `${tc.export.fileName}_${dayToIso(today)}`;
  const productionTotals = days.map((_, k) => sum(shownProducts.map((p) => p.production[k]!)));
  const need7 = (c: ComponentLine) => sum(c.usage.slice(0, NEED_DAYS));
  const reserve = (c: ComponentLine) => (c.productionDays === null ? tc.table.noUsage : `${tc.table.reserve} ${formatOneDecimal(c.productionDays, locale)} ${tc.table.productionDays}`);
  /** Poslední pracovní den před dnem `short` (index); null, když chybí už dnes. */
  const lastDayBefore = (short: number | null): DayNumber | null => {
    for (let k = (short ?? days.length) - 1; k >= 0; k--) if (weekday(days[k]!) <= 5) return days[k]!;
    return null;
  };
  const untilText = (short: number | null) => {
    // Vystačí na celý horizont: poslední pracovní den horizontu „a déle“.
    if (short === null) return `${dayLabel(lastDayBefore(null) ?? days.at(-1)!)} ${tc.table.orLater}`;
    const until = lastDayBefore(short);
    return until === null ? tc.table.notCovered : dayLabel(until);
  };
  const coveredText = (c: ComponentLine) => untilText(c.shortDay);
  const customerText = (c: ComponentLine) => untilText(c.customerShortDay);
  /** Den „Zákazník pokryt do“ v řádku dnů (rámeček); null, když vystačí na celý horizont nebo chybí už dnes. */
  const customerDay = (c: ComponentLine) => (c.customerShortDay === null ? null : lastDayBefore(c.customerShortDay));

  const buildExport = (): ExportTable => ({
    fileName: fileBase,
    sheetName: tc.export.sheet,
    header: [
      tc.table.item,
      tc.table.description,
      tc.table.um,
      tc.table.source,
      tc.table.stock,
      tc.table.need,
      tc.table.until,
      tc.table.reserveHead,
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
      round(need7(c)),
      coveredText(c),
      c.productionDays === null ? null : Math.round(c.productionDays * 10) / 10,
      customerText(c),
      c.products.join(', '),
      ...c.balance.map(round),
    ]),
  });
  const buildDemandExport = (): ExportTable => ({
    fileName: `${fileBase}_${tc.export.demandSheet.toLowerCase()}`,
    sheetName: tc.export.demandSheet,
    header: [tc.demand.item, tc.demand.description, tc.demand.project, tc.demand.total, ...days.map(dayToIso)],
    rows: [
      ...shownProducts.map((p) => [p.item, p.description, p.project, sum(p.production.slice(0, NEED_DAYS)), ...p.production]),
      [tc.demand.sum, '', '', sum(productionTotals.slice(0, NEED_DAYS)), ...productionTotals],
    ],
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
          <span className="kpi-value">{formatQuantity(toProduce, locale)}</span>
          <span className="kpi-note">
            {tc.kpi.demandNote} {formatQuantity(products.length, locale)}
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
        <span className="filters-break" role="presentation" />
        <label className="check-field" title={tc.filters.netOwnStockTitle}>
          <input type="checkbox" checked={netOwnStock} onChange={(e) => setNetOwnStock(e.target.checked)} />
          {tc.filters.netOwnStock}
        </label>
      </div>

      {withoutProject.length > 0 && (
        <p className="muted">
          {tc.withoutProject}: {formatQuantity(withoutProject.length, locale)} ({withoutProject.slice(0, 5).join(', ')}
          {withoutProject.length > 5 ? ', …' : ''})
        </p>
      )}

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
                  <th className="n">{tc.table.need}</th>
                  <th>{tc.table.until}</th>
                  <th title={tc.table.customerTitle}>{tc.table.customer}</th>
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
                    <td className="n">{amount(need7(c), c.um)}</td>
                    <td className="cell-until">
                      <strong className={c.shortDay === null ? undefined : 'cell-short'}>{coveredText(c)}</strong>
                      <small className="muted cell-note">{reserve(c)}</small>
                    </td>
                    <td className="cell-until" title={tc.table.customerTitle}>
                      <strong className={c.customerShortDay === null ? undefined : 'cell-short'}>{customerText(c)}</strong>
                    </td>
                    {c.balance.map((v, k) => {
                      const framed = customerDay(c) === days[k];
                      return (
                        <td
                          key={k}
                          className={`n${weekend(days[k]!)}${v < -1e-9 ? ' cell-negative' : ''}${framed ? ' cell-customer' : ''}`}
                          title={framed ? tc.legend.customer : undefined}
                        >
                          {amount(v, c.um)}
                        </td>
                      );
                    })}
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
        <ul className="cov-legend">
          <li>
            <i className="swatch swatch-negative" /> {tc.legend.negative}
          </li>
          <li>
            <i className="swatch swatch-customer" /> {tc.legend.customer}
          </li>
          <li>
            <i className="swatch swatch-weekend" /> {tc.legend.weekend}
          </li>
        </ul>
        <p className="muted">{netOwnStock ? tc.table.note : tc.table.noteGross}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.demand.heading}</h2>
          <span className="muted">
            {netOwnStock ? tc.demand.subNet : tc.demand.sub}
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
                  <td className="n">{formatQuantity(sum(p.production.slice(0, NEED_DAYS)), locale)}</td>
                  {p.production.map((q, k) => (
                    <td key={k} className={`n${weekend(days[k]!)}`}>
                      {q === 0 ? <span className="muted">0</span> : formatQuantity(q, locale)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {shownProducts.length > 0 && (
              <tfoot>
                <tr className="row-total">
                  <td className="sticky-col">
                    <strong>{tc.demand.sum}</strong>
                  </td>
                  <td />
                  <td />
                  <td className="n">{formatQuantity(sum(productionTotals.slice(0, NEED_DAYS)), locale)}</td>
                  {productionTotals.map((q, k) => (
                    <td key={k} className={`n${weekend(days[k]!)}`}>
                      {formatQuantity(q, locale)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!callOffs && <p className="muted">{tc.demand.noCallOffs}</p>}
        {shownProducts.length === 0 && <p>{tc.demand.empty}</p>}
        <p className="muted">{netOwnStock ? tc.demand.note : tc.demand.noteGross}</p>
      </div>
    </section>
  );
}
