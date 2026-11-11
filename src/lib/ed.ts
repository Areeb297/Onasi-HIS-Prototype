import type { CtasLevel, EdData, Encounter } from "./model";
import { nowLocal, updateEncounter } from "./store";

/**
 * Emergency department helpers: CTAS (Canadian Triage and Acuity Scale) levels, clocks, board stages,
 * and the actions that change ED data on a visit.
 *
 * CTAS levels and the time-to-physician targets below are the standard published CTAS targets.
 * Check them against the version your facility has adopted. The vital sign hints are a small aid only.
 * The triage nurse decides the level.
 */

export interface CtasInfo {
  level: CtasLevel;
  label: string;
  /** Minutes from triage to physician assessment. 0 means immediate. */
  targetMin: number;
  /** Tailwind classes using the CTAS colour tokens. */
  bg: string;
  ring: string;
  text: string;
  description: string;
}

export const CTAS: CtasInfo[] = [
  { level: 1, label: "Resuscitation", targetMin: 0, bg: "bg-ctas-1", ring: "border-ctas-1", text: "text-ctas-1", description: "Threat to life or limb. Immediate care." },
  { level: 2, label: "Emergent", targetMin: 15, bg: "bg-ctas-2", ring: "border-ctas-2", text: "text-ctas-2", description: "Potential threat to life, limb or function. Within 15 minutes." },
  { level: 3, label: "Urgent", targetMin: 30, bg: "bg-ctas-3", ring: "border-ctas-3", text: "text-ctas-3", description: "May progress to a serious problem. Within 30 minutes." },
  { level: 4, label: "Less Urgent", targetMin: 60, bg: "bg-ctas-4", ring: "border-ctas-4", text: "text-ctas-4", description: "Could wait. Within 60 minutes." },
  { level: 5, label: "Non-Urgent", targetMin: 120, bg: "bg-ctas-5", ring: "border-ctas-5", text: "text-ctas-5", description: "Minor problem. Within 120 minutes." },
];

export const ctasInfo = (l: CtasLevel): CtasInfo => CTAS[l - 1];

export const ARRIVAL_MODES: EdData["arrivalMode"][] = ["Walk-in", "Ambulance", "Referral", "Police", "Other"];
export const AREAS: NonNullable<EdData["area"]>[] = ["Triage", "Resus", "Acute", "Fast Track", "Observation"];
export const DISPOSITIONS: NonNullable<EdData["disposition"]>[] = [
  "Discharged", "Admitted", "Transferred", "Left Without Being Seen", "Left Against Advice", "Died",
];

export type EdStage = "waiting-triage" | "waiting-doctor" | "treatment" | "results" | "ready";

export const STAGES: { id: EdStage; label: string }[] = [
  { id: "waiting-triage", label: "Waiting For Triage" },
  { id: "waiting-doctor", label: "Waiting For Doctor" },
  { id: "treatment", label: "In Treatment" },
  { id: "results", label: "Awaiting Results" },
  { id: "ready", label: "Ready For Disposition" },
];

export function stageOf(ed: EdData): EdStage {
  if (!ed.triageAt) return "waiting-triage";
  if (!ed.seenAt) return "waiting-doctor";
  if (ed.stage === "results") return "results";
  if (ed.stage === "ready") return "ready";
  return "treatment";
}

export const minutesSince = (local: string | undefined, now = Date.now()): number =>
  local ? Math.max(0, Math.floor((now - new Date(local).getTime()) / 60_000)) : 0;

export const minutesBetween = (a: string | undefined, b: string | undefined): number | undefined =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)) : undefined;

export interface Clock {
  /** Minutes waited since triage (or arrival if not triaged). */
  waited: number;
  /** Minutes left to the physician target. Negative means overdue. Undefined when there is no target. */
  left?: number;
  overdue: boolean;
  text: string;
}

/** The clock that matters on the board: how long since triage, against the CTAS target. */
export function clockOf(ed: EdData, now = Date.now()): Clock {
  const stage = stageOf(ed);
  const waited = minutesSince(ed.triageAt ?? ed.arrivalAt, now);
  if (stage === "waiting-triage") {
    const over = waited > 10;
    return { waited, overdue: over, text: `${waited} min since arrival` };
  }
  if (stage === "waiting-doctor" && ed.ctas) {
    const target = ctasInfo(ed.ctas).targetMin;
    const left = target - waited;
    if (target === 0) return { waited, left, overdue: true, text: "Needs a doctor now" };
    return { waited, left, overdue: left < 0, text: left >= 0 ? `${left} min to target` : `${-left} min over target` };
  }
  return { waited, overdue: false, text: `${minutesSince(ed.arrivalAt, now)} min in ED` };
}

/** Door to doctor: minutes from arrival to a doctor starting care. */
export const doorToDoctor = (ed: EdData): number | undefined => minutesBetween(ed.arrivalAt, ed.seenAt);

/** A small aid. It never replaces the triage nurse. */
export function suggestCtas(v: { spo2?: number; sbp?: number; hr?: number; rr?: number; gcs?: number; pain?: number; temp?: number }): { level: CtasLevel; why: string } | null {
  if (v.gcs !== undefined && v.gcs <= 8) return { level: 1, why: "Glasgow Coma Scale of 8 or less" };
  if (v.spo2 !== undefined && v.spo2 < 90) return { level: 1, why: "Oxygen saturation under 90%" };
  if (v.sbp !== undefined && v.sbp < 90) return { level: 2, why: "Systolic blood pressure under 90" };
  if (v.hr !== undefined && (v.hr > 130 || v.hr < 40)) return { level: 2, why: "Heart rate outside 40 to 130" };
  if (v.rr !== undefined && (v.rr > 30 || v.rr < 10)) return { level: 2, why: "Respiratory rate outside 10 to 30" };
  if (v.gcs !== undefined && v.gcs < 13) return { level: 2, why: "Glasgow Coma Scale under 13" };
  if (v.spo2 !== undefined && v.spo2 < 92) return { level: 2, why: "Oxygen saturation under 92%" };
  if (v.pain !== undefined && v.pain >= 8) return { level: 3, why: "Severe pain (8 to 10)" };
  if (v.temp !== undefined && v.temp >= 38.5) return { level: 3, why: "Temperature 38.5 or higher" };
  return null;
}

/** ED disposition to the ADT event that follows it. */
export const DISPOSITION_EVENT: Record<NonNullable<EdData["disposition"]>, "A03" | "A06"> = {
  Discharged: "A03",
  Admitted: "A06",
  Transferred: "A03",
  "Left Without Being Seen": "A03",
  "Left Against Advice": "A03",
  Died: "A03",
};

/** PV1-36 discharge disposition code for the A03 that follows. These are our app's codes. */
export const DISPOSITION_CODE: Record<NonNullable<EdData["disposition"]>, string> = {
  Discharged: "01",
  Admitted: "01",
  Transferred: "02",
  "Left Without Being Seen": "07",
  "Left Against Advice": "07",
  Died: "20",
};

/* ---------- actions (ED data only, no ADT message) ---------- */

const touch = { touch: false } as const;

export function startEd(visit: string, arrivalMode: EdData["arrivalMode"]) {
  updateEncounter(visit, (e) => { e.ed = { arrivalAt: e.admitAt ?? nowLocal(), arrivalMode }; }, touch);
}

export function saveTriage(visit: string, data: Partial<EdData>, vitals?: { bp: string; pulse: string; temp: string; spo2: string; rr: string }) {
  updateEncounter(visit, (e: Encounter) => {
    const base = e.ed ?? { arrivalAt: e.admitAt ?? nowLocal(), arrivalMode: "Walk-in" as const };
    e.ed = { ...base, ...data, triageAt: data.triageAt ?? base.triageAt ?? nowLocal(), area: data.area ?? base.area ?? "Triage" };
    if (data.complaint) {
      e.reason = data.complaint;
      if (!e.complaints.some((c) => c.text === data.complaint)) e.complaints = [...e.complaints, { code: "", text: data.complaint }];
    }
    if (vitals) e.vitals = { ...(e.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), ...vitals, at: nowLocal() };
  }, touch);
}

export function startTreatment(visit: string, area: NonNullable<EdData["area"]>, doctorId?: string) {
  updateEncounter(visit, (e) => {
    if (!e.ed) return;
    e.ed = { ...e.ed, seenAt: e.ed.seenAt ?? nowLocal(), area, stage: "treatment" };
    if (doctorId) e.attending = doctorId;
  }, touch);
}

export function setStage(visit: string, stage: NonNullable<EdData["stage"]>) {
  updateEncounter(visit, (e) => { if (e.ed) e.ed = { ...e.ed, stage }; }, touch);
}

export function setDisposition(visit: string, disposition: NonNullable<EdData["disposition"]>) {
  updateEncounter(visit, (e) => { if (e.ed) e.ed = { ...e.ed, disposition, dispositionAt: nowLocal() }; }, touch);
}

export const defaultArea = (l: CtasLevel): NonNullable<EdData["area"]> => (l === 1 ? "Resus" : l <= 3 ? "Acute" : "Fast Track");
