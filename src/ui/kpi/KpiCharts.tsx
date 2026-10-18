import { dayToIso, weekday, type DayNumber } from '../../core/dates';
import { formatDayShort, formatOneDecimal, formatQuantity, type Locale } from '../../core/format';
import { kpiStatus, kpiValue, letterStatus, type KpiData, type KpiDef, type KpiEntry, type Letter, type ParetoBar } from '../../core/kpi';
import type { Messages } from '../../i18n/cs';
import { useI18n } from '../../i18n/I18nProvider';

const W = 260;
const H = 200;
const M = { left: 30, right: 30, top: 14, bottom: 78 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const LABEL_MAX = 22;

const short = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);
export const formatValue = (value: number, locale: Locale) => (Number.isInteger(value) ? formatQuantity(value, locale) : formatOneDecimal(value, locale));

/** Osa hodnot: 0, polovina a maximum (celá čísla, když to jde). */
function ticksOf(max: number): number[] {
  const half = max / 2;
  return Number.isInteger(half) || max > 10 ? [0, Math.round(half), max] : [0, max];
}

/** Paretův graf: sloupce sestupně (levá osa počet), čára kumulativního podílu (pravá osa %) a hranice 80 %. */
export function ParetoChart({ bars, label }: { bars: ParetoBar[]; label: string }) {
  const { t, locale } = useI18n();
  const tp = t.kpi.charts;
  if (!bars.length) return <p className="kpi-chart-empty muted">{tp.paretoEmpty}</p>;

  const max = Math.max(...bars.map((b) => b.value));
  const step = PLOT_W / bars.length;
  const barW = Math.min(36, step * 0.7);
  const x = (k: number) => M.left + step * k + step / 2;
  const y = (v: number) => M.top + PLOT_H - (v / max) * PLOT_H;
  const yShare = (share: number) => M.top + PLOT_H - share * PLOT_H;
  const line = bars.map((b, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${yShare(b.cumulative).toFixed(1)}`).join(' ');
  const title = (b: ParetoBar) => tp.paretoTitle.replace('{label}', b.label).replace('{value}', formatValue(b.value, locale)).replace('{share}', String(Math.round(b.cumulative * 100)));

  return (
    <figure className="kpi-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticksOf(max).map((v) => (
          <g key={v}>
            <line className="kpi-chart-grid" x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} />
            <text className="kpi-chart-axis" x={M.left - 4} y={y(v) + 3} textAnchor="end">
              {formatValue(v, locale)}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((share) => (
          <text key={share} className="kpi-chart-axis" x={W - M.right + 4} y={yShare(share) + 3}>
            {share * 100} %
          </text>
        ))}
        <line className="kpi-chart-80" x1={M.left} x2={W - M.right} y1={yShare(0.8)} y2={yShare(0.8)} />
        {bars.map((b, k) => (
          <g key={b.key}>
            <title>{title(b)}</title>
            <rect className="kpi-chart-bar kpi-chart-events" x={x(k) - barW / 2} y={y(b.value)} width={barW} height={M.top + PLOT_H - y(b.value)} rx={2} />
            <text className="kpi-chart-value" x={x(k)} y={y(b.value) - 3} textAnchor="middle">
              {formatValue(b.value, locale)}
            </text>
            <text className="kpi-chart-label" transform={`translate(${x(k) + 3},${M.top + PLOT_H + 8}) rotate(-40)`} textAnchor="end">
              {short(b.label)}
            </text>
          </g>
        ))}
        <path className="kpi-chart-line" d={line} />
        {bars.map((b, k) => (
          <circle key={b.key} className="kpi-chart-dot" cx={x(k)} cy={yShare(b.cumulative)} r={2.5} />
        ))}
      </svg>
      <figcaption className="kpi-chart-legend">
        <span>
          <i className="kpi-swatch kpi-chart-events" /> {tp.legendEvents}
        </span>
        <span>
          <i className="kpi-chart-legend-line" /> {tp.legendCumulative}
        </span>
      </figcaption>
    </figure>
  );
}

/** Cíl a červená hranice ukazatele jako text („≤ 0 · červená nad 10“). */
export function targetText(def: KpiDef, texts: Messages['kpi']['targetText']): string {
  const target = (def.higherIsBetter ? texts.higher : texts.lower).replace('{target}', String(def.target));
  const red = def.red === null ? texts.warnOnly : (def.higherIsBetter ? texts.redHigher : texts.redLower).replace('{red}', String(def.red));
  return `${target} · ${red}`;
}

/** Hodnota do úzkého políčka: tisíce zkráceně („4,1k“), celá hodnota je v popisku. */
function compactValue(value: number, locale: Locale): string {
  if (Math.abs(value) < 1000) return formatValue(value, locale);
  return `${formatValue(Math.round(value / 100) / 10, locale)}k`;
}

/** Popis ukazatelů písmene, které den obarvily (pro popisek dne v písmenu). */
export function dayIssues(kpi: KpiData, letter: Letter, entry: KpiEntry | undefined, texts: Messages['kpi'], locale: Locale): string[] {
  if (!entry) return [];
  return kpi.defs
    .filter((d) => d.letter === letter)
    .flatMap((def) => {
      const value = kpiValue(entry, def);
      if (value === null || kpiStatus(def, value) === 'green') return [];
      return [`• ${def.name}: ${formatValue(value, locale)}${def.unit ? ` ${def.unit}` : ''} (${targetText(def, texts.targetText)})`];
    });
}

/**
 * Všechny ukazatele písmene za poslední zapsané dny: řádek = ukazatel, políčko = den s hodnotou,
 * barva podle stavu. Klik na políčko otevře zápis dne.
 */
export function LetterDays({ kpi, letter, entries, onPick }: { kpi: KpiData; letter: Letter; entries: KpiEntry[]; onPick: (day: DayNumber) => void }) {
  const { t, locale } = useI18n();
  const tk = t.kpi;
  const defs = kpi.defs.filter((d) => d.letter === letter);
  if (!defs.length || !entries.length) return <p className="kpi-chart-empty muted">{tk.charts.dailyEmpty}</p>;

  const dayText = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${Number(dayToIso(d).slice(8))}.`;
  const dayLong = (d: DayNumber) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;
  const green = entries.filter((e) => letterStatus(kpi, letter, e) === 'green').length;
  const columns = { gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` };

  return (
    <div className="kpi-days">
      <div className="kpi-days-row kpi-days-head" style={columns}>
        {entries.map((e) => (
          <span key={e.day}>{dayText(e.day)}</span>
        ))}
      </div>
      {defs.map((def) => (
        <div key={def.id} className="kpi-days-kpi">
          <div className="kpi-days-name">
            {def.name}{' '}
            <small>
              {def.unit && `${def.unit} · `}
              {targetText(def, tk.targetText)}
            </small>
          </div>
          <div className="kpi-days-row" style={columns}>
            {entries.map((e) => {
              const value = kpiValue(e, def);
              const status = value === null ? null : kpiStatus(def, value);
              const title = `${dayLong(e.day)} – ${def.name}: ${value === null ? tk.charts.noValue : `${formatValue(value, locale)}${def.unit ? ` ${def.unit}` : ''} – ${tk.legend[status!]}`}`;
              return (
                <button key={e.day} type="button" className={`kpi-days-cell ${status ? `kpi-${status}` : 'kpi-missing'}`} title={title} aria-label={title} onClick={() => onPick(e.day)}>
                  {value === null ? '–' : compactValue(value, locale)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="kpi-caption">{tk.inTarget.replace('{green}', String(green)).replace('{days}', String(entries.length))}</p>
    </div>
  );
}
