import { SPECIMEN_TYPES, isPublished, leafTests, missingResults, orderNphiesState, resultNphiesState, testByCode, type LabTest } from "@/lib/lab";
import { lastAccepted, type LabOrder } from "@/lib/fhir/types";
import { avg, sameLocalDay } from "./board-util";
import { clockState, elapsedMin } from "./clock";
import type { BoardLane, BoardStage, ClockSpec, MoveCheck } from "./types";

/* ---------- stages and lanes ---------- */

export type LabStageId = "ordered" | "collected" | "in-progress" | "entered" | "published";
export type LabLaneId = "stat" | "urgent" | "routine";

const STAGE_ORDER: LabStageId[] = ["ordered", "collected", "in-progress", "entered", "published"];

/** Target minutes per stage and lane. Demo values, a real lab sets its own. */
export const LAB_TARGET_MIN: Record<Exclude<LabStageId, "published">, Record<LabLaneId, number>> = {
  ordered: { stat: 10, urgent: 20, routine: 45 },
  collected: { stat: 10, urgent: 20, routine: 30 },
  "in-progress": { stat: 20, urgent: 40, routine: 90 },
  entered: { stat: 5, urgent: 10, routine: 20 },
};

const range = (s: Exclude<LabStageId, "published">) => `Target ${LAB_TARGET_MIN[s].stat} to ${LAB_TARGET_MIN[s].routine} min`;

export const LAB_STAGES: (BoardStage & { id: LabStageId })[] = [
  { id: "ordered", label: "Ordered", tone: "move", hint: "Waiting for a specimen", target: range("ordered") },
  { id: "collected", label: "Specimen Collected", tone: "admit", hint: "On the way to the bench", target: range("collected") },
  { id: "in-progress", label: "In Progress", tone: "update", hint: "On the analyser", target: range("in-progress") },
  { id: "entered", label: "Results Entered", tone: "merge", hint: "Waiting for a second user to verify", target: range("entered") },
  { id: "published", label: "Resulted", tone: "ok", hint: "Released to the chart", limit: 4 },
];

export const LAB_LANES: (BoardLane & { id: LabLaneId })[] = [
  { id: "stat", label: "STAT", tone: "cancel", hint: "Life threatening. Run first." },
  { id: "urgent", label: "Urgent And ASAP", tone: "merge", hint: "Needed soon." },
  { id: "routine", label: "Routine", tone: "admit", hint: "Normal turnaround." },
];

export const labLaneOf = (o: Pick<LabOrder, "priority">): LabLaneId => (o.priority === "stat" ? "stat" : o.priority === "routine" ? "routine" : "urgent");

/** The stage comes from the real status. "Results Entered" is In Progress with every result typed. Cancelled orders are not on the board. */
export function labStageOf(o: LabOrder): LabStageId | null {
  switch (o.status) {
    case "received": return "ordered";
    case "collected": return "collected";
    case "in-progress": return missingResults(o).length ? "in-progress" : "entered";
    case "resulted":
    case "amended": return "published";
    default: return null;
  }
}

export const stageLabelOf = (id: string) => LAB_STAGES.find((s) => s.id === id)?.label ?? id;

/* ---------- the rule ---------- */

const SKIP: Record<string, string> = {
  "ordered>in-progress": "Collect the specimen first.",
  "ordered>entered": "Collect the specimen and start processing before you enter results.",
  "ordered>published": "Collect the specimen, process it and enter the results before you release the result.",
  "collected>entered": "Start processing the specimen before you enter results.",
  "collected>published": "Start processing and enter every result before you move this to Resulted.",
  "in-progress>published": "Enter the results before you move this to Resulted.",
};

/** One rule for drag and for the Move menu. */
export function labCanMove(o: LabOrder, from: string, to: string): MoveCheck {
  const a = STAGE_ORDER.indexOf(from as LabStageId);
  const b = STAGE_ORDER.indexOf(to as LabStageId);
  if (a < 0 || b < 0) return { ok: false, reason: "That stage does not exist." };
  if (a === b) return { ok: false, reason: "The card is already in this stage." };
  if (o.status === "cancelled") return { ok: false, reason: "This order was cancelled." };
  if (b < a) {
    return from === "published"
      ? { ok: false, reason: "A published result cannot move back. Open the card to amend it." }
      : { ok: false, reason: "A specimen cannot go back to an earlier stage. If the order is wrong, cancel it and place a new one." };
  }
  if (b - a > 1) return { ok: false, reason: SKIP[`${from}>${to}`] ?? "Move the card one stage at a time." };
  return { ok: true };
}

/* ---------- clocks ---------- */

/** When the order entered its current stage. */
export function labStageSince(o: LabOrder, stage: LabStageId): string {
  const first = o.specimens[0];
  switch (stage) {
    case "ordered": return o.orderedAt;
    case "collected": return first?.collectedAt ?? o.orderedAt;
    case "in-progress": return first?.receivedAt ?? first?.collectedAt ?? o.orderedAt;
    case "entered": {
      const times = Object.values(o.results).map((r) => r.at).sort();
      return times[times.length - 1] ?? first?.receivedAt ?? o.orderedAt;
    }
    case "published": return lastAccepted(o.sends, "lab-result")?.at ?? o.orderedAt;
  }
}

export function labClock(o: LabOrder, stage: string): ClockSpec | null {
  if (stage === "published" || !(stage in LAB_TARGET_MIN)) return null;
  return { since: labStageSince(o, stage as LabStageId), targetMin: LAB_TARGET_MIN[stage as Exclude<LabStageId, "published">][labLaneOf(o)] };
}

/* ---------- specimen tubes ---------- */

export type TubeKind = "edta" | "serum-gold" | "serum-red" | "heparin" | "citrate" | "fluoride" | "urine" | "culture" | "neutral";

/** Standard cap colours. The hex values are the colours people know from the bench. */
export const TUBES: Record<TubeKind, { label: string; cap: string; liquid: string; shape: "tube" | "cup" | "bottle" }> = {
  edta: { label: "Lavender cap, EDTA", cap: "#a98bd6", liquid: "#b5342f", shape: "tube" },
  "serum-gold": { label: "Gold cap, serum gel", cap: "#d9a21b", liquid: "#e0b04a", shape: "tube" },
  "serum-red": { label: "Red cap, plain serum", cap: "#d2403b", liquid: "#e0b04a", shape: "tube" },
  heparin: { label: "Green cap, heparin", cap: "#3d9d62", liquid: "#e0b04a", shape: "tube" },
  citrate: { label: "Light blue cap, citrate", cap: "#6fb8e6", liquid: "#c9a14a", shape: "tube" },
  fluoride: { label: "Grey cap, fluoride", cap: "#8893a0", liquid: "#b5342f", shape: "tube" },
  urine: { label: "Yellow cup, urine", cap: "#e8cf3c", liquid: "#f1dc5e", shape: "cup" },
  culture: { label: "Culture bottle", cap: "#e07f2f", liquid: "#b5342f", shape: "bottle" },
  neutral: { label: "Specimen container", cap: "#9aa6a8", liquid: "#c9a06a", shape: "tube" },
};

const HEPARIN_CODES = new Set(["10839-9"]); // troponin
const FLUORIDE_CODES = new Set(["2345-7"]); // glucose on its own

/** Cap colour for one test. Unknown combinations get the neutral cap. */
export function tubeKindOf(t: Pick<LabTest, "code" | "specimen" | "dept" | "kind">): TubeKind {
  if (t.kind === "organism") return t.specimen === "BLD" ? "culture" : "urine";
  if (t.specimen === "URN") return "urine";
  if (t.specimen === "PLS") return "citrate";
  if (t.specimen === "BLD") {
    if (t.dept === "HM" || t.code === "4548-4") return "edta";
    return "neutral";
  }
  if (t.specimen === "SER") {
    if (HEPARIN_CODES.has(t.code)) return "heparin";
    if (t.dept === "SR") return "serum-red";
    return "serum-gold";
  }
  return "neutral";
}

/** The tubes an order needs, one per cap colour. Glucose alone goes in a grey fluoride tube, otherwise it shares the gold serum tube. */
export function tubesForOrder(o: Pick<LabOrder, "codes">): TubeKind[] {
  const tests = leafTests(o);
  const serumOthers = tests.some((t) => t.specimen === "SER" && !FLUORIDE_CODES.has(t.code) && !HEPARIN_CODES.has(t.code));
  const kinds: TubeKind[] = [];
  for (const t of tests) {
    let k = tubeKindOf(t);
    if (FLUORIDE_CODES.has(t.code) && !serumOthers) k = "fluoride";
    if (!kinds.includes(k)) kinds.push(k);
  }
  return kinds;
}

export function specimenSummary(o: Pick<LabOrder, "codes">): string {
  return [...new Set(leafTests(o).map((t) => SPECIMEN_TYPES[t.specimen].display))].join(", ");
}

/* ---------- chips, nphies, numbers ---------- */

export const testChips = (o: Pick<LabOrder, "codes">): string[] => o.codes.map((c) => testByCode(c)?.short ?? c);

export type ChipTone = "neutral" | "ok" | "warn" | "danger";

/** The NPHIES pill on a card: the order before the result is out, the result after. Amended shows the version. */
export function labNphiesChip(o: LabOrder): { label: string; tone: ChipTone } {
  if (isPublished(o)) {
    const r = resultNphiesState(o);
    const acc = lastAccepted(o.sends, "lab-result");
    if (r.tone === "ok") return { label: o.status === "amended" && acc ? `Result Amended v${acc.version}` : "Result Accepted", tone: "ok" };
    return { label: `Result ${r.label}`, tone: r.tone };
  }
  const r = orderNphiesState(o);
  return { label: `Order ${r.label}`, tone: r.tone };
}

/** How many leaf tests have a result typed, and how many there are. */
export function resultProgress(o: LabOrder): { done: number; total: number } {
  const total = leafTests(o).length;
  return { done: total - missingResults(o).length, total };
}

/** Minutes from order to the first accepted result bundle. */
export function labTurnaroundMin(o: LabOrder): number | null {
  const first = o.sends.find((s) => s.kind === "lab-result" && s.response.status === "accepted");
  return first ? (new Date(first.at).getTime() - new Date(o.orderedAt).getTime()) / 60_000 : null;
}

export interface LabStats {
  ordersToday: number;
  statWaiting: number;
  avgTurnaroundMin: number | null;
  late: number;
  cancelled: number;
}

export function labStats(orders: LabOrder[], now: number): LabStats {
  let statWaiting = 0;
  let late = 0;
  let cancelled = 0;
  const tat: number[] = [];
  for (const o of orders) {
    const st = labStageOf(o);
    if (!st) {
      cancelled += 1;
      continue;
    }
    if (st !== "published" && labLaneOf(o) === "stat") statWaiting += 1;
    const c = labClock(o, st);
    if (c && clockState(elapsedMin(c.since, now), c.targetMin) === "late") late += 1;
    const t = labTurnaroundMin(o);
    if (t !== null) tat.push(t);
  }
  return {
    ordersToday: orders.filter((o) => o.status !== "cancelled" && sameLocalDay(o.orderedAt, now)).length,
    statWaiting,
    avgTurnaroundMin: avg(tat),
    late,
    cancelled,
  };
}

/** Developer View: what each move runs. */
export const LAB_MOVE_HINT: Record<string, string> = {
  "ordered>collected": "Runs collectSpecimens. Creates the Specimen records. No NPHIES message.",
  "collected>in-progress": "Runs startProcessing. Marks the specimens received. No NPHIES message.",
  "in-progress>entered": "Opens the result editor. saveLabResult stores each value and works out the flag. No NPHIES message yet.",
  "entered>published": "Opens the sign-off. submitForVerification, then verifyAndReleaseLabResult by a second user. The result is final in the chart. Nothing is sent: it waits on the NPHIES Clinical page, which sends the result FHIR bundle (2.1).",
};
