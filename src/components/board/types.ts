import type * as React from "react";

/** Colour tokens from index.css. "muted" is the neutral grey. */
export type BoardTone = "admit" | "move" | "update" | "merge" | "ok" | "cancel" | "muted";

/** The answer of every canMove rule. A refusal always carries a reason in plain English. */
export type MoveCheck = { ok: true } | { ok: false; reason: string };

/**
 * What onMove returns.
 *  true        the action ran and the card is now in the new stage
 *  false       the action failed, the board puts the card back
 *  "deferred"  the move needs input, an editor or dialog was opened. The card moves later, when the data says so.
 */
export type MoveResult = boolean | "deferred";

export type MoveVia = "drag" | "menu";

export interface BoardStage {
  id: string;
  label: string;
  tone: BoardTone;
  /** One short line shown under the stage name in the rail. */
  hint?: string;
  /** Target turnaround text for the rail, for example "Target 10 to 45 min". */
  target?: string;
  /** Show at most this many cards in a cell, with a "Show more" button. Good for the last stage. */
  limit?: number;
}

export interface BoardLane {
  id: string;
  label: string;
  tone: BoardTone;
  hint?: string;
  icon?: React.ReactNode;
}

/** Time in the current stage against a target. */
export interface ClockSpec {
  /** ISO time the card entered its stage. */
  since: string;
  targetMin: number;
}

export interface CardCtx {
  stage: BoardStage;
  lane: BoardLane;
  now: number;
  /** True for the tilted copy that follows the pointer. */
  overlay: boolean;
  dev: boolean;
  /** Ask the board to move this card, through the same rules and actions as a drop. Use it for the main button on the card. */
  move: (toStageId: string) => void;
}
