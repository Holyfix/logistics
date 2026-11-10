import { useState, type FormEvent } from 'react';
import { mergeAttendance, type AttendanceData } from '../../core/attendance';
import type { DayNumber } from '../../core/dates';
import { useI18n } from '../../i18n/I18nProvider';
import { parseAttendance } from '../../platform/loader';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { AttendanceOverview } from './AttendanceOverview';
import { useAttendance } from './AttendanceProvider';

const fileName = (path: string) => path.split('/').pop() ?? path;

/** Docházka: export docházky zašifrovaný heslem, rozšifrovaný jen v paměti; přehled přesčasů, HO, absencí po lidech. */
export function AttendancePage({ today }: { today?: DayNumber } = {}) {
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
      <AttendanceOverview
        {...(today !== undefined ? { today } : {})}
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
