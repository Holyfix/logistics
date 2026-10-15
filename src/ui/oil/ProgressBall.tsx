import type { Progress } from '../../core/oil';

/** Kolečko plnění (Harvey ball): výseč podle procent, barva podle kroku (25 % červená … 100 % zelená). */
export function ProgressBall({ progress }: { progress: Progress }) {
  const r = 9;
  const c = 11;
  const f = progress / 100;
  const angle = 2 * Math.PI * f;
  const x = c + r * Math.sin(angle);
  const y = c - r * Math.cos(angle);
  return (
    <svg className={`oil-ball step-${progress}`} width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx={c} cy={c} r={r} className="oil-ball-ring" />
      {f >= 1 ? <circle cx={c} cy={c} r={r} className="oil-ball-fill" /> : f > 0 && <path d={`M${c} ${c} L${c} ${c - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y} Z`} className="oil-ball-fill" />}
    </svg>
  );
}
