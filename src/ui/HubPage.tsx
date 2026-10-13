import { useMemo, type ReactNode } from 'react';
import { callOffSummary } from '../core/calloffs/views';
import { COMPONENT_SOON_DAYS } from '../core/components/compute';
import { buildCoverage, SHORTAGE_DAYS, shortage } from '../core/coverage/compute';
import { formatQuantity } from '../core/format';
import { useI18n } from '../i18n/I18nProvider';
import { useData } from './data/DataProvider';
import { localToday, useComponents } from './components/useComponents';
import { Icon } from './icons';
import { GROUPS, MODULES, type ModuleDef, type ModuleId } from './modules';

function StatusChip({ module }: { module: ModuleDef }) {
  const { t } = useI18n();
  if (module.status.kind === 'planned') {
    return (
      <span className="chip">
        {t.hub.phase} {module.status.phase}
      </span>
    );
  }
  if (module.status.kind === 'later') return <span className="chip">{t.hub.later}</span>;
  return null;
}

type Tone = 'ok' | 'warn' | 'crit';

/** Hlavní číslo modulu na rozcestníku. Stav je odlišený tvarem i barvou značky. */
function Metric({ value, label, tone, title }: { value: string; label: string; tone?: Tone; title?: string }) {
  return (
    <span className="metric" title={title}>
      <b>{value}</b> {label}
      {tone && <i className={`dot dot-${tone}`} aria-hidden="true" />}
    </span>
  );
}

/** Dvě čísla nad sebou (např. bez transitu a s transitem) se společnou značkou stavu. */
function MetricRows({ rows, tone, title }: { rows: { value: string; label: string }[]; tone: Tone; title: string }) {
  return (
    <span className="metric metric-rows" title={title}>
      <span>
        {rows.map((r) => (
          <span key={r.label}>
            <b>{r.value}</b> {r.label}
          </span>
        ))}
      </span>
      <i className={`dot dot-${tone}`} aria-hidden="true" />
    </span>
  );
}

function useMetrics(): Partial<Record<ModuleId, ReactNode>> {
  const { t, locale } = useI18n();
  const { state } = useData();
  const exports = state.data?.exports;
  const coverage = state.data?.coverage;
  const master = state.data?.master?.data;
  const summary = useMemo(() => {
    const current = exports?.at(-1);
    return current ? callOffSummary(current, exports!.at(-2)) : null;
  }, [exports]);
  // Chybějící kusy v prvních 2 dnech podle souborů zákazníka, bez transitu a s transitem (bez našeho skladu).
  const missing = useMemo(() => {
    if (!coverage?.length) return null;
    const pieces = (transit: boolean) => shortage(buildCoverage(coverage, master, { transit }).lines, SHORTAGE_DAYS);
    return { withoutTransit: pieces(false), withTransit: pieces(true) };
  }, [coverage, master]);

  const components = useComponents(useMemo(localToday, []));

  const metrics: Partial<Record<ModuleId, ReactNode>> = {};
  const tm = t.hub.metrics;
  if (summary?.changes === null || (summary && !summary.previous)) {
    metrics.calloffs = <Metric value={`CW ${summary.week}`} label={tm.currentExport} />;
  } else if (summary?.previous) {
    const changes = summary.changes!;
    const form = new Intl.PluralRules(locale).select(changes);
    const label = form === 'one' ? tm.changes.one : form === 'few' ? tm.changes.few : tm.changes.other;
    metrics.calloffs = (
      <Metric
        value={formatQuantity(changes, locale)}
        label={label}
        tone={changes > 0 ? 'warn' : 'ok'}
        title={`${tm.changesTitle}: CW ${summary.week}/${summary.year} ${tm.against} CW ${summary.previous.week}/${summary.previous.year}`}
      />
    );
  }
  if (missing !== null) {
    const th = t.coverage.hub;
    const { withoutTransit: a, withTransit: b } = missing;
    const pcs = (n: number) => `${formatQuantity(n, locale)} ${t.calloffs.table.unit}`;
    // Kritické, když chybí i s transitem; pozor, když chybí jen bez transitu.
    const tone: Tone = b.pieces > 0 ? 'crit' : a.pieces > 0 ? 'warn' : 'ok';
    metrics.coverage = (
      <MetricRows
        rows={[
          { value: pcs(a.pieces), label: th.withoutTransit },
          { value: pcs(b.pieces), label: th.withTransit },
        ]}
        tone={tone}
        title={`${th.title}: ${th.withoutTransit} ${pcs(a.pieces)} (${th.parts} ${formatQuantity(a.parts, locale)}), ${th.withTransit} ${pcs(b.pieces)} (${th.parts} ${formatQuantity(b.parts, locale)})`}
      />
    );
  }
  if (components) {
    const soon = components.components.filter((c) => c.shortDay !== null && c.shortDay < COMPONENT_SOON_DAYS).length;
    metrics.components = <Metric value={formatQuantity(soon, locale)} label={t.components.hub.label} tone={soon > 0 ? 'crit' : 'ok'} title={t.components.hub.title} />;
  }
  return metrics;
}

/** Rozcestník: každá skupina je karta, moduly jsou v ní řádky. Karty se skládají do sloupců. */
export function HubPage() {
  const { t } = useI18n();
  const metrics = useMetrics();

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head">
        <h1 id="page-title">{t.hub.title}</h1>
        <p className="lead">{t.hub.intro}</p>
      </div>
      <div className="hub">
        {GROUPS.map((group) => (
          <section key={group} className="hub-card" aria-labelledby={`group-${group}`}>
            <h2 id={`group-${group}`} className="hub-card-title">
              {t.hub.groups[group]}
            </h2>
            {MODULES.filter((m) => m.group === group).map((m) => {
              const text = t.modules[m.id];
              return (
                <a key={m.id} href={`#${m.id}`} className={`hub-item hub-item-${m.status.kind}`}>
                  <span className="module-icon">
                    <Icon name={m.icon} />
                  </span>
                  <span className="hub-item-name">
                    {text.title}
                    <small>{text.subtitle}</small>
                  </span>
                  {metrics[m.id]}
                  <StatusChip module={m} />
                </a>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}
