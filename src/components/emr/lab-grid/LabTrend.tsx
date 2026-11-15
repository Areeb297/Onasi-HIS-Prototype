import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { refTextFor, unitText } from "@/lib/fhir/lab-catalog";
import { fmtDateTime } from "@/lib/format";
import type { GridRow, Trend } from "@/lib/lab-grid";

/**
 * The trend of one analyte over every visit: collection date on X, value on Y, the reference range as a shaded band,
 * abnormal points in red. Opened from a grid cell, never shown by default. Drawn as plain SVG at the real width, so
 * the labels stay readable on a phone.
 *
 * shortcut: points are evenly spaced, one per collection, with the date under them. A true time axis would squeeze
 * a daily inpatient series into a few pixels next to clinic visits months apart; add a visit filter before switching.
 */

const H = 300;
const PAD = { l: 46, r: 14, t: 18, b: 46 };
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit" });

/** Three to five round numbers that cover the range. */
function ticks(min: number, max: number): number[] {
  const step = [1, 2, 2.5, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10((max - min) / 4))).find((s) => (max - min) / s <= 5) ?? max - min;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

export function LabTrend({ row, trend, sex, visitLabel, onClose }: {
  row: GridRow; trend: Trend; sex: "M" | "F"; visitLabel: (visitNumber: string) => string; onClose: () => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [W, setW] = React.useState(620);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(260, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { points, low, high } = trend;
  const unit = unitText(row.test);
  const values = [...points.map((p) => p.n), ...(low !== undefined ? [low] : []), ...(high !== undefined ? [high] : [])];
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
  const min = lo - pad, max = hi + pad;
  const x = (i: number) => (points.length === 1 ? (PAD.l + W - PAD.r) / 2 : PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number) => PAD.t + ((max - v) / (max - min)) * (H - PAD.t - PAD.b);
  // Date labels: always the newest, then every older one that has room (64px) next to the last one drawn.
  const labelled = new Set<number>();
  for (let i = points.length - 1, lastX = Infinity; i >= 0; i--) if (lastX - x(i) >= 64) { labelled.add(i); lastX = x(i); }
  const visits = new Set(points.map((p) => p.visitNumber)).size;
  const last = points[points.length - 1];

  return (
    <Dialog
      open onClose={onClose} wide
      title={`${row.test.short} Trend`}
      subtitle={`${unit ? `${unit}. ` : ""}Reference: ${refTextFor(row.test, sex)}`}
    >
      {/* .viz carries the chart colour variables (index.css). */}
      <div className="viz">
      <div ref={box}>
        <svg width={W} height={H} role="img" aria-label={`${row.test.short}: ${points.length} results over ${visits} ${visits === 1 ? "visit" : "visits"}. Newest ${last.value}${unit ? ` ${unit}` : ""}.`} className="block text-[11px]">
          {(low !== undefined || high !== undefined) && (
            <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(high ?? max)} height={y(low ?? min) - y(high ?? max)} fill="var(--viz-1)" opacity={0.13} />
          )}
          {ticks(min, max).map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" />
              <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fill="var(--muted-foreground)" className="tabular-nums">{t}</text>
            </g>
          ))}
          {[low, high].map((v, i) => v !== undefined && <line key={i} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--viz-1)" strokeDasharray="3 3" opacity={0.7} />)}
          {points.map((p, i) => i > 0 && p.visitNumber !== points[i - 1].visitNumber && (
            <line key={p.at} x1={(x(i) + x(i - 1)) / 2} x2={(x(i) + x(i - 1)) / 2} y1={PAD.t} y2={H - PAD.b} stroke="var(--viz-axis)" strokeDasharray="2 4" />
          ))}
          <polyline fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={points.map((p, i) => `${x(i)},${y(p.n)}`).join(" ")} />
          {points.map((p, i) => (
            <g key={p.at}>
              {p.critical && <circle cx={x(i)} cy={y(p.n)} r={7.5} fill="none" stroke="var(--destructive)" strokeWidth={1.5} />}
              <circle cx={x(i)} cy={y(p.n)} r={p.abnormal ? 4.5 : 3.5} fill={p.abnormal ? "var(--destructive)" : "var(--viz-1)"} stroke="var(--card)" strokeWidth={1.5}>
                <title>{`${p.value}${unit ? ` ${unit}` : ""}, ${fmtDateTime(p.at)}. ${visitLabel(p.visitNumber)}${p.critical ? ". Critical" : p.abnormal ? ". Abnormal" : ""}`}</title>
              </circle>
              {p.abnormal && <text x={x(i)} y={y(p.n) - 9} textAnchor="middle" fill="var(--destructive)" fontWeight={700} aria-hidden="true">!</text>}
              {labelled.has(i) && (
                <text x={x(i)} y={H - PAD.b + 16} textAnchor={i === points.length - 1 && points.length > 1 ? "end" : "middle"} fill="var(--muted-foreground)">
                  {(new Date(p.at).getFullYear() !== new Date(last.at).getFullYear() ? dayYear : day).format(new Date(p.at))}
                </text>
              )}
            </g>
          ))}
          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--viz-axis)" />
          <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fill="var(--muted-foreground)">Collection Date, Oldest To Newest</text>
        </svg>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{points.length} {points.length === 1 ? "result" : "results"} over {visits} {visits === 1 ? "visit" : "visits"}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm bg-[var(--viz-1)] opacity-30" /> Reference Range</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-destructive" /> Abnormal</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 border-l border-dashed border-foreground/40" /> New Visit</span>
      </p>
      </div>
    </Dialog>
  );
}
