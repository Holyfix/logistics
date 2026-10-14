import { useMemo, useState } from 'react';
import { buildCoverage } from '../../core/coverage/compute';
import {
  callOffDigest,
  componentAlerts,
  customerAlerts,
  dataFreshness,
  type CallOffAlert,
  type ComponentAlert,
  type CustomerAlert,
  type Freshness,
  type Severity,
} from '../../core/dashboard';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatPercent, formatQuantity, formatSigned } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import { localToday, useComponents } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';

/** Kolik řádků ukazují seznamy, než se rozbalí. */
const LIST_ROWS = 8;

const Dot = ({ tone }: { tone: Severity | 'ok' }) => <i className={`dot dot-${tone}`} aria-hidden="true" />;

/** Dashboard: co je dnes potřeba řešit z dostupných modulů, jako dlaždice se seznamy. */
export function DashboardPage({ today = localToday(), now = Date.now() }: { today?: DayNumber; now?: number } = {}) {
  const { t, locale } = useI18n();
  const td = t.dashboard;
  const { state } = useData();
  const data = state.data;
  const components = useComponents(today);

  const customer = useMemo(() => {
    if (!data?.coverage.length) return null;
    const master = data.master?.data;
    return customerAlerts(buildCoverage(data.coverage, master, { transit: true }), buildCoverage(data.coverage, master, { transit: false }), today);
  }, [data, today]);
  const componentList = useMemo(() => (components ? componentAlerts(components) : null), [components]);
  const calloffs = useMemo(() => {
    const current = data?.exports.at(-1);
    return current ? callOffDigest(current, data!.exports.at(-2)) : null;
  }, [data]);
  const freshness = useMemo(
    () =>
      data
        ? dataFreshness({ callOffs: data.exports.at(-1), coverage: data.coverage, stock: data.stock, boms: data.boms, master: data.master, today, now })
        : [],
    [data, today, now],
  );

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="dashboard" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.dashboard.title}</h1>
        <p className="lead">{t.modules.dashboard.description}</p>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{td.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {td.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const pcs = (n: number) => `${formatQuantity(n, locale)} ${td.pcs}`;
  const dayLabel = (d: DayNumber) => {
    if (d === today) return td.today;
    if (d === today + 1) return td.tomorrow;
    return `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  };
  const modifiedLabel = (ms: number | null) => {
    if (ms === null) return '—';
    const hours = Math.floor((now - ms) / 3_600_000);
    if (hours < 1) return td.data.justNow;
    if (hours < 24) return td.data.hoursAgo.replace('{n}', String(hours));
    const date = new Date(ms);
    return formatDayShort(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, locale);
  };
  const sourceLabel = (f: Freshness) => td.data.kinds[f.kind];
  /** Zákazník pokryt do: den před prvním chybějícím dnem (i víkend); chybí už dnes = nepokryto. */
  const coveredUntil = (shortDay: DayNumber) => (shortDay <= today ? td.components.notCovered : dayLabel(shortDay - 1));
  const count = <T extends { severity: Severity }>(list: readonly T[] | null, s: Severity) => (list ?? []).filter((a) => a.severity === s).length;
  const stale = freshness.filter((f) => f.stale);

  const tiles = (
    <div className="kpis">
      <a className="kpi kpi-link" href="#coverage">
        <span className="kpi-label">{t.modules.coverage.title}</span>
        <span className="kpi-value">
          {customer ? formatQuantity(count(customer, 'crit'), locale) : '—'} <Dot tone={!customer ? 'warn' : count(customer, 'crit') ? 'crit' : count(customer, 'warn') ? 'warn' : 'ok'} />
        </span>
        <span className="kpi-note">
          {customer
            ? `${td.customer.tile} · ${td.customer.tileWarn} ${formatQuantity(count(customer, 'warn'), locale)} · ${td.customer.tileInfo} ${formatQuantity(count(customer, 'info'), locale)}`
            : td.customer.noCoverage}
        </span>
      </a>
      <a className="kpi kpi-link" href="#components">
        <span className="kpi-label">{t.modules.components.title}</span>
        <span className="kpi-value">
          {componentList ? formatQuantity(count(componentList, 'crit'), locale) : '—'}{' '}
          <Dot tone={!componentList ? 'warn' : count(componentList, 'crit') ? 'crit' : count(componentList, 'warn') ? 'warn' : 'ok'} />
        </span>
        <span className="kpi-note">{componentList ? `${td.components.tile} · ${td.components.tileWarn} ${formatQuantity(count(componentList, 'warn'), locale)}` : td.components.noBom}</span>
      </a>
      <a className="kpi kpi-link" href="#calloffs">
        <span className="kpi-label">{t.modules.calloffs.title}</span>
        <span className="kpi-value">
          {calloffs?.previous ? formatQuantity(calloffs.changes, locale) : '—'}{' '}
          <Dot tone={!calloffs ? 'warn' : calloffs.backlogParts > 0 || count(calloffs.alerts, 'warn') > 0 ? 'warn' : 'ok'} />
        </span>
        <span className="kpi-note">
          {!calloffs
            ? td.calloffs.noExport
            : `${calloffs.previous ? `${td.calloffs.tile} · CW ${calloffs.week} ${td.calloffs.against} CW ${calloffs.previous.week}` : td.calloffs.noPrevious} · ${td.calloffs.backlog} ${pcs(calloffs.backlogPieces)}`}
        </span>
      </a>
      <a className="kpi kpi-link" href="#data">
        <span className="kpi-label">{td.data.heading}</span>
        <span className="kpi-value">
          {formatQuantity(stale.length, locale)} <Dot tone={stale.length ? 'warn' : 'ok'} />
        </span>
        <span className="kpi-note">{stale.length ? `${td.data.tile}: ${stale.map(sourceLabel).filter((v, i, all) => all.indexOf(v) === i).join(', ')}` : td.data.allFresh}</span>
      </a>
    </div>
  );

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      {tiles}

      <div className="dash-grid">
          <CustomerPanel alerts={customer} dayLabel={dayLabel} pcs={pcs} />
          <ComponentPanel alerts={componentList} dayLabel={dayLabel} coveredUntil={coveredUntil} pcs={pcs} />
          <CallOffPanel digest={calloffs} pcs={pcs} />
          <div className="panel">
            <div className="panel-head">
              <h2>{td.data.heading}</h2>
              <span className="muted">{td.data.sub}</span>
            </div>
            <div className="table-scroll">
              <table className="table table-data">
                <thead>
                  <tr>
                    <th>{td.data.source}</th>
                    <th>{td.data.file}</th>
                    <th>{td.data.modified}</th>
                    <th>{td.data.state}</th>
                  </tr>
                </thead>
                <tbody>
                  {freshness.map((f) => (
                    <tr key={`${f.kind}|${f.label}`}>
                      <td>{sourceLabel(f)}</td>
                      <td>{f.label || '—'}</td>
                      <td>{f.week ? `CW ${f.week.week}/${f.week.year}` : modifiedLabel(f.modified)}</td>
                      <td>
                        <Dot tone={f.stale ? 'warn' : 'ok'} /> {f.missing ? td.data.missing : f.stale ? td.data.stale : td.data.fresh}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

    </section>
  );
}

function useShowAll() {
  const [all, setAll] = useState(false);
  return { all, toggle: () => setAll((v) => !v) };
}

function MoreButton({ total, shown, all, toggle }: { total: number; shown: number; all: boolean; toggle: () => void }) {
  const { t, locale } = useI18n();
  if (total <= shown && !all) return null;
  return (
    <button type="button" className="link-button" onClick={toggle}>
      {all ? t.dashboard.showLess : `${t.dashboard.showAll} (${formatQuantity(total, locale)})`}
    </button>
  );
}

function CustomerPanel({ alerts, dayLabel, pcs }: { alerts: CustomerAlert[] | null; dayLabel: (d: DayNumber) => string; pcs: (n: number) => string }) {
  const { t } = useI18n();
  const tc = t.dashboard.customer;
  const { all, toggle } = useShowAll();
  const rows = all ? (alerts ?? []) : (alerts ?? []).slice(0, LIST_ROWS);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tc.heading}</h2>
        <span className="muted">{tc.sub}</span>
        <a className="panel-actions link-button" href="#coverage">
          {t.dashboard.open} →
        </a>
      </div>
      {!alerts ? (
        <p className="muted">{tc.noCoverage}</p>
      ) : alerts.length === 0 ? (
        <p className="muted">{t.dashboard.none}</p>
      ) : (
        <div className="table-scroll">
          <table className="table table-data">
            <thead>
              <tr>
                <th>{tc.item}</th>
                <th>{tc.project}</th>
                <th>{tc.from}</th>
                <th className="n">{tc.missing}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Dot tone={a.severity} /> <strong>{a.item || a.customerNumber}</strong>
                    <small className="muted cell-note">{a.transitOnly ? tc.transitOnly : a.customerNumber}</small>
                  </td>
                  <td>
                    {a.project || '—'}
                    {a.location && <small className="muted cell-note">{a.location}</small>}
                  </td>
                  <td>{dayLabel(a.day)}</td>
                  <td className="n">{pcs(a.missing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton total={alerts?.length ?? 0} shown={LIST_ROWS} all={all} toggle={toggle} />
    </div>
  );
}

function ComponentPanel({
  alerts,
  dayLabel,
  coveredUntil,
  pcs,
}: {
  alerts: ComponentAlert[] | null;
  dayLabel: (d: DayNumber) => string;
  coveredUntil: (d: DayNumber) => string;
  pcs: (n: number) => string;
}) {
  const { t } = useI18n();
  const tc = t.dashboard.components;
  const { all, toggle } = useShowAll();
  const rows = all ? (alerts ?? []) : (alerts ?? []).slice(0, LIST_ROWS);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tc.heading}</h2>
        <span className="muted">{tc.sub}</span>
        <a className="panel-actions link-button" href="#components">
          {t.dashboard.open} →
        </a>
      </div>
      {!alerts ? (
        <p className="muted">{tc.noBom}</p>
      ) : alerts.length === 0 ? (
        <p className="muted">{t.dashboard.none}</p>
      ) : (
        <div className="table-scroll">
          <table className="table table-data">
            <thead>
              <tr>
                <th>{tc.item}</th>
                <th>{tc.day}</th>
                <th className="n">{tc.missing}</th>
                <th>{tc.customer}</th>
                <th>{tc.products}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.item}>
                  <td>
                    <Dot tone={a.severity} /> <strong>{a.item}</strong>
                    {a.description && <small className="muted cell-note">{a.description}</small>}
                  </td>
                  <td>{dayLabel(a.day)}</td>
                  <td className="n">{pcs(a.missing)}</td>
                  <td>{a.customerShortDay === null ? '—' : coveredUntil(a.customerShortDay)}</td>
                  <td>
                    {a.products.slice(0, 3).join(', ')}
                    {a.products.length > 3 && ` +${a.products.length - 3}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton total={alerts?.length ?? 0} shown={LIST_ROWS} all={all} toggle={toggle} />
    </div>
  );
}

function CallOffPanel({ digest, pcs }: { digest: ReturnType<typeof callOffDigest> | null; pcs: (n: number) => string }) {
  const { t, locale } = useI18n();
  const tc = t.dashboard.calloffs;
  const { all, toggle } = useShowAll();
  const alerts: CallOffAlert[] = digest?.alerts ?? [];
  const rows = all ? alerts : alerts.slice(0, LIST_ROWS);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{tc.heading}</h2>
        <span className="muted">{digest?.previous ? `${tc.sub}: CW ${digest.week} ${tc.against} CW ${digest.previous.week}` : tc.sub}</span>
        <a className="panel-actions link-button" href="#calloffs">
          {t.dashboard.open} →
        </a>
      </div>
      {!digest ? (
        <p className="muted">{tc.noExport}</p>
      ) : (
        <>
          {!digest.previous && <p className="muted">{tc.noPrevious}</p>}
          {alerts.length === 0 ? (
            <p className="muted">{t.dashboard.none}</p>
          ) : (
            <div className="table-scroll">
              <table className="table table-data">
                <thead>
                  <tr>
                    <th>{tc.item}</th>
                    <th className="n">{tc.diff}</th>
                    <th className="n">{tc.percent}</th>
                    <th className="n">{tc.weeks}</th>
                    <th className="n">{tc.backlogCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.item}>
                      <td>
                        <Dot tone={a.severity} /> <strong>{a.item}</strong>
                        {a.description && <small className="muted cell-note">{a.description}</small>}
                      </td>
                      <td className="n">{formatSigned(a.diff, locale)}</td>
                      <td className="n">{a.percent === null ? '—' : formatPercent(a.percent, locale, true)}</td>
                      <td className="n">{formatQuantity(a.changedWeeks, locale)}</td>
                      <td className="n">{a.backlog > 0 ? pcs(a.backlog) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <MoreButton total={alerts.length} shown={LIST_ROWS} all={all} toggle={toggle} />
    </div>
  );
}
