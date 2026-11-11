import * as React from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { dropStates, groupByCell, cellKey } from "./board-logic";
import { CardFace, DraggableCard } from "./CardShell";
import { clockState, elapsedMin } from "./clock";
import { boardMinWidth } from "./layout";
import { Lane } from "./Lane";
import { MoveMenu } from "./MoveMenu";
import { RailHeader } from "./RailHeader";
import { TONE } from "./tone";
import type { BoardLane, BoardStage, CardCtx, ClockSpec, MoveCheck, MoveResult, MoveVia } from "./types";
import { useBoardMove } from "./useBoardMove";

/**
 * SwimBoard: a matrix of swim lanes (rows) and workflow stages (columns) with drag and drop that obeys safety rules.
 * Generic over the card type C. Lab, radiology and pharmacy use it now. The ED board can use it later.
 *
 * Data (all read only, the board never owns the data):
 *   lanes        BoardLane[]   rows, for example priority or modality
 *   stages       BoardStage[]  columns in pipeline order. Each has a label, a colour tone, an optional hint and target text
 *   cards        C[]
 *   getId        (c) => string        stable id of a card
 *   label        (c) => string        short name for screen readers and toasts, for example "Sara Alamri, CBC"
 *   laneOf       (c) => laneId        the lane is a fact about the card. It is never changed by dropping
 *   stageOf      (c) => stageId       derive the stage from the real status. The card moves when the data changes
 *   renderCard   (c, ctx) => node     the inside of the card. ctx has stage, lane, now, overlay, dev
 *
 * Rules and actions:
 *   canMove      (c, from, to) => { ok: true } | { ok: false, reason }   one function for every move, drag or menu
 *   onMove       (c, from, to, via) => boolean | "deferred" | Promise<...>
 *                  true      the action ran, the card is in the new stage
 *                  false     the action failed, the card springs back
 *                  "deferred" an editor or dialog was opened, the card moves later when the data says so
 *   onMoved      (c, from, to, via) => void   called once a move really happened (audit trail goes here)
 *   canDrag      (c) => MoveCheck     permission gate. A refusal makes the card locked and disables its Move menu
 *
 * Extras:
 *   clockOf      (c, stageId) => { since, targetMin } | null   turnaround clock. Drives the "late" count in the rail
 *   moveHint     (c, from, to) => string | undefined   what a move runs. Shown in Developer View only
 *   dev          boolean       Developer View
 *   storageKey   string        remembers which lanes are collapsed
 *   now          number        inject the clock in tests
 *   ariaLabel    string
 *
 * An invalid drop springs back, shakes the card and shows a warn toast with the reason. Every move can also be done
 * with the Move menu on the card, or with the keyboard: Tab to a card, Space, arrow keys, Space.
 */
export interface SwimBoardProps<C> {
  lanes: BoardLane[];
  stages: BoardStage[];
  cards: C[];
  getId: (c: C) => string;
  label: (c: C) => string;
  laneOf: (c: C) => string;
  stageOf: (c: C) => string;
  renderCard: (c: C, ctx: CardCtx) => React.ReactNode;
  canMove: (c: C, from: string, to: string) => MoveCheck;
  onMove: (c: C, from: string, to: string, via: MoveVia) => MoveResult | Promise<MoveResult>;
  onMoved?: (c: C, from: string, to: string, via: MoveVia) => void;
  canDrag?: (c: C) => MoveCheck;
  clockOf?: (c: C, stageId: string) => ClockSpec | null;
  moveHint?: (c: C, from: string, to: string) => string | undefined;
  dev?: boolean;
  storageKey?: string;
  now?: number;
  ariaLabel?: string;
  laneHeading?: string;
}

function useNow(ms: number, fixed?: number) {
  const [now, setNow] = React.useState(() => fixed ?? Date.now());
  React.useEffect(() => {
    if (fixed !== undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, fixed]);
  return fixed ?? now;
}

function loadCollapsed(key?: string): Record<string, boolean> {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(`onasi-swimboard-${key}`);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Arrow keys jump to the neighbouring cell instead of moving 25 pixels at a time. */
const cellKeyboard: KeyboardCoordinateGetter = (event, { context: { active, droppableRects, droppableContainers, collisionRect } }) => {
  const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const dir = dirs[event.code];
  if (!dir || !active || !collisionRect) return undefined;
  event.preventDefault();
  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  let best: { x: number; y: number } | undefined;
  let bestScore = Infinity;
  for (const c of droppableContainers.getEnabled()) {
    const r = droppableRects.get(c.id);
    if (!r) continue;
    const tx = r.left + r.width / 2;
    const ty = r.top + Math.min(r.height / 2, 60);
    const along = dir[0] ? (tx - cx) * dir[0] : (ty - cy) * dir[1];
    if (along < 12) continue;
    const across = dir[0] ? Math.abs(ty - cy) : Math.abs(tx - cx);
    const score = along + across * 4;
    if (score < bestScore) {
      bestScore = score;
      best = { x: tx - collisionRect.width / 2, y: ty - collisionRect.height / 2 };
    }
  }
  return best;
};

const noop = () => {};

const detect: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

export function SwimBoard<C>(props: SwimBoardProps<C>) {
  const { lanes, stages, cards, getId, label, laneOf, stageOf, renderCard, canMove, canDrag, clockOf, moveHint, dev = false, storageKey, ariaLabel, laneHeading = "Lane" } = props;
  const now = useNow(30_000, props.now);
  const stageById = React.useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const laneById = React.useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const stageLabel = React.useCallback((id: string) => stageById.get(id)?.label ?? id, [stageById]);

  const mv = useBoardMove<C>({
    cards, getId, stageOf, stageLabel, label, canMove, onMove: props.onMove, onMoved: props.onMoved,
  });

  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(() => loadCollapsed(storageKey));
  const toggleLane = (id: string) =>
    setCollapsed((c) => {
      const next = { ...c, [id]: !c[id] };
      if (storageKey) {
        try {
          localStorage.setItem(`onasi-swimboard-${storageKey}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overStage, setOverStage] = React.useState<string | null>(null);
  const activeCard = activeId ? cards.find((c) => getId(c) === activeId) : undefined;
  const activeFrom = activeCard ? mv.stageNow(activeCard) : null;
  const drop = React.useMemo(
    () => (activeCard && activeFrom ? dropStates(activeCard, activeFrom, stages, canMove) : null),
    [activeCard, activeFrom, stages, canMove],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: cellKeyboard }),
  );

  // Cards by cell, with the optimistic stage applied.
  const visible = cards.filter((c) => stageById.has(mv.stageNow(c)));
  const grouped = groupByCell(visible, (c) => (laneById.has(laneOf(c)) ? laneOf(c) : lanes[0].id), mv.stageNow);

  const counts: Record<string, number> = {};
  const late: Record<string, number> = {};
  for (const c of visible) {
    const st = mv.stageNow(c);
    counts[st] = (counts[st] ?? 0) + 1;
    const clock = clockOf?.(c, st);
    if (clock && clockState(elapsedMin(clock.since, now), clock.targetMin) === "late") late[st] = (late[st] ?? 0) + 1;
  }

  const lockedOf = (c: C): MoveCheck => canDrag?.(c) ?? { ok: true };

  function cardNode(c: C, laneId: string) {
    const id = getId(c);
    const st = mv.stageNow(c);
    const stage = stageById.get(st)!;
    const lane = laneById.get(laneId)!;
    const locked = lockedOf(c);
    return (
      <DraggableCard
        key={id}
        id={id}
        label={label(c)}
        lane={lane}
        locked={locked}
        flash={mv.recent === id}
        shakeN={mv.shake?.id === id ? mv.shake.n : 0}
        controls={
          <MoveMenu
            label={label(c)}
            from={st}
            stages={stages}
            check={(to) => canMove(c, st, to)}
            locked={locked}
            hint={moveHint ? (to) => moveHint(c, st, to) : undefined}
            dev={dev}
            onPick={(to) => mv.move(c, to, "menu")}
          />
        }
      >
        {renderCard(c, { stage, lane, now, overlay: false, dev, move: (to) => mv.move(c, to, "menu") })}
      </DraggableCard>
    );
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const c = cards.find((x) => getId(x) === String(active.id));
      return c ? `Picked up ${label(c)}. Use the arrow keys to choose a stage, space to drop, escape to cancel.` : undefined;
    },
    onDragOver: ({ over }) => {
      const sid = over?.data.current?.stageId as string | undefined;
      if (!sid || !drop) return undefined;
      const d = drop[sid];
      if (!d) return undefined;
      if (d.state === "origin") return `Over ${stageLabel(sid)}, where the card is now.`;
      return d.state === "valid" ? `Over ${stageLabel(sid)}. You can drop here.` : `Over ${stageLabel(sid)}. Not allowed. ${d.reason}`;
    },
    onDragEnd: () => undefined,
    onDragCancel: () => "Move cancelled. The card stays where it was.",
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    mv.setMessage("");
  }
  function onDragOver(e: DragOverEvent) {
    setOverStage((e.over?.data.current?.stageId as string | undefined) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    const card = cards.find((c) => getId(c) === String(e.active.id));
    const to = e.over?.data.current?.stageId as string | undefined;
    setActiveId(null);
    setOverStage(null);
    if (card && to) mv.move(card, to, "drag");
  }
  function onDragCancel() {
    setActiveId(null);
    setOverStage(null);
  }

  const overDrop = overStage && drop ? drop[overStage] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detect}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "To pick up this card, press space. Then use the arrow keys to move it to another stage and press space to drop it. Press escape to cancel. You can also use the Move button on the card.",
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className={cn("overflow-x-auto rounded-xl border border-border bg-card", activeId && "select-none")} role="table" aria-label={ariaLabel ?? "Swim lane board"}>
        <div style={{ minWidth: boardMinWidth(stages.length) }}>
          <RailHeader stages={stages} counts={counts} late={late} drop={drop} laneLabel={laneHeading} />
          {lanes.map((lane) => {
            const items: Record<string, React.ReactNode[]> = {};
            for (const s of stages) items[s.id] = (grouped.get(cellKey(lane.id, s.id)) ?? []).map((c) => cardNode(c, lane.id));
            return (
              <Lane
                key={lane.id}
                lane={lane}
                stages={stages}
                collapsed={!!collapsed[lane.id]}
                onToggle={() => toggleLane(lane.id)}
                items={items}
                drop={drop}
                dragLaneId={activeCard ? laneOf(activeCard) : null}
              />
            );
          })}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 300, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
        {activeCard && activeFrom ? (
          <div>
            <CardFace lane={laneById.get(laneOf(activeCard)) ?? lanes[0]} overlay>
              {renderCard(activeCard, { stage: stageById.get(activeFrom)!, lane: laneById.get(laneOf(activeCard)) ?? lanes[0], now, overlay: true, dev, move: noop })}
            </CardFace>
            {overStage && overDrop && overDrop.state !== "origin" && (
              <div
                className={cn(
                  "mt-2 rounded-md px-2 py-1 text-xs font-medium shadow-md",
                  overDrop.state === "valid" ? cn("text-white", TONE[stageById.get(overStage)?.tone ?? "admit"].bg) : "bg-cancel text-white",
                )}
              >
                {overDrop.state === "valid" ? `Release to move to ${stageLabel(overStage)}` : overDrop.reason}
                {dev && overDrop.state === "valid" && moveHint?.(activeCard, activeFrom, overStage) && (
                  <span className="mt-0.5 block font-mono text-xs font-normal opacity-90">{moveHint(activeCard, activeFrom, overStage)}</span>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>

      <div role="status" aria-live="polite" className="sr-only">{mv.message}</div>
    </DndContext>
  );
}
