import { useState, type ReactNode } from 'react';
import { dayToIso, isoWeek, mondayOf, type DayNumber } from '../../core/dates';
import { formatDayShort } from '../../core/format';
import { currentIndex, statusOf, type PackItem } from '../../core/packaging';
import { useI18n } from '../../i18n/I18nProvider';

type Kind = 'done' | 'current' | 'late' | 'next';

/** Krok na ose: splněno, aktuální krok, po termínu (aktuální i další krok), další krok. */
function kindOf(item: PackItem, index: number, today: DayNumber): Kind {
  const step = item.steps[index]!;
  if (step.done !== null) return 'done';
  const late = step.due !== null && step.due < today;
  if (late) return 'late';
  return index === currentIndex(item) ? 'current' : 'next';
}

/** Den kroku na ose: splněný krok v den splnění, ostatní v termínu. */
const dayOf = (item: PackItem, index: number) => item.steps[index]!.done ?? item.steps[index]!.due;

/** Nejvýš 60 týdnů na ose (víc se nevejde); termíny mimo osu se kreslí na jejím okraji. */
const MAX_WEEKS = 60;

/** Časová osa (Gantt) bodů obalů: řádek bodu s pruhem od prvního do posledního kroku a kroky jako kosočtverce. */
export function PackagingTimeline({ items, today, onOpen }: { items: PackItem[]; today: DayNumber; onOpen: (id: number) => void }) {
  const { t, locale } = useI18n();
  const tl = t.packaging.timeline;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const days = items.flatMap((i) => i.steps.map((_, k) => dayOf(i, k)).filter((d): d is DayNumber => d !== null));
  const start = mondayOf(Math.max(today - 8 * 7, Math.min(today - 7, ...days)));
  const end = Math.max(today + 8 * 7, ...days);
  const weeks = Math.min(MAX_WEEKS, Math.ceil((end - start + 1) / 7));
  const span = weeks * 7;
  const pos = (d: DayNumber) => `${(Math.min(span - 0.5, Math.max(0.5, d - start + 0.5)) / span) * 100}%`;
  const grid = { backgroundSize: `${100 / weeks}% 100%` };
  const label = (d: DayNumber) => formatDayShort(dayToIso(d), locale);
  const allOpen = items.length > 0 && items.every((i) => expanded.has(i.id));
  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const track = (children: ReactNode) => (
    <div className="pg-track" style={grid}>
      <span className="pg-today" style={{ left: pos(today) }} aria-hidden="true" />
      {children}
    </div>
  );
  const diamond = (item: PackItem, k: number) => {
    const s = item.steps[k]!;
    const d = dayOf(item, k);
    if (d === null) return null;
    const kind = kindOf(item, k, today);
    const title = `${k + 1}. ${s.text || '—'}${s.owner ? ` · ${s.owner}` : ''} · ${s.done !== null ? `${tl.doneOn} ${label(s.done)}` : label(d)}`;
    return <button key={k} type="button" className={`pg-dia pg-${kind}`} style={{ left: pos(d) }} title={title} aria-label={title} onClick={() => onOpen(item.id)} />;
  };

  return (
    <>
      <div className="actions-row">
        <button type="button" className="button button-small" onClick={() => setExpanded(allOpen ? new Set() : new Set(items.map((i) => i.id)))}>
          {allOpen ? tl.collapseAll : tl.expandAll}
        </button>
        <small className="muted">{tl.hint}</small>
      </div>
      <div className="table-scroll">
        <div className="pack-gantt" style={{ minWidth: 420 + weeks * 44 }} role="table" aria-label={tl.label}>
          <div className="pg-label pg-head" role="columnheader">
            {tl.item}
          </div>
          <div className="pg-axis pg-head" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} role="columnheader">
            {Array.from({ length: weeks }, (_, w) => {
              const monday = start + w * 7;
              return (
                <span key={w} className={monday === mondayOf(today) ? 'pg-now' : undefined}>
                  CW {isoWeek(monday).week}
                  <small>{label(monday)}</small>
                </span>
              );
            })}
            <span className="pg-today-label" style={{ left: pos(today) }}>
              {tl.today}
            </span>
          </div>
          <div className="pg-nodate pg-head" role="columnheader">
            {tl.noDate}
          </div>

          {items.map((item) => {
            const open = expanded.has(item.id);
            const status = statusOf(item, today);
            const dated = item.steps.map((_, k) => dayOf(item, k)).filter((d): d is DayNumber => d !== null);
            const doneDays = item.steps.filter((s) => s.done !== null).map((s) => s.done!);
            const undated = item.steps.filter((s) => s.done === null && s.due === null).length;
            const from = dated.length ? Math.min(...dated) : null;
            const to = dated.length ? Math.max(...dated) : null;
            const doneTo = doneDays.length ? Math.max(...doneDays) : null;
            const done = item.steps.filter((s) => s.done !== null).length;
            return [
              <div key={`${item.id}-l`} className={`pg-label pg-item pack-${status}`} role="rowheader">
                <button type="button" className="pg-caret" aria-expanded={open} aria-label={`${open ? tl.collapse : tl.expand}: ${item.title}`} onClick={() => toggle(item.id)}>
                  {open ? '▾' : '▸'}
                </button>
                <button type="button" className="pg-name" title={tl.open} onClick={() => onOpen(item.id)}>
                  {item.title || t.packaging.noTitle}
                </button>
                {item.project && <small className="muted">{item.project}</small>}
                <small className="pg-count">
                  {done}/{item.steps.length}
                </small>
              </div>,
              <div key={`${item.id}-t`} className="pg-item-track" role="cell">
                {track(
                  <>
                    {from !== null && to !== null && to > from && (
                      <span className="pg-span" style={{ left: pos(from), width: `calc(${pos(to)} - ${pos(from)})` }}>
                        {doneTo !== null && doneTo > from && <span className="pg-fill" style={{ width: `${((Math.min(doneTo, to) - from) / (to - from)) * 100}%` }} />}
                      </span>
                    )}
                    {!open && item.steps.map((_, k) => diamond(item, k))}
                  </>,
                )}
              </div>,
              <div key={`${item.id}-n`} className="pg-nodate pg-item-track" role="cell" title={undated ? tl.undated.replace('{n}', String(undated)) : undefined}>
                {!open && undated > 0 && `${undated}× ?`}
              </div>,
              ...(open
                ? item.steps.flatMap((s, k) => {
                    const kind = kindOf(item, k, today);
                    return [
                      <div key={`${item.id}-${k}-l`} className={`pg-label pg-step pg-step-${kind}`} role="rowheader">
                        <span>
                          {s.done !== null ? '✓ ' : `${k + 1}. `}
                          {s.text || '—'}
                        </span>
                        {s.owner && <small className="muted">{s.owner}</small>}
                      </div>,
                      <div key={`${item.id}-${k}-t`} role="cell">
                        {track(diamond(item, k))}
                      </div>,
                      <div key={`${item.id}-${k}-n`} className="pg-nodate" role="cell">
                        {dayOf(item, k) === null && <span className={`pg-dia pg-dia-inline pg-${kind}`} title={tl.undated.replace('{n}', '1')} />}
                      </div>,
                    ];
                  })
                : []),
            ];
          })}
        </div>
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
