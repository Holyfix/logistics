import { dayToIso, weekday } from '../../core/dates';
import { formatDayShort, formatOneDecimal, formatQuantity, type Locale } from '../../core/format';
import type { DailyBar, KpiDef, ParetoBar } from '../../core/kpi';
import { useI18n } from '../../i18n/I18nProvider';

const W = 260;
const H = 200;
const M = { left: 30, right: 30, top: 14, bottom: 78 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const LABEL_MAX = 22;

const short = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);
const formatValue = (value: number, locale: Locale) => (Number.isInteger(value) ? formatQuantity(value, locale) : formatOneDecimal(value, locale));

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

/** Denní sloupce ukazatele obarvené podle stavu, přerušovaná čára = cíl. */
export function DailyChart({ def, bars, label }: { def: KpiDef; bars: DailyBar[]; label: string }) {
  const { t, locale } = useI18n();
  const tc = t.kpi.charts;
  if (!bars.length) return <p className="kpi-chart-empty muted">{tc.dailyEmpty}</p>;

  const max = Math.max(...bars.map((b) => b.value), def.target, 1);
  const step = PLOT_W / bars.length;
  const barW = Math.min(26, step * 0.7);
  const x = (k: number) => M.left + step * k + step / 2;
  const y = (v: number) => M.top + PLOT_H - (Math.max(0, v) / max) * PLOT_H;
  const dayText = (d: number) => `${t.calloffs.weekdays[weekday(d) - 1]} ${formatDayShort(dayToIso(d), locale)}`;

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
        {bars.map((b, k) => (
          <g key={b.day}>
            <title>{`${dayText(b.day)}: ${formatValue(b.value, locale)}${def.unit ? ` ${def.unit}` : ''} – ${t.kpi.legend[b.status]}`}</title>
            <rect className={`kpi-chart-bar kpi-${b.status}`} x={x(k) - barW / 2} y={y(b.value)} width={barW} height={Math.max(1, M.top + PLOT_H - y(b.value))} rx={2} />
            <text className="kpi-chart-value" x={x(k)} y={y(b.value) - 3} textAnchor="middle">
              {formatValue(b.value, locale)}
            </text>
            <text className="kpi-chart-label" transform={`translate(${x(k) + 3},${M.top + PLOT_H + 8}) rotate(-40)`} textAnchor="end">
              {dayText(b.day)}
            </text>
          </g>
        ))}
        <line className="kpi-chart-target" x1={M.left} x2={W - M.right} y1={y(def.target)} y2={y(def.target)} />
      </svg>
      <figcaption className="kpi-chart-legend">
        <span>
          <i className="kpi-chart-legend-target" /> {tc.legendTarget.replace('{target}', formatValue(def.target, locale))}
          {def.unit && ` ${def.unit}`}
        </span>
      </figcaption>
    </figure>
  );
}
