import * as React from "react";
import { Money } from "@/components/Money";
import { cn } from "@/components/ui/primitives";

/**
 * Shared pieces for every dashboard chart: the palette slots (CSS variables set by the .viz block in index.css),
 * number formats, the hover tooltip, and a riyal-sign label that works inside SVG.
 */

/**
 * Categorical slots, Onasi brand ramps only, in fixed order: cyan, deep teal, neutral, Dark Green (Minty White in dark),
 * mint. Validated with the dataviz palette validator in both themes. A series keeps its slot whatever the filters do.
 */
export const VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"] as const;
/** Light neutral for "the rest" (free beds, other). Not an identity colour. */
export const REST = "var(--viz-rest)";
/** Ordinal ramp for ordered stages and age bands, light to dark. */
export const ORD = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)", "var(--ord-5)"] as const;
/**
 * Status colours, only for claim and payment state and always next to a label or icon. Deliberately not all brand:
 * paid is brand green and pending a brand neutral, but partly paid stays amber and denied stays red, because billing
 * staff read those as warning and failure. STATUS_INK is the darker step for icons and small marks (4.5:1 or better).
 */
export const STATUS_COLOR: Record<string, string> = {
  Paid: "var(--st-good)", "Partially Paid": "var(--st-warn)", Denied: "var(--st-crit)", Pending: "var(--st-wait)",
};
export const STATUS_INK: Record<string, string> = {
  Paid: "var(--st-good-ink)", "Partially Paid": "var(--st-warn-ink)", Denied: "var(--st-crit-ink)", Pending: "var(--st-wait-ink)",
};
/**
 * CTAS triage level colours, 1 to 5. Not brand on purpose: the Canadian Triage and Acuity Scale colour code (blue, red,
 * yellow, green, grey) is what emergency staff rely on, so charts of triage levels keep it.
 */
export const CTAS_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--ctas-${n})`);

export const num = (v: unknown) => Math.round(Number(v)).toLocaleString("en-US");
/** 8,450 / 312K / 1.24M. One style per axis. */
export function compact(v: unknown) {
  const n = Number(v);
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 10_000) return `${Math.round(n / 1000)}K`;
  if (a >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
export const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

/** Recharts axis and grid look: hairline, solid, recessive. */
export const AXIS = { tick: { fill: "var(--muted-foreground)", fontSize: 12 }, axisLine: { stroke: "var(--viz-axis)" }, tickLine: false } as const;
export const GRID = { stroke: "var(--viz-grid)", vertical: false } as const;

/* ---------- Tooltip ---------- */

type TipRow = { name?: string | number; value?: unknown; color?: string; dataKey?: unknown; payload?: Record<string, unknown> };

/**
 * Tooltip content for Recharts. The value leads, the series name follows, keyed by a short stroke of the series colour.
 * `money` shows amounts with the riyal sign. `extra` adds lines from the hovered row (for example a claim count).
 */
export function VizTooltip({
  active, payload, label, money = false, format, extra, title,
}: {
  active?: boolean; payload?: TipRow[]; label?: string | number; money?: boolean;
  format?: (v: unknown) => string; extra?: (row: Record<string, unknown>) => React.ReactNode; title?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const row = (payload[0].payload ?? {}) as Record<string, unknown>;
  return (
    <TipCard>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title ? title(row) : label}</div>
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="text-sm font-semibold tabular-nums text-foreground">{money ? <Money value={Number(p.value)} /> : format ? format(p.value) : num(p.value)}</span>
            {payload.length > 1 || p.name ? <span className="text-xs text-muted-foreground">{p.name}</span> : null}
          </li>
        ))}
      </ul>
      {extra && <div className="mt-1 text-xs text-muted-foreground">{extra(row)}</div>}
    </TipCard>
  );
}

export function TipCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("pointer-events-none min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg", className)}>{children}</div>;
}

/** Cursor for bar charts: a soft wash behind the hovered band. */
export const BAR_CURSOR = { fill: "var(--muted)", opacity: 0.7 } as const;
export const LINE_CURSOR = { stroke: "var(--viz-axis)", strokeWidth: 1 } as const;

/* ---------- Hover tooltip for HTML charts (funnel, segmented bar, ranked rows) ---------- */

/** Gives HTML marks a pointer and keyboard tooltip. Put `layer` inside a relatively positioned box. */
export function useTip() {
  const [tip, setTip] = React.useState<{ x: number; y: number; content: React.ReactNode } | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const bind = (content: React.ReactNode) => ({
    onPointerMove: (e: React.PointerEvent) => {
      const r = box.current?.getBoundingClientRect();
      if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
    },
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<Element>) => {
      const r = box.current?.getBoundingClientRect();
      const t = e.currentTarget.getBoundingClientRect();
      if (r) setTip({ x: t.left - r.left + t.width / 2, y: t.top - r.top, content });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
  });
  const layer = tip ? (
    <div className="pointer-events-none absolute z-20" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > (box.current?.clientWidth ?? 0) / 2 ? "calc(-100% - 12px)" : "12px"}, calc(-100% - 8px))` }}>
      <TipCard>{tip.content}</TipCard>
    </div>
  ) : null;
  return { box, bind, layer };
}

/** Tooltip body used by the HTML charts: a title, then value-first lines. */
export function TipBody({ title, lines }: { title: React.ReactNode; lines: { value: React.ReactNode; label?: React.ReactNode; color?: string }[] }) {
  return (
    <>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="space-y-0.5">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            {l.color && <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: l.color }} />}
            <span className="text-sm font-semibold tabular-nums">{l.value}</span>
            {l.label && <span className="text-xs text-muted-foreground">{l.label}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Riyal sign inside SVG (bar-end labels) ---------- */

const RIYAL_PATHS = [
  "M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z",
  "M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z",
];

/** The riyal sign then a compact number, as SVG. Used for labels at the end of bars. */
export function SvgMoney({ x, y, value, anchor = "start", fill = "var(--foreground)" }: { x: number; y: number; value: number; anchor?: "start" | "middle"; fill?: string }) {
  const text = compact(value);
  const h = 10, w = (1124 / 1256) * h, gap = 3;
  const textW = text.length * 6.6;
  const start = anchor === "middle" ? x - (w + gap + textW) / 2 : x;
  return (
    <g aria-hidden="true">
      <g transform={`translate(${start},${y - h + 1}) scale(${h / 1256})`} fill={fill}>
        {RIYAL_PATHS.map((d, i) => <path key={i} d={d} />)}
      </g>
      <text x={start + w + gap} y={y} fill={fill} fontSize={12} fontWeight={500} style={{ fontVariantNumeric: "tabular-nums" }}>{text}</text>
    </g>
  );
}

/** Recharts label renderers. Horizontal bars: money label past the bar end. Columns: money label above the cap. */
export function moneyLabelRight(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) {
  const x = Number(props.x) + Number(props.width) + 6, y = Number(props.y) + Number(props.height) / 2 + 4;
  return <SvgMoney x={x} y={y} value={Number(props.value)} />;
}
export function moneyLabelTop(props: { x?: number | string; y?: number | string; width?: number | string; value?: unknown }) {
  return <SvgMoney x={Number(props.x) + Number(props.width) / 2} y={Number(props.y) - 6} value={Number(props.value)} anchor="middle" />;
}

/* ---------- Legend ---------- */

export function Legend({ items, shape = "bar", className }: { items: { label: string; color: string }[]; shape?: "bar" | "line"; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((l) => (
        <li key={l.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"} style={{ background: l.color }} />
          {l.label}
        </li>
      ))}
    </ul>
  );
}
