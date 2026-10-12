import { useI18n } from '../i18n/I18nProvider';

export function OverviewPage() {
  const { t } = useI18n();
  const modules = Object.values(t.overview.modules);

  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">{t.overview.title}</h1>
      <div className="panel empty">
        <h2>{t.overview.emptyTitle}</h2>
        <p>{t.overview.emptyBody}</p>
      </div>
      <div className="panel">
        <h2>{t.overview.plannedTitle}</h2>
        <ul className="modules">
          {modules.map((name) => (
            <li key={name}>
              <span>{name}</span>
              <span className="chip">{t.data.planned}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
