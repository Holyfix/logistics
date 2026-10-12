import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './icons';
import { GROUPS, MODULES, type ModuleDef } from './modules';

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

/** Rozcestník: každá skupina je karta, moduly jsou v ní řádky. Karty se skládají do sloupců. */
export function HubPage() {
  const { t } = useI18n();

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
