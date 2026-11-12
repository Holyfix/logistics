import { useState } from 'react';
import { dayToIso, type DayNumber } from '../../core/dates';
import { formatDayShort } from '../../core/format';
import { currentIndex, statusOf, type PackItem } from '../../core/packaging';
import type { TimelineScale } from '../../core/timeline';
import { useI18n } from '../../i18n/I18nProvider';
import { useTimeline } from '../timeline/useTimeline';

type Kind = 'done' | 'current' | 'late' | 'next';

/** Krok na ose: splněno, aktuální krok, po termínu (aktuální i další krok), další krok. */
function kindOf(item: PackItem, index: number, today: DayNumber): Kind {
  const step = item.steps[index]!;
  if (step.done !== null) return 'done';
  if (step.due !== null && step.due < today) return 'late';
  return index === currentIndex(item) ? 'current' : 'next';
}

/** Den kroku na ose: splněný krok v den splnění, ostatní v termínu. */
const dayOf = (item: PackItem, index: number) => item.steps[index]!.done ?? item.steps[index]!.due;

/**
 * Časová osa (Gantt) bodů obalů na společné ose s Launch (měřítko, čára Dnes, posun na dnešek): řádek bodu s pruhem
 * od prvního do posledního kroku, kroky jako kosočtverce; rozbalený bod má kroky na vlastních řádcích.
 */
export function PackagingTimeline({ items, today, scale, onOpen }: { items: PackItem[]; today: DayNumber; scale: TimelineScale; onOpen: (id: number) => void }) {
  const { t, locale } = useI18n();
  const tp = t.packaging;
  const tl = tp.timeline;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const days = items.flatMap((i) => i.steps.map((_, k) => dayOf(i, k)).filter((d): d is DayNumber => d !== null));
  const { x, mid, scroller, track, head } = useTimeline({ days, today, scale, locale, todayLabel: tl.today, axisLabel: tl.label });
  const short = (d: DayNumber) => formatDayShort(dayToIso(d), locale);
  const allOpen = items.length > 0 && items.every((i) => expanded.has(i.id));
  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const diamond = (item: PackItem, k: number) => {
    const s = item.steps[k]!;
    const d = dayOf(item, k);
    if (d === null) return null;
    const title = `${k + 1}. ${s.text || '—'}${s.owner ? ` · ${s.owner}` : ''} · ${s.done !== null ? `${tl.doneOn} ${short(s.done)}` : short(d)}`;
    return (
      <button
        key={k}
        type="button"
        className={`pg-dia pg-${kindOf(item, k, today)}`}
        style={{ left: `${mid(d)}px` }}
        title={title}
        aria-label={title}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(item.id);
        }}
      />
    );
  };
  const dueText = (due: DayNumber | null, late: boolean) => (due === null ? <span className="muted">{tp.noDue}</span> : <span className={late ? 'cell-short' : undefined}>{short(due)}</span>);

  return (
    <>
      <div className="actions-row">
        <button type="button" className="button button-small" onClick={() => setExpanded(allOpen ? new Set() : new Set(items.map((i) => i.id)))}>
          {allOpen ? tl.collapseAll : tl.expandAll}
        </button>
        <small className="muted">{tl.hint}</small>
      </div>
      <div className="table-scroll gantt-scroll" ref={scroller}>
        <table className="table gantt pack-gantt" aria-label={tl.label}>
          <thead>
            <tr>
              <th className="gantt-name" rowSpan={2}>
                {tl.item}
              </th>
              <th className="gantt-owner" rowSpan={2}>
                {tp.table.owner}
              </th>
              <th className="gantt-progress n" rowSpan={2}>
                {tp.table.steps}
              </th>
              <th className="gantt-due" rowSpan={2}>
                {tp.table.due}
              </th>
              {head.top}
            </tr>
            <tr>{head.bottom}</tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const open = expanded.has(item.id);
              const status = statusOf(item, today);
              const current = item.steps[currentIndex(item)];
              const dated = item.steps.map((_, k) => dayOf(item, k)).filter((d): d is DayNumber => d !== null);
              const doneDays = item.steps.filter((s) => s.done !== null).map((s) => s.done!);
              const from = dated.length ? Math.min(...dated) : null;
              const to = dated.length ? Math.max(...dated) : null;
              const doneTo = doneDays.length ? Math.max(...doneDays) : null;
              const done = item.steps.filter((s) => s.done !== null).length;
              return [
                <tr key={item.id} className={`gantt-row-project pack-row pack-${status}`} onClick={() => toggle(item.id)}>
                  <td className="gantt-name">
                    <button
                      type="button"
                      className="gantt-chevron"
                      aria-expanded={open}
                      aria-label={`${open ? tl.collapse : tl.expand}: ${item.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(item.id);
                      }}
                    >
                      {open ? '▾' : '▸'}
                    </button>
                    <strong title={item.title}>{item.title || tp.noTitle}</strong>
                    <button
                      type="button"
                      className="gantt-edit"
                      aria-label={`${tl.open}: ${item.title}`}
                      title={tl.open}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(item.id);
                      }}
                    >
                      ✎
                    </button>
                    {item.project && <small className="muted gantt-desc">{item.project}</small>}
                  </td>
                  <td className="gantt-owner">{current?.owner ?? ''}</td>
                  <td className="gantt-progress n">
                    <strong>
                      {done}/{item.steps.length}
                    </strong>
                  </td>
                  <td className="gantt-due">{current ? dueText(current.due, status === 'overdue') : <span className="muted">{tp.status[status]}</span>}</td>
                  {track(
                    <>
                      {from !== null && to !== null && to > from && (
                        <span className="pg-span" style={{ left: `${x(from)}px`, width: `${x(to + 1) - x(from)}px` }} aria-hidden="true">
                          {doneTo !== null && doneTo > from && <span className="pg-fill" style={{ width: `${((Math.min(doneTo, to) - from) / (to - from)) * 100}%` }} />}
                        </span>
                      )}
                      {!open && item.steps.map((_, k) => diamond(item, k))}
                    </>,
                  )}
                </tr>,
                ...(open
                  ? item.steps.map((s, k) => {
                      const kind = kindOf(item, k, today);
                      return (
                        <tr key={`${item.id}-${k}`} className={`gantt-row-item pg-step-${kind}`} onClick={() => onOpen(item.id)}>
                          <td className="gantt-name gantt-depth-1" title={s.text}>
                            {s.done !== null ? '✓ ' : `${k + 1}. `}
                            {s.text || '—'}
                          </td>
                          <td className="gantt-owner">{s.owner}</td>
                          <td className="gantt-progress n" />
                          <td className="gantt-due">{s.done !== null ? <span className="muted">{`${tl.doneOn} ${short(s.done)}`}</span> : dueText(s.due, kind === 'late')}</td>
                          {track(diamond(item, k))}
                        </tr>
                      );
                    })
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      <ul className="cov-legend">
        {(['done', 'current', 'late', 'next'] as const).map((k) => (
          <li key={k}>
            <span className={`pg-dia pg-dia-inline pg-${k}`} aria-hidden="true" /> {tl.kinds[k]}
          </li>
        ))}
        <li>
          <span className="pg-span pg-span-key" aria-hidden="true">
            <span className="pg-fill" />
          </span>{' '}
          {tl.spanKey}
        </li>
      </ul>
    </>
  );
}
