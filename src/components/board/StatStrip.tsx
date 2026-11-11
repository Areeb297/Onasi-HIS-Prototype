import { cn } from "@/lib/utils";
import { TONE } from "./tone";
import type { BoardTone } from "./types";

export interface Stat {
  label: string;
  value: string | number;
  note?: string;
  tone?: BoardTone;
}

/** The strip of live numbers above a board. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="mb-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="Live numbers">
      {stats.map((s) => (
        <div key={s.label} role="listitem" className="bg-card px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums leading-tight", s.tone && s.tone !== "muted" ? TONE[s.tone].text : "text-foreground")}>{s.value}</div>
          {s.note && <div className="text-xs text-muted-foreground">{s.note}</div>}
        </div>
      ))}
    </div>
  );
}
