/**
 * Ledger charts, custom SVG. Rules followed: one y-axis per panel (review minutes and
 * escapes are two aligned panels sharing the week axis, never a dual axis), thin marks,
 * recessive grid, direct labels, hover crosshair + tooltip, table view for each chart.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WeeklyMetric } from '../../../shared/dossier';
import { cx, fmtDate } from '../lib/util';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    // a transient zero (detached or mid-relayout) must not blank the chart
    const ro = new ResizeObserver(([e]) => {
      const next = Math.round(e.contentRect.width);
      if (next > 0) setW(next);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceMax = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step);
const wk = (iso: string) => fmtDate(iso);

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg bg-surface-2 px-2.5 py-2 text-xs shadow-pop"
      style={left ? { right: width - x + 12 } : { left: x + 12 }}
    >
      {children}
    </div>
  );
}

function TipRow({ swatch, label, value }: { swatch?: string; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {swatch && <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: swatch }} />}
      <span className="text-fg-2">{label}</span>
      <span className="num ml-auto pl-3 font-semibold text-fg">{value}</span>
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs text-fg-3">
      <summary className="inline-flex cursor-pointer rounded px-1 py-0.5 hover:text-fg">Show as table</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="num w-full border-collapse text-left">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="border-b border-line px-2 py-1 font-medium text-fg-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="border-b border-line px-2 py-1 text-fg-2">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Median review minutes (line) above escapes (bars): two panels, one shared week axis. */
export function ReviewVsEscapes({ weekly }: { weekly: WeeklyMetric[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const n = weekly.length;
  const m = { l: 34, r: 54, t: 14, b: 22 };
  const topH = 168;
  const gap = 30;
  const botH = 54;
  const H = m.t + topH + gap + botH + m.b;
  const iw = Math.max(10, width - m.l - m.r);
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yMax = niceMax(Math.max(...weekly.map((w) => w.medianReviewMinutes), 1), 10);
  const y = (v: number) => m.t + topH - (v / yMax) * topH;
  const eMax = Math.max(2, ...weekly.map((w) => w.escapes));
  const botTop = m.t + topH + gap;
  const ey = (v: number) => botTop + botH - (v / eMax) * botH;
  const bw = Math.max(4, Math.min(18, (iw / Math.max(1, n)) * 0.42));
  const path = weekly.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w.medianReviewMinutes).toFixed(1)}`).join('');
  const ticks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10);
  const every = n > 8 && width < 640 ? 3 : n > 8 ? 2 : 1;
  const first = weekly[0];
  const last = weekly[n - 1];
  const h = hover !== undefined ? weekly[hover] : undefined;
  const totalEsc = weekly.reduce((s, w) => s + w.escapes, 0);

  return (
    <div>
      <div
        ref={ref}
        className="relative"
        onMouseLeave={() => setHover(undefined)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1)))));
        }}
      >
        {width > 0 && n > 0 && (
          <svg width={width} height={H} role="img" aria-label={`Median review minutes per PR fell from ${first.medianReviewMinutes} to ${last.medianReviewMinutes} over ${n} weeks; escapes per week stayed at 0 or 1, ${totalEsc} in total.`}>
            {/* top panel: review minutes */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--fg-3)" className="num">
                  {t}
                </text>
              </g>
            ))}
            <text x={m.l} y={m.t - 4} fontSize="10.5" fill="var(--fg-3)">
              median review minutes per PR
            </text>
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {[0, n - 1].map((i) => (
              <circle key={i} cx={x(i)} cy={y(weekly[i].medianReviewMinutes)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
            ))}
            <text x={x(0) + 8} y={y(first.medianReviewMinutes) - 8} fontSize="11.5" fontWeight="600" fill="var(--fg)" className="num">
              {first.medianReviewMinutes} min
            </text>
            <text x={x(n - 1) + 9} y={y(last.medianReviewMinutes) + 4} fontSize="11.5" fontWeight="600" fill="var(--fg)" className="num">
              {last.medianReviewMinutes} min
            </text>

            {/* bottom panel: escapes */}
            <text x={m.l} y={botTop - 8} fontSize="10.5" fill="var(--fg-3)">
              escapes per week (reverts + incidents)
            </text>
            {[0, eMax].map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + iw} y1={ey(t)} y2={ey(t)} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'} />
                <text x={m.l - 8} y={ey(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--fg-3)" className="num">
                  {t}
                </text>
              </g>
            ))}
            {weekly.map((w, i) =>
              w.escapes > 0 ? (
                <g key={w.week}>
                  <path
                    d={`M${x(i) - bw / 2},${ey(0)} V${ey(w.escapes) + 3} q0,-3 3,-3 h${bw - 6} q3,0 3,3 V${ey(0)} Z`}
                    fill="var(--red)"
                  />
                  <text x={x(i)} y={ey(w.escapes) - 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--fg-2)" className="num">
                    {w.escapes}
                  </text>
                </g>
              ) : (
                <circle key={w.week} cx={x(i)} cy={ey(0)} r="1.5" fill="var(--fg-4)" />
              ),
            )}
            <text x={m.l + iw + 9} y={ey(0) + 3.5} fontSize="11.5" fontWeight="600" fill="var(--fg)" className="num">
              {totalEsc} total
            </text>

            {/* week axis */}
            {weekly.map((w, i) =>
              i % every === 0 || i === n - 1 ? (
                <text key={w.week} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--fg-3)" className="num">
                  {wk(w.week)}
                </text>
              ) : null,
            )}

            {hover !== undefined && h && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={botTop + botH} stroke="var(--line-strong)" />
                <circle cx={x(hover)} cy={y(h.medianReviewMinutes)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
              </g>
            )}
          </svg>
        )}
        {hover !== undefined && h && (
          <Tip x={x(hover)} width={width}>
            <div className="mb-1 font-medium text-fg">Week of {wk(h.week)}</div>
            <TipRow swatch="var(--accent)" label="Median review" value={`${h.medianReviewMinutes} min`} />
            <TipRow swatch="var(--red)" label="Escapes" value={h.escapes} />
            <TipRow label="PRs signed" value={h.prs} />
            <TipRow label="Time to merge" value={`${h.medianTimeToMergeHours} h`} />
          </Tip>
        )}
      </div>
      <DataTable head={['Week of', 'PRs', 'Median review min', 'Escapes', 'Spot-checks', 'Missed']} rows={weekly.map((w) => [wk(w.week), w.prs, w.medianReviewMinutes, w.escapes, w.spotChecks, w.spotCheckMisses])} />
    </div>
  );
}

const TIERS = [
  { key: 'routedT0', label: 'Covered by proof', short: 'T0', color: 'var(--chart-t0)' },
  { key: 'routedT1', label: 'Skim', short: 'T1', color: 'var(--chart-t1)' },
  { key: 'routedT2', label: 'Read', short: 'T2', color: 'var(--chart-t2)' },
  { key: 'routedT3', label: 'Read closely', short: 'T3', color: 'var(--chart-t3)' },
] as const;

/** Weekly routing mix: PRs per tier, stacked. */
export function RoutingMix({ weekly }: { weekly: WeeklyMetric[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const n = weekly.length;
  const m = { l: 34, r: 12, t: 10, b: 22 };
  const ih = 190;
  const H = m.t + ih + m.b;
  const iw = Math.max(10, width - m.l - m.r);
  const band = iw / Math.max(1, n);
  const bw = Math.max(6, Math.min(24, band * 0.56));
  const totals = weekly.map((w) => w.routedT0 + w.routedT1 + w.routedT2 + w.routedT3);
  const yMax = niceMax(Math.max(...totals, 1), 5);
  const y = (v: number) => m.t + ih - (v / yMax) * ih;
  const ticks = Array.from({ length: yMax / 5 + 1 }, (_, i) => i * 5);
  const every = n > 8 && width < 520 ? 3 : n > 8 ? 2 : 1;
  const h = hover !== undefined ? weekly[hover] : undefined;
  const cx0 = (i: number) => m.l + band * i + band / 2;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-fg-2">
        {TIERS.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: t.color }} />
            {t.label}
          </span>
        ))}
      </div>
      <div
        ref={ref}
        className="relative"
        onMouseLeave={() => setHover(undefined)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - m.l) / band))));
        }}
      >
        {width > 0 && n > 0 && (
          <svg width={width} height={H} role="img" aria-label={`Pull requests per week by how closely a person had to read. Covered by proof went from ${weekly[0].routedT0} to ${weekly[n - 1].routedT0}; read closely went from ${weekly[0].routedT3} to ${weekly[n - 1].routedT3}.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'} />
                <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--fg-3)" className="num">
                  {t}
                </text>
              </g>
            ))}
            {weekly.map((w, i) => {
              let acc = 0;
              const top = TIERS.reduce((last, t, ti) => (w[t.key] > 0 ? ti : last), -1);
              return (
                <g key={w.week} opacity={hover === undefined || hover === i ? 1 : 0.5}>
                  {TIERS.map((t, ti) => {
                    const v = w[t.key];
                    if (!v) return null;
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    const hgt = Math.max(1, y0 - y1 - 2);
                    const xx = cx0(i) - bw / 2;
                    return ti === top ? (
                      <path key={t.key} d={`M${xx},${y1 + hgt} V${y1 + 3} q0,-3 3,-3 h${bw - 6} q3,0 3,3 V${y1 + hgt} Z`} fill={t.color} />
                    ) : (
                      <rect key={t.key} x={xx} y={y1} width={bw} height={hgt} fill={t.color} />
                    );
                  })}
                </g>
              );
            })}
            {weekly.map((w, i) =>
              i % every === 0 || i === n - 1 ? (
                <text key={w.week} x={cx0(i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--fg-3)" className="num">
                  {wk(w.week)}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {hover !== undefined && h && (
          <Tip x={cx0(hover)} width={width}>
            <div className="mb-1 font-medium text-fg">Week of {wk(h.week)}</div>
            {[...TIERS].reverse().map((t) => (
              <TipRow key={t.key} swatch={t.color} label={t.label} value={h[t.key]} />
            ))}
            <div className="mt-1 border-t border-line pt-1">
              <TipRow label="Pull requests" value={totals[hover]} />
            </div>
          </Tip>
        )}
      </div>
      <DataTable head={['Week of', 'Covered by proof', 'Skim', 'Read', 'Read closely', 'Total']} rows={weekly.map((w, i) => [wk(w.week), w.routedT0, w.routedT1, w.routedT2, w.routedT3, totals[i]])} />
    </div>
  );
}

export function TrustPips({ level, max = 3, className }: { level: number; max?: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-[3px]', className)} aria-hidden>
      {Array.from({ length: max + 1 }, (_, i) => (
        <span key={i} className={cx('h-2 w-2 rounded-[2px] transition-colors duration-500', i <= level ? (level === 0 ? 'bg-red' : level === 1 ? 'bg-amber' : level === 2 ? 'bg-blue' : 'bg-green') : 'bg-surface-3')} />
      ))}
    </span>
  );
}
