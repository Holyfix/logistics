import type { ParetoBar } from '../../core/kpi';
import { useI18n } from '../../i18n/I18nProvider';

const W = 260;
const H = 200;
const M = { left: 24, right: 30, top: 14, bottom: 78 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const LABEL_MAX = 22;

const short = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);

/** Paretův graf: sloupce sestupně (levá osa počet), čára kumulativního podílu (pravá osa %) a hranice 80 %. */
export function ParetoChart({ bars, label }: { bars: ParetoBar[]; label: string }) {
  const { t } = useI18n();
  const tp = t.kpi.pareto;
  if (!bars.length) return <p className="kpi-chart-empty muted">{tp.empty}</p>;

  const max = Math.max(...bars.map((b) => b.value));
  const step = PLOT_W / bars.length;
  const barW = Math.min(36, step * 0.7);
  const x = (k: number) => M.left + step * k + step / 2;
  const y = (v: number) => M.top + PLOT_H - (v / max) * PLOT_H;
  const yShare = (share: number) => M.top + PLOT_H - share * PLOT_H;
  const ticks = max > 1 ? [0, Math.round(max / 2), max] : [0, max];
  const line = bars.map((b, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${yShare(b.cumulative).toFixed(1)}`).join(' ');
  const kinds = new Set(bars.map((b) => b.kind));
  const title = (b: ParetoBar) =>
    (b.kind === 'events' ? tp.events : tp.days)
      .replace('{label}', b.label)
      .replace('{value}', String(b.value))
      .replace('{share}', String(Math.round(b.cumulative * 100)));

  return (
    <figure className="kpi-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="kpi-chart-grid" x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} />
            <text className="kpi-chart-axis" x={M.left - 4} y={y(v) + 3} textAnchor="end">
              {v}
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
            <rect className={`kpi-chart-bar kpi-chart-${b.kind}`} x={x(k) - barW / 2} y={y(b.value)} width={barW} height={M.top + PLOT_H - y(b.value)} rx={2} />
            <text className="kpi-chart-value" x={x(k)} y={y(b.value) - 3} textAnchor="middle">
              {b.value}
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
        {kinds.has('events') && (
          <span>
            <i className="kpi-swatch kpi-chart-events" /> {tp.legendEvents}
          </span>
        )}
        {kinds.has('days') && (
          <span>
            <i className="kpi-swatch kpi-chart-days" /> {tp.legendDays}
          </span>
        )}
        <span>
          <i className="kpi-chart-legend-line" /> {tp.legendCumulative}
        </span>
      </figcaption>
    </figure>
  );
}
