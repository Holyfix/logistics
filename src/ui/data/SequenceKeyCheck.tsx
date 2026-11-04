import { useMemo, useState } from 'react';
import { dayToIso } from '../../core/dates';
import { formatQuantity } from '../../core/format';
import { buildMaterialCoverage, missingKeys } from '../../core/material/coverage';
import { dayOfStamp, MINUTES_PER_DAY, type Stamp } from '../../core/material/doors';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsxSheets } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from './DataProvider';

/** Datum a čas stavby „2026-11-05 08:00“ (řadí se správně i jako text). */
const isoTime = (st: Stamp | null) => {
  if (st === null) return '';
  const day = dayOfStamp(st);
  const minute = st - day * MINUTES_PER_DAY;
  return `${dayToIso(day)} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};

/**
 * Kontrola klíče MC/MF (modul Data, panel Sekvence): kombinace dveří, výbavy a barvy z matice, které v klíči chybí,
 * s počtem dveří a první stavbou – jako kontrola mapování u ostatních modulů; seznam jde stáhnout do Excelu.
 */
export function SequenceKeyCheck() {
  const { t, locale } = useI18n();
  const tk = t.data.sequence.check;
  const { state } = useData();
  const sequence = state.data?.sequence;
  const [open, setOpen] = useState(false);
  const missing = useMemo(() => {
    if (!sequence?.matrix || !sequence.key) return null;
    const coverage = buildMaterialCoverage({ matrix: sequence.matrix.orders, key: sequence.key.key, stock: { MC: new Map(), MF: new Map() }, today: localToday() });
    return missingKeys(coverage.cars);
  }, [sequence]);
  if (!missing) return null;
  const qty = (v: number) => formatQuantity(v, locale);
  const doors = missing.reduce((s, m) => s + m.doors, 0);
  const byKind = (kind: 'MC' | 'MF') => missing.filter((m) => m.kind === kind).length;
  const download = () =>
    void downloadXlsxSheets(`${tk.fileName}_${dayToIso(localToday())}.xlsx`, [
      {
        name: tk.sheet,
        header: [tk.kind, tk.door, tk.type, tk.colour, tk.doors, tk.firstBuild],
        rows: missing.map((m) => [m.kind, m.door, m.optionType, m.colour, m.doors, isoTime(m.first)]),
      },
    ]);

  if (missing.length === 0) return <p className="mat-all">{tk.complete}</p>;
  return (
    <details className="check-parts-box" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="cell-short">
          {tk.summary
            .replace('{n}', qty(missing.length))
            .replace('{mc}', qty(byKind('MC')))
            .replace('{mf}', qty(byKind('MF')))
            .replace('{doors}', qty(doors))}
        </span>
      </summary>
      <p className="muted">{tk.hint}</p>
      <p>
        <button type="button" className="button button-small" onClick={download}>
          ⤓ {tk.download}
        </button>
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{tk.kind}</th>
              <th>{tk.door}</th>
              <th>{tk.type}</th>
              <th>{tk.colour}</th>
              <th className="n">{tk.doors}</th>
              <th>{tk.firstBuild}</th>
            </tr>
          </thead>
          <tbody>
            {missing.map((m) => (
              <tr key={`${m.kind}|${m.door}|${m.optionType}|${m.colour}`}>
                <td>{m.kind}</td>
                <td>{m.door}</td>
                <td>{m.optionType}</td>
                <td>
                  <strong>{m.colour || '—'}</strong>
                </td>
                <td className="n">{qty(m.doors)}</td>
                <td>{isoTime(m.first)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
