import * as React from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/components/ui/primitives";

/**
 * Onasi light glass, as components. The look lives in index.css (.glass-backdrop, .glass-card, .glass-panel,
 * .glass-kpi, .glass-pill, .glass-row, .glass-hover); these add the shared motion: a soft lift on hover, one staggered
 * fade-up when a strip or grid first mounts, and nothing at all when the user asks for reduced motion.
 */

const SPRING = { type: "spring", stiffness: 360, damping: 26 } as const;

/** Entrance for children of GlassStagger or KpiStrip. Runs once, when the parent first mounts. */
export const glassItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 0.8, 0.3, 1] } },
};

/** A page container for glass cards. It adds no colour: the page keeps its plain light green background. */
export function GlassBackdrop({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("glass-backdrop", className)}>{children}</div>;
}

/**
 * A container whose GlassCard and KpiTile children fade up one after another on first mount. Use it as the grid itself:
 * pass the grid classes in className.
 */
export function GlassStagger({ className, children, gap = 0.05, label }: { className?: string; children: React.ReactNode; gap?: number; label?: string }) {
  const still = useReducedMotion();
  return (
    <motion.div className={className} aria-label={label} initial={still ? false : "hidden"} animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {children}
    </motion.div>
  );
}

/**
 * A frosted card. `solid` makes it a little more opaque for charts, tables and long reading. `lift` (on by default)
 * raises it 4px on hover. Inside GlassStagger it joins the entrance.
 */
export function GlassCard({ className, children, solid = false, lift = true, as = "section", ...rest }: {
  className?: string; children: React.ReactNode; solid?: boolean; lift?: boolean; as?: "section" | "div" | "article";
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd">) {
  const still = useReducedMotion();
  const Tag = as === "div" ? motion.div : as === "article" ? motion.article : motion.section;
  return (
    <Tag
      variants={glassItem}
      whileHover={still || !lift ? undefined : { y: -4 }}
      transition={SPRING}
      className={cn(solid ? "glass-panel" : "glass-card", "glass-hover rounded-2xl", className)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Tag>
  );
}

/* ---------- Change pill and sparkline ---------- */

export type GoodWhen = "up" | "down" | "neutral";
export type DeltaKind = "percent" | "count" | "points" | "days";

export function deltaOf(current: number, prev: number, kind: DeltaKind) {
  const diff = current - prev;
  const dir: "up" | "down" | "flat" = Math.abs(diff) < 1e-9 || (kind !== "count" && Math.abs(diff) < 0.05) ? "flat" : diff > 0 ? "up" : "down";
  let text: string;
  if (kind === "points") text = `${Math.abs(diff).toFixed(1)} pts`;
  else if (kind === "days") text = `${Math.abs(diff).toFixed(1)} days`;
  else if (kind === "count" || prev < 10) text = Math.abs(Math.round(diff)).toLocaleString("en-US");
  else text = `${((Math.abs(diff) / prev) * 100).toFixed(1)}%`;
  return { dir, text };
}

/**
 * The change against the previous period: an arrow and the amount in a pill, then "vs <period>". Green when the change
 * is good, red when it is bad, grey when neither (goodWhen "neutral"). Screen readers hear the whole sentence.
 */
export function DeltaPill({ current, prev, goodWhen = "neutral", kind = "percent", against, compact = false }: {
  current: number; prev: number; goodWhen?: GoodWhen; kind?: DeltaKind; against: string; compact?: boolean;
}) {
  const { dir, text } = deltaOf(current, prev, kind);
  const good = dir === "flat" || goodWhen === "neutral" ? null : (dir === "up") === (goodWhen === "up");
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <span aria-hidden="true" className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
        good === true ? "bg-ok/12 text-ok" : good === false ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground/80")}>
        <Icon className="size-3.5" strokeWidth={2.25} />
        {dir === "flat" ? "0" : text}
      </span>
      {!compact && <span aria-hidden="true" className="text-muted-foreground">vs {against}</span>}
      <span className="sr-only">{dir === "flat" ? `No change from ${against}.` : `${dir === "up" ? "Up" : "Down"} ${text} from ${against}.`}</span>
    </span>
  );
}

/** A trend line that fills its width: history in a quiet stroke over a soft wash, the current period as a dot. */
export function Sparkline({ points, className, label }: { points: number[]; className?: string; label?: string }) {
  const id = React.useId().replace(/:/g, "");
  if (points.length < 2) return null;
  const w = 100, h = 30, pad = 3;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [(i * w) / (points.length - 1), h - pad - ((v - min) / span) * (h - pad * 2)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const ly = xy[xy.length - 1][1];
  return (
    <div className={cn("relative h-8 text-[var(--spark-to,#05a391)]", className)} role="img" aria-label={label ?? `Trend over ${points.length} periods`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={`sa${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--spark-from, #39edd5)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--spark-from, #39edd5)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`ss${id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--spark-from, #39edd5)" />
            <stop offset="100%" stopColor="var(--spark-to, #05a391)" />
          </linearGradient>
        </defs>
        <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sa${id})`} />
        <path d={line} fill="none" stroke={`url(#ss${id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden="true" className="absolute right-0 size-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-current ring-2 ring-[var(--card)]" style={{ top: `${(ly / h) * 100}%` }} />
    </div>
  );
}

/* ---------- KPI tile and strip ---------- */

export interface KpiTileProps {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  /** History, oldest first; the last point is the current period. Shows a sparkline. */
  points?: number[];
  /** With prev and against, shows the change pill. */
  current?: number;
  prev?: number;
  against?: string;
  goodWhen?: GoodWhen;
  kind?: DeltaKind;
  note?: React.ReactNode;
  tone?: "ok" | "warn" | "danger";
  /** Icon tile colour: the brand by default. */
  accent?: "brand" | "warn" | "danger";
  /** Smaller type and padding for dense strips (patient header, vital signs). */
  dense?: boolean;
  className?: string;
  onClick?: () => void;
}

/**
 * A KPI on frosted glass: icon tile, label, the number, a change pill and a sparkline. The number stays solid and crisp;
 * only the card behind it is translucent. Lifts 4px on hover; joins the entrance inside KpiStrip or GlassStagger.
 */
export function KpiTile({ icon, label, value, points, current, prev, against, goodWhen, kind, note, tone, accent = "brand", dense = false, className, onClick }: KpiTileProps) {
  const still = useReducedMotion();
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-xl", dense ? "size-7 [&_svg]:size-4" : "size-9 [&_svg]:size-[1.15rem]",
            accent === "danger" ? "bg-destructive/10 text-destructive" : accent === "warn" ? "bg-warn/12 text-warn" : "glass-icon")}>
            {icon}
          </span>
        )}
        <span className="min-w-0 text-[0.8125rem] font-medium leading-tight text-muted-foreground">{label}</span>
      </div>
      <div className={cn("min-w-0 truncate font-semibold leading-tight tracking-tight text-foreground", dense ? "mt-1.5 text-xl" : "mt-3 text-2xl sm:text-[1.75rem]")}>{value}</div>
      {current != null && prev != null && against && <div className={dense ? "mt-1" : "mt-2.5"}><DeltaPill current={current} prev={prev} goodWhen={goodWhen} kind={kind} against={against} compact={dense} /></div>}
      {note && <div className={cn("mt-1.5 text-xs", tone === "danger" ? "font-medium text-destructive" : tone === "warn" ? "font-medium text-warn" : tone === "ok" ? "font-medium text-ok" : "text-muted-foreground")}>{note}</div>}
      {points && <div className="mt-auto pt-3"><Sparkline className="mr-1" points={points} label={`${label}, trend over ${points.length} periods`} /></div>}
    </>
  );
  const cls = cn("glass-kpi flex min-w-0 flex-col text-left", dense ? "px-3 py-2.5" : "px-4 pb-3.5 pt-4", onClick && "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring", className);
  return onClick ? (
    <motion.button type="button" onClick={onClick} variants={glassItem} whileHover={still ? undefined : { y: -4 }} transition={SPRING} className={cls}>{body}</motion.button>
  ) : (
    <motion.div variants={glassItem} whileHover={still ? undefined : { y: -4 }} transition={SPRING} className={cls}>{body}</motion.div>
  );
}

/** A row of KpiTiles that fades up once, tile by tile. Pass grid columns in className. */
export function KpiStrip({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  return <GlassStagger className={cn("grid grid-cols-1 gap-3", className)} label={label}>{children}</GlassStagger>;
}

/* ---------- Segmented pill switch ---------- */

/** A frosted pill segmented switch (Week / Month / Year style). The active pill slides; it jumps under reduced motion. */
export function GlassPillSwitch<T extends string>({ value, options, onChange, label, size = "md", className }: {
  value: T; options: readonly T[]; onChange: (v: T) => void; label: string; size?: "sm" | "md"; className?: string;
}) {
  const still = useReducedMotion();
  const group = React.useId();
  return (
    <div role="group" aria-label={label} className={cn("glass-pill flex max-w-full gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]", className)}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onChange(o)}
            className={cn("relative shrink-0 rounded-full font-medium whitespace-nowrap transition-colors", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[0.8125rem]", on ? "text-white dark:text-[#032c26]" : "text-foreground/80 hover:text-foreground")}>
            {on && <motion.span layoutId={still ? undefined : `pill-${group}`} transition={SPRING} aria-hidden="true" className="absolute inset-0 rounded-full bg-[linear-gradient(135deg,#032c26,#025136)] shadow-[0_4px_14px_-6px_rgba(3,44,38,0.5)] dark:bg-[linear-gradient(135deg,#0ce69f,#52fce3)]" />}
            <span className="relative">{o}</span>
          </button>
        );
      })}
    </div>
  );
}
