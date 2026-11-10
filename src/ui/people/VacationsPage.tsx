import { useMemo, useState } from 'react';
import { dayFromParts, dayToIso, mondayOf, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity, type Locale } from '../../core/format';
import {
  addEntry,
  addPerson,
  awayOn,
  balanceOf,
  emptyVacations,
  entryDays,
  isHoliday,
  isWorkday,
  removeEntry,
  removePerson,
  renamePerson,
  setAllowance,
  setTeam,
  updateEntry,
  vacationSheets,
  yearOf,
  type VacationData,
  type VacationEntry,
} from '../../core/vacations';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { AddRow, NameInput } from './NameInput';
import { useVacationsDraft } from './drafts';

const FILE = 'Lide/Dovolene.xlsx';

const days = (n: number, locale: Locale) => n.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 1 });
const fullDate = (day: DayNumber, locale: Locale) => `${formatDayShort(dayToIso(day), locale)}${locale === 'cs' ? ' ' : '/'}${dayToIso(day).slice(0, 4)}`;
const range = (e: VacationEntry, locale: Locale) => (e.from === e.to ? fullDate(e.from, locale) : `${formatDayShort(dayToIso(e.from), locale)} – ${fullDate(e.to, locale)}`);

/** Dovolené: kalendář po lidech, nárok a čerpání v roce, seznam dovolených. Ukládá se do Lide/Dovolene.xlsx. */
export function VacationsPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tv = t.vacations;
  const { state, saveFile, updateData } = useData();
  const { draft, setDraft } = useVacationsDraft();
  const flow = useSaveFlow();
  const loaded = state.data;
  const data: VacationData = draft ?? loaded?.vacations?.data ?? emptyVacations();

  const [year, setYear] = useState(yearOf(today));
  const [month, setMonth] = useState(() => {
    const [y, m] = dayToIso(today).split('-').map(Number) as [number, number];
    return { y, m };
  });
  const [team, setTeamFilter] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const teams = useMemo(() => [...new Set(data.people.map((p) => p.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [data]);
  const people = data.people.filter((p) => !team || p.team === team);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="vacations" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.vacations.title}</h1>
        <p className="lead">{t.modules.vacations.description}</p>
      </div>
    </div>
  );

  if (!loaded) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{tv.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {tv.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const update = (next: VacationData) => setDraft(next);
  const save = () =>
    flow.run(async (force) => {
      const path = loaded.vacations?.path ?? FILE;
      const result = await saveFile(path, () => xlsxBlob(vacationSheets(data)), loaded.vacations?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({ ...d, vacations: { path: result.path, lastModified: result.lastModified, data } }));
        setDraft(null);
      }
      return result;
    });

  // Kalendář měsíce.
  const first = dayFromParts(month.y, month.m, 1)!;
  const last = (month.m === 12 ? dayFromParts(month.y + 1, 1, 1)! : dayFromParts(month.y, month.m + 1, 1)!) - 1;
  const monthDays = Array.from({ length: last - first + 1 }, (_, k) => first + k);
  const monthName = new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(first * 86_400_000));
  const shiftMonth = (delta: number) =>
    setMonth(({ y, m }) => {
      const total = y * 12 + (m - 1) + delta;
      return { y: Math.floor(total / 12), m: (total % 12) + 1 };
    });
  const entryAt = (person: string, day: DayNumber) => data.entries.find((e) => e.person === person && e.from <= day && day <= e.to);
  const awayCount = (day: DayNumber) => new Set(awayOn(data, day).filter((e) => people.some((p) => p.name === e.person)).map((e) => e.person)).size;

  const clickCell = (person: string, day: DayNumber) => {
    const entry = entryAt(person, day);
    if (entry) return setSelected(selected === entry.id ? null : entry.id);
    if (!isWorkday(day)) return;
    const result = addEntry(data, person, day);
    update(result.data);
    setSelected(result.id);
  };

  // Přehled nahoře.
  const todayAway = [...new Set(awayOn(data, today).map((e) => e.person))];
  const monday = mondayOf(today);
  const weekAway = new Set(data.entries.filter((e) => e.from <= monday + 4 && e.to >= monday && entryDays(e, monday, monday + 4) > 0).map((e) => e.person));
  const balances = data.people.map((p) => ({ person: p, balance: balanceOf(data, p.name, year, today) }));
  const unapproved = balances.reduce((s, b) => s + b.balance.unapproved, 0);
  const remaining = balances.reduce((s, b) => s + b.balance.remaining, 0);

  const selectedEntry = data.entries.find((e) => e.id === selected) ?? null;
  const yearEntries = data.entries.filter((e) => yearOf(e.from) === year || yearOf(e.to) === year).filter((e) => !team || people.some((p) => p.name === e.person)).sort((a, b) => a.from - b.from || a.id - b.id);
  const years = [yearOf(today) - 1, yearOf(today), yearOf(today) + 1];

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="filters" role="group" aria-label={tv.calendar}>
        <label className="inline-field">
          <span>{tv.year}</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{tv.team}</span>
          <select value={team} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">{tv.allTeams}</option>
            {teams.map((tm) => (
              <option key={tm} value={tm}>
                {tm}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field" title={tv.maxAwayHint}>
          <span>{tv.maxAway}</span>
          <input
            type="number"
            min={1}
            className="input-narrow"
            value={data.maxAway ?? ''}
            onChange={(e) => update({ ...data, maxAway: e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))) })}
          />
        </label>
        <span className="filters-break" role="presentation" />
        <button type="button" className="button" disabled={flow.busy} onClick={() => void save()}>
          {tv.save}
        </button>
        <SaveStatus dirty={draft !== null} saved={loaded.vacations ? { path: loaded.vacations.path, lastModified: loaded.vacations.lastModified } : null} message={flow.message} />
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tv.kpi.today}</span>
          <span className="kpi-value">{formatQuantity(todayAway.length, locale)}</span>
          <span className="kpi-note">{todayAway.length ? todayAway.join(', ') : tv.kpi.nobody}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tv.kpi.week}</span>
          <span className="kpi-value">{formatQuantity(weekAway.size, locale)}</span>
          <span className="kpi-note">{tv.kpi.weekNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tv.kpi.unapproved}</span>
          <span className={`kpi-value${unapproved ? ' cell-warn' : ''}`}>{days(unapproved, locale)}</span>
          <span className="kpi-note">{tv.kpi.unapprovedNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tv.kpi.remaining}</span>
          <span className="kpi-value">{days(remaining, locale)}</span>
          <span className="kpi-note">{tv.kpi.remainingNote.replace('{year}', String(year))}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tv.calendar}</h2>
          <span className="segmented">
            <button type="button" aria-label={tv.prevMonth} onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <button type="button" className="vac-month" disabled>
              {monthName}
            </button>
            <button type="button" aria-label={tv.nextMonth} onClick={() => shiftMonth(1)}>
              ›
            </button>
          </span>
        </div>
        {people.length === 0 ? (
          <p className="muted">{tv.balance.empty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table vac-calendar" aria-label={`${tv.calendar} ${monthName}`}>
              <thead>
                <tr>
                  <th className="sticky-col">{tv.person}</th>
                  {monthDays.map((d) => (
                    <th key={d} className={`vac-day${isWorkday(d) ? '' : ' vac-off'}${d === today ? ' vac-today' : ''}`} title={isHoliday(d) ? tv.holiday : undefined}>
                      <span>{Number(dayToIso(d).slice(8))}</span>
                      <small>{t.calloffs.weekdays[weekday(d) - 1]!.slice(0, 2)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name}>
                    <td className="sticky-col">
                      {p.name}
                      {p.team && <small className="muted"> · {p.team}</small>}
                    </td>
                    {monthDays.map((d) => {
                      const entry = entryAt(p.name, d);
                      const off = !isWorkday(d);
                      const cls = `vac-cell${off ? ' vac-off' : ''}${d === today ? ' vac-today' : ''}${entry && !off ? ` vac-${entry.status}${entry.half ? ' vac-half' : ''}` : ''}${entry && entry.id === selected ? ' vac-selected' : ''}`;
                      const title = entry ? `${p.name}: ${range(entry, locale)} · ${tv.status[entry.status]}${entry.half ? ` · ${tv.legend.half}` : ''}${entry.note ? ` · ${entry.note}` : ''}` : isHoliday(d) ? tv.holiday : undefined;
                      return (
                        <td key={d} className={cls} title={title} onClick={() => clickCell(p.name, d)}>
                          {entry && !off ? (entry.half ? '½' : '') : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-col">{tv.away}</td>
                  {monthDays.map((d) => {
                    const n = awayCount(d);
                    const over = data.maxAway !== null && n > data.maxAway;
                    return (
                      <td key={d} className={`vac-count${over ? ' vac-over' : ''}${isWorkday(d) ? '' : ' vac-off'}`} title={over ? tv.overLimit.replace('{n}', String(data.maxAway)) : undefined}>
                        {n || ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <ul className="cov-legend">
          <li>
            <i className="vac-key vac-approved" aria-hidden="true" /> {tv.legend.approved}
          </li>
          <li>
            <i className="vac-key vac-planned" aria-hidden="true" /> {tv.legend.planned}
          </li>
          <li>
            <i className="vac-key vac-approved vac-half" aria-hidden="true" /> {tv.legend.half}
          </li>
          <li>
            <i className="vac-key vac-off" aria-hidden="true" /> {tv.legend.holiday}
          </li>
        </ul>
        <p className="muted">{tv.calendarHint}</p>
        {selectedEntry && (
          <EntryEditor
            key={selectedEntry.id}
            entry={selectedEntry}
            change={(fn) => update(updateEntry(data, selectedEntry.id, fn))}
            remove={() => {
              if (window.confirm(tv.entry.deleteConfirm.replace('{name}', selectedEntry.person).replace('{range}', range(selectedEntry, locale)))) {
                update(removeEntry(data, selectedEntry.id));
                setSelected(null);
              }
            }}
            close={() => setSelected(null)}
          />
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tv.balance.heading.replace('{year}', String(year))}</h2>
        </div>
        <div className="table-scroll">
          <table className="table table-data vac-balance">
            <thead>
              <tr>
                <th>{tv.balance.name}</th>
                <th>{tv.balance.team}</th>
                <th className="n">{tv.balance.entitlement}</th>
                <th className="n">{tv.balance.carryOver}</th>
                <th className="n">{tv.balance.total}</th>
                <th className="n">{tv.balance.taken}</th>
                <th className="n">{tv.balance.planned}</th>
                <th className="n">{tv.balance.remaining}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {balances
                .filter((b) => !team || b.person.team === team)
                .map(({ person, balance }) => (
                  <tr key={person.name}>
                    <td>
                      <NameInput
                        value={person.name}
                        label={tv.balance.name}
                        invalid={tv.balance.nameTaken}
                        commit={(name) => {
                          const next = renamePerson(data, person.name, name);
                          if (next) update(next);
                          return next !== null;
                        }}
                      />
                    </td>
                    <td>
                      <input aria-label={`${tv.balance.team}: ${person.name}`} list="vac-teams" value={person.team} onChange={(e) => update(setTeam(data, person.name, e.target.value))} />
                    </td>
                    <td className="n">
                      <input
                        type="number"
                        className="input-narrow"
                        aria-label={`${tv.balance.entitlement}: ${person.name}`}
                        value={balance.entitlement}
                        onChange={(e) => update(setAllowance(data, person.name, year, { entitlement: Number(e.target.value) || 0 }))}
                      />
                    </td>
                    <td className="n">
                      <input
                        type="number"
                        step={0.5}
                        className="input-narrow"
                        aria-label={`${tv.balance.carryOver}: ${person.name}`}
                        value={balance.carryOver}
                        onChange={(e) => update(setAllowance(data, person.name, year, { carryOver: Number(e.target.value) || 0 }))}
                      />
                    </td>
                    <td className="n">{days(balance.total, locale)}</td>
                    <td className="n">{days(balance.taken, locale)}</td>
                    <td className="n">
                      {days(balance.planned, locale)}
                      {balance.unapproved > 0 && (
                        <small className="cell-note cell-warn">
                          {tv.balance.unapproved} {days(balance.unapproved, locale)}
                        </small>
                      )}
                    </td>
                    <td className="n">
                      <strong className={balance.remaining < 0 ? 'cell-short' : undefined}>{days(balance.remaining, locale)}</strong>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button-small button-danger"
                        aria-label={`${tv.balance.delete}: ${person.name}`}
                        title={tv.balance.delete}
                        onClick={() => {
                          if (window.confirm(tv.balance.deleteConfirm.replace('{name}', person.name))) update(removePerson(data, person.name));
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <datalist id="vac-teams">
            {teams.map((tm) => (
              <option key={tm} value={tm} />
            ))}
          </datalist>
        </div>
        <p>
          <AddRow
            placeholder={tv.balance.addPlaceholder}
            button={tv.balance.add}
            invalid={tv.balance.nameTaken}
            add={(name) => {
              const next = addPerson(data, name, team);
              if (next) update(next);
              return next !== null;
            }}
          />
        </p>
        <p className="muted">{tv.balance.note}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tv.list.heading.replace('{year}', String(year))}</h2>
        </div>
        {yearEntries.length === 0 ? (
          <p className="muted">{tv.list.empty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table table-data">
              <thead>
                <tr>
                  <th>{tv.person}</th>
                  <th>
                    {tv.entry.from} – {tv.entry.to}
                  </th>
                  <th className="n">{tv.balance.total}</th>
                  <th>{tv.entry.status}</th>
                  <th>{tv.entry.note}</th>
                </tr>
              </thead>
              <tbody>
                {yearEntries.map((e) => (
                  <tr key={e.id} className={`vac-row${e.id === selected ? ' oil-row-open' : ''}`} onClick={() => setSelected(e.id === selected ? null : e.id)}>
                    <td>{e.person}</td>
                    <td>
                      {range(e, locale)}
                      {e.half && <small className="muted"> · {tv.legend.half}</small>}
                    </td>
                    <td className="n">{days(entryDays(e), locale)}</td>
                    <td>
                      <span className={`vac-chip vac-${e.status}`}>{tv.status[e.status]}</span>{' '}
                      {e.status === 'planned' && (
                        <button
                          type="button"
                          className="button button-small"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            update(updateEntry(data, e.id, (x) => ({ ...x, status: 'approved' })));
                          }}
                        >
                          {tv.list.approve}
                        </button>
                      )}
                    </td>
                    <td className="desc">{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function EntryEditor({ entry, change, remove, close }: { entry: VacationEntry; change: (fn: (e: VacationEntry) => VacationEntry) => void; remove: () => void; close: () => void }) {
  const { t, locale } = useI18n();
  const te = t.vacations.entry;
  const setDay = (field: 'from' | 'to', value: string) => {
    const day = parseDay(value);
    if (day !== null) change((e) => ({ ...e, [field]: day }));
  };
  return (
    <div className="vac-editor" role="group" aria-label={`${te.label}: ${entry.person}`}>
      <strong>{entry.person}</strong>
      <label className="field">
        <span>{te.from}</span>
        <input type="date" value={dayToIso(entry.from)} onChange={(e) => setDay('from', e.target.value)} />
      </label>
      <label className="field">
        <span>{te.to}</span>
        <input type="date" value={dayToIso(entry.to)} onChange={(e) => setDay('to', e.target.value)} />
      </label>
      {entry.from === entry.to && (
        <label className="check-field">
          <input type="checkbox" checked={entry.half} onChange={(e) => change((x) => ({ ...x, half: e.target.checked }))} />
          {te.half}
        </label>
      )}
      <span className="segmented" role="group" aria-label={te.status}>
        {(['planned', 'approved'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={entry.status === s} onClick={() => change((x) => ({ ...x, status: s }))}>
            {t.vacations.status[s]}
          </button>
        ))}
      </span>
      <label className="field vac-note">
        <span>{te.note}</span>
        <input value={entry.note} onChange={(e) => change((x) => ({ ...x, note: e.target.value }))} />
      </label>
      <span className="muted">{te.days.replace('{n}', days(entryDays(entry), locale))}</span>
      <span className="actions-row">
        <button type="button" className="button button-small" onClick={close}>
          {te.close}
        </button>
        <button type="button" className="button button-small button-danger" onClick={remove}>
          {te.delete}
        </button>
      </span>
    </div>
  );
}
