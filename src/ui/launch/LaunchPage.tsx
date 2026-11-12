import { useMemo, useState } from 'react';
import type { DayNumber } from '../../core/dates';
import { formatQuantity } from '../../core/format';
import {
  addItem,
  addLinked,
  addProject,
  emptyLaunch,
  INTERNAL_STATUSES,
  launchSheets,
  launchSummary,
  linkedItems,
  phasesOf,
  removeItem,
  removeProject,
  statusOf,
  updateItem,
  type LaunchItem,
  type LaunchKind,
  type LaunchPlan,
  type LaunchScale,
} from '../../core/launch';
import { ownerNames } from '../../core/oil';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { dayText, LaunchGantt, type GanttRow, type Selection } from './LaunchGantt';
import { useLaunchDraft } from './LaunchProvider';
import { readScale, saveScale, ScaleSwitch } from '../timeline/useTimeline';

const LAUNCH_FILE = 'Launch/Launch.xlsx';
const SCALE_KEY = 'launch-scale';

type Filter = 'all' | 'open' | 'overdue';

/** Launch: náběh nových projektů – Gantt po projektech a fázích, úpravy přímo v řádcích. Ukládá se do Launch/Launch.xlsx. */
export function LaunchPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const tl = t.launch;
  const { state, saveFile, updateData } = useData();
  const { draft, setDraft } = useLaunchDraft();
  const flow = useSaveFlow();
  const data = state.data;
  const plan: LaunchPlan = draft ?? data?.launch?.plan ?? emptyLaunch();

  const [project, setProject] = useState('');
  const [owner, setOwner] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [scale, setScale] = useState<LaunchScale>(() => readScale(SCALE_KEY, 'month'));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<Selection>(null);

  const owners = useMemo(() => [...new Set(plan.items.flatMap((i) => ownerNames(i.owner)))].sort((a, b) => a.localeCompare(b, 'cs')), [plan]);
  const summary = useMemo(() => launchSummary(plan, today), [plan, today]);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="launch" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.launch.title}</h1>
        <p className="lead">{t.modules.launch.description}</p>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{tl.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {tl.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const update = (next: LaunchPlan) => setDraft(next);
  const newProject = () => {
    const result = addProject(plan, tl.newProject);
    update(result.plan);
    setProject('');
    setSelected({ type: 'project', name: result.name });
  };
  const newItem = (name: string, kind: LaunchKind, customer: boolean) => {
    const result = addItem(plan, name, kind, today, customer);
    update(result.plan);
    reveal(result.plan.items.at(-1)!);
  };
  /** Vlastní bod k milníku: čára od dneška do termínu milníku, hned pod milníkem. */
  const newLinked = (milestone: LaunchItem) => {
    const result = addLinked(plan, milestone.id, today);
    if (!result) return;
    update(result.plan);
    reveal(result.plan.items.at(-1)!);
  };
  /** Otevře řádek: rozbalí jeho projekt, fázi i fázi milníku, na který navazuje, a vybere ho (i klik na bod ve sbalené skupině). */
  const reveal = (item: LaunchItem) => {
    const parent = plan.items.find((i) => i.id === item.parent);
    const keys = new Set([`p|${item.project}`, `f|${item.project}|${item.phase}`, ...(parent ? [`f|${parent.project}|${parent.phase}`] : [])]);
    setCollapsed((c) => new Set([...c].filter((k) => !keys.has(k))));
    setSelected({ type: 'item', id: item.id });
  };
  const save = () =>
    flow.run(async (force) => {
      const path = data.launch?.path ?? LAUNCH_FILE;
      const result = await saveFile(path, () => xlsxBlob(launchSheets(plan, today)), data.launch?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({
          ...d,
          launch: {
            path: result.path,
            lastModified: result.lastModified,
            plan,
          },
        }));
        setDraft(null);
      }
      return result;
    });
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Řádky Ganttu: projekt (souhrn), fáze (souhrn) a úkoly či milníky. Souhrny počítají celý projekt i při filtru.
  const narrowed = owner !== '' || filter !== 'all';
  const matches = (i: LaunchItem) => {
    if (selected?.type === 'item' && selected.id === i.id) return true;
    if (owner && !ownerNames(i.owner).includes(owner)) return false;
    const s = statusOf(i, today);
    if (filter === 'open' && s === 'done') return false;
    if (filter === 'overdue' && s !== 'overdue') return false;
    return true;
  };
  const rows: GanttRow[] = [];
  const visible: LaunchItem[] = [];
  for (const p of plan.projects) {
    if (project && p.name !== project) continue;
    const all = plan.items.filter((i) => i.project === p.name);
    const shown = all.filter(matches);
    if (narrowed && shown.length === 0 && !(selected?.type === 'project' && selected.name === p.name)) continue;
    visible.push(...all);
    const key = `p|${p.name}`;
    rows.push({
      type: 'project',
      key,
      project: p,
      items: all,
      collapsed: collapsed.has(key),
    });
    if (collapsed.has(key)) continue;
    if (all.length === 0) rows.push({ type: 'empty', key: `e|${p.name}` });
    const phases = phasesOf(all);
    // Body navázané na milník jsou hned pod ním (odsazené); bez zobrazeného milníku jako samostatné řádky.
    const shownIds = new Set(shown.map((i) => i.id));
    const linked = linkedItems(shown);
    const top = shown.filter((i) => i.parent === null || !shownIds.has(i.parent));
    for (const group of phasesOf(top)) {
      const phaseKey = `f|${p.name}|${group.phase}`;
      if (group.phase)
        rows.push({
          type: 'phase',
          key: phaseKey,
          phase: group.phase,
          items: phases.find((g) => g.phase === group.phase)!.items,
          collapsed: collapsed.has(phaseKey),
        });
      if (group.phase && collapsed.has(phaseKey)) continue;
      const depth = group.phase ? 2 : 1;
      for (const item of group.items) {
        rows.push({ type: 'item', key: `i|${item.id}`, item, depth });
        for (const child of linked.get(item.id) ?? []) rows.push({ type: 'item', key: `i|${child.id}`, item: child, depth: (depth + 1) as 2 | 3 });
      }
    }
  }

  const next = summary.next;
  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="filters" role="group" aria-label={tl.filter}>
        <button type="button" className="button button-primary" onClick={newProject}>
          + {tl.addProject}
        </button>
        <label className="inline-field">
          <span>{tl.project}</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{tl.allProjects}</option>
            {plan.projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{tl.owner}</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{tl.allOwners}</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label={tl.filter}>
          {(['all', 'open', 'overdue'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {tl.filters[f]}
            </button>
          ))}
        </div>
        <ScaleSwitch
          scale={scale}
          label={tl.scale}
          labels={tl.scales}
          onChange={(s) => {
            setScale(s);
            saveScale(SCALE_KEY, s);
          }}
        />
        <span className="filters-break" role="presentation" />
        <button type="button" className="button" disabled={flow.busy} onClick={() => void save()}>
          {tl.save}
        </button>
        <SaveStatus
          dirty={draft !== null}
          saved={
            data.launch
              ? {
                  path: data.launch.path,
                  lastModified: data.launch.lastModified,
                }
              : null
          }
          message={flow.message}
        />
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{tl.kpi.projects}</span>
          <span className="kpi-value">{formatQuantity(summary.projects, locale)}</span>
          <span className="kpi-note">{tl.kpi.projectsNote.replace('{n}', formatQuantity(summary.items, locale))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tl.kpi.overdue}</span>
          <span className={`kpi-value${summary.overdue ? ' cell-short' : ''}`}>{formatQuantity(summary.overdue, locale)}</span>
          <span className="kpi-note">{tl.kpi.overdueNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tl.kpi.next}</span>
          <span className="kpi-value">{next ? `${dayText(next.end!, locale)}` : '—'}</span>
          <span className="kpi-note">
            {next ? `${next.end === today ? tl.kpi.today : tl.kpi.inDays.replace('{n}', formatQuantity(next.end! - today, locale))} · ${next.project} · ${next.name || tl.noName}` : tl.kpi.nextNone}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{tl.kpi.progress}</span>
          <span className="kpi-value">{summary.progress === null ? '—' : `${formatQuantity(summary.progress, locale)} %`}</span>
          <span className="kpi-note">{tl.kpi.progressNote}</span>
        </div>
      </div>

      <div className="panel">
        {plan.projects.length === 0 ? (
          <p className="muted">{tl.emptyList}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{tl.empty}</p>
        ) : (
          <LaunchGantt
            plan={plan}
            rows={rows}
            rangeItems={visible}
            today={today}
            scale={scale}
            selected={selected}
            owners={owners}
            select={setSelected}
            toggle={toggle}
            update={update}
            newItem={newItem}
            newLinked={newLinked}
            reveal={reveal}
            removeItem={(id) => {
              update(removeItem(plan, id));
              setSelected(null);
            }}
            removeProject={(name) => {
              update(removeProject(plan, name));
              setSelected(null);
              if (project === name) setProject('');
            }}
            renamed={(from, to) => {
              setSelected({ type: 'project', name: to });
              if (project === from) setProject(to);
              setCollapsed((c) => new Set([...c].map((k) => (k === `p|${from}` ? `p|${to}` : k))));
            }}
            changeItem={(id, fn) => update(updateItem(plan, id, fn))}
          />
        )}
        <ul className="cov-legend">
          <li className="muted">{tl.legend}</li>
          {INTERNAL_STATUSES.map((s) => (
            <li key={s}>
              <i className={`gantt-key gantt-${s}`} aria-hidden="true" /> {tl.status[s]}
            </li>
          ))}
        </ul>
        <ul className="cov-legend">
          <li className="muted">{tl.legendCustomer}</li>
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <li key={c}>
              <i className={`gantt-key gantt-key-ms gantt-c${c}`} aria-hidden="true" />
            </li>
          ))}
          <li>
            <i className="gantt-key gantt-key-ms gantt-c0 gantt-passed" aria-hidden="true" /> {tl.passed}
          </li>
        </ul>
        <ul className="cov-legend">
          <li>
            <i className="gantt-key gantt-key-ms" aria-hidden="true" /> {tl.legendMilestone}
          </li>
          <li>
            <i className="gantt-key gantt-key-sum gantt-key-sum-c gantt-c0" aria-hidden="true" /> {tl.legendSummaryCustomer}
          </li>
          <li>
            <i className="gantt-key gantt-key-sum gantt-key-sum-i gantt-advanced" aria-hidden="true" /> {tl.legendSummaryInternal}
          </li>
          <li>
            <i className="gantt-key gantt-key-line" aria-hidden="true" /> {tl.legendLine}
          </li>
          <li>
            <i className="gantt-key gantt-key-base" aria-hidden="true" /> {tl.legendBaseline}
          </li>
        </ul>
        <p className="muted">{tl.legendHint}</p>
      </div>
    </section>
  );
}
