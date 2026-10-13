import { useMemo, type ReactNode } from 'react';
import { callOffSummary } from '../core/calloffs/views';
import { formatQuantity } from '../core/format';
import { useI18n } from '../i18n/I18nProvider';
import { useData } from './data/DataProvider';
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

function useMetrics(): Partial<Record<ModuleId, ReactNode>> {
  const { t, locale } = useI18n();
  const { state } = useData();
  const exports = state.data?.exports;
  const summary = useMemo(() => {
    const current = exports?.at(-1);
    return current ? callOffSummary(current, exports!.at(-2)) : null;
  }, [exports]);

  if (!summary) return {};
  const tm = t.hub.metrics;
  if (summary.changes === null || !summary.previous) {
    return { calloffs: <Metric value={`CW ${summary.week}`} label={tm.currentExport} /> };
  }
  const form = new Intl.PluralRules(locale).select(summary.changes);
  const label = form === 'one' ? tm.changes.one : form === 'few' ? tm.changes.few : tm.changes.other;
  return {
    calloffs: (
      <Metric
        value={formatQuantity(summary.changes, locale)}
        label={label}
        tone={summary.changes > 0 ? 'warn' : 'ok'}
        title={`${tm.changesTitle}: CW ${summary.week}/${summary.year} ${tm.against} CW ${summary.previous.week}/${summary.previous.year}`}
      />
    ),
  };
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
