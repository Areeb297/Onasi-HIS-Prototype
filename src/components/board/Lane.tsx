import * as React from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { DropState } from "./board-logic";
import { DropCell } from "./DropIndicators";
import { gridCols } from "./layout";
import { TONE } from "./tone";
import type { BoardLane, BoardStage } from "./types";

/**
 * One swim lane: a collapsible row with the lane name and count on the left and one droppable cell per stage.
 * A collapsed lane shows only the counts. It still accepts drops.
 */
export function Lane({
  lane, stages, collapsed, onToggle, items, drop, dragLaneId,
}: {
  lane: BoardLane;
  stages: BoardStage[];
  collapsed: boolean;
  onToggle: () => void;
  /** Rendered cards per stage id. */
  items: Record<string, React.ReactNode[]>;
  /** Per stage drop state while dragging, otherwise null. */
  drop: Record<string, { state: DropState; reason?: string }> | null;
  dragLaneId: string | null;
}) {
  const total = stages.reduce((n, s) => n + (items[s.id]?.length ?? 0), 0);
  const [more, setMore] = React.useState<Record<string, boolean>>({});
  const t = TONE[lane.tone];
  const compact = total === 0;
  return (
    <div className="grid border-b border-border last:border-b-0" style={{ gridTemplateColumns: gridCols(stages.length) }} role="row" aria-label={`${lane.label} lane, ${total} ${total === 1 ? "card" : "cards"}`}>
      <div className="sticky left-0 z-10 flex min-w-0 bg-card" role="rowheader">
        <span className={cn("w-1 shrink-0", t.stripe)} aria-hidden="true" />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${lane.label} lane, ${total} ${total === 1 ? "card" : "cards"}. ${collapsed ? "Expand" : "Collapse"}`}
          className="flex min-w-0 flex-1 items-start gap-1.5 px-2 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <IconChevronRight className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} stroke={1.75} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              {lane.icon}
              <span className={cn("truncate text-sm font-semibold", t.text)}>{lane.label}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums", total ? cn(t.soft, t.text) : "bg-muted text-muted-foreground")}>{total}</span>
            </span>
            {lane.hint && !compact && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{lane.hint}</span>}
          </span>
        </button>
      </div>
      {stages.map((s) => {
        const list = items[s.id] ?? [];
        const d = drop?.[s.id];
        const limit = s.limit && !more[s.id] ? s.limit : undefined;
        const shown = limit && list.length > limit ? list.slice(0, limit) : list;
        return (
          <DropCell
            key={s.id}
            laneId={lane.id}
            stageId={s.id}
            tone={s.tone}
            state={d?.state ?? null}
            reason={d?.reason}
            ownLane={dragLaneId === lane.id}
            dropLabel={`Move to ${s.label}`}
            compact={compact || collapsed}
          >
            {collapsed ? (
              list.length > 0 && (
                <span className={cn("inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", TONE[s.tone].soft, TONE[s.tone].text)}>{list.length}</span>
              )
            ) : (
              <>
                {shown}
                {limit && list.length > limit && (
                  <button type="button" onClick={() => setMore((m) => ({ ...m, [s.id]: true }))} className="w-full rounded-md border border-dashed border-border py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                    Show {list.length - limit} More
                  </button>
                )}
              </>
            )}
          </DropCell>
        );
      })}
    </div>
  );
}
