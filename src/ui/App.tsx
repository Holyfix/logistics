import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Locale } from '../core/format';
import { detectSupport, isFullySupported } from '../platform/support';
import { DataPage } from './DataPage';
import { OverviewPage } from './OverviewPage';

export const APP_NAME = 'Logistics';

type Page = 'overview' | 'data';

function pageFromHash(hash: string): Page {
  return hash === '#data' ? 'data' : 'overview';
}

export function App() {
  const { t, locale, setLocale } = useI18n();
  const [page, setPage] = useState<Page>(() => pageFromHash(location.hash));
  const [supported] = useState(() => isFullySupported(detectSupport()));

  useEffect(() => {
    document.title = `${APP_NAME} · ${t.appTagline}`;
  }, [t]);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const pages: { id: Page; label: string }[] = [
    { id: 'overview', label: t.nav.overview },
    { id: 'data', label: t.nav.data },
  ];
  const locales: Locale[] = ['cs', 'en'];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">{APP_NAME}</span>
          <span className="brand-tagline">{t.appTagline}</span>
        </div>
        <nav className="nav" aria-label={t.nav.label}>
          {pages.map((p) => (
            <a key={p.id} href={`#${p.id}`} className="nav-link" aria-current={page === p.id ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="segmented" role="group" aria-label={t.language.label}>
          {locales.map((l) => (
            <button key={l} type="button" aria-pressed={locale === l} onClick={() => setLocale(l)}>
              {t.language[l]}
            </button>
          ))}
        </div>
      </header>

      <main className="content">
        {!supported && (
          <div className="banner" role="alert">
            <strong>{t.support.title}</strong>
            <span>{t.support.body}</span>
          </div>
        )}
        {page === 'overview' ? <OverviewPage /> : <DataPage />}
      </main>

      <footer className="footer">
        <span>{t.footer.privacy}</span>
        <span>
          {t.footer.version} {__APP_VERSION__} · {t.footer.built} {__BUILD_DATE__}
        </span>
      </footer>
    </div>
  );
}
