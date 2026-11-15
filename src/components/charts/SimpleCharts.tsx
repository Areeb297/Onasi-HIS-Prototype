import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Money } from "@/components/Money";
import { cn } from "@/components/ui/primitives";
import { AXIS, BAR_CURSOR, GRID, LINE_CURSOR, Legend, TipBody, VIZ, VizTooltip, compact, moneyLabelRight, moneyLabelTop, num, useTip } from "@/components/charts/viz";

/**
 * Dashboard charts. Recharts for axes and bars, plain HTML for the funnel, the segmented bar and ranked rows.
 * Every chart has a hover and focus tooltip, pill-shaped marks, recessive axes and selective direct labels.
 */

type Row = Record<string, string | number>;
type Fmt = (v: unknown) => string;

/** Index of the largest value, for highlighting. */
const maxIndex = (data: Row[], key: string) => data.reduce((best, r, i) => (Number(r[key]) > Number(data[best]?.[key] ?? -Infinity) ? i : best), 0);

/** Bar gradients: gently graded cyan for every bar, deep teal for the one highlighted bar. Vertical for columns. */
function HlGradient({ id, horizontal }: { id: string; horizontal?: boolean }) {
  const dir = { x1: "0", y1: horizontal ? "0" : "1", x2: horizontal ? "1" : "0", y2: "0" };
  return (
    <defs>
      <linearGradient id={id} {...dir}>
        <stop offset="0%" stopColor="var(--hl-from)" />
        <stop offset="100%" stopColor="var(--hl-to)" />
      </linearGradient>
      <linearGradient id={`${id}b`} {...dir}>
        <stop offset="0%" stopColor="var(--bar-from)" />
        <stop offset="100%" stopColor="var(--bar-to)" />
      </linearGradient>
    </defs>
  );
}

/** Fill for one bar: graded cyan, deep teal with a faint glow for the highlighted bar, or the given colours. */
function barCells(data: Row[], hl: number | null, grad: string, colors?: string[]) {
  return data.map((_, i) => {
    if (colors) return <Cell key={i} fill={colors[i % colors.length]} />;
    return i === hl ? <Cell key={i} fill={`url(#${grad})`} className="viz-glow" /> : <Cell key={i} fill={`url(#${grad}b)`} />;
  });
}

/**
 * Horizontal pill bars for named categories, in graded brand cyan. The largest bar is highlighted in deep teal; every
 * bar keeps its value at the end. `highlight={false}` draws them all alike.
 */
export function HBars({ data, name, value, label, width = 150, format = num, money = false, extra, highlight = true }: {
  data: Row[]; name: string; value: string; label: string; color?: string; width?: number; format?: Fmt; money?: boolean; extra?: (row: Record<string, unknown>) => React.ReactNode; highlight?: boolean;
}) {
  const grad = `hl${React.useId().replace(/:/g, "")}`;
  const hl = highlight && data.length > 1 ? maxIndex(data, value) : null;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: money ? 64 : 40, left: 4, bottom: 0 }} barCategoryGap="32%">
        <HlGradient id={grad} horizontal />
        <XAxis type="number" allowDecimals={false} {...AXIS} axisLine={false} tickFormatter={money ? compact : format} />
        <YAxis type="category" dataKey={name} width={width} {...AXIS} axisLine={false} interval={0} />
        <Tooltip cursor={BAR_CURSOR} content={<VizTooltip money={money} format={format} extra={extra} />} />
        <Bar dataKey={value} name={label} radius={[0, 999, 999, 0]} maxBarSize={16} isAnimationActive={false} background={{ fill: "var(--viz-track)", radius: 999 } as never}>
          {barCells(data, hl, grad)}
          {money ? <LabelList dataKey={value} content={moneyLabelRight} /> : <LabelList dataKey={value} position="right" fill="var(--foreground)" fontSize={12} formatter={(v: unknown) => format(v)} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Pill columns. With `colors` (status or triage colours) every column keeps its colour. Otherwise columns are graded
 * cyan and the largest one, or the one at `highlightIndex`, is deep teal with a faint glow.
 */
export function VBars({ data, name, value, label, colors, format = num, money = false, extra, labels = true, highlightIndex, grow = false }: {
  data: Row[]; name: string; value: string; label: string; color?: string; colors?: string[]; format?: Fmt; money?: boolean; extra?: (row: Record<string, unknown>) => React.ReactNode; labels?: boolean; highlightIndex?: number; grow?: boolean;
}) {
  const grad = `hl${React.useId().replace(/:/g, "")}`;
  const still = useReducedMotion();
  const hl = colors ? null : highlightIndex ?? (data.length > 1 ? maxIndex(data, value) : null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 22, right: 8, left: -6, bottom: 0 }} barCategoryGap="30%">
        <HlGradient id={grad} />
        <CartesianGrid {...GRID} />
        <XAxis dataKey={name} {...AXIS} axisLine={false} interval={0} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} tickFormatter={money ? compact : (v) => (Number(v) >= 10_000 ? compact(v) : format(v))} width={48} />
        <Tooltip cursor={BAR_CURSOR} content={<VizTooltip money={money} format={format} extra={extra} />} />
        <Bar dataKey={value} name={label} radius={999} maxBarSize={28} isAnimationActive={grow && !still} animationDuration={700} animationEasing="ease-out">
          {barCells(data, hl, grad, colors)}
          {labels && (money ? <LabelList dataKey={value} content={moneyLabelTop} /> : <LabelList dataKey={value} position="top" fill="var(--foreground)" fontSize={12} formatter={(v: unknown) => format(v)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Stacked bars. A 2px gap in the surface colour separates the segments; the outer end is fully rounded. */
export function Stacked({ data, name, series, horizontal = false, width = 110, format = num, money = false }: {
  data: Row[]; name: string; series: { key: string; color: string; label?: string }[]; horizontal?: boolean; width?: number; format?: Fmt; money?: boolean;
}) {
  const tick = money ? compact : format;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: horizontal ? 4 : -6, bottom: 0 }} barCategoryGap="32%">
        <CartesianGrid {...GRID} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? <XAxis type="number" {...AXIS} axisLine={false} tickFormatter={tick} /> : <XAxis dataKey={name} {...AXIS} axisLine={false} />}
        {horizontal ? <YAxis type="category" dataKey={name} width={width} {...AXIS} axisLine={false} interval={0} /> : <YAxis {...AXIS} axisLine={false} tickFormatter={tick} width={48} />}
        <Tooltip cursor={BAR_CURSOR} content={<VizTooltip money={money} format={format} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} stackId="s" fill={s.color} stroke="var(--card)" strokeWidth={2} maxBarSize={horizontal ? 16 : 24} isAnimationActive={false}
            radius={i === series.length - 1 ? (horizontal ? [0, 999, 999, 0] : [999, 999, 0, 0]) : i === 0 ? (horizontal ? [999, 0, 0, 999] : [0, 0, 999, 999]) : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ---------- Rings ---------- */

/** A ring split into two or three parts, with the total in the middle. The parts sweep in once. */
export function Ring({ data, total, caption, size = 168 }: { data: { name: string; value: number; color: string }[]; total: string; caption: string; size?: number }) {
  const still = useReducedMotion();
  const sum = data.reduce((n, d) => n + d.value, 0) || 1;
  const r = 42, c = 2 * Math.PI * r, gap = data.filter((d) => d.value > 0).length > 1 ? 2.2 : 0;
  let start = 0;
  const { box, bind, layer } = useTip();
  return (
    <div ref={box} className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={`${total} ${caption}: ${data.map((d) => `${d.name} ${num(d.value)}`).join(", ")}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--viz-track)" strokeWidth="9" />
        {data.map((d, i) => {
          const len = Math.max(0, (d.value / sum) * c - gap);
          const seg = (
            <motion.circle key={d.name} cx="50" cy="50" r={r} fill="none" stroke={d.color} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${len} ${c}`} strokeDashoffset={-start}
              initial={still ? false : { strokeDasharray: `0 ${c}` }} animate={{ strokeDasharray: `${len} ${c}` }} transition={{ duration: 0.9, delay: 0.15 + i * 0.12, ease: [0.22, 0.8, 0.3, 1] }}
              className="cursor-default outline-none" {...bind(<TipBody title={d.name} lines={[{ value: num(d.value), color: d.color }, { value: `${((d.value / sum) * 100).toFixed(1)}%`, label: "of the total" }]} />)} />
          );
          start += (d.value / sum) * c;
          return seg;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[1.75rem] font-semibold leading-none tracking-tight">{total}</span>
        <span className="mt-1 text-xs text-muted-foreground">{caption}</span>
      </div>
      {layer}
    </div>
  );
}

/**
 * A goal gauge: a ring filled to the value, with the target as a tick. On target it fills in the brand gradient; off
 * target it fills amber and says so in words with an icon, so the state never rests on colour.
 */
export function RingGauge({ value, target, better = "higher", label, caption, size = 104 }: { value: number; target: number; better?: "higher" | "lower"; label: string; caption: string; size?: number }) {
  const still = useReducedMotion();
  const id = `rg${React.useId().replace(/:/g, "")}`;
  const v = Math.max(0, Math.min(100, value));
  const ok = better === "higher" ? value >= target : value <= target;
  const r = 40, c = 2 * Math.PI * r;
  const t = (target / 100) * 360 - 90;
  const tx = 50 + r * Math.cos((t * Math.PI) / 180), ty = 50 + r * Math.sin((t * Math.PI) / 180);
  return (
    <figure className="flex min-w-0 flex-col items-center text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full" role="img" aria-label={`${label}: ${Math.round(value)}%, target ${better === "higher" ? "at least" : "at most"} ${target}%. ${ok ? "On target." : "Off target."}`}>
          <defs>
            <linearGradient id={id} x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor="var(--hl-from)" /><stop offset="100%" stopColor="var(--hl-to)" /></linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--viz-track)" strokeWidth="8" />
          <motion.circle cx="50" cy="50" r={r} fill="none" stroke={ok ? `url(#${id})` : "var(--st-warn)"} strokeWidth="8" strokeLinecap="round" transform="rotate(-90 50 50)"
            strokeDasharray={c} initial={still ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v / 100) }} transition={{ duration: 1, delay: 0.2, ease: [0.22, 0.8, 0.3, 1] }} />
          <circle cx={tx} cy={ty} r="3" fill="var(--card)" stroke="var(--foreground)" strokeWidth="1.5" />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold leading-none tracking-tight">{Math.round(value)}%</span>
        </div>
      </div>
      <figcaption className="mt-2 min-w-0">
        <div className="text-[0.8125rem] font-medium leading-snug">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>
        <div className={cn("mt-1 inline-flex items-center gap-1 text-xs font-medium", ok ? "text-ok" : "text-warn")}>
          {ok ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <TriangleAlert className="size-3.5" aria-hidden="true" />}
          {ok ? "On target" : "Off target"}
        </div>
      </figcaption>
    </figure>
  );
}

/** Lines with a crosshair tooltip and the latest value labelled at the end of each line. */
export function Lines({ data, name, series, format = num }: { data: Row[]; name: string; series: { key: string; color: string }[]; format?: Fmt }) {
  const last = data.length - 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 34, left: -10, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={name} {...AXIS} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} tickFormatter={format} width={44} />
        <Tooltip cursor={LINE_CURSOR} content={<VizTooltip format={format} />} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} strokeLinecap="round" isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; index?: number }) => p.index === last ? <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} /> : <g key={p.index} />}
            activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}>
            <LabelList dataKey={s.key} content={(p: { x?: number | string; y?: number | string; index?: number; value?: unknown }) => p.index === last ? <text x={Number(p.x) + 8} y={Number(p.y) + 4} fontSize={12} fontWeight={600} fill="var(--foreground)">{format(p.value)}</text> : null} />
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** One measure over time: a 2px line over a 10% wash, with a crosshair tooltip. */
export function AreaTrend({ data, name, value, label, color = "var(--viz-line)", money = false, extra, format }: { data: Row[]; name: string; value: string; label: string; color?: string; money?: boolean; extra?: (row: Record<string, unknown>) => React.ReactNode; format?: Fmt }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 12, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id={`a${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={name} {...AXIS} minTickGap={24} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} tickFormatter={compact} width={48} />
        <Tooltip cursor={LINE_CURSOR} content={<VizTooltip money={money} extra={extra} format={format} />} />
        <Area type="monotone" dataKey={value} name={label} stroke={color} strokeWidth={2} fill={`url(#a${id})`} isAnimationActive={false} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: color }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ---------- HTML charts ---------- */

/**
 * One whole split into parts: a tall segmented bar with each share printed inside when it fits, a legend in block
 * order, and every part's name, amount and share on hover and focus.
 */
export function SegmentedBar({ parts, unit = "", money = false, className }: { parts: { name: string; value: number; color: string; dark?: boolean }[]; unit?: string; money?: boolean; className?: string }) {
  const sum = parts.reduce((n, p) => n + p.value, 0) || 1;
  const { box, bind, layer } = useTip();
  return (
    <div ref={box} className={cn("relative", className)}>
      <div className="flex h-7 w-full gap-0.5" role="list" aria-label="Share of the total">
        {parts.filter((p) => p.value > 0).map((p) => {
          const share = (p.value / sum) * 100;
          return (
            <div key={p.name} role="listitem" aria-label={`${p.name}: ${num(p.value)}${unit ? ` ${unit}` : ""}, ${share.toFixed(0)}%`}
              {...bind(<TipBody title={p.name} lines={[{ value: money ? <Money value={p.value} /> : `${num(p.value)}${unit ? ` ${unit}` : ""}`, color: p.color }, { value: `${share.toFixed(1)}%`, label: "of the total" }]} />)}
              className="flex min-w-0 items-center rounded-[4px] px-2 text-xs font-semibold outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ width: `${share}%`, background: p.color, color: p.dark ? "#0b1f1a" : "#ffffff" }}>
              {share >= 12 && <span className="truncate tabular-nums">{share.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
      <Legend className="mt-3" items={parts.map((p) => ({ label: p.name, color: p.color }))} />
      {layer}
    </div>
  );
}

/** Ordered stages, each a bar as long as its amount, with the share of the first stage beside it. */
export function FunnelBars({ stages, colors }: { stages: { stage: string; amount: number; claims: number }[]; colors: readonly string[] }) {
  const top = stages[0]?.amount || 1;
  const { box, bind, layer } = useTip();
  return (
    <div ref={box} className="relative space-y-3 px-3 pt-1">
      {stages.map((s, i) => {
        const share = (s.amount / top) * 100;
        return (
          <div key={s.stage} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${s.stage}: ${num(s.amount)} Saudi riyals, ${num(s.claims)} claims, ${share.toFixed(0)}% of submitted`}
            {...bind(<TipBody title={s.stage} lines={[{ value: <Money value={s.amount} />, color: colors[i] }, { value: num(s.claims), label: "claims" }, { value: `${share.toFixed(1)}%`, label: "of submitted" }]} />)}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[0.8125rem]">
              <span className="font-medium">{s.stage}</span>
              <span className="flex items-baseline gap-2"><Money value={s.amount} className="font-semibold" /><span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{share.toFixed(0)}%</span></span>
            </div>
            <div className="h-3 w-full rounded-full bg-[var(--viz-track)]">
              <div className="h-full rounded-full" style={{ width: `${Math.max(share, 1.5)}%`, background: colors[i] }} />
            </div>
          </div>
        );
      })}
      {layer}
    </div>
  );
}

/** Ranked rows for a Pareto reading on one axis: denied amount as the bar, the running share as a number. */
export function ParetoRows({ rows, color = "var(--viz-line)" }: { rows: { reason: string; amount: number; claims: number; share: number; cumulative: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const { box, bind, layer } = useTip();
  return (
    <div ref={box} className="relative px-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/70 pb-1.5 text-xs text-muted-foreground sm:grid-cols-[minmax(9rem,15rem)_minmax(0,1fr)_auto_auto]">
        <span>Reason</span><span className="hidden sm:block">Denied amount</span><span className="hidden w-24 text-right sm:block">Amount</span><span className="w-16 text-right">Running</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.reason} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md py-2 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(9rem,15rem)_minmax(0,1fr)_auto_auto]"
            aria-label={`${r.reason}: ${num(r.amount)} Saudi riyals denied, ${r.share.toFixed(1)}% of denied money, ${r.cumulative.toFixed(0)}% running total`}
            {...bind(<TipBody title={r.reason} lines={[{ value: <Money value={r.amount} />, label: "denied", color }, { value: num(r.claims), label: "claims" }, { value: `${r.share.toFixed(1)}%`, label: "of denied money" }, { value: `${r.cumulative.toFixed(1)}%`, label: "running total" }]} />)}>
            <span className="truncate pl-1 text-[0.8125rem]">{r.reason}</span>
            <span className="col-span-2 row-start-2 h-2.5 rounded-full sm:col-span-1 sm:row-start-auto" style={{ background: "var(--viz-track)" }}>
              <span className="block h-full rounded-full" style={{ width: `${(r.amount / max) * 100}%`, background: "linear-gradient(90deg, var(--bar-from), var(--bar-to))" }} />
            </span>
            <span className="hidden w-24 text-right text-[0.8125rem] font-medium sm:block"><Money value={r.amount} /></span>
            <span className="w-16 text-right text-[0.8125rem] tabular-nums text-muted-foreground">{r.cumulative.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
      {layer}
    </div>
  );
}
