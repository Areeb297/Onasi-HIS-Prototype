import { lastAccepted, type RadOrder } from "@/lib/fhir/types";
import { isRadPublished, procByCode, radOrderNphiesState, radReportNphiesState, reportMissing } from "@/lib/radiology";
import { avg, sameLocalDay } from "./board-util";
import { clockState, elapsedMin } from "./clock";
import type { BoardLane, BoardStage, ClockSpec, MoveCheck } from "./types";

/* ---------- stages and lanes ---------- */

export type RadStageId = "ordered" | "performed" | "reporting" | "reported";
export type RadLaneId = "xray" | "ct" | "mri" | "us" | "other";
type Prio = "stat" | "urgent" | "routine";

const STAGE_ORDER: RadStageId[] = ["ordered", "performed", "reporting", "reported"];

/** Target minutes. Exam: order to exam done. Report: exam done to report published. Demo values. */
export const RAD_EXAM_TARGET_MIN: Record<Prio, number> = { stat: 15, urgent: 60, routine: 240 };
export const RAD_REPORT_TARGET_MIN: Record<Prio, number> = { stat: 30, urgent: 120, routine: 1440 };

export const RAD_STAGES: (BoardStage & { id: RadStageId })[] = [
  { id: "ordered", label: "Ordered", tone: "move", hint: "Waiting for the exam", target: "Exam target 15 min to 4 h" },
  { id: "performed", label: "Exam Done", tone: "admit", hint: "Images taken, no report yet", target: "Report target 30 min to 24 h" },
  { id: "reporting", label: "Reporting", tone: "update", hint: "Radiologist is writing", target: "Report target 30 min to 24 h" },
  { id: "reported", label: "Reported", tone: "ok", hint: "Released to the chart", limit: 4 },
];

export const RAD_LANES: (BoardLane & { id: RadLaneId })[] = [
  { id: "xray", label: "X-Ray", tone: "move", hint: "Plain film" },
  { id: "ct", label: "CT", tone: "update", hint: "Computed tomography" },
  { id: "mri", label: "MRI", tone: "admit", hint: "Magnetic resonance" },
  { id: "us", label: "Ultrasound", tone: "merge", hint: "Sound waves" },
  { id: "other", label: "Other", tone: "muted", hint: "Mammography and bone density" },
];

const MODALITY_LANE: Record<string, RadLaneId> = { DX: "xray", CR: "xray", CT: "ct", MR: "mri", US: "us" };

export const radLaneOf = (o: Pick<RadOrder, "procCode">): RadLaneId => MODALITY_LANE[procByCode(o.procCode)?.modality ?? ""] ?? "other";

const prioOf = (o: Pick<RadOrder, "priority">): Prio => (o.priority === "stat" ? "stat" : o.priority === "routine" ? "routine" : "urgent");

/** A report counts as started once the radiologist typed findings or an impression. */
export const reportStarted = (o: RadOrder): boolean => !!o.report && (!!o.report.findings.trim() || !!o.report.impression.trim());

export function radStageOf(o: RadOrder): RadStageId | null {
  switch (o.status) {
    case "received": return "ordered";
    case "performed": return reportStarted(o) ? "reporting" : "performed";
    case "resulted":
    case "amended": return "reported";
    default: return null;
  }
}

export const radStageLabel = (id: string) => RAD_STAGES.find((s) => s.id === id)?.label ?? id;

/* ---------- the rule ---------- */

const SKIP: Record<string, string> = {
  "ordered>reporting": "Mark the exam as performed before you write the report.",
  "ordered>reported": "Perform the exam and write the report before you publish.",
  "performed>reported": "Write the report before you move this to Reported.",
};

export function radCanMove(o: RadOrder, from: string, to: string): MoveCheck {
  const a = STAGE_ORDER.indexOf(from as RadStageId);
  const b = STAGE_ORDER.indexOf(to as RadStageId);
  if (a < 0 || b < 0) return { ok: false, reason: "That stage does not exist." };
  if (a === b) return { ok: false, reason: "The card is already in this stage." };
  if (o.status === "cancelled") return { ok: false, reason: "This order was cancelled." };
  if (b < a) {
    return from === "reported"
      ? { ok: false, reason: "A published report cannot move back. Open the card to amend it." }
      : { ok: false, reason: "An exam that was done cannot go back. If it was a mistake, cancel the order and place a new one." };
  }
  if (b - a > 1) return { ok: false, reason: SKIP[`${from}>${to}`] ?? "Move the card one stage at a time." };
  if (to === "reported") {
    const miss = reportMissing(o);
    if (miss.length) return { ok: false, reason: `Add the ${miss.join(" and the ").toLowerCase()} before you publish the report.` };
  }
  return { ok: true };
}

/* ---------- clocks ---------- */

export function radStageSince(o: RadOrder, stage: RadStageId): string {
  if (stage === "ordered") return o.orderedAt;
  if (stage === "reported") return lastAccepted(o.sends, "rad-report")?.at ?? o.orderedAt;
  return o.study?.performedEnd ?? o.orderedAt;
}

/** Ordered counts down the exam target. Exam Done and Reporting count down the report due time. Reported has no clock. */
export function radClock(o: RadOrder, stage: string): ClockSpec | null {
  if (stage === "ordered") return { since: o.orderedAt, targetMin: RAD_EXAM_TARGET_MIN[prioOf(o)] };
  if (stage === "performed" || stage === "reporting") return { since: radStageSince(o, "performed"), targetMin: RAD_REPORT_TARGET_MIN[prioOf(o)] };
  return null;
}

/* ---------- labels ---------- */

export const MODALITY_SHORT: Record<string, string> = { DX: "X-Ray", CR: "X-Ray", CT: "CT", MR: "MRI", US: "Ultrasound", MG: "Mammography", BMD: "Bone Density" };

export const REGION_SHORT: Record<string, string> = {
  chest: "Chest", abdomen: "Abdomen", head: "Head", pelvis: "Pelvis", breast: "Breast", spine: "Spine", lower: "Lower Limb", whole: "Whole Body",
};

export type ChipTone = "neutral" | "ok" | "warn" | "danger";

export function radNphiesChip(o: RadOrder): { label: string; tone: ChipTone } {
  if (isRadPublished(o)) {
    const r = radReportNphiesState(o);
    const acc = lastAccepted(o.sends, "rad-report");
    if (r.tone === "ok") return { label: o.status === "amended" && acc ? `Report Amended v${acc.version}` : "Report Accepted", tone: "ok" };
    return { label: `Report ${r.label}`, tone: r.tone };
  }
  const r = radOrderNphiesState(o);
  return { label: `Order ${r.label}`, tone: r.tone };
}

/* ---------- numbers ---------- */

export interface RadStats {
  examsToday: number;
  statWaiting: number;
  awaitingReport: number;
  avgReportMin: number | null;
  late: number;
  cancelled: number;
}

export function radStats(orders: RadOrder[], now: number): RadStats {
  let statWaiting = 0;
  let awaitingReport = 0;
  let late = 0;
  let cancelled = 0;
  const times: number[] = [];
  for (const o of orders) {
    const st = radStageOf(o);
    if (!st) {
      cancelled += 1;
      continue;
    }
    if (st !== "reported" && prioOf(o) === "stat") statWaiting += 1;
    if (st === "performed" || st === "reporting") awaitingReport += 1;
    const c = radClock(o, st);
    if (c && clockState(elapsedMin(c.since, now), c.targetMin) === "late") late += 1;
    const first = o.sends.find((s) => s.kind === "rad-report" && s.response.status === "accepted");
    if (first && o.study) times.push((new Date(first.at).getTime() - new Date(o.study.performedEnd).getTime()) / 60_000);
  }
  return {
    examsToday: orders.filter((o) => o.status !== "cancelled" && sameLocalDay(o.orderedAt, now)).length,
    statWaiting,
    awaitingReport,
    avgReportMin: avg(times),
    late,
    cancelled,
  };
}

export const RAD_MOVE_HINT: Record<string, string> = {
  "ordered>performed": "Runs markPerformed. Creates the imaging study (study UID and accession). No NPHIES message.",
  "performed>reporting": "Opens the report editor. saveRadReport stores the text. No NPHIES message yet.",
  "reporting>reported": "Runs releaseRadReport. The report is final in the chart. Nothing is sent: it waits on the NPHIES Clinical page, which sends the report FHIR bundle (3.1).",
};
