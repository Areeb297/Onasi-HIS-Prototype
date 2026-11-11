import { fillOf, getDrug, linesFor, openItems } from "@/lib/rx";
import type { FillType, Prescription, RxState } from "@/lib/rx-types";
import { avg, sameLocalDay } from "./board-util";
import { clockState, elapsedMin } from "./clock";
import type { BoardLane, BoardStage, ClockSpec, MoveCheck } from "./types";

export type RxStageId = "pending" | "partial" | "dispensed";
export type RxLaneId = "controlled" | "standard";

const STAGE_ORDER: RxStageId[] = ["pending", "partial", "dispensed"];

/** Target minutes per stage and lane. Pending: sent to first dispense. Partial: until the rest is handed over. Demo values. */
export const RX_TARGET_MIN: Record<Exclude<RxStageId, "dispensed">, Record<RxLaneId, number>> = {
  pending: { controlled: 15, standard: 30 },
  partial: { controlled: 60, standard: 120 },
};

export const RX_STAGES: (BoardStage & { id: RxStageId })[] = [
  { id: "pending", label: "Pending", tone: "move", hint: "Sent by the doctor, nothing handed over", target: "Target 15 to 30 min" },
  { id: "partial", label: "Partly Dispensed", tone: "merge", hint: "Some items or some quantity still owed", target: "Target 1 to 2 h to finish" },
  { id: "dispensed", label: "Dispensed", tone: "ok", hint: "Everything handed over", limit: 4 },
];

export const RX_LANES: (BoardLane & { id: RxLaneId })[] = [
  { id: "controlled", label: "Controlled Drugs", tone: "cancel", hint: "Narcotic, controlled or restricted. Scan and secure code." },
  { id: "standard", label: "Standard", tone: "admit", hint: "Uncontrolled medicines." },
];

export const rxLaneOf = (rx: Pick<Prescription, "controlled">): RxLaneId => (rx.controlled ? "controlled" : "standard");

/**
 * The stage comes from the dispense lines. Prescriptions that are on hold, stopped or cancelled are not on the board (null).
 * Not sent prescriptions are not on the pharmacy list at all.
 */
export function rxStageOf(s: RxState, rx: Prescription): RxStageId | null {
  if (!rx.sentAt) return null;
  if (openItems(s, rx).length > 0) return rx.items.some((i) => fillOf(s, rx, i).dispensedTotal > 0) ? "partial" : "pending";
  if (rx.items.some((i) => i.status === "on-hold" || i.status === "stopped")) return null;
  if (rx.items.every((i) => i.status === "cancelled")) return null;
  return "dispensed";
}

export const rxStageLabel = (id: string) => RX_STAGES.find((s) => s.id === id)?.label ?? id;

/* ---------- the rule ---------- */

/**
 * Every forward move opens the dispense dialog, because quantities, scans and (for controlled items) the secure code
 * must be entered. Nothing can be dragged backwards: a dispense is a record that was sent to NPHIES.
 */
export function rxCanMove(_rx: Prescription, from: string, to: string): MoveCheck {
  const a = STAGE_ORDER.indexOf(from as RxStageId);
  const b = STAGE_ORDER.indexOf(to as RxStageId);
  if (a < 0 || b < 0) return { ok: false, reason: "That stage does not exist." };
  if (a === b) return { ok: false, reason: "The card is already in this stage." };
  if (b < a) {
    return from === "dispensed"
      ? { ok: false, reason: "Handed over medicine cannot move back. To undo a controlled item, use Update Dispense or Cancel Dispense in the Table view." }
      : { ok: false, reason: "Part of this prescription is already handed over, so it cannot go back to Pending." };
  }
  return { ok: true };
}

/* ---------- clocks ---------- */

export function rxStageSince(s: RxState, rx: Prescription, stage: RxStageId): string {
  const mine = s.dispenses.filter((d) => d.rxId === rx.id).map((d) => d.handedOverAt).sort();
  if (stage === "pending") return rx.sentAt ?? rx.authoredAt;
  return mine[mine.length - 1] ?? rx.sentAt ?? rx.authoredAt;
}

export function rxClock(s: RxState, rx: Prescription, stage: string): ClockSpec | null {
  if (stage !== "pending" && stage !== "partial") return null;
  return { since: rxStageSince(s, rx, stage), targetMin: RX_TARGET_MIN[stage][rxLaneOf(rx)] };
}

/* ---------- fill progress ---------- */

export interface ItemFill {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  dispensed: number;
  remaining: number;
  /** FF, FFP or FFC of the latest completed dispense line. */
  lastType?: FillType;
  done: boolean;
}

export function itemFills(s: RxState, rx: Prescription): ItemFill[] {
  const lines = linesFor(s, rx.id);
  return rx.items
    .filter((i) => i.status !== "cancelled")
    .map((i) => {
      const d = getDrug(i.drugId);
      const f = fillOf(s, rx, i);
      const last = lines.filter((l) => l.itemId === i.id && l.status === "completed").at(-1);
      return {
        id: i.id,
        name: `${d.generic} ${d.strengthValue} ${d.strengthUnit}`,
        unit: d.unit,
        quantity: i.quantity,
        dispensed: f.dispensedTotal,
        remaining: f.remaining,
        lastType: last?.type,
        done: f.done,
      };
    });
}

/* ---------- numbers ---------- */

export interface RxStats {
  waiting: number;
  controlledWaiting: number;
  dispensedToday: number;
  avgWaitMin: number | null;
  late: number;
  offBoard: number;
}

export function rxStats(s: RxState, now: number): RxStats {
  let waiting = 0;
  let controlledWaiting = 0;
  let late = 0;
  let offBoard = 0;
  const waits: number[] = [];
  const sent = s.prescriptions.filter((r) => r.sentAt);
  for (const rx of sent) {
    const st = rxStageOf(s, rx);
    if (!st) {
      offBoard += 1;
      continue;
    }
    if (st !== "dispensed") {
      waiting += 1;
      if (rx.controlled) controlledWaiting += 1;
    }
    const c = rxClock(s, rx, st);
    if (c && clockState(elapsedMin(c.since, now), c.targetMin) === "late") late += 1;
    const first = s.dispenses.filter((d) => d.rxId === rx.id).map((d) => d.handedOverAt).sort()[0];
    if (first && rx.sentAt) waits.push((new Date(first).getTime() - new Date(rx.sentAt).getTime()) / 60_000);
  }
  const todays = new Set(s.dispenses.filter((d) => sameLocalDay(d.handedOverAt, now)).map((d) => d.rxId));
  return { waiting, controlledWaiting, dispensedToday: todays.size, avgWaitMin: avg(waits), late, offBoard };
}

export const RX_MOVE_HINT = "Opens the dispense dialog. Dispense and Send runs sendDispense: a MedicationDispense bundle (FF, FFP or FFC) goes to NPHIES, with the Raqeeb secure code for controlled items.";
