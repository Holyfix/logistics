import { useMemo, type ReactNode } from 'react';
import { buildCoverage, SHORTAGE_DAYS } from '../../core/coverage/compute';
import { callOffDigest, componentAlerts, dataFreshness, oilAlerts, projectCoverage, type CoverageSpan, type ProjectCoverage, type Severity } from '../../core/dashboard';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatPercent, formatQuantity, formatSigned } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import { localToday, useComponents } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon, type IconName } from '../icons';
import { useOilDraftList } from '../oil/OilProvider';
import { useMappingCheck } from '../data/MappingPanels';
import { checkCount } from '../../core/mappingCheck';

/** Kolik nejnaléhavějších položek ukazuje karta. */
const CARD_LINES = 4;

type Tone = Severity | 'ok';

const Dot = ({ tone }: { tone: Tone }) => <i className={`dot dot-${tone}`} aria-hidden="true" />;

/** Nejhorší stav z položek; bez dat pozor, bez položek v pořádku. */
function worstOf(list: readonly { severity: Severity }[] | null): Tone {
  if (!list) return 'warn';
  if (list.some((a) => a.severity === 'crit')) return 'crit';
  if (list.some((a) => a.severity === 'warn')) return 'warn';
  return 'ok';
}

interface Line {
  key: string;
  tone: Tone;
  text: ReactNode;
  value: string;
}

interface Card {
  id: string;
  title: string;
  icon: IconName;
  href: string;
  tone: Tone;
  /** Hlavní číslo; null = data chybí. */
  value: number | null;
  label: string;
  counters: { value: number; label: string }[];
  lines: Line[];
  /** Pokrytí po projektech místo řádků; každý projekt je odkaz do Coverage s filtrem projektu. */
  projects?: ProjectCoverage[];
  /** Text místo čísla, když data chybí. */
  empty: string;
}

/** Dashboard: každá oblast jedna karta se stavem, hlavním číslem a nejnaléhavějšími položkami. */
export function DashboardPage({ today = localToday(), now = Date.now() }: { today?: DayNumber; now?: number } = {}) {
  const { t, locale } = useI18n();
  const td = t.dashboard;
  const { state } = useData();
  const data = state.data;
  const components = useComponents(today);
  const oilDraft = useOilDraftList();
  const mapping = useMappingCheck();
  const mappingIssues = mapping ? checkCount(mapping) : 0;
  const oilList = oilDraft ?? data?.oil?.list ?? null;

  const coverage = useMemo(() => {
    if (!data?.coverage.length) return null;
    const master = data.master?.data;
    return { withTransit: buildCoverage(data.coverage, master, { transit: true }), withoutTransit: buildCoverage(data.coverage, master, { transit: false }) };
  }, [data]);
  const projects = useMemo(() => (coverage ? projectCoverage(coverage.withTransit, coverage.withoutTransit, today) : null), [coverage, today]);
  const componentList = useMemo(() => (components ? componentAlerts(components) : null), [components]);
  const oil = useMemo(() => (oilList ? oilAlerts(oilList, today) : null), [oilList, today]);
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
  const ago = (ms: number | null) => {
    if (ms === null) return '';
    const hours = Math.floor((now - ms) / 3_600_000);
    if (hours < 1) return td.data.justNow;
    if (hours < 24) return td.data.hoursAgo.replace('{n}', String(hours));
    const date = new Date(ms);
    return formatDayShort(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, locale);
  };
  const count = (list: readonly { severity: Severity }[] | null, s: Severity) => (list ?? []).filter((a) => a.severity === s).length;
  /** Pokryto do + počet dní (červeně méně než 2 dny; „+“ = celý horizont souboru). */
  const span = (c: CoverageSpan) => (
    <>
      <span className={c.until === null ? 'cell-short' : undefined}>{c.until === null ? td.customer.notCovered : dayLabel(c.until)}</span>{' '}
      <b className={!c.whole && c.days < SHORTAGE_DAYS ? 'cell-short' : undefined} title={c.whole ? td.customer.whole : undefined}>
        {formatQuantity(c.days, locale)}
        {c.whole && '+'}
      </b>
    </>
  );
  const stale = freshness.filter((f) => f.stale);

  const cards: Card[] = [
    {
      id: 'customer',
      title: td.customer.title,
      icon: 'coverage',
      href: '#coverage',
      tone: projects ? worstOf(projects.flatMap((p) => (p.severity ? [{ severity: p.severity }] : []))) : 'warn',
      value: projects ? projects.filter((p) => p.severity === 'crit').length : null,
      label: td.customer.main,
      counters: projects
        ? [
            { value: projects.filter((p) => p.severity === 'warn').length, label: td.customer.transit },
            { value: projects.length, label: td.customer.projects },
          ]
        : [],
      lines: [],
      ...(projects ? { projects } : {}),
      empty: td.customer.none,
    },
    {
      id: 'components',
      title: td.components.title,
      icon: 'components',
      href: '#components',
      tone: worstOf(componentList),
      value: componentList ? count(componentList, 'crit') : null,
      label: td.components.main,
      counters: [
        { value: count(componentList, 'warn'), label: td.components.week },
        { value: count(componentList, 'info'), label: td.components.later },
      ],
      lines: (componentList ?? []).map((a) => ({
        key: a.item,
        tone: a.severity,
        text: (
          <>
            <strong>{a.item}</strong> {a.description}
          </>
        ),
        value: `${dayLabel(a.day)} · ${pcs(a.missing)}`,
      })),
      empty: td.components.none,
    },
    {
      id: 'oil',
      title: td.oil.title,
      icon: 'actions',
      href: '#oil',
      tone: worstOf(oil),
      value: oil ? count(oil, 'crit') : null,
      label: td.oil.main,
      counters: [
        { value: count(oil, 'warn'), label: td.oil.week },
        { value: oil?.length ?? 0, label: td.oil.open },
      ],
      lines: (oil ?? []).map(({ item, severity }) => ({
        key: String(item.id),
        tone: severity,
        text: (
          <>
            <strong>{item.id}</strong> {item.problem || t.oil.noProblem}
            {item.owner && <span className="muted"> · {item.owner}</span>}
          </>
        ),
        value: `${item.due === null ? t.oil.noDue : dayLabel(item.due)}${item.shifts.length ? ` · ${td.oil.shifted} ${item.shifts.length}${t.oil.times}` : ''}`,
      })),
      empty: td.oil.none,
    },
    {
      id: 'calloffs',
      title: td.calloffs.title,
      icon: 'calloffs',
      href: '#calloffs',
      tone: !calloffs ? 'warn' : calloffs.alerts.some((a) => a.severity === 'warn') ? 'warn' : 'ok',
      value: calloffs ? calloffs.changes : null,
      label: calloffs?.previous ? `${td.calloffs.main} · CW ${calloffs.week} ${td.calloffs.against} CW ${calloffs.previous.week}` : `${td.calloffs.main} · ${td.calloffs.single}`,
      counters: calloffs ? [{ value: calloffs.backlogPieces, label: `${td.pcs} ${td.calloffs.backlog}` }] : [],
      lines: (calloffs?.alerts ?? []).map((a) => ({
        key: a.item,
        tone: a.severity,
        text: (
          <>
            <strong>{a.item}</strong> {a.description}
          </>
        ),
        value:
          a.backlog > 0
            ? `${td.calloffs.backlog} ${pcs(a.backlog)}`
            : `${formatSigned(a.diff, locale)} ${td.pcs}${a.percent === null ? '' : ` (${formatPercent(a.percent, locale, true)})`}`,
      })),
      empty: td.calloffs.none,
    },
    {
      id: 'data',
      title: td.data.title,
      icon: 'data',
      href: '#data',
      tone: stale.length ? 'warn' : 'ok',
      value: stale.length,
      label: td.data.main,
      counters: mapping ? [{ value: mappingIssues, label: td.data.mapping }] : [],
      lines: [
        ...stale.map((f) => ({
          key: `${f.kind}|${f.label}`,
          tone: 'warn' as const,
          text: (
            <>
              <strong>{td.data.kinds[f.kind]}</strong> {f.label}
            </>
          ),
          value: f.missing ? td.data.missing : `${td.data.stale} · ${f.week ? `CW ${f.week.week}` : ago(f.modified)}`,
        })),
        // Kontrola mapování: kolik dílů doplnit v Item_Mapping (detail v modulu Data).
        ...(mappingIssues
          ? [
              {
                key: 'mapping',
                tone: 'info' as const,
                text: (
                  <>
                    <strong>{td.data.kinds.master}</strong> {td.data.mappingLine}
                  </>
                ),
                value: `${formatQuantity(mappingIssues, locale)} ${t.data.check.parts}`,
              },
            ]
          : []),
      ],
      empty: '',
    },
  ];

  const summary = (['crit', 'warn', 'ok'] as const).map((tone) => ({ tone, n: cards.filter((c) => c.tone === tone).length })).filter((s) => s.n > 0);

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head-row">
        {head}
        <p className="dash-summary">
          {summary.map((s) => (
            <span key={s.tone}>
              <Dot tone={s.tone} /> {formatQuantity(s.n, locale)} {td.summary[s.tone]}
            </span>
          ))}
        </p>
      </div>

      <div className="dash-cards">
        {cards.map((card) =>
          card.projects ? (
            // Karta s odkazy uvnitř: hlavička a čísla vedou do modulu, každý projekt do Coverage s filtrem projektu.
            <div key={card.id} className={`dash-card dash-${card.tone}`}>
              <a className="dash-card-hit" href={card.href}>
                <span className="dash-card-head">
                  <span className="dash-card-title">
                    <Icon name={card.icon} /> {card.title}
                  </span>
                  <Dot tone={card.tone} />
                </span>
                <span className="dash-main">
                  <b>{formatQuantity(card.value ?? 0, locale)}</b> <span>{card.label}</span>
                </span>
                <span className="dash-counters">
                  {card.counters.map((c) => (
                    <span key={c.label}>
                      <b>{formatQuantity(c.value, locale)}</b> {c.label}
                    </span>
                  ))}
                </span>
              </a>
              <div className="dash-projects" role="table" aria-label={td.customer.title}>
                <div className="dash-projects-head" role="row">
                  <span role="columnheader">{td.customer.project}</span>
                  <span role="columnheader">{td.customer.withoutTransit}</span>
                  <span role="columnheader">{td.customer.withTransit}</span>
                </div>
                {card.projects.map((p) => (
                  <a key={p.project} className="dash-projects-row" role="row" href={p.project ? `#coverage?project=${encodeURIComponent(p.project)}` : '#coverage'}>
                    <span role="cell">
                      <Dot tone={p.severity ?? 'ok'} /> <strong>{p.project || td.customer.noProject}</strong>
                    </span>
                    <span role="cell">{span(p.withoutTransit)}</span>
                    <span role="cell">{span(p.withTransit)}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : (
          <a key={card.id} className={`dash-card dash-${card.tone}`} href={card.href}>
            <span className="dash-card-head">
              <span className="dash-card-title">
                <Icon name={card.icon} /> {card.title}
              </span>
              <Dot tone={card.tone} />
            </span>
            {card.value === null ? (
              <span className="dash-empty muted">{card.empty}</span>
            ) : (
              <>
                <span className="dash-main">
                  <b>{formatQuantity(card.value, locale)}</b> <span>{card.label}</span>
                </span>
                {card.counters.length > 0 && (
                  <span className="dash-counters">
                    {card.counters.map((c) => (
                      <span key={c.label}>
                        <b>{formatQuantity(c.value, locale)}</b> {c.label}
                      </span>
                    ))}
                  </span>
                )}
                {card.lines.length === 0 ? (
                  <span className="dash-empty muted">{td.allGood}</span>
                ) : (
                  <ul className="dash-lines">
                    {card.lines.slice(0, CARD_LINES).map((line) => (
                      <li key={line.key}>
                        <Dot tone={line.tone} />
                        <span className="dash-line-text">{line.text}</span>
                        <span className="dash-line-value">{line.value}</span>
                      </li>
                    ))}
                    {card.lines.length > CARD_LINES && (
                      <li className="dash-more muted">
                        {td.more} {formatQuantity(card.lines.length - CARD_LINES, locale)} →
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
          </a>
          ),
        )}
      </div>

    </section>
  );
}
