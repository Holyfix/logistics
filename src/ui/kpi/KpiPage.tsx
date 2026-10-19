import { Fragment, useMemo, useState } from 'react';
import { COMPONENT_SOON_DAYS } from '../../core/components/compute';
import { buildCoverage, shortage, SHORTAGE_DAYS } from '../../core/coverage/compute';
import { oilAlerts } from '../../core/dashboard';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort } from '../../core/format';
import {
  addDef,
  categoryKey,
  dayState,
  defaultKpis,
  entryOf,
  hasResults,
  kpiSheets,
  kpiStatus,
  kpiValue,
  LETTERS,
  monthDays,
  monthSummary,
  paretoOf,
  previousWorkday,
  recentEntries,
  removeDef,
  updateDef,
  valueKeys,
  withValues,
  withDetails,
  KPI_TIMINGS,
  KPI_SOURCES,
  type KpiData,
  type KpiDef,
  type KpiDetail,
  type KpiSource,
  type KpiTiming,
  type KpiStatus,
  type Letter,
} from '../../core/kpi';
import { addItem, emptyOil, kpiSourceKey, ownerNames, stamp } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { localToday, useComponents } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { useOilDraft, useOilDraftList } from '../oil/OilProvider';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { shapeCells } from './letterShapes';
import { KpiActionList, openActions, openOilItem } from './KpiActions';
import { KpiAnalysis } from './KpiAnalysis';
import { dayIssues, formatValue, LetterDays, ParetoChart, targetText } from './KpiCharts';

const KPI_FILE = 'KPI/KPI.xlsx';
const NAME_KEY = 'logistics-user-name';
/** Kolik dní zpátky se nabízejí nezapsané pracovní dny. */
const MISSING_LOOKBACK = 30;

type Tab = 'overview' | 'entry' | 'analysis' | 'defs';
type Period = 'month' | 'year';

/** Písmena s Paretovým grafem kategorií; ostatní mají denní sloupce ukazatele. */
const PARETO_LETTERS: readonly Letter[] = ['S', 'Q'];
const DAILY_COUNT = 7;

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Bez úložiště se jméno jen nezapamatuje.
  }
}

interface Month {
  year: number;
  month: number;
}

const monthOf = (day: DayNumber): Month => {
  const [y, m] = dayToIso(day).split('-');
  return { year: Number(y), month: Number(m) };
};

type AutoSource = Exclude<KpiSource, 'manual'>;
/** Detail automatického ukazatele (bez dne a ukazatele): co z dat aplikace bod způsobilo. */
export type AutoDetail = Pick<KpiDetail, 'project' | 'item' | 'person' | 'qty' | 'cause'>;

/** Automatické hodnoty z dat aplikace (null = data nejsou načtená) a jejich detaily pro rozbor. */
function useAutoValues(today: DayNumber): { values: Record<AutoSource, number | null>; details: Record<AutoSource, AutoDetail[]> } {
  const { state } = useData();
  const data = state.data;
  const components = useComponents(today);
  const oilDraft = useOilDraftList();
  const oilList = oilDraft ?? data?.oil?.list ?? null;
  const coverage = useMemo(() => (data?.coverage.length ? buildCoverage(data.coverage, data.master?.data, { transit: true }).lines : null), [data]);
  return useMemo(() => {
    // Chybí u zákazníka: díly se záporem v prvních dnech (kolik nejvíc chybí), destinace jako příčina.
    const customer = (coverage ?? []).flatMap((l): AutoDetail[] => {
      const worst = Math.min(0, ...l.values.slice(0, SHORTAGE_DAYS).filter((v): v is number => v !== null));
      return worst < 0 ? [{ project: l.project, item: l.item || l.customerNumber, person: '', qty: -worst, cause: l.location }] : [];
    });
    const short = components ? components.components.filter((c) => c.shortDay !== null && c.shortDay < COMPONENT_SOON_DAYS) : [];
    const overdue = oilList ? oilAlerts(oilList, today).filter((a) => a.severity === 'crit') : [];
    return {
      values: {
        coverageShortage: coverage ? shortage(coverage, SHORTAGE_DAYS).pieces : null,
        componentsShort: components ? short.length : null,
        oilOverdue: oilList ? overdue.length : null,
      },
      details: {
        coverageShortage: customer,
        componentsShort: short.map((c) => ({ project: c.projects.join(', '), item: c.item, person: '', qty: -Math.min(0, ...c.balance.slice(0, COMPONENT_SOON_DAYS)), cause: c.description })),
        oilOverdue: overdue.map(({ item }) => ({ project: '', item: '', person: item.owner, qty: null, cause: `OIL ${item.id}: ${item.problem.split('\n')[0]!.trim()}` })),
      },
    };
  }, [coverage, components, oilList, today]);
}

/** Klíče vstupů ukazatele: u kategorií jeden na kategorii, jinak jeden. */
const inputKeys = (def: KpiDef) => (def.categories.length ? def.categories.map((c) => categoryKey(def, c)) : [def.id]);

/** Řádek ručního detailu v zápisu (texty polí). */
interface DetailRow {
  project: string;
  item: string;
  person: string;
  qty: string;
  cause: string;
}

const EMPTY_ROW: DetailRow = { project: '', item: '', person: '', qty: '', cause: '' };
const toRow = (d: KpiDetail): DetailRow => ({ project: d.project, item: d.item, person: d.person, qty: d.qty === null ? '' : String(d.qty), cause: d.cause });
/** Kolik automatických detailů se v zápisu vypíše (ostatní se jen spočítají). */
const AUTO_DETAIL_ROWS = 20;

/** KPI SQCDP: kalendář po písmenech, denní zápis ukazatelů a úprava ukazatelů. Ukládá se do KPI/KPI.xlsx. */
export function KpiPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tk = t.kpi;
  const { state, saveFile, updateData } = useData();
  const flow = useSaveFlow();
  const data = state.data;
  const defaults = useMemo(() => defaultKpis(tk.defaults), [tk]);
  const saved: KpiData = data?.kpi?.data ?? defaults;
  const [defsDraft, setDefsDraft] = useState<KpiDef[] | null>(null);
  const kpi: KpiData = useMemo(() => ({ ...saved, defs: defsDraft ?? saved.defs }), [saved, defsDraft]);

  const [month, setMonth] = useState<Month>(() => monthOf(previousWorkday(today)));
  const [day, setDay] = useState<DayNumber>(() => previousWorkday(today));
  // Den pro ukazatele „stav v den zápisu“: při ranním zápisu dnešek, při úpravě konkrétního dne ten den.
  const [stateDay, setStateDay] = useState<DayNumber>(today);
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const [detailsEdited, setDetailsEdited] = useState<Record<string, DetailRow[]> | null>(null);
  const [name, setName] = useState(readName);
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>('year');
  const auto = useAutoValues(today);
  const { draft: oilDraft, setDraft: setOilDraft } = useOilDraft();

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="kpi" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.kpi.title}</h1>
        <p className="lead">{t.modules.kpi.description}</p>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{tk.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {tk.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const entry = entryOf(kpi, day);
  const stateEntry = entryOf(kpi, stateDay);
  // Výsledek dne patří k vybranému dni, stav k dni zápisu (při ranním zápisu dnešek).
  const dayOf = (def: KpiDef) => (def.timing === 'state' ? stateDay : day);
  const entryFor = (def: KpiDef) => (def.timing === 'state' ? stateEntry : entry);
  // Hodnoty: upravené, jinak ze zápisu, jinak předvyplněné (ručně 0; automaticky z dat aplikace jen pro dnešní den,
  // protože data jsou z dneška).
  const prefill = (def: KpiDef, key: string): string => {
    const e = entryFor(def);
    const stored = e?.values[key];
    if (stored !== undefined) return String(stored);
    if (e && valueKeys(kpi.defs.filter((d) => d.timing === def.timing)).some((k) => e.values[k] !== undefined)) return '';
    if (def.source !== 'manual') return dayOf(def) === today && auto.values[def.source] !== null ? String(auto.values[def.source]) : '';
    return '0';
  };
  const valueOf = (def: KpiDef, key: string) => edited?.[key] ?? prefill(def, key);
  const numberOf = (text: string) => {
    const n = Number(text.replace(',', '.'));
    return text.trim() === '' || !Number.isFinite(n) ? null : n;
  };
  const currentValue = (def: KpiDef): number | null => {
    const values = inputKeys(def).map((k) => numberOf(valueOf(def, k))).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };

  // Detaily bodů mimo cíl: ruční řádky (projekt, díl, osoba, množství, příčina), automatické z dat aplikace.
  const storedDetails = (def: KpiDef) => kpi.details.filter((d) => d.day === dayOf(def) && d.kpiId === def.id);
  const detailRows = (def: KpiDef): DetailRow[] => detailsEdited?.[def.id] ?? (storedDetails(def).length ? storedDetails(def).map(toRow) : [EMPTY_ROW]);
  const setDetailRows = (def: KpiDef, rows: DetailRow[]) => setDetailsEdited((e) => ({ ...(e ?? {}), [def.id]: rows }));
  const isOff = (def: KpiDef) => {
    const v = currentValue(def);
    return v !== null && kpiStatus(def, v) !== 'green';
  };
  const autoDetails = (def: KpiDef): AutoDetail[] => (def.source === 'manual' ? [] : dayOf(def) === today ? auto.details[def.source] : storedDetails(def));
  /** Detaily k uložení; null = u ukazatele nic neměnit (automatický ukazatel staršího dne). */
  const detailsToSave = (def: KpiDef): KpiDetail[] | null => {
    const base = { day: dayOf(def), kpiId: def.id };
    if (!isOff(def)) return [];
    if (def.source === 'manual')
      return detailRows(def)
        .filter((r) => Object.values(r).some((v) => v.trim()))
        .map((r) => ({ ...base, project: r.project.trim(), item: r.item.trim(), person: r.person.trim(), qty: numberOf(r.qty), cause: r.cause.trim(), source: 'manual' }));
    return dayOf(def) === today ? auto.details[def.source].map((d) => ({ ...base, ...d, source: 'auto' })) : null;
  };

  const pickDay = (d: DayNumber, state: DayNumber = d) => {
    setDay(d);
    setStateDay(state);
    setEdited(null);
    setDetailsEdited(null);
  };
  const setValue = (key: string, value: string) => setEdited((e) => ({ ...(e ?? {}), [key]: value }));

  const save = (next: KpiData) =>
    flow.run(async (force) => {
      const path = data.kpi?.path ?? KPI_FILE;
      const result = await saveFile(path, () => xlsxBlob(kpiSheets(next)), data.kpi?.lastModified ?? null, force);
      // Po stažení (bez přístupu ke složce) zůstane zápis vidět aspoň do dalšího načtení dat.
      if (result.status === 'saved' || result.status === 'downloaded') {
        const lastModified = result.status === 'saved' ? result.lastModified : (data.kpi?.lastModified ?? 0);
        updateData((d) => ({ ...d, kpi: { path: result.path, lastModified, data: next } }));
        setDefsDraft(null);
        setEdited(null);
        setDetailsEdited(null);
      }
      return result;
    });
  // Výsledky se uloží k vybranému dni, stav k dni zápisu; ostatní hodnoty těch dnů zůstanou.
  const saveDay = () => {
    const at = stamp(new Date());
    let next = kpi;
    for (const timing of KPI_TIMINGS) {
      const defs = kpi.defs.filter((d) => d.timing === timing);
      if (!defs.length) continue;
      const values: Record<string, number> = {};
      for (const def of defs)
        for (const key of inputKeys(def)) {
          const n = numberOf(valueOf(def, key));
          if (n !== null) values[key] = n;
        }
      next = withValues(next, timing === 'state' ? stateDay : day, valueKeys(defs), values, name.trim(), at);
    }
    for (const def of kpi.defs) {
      const details = detailsToSave(def);
      if (details) next = withDetails(next, dayOf(def), [def.id], details);
    }
    void save(next);
  };
  const removeDay = () => {
    const label = day === stateDay ? dayLabel(day) : `${dayLabel(day)} + ${dayLabel(stateDay)}`;
    if (!window.confirm(tk.entry.removeConfirm.replace('{day}', label))) return;
    let next = kpi;
    for (const timing of KPI_TIMINGS) {
      const d = timing === 'state' ? stateDay : day;
      const old = entryOf(next, d);
      if (old) next = withValues(next, d, valueKeys(kpi.defs.filter((def) => def.timing === timing)), {}, old.author, old.at);
    }
    for (const def of kpi.defs) next = withDetails(next, dayOf(def), [def.id], []);
    void save(next);
  };
  const oilList = oilDraft ?? data.oil?.list ?? emptyOil();
  const actions = openActions(oilList.items, today);
  // Nový bod OIL z ukazatele mimo cíl: písmeno, problém (hodnota, den, cíl) a zdroj; doplní se v modulu OIL.
  const addOil = (def: KpiDef, value: number) => {
    const unit = def.unit ? ` ${def.unit}` : '';
    const parts = def.categories.flatMap((c) => {
      const v = entryFor(def)?.values[categoryKey(def, c)] ?? 0;
      return v ? [`${c} ${formatValue(v, locale)}`] : [];
    });
    const problem = `${def.name}: ${formatValue(value, locale)}${unit}${parts.length ? ` – ${parts.join(', ')}` : ''} (${dayLabel(dayOf(def))}, ${targetText(def, tk.targetText)})`;
    const result = addItem(oilList, today, { letter: def.letter, problem, kpi: kpiSourceKey(dayOf(def), def.id) });
    setOilDraft(result.list);
    openOilItem(result.id);
  };
  const changeDef = (id: string, change: (d: KpiDef) => KpiDef) => setDefsDraft(updateDef(kpi, id, change).defs);

  const shiftMonth = (by: number) =>
    setMonth(({ year, month: m }) => {
      const index = year * 12 + (m - 1) + by;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  const todayMonth = monthOf(today);
  // Období Paretových grafů: zobrazený měsíc, nebo od ledna do konce zobrazeného měsíce.
  const monthRange = monthDays(month.year, month.month);
  const range = { from: period === 'month' ? monthRange[0]! : monthDays(month.year, 1)[0]!, to: monthRange[monthRange.length - 1]! };
  const periodText = period === 'month' || month.month === 1 ? `${tk.monthNames[month.month - 1]} ${month.year}` : `${tk.monthNames[0]}–${tk.monthNames[month.month - 1]!.toLowerCase()} ${month.year}`;
  const openDay = (d: DayNumber, state: DayNumber = d) => {
    pickDay(d, state);
    setMonth(monthOf(d));
    setTab('entry');
  };
  // Pracovní dny za posledních 30 dní bez zapsaného výsledku (až od prvního zápisu).
  const firstDay = kpi.entries[0]?.day;
  const missing: DayNumber[] = [];
  if (firstDay !== undefined)
    for (let d = Math.max(today - MISSING_LOOKBACK, firstDay); d < today; d++) if (weekday(d) <= 5 && !hasResults(kpi, d)) missing.push(d);
  // Tlačítko Zapsat (ranní zápis): výsledky za nejstarší nezapsaný pracovní den za 30 dní, jinak za předchozí pracovní
  // den, a stav dnes. Hotovo (✓), když jsou výsledky i dnešní stav zapsané.
  const writeDay = missing[0] ?? previousWorkday(today);
  const stateDefs = kpi.defs.filter((d) => d.timing === 'state');
  const todayEntry = entryOf(kpi, today);
  const writeDone = hasResults(kpi, writeDay) && (!stateDefs.length || stateDefs.some((d) => kpiValue(todayEntry, d) !== null));

  // Nabídky pro ruční detail: projekty a díly z mapování, osoby z OIL, dříve zapsané příčiny.
  const masterItems = [...(data.master?.data.items.values() ?? [])];
  const suppliers = new Map(masterItems.filter((m) => m.supplier).map((m) => [m.item.toUpperCase(), m.supplier]));
  const suggestions = {
    projects: [...new Set([...masterItems.map((m) => m.project), ...kpi.details.map((d) => d.project)].filter(Boolean))].sort(),
    items: [...new Set(masterItems.map((m) => m.item))].sort(),
    persons: [...new Set(oilList.items.flatMap((i) => ownerNames(i.owner)))].sort((a, b) => a.localeCompare(b, 'cs')),
    causes: [...new Set(kpi.details.filter((d) => d.source === 'manual').map((d) => d.cause).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')),
  };
  const details = (def: KpiDef) => {
    if (def.source === 'manual') {
      if (!isOff(def) && !storedDetails(def).length) return null;
      const rows = detailRows(def);
      const set = (k: number, field: keyof DetailRow, value: string) => setDetailRows(def, rows.map((r, i) => (i === k ? { ...r, [field]: value } : r)));
      const field = (k: number, key: keyof DetailRow, list: string | undefined, className?: string) => (
        <input
          className={className}
          list={list}
          inputMode={key === 'qty' ? 'decimal' : undefined}
          aria-label={`${def.name}: ${tk.detail[key]} ${k + 1}`}
          placeholder={tk.detail[key]}
          value={rows[k]![key]}
          onChange={(e) => set(k, key, e.target.value)}
        />
      );
      return (
        <tr className="kpi-detail">
          <td colSpan={6}>
            <div className="kpi-detail-title">{tk.detail.manual}</div>
            {rows.map((_, k) => (
              <div key={k} className="kpi-detail-row">
                {field(k, 'project', 'kpi-projects')}
                {field(k, 'item', 'kpi-items')}
                {field(k, 'person', 'kpi-persons')}
                {field(k, 'qty', undefined, 'kpi-detail-qty')}
                {field(k, 'cause', 'kpi-causes', 'kpi-detail-cause')}
                <button type="button" className="link-button" aria-label={`${tk.detail.removeRow} ${k + 1}`} onClick={() => setDetailRows(def, rows.length > 1 ? rows.filter((_r, i) => i !== k) : [EMPTY_ROW])}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="link-button" onClick={() => setDetailRows(def, [...rows, EMPTY_ROW])}>
              {tk.detail.addRow}
            </button>
          </td>
        </tr>
      );
    }
    const list = autoDetails(def);
    if (!isOff(def) || !list.length) return null;
    return (
      <tr className="kpi-detail kpi-detail-auto">
        <td colSpan={6}>
          <div className="kpi-detail-title">{dayOf(def) === today ? tk.detail.autoNew : tk.detail.autoSaved}</div>
          <ul className="kpi-detail-list">
            {list.slice(0, AUTO_DETAIL_ROWS).map((d, k) => (
              <li key={k}>{[d.item, d.project, d.person, d.qty === null ? '' : `${tk.detail.qty.toLowerCase()} ${formatValue(d.qty, locale)}`, d.cause].filter(Boolean).join(' · ')}</li>
            ))}
          </ul>
          {list.length > AUTO_DETAIL_ROWS && <small className="muted">{tk.detail.more.replace('{n}', String(list.length - AUTO_DETAIL_ROWS))}</small>}
        </td>
      </tr>
    );
  };

  const dot = (status: KpiStatus | null) => (status ? <span className={`kpi-dot kpi-${status}`} title={tk.legend[status]} /> : <span className="muted">—</span>);

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="tabs" role="tablist" aria-label={t.modules.kpi.title}>
        {(['overview', 'entry', 'analysis', 'defs'] as const).map((id) => (
          <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {tk.tabs[id]}
          </button>
        ))}
        <span className="tabs-actions">
          <button type="button" className={`button${writeDone ? '' : ' button-primary'}`} onClick={() => openDay(writeDay, today)}>
            {(writeDone ? tk.written : tk.write).replace('{day}', dayLabel(writeDay))}
          </button>
        </span>
      </div>

      {tab === 'overview' && (
        <>
          <div className="filters" role="group" aria-label={tk.tabs.overview}>
            <div className="kpi-monthnav">
              <button type="button" className="button" aria-label={tk.prevMonth} onClick={() => shiftMonth(-1)}>
                ‹
              </button>
              <strong>
                {tk.monthNames[month.month - 1]} {month.year}
              </strong>
              <button type="button" className="button" aria-label={tk.nextMonth} onClick={() => shiftMonth(1)}>
                ›
              </button>
            </div>
            <ul className="kpi-legend">
              {(['green', 'yellow', 'red', 'missing', 'weekend'] as const).map((s) => (
                <li key={s}>
                  <i className={`kpi-swatch kpi-${s}`} /> {tk.legend[s]}
                </li>
              ))}
            </ul>
            <span className="segmented" role="group" aria-label={tk.charts.period}>
              {(['month', 'year'] as const).map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                  {tk.charts[p]}
                </button>
              ))}
            </span>
          </div>

          <div className="kpi-letters">
            {LETTERS.map((letter) => (
              <LetterCard key={letter} letter={letter} kpi={kpi} month={month} today={today} todayMonth={todayMonth} actions={actions.filter((a) => a.letter === letter).length} onPick={openDay} onMonth={setMonth} />
            ))}
          </div>

          <div className="kpi-letters">
            {LETTERS.map((letter) => {
              if (PARETO_LETTERS.includes(letter))
                return (
                  <div key={letter} className="kpi-card kpi-chart-card">
                    <h3>
                      <span className="kpi-letter">{letter}</span> {tk.charts.pareto} · {periodText}
                    </h3>
                    <ParetoChart bars={paretoOf(kpi, letter, range.from, range.to)} label={`${letter} ${tk.letters[letter]} – ${tk.charts.pareto} ${periodText}`} />
                  </div>
                );
              return (
                <div key={letter} className="kpi-card kpi-chart-card">
                  <h3>
                    <span className="kpi-letter">{letter}</span> {tk.charts.last}
                  </h3>
                  <LetterDays kpi={kpi} letter={letter} entries={recentEntries(kpi, letter, range.to, DAILY_COUNT)} onPick={openDay} />
                </div>
              );
            })}
          </div>

          <KpiActionList items={actions} today={today} />
        </>
      )}

      {tab === 'entry' && (
        <div className="panel">
          <div className="panel-head">
            <h2>{day === stateDay || !stateDefs.length ? `${tk.entry.heading} ${dayLabel(day)}` : tk.entry.morning.replace('{day}', dayLabel(day)).replace('{state}', dayLabel(stateDay))}</h2>
            <label className="inline-field">
              <span>{tk.entry.day}</span>
              <input
                type="date"
                value={dayToIso(day)}
                max={dayToIso(today)}
                onChange={(e) => {
                  const d = parseDay(e.target.value);
                  if (d !== null) {
                    pickDay(d);
                    setMonth(monthOf(d));
                  }
                }}
              />
            </label>
            <label className="inline-field">
              <span>{tk.entry.you}</span>
              <input
                value={name}
                placeholder={tk.entry.youPlaceholder}
                onChange={(e) => {
                  setName(e.target.value);
                  saveName(e.target.value.trim());
                }}
              />
            </label>
            <span className="panel-actions">
              {(entry || stateEntry) && (
                <button type="button" className="link-button" disabled={flow.busy} onClick={removeDay}>
                  {tk.entry.remove}
                </button>
              )}
              <button type="button" className="button button-primary" disabled={flow.busy} onClick={saveDay}>
                {tk.entry.save}
              </button>
            </span>
          </div>
          <p className="muted">
            {hasResults(kpi, day) && entry ? tk.entry.entered.replace('{author}', entry.author).replace('{at}', entry.at) : tk.entry.notEntered}{' '}
            <SaveStatus dirty={edited !== null} saved={data.kpi ? { path: data.kpi.path, lastModified: data.kpi.lastModified } : null} message={flow.message} />
          </p>
          {missing.length > 0 && (
            <p className="kpi-missing-days">
              <span className="muted">{tk.entry.missing}</span>
              {missing.map((d) => (
                <button key={d} type="button" className={`chip${d === day ? ' chip-accent' : ''}`} onClick={() => pickDay(d)}>
                  {dayLabel(d)}
                </button>
              ))}
            </p>
          )}
          {(
            [
              ['kpi-projects', suggestions.projects],
              ['kpi-items', suggestions.items],
              ['kpi-persons', suggestions.persons],
              ['kpi-causes', suggestions.causes],
            ] as const
          ).map(([id, values]) => (
            <datalist key={id} id={id}>
              {values.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          ))}
          <div className="table-scroll">
            <table className="table kpi-entry">
              <thead>
                <tr>
                  <th>{tk.entry.kpi}</th>
                  <th>{tk.defs.source}</th>
                  <th>{tk.entry.target}</th>
                  <th>{tk.entry.value}</th>
                  <th>{tk.entry.status}</th>
                  <th>{tk.entry.oil}</th>
                </tr>
              </thead>
              {KPI_TIMINGS.flatMap((timing) => {
                const ofTiming = kpi.defs.filter((d) => d.timing === timing);
                if (!ofTiming.length) return [];
                const section = (timing === 'state' ? tk.entry.sectionState : tk.entry.sectionResult).replace('{day}', dayLabel(timing === 'state' ? stateDay : day));
                return [
                  <tbody key={timing}>
                    <tr className="kpi-section">
                      <td colSpan={6}>{section}</td>
                    </tr>
                  </tbody>,
                  ...LETTERS.map((letter) => {
                const defs = ofTiming.filter((d) => d.letter === letter);
                if (!defs.length) return null;
                return (
                  <tbody key={`${timing}-${letter}`}>
                    <tr className="kpi-group">
                      <td colSpan={6}>
                        {letter} – {tk.letters[letter]}
                      </td>
                    </tr>
                    {defs.map((def) => {
                      const value = currentValue(def);
                      const stored = kpiValue(entryFor(def), def);
                      return (
                        <Fragment key={def.id}>
                        <tr>
                          <td>
                            {def.name}
                            {def.unit && <small className="muted"> ({def.unit})</small>}
                          </td>
                          <td>
                            <span className={`chip${def.source === 'manual' ? '' : ' chip-accent'}`} title={def.source === 'manual' ? undefined : tk.entry.autoTitle}>
                              {tk.sources[def.source]}
                            </span>
                          </td>
                          <td className="muted">{targetText(def, tk.targetText)}</td>
                          <td>
                            <div className="kpi-inputs">
                              {inputKeys(def).map((key, k) => (
                                <label key={key} className={def.categories.length ? 'kpi-cat' : undefined}>
                                  {def.categories.length > 0 && <span>{def.categories[k]}</span>}
                                  <input
                                    className="kpi-input"
                                    inputMode="decimal"
                                    aria-label={def.categories.length ? `${def.name}: ${def.categories[k]}` : def.name}
                                    value={valueOf(def, key)}
                                    onChange={(e) => setValue(key, e.target.value)}
                                  />
                                </label>
                              ))}
                            </div>
                          </td>
                          <td>{dot(value === null ? null : kpiStatus(def, value))}</td>
                          <td className="kpi-oil">
                            {/* Bod OIL se zakládá z uložené hodnoty mimo cíl; existující body k ukazateli a dni jako odkazy. */}
                            {stored !== null && kpiStatus(def, stored) !== 'green' && (
                              <button type="button" className="button button-small" disabled={edited !== null} title={edited !== null ? tk.entry.saveFirst : tk.entry.addOilTitle} onClick={() => addOil(def, stored)}>
                                {tk.entry.addOil}
                              </button>
                            )}
                            {oilList.items
                              .filter((i) => i.kpi === kpiSourceKey(dayOf(def), def.id))
                              .map((i) => (
                                <a key={i.id} href={`#oil?open=${i.id}`}>
                                  {tk.entry.point.replace('{id}', String(i.id))}
                                </a>
                              ))}
                          </td>
                        </tr>
                        {details(def)}
                        </Fragment>
                      );
                    })}
                  </tbody>
                );
                  }),
                ];
              })}
            </table>
          </div>
          <p className="muted">{tk.entry.note}</p>
        </div>
      )}

      {tab === 'analysis' && (
        <KpiAnalysis
          kpi={kpi}
          oilItems={oilList.items}
          today={today}
          supplierOf={(item) => suppliers.get(item.toUpperCase()) ?? ''}
          onOpenDay={(d) => openDay(d)}
          onAddOil={({ letter, problem, kpi: source }) => {
            const result = addItem(oilList, today, { letter, problem, kpi: kpiSourceKey(source.day, source.kpiId) });
            setOilDraft(result.list);
            openOilItem(result.id);
          }}
        />
      )}

      {tab === 'defs' && (
        <div className="panel kpi-defs">
          <div className="panel-head">
            <h2>{tk.defs.heading}</h2>
            <SaveStatus dirty={defsDraft !== null} saved={data.kpi ? { path: data.kpi.path, lastModified: data.kpi.lastModified } : null} message={flow.message} />
          </div>
          <p className="muted">{tk.defs.note}</p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{tk.defs.letter}</th>
                  <th>{tk.defs.name}</th>
                  <th>{tk.defs.unit}</th>
                  <th>{tk.defs.target}</th>
                  <th>{tk.defs.red}</th>
                  <th>{tk.defs.better}</th>
                  <th>{tk.defs.source}</th>
                  <th>{tk.defs.timing}</th>
                  <th>{tk.defs.categories}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {kpi.defs.map((def) => (
                  <tr key={def.id}>
                    <td>
                      <select aria-label={tk.defs.letter} value={def.letter} onChange={(e) => changeDef(def.id, (d) => ({ ...d, letter: e.target.value as Letter }))}>
                        {LETTERS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input aria-label={tk.defs.name} value={def.name} onChange={(e) => changeDef(def.id, (d) => ({ ...d, name: e.target.value }))} />
                    </td>
                    <td>
                      <input className="kpi-input" aria-label={tk.defs.unit} value={def.unit} onChange={(e) => changeDef(def.id, (d) => ({ ...d, unit: e.target.value }))} />
                    </td>
                    <td>
                      <input className="kpi-input" inputMode="decimal" aria-label={tk.defs.target} value={def.target} onChange={(e) => changeDef(def.id, (d) => ({ ...d, target: numberOf(e.target.value) ?? 0 }))} />
                    </td>
                    <td>
                      <input className="kpi-input" inputMode="decimal" aria-label={tk.defs.red} value={def.red ?? ''} onChange={(e) => changeDef(def.id, (d) => ({ ...d, red: numberOf(e.target.value) }))} />
                    </td>
                    <td>
                      <select aria-label={tk.defs.better} value={def.higherIsBetter ? 'higher' : 'lower'} onChange={(e) => changeDef(def.id, (d) => ({ ...d, higherIsBetter: e.target.value === 'higher' }))}>
                        <option value="lower">{tk.defs.lower}</option>
                        <option value="higher">{tk.defs.higher}</option>
                      </select>
                    </td>
                    <td>
                      <select aria-label={tk.defs.source} value={def.source} onChange={(e) => changeDef(def.id, (d) => ({ ...d, source: e.target.value as KpiSource }))}>
                        {KPI_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {tk.sources[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select aria-label={tk.defs.timing} value={def.timing} onChange={(e) => changeDef(def.id, (d) => ({ ...d, timing: e.target.value as KpiTiming }))}>
                        {KPI_TIMINGS.map((m) => (
                          <option key={m} value={m}>
                            {tk.timings[m]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={tk.defs.categories}
                        defaultValue={def.categories.join('; ')}
                        onBlur={(e) =>
                          changeDef(def.id, (d) => ({
                            ...d,
                            categories: e.target.value
                              .split(';')
                              .map((c) => c.trim())
                              .filter(Boolean),
                          }))
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          if (window.confirm(tk.defs.removeConfirm.replace('{name}', def.name))) setDefsDraft(removeDef(kpi, def.id).defs);
                        }}
                      >
                        {tk.defs.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="kpi-defs-actions">
            <button type="button" className="button" onClick={() => setDefsDraft(addDef(kpi, 'S', tk.defs.newName).defs)}>
              {tk.defs.add}
            </button>
            <button type="button" className="button button-primary" disabled={flow.busy || defsDraft === null} onClick={() => void save(kpi)}>
              {tk.defs.save}
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

interface LetterCardProps {
  letter: Letter;
  kpi: KpiData;
  month: Month;
  today: DayNumber;
  todayMonth: Month;
  /** Počet otevřených opatření (bodů OIL) k písmenu. */
  actions: number;
  onPick: (day: DayNumber) => void;
  onMonth: (month: Month) => void;
}

/** Písmeno jako kalendář měsíce a pod ním pruh měsíců roku. */
function LetterCard({ letter, kpi, month, today, todayMonth, actions, onPick, onMonth }: LetterCardProps) {
  const { t, locale } = useI18n();
  const tk = t.kpi;
  const days = monthDays(month.year, month.month);
  const summary = monthSummary(kpi, letter, month.year, month.month);
  const R = '10px';
  return (
    <div className="kpi-card">
      <h3>
        <span className="kpi-letter">{letter}</span> {tk.letters[letter]}
      </h3>
      <div className="kpi-grid">
        {shapeCells(letter).map((cell, k) => {
          const d = days[k];
          const style = { gridRow: cell.row + 1, gridColumn: cell.col + 1, borderRadius: cell.round.map((r) => (r ? R : '3px')).join(' ') };
          if (d === undefined) return <span key={k} className="kpi-cell kpi-pad" style={style} />;
          const state = dayState(kpi, letter, d, today);
          return (
            <button
              key={k}
              type="button"
              className={`kpi-cell kpi-${state}`}
              style={style}
              title={[`${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)} – ${tk.dayTitle[state]}`, ...dayIssues(kpi, letter, entryOf(kpi, d), tk, locale)].join('\n')}
              disabled={d > today}
              onClick={() => onPick(d)}
            >
              {k + 1}
            </button>
          );
        })}
      </div>
      <div className="kpi-months" role="group" aria-label={`${letter} – ${month.year}`}>
        {tk.monthLetters.map((m, i) => {
          const s = monthSummary(kpi, letter, month.year, i + 1);
          const future = month.year > todayMonth.year || (month.year === todayMonth.year && i + 1 > todayMonth.month);
          const title = tk.monthTitle.replace('{month}', tk.monthNames[i]!).replace('{green}', String(s.green)).replace('{days}', String(s.days));
          return (
            <button
              key={i}
              type="button"
              className={`kpi-month kpi-${future ? 'future' : (s.status ?? 'none')}${i + 1 === month.month ? ' kpi-selected' : ''}`}
              title={title}
              aria-label={title}
              onClick={() => onMonth({ year: month.year, month: i + 1 })}
            >
              {m}
            </button>
          );
        })}
      </div>
      <p className="kpi-caption">
        {summary.days ? tk.inTarget.replace('{green}', String(summary.green)).replace('{days}', String(summary.days)) : tk.noDays}
        {actions > 0 && (
          <>
            {' · '}
            <strong>{tk.actionsCount.replace('{n}', String(actions))}</strong>
          </>
        )}
      </p>
    </div>
  );
}
