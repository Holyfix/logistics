import { useMemo, useState } from 'react';
import { EMPTY_FILTER, filterItems, filterOptions, MISSING_MASTER, type ItemField, type ItemFilter } from '../../core/calloffs/filter';
import { useI18n } from '../../i18n/I18nProvider';
import { Icon } from '../icons';
import { useData } from '../data/DataProvider';
import { CompareView } from './CompareView';
import { CurrentView } from './CurrentView';
import { SummaryView } from './SummaryView';
import { YearExportButton } from './YearExportButton';
import { MappingNotice } from '../data/MappingPanels';

type Tab = 'current' | 'summary' | 'compare';

export function CallOffsPage() {
  const { t } = useI18n();
  const { state } = useData();
  const [tab, setTab] = useState<Tab>('current');
  const [filter, setFilter] = useState<ItemFilter>(EMPTY_FILTER);

  const exports = state.data?.exports ?? [];
  const current = exports.at(-1);
  const previous = exports.at(-2);
  const master = state.data?.master?.data.items;

  const options = useMemo(() => (current ? filterOptions(current.items, master, filter) : null), [current, master, filter]);
  const items = useMemo(() => (current ? filterItems(current.items, current.descriptions, master, filter) : []), [current, master, filter]);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="calloffs" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.calloffs.title}</h1>
        <p className="lead">{t.modules.calloffs.description}</p>
      </div>
    </div>
  );

  if (!current || !options) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{state.status === 'loading' ? t.data.folder.loading : t.calloffs.noData}</p>
          {state.status !== 'loading' && (
            <p>
              <a className="button button-primary" href="#data">
                {t.calloffs.noDataAction}
              </a>
            </p>
          )}
        </div>
      </section>
    );
  }

  const set = (key: ItemField | 'query') => (value: string) => setFilter((f) => ({ ...f, [key]: value }));
  const select = (key: ItemField, label: string, values: string[], extra?: { value: string; label: string }) => (
    <label className="field">
      <span>{label}</span>
      <select value={filter[key]} onChange={(e) => set(key)(e.target.value)} disabled={!master}>
        <option value="">{t.calloffs.filters.all}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {extra && <option value={extra.value}>{extra.label}</option>}
      </select>
    </label>
  );
  // Kategorie, strana a varianta se nabídnou, jen když je díly ve výběru mají (nebo je filtr nastavený).
  const shown = (key: ItemField, values: string[]) => values.length > 0 || filter[key] !== '';

  // Filtry jsou v pohledu hned nad tabulkou s díly, aby se nemuselo posouvat na začátek stránky.
  const filters = (
    <div className="filters" role="group" aria-label={t.calloffs.filters.label}>
      {select('project', t.calloffs.filters.project, options.projects, options.missing > 0 && master ? { value: MISSING_MASTER, label: `${t.calloffs.filters.missing} (${options.missing})` } : undefined)}
      {shown('category', options.categories) && select('category', t.calloffs.filters.category, options.categories)}
      {shown('side', options.sides) && select('side', t.calloffs.filters.side, options.sides)}
      {shown('variant', options.variants) && select('variant', t.calloffs.filters.variant, options.variants)}
      <label className="field field-wide">
        <span>{t.calloffs.filters.search}</span>
        <input type="search" value={filter.query} placeholder={t.calloffs.filters.searchPlaceholder} onChange={(e) => set('query')(e.target.value)} />
      </label>
      <button type="button" className="link-button" onClick={() => setFilter(EMPTY_FILTER)}>
        {t.calloffs.filters.reset}
      </button>
      {!master && <p className="muted filters-note">{t.calloffs.filters.noMaster}</p>}
    </div>
  );

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page-head-row">
        {head}
        <p className="muted source-info">
          {t.calloffs.currentExport}: <strong>CW {current.week}/{current.year}</strong> ({current.fileName}) · {t.calloffs.exportsLoaded}:{' '}
          <strong>{exports.length}</strong>
        </p>
      </div>
      <MappingNotice module="calloffs" />

      <div className="tabs" role="tablist" aria-label={t.modules.calloffs.title}>
        {(['current', 'summary', 'compare'] as const).map((id) => (
          <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {t.calloffs.tabs[id]}
          </button>
        ))}
        <span className="tabs-actions">
          <YearExportButton exports={exports} master={master} filter={filter} />
        </span>
      </div>

      {tab === 'current' ? (
        <CurrentView current={current} previous={previous} items={items} master={master} filters={filters} />
      ) : tab === 'summary' ? (
        <SummaryView current={current} previous={previous} items={items} master={master} filter={filter} filters={filters} />
      ) : (
        <CompareView exports={exports} filter={filter} master={master} filters={filters} />
      )}
    </section>
  );
}
