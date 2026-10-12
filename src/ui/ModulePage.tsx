import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './icons';
import type { ModuleDef } from './modules';

/** Zástupná stránka modulu, dokud modul není hotový. */
export function ModulePage({ module }: { module: ModuleDef }) {
  const { t } = useI18n();
  const text = t.modules[module.id];
  const note = module.status.kind === 'later' ? t.module.laterNote : t.module.plannedNote;

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head module-head">
        <span className="module-icon">
          <Icon name={module.icon} />
        </span>
        <div>
          <h1 id="page-title">{text.title}</h1>
          <p className="lead">{text.description}</p>
        </div>
      </div>
      <div className="panel">
        <h2>{t.module.featuresTitle}</h2>
        <ul className="features">
          {text.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="muted">{note}</p>
      </div>
      <p>
        <a className="button" href="#">
          ← {t.nav.back}
        </a>
      </p>
    </section>
  );
}
