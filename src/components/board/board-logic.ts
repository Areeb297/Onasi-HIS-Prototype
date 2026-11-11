import type { BoardStage, MoveCheck } from "./types";

/** Cells are keyed lane|stage. */
export const cellKey = (laneId: string, stageId: string) => `${laneId}|${stageId}`;

export function groupByCell<C>(cards: C[], laneOf: (c: C) => string, stageOf: (c: C) => string): Map<string, C[]> {
  const map = new Map<string, C[]>();
  for (const c of cards) {
    const k = cellKey(laneOf(c), stageOf(c));
    const list = map.get(k);
    if (list) list.push(c);
    else map.set(k, [c]);
  }
  return map;
}

export type DropState = "origin" | "valid" | "blocked";

/** For one dragged card: which columns accept it, which refuse it and why. */
export function dropStates<C>(
  card: C,
  from: string,
  stages: BoardStage[],
  canMove: (c: C, from: string, to: string) => MoveCheck,
): Record<string, { state: DropState; reason?: string }> {
  const out: Record<string, { state: DropState; reason?: string }> = {};
  for (const s of stages) {
    if (s.id === from) {
      out[s.id] = { state: "origin" };
      continue;
    }
    const chk = canMove(card, from, s.id);
    out[s.id] = chk.ok ? { state: "valid" } : { state: "blocked", reason: chk.reason };
  }
  return out;
}

/** Stages in the order of the pipeline, after the given one. */
export const stagesAfter = (stages: BoardStage[], id: string) => stages.slice(stages.findIndex((s) => s.id === id) + 1);

export const stageIndex = (stages: { id: string }[], id: string) => stages.findIndex((s) => s.id === id);

/** Plain-English refusal used by most boards when someone drags a card backwards. */
export const BACKWARDS = (what: string) => `${what} cannot go back to an earlier stage.`;
