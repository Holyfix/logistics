import { Fragment, useMemo, useState } from 'react';
import { mergeBoms } from '../../core/bom';
import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatQuantity } from '../../core/format';
import { buildMaterialCoverage, carMissing, shortages, type CarCoverage, type DoorCoverage } from '../../core/material/coverage';
import { dayOfStamp, DOORS, MINUTES_PER_DAY, type Door, type Stamp } from '../../core/material/jit';
import { statusCode } from '../../core/material/matrix';
import { stockByItem } from '../../core/stock';
import { useI18n } from '../../i18n/I18nProvider';
import { downloadXlsxSheets } from '../../platform/download';
import { useData } from '../data/DataProvider';

/** Filtry Matrixu: hodnota sloupce ('' = vše). */
interface CarFilter {
  lot: string;
  optionType: string;
  colors: string;
  day: string;
  status: string;
}
const NO_FILTER: CarFilter = { lot: '', optionType: '', colors: '', day: '', status: '' };
const NO_DAY = 'none';

/** Den stavby vozu pro filtr ('none' = bez data). */
const carDay = (c: CarCoverage) => (c.planned === null ? NO_DAY : String(dayOfStamp(c.planned)));

/** Barva stavu jako v Order Status Matrix (podle čísla stavu). */
const STATUS_COLORS = [20, 25, 30, 40, 45, 50, 60];
const statusClass = (status: string) => {
  const code = statusCode(status);
  return code !== null && STATUS_COLORS.includes(code) ? ` mat-s${code}` : '';
};

/** Chybějící MF vozu po dveřích, např. „FL: 456“. */
function missingByDoor(car: CarCoverage): string[] {
  const doors = new Map<Door, string[]>();
  for (const m of carMissing(car)) (doors.get(m.door) ?? doors.set(m.door, []).get(m.door)!).push(m.item);
  return [...doors].map(([door, parts]) => `${door}: ${parts.join(', ')}`);
}

/**
 * Sekvence (karta v Komponentách): pokrytí Middlefieldu ve formátu Order Status Matrix. Vozy a stav dveří z matice,
 * dveřní panel z JIT Overview (složka Sekvence), MF z načtených kusovníků a sklad z načteného souboru skladu.
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

  const coverage = useMemo(() => {
    if (!sequence?.matrix || !sequence.jit || !data?.boms.length) return null;
    return buildMaterialCoverage({
      matrix: sequence.matrix.orders,
      positions: sequence.jit.positions,
      bom: mergeBoms(data.boms.map((b) => b.data)),
      stock: data.stock ? stockByItem(data.stock.data) : new Map(),
      today,
    });
  }, [sequence, data, today]);

  if (!coverage) {
    return (
      <div className="panel">
        <p>{ts.noFiles}</p>
        {sequence && !sequence.matrix && <p className="banner banner-warn">{ts.needMatrix}</p>}
        {sequence && !sequence.jit && <p className="banner banner-warn">{ts.needJit}</p>}
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
    [cell.panel ? `${ts.matrix.panel}: ${cell.panel}` : ts.matrix.notInJit, ...cell.parts.map((p) => `MF ${p.item}: ${ts.matrix.left} ${qty(p.left)}`)].join('\n');

  const q = query.trim().toLowerCase();
  const allCars = coverage.cars;
  const carText = (c: CarCoverage) => [c.productionNumber, c.lot, ...DOORS.flatMap((d) => c.doors[d]?.parts.map((p) => p.item) ?? [])].join(' ').toLowerCase();
  const cars = allCars.filter(
    (c) =>
      (!onlyShort || c.short) &&
      (!filter.lot || c.lot === filter.lot) &&
      (!filter.optionType || c.optionType === filter.optionType) &&
      (!filter.colors || c.colors === filter.colors) &&
      (!filter.day || carDay(c) === filter.day) &&
      (!filter.status || DOORS.some((d) => c.doors[d]?.status === filter.status)) &&
      (!q || carText(c).includes(q)),
  );
  const filterActive = Object.values(filter).some(Boolean) || q !== '' || onlyShort;
  // Hodnoty do filtrů z celé matice (číselně seřazené).
  const options = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const carOptions = {
    lot: options(allCars.map((c) => c.lot)),
    optionType: options(allCars.map((c) => c.optionType)),
    colors: options(allCars.map((c) => c.colors)),
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
  // Excel: prioritní seznam chybějících MF podle data, chybějící dveře a Matrix (podle filtrů).
  const exportExcel = () => {
    const te = ts.export;
    const tm = ts.matrix;
    const list = shortages(coverage.parts);
    void downloadXlsxSheets(`${te.fileName}_${dayToIso(today)}.xlsx`, [
      {
        name: te.priority,
        header: [te.order, te.shortFrom, tm.productionNumber, te.door, te.item, te.description, te.stock, te.demand, te.missing, te.lastShort],
        rows: list.map((s, i) => {
          const first = s.part.firstShort!;
          return [i + 1, isoTime(first.planned), first.productionNumber, first.door, s.part.item, s.part.description, s.part.stock, s.part.total, s.missing, isoTime(s.demands.at(-1)!.planned)];
        }),
        stickyColumns: 2,
      },
      {
        name: te.missingDoors,
        header: [tm.planned, tm.lot, tm.productionNumber, te.door, te.item, te.description, te.status, te.missing],
        rows: list
          .flatMap((s) => s.demands.map((d) => ({ s, d })))
          .sort((x, y) => (x.d.planned ?? -Infinity) - (y.d.planned ?? -Infinity) || x.d.productionNumber.localeCompare(y.d.productionNumber))
          .map(({ s, d }) => [isoTime(d.planned), d.lot, d.productionNumber, d.door, s.part.item, s.part.description, d.status, d.missing]),
        stickyColumns: 1,
      },
      {
        name: te.matrix,
        header: [tm.lot, tm.productionNumber, tm.optionType, tm.colors, tm.planned, ...DOORS.map((d) => `${tm.status} ${d}`), tm.material],
        rows: cars.map((c) => [c.lot, c.productionNumber, c.optionType, c.colors, isoTime(c.planned), ...DOORS.map((d) => c.doors[d]?.status ?? null), missingByDoor(c).join(' · ') || null]),
        stickyColumns: 2,
      },
    ]);
  };

  const fileName = (path: string | undefined) => path?.split('/').pop() ?? '—';

  return (
    <>
      <p className="muted">
        {ts.sources
          .replace('{matrix}', fileName(sequence?.matrix?.path))
          .replace('{jit}', fileName(sequence?.jit?.path))
          .replace('{stock}', fileName(data?.stock?.path))}
      </p>
      {!data?.stock && <p className="banner banner-warn">{ts.noStock}</p>}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.cars}</span>
          <span className="kpi-value">{qty(allCars.length)}</span>
          <span className="kpi-note">{ts.tiles.carsNote.replace('{doors}', qty(coverage.doors)).replace('{done}', qty(coverage.skippedDone))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.known}</span>
          <span className="kpi-value">{qty(coverage.known)}</span>
          <span className="kpi-note">{ts.tiles.knownNote.replace('{n}', qty(coverage.unknown))}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{ts.tiles.short}</span>
          <span className={`kpi-value${shortDoors ? ' cell-short' : ''}`}>{qty(shortDoors)}</span>
          <span className="kpi-note">{ts.tiles.shortParts.replace('{n}', qty(coverage.parts.filter((p) => p.firstShort).length))}</span>
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
        {(
          [
            ['lot', ts.matrix.lot],
            ['optionType', ts.matrix.optionType],
            ['colors', ts.matrix.colors],
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
            <i className="mat-badge mat-badge-ok">MF</i> {ts.matrix.legendOk}
          </li>
          <li>
            <i className="mat-badge mat-badge-short">MF</i> {ts.matrix.legendShort}
          </li>
          <li>
            <i className="mat-badge mat-badge-unknown">MF</i> {ts.matrix.legendUnknown}
          </li>
          <li>{ts.matrix.legendDone}</li>
        </ul>
        <p className="muted">{ts.matrix.note}</p>
      </div>
    </>
  );
}

/** Řádek vozu jako v Order Status Matrix: stav dveří v barvě matice se štítkem MF, vpravo chybějící MF. */
function CarRow({ car, time, title }: { car: CarCoverage; time: (s: Stamp | null) => string; title: (cell: DoorCoverage) => string }) {
  const { t } = useI18n();
  const tm = t.sequence.matrix;
  const missing = missingByDoor(car);
  const unknown = DOORS.filter((d) => car.doors[d]?.state === 'unknown');
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
              <DoorBadge cell={cell} />
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
        {missing.length === 0 && counted && <span className="mat-all">{tm.allInStock}</span>}
        {unknown.length > 0 && (
          <span className="muted">
            {missing.length > 0 || counted ? ' · ' : ''}
            {tm.notInJit}
            {unknown.length < DOORS.filter((d) => car.doors[d] && d !== 'HB').length ? `: ${unknown.join(', ')}` : ''}
          </span>
        )}
      </td>
    </tr>
  );
}

/** Štítek MF v buňce dveří: zelený na skladě, červený chybí, šedý neznámý (dveře nejsou v JIT). */
function DoorBadge({ cell }: { cell: DoorCoverage }) {
  if (cell.state === 'none' || cell.state === 'skipped') return null;
  return (
    <span className="mat-badges">
      <i className={`mat-badge mat-badge-${cell.state}`}>MF</i>
    </span>
  );
}
