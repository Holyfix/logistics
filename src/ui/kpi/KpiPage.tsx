import { useMemo, useState } from 'react';
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
  kpiSheets,
  kpiStatus,
  LETTERS,
  monthDays,
  monthSummary,
  previousWorkday,
  removeDef,
  updateDef,
  withEntry,
  withoutEntry,
  KPI_SOURCES,
  type KpiData,
  type KpiDef,
  type KpiSource,
  type KpiStatus,
  type Letter,
} from '../../core/kpi';
import { stamp } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { localToday, useComponents } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { useOilDraftList } from '../oil/OilProvider';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { shapeCells } from './letterShapes';

const KPI_FILE = 'KPI/KPI.xlsx';
const NAME_KEY = 'logistics-user-name';

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

/** Automatické hodnoty z dat aplikace (null = data nejsou načtená). */
function useAutoValues(today: DayNumber): Record<Exclude<KpiSource, 'manual'>, number | null> {
  const { state } = useData();
  const data = state.data;
  const components = useComponents(today);
  const oilDraft = useOilDraftList();
  const oilList = oilDraft ?? data?.oil?.list ?? null;
  const coverageShortage = useMemo(
    () => (data?.coverage.length ? shortage(buildCoverage(data.coverage, data.master?.data, { transit: true }).lines, SHORTAGE_DAYS).pieces : null),
    [data],
  );
  return {
    coverageShortage,
    componentsShort: components ? components.components.filter((c) => c.shortDay !== null && c.shortDay < COMPONENT_SOON_DAYS).length : null,
    oilOverdue: oilList ? oilAlerts(oilList, today).filter((a) => a.severity === 'crit').length : null,
  };
}

/** Klíče vstupů ukazatele: u kategorií jeden na kategorii, jinak jeden. */
const inputKeys = (def: KpiDef) => (def.categories.length ? def.categories.map((c) => categoryKey(def, c)) : [def.id]);

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
  const [edited, setEdited] = useState<Record<string, string> | null>(null);
  const [name, setName] = useState(readName);
  const auto = useAutoValues(today);

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
  // Hodnoty dne: upravené, jinak ze zápisu, jinak předvyplněné (ručně 0, automaticky z dat aplikace).
  const prefill = (def: KpiDef, key: string): string => {
    const stored = entry?.values[key];
    if (stored !== undefined) return String(stored);
    if (entry) return '';
    if (def.source !== 'manual') return auto[def.source] === null ? '' : String(auto[def.source]);
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

  const pickDay = (d: DayNumber) => {
    setDay(d);
    setEdited(null);
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
      }
      return result;
    });
  const saveDay = () => {
    const values: Record<string, number> = {};
    for (const def of kpi.defs)
      for (const key of inputKeys(def)) {
        const n = numberOf(valueOf(def, key));
        if (n !== null) values[key] = n;
      }
    void save(withEntry(kpi, { day, author: name.trim(), at: stamp(new Date()), values }));
  };
  const removeDay = () => {
    if (window.confirm(tk.entry.removeConfirm.replace('{day}', dayLabel(day)))) void save(withoutEntry(kpi, day));
  };
  const changeDef = (id: string, change: (d: KpiDef) => KpiDef) => setDefsDraft(updateDef(kpi, id, change).defs);

  const shiftMonth = (by: number) =>
    setMonth(({ year, month: m }) => {
      const index = year * 12 + (m - 1) + by;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  const todayMonth = monthOf(today);
  const dirty = defsDraft !== null || edited !== null;

  const targetText = (def: KpiDef) => {
    const target = (def.higherIsBetter ? tk.targetText.higher : tk.targetText.lower).replace('{target}', String(def.target));
    const red = def.red === null ? tk.targetText.warnOnly : (def.higherIsBetter ? tk.targetText.redHigher : tk.targetText.redLower).replace('{red}', String(def.red));
    return `${target} · ${red}`;
  };
  const dot = (status: KpiStatus | null) => (status ? <span className={`kpi-dot kpi-${status}`} title={tk.legend[status]} /> : <span className="muted">—</span>);

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="filters" role="group" aria-label={tk.entry.heading}>
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
          {(['green', 'yellow', 'red', 'missing'] as const).map((s) => (
            <li key={s}>
              <i className={`kpi-swatch kpi-${s}`} /> {tk.legend[s]}
            </li>
          ))}
        </ul>
        <span className="filters-break" role="presentation" />
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            const d = previousWorkday(today);
            pickDay(d);
            setMonth(monthOf(d));
            document.getElementById('kpi-entry')?.scrollIntoView?.({ behavior: 'smooth' });
          }}
        >
          {tk.write.replace('{day}', dayLabel(previousWorkday(today)))}
        </button>
      </div>

      <div className="kpi-letters">
        {LETTERS.map((letter) => (
          <LetterCard
            key={letter}
            letter={letter}
            kpi={kpi}
            month={month}
            today={today}
            todayMonth={todayMonth}
            selected={day}
            onPick={(d) => {
              pickDay(d);
              document.getElementById('kpi-entry')?.scrollIntoView?.({ behavior: 'smooth' });
            }}
            onMonth={setMonth}
          />
        ))}
      </div>

      <div className="panel" id="kpi-entry">
        <div className="panel-head">
          <h2>
            {tk.entry.heading} {dayLabel(day)}
          </h2>
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
            {entry && (
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
          {entry ? tk.entry.entered.replace('{author}', entry.author).replace('{at}', entry.at) : tk.entry.notEntered}{' '}
          <SaveStatus dirty={dirty} saved={data.kpi ? { path: data.kpi.path, lastModified: data.kpi.lastModified } : null} message={flow.message} />
        </p>
        <div className="table-scroll">
          <table className="table kpi-entry">
            <thead>
              <tr>
                <th>{tk.entry.kpi}</th>
                <th>{tk.defs.source}</th>
                <th>{tk.entry.target}</th>
                <th>{tk.entry.value}</th>
                <th>{tk.entry.status}</th>
              </tr>
            </thead>
            {LETTERS.map((letter) => {
              const defs = kpi.defs.filter((d) => d.letter === letter);
              if (!defs.length) return null;
              return (
                <tbody key={letter}>
                  <tr className="kpi-group">
                    <td colSpan={5}>
                      {letter} – {tk.letters[letter]}
                    </td>
                  </tr>
                  {defs.map((def) => {
                    const value = currentValue(def);
                    return (
                      <tr key={def.id}>
                        <td>
                          {def.name}
                          {def.unit && <small className="muted"> ({def.unit})</small>}
                        </td>
                        <td>
                          <span className={`chip${def.source === 'manual' ? '' : ' chip-accent'}`} title={def.source === 'manual' ? undefined : tk.entry.autoTitle}>
                            {tk.sources[def.source]}
                          </span>
                        </td>
                        <td className="muted">{targetText(def)}</td>
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
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="muted">{tk.entry.note}</p>
      </div>

      <details className="panel kpi-defs">
        <summary>
          <h2>{tk.defs.heading}</h2>
        </summary>
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
      </details>
    </section>
  );
}

interface LetterCardProps {
  letter: Letter;
  kpi: KpiData;
  month: Month;
  today: DayNumber;
  todayMonth: Month;
  selected: DayNumber;
  onPick: (day: DayNumber) => void;
  onMonth: (month: Month) => void;
}

/** Písmeno jako kalendář měsíce a pod ním pruh měsíců roku. */
function LetterCard({ letter, kpi, month, today, todayMonth, selected, onPick, onMonth }: LetterCardProps) {
  const { t } = useI18n();
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
              className={`kpi-cell kpi-${state}${d === selected ? ' kpi-selected' : ''}`}
              style={style}
              title={`${dayToIso(d)} – ${tk.dayTitle[state]}`}
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
      <p className="kpi-caption">{summary.days ? tk.inTarget.replace('{green}', String(summary.green)).replace('{days}', String(summary.days)) : tk.noDays}</p>
    </div>
  );
}
