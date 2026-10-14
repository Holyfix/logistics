import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Locale } from '../core/format';
import { detectSupport, isFullySupported } from '../platform/support';
import { CallOffsPage } from './calloffs/CallOffsPage';
import { ComponentsPage } from './components/ComponentsPage';
import { CoveragePage } from './coverage/CoveragePage';
import { DashboardPage } from './dashboard/DashboardPage';
import { DataPage } from './DataPage';
import { HubPage } from './HubPage';
import { ModulePage } from './ModulePage';
import { PlanningPage } from './planning/PlanningPage';
import { PlanningProvider } from './planning/PlanningProvider';
import { findModule, type ModuleDef } from './modules';

export const APP_NAME = 'Logistics';

/** Adresa #calloffs otevře modul, cokoli jiného rozcestník. */
function moduleFromHash(hash: string): ModuleDef | undefined {
  return findModule(hash.replace(/^#/, ''));
}

export function App() {
  const { t, locale, setLocale } = useI18n();
  const [current, setCurrent] = useState<ModuleDef | undefined>(() => moduleFromHash(location.hash));
  const [supported] = useState(() => isFullySupported(detectSupport()));

  useEffect(() => {
    const title = current ? t.modules[current.id].title : t.hub.title;
    document.title = `${title} · ${APP_NAME}`;
  }, [current, t]);

  useEffect(() => {
    const onHashChange = () => {
      setCurrent(moduleFromHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const locales: Locale[] = ['cs', 'en'];

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label={t.nav.homeLabel}>
          <span className="brand-name">{APP_NAME}</span>
          <span className="brand-tagline">{t.appTagline}</span>
        </a>
        <nav className="crumbs" aria-label={t.nav.breadcrumb}>
          {current && (
            <>
              <a href="#">{t.nav.home}</a>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{t.modules[current.id].title}</span>
            </>
          )}
        </nav>
        <div className="segmented" role="group" aria-label={t.language.label}>
          {locales.map((l) => (
            <button key={l} type="button" aria-pressed={locale === l} onClick={() => setLocale(l)}>
              {t.language[l]}
            </button>
          ))}
        </div>
      </header>

      <PlanningProvider>
        <main className="content">
          {!supported && (
            <div className="banner" role="status">
              <strong>{t.support.title}</strong>
              <span>{t.support.body}</span>
            </div>
          )}
          {!current && <HubPage />}
          {current?.id === 'dashboard' && <DashboardPage />}
          {current?.id === 'data' && <DataPage />}
          {current?.id === 'calloffs' && <CallOffsPage />}
          {current?.id === 'coverage' && <CoveragePage />}
          {current?.id === 'components' && <ComponentsPage />}
          {current?.id === 'production' && <PlanningPage />}
          {current && !['dashboard', 'data', 'calloffs', 'coverage', 'components', 'production'].includes(current.id) && <ModulePage module={current} />}
        </main>
      </PlanningProvider>

      <footer className="footer">
        <span>{t.footer.privacy}</span>
        <span>
          {t.footer.version} {__APP_VERSION__} · {t.footer.built} {__BUILD_DATE__}
        </span>
      </footer>
    </div>
  );
}
