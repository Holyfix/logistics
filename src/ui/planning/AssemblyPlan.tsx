import { useMemo, type KeyboardEvent } from 'react';
import { dayToIso, parseDay, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { evaluateItem, packOf, PLAN_DAYS, plannedTotal, slotCapacity, slotSides } from '../../core/planning/assembly';
import { AUTO_MODES, cellKey, shiftSlots, type AutoMode, type LinePlan, type ShiftSlot } from '../../core/planning/plan';
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

/** Enter potvrdí číslo a přejde na políčko pod ním ve stejné směně (Shift+Enter nad ním), jako v Excelu. */
function enterToNext(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const input = e.currentTarget;
  const column = [...(input.closest('table')?.querySelectorAll<HTMLInputElement>('input[data-col]') ?? [])].filter((el) => el.dataset.col === input.dataset.col);
  const next = column[column.indexOf(input) + (e.shiftKey ? -1 : 1)];
  if (next) {
    next.focus();
    next.select();
  } else input.blur();
}

/**
 * Plán montáže jako zákaznická coverage: u každého dílu vlevo kusy po směnách plánovacích dnů, vpravo coverage po dnech
 * (stav u zákazníka + náš sklad + vše naplánované), která se s každým číslem přepočítá. Směna s automatickým plánem
 * (zvolená strana) se dopočítá sama podle prvních nepokrytých dnů.
 */
export function AssemblyPlan({ data, today, now }: { data: PlanningData; today: DayNumber; now: number }) {
  const { t, locale } = useI18n();
  const tp = t.planning;
  const drafts = usePlanningDrafts();
  const { savePlan } = usePlanSaving();
  const flow = useSaveFlow();

  const project = data.projects.find((p) => p.project === drafts.project) ?? data.projects[0];
  const days = data.days;
  const cells = project?.result.cells;

  const statuses = useMemo(() => {
    if (!project || !cells) return new Map<string, ReturnType<typeof evaluateItem>>();
    return new Map(project.items.map((it) => [it.item, evaluateItem(it, plannedTotal(cells, it.item, days))]));
  }, [project, cells, days]);

  if (!project || !cells) {
    return (
      <div className="panel">
        <p>{tp.assembly.noItems}</p>
        <p className="muted">{data.byLineColumn ? tp.assembly.byLine : tp.assembly.noLineColumn}</p>
      </div>
    );
  }

  const { capacity, plan } = project;
  const slotOf = (key: string) => key.slice(0, key.indexOf('|'));
  const dayOf = (slot: string) => parseDay(slot.slice(0, slot.indexOf(' ')));
  // Plánovací dny: zvolený počet, ale nejméně do posledního dne, kde už je něco naplánované nebo automatické.
  const usedDays = new Set([...Object.entries(cells).flatMap(([key, q]) => (q > 0 ? [dayOf(slotOf(key))] : [])), ...Object.keys(plan.auto).map(dayOf)]);
  const lastUsed = days.reduce((last, d, k) => (usedDays.has(d) ? k : last), -1);
  const minDays = Math.max(1, lastUsed + 1);
  const planDays = Math.min(days.length, Math.max(minDays, drafts.planDays[project.key] ?? PLAN_DAYS));
  const slots = shiftSlots(today, planDays, data.settings.firstShiftStart);
  // Nejdřív díly, kterým zákazníkovi díly bez plánu dojdou nejdřív.
  const items = [...project.items].sort(
    (a, b) =>
      (statuses.get(a.item)!.shortDayWithoutPlan ?? Infinity) - (statuses.get(b.item)!.shortDayWithoutPlan ?? Infinity) ||
      a.side.localeCompare(b.side) ||
      a.item.localeCompare(b.item, 'en', { numeric: true }),
  );

  const qty = (slot: ShiftSlot, item: string) => cells[cellKey(slot.key, item)] ?? 0;
  const capOf = (slot: ShiftSlot) => slotCapacity(slot, capacity, plan.capacity);
  const nominal = (slot: ShiftSlot) => slotCapacity(slot, capacity, {});
  const planned = (slot: ShiftSlot) => sum(items.map((it) => qty(slot, it.item)));
  const sides = slotSides(items, slots, (s, it) => qty(s, it.item));
  const past = (slot: ShiftSlot) => slot.end <= now;
  const update = (next: LinePlan) => drafts.setPlan(next, project.key);

  /** Plán se směnou přepnutou na ruční zadání: dopočítaná množství zůstanou jako ručně zadaná. */
  const manualSlot = (slot: ShiftSlot): LinePlan => {
    if (!plan.auto[slot.key]) return plan;
    const auto = { ...plan.auto };
    delete auto[slot.key];
    const own = Object.fromEntries(Object.entries(cells).filter(([key]) => slotOf(key) === slot.key));
    const rest = Object.fromEntries(Object.entries(plan.cells).filter(([key]) => slotOf(key) !== slot.key));
    return { ...plan, auto, cells: { ...rest, ...own } };
  };
  const setCell = (slot: ShiftSlot, item: string, value: string) => {
    const q = parseQty(value);
    if (q === null) return;
    const base = manualSlot(slot);
    const next = { ...base.cells };
    if (q > 0) next[cellKey(slot.key, item)] = q;
    else delete next[cellKey(slot.key, item)];
    update({ ...base, cells: next });
  };
  const setAuto = (slot: ShiftSlot, mode: AutoMode | '') => {
    if (!mode) return update(manualSlot(slot));
    const rest = Object.fromEntries(Object.entries(plan.cells).filter(([key]) => slotOf(key) !== slot.key));
    update({ ...plan, cells: rest, auto: { ...plan.auto, [slot.key]: mode } });
  };
  const setCapacity = (slot: ShiftSlot, value: string) => {
    const q = value.trim() === '' ? nominal(slot) : parseQty(value);
    if (q === null) return;
    const overrides = { ...plan.capacity };
    if (q === nominal(slot)) delete overrides[slot.key];
    else overrides[slot.key] = q;
    update({ ...plan, capacity: overrides });
  };

  const slotHasPlan = (slot: ShiftSlot) => !!plan.auto[slot.key] || Object.entries(cells).some(([key, q]) => q > 0 && slotOf(key) === slot.key);
  /** Vymaže plán jedné směny: množství i automatický plán (kapacita směny zůstane). */
  const resetSlot = (slot: ShiftSlot) => {
    const auto = { ...plan.auto };
    delete auto[slot.key];
    update({ ...plan, auto, cells: Object.fromEntries(Object.entries(plan.cells).filter(([key]) => slotOf(key) !== slot.key)) });
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
  const missing = sum(statusList.map((s) => s.missing));
  const worst = (pick: (s: (typeof statusList)[number]) => number | null) =>
    statusList.reduce<number | null>((w, s) => (pick(s) === null ? w : w === null ? pick(s) : Math.min(w, pick(s)!)), null);
  const loadCap = sum(slots.map(capOf));
  const loadPlanned = sum(slots.map(planned));
  const shiftTitle = (slot: ShiftSlot) => `${slotLabel(slot)} · ${formatTime(slot.start)}–${formatTime(slot.end)}`;
  const shiftClass = (slot: ShiftSlot) => `${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}`;
  const covStart = (k: number) => (k === 0 ? ' plan-cov-start' : '');
  const modeText = (mode: AutoMode) => (mode === 'BOTH' ? tp.assembly.autoBoth : mode);
  /** Souhrnný řádek: pod coverage prázdná buňka přes všechny dny. */
  const covFiller = <td className="plan-cov-start" colSpan={days.length} />;

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
        <button type="button" className="button button-primary" disabled={flow.busy} onClick={() => void flow.run((force) => savePlan(project, force))}>
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

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.uncovered}</span>
          <span className="kpi-value">{formatQuantity(uncovered, locale)}</span>
          <span className="kpi-note">
            {tp.kpi.missing} {formatQuantity(missing, locale)} {tp.pcs} · {tp.kpi.uncoveredNote} {formatQuantity(items.length, locale)}
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
            {tp.assembly.capacity}: {formatQuantity(capacity.perShift, locale)} {tp.pcs} · {capacity.shifts.join(' ') || '—'} · {tp.assembly.layout}
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
                {slots.map((slot) => (
                  <th key={slot.key} className={`n plan-shift${shiftClass(slot)}`} title={shiftTitle(slot)}>
                    <small className="plan-day">{slot.code === 'R' ? dayLabel(slot.day) : ' '}</small>
                    {slot.code}
                  </th>
                ))}
                {days.map((d, k) => (
                  <th key={d} className={`n${covStart(k)}${weekend(d)}`}>
                    <small className="plan-day">{k === 0 ? tp.assembly.coverageHead : ' '}</small>
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.resetRow}</strong>
                </td>
                <td colSpan={3} className="muted">
                  {tp.assembly.resetHint}
                </td>
                {slots.map((slot) => (
                  <td key={slot.key} className={shiftClass(slot)}>
                    <button
                      type="button"
                      className="button button-small"
                      aria-label={`${tp.assembly.resetRow} ${slotLabel(slot)}`}
                      title={`${tp.assembly.resetRow} ${slotLabel(slot)}`}
                      disabled={!slotHasPlan(slot)}
                      onClick={() => resetSlot(slot)}
                    >
                      ↺
                    </button>
                  </td>
                ))}
                {covFiller}
              </tr>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.autoRow}</strong>
                </td>
                <td colSpan={3} className="muted">
                  {tp.assembly.autoHint}
                </td>
                {slots.map((slot) => (
                  <td key={slot.key} className={`${shiftClass(slot)}${plan.auto[slot.key] ? ' cell-auto' : ''}`}>
                    <select
                      className="plan-select"
                      aria-label={`${tp.assembly.autoRow} ${slotLabel(slot)}`}
                      value={plan.auto[slot.key] ?? ''}
                      onChange={(e) => setAuto(slot, e.target.value as AutoMode | '')}
                    >
                      <option value="">{tp.assembly.autoManual}</option>
                      {AUTO_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {modeText(mode)}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                {covFiller}
              </tr>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.capacityRow}</strong>
                </td>
                <td colSpan={3} className="muted">
                  {tp.assembly.capacityHint}
                </td>
                {slots.map((slot) => (
                  <td key={slot.key} className={`n${shiftClass(slot)}${plan.capacity[slot.key] !== undefined ? ' cell-manual' : ''}`}>
                    <input
                      className="plan-input"
                      inputMode="numeric"
                      aria-label={`${tp.assembly.capacityRow} ${slotLabel(slot)}`}
                      value={capOf(slot) || ''}
                      placeholder="0"
                      data-col={slot.key}
                      onKeyDown={enterToNext}
                      onChange={(e) => setCapacity(slot, e.target.value)}
                    />
                  </td>
                ))}
                {covFiller}
              </tr>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.plannedRow}</strong>
                </td>
                <td colSpan={3} className="muted">
                  {tp.assembly.sidesHint}
                </td>
                {slots.map((slot, i) => {
                  const p = planned(slot);
                  const order = sides[i]!;
                  return (
                    <td key={slot.key} className={`n${shiftClass(slot)}${p > capOf(slot) ? ' cell-negative' : ''}`}>
                      {p > 0 ? formatQuantity(p, locale) : <span className="muted">0</span>}
                      {order.length > 0 && <small className="cell-note muted">{order.map((s) => s || '?').join(' → ')}</small>}
                    </td>
                  );
                })}
                {covFiller}
              </tr>
              {items.map((it) => {
                const status = statuses.get(it.item)!;
                return (
                  <tr key={it.item} className="plan-row">
                    <td className="sticky-col">
                      <strong>{it.item}</strong>
                      {it.customerNumber && <small className="muted cell-note">{it.customerNumber}</small>}
                    </td>
                    <td>
                      {it.side || '—'}
                      <small className="muted cell-note">
                        {tp.assembly.pack} {formatQuantity(packOf(it, capacity), locale)}
                      </small>
                    </td>
                    <td className="n">{formatQuantity(it.stock, locale)}</td>
                    <td className="cell-until">
                      <strong className={status.shortDay === null ? undefined : 'cell-short'}>{untilText(status.shortDay)}</strong>
                      <small className="muted cell-note">
                        {tp.assembly.withoutPlan} {untilText(status.shortDayWithoutPlan)}
                      </small>
                    </td>
                    {slots.map((slot) => (
                      <td key={slot.key} className={`n plan-cell${shiftClass(slot)}${plan.auto[slot.key] ? ' cell-auto' : ''}${past(slot) ? ' cell-past' : ''}`}>
                        <input
                          className="plan-input"
                          inputMode="numeric"
                          aria-label={`${it.item} ${slotLabel(slot)}`}
                          value={qty(slot, it.item) || ''}
                          data-col={slot.key}
                          onKeyDown={enterToNext}
                          onChange={(e) => setCell(slot, it.item, e.target.value)}
                        />
                      </td>
                    ))}
                    {days.map((d, k) => {
                      const v = status.coverage[k]!;
                      return (
                        <td
                          key={d}
                          className={`n plan-cov${covStart(k)}${weekend(d)}${v < -1e-9 ? ' cell-negative' : ''}`}
                          title={`${dayLabel(d)} · ${tp.assembly.withoutPlan} ${formatQuantity(status.withoutPlan[k]!, locale)}`}
                        >
                          {formatQuantity(v, locale)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="cov-legend">
          <li>
            <i className="swatch swatch-auto" /> {tp.legend.auto}
          </li>
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
          <dt>{tp.assembly.autoRow}</dt>
          <dd>{tp.explain.auto}</dd>
          <dt>{tp.assembly.planDays}</dt>
          <dd>{tp.explain.planDays}</dd>
          <dt>{tp.explain.pack}</dt>
          <dd>{tp.explain.packText}</dd>
          <dt>{tp.explain.sides}</dt>
          <dd>{tp.explain.sidesText}</dd>
          <dt>{tp.explain.reset}</dt>
          <dd>{tp.explain.resetText}</dd>
        </dl>
      </div>
    </>
  );
}
