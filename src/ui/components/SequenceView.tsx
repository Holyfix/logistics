import { Fragment, useMemo, useState } from 'react';
import { mergeBoms } from '../../core/bom';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { buildMaterialCoverage, carMissing, carUndetermined, DONE_STATUS, missingKeys, shortages, type CarCoverage, type DoorCoverage } from '../../core/material/coverage';
import { dayOfStamp, DOORS, MINUTES_PER_DAY, type Door, type Stamp } from '../../core/material/jit';
import { statusCode } from '../../core/material/matrix';
import { PART_KINDS, type PartKind } from '../../core/material/partKey';
import { isExcludedLocation, locationsOf, STOCK_ZONES, stockByItem } from '../../core/stock';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsxSheets } from '../../platform/download';
import { useData } from '../data/DataProvider';

/** Filtry Matrixu: hodnota sloupce ('' = vše). */
interface CarFilter {
  optionType: string;
  day: string;
  status: string;
}
const NO_FILTER: CarFilter = { optionType: '', day: '', status: '' };
const NO_DAY = 'none';

/** Den stavby vozu pro filtr ('none' = bez data). */
const carDay = (c: CarCoverage) => (c.planned === null ? NO_DAY : String(dayOfStamp(c.planned)));

/** Nevyrobený carset: aspoň jedny dveře (DP) ve stavu pod „Packed“ (45 a méně). */
const unbuilt = (c: CarCoverage) => DOORS.some((d) => {
  const status = c.doors[d]?.status;
  return status !== undefined && (statusCode(status) ?? 0) < DONE_STATUS;
});

/** Lokace, které uživatel nechce počítat do skladu MC a MF (zvlášť pro každý druh; pamatují se v prohlížeči). */
const EXCLUDED_KEYS: Record<PartKind, string> = { MC: 'sequence-excluded-locations-mc', MF: 'sequence-excluded-locations' };
type Excluded = Record<PartKind, Set<string>>;
function loadExcluded(): Excluded {
  const load = (kind: PartKind) => {
    try {
      const saved = JSON.parse(localStorage.getItem(EXCLUDED_KEYS[kind]) ?? '[]') as unknown;
      return new Set(Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : []);
    } catch {
      return new Set<string>();
    }
  };
  return { MC: load('MC'), MF: load('MF') };
}
function saveExcluded(kind: PartKind, excluded: ReadonlySet<string>) {
  try {
    localStorage.setItem(EXCLUDED_KEYS[kind], JSON.stringify([...excluded].sort()));
  } catch {
    // Volba se jen nezapamatuje.
  }
}

/** Barva stavu jako v Order Status Matrix (podle čísla stavu). */
const STATUS_COLORS = [20, 25, 30, 40, 45, 50, 60];
const statusClass = (status: string) => {
  const code = statusCode(status);
  return code !== null && STATUS_COLORS.includes(code) ? ` mat-s${code}` : '';
};

/** Díly vozu bez klíče po druzích, např. „MC FL, FR · MF RR“. */
const undeterminedText = (car: CarCoverage) =>
  carUndetermined(car)
    .map((u) => `${u.kind} ${u.doors.join(', ')}`)
    .join(' · ');

/** Chybějící MC a MF vozu po dveřích, např. „FL: MC 123, MF 456“. */
function missingByDoor(car: CarCoverage): string[] {
  const doors = new Map<Door, string[]>();
  for (const m of carMissing(car)) (doors.get(m.door) ?? doors.set(m.door, []).get(m.door)!).push(`${m.kind} ${m.item}`);
  return [...doors].map(([door, parts]) => `${door}: ${parts.join(', ')}`);
}

/**
 * Sekvence (karta v Komponentách): pokrytí Maincarrieru a Middlefieldu ve formátu Order Status Matrix. Vozy a stav
 * dveří z matice, MC a MF podle klíče MC/MF (složka Sekvence), co v klíči není, podle JIT Overview a načtených
 * kusovníků; sklad z načteného souboru skladu (lokace se dají vyřadit zvlášť pro MC a MF).
 */
export function SequenceView({ today }: { today: DayNumber }) {
  const { t, locale } = useI18n();
  const ts = t.sequence;
  const { state } = useData();
  const data = state.data;
  const sequence = data?.sequence;
  const [filter, setFilter] = useState<CarFilter>(NO_FILTER);
  const [query, setQuery] = useState('');
  const [onlyShort, setOnlyShort] = useState(false);
  const [onlyUnbuilt, setOnlyUnbuilt] = useState(false);
  const [excludedAll, setExcludedAll] = useState<Excluded>(loadExcluded);
  const [locationKind, setLocationKind] = useState<PartKind>('MC');
  const [locationQuery, setLocationQuery] = useState('');
  const excluded = excludedAll[locationKind];
  const updateExcluded = (next: Set<string>) => {
    setExcludedAll({ ...excludedAll, [locationKind]: next });
    saveExcluded(locationKind, next);
  };

  const coverage = useMemo(() => {
    const stockOf = (kind: PartKind) =>
      data?.stock ? stockByItem(data.stock.data, (location) => isExcludedLocation(location) || excludedAll[kind].has(location.trim().toUpperCase())) : new Map<string, number>();
    const bom = data?.boms.length ? mergeBoms(data.boms.map((b) => b.data)) : undefined;
    if (!sequence?.matrix || !(sequence.key || (sequence.jit && bom))) return null;
    return buildMaterialCoverage({
      matrix: sequence.matrix.orders,
      key: sequence.key?.key,
      positions: sequence.jit?.positions,
      bom,
      stock: { MC: stockOf('MC'), MF: stockOf('MF') },
      today,
    });
  }, [sequence, data, today, excludedAll]);
  // Lokace se skladem MC, resp. MF (bez lokací, které aplikace vylučuje vždy); na výběr, které se nepočítají.
  const locationsByKind = useMemo(() => {
    const of = (kind: PartKind) => (coverage && data?.stock ? locationsOf(data.stock.data, new Set(coverage.parts.filter((p) => p.kind === kind).map((p) => p.item))) : []);
    return { MC: of('MC'), MF: of('MF') };
  }, [coverage, data]);
  const locations = locationsByKind[locationKind];

  if (!coverage) {
    return (
      <div className="panel">
        <p>{ts.noFiles}</p>
        {sequence && !sequence.matrix && <p className="banner banner-warn">{ts.needMatrix}</p>}
        {sequence && !sequence.key && !sequence.jit && <p className="banner banner-warn">{ts.needKey}</p>}
      </div>
    );
  }

  const qty = (v: number) => formatQuantity(v, locale);
  const dayLabel = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const time = (s: Stamp | null) => {
    if (s === null) return ts.matrix.noDate;
    const day = dayOfStamp(s);
    const minute = s - day * MINUTES_PER_DAY;
    // Rok jen u jiného roku než letos.
    const year = dayToIso(day).slice(0, 4);
    return `${dayLabel(day)}${year !== dayToIso(today).slice(0, 4) ? ` ${year}` : ''} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  };
  const doorTitle = (cell: DoorCoverage) =>
    [
      ...(cell.parts.some((p) => p.source === 'jit') ? [`${ts.matrix.panel}: ${cell.panel}`] : []),
      ...cell.parts.map((p) => `${p.kind} ${p.item}${p.source === 'key' ? ` (${ts.matrix.fromKey})` : ''}: ${ts.matrix.left} ${qty(p.left)}`),
      ...cell.unknown.map((kind) => `${kind}: ${ts.matrix.unknown}`),
    ].join('\n');

  const q = query.trim().toLowerCase();
  const allCars = coverage.cars;
  const carText = (c: CarCoverage) => [c.productionNumber, c.lot, ...DOORS.flatMap((d) => c.doors[d]?.parts.map((p) => p.item) ?? [])].join(' ').toLowerCase();
  const cars = allCars.filter(
    (c) =>
      (!onlyShort || c.short) &&
      (!onlyUnbuilt || unbuilt(c)) &&
      (!filter.optionType || c.optionType === filter.optionType) &&
      (!filter.day || carDay(c) === filter.day) &&
      (!filter.status || DOORS.some((d) => c.doors[d]?.status === filter.status)) &&
      (!q || carText(c).includes(q)),
  );
  const filterActive = Object.values(filter).some(Boolean) || q !== '' || onlyShort || onlyUnbuilt;
  // Hodnoty do filtrů z celé matice (číselně seřazené).
  const options = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const carOptions = {
    optionType: options(allCars.map((c) => c.optionType)),
    day: [...new Set(allCars.map(carDay))].sort((a, b) => (a === NO_DAY ? -1 : b === NO_DAY ? 1 : Number(a) - Number(b))),
    status: [...new Set(allCars.flatMap((c) => DOORS.flatMap((d) => c.doors[d]?.status ?? [])))].sort((a, b) => (statusCode(a) ?? 0) - (statusCode(b) ?? 0) || a.localeCompare(b)),
  };
  const filterLabel = (key: keyof CarFilter, value: string) => (key === 'day' ? (value === NO_DAY ? ts.filters.noDate : dayLabel(Number(value))) : value);

  // První nepokryté dveře v pořadí stavby.
  const firstShort = (() => {
    for (const car of allCars) for (const door of DOORS) if (car.doors[door]?.state === 'short') return { car, cell: car.doors[door]! };
    return null;
  })();
  const shortDoors = allCars.reduce((n, c) => n + DOORS.filter((d) => c.doors[d]?.state === 'short').length, 0);

  /** Datum a čas do Excelu: „2026-11-04 16:15“ (řadí se správně i jako text). */
  const isoTime = (st: Stamp | null) => {
    if (st === null) return null;
    const day = dayOfStamp(st);
    const minute = st - day * MINUTES_PER_DAY;
    return `${dayToIso(day)} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  };
  // Excel: prioritní seznam chybějících MC a MF podle data, chybějící dveře a Matrix (podle filtrů).
  const exportExcel = () => {
    const te = ts.export;
    const tm = ts.matrix;
    const list = shortages(coverage.parts);
    void downloadXlsxSheets(`${te.fileName}_${dayToIso(today)}.xlsx`, [
      {
        name: te.priority,
        header: [te.order, te.shortFrom, tm.productionNumber, te.door, te.kind, te.item, te.description, te.stock, te.demand, te.missing, te.lastShort],
        rows: list.map((s, i) => {
          const first = s.part.firstShort!;
          return [i + 1, isoTime(first.planned), first.productionNumber, first.door, ts.kinds[s.part.kind], s.part.item, s.part.description, s.part.stock, s.part.total, s.missing, isoTime(s.demands.at(-1)!.planned)];
        }),
        stickyColumns: 2,
      },
      {
        name: te.missingDoors,
        header: [tm.planned, tm.lot, tm.productionNumber, te.door, te.kind, te.item, te.description, te.status, te.missing],
        rows: list
          .flatMap((s) => s.demands.map((d) => ({ s, d })))
          .sort((x, y) => (x.d.planned ?? -Infinity) - (y.d.planned ?? -Infinity) || x.d.productionNumber.localeCompare(y.d.productionNumber))
          .map(({ s, d }) => [isoTime(d.planned), d.lot, d.productionNumber, d.door, ts.kinds[s.part.kind], s.part.item, s.part.description, d.status, d.missing]),
        stickyColumns: 1,
      },
      {
        name: te.matrix,
        header: [tm.lot, tm.productionNumber, tm.optionType, tm.colors, tm.planned, ...DOORS.map((d) => `${tm.status} ${d}`), tm.material],
        rows: cars.map((c) => {
          const undetermined = undeterminedText(c);
          const material = [missingByDoor(c).join(' · '), undetermined && `${tm.undetermined}: ${undetermined}`].filter(Boolean).join(' · ');
          return [c.lot, c.productionNumber, c.optionType, c.colors, isoTime(c.planned), ...DOORS.map((d) => c.doors[d]?.status ?? null), material || null];
        }),
        stickyColumns: 2,
      },
      {
        name: te.missingKeys,
        header: [te.kind, te.door, te.keyType, te.colour, te.doors, te.firstBuild],
        rows: missingKeys(coverage.cars).map((m) => [ts.kinds[m.kind], m.door, m.optionType, m.colour, m.doors, isoTime(m.first)]),
        stickyColumns: 0,
      },
    ]);
  };

  const fileName = (path: string | undefined) => path?.split('/').pop() ?? '—';
  const lq = locationQuery.trim().toUpperCase();
  const shownLocations = locations.filter((l) => !lq || `${l.location} ${l.zone}`.includes(lq));

  return (
    <>
      <p className="muted">
        {ts.sources
          .replace('{matrix}', fileName(sequence?.matrix?.path))
          .replace('{key}', fileName(sequence?.key?.path))
          .replace('{jit}', fileName(sequence?.jit?.path))
          .replace('{stock}', fileName(data?.stock?.path))}
      </p>
      {!data?.stock && <p className="banner banner-warn">{ts.noStock}</p>}
      {data?.stock && (
        <details className="panel mat-locations">
          <summary>
            {ts.locations.summary
              .replace('{mc}', qty(locationsByKind.MC.filter((l) => excludedAll.MC.has(l.location)).length))
              .replace('{mf}', qty(locationsByKind.MF.filter((l) => excludedAll.MF.has(l.location)).length))}
          </summary>
          <p className="muted">{ts.locations.hint.replace('{zones}', STOCK_ZONES.join(', '))}</p>
          <div className="segmented" role="group" aria-label={ts.locations.kind}>
            {PART_KINDS.map((kind) => (
              <button key={kind} type="button" aria-pressed={locationKind === kind} onClick={() => setLocationKind(kind)}>
                {ts.kinds[kind]}
              </button>
            ))}
          </div>
          <p className="muted">
            {ts.locations.kindSummary
              .replace('{kind}', ts.kinds[locationKind])
              .replace('{n}', qty(locations.filter((l) => excluded.has(l.location)).length))
              .replace('{total}', qty(locations.length))
              .replace('{qty}', qty(locations.filter((l) => excluded.has(l.location)).reduce((sum, l) => sum + l.qty, 0)))}
          </p>
          {locations.length === 0 ? (
            <p className="muted">{ts.locations.none}</p>
          ) : (
            <>
              <div className="filters">
                <label className="field">
                  <span>{ts.locations.search}</span>
                  <input type="search" value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)} />
                </label>
                <button type="button" className="button button-small" onClick={() => updateExcluded(new Set([...excluded, ...shownLocations.map((l) => l.location)]))}>
                  {ts.locations.excludeShown}
                </button>
                <button type="button" className="button button-small" onClick={() => updateExcluded(new Set([...excluded].filter((l) => !shownLocations.some((s) => s.location === l))))}>
                  {ts.locations.includeShown}
                </button>
              </div>
              <div className="table-scroll mat-locations-list">
                <table className="table table-data">
                  <thead>
                    <tr>
                      <th>{ts.locations.exclude}</th>
                      <th>{ts.locations.location}</th>
                      <th>{ts.locations.zone}</th>
                      <th className="n">{ts.locations.qty}</th>
                      <th className="n">{ts.locations.items}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownLocations.map((l) => (
                      <tr key={l.location} className={excluded.has(l.location) ? 'row-muted' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${ts.locations.exclude} ${l.location}`}
                            checked={excluded.has(l.location)}
                            onChange={(e) => {
                              const next = new Set(excluded);
                              if (e.target.checked) next.add(l.location);
                              else next.delete(l.location);
                              updateExcluded(next);
                            }}
                          />
                        </td>
                        <td>
                          <strong>{l.location}</strong>
                        </td>
                        <td>{l.zone}</td>
                        <td className="n">{qty(l.qty)}</td>
                        <td className="n">{qty(l.items)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </details>
      )}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.cars}</span>
          <span className="kpi-value">{qty(allCars.length)}</span>
          <span className="kpi-note">{ts.tiles.carsNote.replace('{doors}', qty(coverage.doors)).replace('{done}', qty(coverage.skippedDone))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.undetermined}</span>
          <span className="kpi-value mat-undetermined">{qty(coverage.unknownByKind.MC + coverage.unknownByKind.MF)}</span>
          <span className="kpi-note">
            {ts.tiles.undeterminedNote
              .replace('{mc}', qty(coverage.unknownByKind.MC))
              .replace('{mf}', qty(coverage.unknownByKind.MF))
              .replace('{combos}', qty(missingKeys(coverage.cars).length))}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.short}</span>
          <span className={`kpi-value${shortDoors ? ' cell-short' : ''}`}>{qty(shortDoors)}</span>
          <span className="kpi-note">
            {ts.tiles.shortParts
              .replace('{mc}', qty(coverage.parts.filter((p) => p.kind === 'MC' && p.firstShort).length))
              .replace('{mf}', qty(coverage.parts.filter((p) => p.kind === 'MF' && p.firstShort).length))}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.first}</span>
          <span className="kpi-value mat-kpi-small">{firstShort ? time(firstShort.car.planned) : ts.tiles.none}</span>
          <span className="kpi-note">
            {firstShort
              ? `${firstShort.car.productionNumber} ${firstShort.cell.door} · ${firstShort.cell.parts
                  .filter((p) => p.left < -1e-9)
                  .map((p) => p.item)
                  .join(', ')}`
              : ''}
          </span>
        </div>
      </div>

      <div className="filters" role="group" aria-label={ts.filters.label}>
        <label className="field field-wide">
          <span>{ts.filters.search}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
          {ts.filters.onlyShort}
        </label>
        <label className="check-field">
          <input type="checkbox" checked={onlyUnbuilt} onChange={(e) => setOnlyUnbuilt(e.target.checked)} />
          {ts.filters.onlyUnbuilt}
        </label>
        {(
          [
            ['optionType', ts.matrix.optionType],
            ['day', ts.filters.day],
            ['status', ts.filters.status],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <select value={filter[key]} onChange={(e) => setFilter({ ...filter, [key]: e.target.value })}>
              <option value="">{ts.filters.all}</option>
              {carOptions[key].map((v) => (
                <option key={v} value={v}>
                  {filterLabel(key, v)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <span className="filters-break" role="presentation" />
        <button type="button" className="button button-small" onClick={exportExcel}>
          ⤓ {ts.export.button}
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{ts.matrix.heading}</h2>
          <span className="muted">{ts.matrix.sub}</span>
          {filterActive && (
            <span className="panel-actions">
              <span className="muted">{ts.filters.shown.replace('{n}', qty(cars.length)).replace('{total}', qty(allCars.length))}</span>
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  setFilter(NO_FILTER);
                  setQuery('');
                  setOnlyShort(false);
                  setOnlyUnbuilt(false);
                }}
              >
                {ts.filters.reset}
              </button>
            </span>
          )}
        </div>
        {cars.length === 0 ? (
          <p className="muted">{ts.matrix.empty}</p>
        ) : (
          <div className="table-scroll table-tall">
            <table className="table table-data mat-matrix">
              <thead>
                <tr>
                  <th>{ts.matrix.lot}</th>
                  <th className="sticky-col">{ts.matrix.productionNumber}</th>
                  <th>{ts.matrix.optionType}</th>
                  <th>{ts.matrix.colors}</th>
                  <th>{ts.matrix.planned}</th>
                  {DOORS.map((d) => (
                    <th key={d}>
                      {ts.matrix.status} {d}
                    </th>
                  ))}
                  <th>{ts.matrix.material}</th>
                </tr>
              </thead>
              <tbody>
                {cars.map((c) => (
                  <CarRow key={c.productionNumber} car={c} time={time} title={doorTitle} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="cov-legend">
          {STATUS_COLORS.map((code) => (
            <li key={code}>
              <i className={`swatch mat-s${code}`} /> {ts.matrix.statuses[code as keyof typeof ts.matrix.statuses]}
            </li>
          ))}
        </ul>
        <ul className="cov-legend">
          <li>
            <i className="mat-badge mat-badge-ok">MC</i> {ts.matrix.legendOk}
          </li>
          <li>
            <i className="mat-badge mat-badge-short">MF</i> {ts.matrix.legendShort}
          </li>
          <li>
            <i className="mat-badge mat-badge-unknown">MC</i> {ts.matrix.legendUnknown}
          </li>
          <li>{ts.matrix.legendDone}</li>
        </ul>
        <p className="muted">{ts.matrix.note}</p>
      </div>
    </>
  );
}

/** Řádek vozu jako v Order Status Matrix: stav dveří v barvě matice se štítky MC a MF, vpravo chybějící díly. */
function CarRow({ car, time, title }: { car: CarCoverage; time: (s: Stamp | null) => string; title: (cell: DoorCoverage) => string }) {
  const { t } = useI18n();
  const tm = t.sequence.matrix;
  const missing = missingByDoor(car);
  const undetermined = undeterminedText(car);
  const counted = DOORS.some((d) => car.doors[d]?.parts.length);
  return (
    <tr className={car.short ? 'mat-car-short' : undefined}>
      <td>{car.lot}</td>
      <td className="sticky-col">
        <strong>{car.productionNumber}</strong>
      </td>
      <td>{car.optionType}</td>
      <td>{car.colors}</td>
      <td>{time(car.planned)}</td>
      {DOORS.map((d) => {
        const cell = car.doors[d];
        if (!cell) return <td key={d} />;
        return (
          <td key={d} className={`mat-door${statusClass(cell.status)}`} title={title(cell)}>
            <span className="mat-door-in">
              <span>{cell.status}</span>
              <DoorBadges cell={cell} />
            </span>
          </td>
        );
      })}
      <td className="mat-missing">
        {missing.length > 0 && (
          <span className="cell-short">
            {missing.map((text, i) => (
              <Fragment key={text}>
                {i > 0 && ' · '}
                <span className="mat-missing-door">{text}</span>
              </Fragment>
            ))}
          </span>
        )}
        {missing.length === 0 && !undetermined && counted && <span className="mat-all">{tm.allInStock}</span>}
        {undetermined && (
          <span className="mat-undetermined">
            {missing.length > 0 ? ' · ' : ''}
            {tm.undetermined}: {undetermined}
          </span>
        )}
      </td>
    </tr>
  );
}

/** Štítky MC a MF v buňce dveří: zelený na skladě, červený chybí, šedý neurčený (není v klíči ani v JIT). */
function DoorBadges({ cell }: { cell: DoorCoverage }) {
  if (cell.state === 'none' || cell.state === 'skipped') return null;
  return (
    <span className="mat-badges">
      {PART_KINDS.map((kind) => {
        const parts = cell.parts.filter((p) => p.kind === kind);
        const state = parts.length ? (parts.some((p) => p.left < -1e-9) ? 'short' : 'ok') : cell.unknown.includes(kind) ? 'unknown' : null;
        return (
          state && (
            <i key={kind} className={`mat-badge mat-badge-${state}`}>
              {kind}
            </i>
          )
        );
      })}
    </span>
  );
}
