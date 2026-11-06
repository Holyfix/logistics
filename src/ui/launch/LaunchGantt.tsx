import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { dayToIso, isoWeek, mondayOf, parseDay, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity, type Locale } from '../../core/format';
import {
  clampProgress,
  customerColors,
  DAY_WIDTH,
  groupStatus,
  isPassed,
  nextMonth,
  progressOf,
  renameProject,
  shiftDays,
  spanOf,
  statusOf,
  timelineRange,
  updateProject,
  withEnd,
  withKind,
  withStart,
  type LaunchItem,
  type LaunchKind,
  type LaunchPlan,
  type LaunchProject,
  type LaunchScale,
  type LaunchStatus,
} from '../../core/launch';
import { useI18n } from '../../i18n/I18nProvider';

export type Selection = { type: 'item'; id: number } | { type: 'project'; name: string } | null;

/** Datum s rokem: „6. 11. 2026“ / „6/11/2026“. */
export const dayText = (day: DayNumber, locale: Locale) => `${formatDayShort(dayToIso(day), locale)}${locale === 'cs' ? ' ' : '/'}${dayToIso(day).slice(0, 4)}`;

export type GanttRow =
  | {
      type: 'project';
      key: string;
      project: LaunchProject;
      items: LaunchItem[];
      collapsed: boolean;
    }
  | {
      type: 'phase';
      key: string;
      phase: string;
      items: LaunchItem[];
      collapsed: boolean;
    }
  | { type: 'item'; key: string; item: LaunchItem; depth: 1 | 2 }
  | { type: 'empty'; key: string };

const PROGRESS_QUICK = [0, 25, 50, 75, 100];
/** Počet barev zákaznických fází (gantt-c0 … gantt-c5), pak se opakují. */
const CUSTOMER_COLORS = 6;
const COLUMNS = 5;

interface Segment {
  start: DayNumber;
  end: DayNumber;
  label: string;
  title?: string;
}

/** Popisky osy: horní řádek měsíce (u čtvrtletí čtvrtletí), dolní kalendářní týdny (u čtvrtletí měsíce). */
function scaleSegments(from: DayNumber, to: DayNumber, scale: LaunchScale, locale: string): { top: Segment[]; bottom: Segment[]; months: DayNumber[] } {
  const months: DayNumber[] = [];
  for (let m = from; m < to; m = nextMonth(m)) months.push(m);
  const monthName = (d: DayNumber, month: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : 'en-GB', {
      month,
      ...(month === 'long' ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(new Date(d * 86_400_000));
  const monthSegments = (month: 'long' | 'short') =>
    months.map((m) => ({
      start: m,
      end: Math.min(nextMonth(m), to),
      label: monthName(m, month),
    }));
  if (scale === 'quarter') {
    const top: Segment[] = [];
    for (const m of months) {
      const [y, mo] = dayToIso(m).split('-').map(Number) as [number, number];
      const q = Math.floor((mo - 1) / 3) + 1;
      const label = `Q${q} ${y}`;
      const last = top.at(-1);
      if (last?.label === label) last.end = Math.min(nextMonth(m), to);
      else top.push({ start: m, end: Math.min(nextMonth(m), to), label });
    }
    return { top, bottom: monthSegments('short'), months };
  }
  const bottom: Segment[] = [];
  for (let d = mondayOf(from); d < to; d += 7) {
    const w = isoWeek(d).week;
    bottom.push({
      start: Math.max(d, from),
      end: Math.min(d + 7, to),
      label: scale === 'week' ? `CW ${w}` : String(w),
      title: `CW ${w}`,
    });
  }
  return { top: monthSegments('long'), bottom, months };
}

export function LaunchGantt({
  plan,
  rows,
  rangeItems,
  today,
  scale,
  selected,
  owners,
  select,
  toggle,
  update,
  newItem,
  reveal,
  removeItem,
  removeProject,
  renamed,
  changeItem,
}: {
  plan: LaunchPlan;
  rows: GanttRow[];
  /** Úkoly a milníky, podle kterých se určí rozsah osy. */
  rangeItems: LaunchItem[];
  today: DayNumber;
  scale: LaunchScale;
  selected: Selection;
  owners: string[];
  select: (s: Selection) => void;
  toggle: (key: string) => void;
  update: (plan: LaunchPlan) => void;
  newItem: (project: string, kind: LaunchKind, customer: boolean) => void;
  /** Otevře řádek (i ve sbaleném projektu či fázi). */
  reveal: (item: LaunchItem) => void;
  removeItem: (id: number) => void;
  removeProject: (name: string) => void;
  renamed: (from: string, to: string) => void;
  changeItem: (id: number, fn: (item: LaunchItem) => LaunchItem) => void;
}) {
  const { t, locale } = useI18n();
  const tl = t.launch;
  const { from, to } = timelineRange(rangeItems, today);
  const px = DAY_WIDTH[scale];
  const width = Math.round((to - from) * px);
  const x = (d: DayNumber) => Math.round((d - from) * px);
  const { top, bottom, months } = scaleSegments(from, to, scale, locale);
  // Po otevření a změně měřítka se osa posune tak, aby dnešek byl vidět (s dvěma týdny před ním).
  const scroller = useRef<HTMLDivElement>(null);
  const todayX = x(Math.max(from, today - 14));
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = todayX;
  }, [scale, todayX]);
  const short = (d: DayNumber) => formatDayShort(dayToIso(d), locale);
  const trackStyle = {
    width: `${width}px`,
    minWidth: `${width}px`,
    '--gantt-week': `${7 * px}px`,
    '--gantt-offset': `${x(mondayOf(from))}px`,
  } as CSSProperties;
  const todayLine = today >= from && today < to ? <span className="gantt-today" style={{ left: `${x(today) + px / 2}px` }} aria-hidden="true" /> : null;
  const monthLines = months.slice(1).map((m) => <span key={m} className="gantt-month-line" style={{ left: `${x(m)}px` }} aria-hidden="true" />);

  const track = (content: ReactNode) => (
    <td className={`gantt-track${scale === 'quarter' ? '' : ' gantt-weeks'}`} style={trackStyle}>
      {monthLines}
      {todayLine}
      {content}
    </td>
  );

  // Zákaznické termíny: barva podle fáze v projektu; interní řádky: barva podle plnění (stavu).
  const colors = new Map(plan.projects.map((p) => [p.name, customerColors(plan.items.filter((i) => i.project === p.name))]));
  const customerClass = (project: string, phase: string) => `gantt-c${(colors.get(project)?.get(phase) ?? 0) % CUSTOMER_COLORS}`;
  const itemClass = (item: LaunchItem) => (item.customer ? `${customerClass(item.project, item.phase)}${isPassed(item, today) ? ' gantt-passed' : ''}` : `gantt-${statusOf(item, today)}`);
  const itemTitle = (item: LaunchItem) => {
    const status = statusOf(item, today);
    const when = item.end === null ? tl.noDate : item.kind === 'task' && item.start !== null ? `${short(item.start)} – ${short(item.end)}` : short(item.end);
    return `${item.name || tl.noName} · ${when} · ${item.customer ? `${tl.status.customer}${isPassed(item, today) ? ` (${tl.passed})` : ''}` : `${tl.status[status]} · ${item.progress} %`}`;
  };

  const summaryBar = (items: readonly LaunchItem[], status: LaunchStatus, progress: number | null, phaseClass: string | null) => {
    const span = spanOf(items);
    if (!span) return null;
    const colour = status === 'customer' ? (phaseClass ?? 'gantt-customer') : `gantt-${status}`;
    return (
      <span
        className={`gantt-sum ${colour}${phaseClass !== null ? ' gantt-sum-phase' : ''}`}
        style={{
          left: `${x(span.start)}px`,
          width: `${Math.max(x(span.end + 1) - x(span.start), 4)}px`,
        }}
        title={`${short(span.start)} – ${short(span.end)}${progress === null ? '' : ` · ${progress} %`}`}
      >
        {progress !== null && <span className="gantt-fill" style={{ width: `${progress}%` }} />}
        {progress !== null && <span className="gantt-tag gantt-tag-out">{progress} %</span>}
      </span>
    );
  };

  /** Bod v Ganttu (milník nebo pruh úkolu): kliknutím se řádek otevře; mini = ve sbaleném projektu či fázi, bez popisků. */
  const itemMark = (item: LaunchItem, mini = false) => {
    if (item.end === null) return null;
    const open = (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      if (mini) reveal(item);
      else select(selected?.type === 'item' && selected.id === item.id ? null : { type: 'item', id: item.id });
    };
    const base =
      !mini && item.baseline !== null && item.baseline !== item.end ? (
        <span className="gantt-base" style={{ left: `${x(item.baseline) + px / 2}px` }} title={`${tl.legendBaseline}: ${short(item.baseline)}`} aria-hidden="true" />
      ) : null;
    if (item.kind === 'milestone' || item.start === null) {
      return (
        <span key={item.id}>
          {base}
          <button
            type="button"
            className={`gantt-ms ${itemClass(item)}${mini ? ' gantt-mini' : ''}`}
            style={{ left: `${x(item.end) + px / 2}px` }}
            title={itemTitle(item)}
            aria-label={itemTitle(item)}
            onClick={open}
          />
          {!mini && (
            <span className="gantt-tag gantt-tag-ms" style={{ left: `${x(item.end) + px / 2 + 10}px` }}>
              {short(item.end)}
            </span>
          )}
        </span>
      );
    }
    return (
      <span key={item.id}>
        {base}
        <button
          type="button"
          className={`gantt-bar ${itemClass(item)}${mini ? ' gantt-mini' : ''}`}
          style={{
            left: `${x(item.start)}px`,
            width: `${Math.max(x(item.end + 1) - x(item.start), 3)}px`,
          }}
          title={itemTitle(item)}
          aria-label={itemTitle(item)}
          onClick={open}
        >
          {!item.customer && <span className="gantt-fill" style={{ width: `${item.progress}%` }} />}
          {!mini && <span className="gantt-tag gantt-tag-out">{short(item.end)}</span>}
        </button>
      </span>
    );
  };
  /** Body sbalené skupiny přes souhrnný pruh (nejdřív úkoly, milníky navrch). */
  const miniMarks = (items: readonly LaunchItem[]) => [...items].sort((a, b) => Number(a.kind === 'milestone') - Number(b.kind === 'milestone')).map((i) => itemMark(i, true));

  const chevron = (key: string, isCollapsed: boolean, label: string) => (
    <button
      type="button"
      className="gantt-chevron"
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? tl.expand : tl.collapse}: ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        toggle(key);
      }}
    >
      {isCollapsed ? '▸' : '▾'}
    </button>
  );

  const dueCell = (items: readonly LaunchItem[]) => {
    const span = spanOf(items);
    return <td className="gantt-due">{span ? dayText(span.end, locale) : <span className="muted">{tl.noDate}</span>}</td>;
  };

  return (
    <div className="table-scroll gantt-scroll" ref={scroller}>
      <table className="table gantt">
        <thead>
          <tr>
            <th className="gantt-name" rowSpan={2}>
              {tl.table.name}
            </th>
            <th className="gantt-owner" rowSpan={2}>
              {tl.table.owner}
            </th>
            <th className="gantt-progress n" rowSpan={2}>
              {tl.table.progress}
            </th>
            <th className="gantt-due" rowSpan={2}>
              {tl.table.due}
            </th>
            <th className="gantt-scale" style={{ width: `${width}px`, minWidth: `${width}px` }} aria-label={tl.table.timeline}>
              {top.map((s) => (
                <span
                  key={s.start}
                  className="gantt-seg gantt-seg-top"
                  style={{
                    left: `${x(s.start)}px`,
                    width: `${x(s.end) - x(s.start)}px`,
                  }}
                >
                  {s.label}
                </span>
              ))}
            </th>
          </tr>
          <tr>
            <th className="gantt-scale gantt-scale-bottom" style={{ width: `${width}px`, minWidth: `${width}px` }}>
              {bottom.map((s) => (
                <span
                  key={s.start}
                  className="gantt-seg"
                  style={{
                    left: `${x(s.start)}px`,
                    width: `${x(s.end) - x(s.start)}px`,
                  }}
                  title={s.title}
                >
                  {x(s.end) - x(s.start) >= 16 ? s.label : ''}
                </span>
              ))}
              {today >= from && today < to && (
                <span className="gantt-today-tag" style={{ left: `${x(today) + px / 2}px` }}>
                  {tl.today}
                </span>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.type === 'empty')
              return (
                <tr key={row.key} className="gantt-row-empty">
                  <td className="gantt-name gantt-depth-1 muted" colSpan={4}>
                    {tl.emptyProject}
                  </td>
                  {track(null)}
                </tr>
              );
            if (row.type === 'phase') {
              const status = groupStatus(row.items, today);
              const progress = progressOf(row.items);
              const project = row.items[0]!.project;
              const phaseClass = row.items.some((i) => i.customer) ? customerClass(project, row.phase) : '';
              return (
                <tr key={row.key} className="gantt-row-phase" onClick={() => toggle(row.key)}>
                  <td className="gantt-name gantt-depth-1">
                    {chevron(row.key, row.collapsed, row.phase)}
                    {phaseClass && <i className={`gantt-swatch ${phaseClass}`} title={tl.status.customer} aria-hidden="true" />}
                    <span>{row.phase}</span>
                  </td>
                  <td className="gantt-owner" />
                  <td className="gantt-progress n">{progress === null ? '—' : `${progress} %`}</td>
                  {dueCell(row.items)}
                  {track(
                    <>
                      {summaryBar(row.items, status, progress, phaseClass)}
                      {row.collapsed && miniMarks(row.items)}
                    </>,
                  )}
                </tr>
              );
            }
            if (row.type === 'project') {
              const status = groupStatus(row.items, today);
              const progress = progressOf(row.items);
              const open = selected?.type === 'project' && selected.name === row.project.name;
              return [
                <tr key={row.key} className={`gantt-row-project${open ? ' gantt-row-open' : ''}`} onClick={() => toggle(row.key)}>
                  <td className="gantt-name">
                    {chevron(row.key, row.collapsed, row.project.name)}
                    <strong>{row.project.name}</strong>
                    <button
                      type="button"
                      className="gantt-edit"
                      aria-label={`${tl.edit}: ${row.project.name}`}
                      title={tl.edit}
                      aria-pressed={open}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(open ? null : { type: 'project', name: row.project.name });
                      }}
                    >
                      ✎
                    </button>
                    {row.project.description && <small className="muted gantt-desc">{row.project.description}</small>}
                  </td>
                  <td className="gantt-owner" />
                  <td className="gantt-progress n">
                    <strong>{progress === null ? '—' : `${progress} %`}</strong>
                  </td>
                  {dueCell(row.items)}
                  {track(
                    <>
                      {summaryBar(row.items, status, progress, null)}
                      {row.collapsed && miniMarks(row.items)}
                    </>,
                  )}
                </tr>,
                open && (
                  <tr key={`${row.key}-detail`} className="gantt-detail-row">
                    <td colSpan={COLUMNS}>
                      <ProjectDetail
                        key={row.project.name}
                        project={row.project}
                        count={row.items.length}
                        rename={(name) => {
                          const next = renameProject(plan, row.project.name, name);
                          if (!next) return false;
                          if (name.trim() !== row.project.name) {
                            update(next);
                            renamed(row.project.name, name.trim());
                          }
                          return true;
                        }}
                        describe={(description) =>
                          update(
                            updateProject(plan, row.project.name, (p) => ({
                              ...p,
                              description,
                            })),
                          )
                        }
                        add={(kind, customer) => newItem(row.project.name, kind, customer)}
                        remove={() => {
                          if (window.confirm(tl.projectDetail.deleteConfirm.replace('{name}', row.project.name).replace('{n}', formatQuantity(row.items.length, locale))))
                            removeProject(row.project.name);
                        }}
                        close={() => select(null)}
                      />
                    </td>
                  </tr>
                ),
              ];
            }
            const { item } = row;
            const status = statusOf(item, today);
            const open = selected?.type === 'item' && selected.id === item.id;
            const shift = shiftDays(item);
            return [
              <tr key={row.key} className={`gantt-row-item${open ? ' gantt-row-open' : ''}`} onClick={() => select(open ? null : { type: 'item', id: item.id })}>
                <td className={`gantt-name gantt-depth-${row.depth}`}>
                  <i className={`gantt-dot ${itemClass(item)}${item.kind === 'milestone' ? ' gantt-dot-ms' : ''}`} title={`${tl.kind[item.kind]} · ${tl.status[status]}`} aria-hidden="true" />
                  <span className="gantt-label" title={item.note || undefined}>
                    {item.name || <span className="muted">{tl.noName}</span>}
                  </span>
                </td>
                <td className="gantt-owner">{item.owner || (item.customer ? <span className="muted">{tl.customerOwner}</span> : '—')}</td>
                <td className="gantt-progress n">
                  {item.customer ? (
                    <span className="muted" title={tl.customerProgress}>
                      —
                    </span>
                  ) : (
                    `${item.progress} %`
                  )}
                </td>
                <td className="gantt-due">
                  {item.end === null ? <span className="muted">{tl.noDate}</span> : <span className={status === 'overdue' ? 'cell-short' : undefined}>{dayText(item.end, locale)}</span>}
                  {shift !== 0 && (
                    <small className="cell-note gantt-shift" title={`${tl.legendBaseline}: ${dayText(item.baseline!, locale)}`}>
                      {tl.shifted.replace('{days}', `${shift > 0 ? '+' : ''}${formatQuantity(shift, locale)}`)}
                    </small>
                  )}
                </td>
                {track(itemMark(item))}
              </tr>,
              open && (
                <tr key={`${row.key}-detail`} className="gantt-detail-row">
                  <td colSpan={COLUMNS}>
                    <ItemDetail
                      item={item}
                      phases={[...new Set(plan.items.filter((i) => i.project === item.project && i.phase).map((i) => i.phase))]}
                      owners={owners}
                      change={(fn) => changeItem(item.id, fn)}
                      remove={() => {
                        if (window.confirm(tl.detail.deleteConfirm.replace('{name}', item.name || tl.noName))) removeItem(item.id);
                      }}
                      close={() => select(null)}
                    />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

const isoOrEmpty = (d: DayNumber | null) => (d === null ? '' : dayToIso(d));

function ItemDetail({
  item,
  phases,
  owners,
  change,
  remove,
  close,
}: {
  item: LaunchItem;
  phases: string[];
  owners: string[];
  change: (fn: (item: LaunchItem) => LaunchItem) => void;
  remove: () => void;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const td = t.launch.detail;
  const shift = shiftDays(item);
  return (
    <div className="gantt-detail" role="group" aria-label={`${td.label}: ${item.name || t.launch.noName}`} onClick={(e) => e.stopPropagation()}>
      <div className="gantt-detail-grid">
        <label className="field gantt-field-wide">
          <span>{td.name}</span>
          <input autoFocus={!item.name} value={item.name} onChange={(e) => change((i) => ({ ...i, name: e.target.value }))} />
        </label>
        <label className="field">
          <span>{td.phase}</span>
          <input list={`launch-phases-${item.id}`} value={item.phase} placeholder={td.phaseHint} onChange={(e) => change((i) => ({ ...i, phase: e.target.value }))} />
          <datalist id={`launch-phases-${item.id}`}>
            {phases.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <div className="field">
          <span>{td.kind}</span>
          <span className="segmented" role="group" aria-label={td.kind}>
            {(['task', 'milestone'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={item.kind === k} onClick={() => change((i) => withKind(i, k))}>
                {t.launch.kind[k]}
              </button>
            ))}
          </span>
        </div>
        <div className="field">
          <span>{td.source}</span>
          <span className="segmented" role="group" aria-label={td.source}>
            {([true, false] as const).map((c) => (
              <button key={String(c)} type="button" aria-pressed={item.customer === c} onClick={() => change((i) => ({ ...i, customer: c }))}>
                {t.launch.source[c ? 'customer' : 'internal']}
              </button>
            ))}
          </span>
        </div>
        {item.kind === 'task' && (
          <label className="field">
            <span>{td.start}</span>
            <input type="date" value={isoOrEmpty(item.start)} onChange={(e) => change((i) => withStart(i, parseDay(e.target.value)))} />
          </label>
        )}
        <label className="field">
          <span>{item.kind === 'task' ? td.end : td.date}</span>
          <input type="date" value={isoOrEmpty(item.end)} onChange={(e) => change((i) => withEnd(i, parseDay(e.target.value)))} />
        </label>
        <label className="field">
          <span>{td.owner}</span>
          <input list={`launch-owners-${item.id}`} value={item.owner} onChange={(e) => change((i) => ({ ...i, owner: e.target.value }))} />
          <datalist id={`launch-owners-${item.id}`}>
            {owners.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
        {item.customer ? (
          <div className="field">
            <span>{td.progress}</span>
            <small className="muted">{t.launch.customerProgress}</small>
          </div>
        ) : (
          <div className="field">
            <span>{td.progress}</span>
            <span className="gantt-progress-edit">
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                aria-label={td.progress}
                value={item.progress}
                onChange={(e) =>
                  change((i) => ({
                    ...i,
                    progress: clampProgress(Number(e.target.value)),
                  }))
                }
              />
              <span className="segmented" role="group" aria-label={`${td.progress}: ${item.name}`}>
                {PROGRESS_QUICK.map((p) => (
                  <button key={p} type="button" aria-pressed={item.progress === p} onClick={() => change((i) => ({ ...i, progress: p }))}>
                    {p}
                  </button>
                ))}
              </span>
            </span>
          </div>
        )}
        <label className="field gantt-field-wide">
          <span>{td.note}</span>
          <textarea rows={2} value={item.note} onChange={(e) => change((i) => ({ ...i, note: e.target.value }))} />
        </label>
      </div>
      {shift !== 0 && item.baseline !== null && (
        <p className="gantt-shift-note">
          {td.shift.replace('{days}', `${shift > 0 ? '+' : ''}${formatQuantity(shift, locale)}`).replace('{date}', dayText(item.baseline, locale))}{' '}
          <button type="button" className="button button-small" onClick={() => change((i) => ({ ...i, baseline: null }))}>
            {td.acceptShift}
          </button>
        </p>
      )}
      <div className="actions-row">
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

function ProjectDetail({
  project,
  count,
  rename,
  describe,
  add,
  remove,
  close,
}: {
  project: LaunchProject;
  count: number;
  /** Přejmenuje projekt; false = název je prázdný nebo už použitý. */
  rename: (name: string) => boolean;
  describe: (description: string) => void;
  add: (kind: LaunchKind, customer: boolean) => void;
  remove: () => void;
  close: () => void;
}) {
  const { t } = useI18n();
  const tp = t.launch.projectDetail;
  const [name, setName] = useState(project.name);
  const [taken, setTaken] = useState(false);
  const commit = () => setTaken(!rename(name));
  return (
    <div className="gantt-detail" role="group" aria-label={`${tp.label}: ${project.name}`} onClick={(e) => e.stopPropagation()}>
      <div className="gantt-detail-grid">
        <label className="field">
          <span>{tp.name}</span>
          <input
            autoFocus={count === 0}
            aria-label={tp.name}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTaken(false);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
          {taken && <small className="cell-short">{tp.nameTaken}</small>}
        </label>
        <label className="field gantt-field-wide">
          <span>{tp.description}</span>
          <input value={project.description} placeholder={tp.descriptionHint} onChange={(e) => describe(e.target.value)} />
        </label>
      </div>
      <div className="actions-row">
        <button type="button" className="button button-small button-primary" onClick={() => add('task', false)}>
          + {tp.addTask}
        </button>
        <button type="button" className="button button-small button-primary" onClick={() => add('milestone', false)}>
          + {tp.addMilestone}
        </button>
        <button type="button" className="button button-small" onClick={() => add('milestone', true)}>
          + {tp.addCustomer}
        </button>
        <button type="button" className="button button-small" onClick={close}>
          {tp.close}
        </button>
        <button type="button" className="button button-small button-danger" onClick={remove}>
          {tp.delete}
        </button>
      </div>
    </div>
  );
}
