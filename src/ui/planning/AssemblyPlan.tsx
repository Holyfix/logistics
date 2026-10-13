import { useMemo, useState } from 'react';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { evaluateItem, proposePlan, slotCapacity, slotSides } from '../../core/planning/assembly';
import { cellKey, type LinePlan, type ShiftSlot } from '../../core/planning/plan';
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

export function AssemblyPlan({ data, today, now }: { data: PlanningData; today: DayNumber; now: number }) {
  const { t, locale } = useI18n();
  const tp = t.planning;
  const drafts = usePlanningDrafts();
  const { savePlan } = usePlanSaving();
  const flow = useSaveFlow();
  const [proposal, setProposal] = useState<{ project: string; remaining: number } | null>(null);

  const project = data.projects.find((p) => p.project === drafts.project) ?? data.projects[0];
  const slots = data.slots;
  const plan = project?.plan;

  const statuses = useMemo(() => {
    if (!project || !plan) return new Map<string, ReturnType<typeof evaluateItem>>();
    return new Map(project.items.map((it) => [it.item, evaluateItem(it, slots, (s) => plan.cells[cellKey(s.key, it.item)] ?? 0, today)]));
  }, [project, plan, slots, today]);

  if (!project || !plan) {
    return (
      <div className="panel">
        <p>{tp.assembly.noItems}</p>
        <p className="muted">{data.byLineColumn ? tp.assembly.byLine : tp.assembly.noLineColumn}</p>
      </div>
    );
  }

  const { capacity } = project;
  // Nejdřív díly, kterým u zákazníka chybí kusy nejdřív.
  const items = [...project.items].sort(
    (a, b) => (statuses.get(a.item)!.firstMissing ?? Infinity) - (statuses.get(b.item)!.firstMissing ?? Infinity) || a.side.localeCompare(b.side) || a.item.localeCompare(b.item, 'en', { numeric: true }),
  );
  const shown = slots;
  const qty = (slot: ShiftSlot, item: string) => plan.cells[cellKey(slot.key, item)] ?? 0;
  const capOf = (slot: ShiftSlot) => slotCapacity(slot, capacity, plan.capacity);
  const nominal = (slot: ShiftSlot) => slotCapacity(slot, capacity, {});
  const planned = (slot: ShiftSlot) => sum(items.map((it) => qty(slot, it.item)));
  const sides = slotSides(items, shown, (s, it) => qty(s, it.item));
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
  const openHasPlan = open.some((s) => items.some((it) => qty(s, it.item) > 0));
  const firstOpen = open[0];
  const propose = () => {
    if (openHasPlan && firstOpen && !window.confirm(`${tp.assembly.confirmPropose} ${slotLabel(firstOpen)}?`)) return;
    const result = proposePlan(items, slots, capOf, plan.cells, now);
    update({ ...plan, cells: result.cells });
    setProposal({ project: project.project, remaining: result.remaining });
  };
  const clear = () => {
    if (!firstOpen || !window.confirm(`${tp.assembly.confirmClear} ${slotLabel(firstOpen)}?`)) return;
    const openKeys = new Set(open.map((s) => s.key));
    update({ ...plan, cells: Object.fromEntries(Object.entries(plan.cells).filter(([key]) => !openKeys.has(key.slice(0, key.indexOf('|'))))) });
    setProposal(null);
  };

  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  function slotLabel(slot: ShiftSlot) {
    return `${dayLabel(slot.day)} ${slot.code}`;
  }
  const weekend = (d: DayNumber) => (weekday(d) >= 6 ? ' col-weekend' : '');
  const statusList = [...statuses.values()];
  const short = statusList.filter((s) => s.firstMissing !== null).length;
  const late = statusList.filter((s) => s.late).length;
  const loadCap = sum(slots.map(capOf));
  const loadPlanned = sum(slots.map(planned));
  const coveredText = (until: DayNumber | 'whole' | null) => (until === 'whole' ? tp.assembly.whole : until === null ? tp.assembly.notCovered : dayLabel(until));
  const shiftTitle = (slot: ShiftSlot) => `${slotLabel(slot)} · ${formatTime(slot.start)}–${formatTime(slot.end)}`;

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
          <span className="kpi-label">{tp.kpi.short}</span>
          <span className="kpi-value">{formatQuantity(short, locale)}</span>
          <span className="kpi-note">
            {tp.kpi.shortNote} {formatQuantity(items.length, locale)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.planned}</span>
          <span className="kpi-value">{formatQuantity(sum(statusList.map((s) => s.planned)), locale)}</span>
          <span className="kpi-note">
            {tp.kpi.missing} {formatQuantity(sum(statusList.map((s) => s.missing)), locale)} {tp.pcs}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.load}</span>
          <span className="kpi-value">{loadCap > 0 ? `${Math.round((loadPlanned / loadCap) * 100)} %` : '—'}</span>
          <span className="kpi-note">
            {formatQuantity(loadPlanned, locale)} / {formatQuantity(loadCap, locale)} {tp.pcs} · {tp.kpi.loadNote}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tp.kpi.late}</span>
          <span className="kpi-value">{formatQuantity(late, locale)}</span>
          <span className="kpi-note">{tp.kpi.lateNote}</span>
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
                <th className="n">{tp.assembly.missing}</th>
                <th>{tp.assembly.firstMissing}</th>
                <th>{tp.assembly.until}</th>
                {shown.map((slot) => (
                  <th key={slot.key} className={`n plan-shift${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}`} title={shiftTitle(slot)}>
                    <small className="plan-day">{slot.code === 'R' ? dayLabel(slot.day) : ' '}</small>
                    {slot.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.capacityRow}</strong>
                </td>
                <td colSpan={5} className="muted">
                  {tp.assembly.capacityHint}
                </td>
                {shown.map((slot) => (
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
                ))}
              </tr>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.plannedRow}</strong>
                </td>
                <td colSpan={5} />
                {shown.map((slot) => {
                  const p = planned(slot);
                  return (
                    <td key={slot.key} className={`n${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}${p > capOf(slot) ? ' cell-negative' : ''}`}>
                      {p > 0 ? formatQuantity(p, locale) : <span className="muted">0</span>}
                    </td>
                  );
                })}
              </tr>
              <tr className="plan-summary">
                <td className="sticky-col">
                  <strong>{tp.assembly.sidesRow}</strong>
                </td>
                <td colSpan={5} className="muted">
                  {tp.assembly.sidesHint}
                </td>
                {shown.map((slot, k) => (
                  <td key={slot.key} className={`plan-sides${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}`}>
                    {sides[k]!.map((s) => s || '?').join(' → ')}
                  </td>
                ))}
              </tr>
              {items.map((it) => {
                const status = statuses.get(it.item)!;
                return (
                  <tr key={it.item}>
                    <td className="sticky-col">
                      <strong>{it.item}</strong>
                      {it.customerNumber && <small className="muted cell-note">{it.customerNumber}</small>}
                    </td>
                    <td>{it.side || '—'}</td>
                    <td className="n">{formatQuantity(it.stock, locale)}</td>
                    <td className="n">{status.missing > 0 ? formatQuantity(status.missing, locale) : <span className="muted">0</span>}</td>
                    <td className="cell-until">
                      {status.firstMissing === null ? <span className="muted">{tp.assembly.noMissing}</span> : <strong className="cell-short">{dayLabel(status.firstMissing)}</strong>}
                    </td>
                    <td className="cell-until">
                      <strong className={status.coveredWithPlan === 'whole' ? undefined : 'cell-short'}>{coveredText(status.coveredWithPlan)}</strong>
                    </td>
                    {shown.map((slot, k) => {
                      const balance = status.balance[k]!;
                      const due = status.due[k]!;
                      return (
                        <td
                          key={slot.key}
                          className={`n plan-cell${slot.code === 'R' ? ' plan-day-start' : ''}${weekend(slot.day)}${past(slot) ? ' cell-past' : ''}${balance < -1e-9 ? ' cell-negative' : ''}`}
                          title={`${slotLabel(slot)} · ${tp.assembly.due}: ${formatQuantity(due, locale)} · ${tp.assembly.balance}: ${formatQuantity(balance, locale)}`}
                        >
                          <input
                            className="plan-input"
                            inputMode="numeric"
                            aria-label={`${it.item} ${slotLabel(slot)}`}
                            value={qty(slot, it.item) || ''}
                            disabled={past(slot)}
                            onChange={(e) => setCell(slot, it.item, e.target.value)}
                          />
                          <small className="cell-note">{due > 0 ? `${formatQuantity(balance, locale)} ▾${formatQuantity(due, locale)}` : formatQuantity(balance, locale)}</small>
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
            <i className="swatch swatch-negative" /> {tp.legend.late}
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
        <p className="muted">{tp.assembly.note}</p>
      </div>
    </>
  );
}
