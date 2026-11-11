import * as React from "react";
import { Table, Td, Th, cn } from "@/components/ui/primitives";

/**
 * A chart in a card, with a title that states what it shows, a legend, and a Table view so the
 * numbers are never available as colour and shape only.
 */
export function ChartCard({
  title, note, legend, rows, columns, children, className, height = 260,
}: {
  title: string;
  note?: string;
  legend?: { label: string; color: string }[];
  rows: Record<string, string | number>[];
  columns: string[];
  children: React.ReactNode;
  className?: string;
  height?: number;
}) {
  const [table, setTable] = React.useState(false);
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
        <div role="group" aria-label={`${title}: view`} className="flex shrink-0 rounded-lg border border-border bg-muted p-0.5 text-xs font-medium">
          {(["Chart", "Table"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={(v === "Table") === table} onClick={() => setTable(v === "Table")} className={cn("rounded-md px-2 py-1", (v === "Table") === table ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
      </header>
      {legend && legend.length > 1 && !table && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2 text-xs text-muted-foreground">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: l.color }} aria-hidden="true" /> {l.label}
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <Table className="mt-3">
          <thead><tr>{columns.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{columns.map((c) => <Td key={c} className={typeof r[c] === "number" ? "tabular-nums" : undefined}>{typeof r[c] === "number" ? (r[c] as number).toLocaleString("en-US") : r[c]}</Td>)}</tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="px-2 pb-3 pt-2" style={{ height }}>{children}</div>
      )}
    </section>
  );
}

/** Shared look for Recharts: quiet grid and axes, tooltip on the card surface. */
export const AXIS = { tick: { fill: "var(--muted-foreground)", fontSize: 12 }, axisLine: { stroke: "var(--border)" }, tickLine: false } as const;
export const GRID = { stroke: "var(--border)", vertical: false } as const;
export const TOOLTIP = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)", fontSize: 13, padding: "8px 10px" },
  labelStyle: { color: "var(--foreground)", fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: "var(--foreground)" },
  cursor: { fill: "var(--muted)", opacity: 0.6 },
} as const;

export function StatTile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="text-[0.8125rem] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className={cn("mt-0.5 text-xs", tone === "danger" ? "font-medium text-destructive" : tone === "warn" ? "font-medium text-warn" : tone === "ok" ? "font-medium text-ok" : "text-muted-foreground")}>{note}</div>
    </div>
  );
}
