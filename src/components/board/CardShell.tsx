import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { IconGripVertical, IconLock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { TONE } from "./tone";
import type { BoardLane, MoveCheck } from "./types";

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The look of a card: a lane-coloured edge, the content, and a handle strip with the grip and the Move menu. */
export function CardFace({
  lane, children, controls, locked, overlay, ghost, flash, className, ...rest
}: {
  lane: BoardLane;
  children: React.ReactNode;
  controls?: React.ReactNode;
  locked?: MoveCheck;
  overlay?: boolean;
  /** The card is being dragged: the original stays behind as a faded outline. */
  ghost?: boolean;
  flash?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"div">, "className" | "children">) {
  const isLocked = !!locked && !locked.ok;
  return (
    <div
      {...rest}
      className={cn(
        "relative flex overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm outline-none transition-shadow",
        "focus-visible:ring-2 focus-visible:ring-ring",
        !isLocked && !overlay && "cursor-grab hover:shadow-md active:cursor-grabbing",
        ghost && "border-dashed opacity-35",
        flash && "ring-2 ring-primary/60",
        overlay && "rotate-[2.5deg] cursor-grabbing scale-[1.03] shadow-2xl ring-2 ring-primary/40",
        className,
      )}
    >
      <span className={cn("w-1 shrink-0", TONE[lane.tone].stripe)} aria-hidden="true" />
      <div className="min-w-0 flex-1 p-2.5">{children}</div>
      <div className="flex w-8 shrink-0 flex-col items-center justify-between gap-1 border-l border-dashed border-border/80 bg-muted/40 py-1">
        {isLocked ? (
          <span title={locked!.ok ? undefined : locked!.reason} className="flex size-7 items-center justify-center text-muted-foreground">
            <IconLock className="size-4" stroke={1.75} aria-label={locked!.ok ? undefined : locked!.reason} />
          </span>
        ) : (
          <span className="flex size-7 touch-none items-center justify-center text-muted-foreground" title="Drag to move. Use the arrows button if you prefer not to drag." aria-hidden="true">
            <IconGripVertical className="size-4" stroke={1.75} />
          </span>
        )}
        {controls}
      </div>
    </div>
  );
}

/** A card that can be picked up with the pointer or the keyboard. Needs a DndContext above it. */
export function DraggableCard({
  id, label, lane, locked, controls, flash, shakeN, children,
}: {
  id: string;
  label: string;
  lane: BoardLane;
  locked: MoveCheck;
  controls: React.ReactNode;
  flash: boolean;
  /** Goes up each time a move of this card was refused. */
  shakeN: number;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !locked.ok });
  const el = React.useRef<HTMLDivElement | null>(null);
  const setRef = React.useCallback((node: HTMLDivElement | null) => {
    el.current = node;
    setNodeRef(node);
  }, [setNodeRef]);

  React.useEffect(() => {
    const node = el.current;
    if (!shakeN || !node || reduced() || typeof node.animate !== "function") return;
    node.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-7px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(0)" }],
      { duration: 320, easing: "ease-out" },
    );
  }, [shakeN]);

  return (
    <CardFace
      ref={setRef}
      lane={lane}
      locked={locked}
      controls={controls}
      ghost={isDragging}
      flash={flash}
      {...(locked.ok ? attributes : {})}
      {...(locked.ok ? listeners : {})}
      role="group"
      aria-label={label}
      data-card-id={id}
    >
      {children}
    </CardFace>
  );
}
