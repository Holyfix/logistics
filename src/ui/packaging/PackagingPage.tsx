import { useMemo, useRef, useState } from 'react';
import { dayToIso, isoWeek, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import {
  addItem,
  addStep,
  appendItems,
  currentIndex,
  emptyPackaging,
  lastDone,
  moveStep,
  ownerNames,
  packagingSheets,
  removeItem,
  removeStep,
  stamp,
  statusOf,
  updateItem,
  updateStep,
  withComment,
  withDone,
  withDue,
  withoutComment,
  type PackItem,
  type PackList,
  type PackStatus,
  type PackStep,
} from '../../core/packaging';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { parsePackagingFile } from '../../platform/loader';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { usePackagingDraft } from './drafts';

const PACKAGING_FILE = 'Obaly/Obaly.xlsx';
/** Jméno pro komentáře a posuny: stejné jako v OIL. */
const NAME_KEY = 'logistics-user-name';

type Filter = 'open' | 'overdue' | 'week' | 'done' | 'all';
type StepKind = 'done' | 'current' | 'late' | 'next';

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

/** Pořadí: po termínu, tento týden, otevřené podle termínu aktuálního kroku (bez termínu na konci), hotové, zrušené. */
const ORDER: Record<PackStatus, number> = { overdue: 0, week: 1, open: 2, done: 3, cancelled: 4 };

function stepKind(item: PackItem, index: number, today: DayNumber): StepKind {
  const step = item.steps[index]!;
  if (step.done !== null) return 'done';
  if (index !== currentIndex(item)) return 'next';
  return step.due !== null && step.due < today ? 'late' : 'current';
}

/** Kroky bodu jako řetízek kroužků: splněno, aktuální (po termínu červeně), další. */
function StepChain({ item, today }: { item: PackItem; today: DayNumber }) {
  const done = item.steps.filter((s) => s.done !== null).length;
  return (
    <span className="pack-chain">
      {item.steps.map((s, k) => (
        <i key={k} className={`pack-dot pack-dot-${stepKind(item, k, today)}`} title={`${k + 1}. ${s.text}${s.owner ? ` · ${s.owner}` : ''}`} />
      ))}
      <small>
        {done}/{item.steps.length}
      </small>
    </span>
  );
}

/** Obaly: body s kroky (kdo a do kdy), aktuální krok = na co se čeká. Ukládá se do Obaly/Obaly.xlsx. */
export function PackagingPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tp = t.packaging;
  const { state, saveFile, updateData } = useData();
  const { draft, setDraft } = usePackagingDraft();
  const flow = useSaveFlow();
  const data = state.data;
  const list: PackList = draft ?? data?.packaging?.list ?? emptyPackaging();

  const [filter, setFilter] = useState<Filter>('open');
  const [project, setProject] = useState('');
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState(readName);
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const projects = useMemo(() => [...new Set(list.items.map((i) => i.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [list]);
  const owners = useMemo(() => [...new Set(list.items.flatMap((i) => i.steps.flatMap((s) => ownerNames(s.owner))))].sort((a, b) => a.localeCompare(b, 'cs')), [list]);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="packaging" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.packaging.title}</h1>
        <p className="lead">{t.modules.packaging.description}</p>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{tp.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {tp.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const update = (next: PackList) => setDraft(next);
  const change = (id: number, fn: (item: PackItem) => PackItem) => update(updateItem(list, id, fn));
  const add = () => {
    const result = addItem(list, today);
    update(result.list);
    setOpenId(result.id);
    setFilter((f) => (f === 'open' || f === 'all' ? f : 'open'));
  };
  const remove = (id: number) => {
    if (!window.confirm(tp.detail.deleteConfirm.replace('{id}', String(id)))) return;
    update(removeItem(list, id));
    setOpenId(null);
  };
  const save = () =>
    flow.run(async (force) => {
      const path = data.packaging?.path ?? PACKAGING_FILE;
      const result = await saveFile(path, () => xlsxBlob(packagingSheets(list, today)), data.packaging?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({ ...d, packaging: { path: result.path, lastModified: result.lastModified, list } }));
        setDraft(null);
      }
      return result;
    });
  const importFile = async (file: File) => {
    const response = await parsePackagingFile(file.name, await file.arrayBuffer());
    if (response.kind === 'packaging' && response.result.ok) {
      const items = response.result.value.items;
      update(appendItems(list, items));
      setFilter('all');
      setNotice(tp.imported.replace('{n}', formatQuantity(items.length, locale)).replace('{file}', file.name));
    } else if (response.kind === 'error') setNotice(tp.importFailed.replace('{file}', file.name).replace('{detail}', response.message));
    else setNotice(tp.importNone.replace('{file}', file.name));
  };

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const status = (i: PackItem) => statusOf(i, today);
  const isOpen = (i: PackItem) => !['done', 'cancelled'].includes(status(i));
  const open = list.items.filter(isOpen);
  const count = (s: PackStatus) => list.items.filter((i) => status(i) === s).length;
  const noDueSteps = open.reduce((n, i) => n + i.steps.filter((s) => s.done === null && s.due === null).length, 0);
  const dueOf = (i: PackItem) => i.steps[currentIndex(i)]?.due ?? Infinity;

  const q = query.trim().toLowerCase();
  const shown = list.items
    .filter((i) => {
      // Rozbalený bod zůstane vidět, i když po úpravě filtru neodpovídá (např. právě splnil poslední krok).
      if (i.id === openId) return true;
      const s = status(i);
      if (filter === 'open' && !isOpen(i)) return false;
      if (filter !== 'open' && filter !== 'all' && s !== filter) return false;
      if (project && i.project !== project) return false;
      if (owner && !ownerNames(i.steps[currentIndex(i)]?.owner ?? '').includes(owner)) return false;
      return !q || `${i.id} ${i.title} ${i.project} ${i.note} ${i.steps.map((st) => `${st.text} ${st.owner}`).join(' ')}`.toLowerCase().includes(q);
    })
    .sort((a, b) => ORDER[status(a)] - ORDER[status(b)] || dueOf(a) - dueOf(b) || a.id - b.id);

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="filters" role="group" aria-label={tp.filter}>
        <button type="button" className="button button-primary" onClick={add}>
          + {tp.add}
        </button>
        <div className="segmented" role="group" aria-label={tp.filter}>
          {(['open', 'overdue', 'week', 'done', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {tp.filters[f]}
            </button>
          ))}
        </div>
        <label className="inline-field">
          <span>{tp.project}</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{tp.allProjects}</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field" title={tp.ownerTitle}>
          <span>{tp.owner}</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{tp.allOwners}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{tp.search}</span>
          <input type="search" value={query} placeholder={tp.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="filters-break" role="presentation" />
        <label className="inline-field">
          <span>{tp.you}</span>
          <input
            value={name}
            placeholder={tp.youPlaceholder}
            onChange={(e) => {
              setName(e.target.value);
              saveName(e.target.value.trim());
            }}
          />
        </label>
        <button type="button" className="button" title={tp.importTitle} onClick={() => fileInput.current?.click()}>
          {tp.import}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm"
          hidden
          aria-label={tp.import}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
        <button type="button" className="button" disabled={flow.busy} onClick={() => void save()}>
          {tp.save}
        </button>
        <SaveStatus dirty={draft !== null} saved={data.packaging ? { path: data.packaging.path, lastModified: data.packaging.lastModified } : null} message={flow.message} />
      </div>
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.open}</span>
          <span className="kpi-value">{formatQuantity(open.length, locale)}</span>
          <span className="kpi-note">{tp.kpi.openNote.replace('{done}', formatQuantity(count('done'), locale)).replace('{cancelled}', formatQuantity(count('cancelled'), locale))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.overdue}</span>
          <span className={`kpi-value${count('overdue') ? ' cell-short' : ''}`}>{formatQuantity(count('overdue'), locale)}</span>
          <span className="kpi-note">{tp.kpi.overdueNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.week}</span>
          <span className={`kpi-value${count('week') ? ' pack-warn' : ''}`}>{formatQuantity(count('week'), locale)}</span>
          <span className="kpi-note">{tp.kpi.weekNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.noDue}</span>
          <span className="kpi-value">{formatQuantity(noDueSteps, locale)}</span>
          <span className="kpi-note">{tp.kpi.noDueNote}</span>
        </div>
      </div>

      <div className="panel">
        {list.items.length === 0 ? (
          <p className="muted">{tp.emptyList}</p>
        ) : shown.length === 0 ? (
          <p className="muted">{tp.empty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table table-data oil-table pack-table">
              <thead>
                <tr>
                  <th className="n">{tp.table.id}</th>
                  <th>{tp.table.item}</th>
                  <th>{tp.table.steps}</th>
                  <th>{tp.table.last}</th>
                  <th>{tp.table.waiting}</th>
                  <th>{tp.table.owner}</th>
                  <th>{tp.table.due}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => {
                  const s = status(item);
                  const expanded = openId === item.id;
                  const k = currentIndex(item);
                  const step = item.steps[k];
                  const last = lastDone(item);
                  return [
                    <tr key={item.id} className={`oil-row pack-${s}${expanded ? ' oil-row-open' : ''}`} onClick={() => setOpenId(expanded ? null : item.id)}>
                      <td className="n">
                        <strong>{item.id}</strong>
                      </td>
                      <td className="oil-text">
                        <strong className="oil-clamp" title={item.title}>
                          {item.title || tp.noTitle}
                        </strong>
                        {(item.project || item.note) && (
                          <small className="muted oil-clamp" title={item.note}>
                            {[item.project, item.note].filter(Boolean).join(' · ')}
                          </small>
                        )}
                      </td>
                      <td>{item.steps.length ? <StepChain item={item} today={today} /> : <span className="muted">{tp.noSteps}</span>}</td>
                      <td className="pack-last">
                        {last ? (
                          <>
                            ✓ {last.text} <span className="muted">· {formatDayShort(dayToIso(last.done!), locale)}</span>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="pack-waiting">{step ? <strong>{step.text || '—'}</strong> : <span className={`oil-chip oil-chip-${s === 'cancelled' ? 'cancelled' : 'done'}`}>{tp.status[s]}</span>}</td>
                      <td className="oil-owner">{step?.owner || (step ? '—' : '')}</td>
                      <td className="cell-until">
                        {step &&
                          (step.due === null ? (
                            <span className="muted">{tp.noDue}</span>
                          ) : (
                            <>
                              <span className={s === 'overdue' ? 'cell-short' : s === 'week' ? 'pack-warn' : undefined}>{dayLabel(step.due)}</span>
                              <small className={`cell-note${s === 'overdue' ? ' cell-short' : ''}`}>
                                {s === 'overdue' ? tp.overdueDays.replace('{n}', String(today - step.due)) : s === 'week' ? tp.thisWeek : `CW ${isoWeek(step.due).week}`}
                              </small>
                            </>
                          ))}
                        {item.shifts.length > 0 && <small className="cell-note oil-shifted">{tp.shifted.replace('{n}', String(item.shifts.length))}</small>}
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={`${item.id}-detail`} className={`oil-detail-row pack-${s}`}>
                        <td colSpan={7}>
                          <PackDetail
                            item={item}
                            today={today}
                            name={name.trim()}
                            owners={owners}
                            projects={projects}
                            change={(fn) => change(item.id, fn)}
                            remove={() => remove(item.id)}
                            close={() => setOpenId(null)}
                            dayLabel={dayLabel}
                          />
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
          <li className="muted">{tp.legendSteps}</li>
          {(['done', 'current', 'late', 'next'] as const).map((k) => (
            <li key={k}>
              <i className={`pack-dot pack-dot-${k}`} aria-hidden="true" /> {tp.stepKinds[k]}
            </li>
          ))}
        </ul>
        <ul className="cov-legend">
          <li className="muted">{tp.legend}</li>
          {(['overdue', 'week', 'open', 'done', 'cancelled'] as const).map((s) => (
            <li key={s}>
              <span className={`oil-chip pack-chip-${s}`}>{tp.status[s]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PackDetail({
  item,
  today,
  name,
  owners,
  projects,
  change,
  remove,
  close,
  dayLabel,
}: {
  item: PackItem;
  today: DayNumber;
  name: string;
  owners: string[];
  projects: string[];
  change: (fn: (item: PackItem) => PackItem) => void;
  remove: () => void;
  close: () => void;
  dayLabel: (d: DayNumber) => string;
}) {
  const { t, locale } = useI18n();
  const td = t.packaging.detail;
  const [comment, setComment] = useState('');
  const current = currentIndex(item);
  const ownersId = `pack-owners-${item.id}`;

  return (
    <div className="oil-detail" role="group" aria-label={`${td.label} ${item.id}`}>
      <div className="oil-detail-grid">
        <label className="field">
          <span>{td.title}</span>
          <input value={item.title} onChange={(e) => change((i) => ({ ...i, title: e.target.value }))} />
        </label>
        <label className="field">
          <span>{td.project}</span>
          <input list={`pack-projects-${item.id}`} value={item.project} onChange={(e) => change((i) => ({ ...i, project: e.target.value }))} />
          <datalist id={`pack-projects-${item.id}`}>
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>{td.note}</span>
          <input value={item.note} placeholder={td.notePlaceholder} onChange={(e) => change((i) => ({ ...i, note: e.target.value }))} />
        </label>
      </div>
      <datalist id={ownersId}>
        {owners.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <div className="pack-detail-grid">
        <div className="field">
          <span>{td.steps}</span>
          <ol className="pack-steps">
            {item.steps.map((step, k) => (
              <StepRow
                // Po uložení nového termínu se řádek obnoví (zmizí rozepsaný důvod posunu).
                key={`${k}-${step.due ?? ''}`}
                step={step}
                index={k}
                count={item.steps.length}
                kind={stepKind(item, k, today)}
                isCurrent={k === current}
                name={name}
                ownersId={ownersId}
                dayLabel={dayLabel}
                change={(fn) => change((i) => updateStep(i, k, fn))}
                setDone={(done) => change((i) => withDone(i, k, done, today))}
                setDue={(due, reason) => change((i) => withDue(i, k, due, reason, name, stamp(new Date())))}
                move={(by) => change((i) => moveStep(i, k, by))}
                remove={() => {
                  if (!step.text || window.confirm(td.removeStepConfirm.replace('{step}', step.text))) change((i) => removeStep(i, k));
                }}
              />
            ))}
          </ol>
          <div className="actions-row">
            <button type="button" className="button button-small" onClick={() => change(addStep)}>
              {td.addStep}
            </button>
            <small className="muted">
              {td.created} {dayLabel(item.created)}
            </small>
          </div>
        </div>

        <div className="field">
          <span>
            {td.comments} ({formatQuantity(item.comments.length, locale)})
          </span>
          {item.comments.length === 0 ? (
            <small className="muted">{td.noComments}</small>
          ) : (
            <ol className="oil-history">
              {item.comments.map((c, k) => (
                <li key={k} className="oil-comment">
                  <span className="muted">
                    {c.at} · {c.author || '—'}
                  </span>{' '}
                  {c.text}
                  <button
                    type="button"
                    className="oil-comment-delete"
                    aria-label={`${td.deleteComment} ${k + 1}`}
                    title={td.deleteComment}
                    onClick={() => {
                      if (window.confirm(td.deleteCommentConfirm)) change((i) => withoutComment(i, k));
                    }}
                  >
                    ×
                  </button>
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
                  {s.step && <em>{s.step}: </em>}
                  {dayLabel(s.from)} → <strong>{dayLabel(s.to)}</strong>
                  {s.reason && ` – ${s.reason}`}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="actions-row">
        <button type="button" className="button button-small" onClick={() => change((i) => ({ ...i, cancelled: !i.cancelled }))}>
          {item.cancelled ? td.restore : td.cancel}
        </button>
        <button type="button" className="button button-small" onClick={close}>
          {td.close}
        </button>
        <button type="button" className="button button-small button-danger" onClick={remove}>
          {td.delete}
        </button>
      </div>
    </div>
  );
}

function StepRow({
  step,
  index,
  count,
  kind,
  isCurrent,
  name,
  ownersId,
  dayLabel,
  change,
  setDone,
  setDue,
  move,
  remove,
}: {
  step: PackStep;
  index: number;
  count: number;
  kind: StepKind;
  isCurrent: boolean;
  name: string;
  ownersId: string;
  dayLabel: (d: DayNumber) => string;
  change: (fn: (step: PackStep) => PackStep) => void;
  setDone: (done: boolean) => void;
  setDue: (due: DayNumber | null, reason: string) => void;
  move: (by: -1 | 1) => void;
  remove: () => void;
}) {
  const { t } = useI18n();
  const td = t.packaging.detail;
  const [due, setDueText] = useState(step.due === null ? '' : dayToIso(step.due));
  const [reason, setReason] = useState('');
  const newDue = parseDay(due);
  // Změna existujícího termínu je posun: potřebuje důvod a jméno (zapíše se do historie).
  const shifting = step.due !== null && newDue !== null && newDue !== step.due;
  const n = index + 1;

  return (
    <li className={`pack-step pack-step-${kind}`}>
      <span className={`pack-dot pack-step-dot pack-dot-${kind}`} aria-hidden="true">
        {kind === 'done' ? '✓' : n}
      </span>
      <div className="pack-step-body">
        <div className="pack-step-row">
          <input className="pack-step-text" aria-label={`${td.step} ${n}`} placeholder={td.stepPlaceholder} value={step.text} onChange={(e) => change((s) => ({ ...s, text: e.target.value }))} />
          <input className="pack-step-owner" aria-label={`${td.owner} ${n}`} placeholder={td.owner} list={ownersId} value={step.owner} onChange={(e) => change((s) => ({ ...s, owner: e.target.value }))} />
          <input
            type="date"
            aria-label={`${td.due} ${n}`}
            value={due}
            onChange={(e) => {
              setDueText(e.target.value);
              const d = parseDay(e.target.value);
              // První termín nebo smazání termínu se uloží hned, změna termínu až s důvodem.
              if (step.due === null && d !== null) setDue(d, '');
              if (e.target.value === '' && step.due !== null) setDue(null, '');
            }}
          />
          <span className="pack-step-tools">
            {step.done === null && !isCurrent && (
              <button type="button" className="pack-step-done-button" aria-label={`${td.done} ${n}`} title={td.done} onClick={() => setDone(true)}>
                ✓
              </button>
            )}
            <button type="button" className="icon-button" aria-label={`${td.moveUp} ${n}`} title={td.moveUp} disabled={index === 0} onClick={() => move(-1)}>
              ↑
            </button>
            <button type="button" className="icon-button" aria-label={`${td.moveDown} ${n}`} title={td.moveDown} disabled={index === count - 1} onClick={() => move(1)}>
              ↓
            </button>
            <button type="button" className="icon-button pack-step-remove" aria-label={`${td.removeStep} ${n}`} title={td.removeStep} onClick={remove}>
              ×
            </button>
          </span>
        </div>
        {shifting && (
          <div className="oil-due">
            <input aria-label={`${td.reason} ${n}`} placeholder={td.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="button button-small" disabled={!reason.trim() || !name} onClick={() => setDue(newDue, reason)}>
              {td.shift}
            </button>
            {!name && <small className="muted">{td.needName}</small>}
          </div>
        )}
        {/* Splnění: u aktuálního kroku tlačítko, u dalších kroků ✓ vpravo; splněný krok s dnem a Vrátit. */}
        {(step.done !== null || isCurrent) && (
          <div className="pack-step-state">
            {step.done !== null ? (
              <>
                <small className="muted">{td.doneOn.replace('{day}', dayLabel(step.done))}</small>
                <button type="button" className="button button-small" onClick={() => setDone(false)}>
                  {td.undo}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="button button-small button-primary" aria-label={`${td.done} ${n}`} onClick={() => setDone(true)}>
                  {td.markDone}
                </button>
                <small className={kind === 'late' ? 'cell-short' : 'muted'}>{td.current}</small>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
