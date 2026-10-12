// Jednoduchý sloupcový graf s čárou (např. požadavek a odeslané množství po týdnech).

const W = 900;
const H = 260;
const M = { left: 62, right: 12, top: 26, bottom: 30 };

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

interface Props {
  label: string;
  categories: string[];
  bars: number[];
  line: (number | null)[];
  barName: string;
  lineName: string;
  format: (value: number) => string;
  /** Zvýrazněná oblast od indexu do konce (např. výhled). */
  region?: { from: number; label: string };
}

export function BarLineChart({ label, categories, bars, line, barName, lineName, format, region }: Props) {
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const known = line.filter((v): v is number => v !== null);
  const max0 = Math.max(1, ...bars, ...known);
  const step = niceStep(max0 / 4);
  const max = Math.ceil(max0 / step) * step;
  const y = (v: number) => M.top + ih - (v / max) * ih;
  const bw = iw / Math.max(1, categories.length);
  const labelEvery = Math.ceil(categories.length / 18);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);

  const points = line.flatMap((v, i) => (v === null ? [] : [`${M.left + i * bw + bw / 2},${y(v)}`]));

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {region && region.from < categories.length && (
        <g>
          <rect x={M.left + region.from * bw} y={M.top - 20} width={(categories.length - region.from) * bw} height={ih + 20} className="chart-region" />
          <text x={M.left + region.from * bw + 6} y={M.top - 7} className="chart-axis">
            {region.label}
          </text>
        </g>
      )}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'chart-baseline' : 'chart-grid'} />
          <text x={M.left - 8} y={y(v) + 4} textAnchor="end" className="chart-axis">
            {format(v)}
          </text>
        </g>
      ))}
      {bars.map((v, i) => {
        const w = Math.max(2, bw * 0.6);
        return v > 0 ? <rect key={i} x={M.left + i * bw + (bw - w) / 2} y={y(v)} width={w} height={y(0) - y(v)} rx={Math.min(3, w / 2)} className="chart-bar" /> : null;
      })}
      {points.length > 1 && <polyline points={points.join(' ')} className="chart-line" />}
      {line.map((v, i) => (v === null ? null : <circle key={i} cx={M.left + i * bw + bw / 2} cy={y(v)} r={3} className="chart-dot" />))}
      {categories.map((c, i) =>
        i % labelEvery === 0 ? (
          <text key={c} x={M.left + i * bw + bw / 2} y={H - 10} textAnchor="middle" className="chart-axis">
            {c}
          </text>
        ) : null,
      )}
      {categories.map((c, i) => (
        <rect key={`hit-${c}`} x={M.left + i * bw} y={M.top - 20} width={bw} height={ih + 20} fill="transparent">
          <title>{[c, `${barName}: ${format(bars[i]!)}`, ...(line[i] == null ? [] : [`${lineName}: ${format(line[i])}`])].join('\n')}</title>
        </rect>
      ))}
    </svg>
  );
}
