import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { IconBan, IconArrowBarToDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { DropState } from "./board-logic";
import { TONE } from "./tone";
import type { BoardTone } from "./types";

/** The dashed slot that appears under the pointer when the drop is allowed. */
export function DropSlot({ tone, label }: { tone: BoardTone; label: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed bg-card px-2 py-3 text-xs font-medium", TONE[tone].border, TONE[tone].text)} aria-hidden="true">
      <IconArrowBarToDown className="size-4" stroke={1.75} />
      {label}
    </div>
  );
}

/** Shown under the pointer when the drop is refused, with the reason. */
export function BlockedNote({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-lg border-2 border-dashed border-cancel/60 bg-cancel/8 px-2 py-2 text-xs font-medium text-cancel" role="note">
      <IconBan className="mt-px size-4 shrink-0" stroke={1.75} />
      <span>{reason}</span>
    </div>
  );
}

const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--border)_70%,transparent)_7px_8px)]";

/**
 * One cell of the matrix (a lane in a stage). Droppable. While a card is being dragged it shows whether the drop is
 * allowed: valid cells get a dashed outline in the stage colour, refused cells are hatched and dimmed.
 */
export function DropCell({
  laneId, stageId, tone, state, reason, ownLane, dropLabel, compact, children,
}: {
  laneId: string;
  stageId: string;
  tone: BoardTone;
  /** null when nothing is being dragged. */
  state: DropState | null;
  reason?: string;
  /** The cell is in the lane of the dragged card. */
  ownLane: boolean;
  dropLabel: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${laneId}|${stageId}`, data: { laneId, stageId } });
  const t = TONE[tone];
  return (
    <div
      ref={setNodeRef}
      data-cell={`${laneId}|${stageId}`}
      data-drop={state ?? "idle"}
      className={cn(
        "relative min-w-0 border-l border-border/70 p-2 transition-[background-color,opacity,outline-color] duration-150",
        compact ? "min-h-11" : "min-h-24",
        state === "valid" && cn("outline-2 -outline-offset-4 outline-dashed", t.outline, ownLane ? t.softer : "bg-transparent"),
        state === "valid" && isOver && cn(t.soft, "outline-solid"),
        state === "blocked" && cn("opacity-50", HATCH),
        state === "origin" && "bg-muted/40",
      )}
    >
      <div className="space-y-2">{children}</div>
      {/* Drawn on top, not in the flow, so the other cells never shift while the pointer is moving. */}
      {state === "valid" && isOver && <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 shadow-lg"><DropSlot tone={tone} label={dropLabel} /></div>}
      {state === "blocked" && isOver && reason && <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 bg-card shadow-lg"><BlockedNote reason={reason} /></div>}
    </div>
  );
}
