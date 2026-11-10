import { useMemo, useState } from 'react';
import { dayToIso, parseDay, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity, type Locale } from '../../core/format';
import type { Progress } from '../../core/oil';
import {
  addActivity,
  addPerson,
  addTraining,
  emptySkills,
  LEVELS,
  levelOf,
  nextLevel,
  qualifiedCount,
  recordOf,
  removeActivity,
  removePerson,
  removeTraining,
  renameActivity,
  renamePerson,
  renameTraining,
  setValidity,
  skillSheets,
  trainingAlerts,
  trainingState,
  uncovered,
  updateActivity,
  updatePerson,
  withLevel,
  withRecord,
  type Level,
  type SkillData,
} from '../../core/skills';
import { useI18n } from '../../i18n/I18nProvider';
import { xlsxBlob } from '../../platform/download';
import { localToday } from '../components/useComponents';
import { useData } from '../data/DataProvider';
import { Icon } from '../icons';
import { ProgressBall } from '../oil/ProgressBall';
import { SaveStatus, useSaveFlow } from '../planning/SaveStatus';
import { AddRow, NameInput } from './NameInput';
import { useSkillsDraft } from './drafts';

const FILE = 'Lide/SkillMatrix.xlsx';

const fullDate = (day: DayNumber, locale: Locale) => `${formatDayShort(dayToIso(day), locale)}${locale === 'cs' ? ' ' : '/'}${dayToIso(day).slice(0, 4)}`;
const ball = (level: Level) => (level * 25) as Progress;

/** Skill Matrix: lidé × činnosti (úroveň 0–4), zástupnost a školení s platností. Ukládá se do Lide/SkillMatrix.xlsx. */
export function SkillsPage({ today = localToday() }: { today?: DayNumber } = {}) {
  const { t, locale } = useI18n();
  const ts = t.skills;
  const { state, saveFile, updateData } = useData();
  const { draft, setDraft } = useSkillsDraft();
  const flow = useSaveFlow();
  const loaded = state.data;
  const data: SkillData = draft ?? loaded?.skills?.data ?? emptySkills();
  const [team, setTeam] = useState('');

  const teams = useMemo(() => [...new Set(data.people.map((p) => p.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), [data]);
  const people = data.people.filter((p) => !team || p.team === team);

  const head = (
    <div className="page-head module-head">
      <span className="module-icon">
        <Icon name="skills" />
      </span>
      <div>
        <h1 id="page-title">{t.modules.skills.title}</h1>
        <p className="lead">{t.modules.skills.description}</p>
      </div>
    </div>
  );

  if (!loaded) {
    return (
      <section className="page" aria-labelledby="page-title">
        {head}
        <div className="panel">
          <p>{ts.noData}</p>
          <p>
            <a className="button button-primary" href="#data">
              {ts.noDataAction}
            </a>
          </p>
        </div>
      </section>
    );
  }

  const update = (next: SkillData) => setDraft(next);
  const save = () =>
    flow.run(async (force) => {
      const path = loaded.skills?.path ?? FILE;
      const result = await saveFile(path, () => xlsxBlob(skillSheets(data)), loaded.skills?.lastModified ?? null, force);
      if (result.status === 'saved') {
        updateData((d) => ({ ...d, skills: { path: result.path, lastModified: result.lastModified, data } }));
        setDraft(null);
      }
      return result;
    });
  const tryUpdate = (next: SkillData | null) => {
    if (next) update(next);
    return next !== null;
  };
  const confirmDelete = (name: string) => window.confirm(ts.lists.deleteConfirm.replace('{name}', name));

  const alerts = trainingAlerts(data, today);
  const missing = uncovered(data);
  // Sloupce matice po oblastech (pořadí podle prvního výskytu oblasti).
  const areas = [...new Set(data.activities.map((a) => a.area))];
  const activities = areas.flatMap((area) => data.activities.filter((a) => a.area === area));
  const levelTitle = (level: Level) => `${level} – ${ts.levels[level].name}: ${ts.levels[level].hint}`;

  return (
    <section className="page" aria-labelledby="page-title">
      {head}

      <div className="filters" role="group" aria-label={ts.matrix.heading}>
        <label className="inline-field">
          <span>{ts.team}</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">{ts.allTeams}</option>
            {teams.map((tm) => (
              <option key={tm} value={tm}>
                {tm}
              </option>
            ))}
          </select>
        </label>
        <span className="filters-break" role="presentation" />
        <button type="button" className="button" disabled={flow.busy} onClick={() => void save()}>
          {ts.save}
        </button>
        <SaveStatus dirty={draft !== null} saved={loaded.skills ? { path: loaded.skills.path, lastModified: loaded.skills.lastModified } : null} message={flow.message} />
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{ts.kpi.people}</span>
          <span className="kpi-value">{formatQuantity(data.people.length, locale)}</span>
          <span className="kpi-note">{ts.kpi.activities.replace('{n}', formatQuantity(data.activities.length, locale))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.kpi.uncovered}</span>
          <span className={`kpi-value${missing.length ? ' cell-short' : ''}`}>{formatQuantity(missing.length, locale)}</span>
          <span className="kpi-note">{missing.length ? missing.map((a) => a.name).join(', ') : ts.kpi.uncoveredNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.kpi.expired}</span>
          <span className={`kpi-value${alerts.expired.length ? ' cell-short' : ''}`}>{formatQuantity(alerts.expired.length, locale)}</span>
          <span className="kpi-note">{ts.kpi.expiredNote}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.kpi.soon}</span>
          <span className={`kpi-value${alerts.soon.length ? ' cell-warn' : ''}`}>{formatQuantity(alerts.soon.length, locale)}</span>
          <span className="kpi-note">{ts.kpi.soonNote}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ts.matrix.heading}</h2>
        </div>
        {people.length === 0 || activities.length === 0 ? (
          <p className="muted">{ts.matrix.empty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table skill-matrix" aria-label={ts.matrix.heading}>
              <thead>
                {areas.some(Boolean) && (
                  <tr>
                    <th className="sticky-col" />
                    {areas.map((area) => (
                      <th key={area} colSpan={data.activities.filter((a) => a.area === area).length} className="skill-area">
                        {area || ts.matrix.noArea}
                      </th>
                    ))}
                  </tr>
                )}
                <tr>
                  <th className="sticky-col">{ts.matrix.person}</th>
                  {activities.map((a) => (
                    <th key={a.name} className="skill-col">
                      {a.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name}>
                    <td className="sticky-col">
                      {p.name}
                      {p.team && <small className="muted"> · {p.team}</small>}
                    </td>
                    {activities.map((a) => {
                      const level = levelOf(data, p.name, a.name);
                      return (
                        <td key={a.name} className="skill-cell">
                          <button
                            type="button"
                            className={`skill-level skill-level-${level}`}
                            title={levelTitle(level)}
                            aria-label={`${p.name} · ${a.name}: ${levelTitle(level)}`}
                            onClick={() => update(withLevel(data, p.name, a.name, nextLevel(level)))}
                          >
                            <ProgressBall progress={ball(level)} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-col">{ts.matrix.qualified}</td>
                  {activities.map((a) => {
                    const n = qualifiedCount(data, a.name);
                    const tone = n < a.minQualified ? 'cell-short' : n === a.minQualified ? 'cell-warn' : '';
                    return (
                      <td key={a.name} className="skill-cell" title={ts.matrix.need.replace('{n}', String(a.minQualified))}>
                        <strong className={tone || undefined}>
                          {n}/{a.minQualified}
                        </strong>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <ul className="cov-legend">
          <li className="muted">{ts.matrix.legend}</li>
          {LEVELS.map((l) => (
            <li key={l} title={ts.levels[l].hint}>
              <ProgressBall progress={ball(l)} /> {l} {ts.levels[l].name}
            </li>
          ))}
        </ul>
        <p className="muted">{ts.matrix.hint}</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ts.trainings.heading}</h2>
        </div>
        {people.length === 0 || data.trainings.length === 0 ? (
          <p className="muted">{ts.trainings.empty}</p>
        ) : (
          <div className="table-scroll">
            <table className="table skill-trainings" aria-label={ts.trainings.heading}>
              <thead>
                <tr>
                  <th className="sticky-col">{ts.matrix.person}</th>
                  {data.trainings.map((tr) => (
                    <th key={tr.name}>
                      {tr.name}
                      <small className="muted"> · {tr.validityMonths === null ? ts.trainings.forever : `${tr.validityMonths} m`}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name}>
                    <td className="sticky-col">{p.name}</td>
                    {data.trainings.map((tr) => {
                      const record = recordOf(data, p.name, tr.name);
                      const st = trainingState(record, today);
                      return (
                        <td key={tr.name} className={`skill-training skill-${st}`} title={ts.trainings.state[st]}>
                          <input
                            type="date"
                            aria-label={`${p.name} · ${tr.name}`}
                            value={record ? dayToIso(record.date) : ''}
                            onChange={(e) => update(withRecord(data, p.name, tr.name, parseDay(e.target.value)))}
                          />
                          {record && <small>{record.validUntil === null ? ts.trainings.forever : ts.trainings.until.replace('{date}', fullDate(record.validUntil, locale))}</small>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="cov-legend">
          {(['expired', 'soon', 'ok', 'none'] as const).map((st) => (
            <li key={st}>
              <i className={`skill-key skill-${st}`} aria-hidden="true" /> {ts.trainings.state[st]}
            </li>
          ))}
        </ul>
        <p className="muted">{ts.trainings.hint}</p>
      </div>

      <div className="panel">
        <h2>{ts.lists.heading}</h2>
        <div className="skill-lists">
          <div>
            <h3>{ts.lists.people}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>{ts.lists.personName}</th>
                  <th>{ts.lists.team}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <NameInput value={p.name} label={ts.lists.personName} invalid={ts.lists.nameTaken} commit={(v) => tryUpdate(renamePerson(data, p.name, v))} />
                    </td>
                    <td>
                      <input aria-label={`${ts.lists.team}: ${p.name}`} list="skill-teams" value={p.team} onChange={(e) => update(updatePerson(data, p.name, { team: e.target.value }))} />
                    </td>
                    <td>
                      <DeleteButton label={`${ts.lists.delete}: ${p.name}`} onClick={() => confirmDelete(p.name) && update(removePerson(data, p.name))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="skill-teams">
              {teams.map((tm) => (
                <option key={tm} value={tm} />
              ))}
            </datalist>
            <AddRow placeholder={ts.lists.addPerson} button={ts.lists.add} invalid={ts.lists.nameTaken} add={(v) => tryUpdate(addPerson(data, v, team))} />
          </div>
          <div>
            <h3>{ts.lists.activities}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>{ts.lists.name}</th>
                  <th>{ts.lists.area}</th>
                  <th className="n">{ts.lists.min}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.activities.map((a) => (
                  <tr key={a.name}>
                    <td>
                      <NameInput value={a.name} label={ts.lists.name} invalid={ts.lists.nameTaken} commit={(v) => tryUpdate(renameActivity(data, a.name, v))} />
                    </td>
                    <td>
                      <input aria-label={`${ts.lists.area}: ${a.name}`} list="skill-areas" value={a.area} onChange={(e) => update(updateActivity(data, a.name, { area: e.target.value }))} />
                    </td>
                    <td className="n">
                      <input
                        type="number"
                        min={0}
                        className="input-narrow"
                        aria-label={`${ts.lists.min}: ${a.name}`}
                        value={a.minQualified}
                        onChange={(e) => update(updateActivity(data, a.name, { minQualified: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                      />
                    </td>
                    <td>
                      <DeleteButton label={`${ts.lists.delete}: ${a.name}`} onClick={() => confirmDelete(a.name) && update(removeActivity(data, a.name))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="skill-areas">
              {areas.filter(Boolean).map((area) => (
                <option key={area} value={area} />
              ))}
            </datalist>
            <AddRow placeholder={ts.lists.addActivity} button={ts.lists.add} invalid={ts.lists.nameTaken} add={(v) => tryUpdate(addActivity(data, v))} />
          </div>
          <div>
            <h3>{ts.lists.trainings}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>{ts.lists.name}</th>
                  <th className="n" title={ts.lists.validityHint}>
                    {ts.lists.validity}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.trainings.map((tr) => (
                  <tr key={tr.name}>
                    <td>
                      <NameInput value={tr.name} label={ts.lists.name} invalid={ts.lists.nameTaken} commit={(v) => tryUpdate(renameTraining(data, tr.name, v))} />
                    </td>
                    <td className="n">
                      <input
                        type="number"
                        min={1}
                        className="input-narrow"
                        placeholder={ts.lists.validityHint}
                        aria-label={`${ts.lists.validity}: ${tr.name}`}
                        value={tr.validityMonths ?? ''}
                        onChange={(e) => update(setValidity(data, tr.name, e.target.value === '' || Number(e.target.value) <= 0 ? null : Math.round(Number(e.target.value))))}
                      />
                    </td>
                    <td>
                      <DeleteButton label={`${ts.lists.delete}: ${tr.name}`} onClick={() => confirmDelete(tr.name) && update(removeTraining(data, tr.name))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AddRow placeholder={ts.lists.addTraining} button={ts.lists.add} invalid={ts.lists.nameTaken} add={(v) => tryUpdate(addTraining(data, v))} />
          </div>
        </div>
      </div>
    </section>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="button button-small button-danger" aria-label={label} title={label} onClick={onClick}>
      ×
    </button>
  );
}
