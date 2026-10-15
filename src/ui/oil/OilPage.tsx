import { useMemo, useState } from 'react';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import {
  addItem,
  emptyOil,
  nextProgress,
  oilSheets,
  originalDue,
  PROGRESS_STEPS,
  stamp,
  statusOf,
  updateItem,
  withComment,
  withDue,
  withProgress,
  type OilItem,
  type OilList,
  type OilStatus,
} from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { useOilDraft } from './OilProvider';
import { ProgressBall } from './ProgressBall';

const OIL_FILE = 'OIL/OIL.xlsx';
const NAME_KEY = 'logistics-user-name';

type Filter = 'open' | 'overdue' | 'done' | 'all';

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

/** Pořadí: po termínu, rozpracované a nezahájené podle termínu (bez termínu na konci), pak hotové a zrušené. */
const ORDER: Record<OilStatus, number> = { overdue: 0, progress: 1, open: 1, done: 2, cancelled: 3 };

/** OIL (Open Issue List): body, plnění po krocích, posuny termínu s důvodem a komentáře. Ukládá se do OIL/OIL.xlsx. */
export function OilPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const to = t.oil;
  const { state, saveFile, updateData } = useData();
  const { draft, setDraft } = useOilDraft();
  const flow = useSaveFlow();
  const data = state.data;
  const list: OilList = draft ?? data?.oil?.list ?? emptyOil();

  const [filter, setFilter] = useState<Filter>('open');
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState(readName);
  const [openId, setOpenId] = useState<number | null>(null);

  const owners = useMemo(() => [...new Set(list.items.map((i) => i.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [list]);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="actions" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.oil.title}</h1>
        <p className="lead">{t.modules.oil.description}</p>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{to.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {to.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const update = (next: OilList) => setDraft(next);
  const change = (id: number, fn: (item: OilItem) => OilItem) => update(updateItem(list, id, fn));
  const add = () => {
    const result = addItem(list, today);
    update(result.list);
    setOpenId(result.id);
    setFilter((f) => (f === 'open' || f === 'all' ? f : 'open'));
  };
  const save = () =>
    flow.run(async (force) => {
      const path = data.oil?.path ?? OIL_FILE;
      const result = await saveFile(path, () => xlsxBlob(oilSheets(list, today)), data.oil?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({ ...d, oil: { path: result.path, lastModified: result.lastModified, list } }));
        setDraft(null);
      }
      return result;
    });

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const status = (i: OilItem) => statusOf(i, today);
  const open = list.items.filter((i) => !['done', 'cancelled'].includes(status(i)));
  const overdue = list.items.filter((i) => status(i) === 'overdue');
  const done = list.items.filter((i) => status(i) === 'done');
  const shifted = list.items.filter((i) => i.shifts.length > 0);

  const q = query.trim().toLowerCase();
  const shown = list.items
    .filter((i) => {
      // Rozbalený bod zůstane vidět, i když po úpravě filtru neodpovídá (např. právě dosáhl 100 %).
      if (i.id === openId) return true;
      const s = status(i);
      if (filter === 'open' && (s === 'done' || s === 'cancelled')) return false;
      if (filter === 'overdue' && s !== 'overdue') return false;
      if (filter === 'done' && s !== 'done') return false;
      if (owner && i.owner !== owner) return false;
      return !q || `${i.id} ${i.problem} ${i.action}`.toLowerCase().includes(q);
    })
    .sort((a, b) => ORDER[status(a)] - ORDER[status(b)] || (a.due ?? Infinity) - (b.due ?? Infinity) || a.id - b.id);

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="filters" role="group" aria-label={to.filter}>
        <button type="button" className="button button-primary" onClick={add}>
          + {to.add}
        </button>
        <div className="segmented" role="group" aria-label={to.filter}>
          {(['open', 'overdue', 'done', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {to.filters[f]}
            </button>
          ))}
        </div>
        <label className="inline-field">
          <span>{to.owner}</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{to.allOwners}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{to.search}</span>
          <input type="search" value={query} placeholder={to.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="filters-break" role="presentation" />
        <label className="inline-field">
          <span>{to.you}</span>
          <input
            value={name}
            placeholder={to.youPlaceholder}
            onChange={(e) => {
              setName(e.target.value);
              saveName(e.target.value.trim());
            }}
          />
        </label>
        <button type="button" className="button" disabled={flow.busy} onClick={() => void save()}>
          {to.save}
        </button>
        <SaveStatus dirty={draft !== null} saved={data.oil ? { path: data.oil.path, lastModified: data.oil.lastModified } : null} message={flow.message} />
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{to.kpi.open}</span>
          <span className="kpi-value">{formatQuantity(open.length, locale)}</span>
          <span className="kpi-note">{to.kpi.openNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{to.kpi.overdue}</span>
          <span className={`kpi-value${overdue.length ? ' cell-short' : ''}`}>{formatQuantity(overdue.length, locale)}</span>
          <span className="kpi-note">{to.kpi.overdueNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{to.kpi.done}</span>
          <span className="kpi-value">{formatQuantity(done.length, locale)}</span>
          <span className="kpi-note">{to.kpi.doneNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{to.kpi.shifted}</span>
          <span className="kpi-value">
            {formatQuantity(shifted.length, locale)} / {formatQuantity(list.items.reduce((s, i) => s + i.shifts.length, 0), locale)}
          </span>
          <span className="kpi-note">{to.kpi.shiftedNote}</span>
        </div>
      </div>

      <div className="panel">
        {list.items.length === 0 ? (
          <p className="muted">{to.emptyList}</p>
        ) : shown.length === 0 ? (
          <p className="muted">{to.empty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table table-data oil-table">
              <thead>
                <tr>
                  <th className="n">{to.table.id}</th>
                  <th>{to.table.problem}</th>
                  <th>{to.table.owner}</th>
                  <th>{to.table.due}</th>
                  <th>{to.table.progress}</th>
                  <th>{to.table.status}</th>
                  <th className="n">{to.table.comments}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => {
                  const s = status(item);
                  const expanded = openId === item.id;
                  return [
                    <tr key={item.id} className={`oil-row oil-${s}${expanded ? ' oil-row-open' : ''}`} onClick={() => setOpenId(expanded ? null : item.id)}>
                      <td className="n">
                        <strong>{item.id}</strong>
                      </td>
                      <td className="oil-text">
                        <strong>{item.problem || to.noProblem}</strong>
                        {item.action && <small className="muted cell-note">{item.action}</small>}
                      </td>
                      <td>{item.owner || '—'}</td>
                      <td className="cell-until">
                        {item.due === null ? <span className="muted">{to.noDue}</span> : <span className={s === 'overdue' ? 'cell-short' : undefined}>{dayLabel(item.due)}</span>}
                        {item.shifts.length > 0 && (
                          <small className="cell-note oil-shifted">
                            {to.shifted} {item.shifts.length}
                            {to.times}
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="oil-step"
                          aria-label={`${to.table.progress} ${item.id}: ${item.progress} %, ${to.progressNext}`}
                          title={`${item.progress} % · ${to.progressNext}`}
                          disabled={item.cancelled || item.progress === 100}
                          onClick={(e) => {
                            e.stopPropagation();
                            change(item.id, (i) => withProgress(i, nextProgress(i.progress), today));
                          }}
                        >
                          <ProgressBall progress={item.progress} status={s} />
                          <span>{item.progress} %</span>
                        </button>
                      </td>
                      <td>
                        <span className={`oil-chip oil-chip-${s}`}>{to.status[s]}</span>
                      </td>
                      <td className="n">{item.comments.length || ''}</td>
                    </tr>,
                    expanded && (
                      <tr key={`${item.id}-detail`} className={`oil-detail-row oil-${s}`}>
                        <td colSpan={7}>
                          <OilDetail item={item} today={today} name={name.trim()} owners={owners} change={(fn) => change(item.id, fn)} close={() => setOpenId(null)} dayLabel={dayLabel} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        <ul className="cov-legend">
          {(['overdue', 'progress', 'open', 'done', 'cancelled'] as const).map((s) => (
            <li key={s}>
              <ProgressBall progress={s === 'done' ? 100 : s === 'progress' ? 50 : 0} status={s} /> {to.status[s]}
            </li>
          ))}
          <li className="muted">{to.legend}</li>
        </ul>
      </div>
    </section>
  );
}

function OilDetail({
  item,
  today,
  name,
  owners,
  change,
  close,
  dayLabel,
}: {
  item: OilItem;
  today: DayNumber;
  name: string;
  owners: string[];
  change: (fn: (item: OilItem) => OilItem) => void;
  close: () => void;
  dayLabel: (d: DayNumber) => string;
}) {
  const { t, locale } = useI18n();
  const td = t.oil.detail;
  const [due, setDue] = useState(item.due === null ? '' : dayToIso(item.due));
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const newDue = parseDay(due);
  const isShift = item.due !== null;
  const canDue = newDue !== null && newDue !== item.due && (!isShift || (reason.trim() !== '' && name !== ''));
  const first = originalDue(item);

  return (
    <div className="oil-detail" role="group" aria-label={`${td.label} ${item.id}`}>
      <div className="oil-detail-grid">
        <label className="field">
          <span>{td.problem}</span>
          <textarea rows={2} value={item.problem} onChange={(e) => change((i) => ({ ...i, problem: e.target.value }))} />
        </label>
        <label className="field">
          <span>{td.action}</span>
          <textarea rows={2} value={item.action} onChange={(e) => change((i) => ({ ...i, action: e.target.value }))} />
        </label>
        <label className="field">
          <span>{td.owner}</span>
          <input list={`oil-owners-${item.id}`} value={item.owner} onChange={(e) => change((i) => ({ ...i, owner: e.target.value }))} />
          <datalist id={`oil-owners-${item.id}`}>
            {owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
        <div className="field">
          <span>{td.progress}</span>
          <div className="segmented" role="group" aria-label={`${td.progress} ${item.id}`}>
            {PROGRESS_STEPS.map((p) => (
              <button key={p} type="button" aria-pressed={item.progress === p} disabled={item.cancelled} onClick={() => change((i) => withProgress(i, p, today))}>
                {p} %
              </button>
            ))}
          </div>
          <small className="muted">
            {td.opened} {dayLabel(item.opened)}
            {item.closed !== null && ` · ${td.closed} ${dayLabel(item.closed)}`}
          </small>
        </div>
      </div>

      <div className="oil-detail-grid">
        <div className="field">
          <span>
            {td.due}: {item.due === null ? t.oil.noDue : dayLabel(item.due)}
            {item.shifts.length > 0 && first !== null && ` (${td.original} ${dayLabel(first)})`}
          </span>
          <div className="oil-due">
            <input type="date" aria-label={td.newDue} value={due} onChange={(e) => setDue(e.target.value)} />
            {isShift && <input aria-label={td.reason} placeholder={td.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />}
            <button
              type="button"
              className="button button-small"
              disabled={!canDue}
              onClick={() => {
                change((i) => withDue(i, newDue!, reason, name, stamp(new Date())));
                setReason('');
              }}
            >
              {isShift ? td.shiftDue : td.setDue}
            </button>
          </div>
          {isShift && !name && <small className="muted">{td.needName}</small>}
          <span className="oil-sub">
            {td.shifts} ({formatQuantity(item.shifts.length, locale)})
          </span>
          {item.shifts.length === 0 ? (
            <small className="muted">{td.noShifts}</small>
          ) : (
            <ol className="oil-history">
              {item.shifts.map((s, k) => (
                <li key={k}>
                  <span className="muted">
                    {s.at} · {s.author || '—'}
                  </span>{' '}
                  {dayLabel(s.from)} → <strong>{dayLabel(s.to)}</strong>
                  {s.reason && ` – ${s.reason}`}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="field">
          <span>
            {td.comments} ({formatQuantity(item.comments.length, locale)})
          </span>
          {item.comments.length === 0 ? (
            <small className="muted">{td.noComments}</small>
          ) : (
            <ol className="oil-history">
              {[...item.comments].reverse().map((c, k) => (
                <li key={k}>
                  <span className="muted">
                    {c.at} · {c.author || '—'}
                  </span>{' '}
                  {c.text}
                </li>
              ))}
            </ol>
          )}
          <textarea rows={2} aria-label={td.addComment} placeholder={td.commentPlaceholder} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="actions-row">
            <button
              type="button"
              className="button button-small"
              disabled={!comment.trim() || !name}
              onClick={() => {
                change((i) => withComment(i, comment, name, stamp(new Date())));
                setComment('');
              }}
            >
              {td.addComment}
            </button>
            {!name && <small className="muted">{td.needName}</small>}
          </div>
        </div>
      </div>

      <div className="actions-row">
        <button type="button" className="button button-small" onClick={() => change((i) => ({ ...i, cancelled: !i.cancelled }))}>
          {item.cancelled ? td.restore : td.cancel}
        </button>
        <button type="button" className="button button-small" onClick={close}>
          {td.close}
        </button>
      </div>
    </div>
  );
}
