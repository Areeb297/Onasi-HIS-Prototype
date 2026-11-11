import { cn } from "@/lib/utils";
import type { DropState } from "./board-logic";
import { gridCols } from "./layout";
import { TONE } from "./tone";
import type { BoardStage } from "./types";

/**
 * The pipeline rail. One connected line runs through a node for every stage, so the whole flow reads left to right.
 * Each node shows the stage name, how many cards are in it, its target turnaround and how many are late.
 * While a card is dragged, the stages that accept it light up and the others fade.
 */
export function RailHeader({
  stages, counts, late, drop, laneLabel,
}: {
  stages: BoardStage[];
  counts: Record<string, number>;
  late: Record<string, number>;
  /** Per stage drop state while dragging, otherwise null. */
  drop: Record<string, { state: DropState }> | null;
  laneLabel: string;
}) {
  return (
    <div className="grid border-b border-border bg-muted/30" style={{ gridTemplateColumns: gridCols(stages.length) }} role="row">
      <div className="sticky left-0 z-20 flex items-end bg-muted/90 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm" role="columnheader">
        {laneLabel}
      </div>
      {stages.map((s, i) => {
        const t = TONE[s.tone];
        const n = counts[s.id] ?? 0;
        const st = drop?.[s.id]?.state;
        const last = i === stages.length - 1;
        return (
          <div
            key={s.id}
            role="columnheader"
            aria-label={`${s.label}, ${n} ${n === 1 ? "card" : "cards"}`}
            className={cn("relative pb-2 pt-3 transition-opacity duration-150", st === "blocked" && "opacity-45", st === "valid" && cn(t.softer))}
          >
            <div className="flex h-5 items-center" aria-hidden="true">
              <span className={cn("h-0.5 w-3 shrink-0", i === 0 ? "bg-transparent" : "bg-border")} />
              <span
                className={cn(
                  "relative flex size-5 shrink-0 items-center justify-center rounded-full border-2 bg-card transition-all",
                  n > 0 ? cn(t.border, t.text) : "border-border text-muted-foreground",
                  st === "valid" && cn("scale-125 ring-4", t.ring),
                )}
              >
                <span className={cn("size-2 rounded-full", n > 0 ? t.bg : "bg-border")} />
                {st === "valid" && <span className={cn("absolute inset-0 animate-ping rounded-full border-2 motion-reduce:animate-none", t.border)} />}
              </span>
              <span className={cn("h-0.5 flex-1", last ? "bg-gradient-to-r from-border to-transparent" : n > 0 ? t.bg : "bg-border", n > 0 && !last && "opacity-60")} />
            </div>
            <div className="mt-1.5 px-3">
              <div className="flex items-center gap-1.5">
                <span className={cn("text-sm font-semibold leading-tight", t.text)}>{s.label}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums", n > 0 ? cn(t.soft, t.text) : "bg-muted text-muted-foreground")}>{n}</span>
                {(late[s.id] ?? 0) > 0 && (
                  <span className="rounded-full bg-cancel/14 px-1.5 py-0.5 text-xs font-semibold leading-none text-cancel" title="Cards past their target time">
                    {late[s.id]} late
                  </span>
                )}
              </div>
              {s.hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.hint}</p>}
              {s.target && <p className="mt-0.5 text-xs font-medium leading-snug text-muted-foreground/90">{s.target}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
