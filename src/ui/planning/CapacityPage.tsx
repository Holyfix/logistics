import { useMemo } from 'react';
import {
  formatTime,
  lineCapacity,
  parseTime,
  SHIFT_CODES,
  SHIFT_MINUTES,
  type LineCapacity,
  type PlanSettings,
  type ShiftCode,
} from '../../core/planning/settings';
import { useI18n } from '../../i18n/I18nProvider';
import { usePlanningDrafts } from './PlanningProvider';
import { usePlanSaving } from './save';
import { SaveStatus, useSaveFlow } from './SaveStatus';
import type { PlanningData } from './usePlanning';

const sameLine = (a: LineCapacity, line: string, project: string) => a.line === line && a.project === project;

/** Karta Kapacity: kapacita linek po projektech a začátek směn. Ukládá se do Plan/Kapacity.xlsx. */
export function CapacityPage({ data }: { data: PlanningData }) {
  const { t } = useI18n();
  const tc = t.planning.capacity;
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

  const num = (value: string) => {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

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
                <th className="n">{tc.pack}</th>
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
                  <td className="n">
                    <input
                      className="plan-input plan-input-wide"
                      inputMode="numeric"
                      aria-label={`${tc.pack} ${row.line} ${row.project}`}
                      value={row.pack}
                      onChange={(e) => {
                        const n = num(e.target.value);
                        if (n !== null && n >= 1) setLine(row, { pack: Math.round(n) });
                      }}
                    />
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

    </>
  );
}
