import { useMemo } from 'react';
import { dayToIso, type DayNumber } from '../../core/dates';
import { formatDayShort } from '../../core/format';
import {
  DEFAULT_TRANSPORT,
  destinationOf,
  formatTime,
  lineCapacity,
  parseTime,
  SHIFT_CODES,
  SHIFT_MINUTES,
  type Destination,
  type LineCapacity,
  type PlanSettings,
  type ShiftCode,
} from '../../core/planning/settings';
import { useI18n } from '../../i18n/I18nProvider';
import { useData } from '../data/DataProvider';
import { usePlanningDrafts } from './PlanningProvider';
import { usePlanSaving } from './save';
import { SaveStatus, useSaveFlow } from './SaveStatus';
import type { PlanningData } from './usePlanning';

const sameLine = (a: LineCapacity, line: string, project: string) => a.line === line && a.project === project;

/** Karta Kapacity: kapacita linek po projektech, začátek směn a doprava k zákazníkovi. Ukládá se do Plan/Kapacity.xlsx. */
export function CapacityPage({ data, today }: { data: PlanningData; today: DayNumber }) {
  const { t, locale } = useI18n();
  const tc = t.planning.capacity;
  const { state } = useData();
  const { setSettings } = usePlanningDrafts();
  const { saveSettings } = usePlanSaving();
  const flow = useSaveFlow();
  const settings = data.settings;
  const update = (next: PlanSettings) => setSettings(next);

  // Řádky linek: montáž pro každý projekt s díly a všechny linky, které už v nastavení jsou.
  const lineRows = useMemo(() => {
    const rows = data.projects.map((p) => lineCapacity(settings, p.line, p.project));
    for (const l of settings.lines) if (!rows.some((r) => sameLine(r, l.line, l.project))) rows.push(l);
    return rows;
  }, [data.projects, settings]);

  const setLine = (row: LineCapacity, change: Partial<LineCapacity>) => {
    const next = { ...row, ...change };
    const lines = settings.lines.some((l) => sameLine(l, row.line, row.project))
      ? settings.lines.map((l) => (sameLine(l, row.line, row.project) ? next : l))
      : [...settings.lines, next];
    update({ ...settings, lines });
  };
  const toggleShift = (row: LineCapacity, code: ShiftCode) =>
    setLine(row, { shifts: SHIFT_CODES.filter((c) => (c === code ? !row.shifts.includes(c) : row.shifts.includes(c))) });

  // Destinace: složky souborů coverage a řádek „ostatní“ pro díly bez souboru.
  const locations = useMemo(() => {
    const names = new Set(state.data?.coverage.map((c) => c.location).filter(Boolean) ?? []);
    for (const d of settings.destinations) if (d.location) names.add(d.location);
    return [...[...names].sort((a, b) => a.localeCompare(b, 'cs')), ''];
  }, [state.data, settings.destinations]);
  const destRow = (location: string): Destination => {
    const own = settings.destinations.find((d) => d.location === location);
    return own ?? { ...(location ? destinationOf(settings, '') : DEFAULT_TRANSPORT), location };
  };
  const setDest = (location: string, change: Partial<Destination>) => {
    const next = { ...destRow(location), ...change };
    const others = settings.destinations.filter((d) => d.location !== location);
    update({ ...settings, destinations: [...others, next] });
  };
  const num = (value: string) => {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // Příklad termínu pro ostatní destinace: potřeba za 2 dny od dneška.
  const example = destRow('');
  const needDay = today + 2;
  const arrivalDay = needDay - example.coverDays + 1;
  const shipAt = arrivalDay * 1440 + example.arrival - example.transitHours * 60;
  const dayText = (d: number) => formatDayShort(dayToIso(Math.floor(d)), locale);

  return (
    <>
      <div className="filters">
        <button type="button" className="button button-primary" disabled={flow.busy} onClick={() => void flow.run((force) => saveSettings(settings, force))}>
          {t.planning.save}
        </button>
        <SaveStatus dirty={data.settingsDirty} saved={data.settingsFile} message={flow.message} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.lines}</h2>
          <span className="muted">{tc.linesSub}</span>
        </div>
        <div className="table-scroll">
          <table className="table table-data">
            <thead>
              <tr>
                <th>{tc.line}</th>
                <th>{tc.project}</th>
                <th className="n">{tc.perShift}</th>
                <th>{tc.shifts}</th>
              </tr>
            </thead>
            <tbody>
              {lineRows.map((row) => (
                <tr key={`${row.line}|${row.project}`}>
                  <td>
                    <strong>{row.line}</strong>
                  </td>
                  <td>{row.project || t.planning.noProject}</td>
                  <td className="n">
                    <input
                      className="plan-input plan-input-wide"
                      inputMode="numeric"
                      aria-label={`${tc.perShift} ${row.line} ${row.project}`}
                      value={row.perShift || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const n = num(e.target.value || '0');
                        if (n !== null) setLine(row, { perShift: n });
                      }}
                    />
                  </td>
                  <td>
                    <span className="actions-row">
                      {SHIFT_CODES.map((code) => (
                        <label key={code} className="check-field">
                          <input type="checkbox" checked={row.shifts.includes(code)} onChange={() => toggleShift(row, code)} />
                          {code}
                        </label>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">{tc.linesNote}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.shiftsHeading}</h2>
        </div>
        <label className="inline-field">
          <span>{tc.firstShift}</span>
          <input
            type="time"
            value={formatTime(settings.firstShiftStart)}
            onChange={(e) => {
              const m = parseTime(e.target.value);
              if (m !== null) update({ ...settings, firstShiftStart: m });
            }}
          />
        </label>
        <p className="muted">
          {SHIFT_CODES.map((code, i) => {
            const start = settings.firstShiftStart + i * SHIFT_MINUTES;
            return `${code} ${formatTime(start)}–${formatTime(start + SHIFT_MINUTES)}`;
          }).join(' · ')}
          . {tc.shiftsNote}
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tc.transport}</h2>
          <span className="muted">{tc.transportSub}</span>
        </div>
        <div className="table-scroll">
          <table className="table table-data">
            <thead>
              <tr>
                <th>{tc.location}</th>
                <th className="n">{tc.coverDays}</th>
                <th className="n">{tc.transit}</th>
                <th>{tc.arrival}</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => {
                const d = destRow(location);
                return (
                  <tr key={location || '-'}>
                    <td>
                      <strong>{location || tc.otherLocations}</strong>
                    </td>
                    <td className="n">
                      <input
                        className="plan-input plan-input-wide"
                        inputMode="numeric"
                        aria-label={`${tc.coverDays} ${location}`}
                        value={d.coverDays}
                        onChange={(e) => {
                          const n = num(e.target.value);
                          if (n !== null) setDest(location, { coverDays: n });
                        }}
                      />
                    </td>
                    <td className="n">
                      <input
                        className="plan-input plan-input-wide"
                        inputMode="numeric"
                        aria-label={`${tc.transit} ${location}`}
                        value={d.transitHours}
                        onChange={(e) => {
                          const n = num(e.target.value);
                          if (n !== null) setDest(location, { transitHours: n });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        aria-label={`${tc.arrival} ${location}`}
                        value={formatTime(d.arrival)}
                        onChange={(e) => {
                          const m = parseTime(e.target.value);
                          if (m !== null) setDest(location, { arrival: m });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          {tc.example} {dayText(needDay)} → {tc.exampleArrival} {dayText(arrivalDay)} {formatTime(example.arrival)} → {tc.exampleShip}{' '}
          {dayText(shipAt / 1440)} {formatTime(shipAt)}.
        </p>
        <p className="muted">{tc.transportNote}</p>
      </div>
    </>
  );
}
