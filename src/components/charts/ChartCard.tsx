import * as React from "react";
import { Table, Td, Th, cn } from "@/components/ui/primitives";
import { Legend } from "@/components/charts/viz";
import { GlassCard } from "@/components/ui/glass";

export { AXIS, GRID } from "@/components/charts/viz";
export { MetricTile } from "@/components/charts/MetricTile";

export type Column = string | { key: string; label?: string; format?: (v: unknown, row: Record<string, unknown>) => React.ReactNode; align?: "right" };

/**
 * A chart on a frosted card, with a title that states what it shows, a legend, and a Table view so the numbers
 * never depend on colour and shape alone. `actions` holds extra switches (for example Monthly or Daily).
 */
export function ChartCard({
  title, note, legend, legendShape, rows, columns, children, className, height = 260, actions, footer,
}: {
  title: string;
  note?: React.ReactNode;
  legend?: { label: string; color: string }[];
  legendShape?: "bar" | "line";
  rows: Record<string, unknown>[];
  columns: Column[];
  children: React.ReactNode;
  className?: string;
  /** Plot height in pixels, or "auto" for HTML charts that size themselves. */
  height?: number | "auto";
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [table, setTable] = React.useState(false);
  const cols = columns.map((c) => (typeof c === "string" ? { key: c, label: c } : { label: c.key, ...c }));
  // A column is numeric when its values are numbers (money included). Numbers sit right, under a right-aligned heading;
  // the first column holds the labels, stays left and takes the spare width so number columns stay close together.
  const numeric = cols.map((c, ci) => ci > 0 && (c.align === "right" || rows.some((r) => typeof r[c.key] === "number")));
  return (
    <GlassCard solid className={cn("flex min-w-0 flex-col", className)}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4">
        <div className="min-w-[min(100%,12rem)] flex-1">
          <h2 className="text-[0.9375rem] font-semibold leading-snug">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {!table && actions}
          <ViewSwitch value={table ? "Table" : "Chart"} onChange={(v) => setTable(v === "Table")} label={`${title}: view`} />
        </div>
      </header>
      {legend && legend.length > 1 && !table && <Legend items={legend} shape={legendShape} className="px-5 pt-2.5" />}
      {table ? (
        <Table className="mt-3 max-h-[26rem] overflow-y-auto">
          <thead className="sticky top-0">
            <tr>{cols.map((c, ci) => <Th key={c.key} numeric={numeric[ci]} className={ci === 0 ? "w-full" : undefined}>{c.label}</Th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c, ci) => {
                  const v = r[c.key];
                  const isNum = typeof v === "number";
                  return <Td key={c.key} numeric={numeric[ci]} className={numeric[ci] ? "whitespace-nowrap" : undefined}>{c.format ? c.format(v, r) : isNum ? (v as number).toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(v ?? "")}</Td>;
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className={cn("relative px-2 pb-3 pt-2", height === "auto" ? "flex-1" : "flex flex-1 flex-col")}>{height === "auto" ? children : <div className="flex-1" style={{ minHeight: height }}>{children}</div>}</div>
      )}
      {footer && !table && <div className="border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">{footer}</div>}
    </GlassCard>
  );
}

/** A small two-or-more option switch, used for Chart and Table and for chart measures. */
export function ViewSwitch<T extends string>({ value, onChange, label, options = ["Chart", "Table"] as unknown as T[] }: { value: T; onChange: (v: T) => void; label: string; options?: T[] }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-lg border border-border bg-muted/80 p-0.5 text-xs font-medium">
      {options.map((v) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)} className={cn("rounded-md px-2 py-1 transition-colors", v === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {v}
        </button>
      ))}
    </div>
  );
}
