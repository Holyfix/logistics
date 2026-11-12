// Společný základ časové osy (Gantt) pro Launch a Obaly: měřítko Týdny / Měsíce / Čtvrtletí, popisky osy, čáry
// měsíců, čára Dnes a posun osy na dnešek. Každý modul si do stopy kreslí vlastní pruhy a značky.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { dayToIso, isoWeek, mondayOf, type DayNumber } from '../../core/dates';
import { DAY_WIDTH, nextMonth, rangeOfDays, TIMELINE_SCALES, type TimelineScale } from '../../core/timeline';

interface Segment {
  start: DayNumber;
  end: DayNumber;
  label: string;
  title?: string;
}

/** Popisky osy: horní řádek měsíce (u čtvrtletí čtvrtletí), dolní kalendářní týdny (u čtvrtletí měsíce). */
function scaleSegments(from: DayNumber, to: DayNumber, scale: TimelineScale, locale: string): { top: Segment[]; bottom: Segment[]; months: DayNumber[] } {
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

/** Měřítko uložené v prohlížeči (každý modul pod svým klíčem). */
export function readScale(key: string, fallback: TimelineScale): TimelineScale {
  try {
    const value = localStorage.getItem(key);
    return (TIMELINE_SCALES as readonly string[]).includes(value ?? '') ? (value as TimelineScale) : fallback;
  } catch {
    return fallback;
  }
}

export function saveScale(key: string, scale: TimelineScale) {
  try {
    localStorage.setItem(key, scale);
  } catch {
    // Bez úložiště se měřítko jen nezapamatuje.
  }
}

/** Přepínač měřítka Týdny / Měsíce / Čtvrtletí. */
export function ScaleSwitch({ scale, onChange, label, labels }: { scale: TimelineScale; onChange: (scale: TimelineScale) => void; label: string; labels: Record<TimelineScale, string> }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {TIMELINE_SCALES.map((s) => (
        <button key={s} type="button" aria-pressed={scale === s} onClick={() => onChange(s)}>
          {labels[s]}
        </button>
      ))}
    </div>
  );
}

/**
 * Osa pro dny `days` (rozsah po celých měsících včetně dneška): x(d) = levý okraj dne v pixelech, mid(d) = jeho střed.
 * `head` vrátí dvě buňky záhlaví (horní a dolní řádek osy), `track` buňku stopy s mřížkou týdnů, čarami měsíců a Dnes.
 */
export function useTimeline({ days, today, scale, locale, todayLabel, axisLabel }: { days: readonly DayNumber[]; today: DayNumber; scale: TimelineScale; locale: string; todayLabel: string; axisLabel: string }) {
  const { from, to } = rangeOfDays(days, today);
  const px = DAY_WIDTH[scale];
  const width = Math.round((to - from) * px);
  const x = (d: DayNumber) => Math.round((Math.min(to, Math.max(from, d)) - from) * px);
  const mid = (d: DayNumber) => x(d) + px / 2;
  const { top, bottom, months } = scaleSegments(from, to, scale, locale);
  // Po otevření a změně měřítka se osa posune tak, aby dnešek byl vidět (s dvěma týdny před ním).
  const scroller = useRef<HTMLDivElement>(null);
  const todayX = x(Math.max(from, today - 14));
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = todayX;
  }, [scale, todayX]);

  const size = { width: `${width}px`, minWidth: `${width}px` };
  const trackStyle = { ...size, '--gantt-week': `${7 * px}px`, '--gantt-offset': `${x(mondayOf(from))}px` } as CSSProperties;
  const showToday = today >= from && today < to;
  const todayLine = showToday ? <span className="gantt-today" style={{ left: `${mid(today)}px` }} aria-hidden="true" /> : null;
  const monthLines = months.slice(1).map((m) => <span key={m} className="gantt-month-line" style={{ left: `${x(m)}px` }} aria-hidden="true" />);

  const track = (content: ReactNode) => (
    <td className={`gantt-track${scale === 'quarter' ? '' : ' gantt-weeks'}`} style={trackStyle}>
      {monthLines}
      {todayLine}
      {content}
    </td>
  );
  const segments = (list: Segment[], top: boolean) =>
    list.map((s) => (
      <span key={s.start} className={`gantt-seg${top ? ' gantt-seg-top' : ''}`} style={{ left: `${x(s.start)}px`, width: `${x(s.end) - x(s.start)}px` }} title={s.title}>
        {top || x(s.end) - x(s.start) >= 16 ? s.label : ''}
      </span>
    ));
  const head = {
    top: (
      <th className="gantt-scale" style={size} aria-label={axisLabel}>
        {segments(top, true)}
      </th>
    ),
    bottom: (
      <th className="gantt-scale gantt-scale-bottom" style={size}>
        {segments(bottom, false)}
        {showToday && (
          <span className="gantt-today-tag" style={{ left: `${mid(today)}px` }}>
            {todayLabel}
          </span>
        )}
      </th>
    ),
  };

  return { from, to, px, x, mid, scroller, track, head };
}
