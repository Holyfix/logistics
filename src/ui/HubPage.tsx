import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './icons';
import { GROUPS, MODULES, type ModuleDef } from './modules';

function StatusChip({ module }: { module: ModuleDef }) {
  const { t } = useI18n();
  if (module.status.kind === 'planned') {
    return (
      <span className="chip tile-chip">
        {t.hub.phase} {module.status.phase}
      </span>
    );
  }
  if (module.status.kind === 'later') return <span className="chip tile-chip">{t.hub.later}</span>;
  return null;
}

export function HubPage() {
  const { t } = useI18n();

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head">
        <h1 id="page-title">{t.hub.title}</h1>
        <p className="lead">{t.hub.intro}</p>
      </div>
      <div className="groups">
        {GROUPS.map((group) => (
          <div key={group} className={`group group-${group}`}>
            <h2 className="group-title">{t.hub.groups[group]}</h2>
            <div className="tiles">
              {MODULES.filter((m) => m.group === group).map((m) => {
                const text = t.modules[m.id];
                return (
                  <a key={m.id} href={`#${m.id}`} className={`tile tile-${m.status.kind}`}>
                    <StatusChip module={m} />
                    <span className="tile-top">
                      <span className="tile-icon">
                        <Icon name={m.icon} />
                      </span>
                      <span className="tile-title">
                        {text.title}
                        <small>{text.subtitle}</small>
                      </span>
                    </span>
                    <span className="tile-text">{text.description}</span>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
