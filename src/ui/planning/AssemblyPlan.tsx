import { useMemo, useState, type ReactNode } from 'react';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { evaluateItem, PLAN_DAYS, plannedByDay, proposePlan, slotCapacity, slotSides } from '../../core/planning/assembly';
import { cellKey, shiftSlots, type LinePlan, type ShiftSlot } from '../../core/planning/plan';
import { formatTime } from '../../core/planning/settings';
import { useI18n } from '../../i18n/I18nProvider';
import { usePlanningDrafts } from './PlanningProvider';
import { usePlanSaving } from './save';
import { SaveStatus, useSaveFlow } from './SaveStatus';
import type { PlanningData } from './usePlanning';

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** Číslo z políčka: prázdné = 0, jinak nezáporné číslo (desetinná čárka i tečka); neplatné = null. */
function parseQty(value: string): number | null {
  const text = value.replace(/\s/g, '').replace(',', '.');
  if (text === '') return 0;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Plán montáže jako zákaznická coverage: u každého dílu řádek Plán (kusy po směnách v plánovacích dnech) a řádek
 * Coverage (stav u zákazníka + náš sklad + naplánovaná výroba), který se s každým číslem přepočítá.
 */
export function AssemblyPlan({ data, today, now }: { data: PlanningData; today: DayNumber; now: number }) {
  const { t, locale } = useI18n();
  const tp = t.planning;
  const drafts = usePlanningDrafts();
  const { savePlan } = usePlanSaving();
  const flow = useSaveFlow();
  const [proposal, setProposal] = useState<{ project: string; remaining: number } | null>(null);

  const project = data.projects.find((p) => p.project === drafts.project) ?? data.projects[0];
  const plan = project?.plan;
  const days = data.days;

  const statuses = useMemo(() => {
    if (!project || !plan) return new Map<string, ReturnType<typeof evaluateItem>>();
    return new Map(project.items.map((it) => [it.item, evaluateItem(it, plannedByDay(plan.cells, it.item, days))]));
  }, [project, plan, days]);

  if (!project || !plan) {
    return (
      <div className="panel">
        <p>{tp.assembly.noItems}</p>
        <p className="muted">{data.byLineColumn ? tp.assembly.byLine : tp.assembly.noLineColumn}</p>
      </div>
    );
  }

  const { capacity } = project;
  // Plánovací dny: zvolený počet, ale nejméně do posledního dne, kde už je něco naplánované.
  const plannedDays = new Set(Object.entries(plan.cells).flatMap(([key, q]) => (q > 0 ? [parseDay(key.slice(0, key.indexOf(' ')))] : [])));
  const lastPlanned = days.reduce((last, d, k) => (plannedDays.has(d) ? k : last), -1);
  const minDays = Math.max(1, lastPlanned + 1);
  const planDays = Math.min(days.length, Math.max(minDays, drafts.planDays[project.key] ?? PLAN_DAYS));
  const slots = shiftSlots(today, planDays, data.settings.firstShiftStart);
  // Nejdřív díly, kterým zákazníkovi díly bez plánu dojdou nejdřív.
  const items = [...project.items].sort(
    (a, b) =>
      (statuses.get(a.item)!.shortDayWithoutPlan ?? Infinity) - (statuses.get(b.item)!.shortDayWithoutPlan ?? Infinity) ||
      a.side.localeCompare(b.side) ||
      a.item.localeCompare(b.item, 'en', { numeric: true }),
  );

  const qty = (slot: ShiftSlot, item: string) => plan.cells[cellKey(slot.key, item)] ?? 0;
  const capOf = (slot: ShiftSlot) => slotCapacity(slot, capacity, plan.capacity);
  const nominal = (slot: ShiftSlot) => slotCapacity(slot, capacity, {});
  const planned = (slot: ShiftSlot) => sum(items.map((it) => qty(slot, it.item)));
  const sides = slotSides(items, slots, (s, it) => qty(s, it.item));
  const past = (slot: ShiftSlot) => slot.end <= now;
  const update = (next: LinePlan) => drafts.setPlan(next, project.key);

  const setCell = (slot: ShiftSlot, item: string, value: string) => {
    const q = parseQty(value);
    if (q === null) return;
    const cells = { ...plan.cells };
    if (q > 0) cells[cellKey(slot.key, item)] = q;
    else delete cells[cellKey(slot.key, item)];
    update({ ...plan, cells });
  };
  const setCapacity = (slot: ShiftSlot, value: string) => {
    const q = value.trim() === '' ? nominal(slot) : parseQty(value);
    if (q === null) return;
    const overrides = { ...plan.capacity };
    if (q === nominal(slot)) delete overrides[slot.key];
    else overrides[slot.key] = q;
    update({ ...plan, capacity: overrides });
  };

  const open = slots.filter((s) => s.start >= now);
  const openKeys = new Set(open.map((s) => s.key));
  const slotOf = (key: string) => key.slice(0, key.indexOf('|'));
  const openHasPlan = Object.entries(plan.cells).some(([key, q]) => q > 0 && openKeys.has(slotOf(key)));
  const firstOpen = open[0];
  const propose = () => {
    if (openHasPlan && firstOpen && !window.confirm(`${tp.assembly.confirmPropose} ${slotLabel(firstOpen)}?`)) return;
    const result = proposePlan(items, slots, capOf, plan.cells, now);
    // Směny mimo plánovací dny (např. starší dny v souboru) zůstanou, jak jsou.
    const slotKeys = new Set(slots.map((s) => s.key));
    const kept = Object.fromEntries(Object.entries(plan.cells).filter(([key]) => !slotKeys.has(slotOf(key))));
    update({ ...plan, cells: { ...kept, ...result.cells } });
    setProposal({ project: project.project, remaining: result.remaining });
  };
  const clear = () => {
    if (!firstOpen || !window.confirm(`${tp.assembly.confirmClear} ${slotLabel(firstOpen)}?`)) return;
    update({ ...plan, cells: Object.fromEntries(Object.entries(plan.cells).filter(([key]) => !openKeys.has(slotOf(key)))) });
    setProposal(null);
  };

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  function slotLabel(slot: ShiftSlot) {
    return `${dayLabel(slot.day)} ${slot.code}`;
  }
  const weekend = (d: DayNumber) => (weekday(d) >= 6 ? ' col-weekend' : '');
  const untilText = (short: number | null) => {
    if (short === null) return `${dayLabel(days.at(-1)!)} ${tp.assembly.orLater}`;
    return short === 0 ? tp.assembly.notCovered : dayLabel(days[short - 1]!);
  };
  const statusList = [...statuses.values()];
  const uncovered = statusList.filter((s) => s.shortDay !== null).length;
  const worst = (pick: (s: (typeof statusList)[number]) => number | null) =>
    statusList.reduce<number | null>((w, s) => (pick(s) === null ? w : w === null ? pick(s) : Math.min(w, pick(s)!)), null);
  const loadCap = sum(slots.map(capOf));
  const loadPlanned = sum(slots.map(planned));
  const shiftTitle = (slot: ShiftSlot) => `${slotLabel(slot)} · ${formatTime(slot.start)}–${formatTime(slot.end)}`;
  const isPlanDay = (k: number) => k < planDays;
  const dayStart = (k: number) => (k === 0 ? '' : ' plan-day-start');

  /** Buňky jednoho řádku po dnech: v plánovacím dni tři směny (`perSlot`) nebo jedna sloučená buňka (`perDay`). */
  const dayCells = (perSlot: ((slot: ShiftSlot) => ReactNode) | null, perDay: (day: DayNumber, k: number) => ReactNode) =>
    days.map((d, k) =>
      isPlanDay(k) && perSlot ? slots.filter((s) => s.day === d).map((s) => perSlot(s)) : perDay(d, k),
    );

  return (
    <>
      <div className="filters" role="group" aria-label={tp.assembly.label}>
        {data.projects.length > 1 && (
          <div className="segmented" role="group" aria-label={tp.assembly.project}>
            {data.projects.map((p) => (
              <button key={p.key} type="button" aria-pressed={p.key === project.key} onClick={() => drafts.setProject(p.project)}>
                {p.project || tp.noProject}
                {p.dirty && ' •'}
              </button>
            ))}
          </div>
        )}
        <span className="inline-field" role="group" aria-label={tp.assembly.planDays}>
          <span>{tp.assembly.planDays}</span>
          <button type="button" className="button button-small" aria-label={tp.assembly.lessDays} disabled={planDays <= minDays} onClick={() => drafts.setPlanDays(project.key, planDays - 1)}>
            −
          </button>
          <strong>{planDays}</strong>
          <button type="button" className="button button-small" aria-label={tp.assembly.moreDays} disabled={planDays >= days.length} onClick={() => drafts.setPlanDays(project.key, planDays + 1)}>
            +
          </button>
        </span>
        <span className="filters-break" role="presentation" />
        <button type="button" className="button button-primary" onClick={propose} disabled={!firstOpen}>
          {tp.assembly.propose}
        </button>
        <button type="button" className="button" onClick={clear} disabled={!openHasPlan}>
          {tp.assembly.clear}
        </button>
        <button type="button" className="button" disabled={flow.busy} onClick={() => void flow.run((force) => savePlan(project, force))}>
          {tp.save}
        </button>
        <SaveStatus dirty={project.dirty} saved={project.saved} message={flow.message} />
      </div>

      {capacity.perShift <= 0 && Object.keys(plan.capacity).length === 0 && (
        <div className="banner" role="status">
          <span>{tp.assembly.noCapacity}</span>
          <button type="button" className="link-button" onClick={() => drafts.setTab('capacity')}>
            {tp.tabs.capacity}
          </button>
        </div>
      )}
      {proposal?.project === project.project && (
        <p className="muted" role="status">
          {proposal.remaining > 0 ? `${tp.assembly.remaining} ${formatQuantity(proposal.remaining, locale)} ${tp.pcs}.` : tp.assembly.proposed}
        </p>
      )}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.uncovered}</span>
          <span className="kpi-value">{formatQuantity(uncovered, locale)}</span>
          <span className="kpi-note">
            {tp.kpi.uncoveredNote} {formatQuantity(items.length, locale)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.coveredUntil}</span>
          <span className="kpi-value">{untilText(worst((s) => s.shortDay))}</span>
          <span className="kpi-note">
            {tp.kpi.withoutPlan} {untilText(worst((s) => s.shortDayWithoutPlan))}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.load}</span>
          <span className="kpi-value">{loadCap > 0 ? `${Math.round((loadPlanned / loadCap) * 100)} %` : '—'}</span>
          <span className="kpi-note">
            {formatQuantity(loadPlanned, locale)} / {formatQuantity(loadCap, locale)} {tp.pcs} · {tp.kpi.loadNote}
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>
            {tp.assembly.heading} {project.project}
          </h2>
          <span className="muted">
            {tp.assembly.capacity}: {formatQuantity(capacity.perShift, locale)} {tp.pcs} · {capacity.shifts.join(' ') || '—'}
          </span>
        </div>
        <div className="table-scroll table-tall">
          <table className="table table-data plan-grid">
            <thead>
              <tr>
                <th className="sticky-col">{tp.assembly.item}</th>
                <th>{tp.assembly.side}</th>
                <th className="n">{tp.assembly.stock}</th>
                <th>{tp.assembly.until}</th>
                {dayCells(
                  (slot) => (
                    <th key={slot.key} className={`n plan-shift${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}`} title={shiftTitle(slot)}>
                      <small className="plan-day">{slot.code === 'R' ? dayLabel(slot.day) : ' '}</small>
                      {slot.code}
                    </th>
                  ),
                  (d, k) => (
                    <th key={d} className={`n${dayStart(k)}${weekend(d)}`}>
                      {dayLabel(d)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.capacityRow}</strong>
                </td>
                <td colSpan={3} className="muted">
                  {tp.assembly.capacityHint}
                </td>
                {dayCells(
                  (slot) => (
                    <td key={slot.key} className={`n${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}${plan.capacity[slot.key] !== undefined ? ' cell-manual' : ''}`}>
                      <input
                        className="plan-input"
                        inputMode="numeric"
                        aria-label={`${tp.assembly.capacityRow} ${slotLabel(slot)}`}
                        value={capOf(slot) || ''}
                        placeholder="0"
                        disabled={past(slot)}
                        onChange={(e) => setCapacity(slot, e.target.value)}
                      />
                    </td>
                  ),
                  (d, k) => <td key={d} className={`${dayStart(k)}${weekend(d)}`} />,
                )}
              </tr>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.plannedRow}</strong>
                </td>
                <td colSpan={3} className="muted">
                  {tp.assembly.sidesHint}
                </td>
                {dayCells(
                  (slot) => {
                    const p = planned(slot);
                    const order = sides[slots.indexOf(slot)]!;
                    return (
                      <td key={slot.key} className={`n${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}${p > capOf(slot) ? ' cell-negative' : ''}`}>
                        {p > 0 ? formatQuantity(p, locale) : <span className="muted">0</span>}
                        {order.length > 0 && <small className="cell-note muted">{order.map((s) => s || '?').join(' → ')}</small>}
                      </td>
                    );
                  },
                  (d, k) => <td key={d} className={`${dayStart(k)}${weekend(d)}`} />,
                )}
              </tr>
              {items.map((it) => {
                const status = statuses.get(it.item)!;
                return [
                  <tr key={`${it.item}-plan`} className="plan-row">
                    <td className="sticky-col" rowSpan={2}>
                      <strong>{it.item}</strong>
                      {it.customerNumber && <small className="muted cell-note">{it.customerNumber}</small>}
                    </td>
                    <td rowSpan={2}>{it.side || '—'}</td>
                    <td className="n" rowSpan={2}>
                      {formatQuantity(it.stock, locale)}
                    </td>
                    <td className="cell-until" rowSpan={2}>
                      <strong className={status.shortDay === null ? undefined : 'cell-short'}>{untilText(status.shortDay)}</strong>
                      <small className="muted cell-note">
                        {tp.assembly.withoutPlan} {untilText(status.shortDayWithoutPlan)}
                      </small>
                    </td>
                    {dayCells(
                      (slot) => (
                        <td key={slot.key} className={`n plan-cell${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}${past(slot) ? ' cell-past' : ''}`}>
                          <input
                            className="plan-input"
                            inputMode="numeric"
                            aria-label={`${it.item} ${slotLabel(slot)}`}
                            value={qty(slot, it.item) || ''}
                            disabled={past(slot)}
                            onChange={(e) => setCell(slot, it.item, e.target.value)}
                          />
                        </td>
                      ),
                      (d, k) => <td key={d} className={`plan-cell${dayStart(k)}${weekend(d)}`} />,
                    )}
                  </tr>,
                  <tr key={`${it.item}-coverage`} className="plan-coverage">
                    {days.map((d, k) => {
                      const v = status.coverage[k]!;
                      return (
                        <td
                          key={d}
                          colSpan={isPlanDay(k) ? 3 : 1}
                          className={`n${dayStart(k)}${weekend(d)}${v < -1e-9 ? ' cell-negative' : ''}`}
                          title={`${dayLabel(d)} · ${tp.assembly.withoutPlan} ${formatQuantity(status.withoutPlan[k]!, locale)}`}
                        >
                          {formatQuantity(v, locale)}
                        </td>
                      );
                    })}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        <ul className="cov-legend">
          <li>
            <i className="swatch swatch-negative" /> {tp.legend.negative}
          </li>
          <li>
            <i className="swatch swatch-manual" /> {tp.legend.manual}
          </li>
          <li>
            <i className="swatch swatch-past" /> {tp.legend.past}
          </li>
          <li>
            <i className="swatch swatch-weekend" /> {tp.legend.weekend}
          </li>
        </ul>
        <dl className="explain">
          <dt>{tp.explain.coverage}</dt>
          <dd>{tp.explain.coverageText}</dd>
          <dt>{tp.assembly.until}</dt>
          <dd>{tp.explain.until}</dd>
          <dt>{tp.assembly.planDays}</dt>
          <dd>{tp.explain.planDays}</dd>
          <dt>{tp.assembly.propose}</dt>
          <dd>{tp.explain.propose}</dd>
        </dl>
      </div>
    </>
  );
}
