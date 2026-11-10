import { useMemo, useState, type FormEvent } from 'react';
import { mergeAttendance, monthsOf, summarize, type AttendanceData, type AttendanceSummary } from '../../core/attendance';
import type { Locale } from '../../core/format';
import { useI18n } from '../../i18n/I18nProvider';
import { parseAttendance } from '../../platform/loader';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { useAttendance } from './AttendanceProvider';

const hours = (n: number, locale: Locale) => n.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const daysText = (n: number, locale: Locale) => n.toLocaleString(locale === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 1 });
const fileName = (path: string) => path.split('/').pop() ?? path;

/** Docházka: export docházky zašifrovaný heslem, rozšifrovaný jen v paměti; přehled přesčasů, HO, absencí po lidech. */
export function AttendancePage() {
  const { t } = useI18n();
  const ta = t.attendance;
  const { state } = useData();
  const { unlocked, setUnlocked } = useAttendance();
  const files = state.data?.attendance ?? [];
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState<string | null | undefined>(undefined);
  const [center, setCenter] = useState('');

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="attendance" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.attendance.title}</h1>
        <p className="lead">{t.modules.attendance.description}</p>
      </div>
    </div>
  );

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parts: AttendanceData[] = [];
      const plainFiles: string[] = [];
      for (const file of files) {
        const response = await parseAttendance(file, password);
        const name = fileName(file.path);
        if (response.kind === 'error') return setError(ta.errors.unreadable.replace('{file}', name).replace('{detail}', response.message));
        if (response.kind !== 'attendance') continue;
        const result = response.result;
        if (!result.ok) {
          if (result.error === 'wrongPassword') return setError(ta.errors.wrongPassword);
          if (result.error === 'missingColumns') return setError(ta.errors.missingColumns.replace('{file}', name).replace('{columns}', result.columns.join(', ')));
          return setError(ta.errors[result.error].replace('{file}', name));
        }
        if (!response.encrypted) plainFiles.push(name);
        parts.push(result.value);
      }
      setUnlocked({ data: mergeAttendance(parts), plainFiles });
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  if (!state.data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{ta.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {ta.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  if (!files.length) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{ta.noFiles}</p>
        </div>
      </section>
    );
  }

  if (!unlocked) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <form className="panel att-lock" onSubmit={(e) => void unlock(e)}>
          <h2>🔒 {ta.locked}</h2>
          <p className="muted">{ta.lockedNote}</p>
          <p className="muted">{ta.files.replace('{list}', files.map((f) => fileName(f.path)).join(', '))}</p>
          <div className="att-lock-row">
            <label className="field">
              <span>{ta.password}</span>
              <input type="password" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? ta.unlocking : ta.unlock}
            </button>
          </div>
          {error && (
            <p className="cell-short" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>
    );
  }

  return (
    <section className="page" aria-labelledby="page-title">
      {head}
      <Overview
        data={unlocked.data}
        plainFiles={unlocked.plainFiles}
        month={month}
        setMonth={setMonth}
        center={center}
        setCenter={setCenter}
        lock={() => setUnlocked(null)}
      />
    </section>
  );
}

function Overview({
  data,
  plainFiles,
  month: chosenMonth,
  setMonth,
  center,
  setCenter,
  lock,
}: {
  data: AttendanceData;
  plainFiles: string[];
  month: string | null | undefined;
  setMonth: (m: string | null) => void;
  center: string;
  setCenter: (c: string) => void;
  lock: () => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.attendance;
  const tt = ta.table;
  const months = useMemo(() => monthsOf(data), [data]);
  // Výchozí je nejnovější měsíc.
  const month = chosenMonth === undefined ? (months[0] ?? null) : chosenMonth;
  const centers = useMemo(() => [...new Set(data.people.map((p) => p.center).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [data]);
  const rows = useMemo(() => summarize(data, month).filter((r) => !center || r.person.center === center), [data, month, center]);
  const monthName = (m: string) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    return new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, 1)));
  };
  const sum = (pick: (r: AttendanceSummary) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const code = (r: AttendanceSummary, c: string) => r.codes.get(c) ?? 0;
  const h = (n: number) => hours(n, locale);
  const d = (n: number) => daysText(n, locale);
  const zero = (n: number, text: string) => (n ? text : <span className="muted">0</span>);

  const columns: { label: string; value: (r: AttendanceSummary) => number; days?: boolean }[] = [
    { label: tt.fond, value: (r) => r.fond },
    { label: tt.worked, value: (r) => r.worked },
    { label: tt.credited, value: (r) => r.credited },
    { label: tt.overtime, value: (r) => r.overtime },
    { label: tt.approved, value: (r) => r.approved },
    { label: tt.toApprove, value: (r) => r.toApprove },
    { label: tt.ho, value: (r) => code(r, 'HO'), days: true },
    { label: tt.doctor, value: (r) => r.doctor },
    { label: tt.vacation, value: (r) => r.vacationHours },
    { label: tt.sick, value: (r) => r.sickHours },
    { label: tt.trip, value: (r) => r.tripHours },
    { label: tt.nv, value: (r) => code(r, 'NV'), days: true },
    { label: tt.night, value: (r) => r.night },
  ];

  return (
    <>
      <div className="filters" role="group" aria-label={tt.heading}>
        <label className="inline-field">
          <span>{ta.month}</span>
          <select value={month ?? ''} onChange={(e) => setMonth(e.target.value || null)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
            <option value="">{ta.allMonths}</option>
          </select>
        </label>
        {centers.length > 1 && (
          <label className="inline-field">
            <span>{ta.center}</span>
            <select value={center} onChange={(e) => setCenter(e.target.value)}>
              <option value="">{ta.allCenters}</option>
              {centers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="filters-break" role="presentation" />
        <button type="button" className="button" onClick={lock}>
          🔒 {ta.lock}
        </button>
        <span className="muted">{ta.autoLock}</span>
      </div>

      {plainFiles.map((f) => (
        <p key={f} className="banner-inline">
          {ta.notEncrypted.replace('{file}', f)}
        </p>
      ))}

      <div className="kpis att-kpis">
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.worked}</span>
          <span className="kpi-value">{h(sum((r) => r.worked))}</span>
          <span className="kpi-note">{ta.kpi.workedNote.replace('{credited}', h(sum((r) => r.credited))).replace('{fond}', h(sum((r) => r.fond)))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.overtime}</span>
          <span className="kpi-value">{h(sum((r) => r.overtime))}</span>
          <span className="kpi-note">{ta.kpi.overtimeNote.replace('{approved}', h(sum((r) => r.approved))).replace('{toApprove}', h(sum((r) => r.toApprove)))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.ho}</span>
          <span className="kpi-value">{d(sum((r) => code(r, 'HO')))}</span>
          <span className="kpi-note">{ta.kpi.hoNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.doctor}</span>
          <span className="kpi-value">{h(sum((r) => r.doctor))}</span>
          <span className="kpi-note">{ta.kpi.doctorNote.replace('{days}', d(sum((r) => code(r, 'LÉKAŘ'))))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.vacation}</span>
          <span className="kpi-value">{h(sum((r) => r.vacationHours))}</span>
          <span className="kpi-note">{ta.kpi.vacationNote.replace('{days}', d(sum((r) => code(r, 'DOV'))))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.sick}</span>
          <span className="kpi-value">{h(sum((r) => r.sickHours))}</span>
          <span className="kpi-note">{ta.kpi.sickNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.trip}</span>
          <span className="kpi-value">{h(sum((r) => r.tripHours))}</span>
          <span className="kpi-note">{ta.kpi.tripNote.replace('{days}', d(sum((r) => code(r, 'SC'))))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ta.kpi.nv}</span>
          <span className="kpi-value">{d(sum((r) => code(r, 'NV')))}</span>
          <span className="kpi-note">{ta.kpi.nvNote}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tt.heading}</h2>
          <span className="muted">{month ? monthName(month) : ta.allMonths}</span>
        </div>
        <div className="table-scroll table-tall">
          <table className="table table-data" aria-label={tt.heading}>
            <thead>
              <tr>
                <th className="sticky-col">{tt.name}</th>
                <th>{tt.center}</th>
                {columns.map((c) => (
                  <th key={c.label} className="n">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.person.id}>
                  <td className="sticky-col">{r.person.name}</td>
                  <td>{r.person.center}</td>
                  {columns.map((c) => {
                    const v = c.value(r);
                    return (
                      <td key={c.label} className="n">
                        {zero(v, c.days ? d(v) : h(v))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">{tt.total}</td>
                <td />
                {columns.map((c) => {
                  const v = sum(c.value);
                  return (
                    <td key={c.label} className="n">
                      {c.days ? d(v) : h(v)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted">{tt.note}</p>
      </div>

      <details className="panel">
        <summary>
          <h2 className="att-summary-heading">{ta.detail.heading}</h2>
        </summary>
        <div className="table-scroll table-tall">
          <table className="table table-data" aria-label={ta.detail.heading}>
            <thead>
              <tr>
                <th className="sticky-col">{tt.name}</th>
                {data.categories.map((c) => (
                  <th key={c} className="n">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.person.id}>
                  <td className="sticky-col">{r.person.name}</td>
                  {data.categories.map((c) => {
                    const v = r.byCategory.get(c) ?? 0;
                    return (
                      <td key={c} className="n">
                        {zero(v, h(v))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">{ta.detail.note}</p>
      </details>
    </>
  );
}
