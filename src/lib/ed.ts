import { CTAS_LEVELS } from "./ctas";
import type { CtasLevel, EdData, Encounter } from "./model";
import { nowLocal, updateEncounter } from "./store";

/**
 * Emergency department helpers: CTAS (Canadian Triage and Acuity Scale) levels, clocks, board stages,
 * and the actions that change ED data on a visit.
 *
 * CTAS levels and the time-to-physician targets below are the standard published CTAS targets.
 * Check them against the version your facility has adopted. The modifier rules are in ctas.ts.
 * The triage nurse decides the level.
 */

export interface CtasInfo {
  level: CtasLevel;
  label: string;
  /** Minutes from triage to physician assessment. 0 means immediate. */
  targetMin: number;
  /** Share of patients who should be seen within the target (CTAS fractile response). */
  fractile: number;
  /** Re-assess every this many minutes while waiting. 0 means continuous. */
  reassessMin: number;
  /** Tailwind classes using the CTAS colour tokens. */
  bg: string;
  ring: string;
  text: string;
  description: string;
}

const STYLE: Record<CtasLevel, Pick<CtasInfo, "bg" | "ring" | "text" | "description">> = {
  1: { bg: "bg-ctas-1", ring: "border-ctas-1", text: "text-ctas-1", description: "Threat to life or limb. Immediate care." },
  2: { bg: "bg-ctas-2", ring: "border-ctas-2", text: "text-ctas-2", description: "Potential threat to life, limb or function. Within 15 minutes." },
  3: { bg: "bg-ctas-3", ring: "border-ctas-3", text: "text-ctas-3", description: "May progress to a serious problem. Within 30 minutes." },
  4: { bg: "bg-ctas-4", ring: "border-ctas-4", text: "text-ctas-4", description: "Could wait. Within 60 minutes." },
  5: { bg: "bg-ctas-5", ring: "border-ctas-5", text: "text-ctas-5", description: "Minor problem. Within 120 minutes." },
};

export const CTAS: CtasInfo[] = CTAS_LEVELS.map((l) => ({ ...l, ...STYLE[l.level] }));

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

/** How long the waiting patient has gone without a re-assessment, against the CTAS interval. */
export interface Reassess {
  /** Minutes since the last re-assessment (or triage). */
  since: number;
  /** Minutes until the next one is due. Negative means late. Undefined for CTAS 1, which is continuous. */
  due?: number;
  late: boolean;
  text: string;
}

export function reassessOf(ed: EdData, now = Date.now()): Reassess | undefined {
  if (!ed.ctas || !ed.triageAt || ed.seenAt) return undefined;
  const info = ctasInfo(ed.ctas);
  const since = minutesSince(ed.reassessedAt ?? ed.triageAt, now);
  if (info.reassessMin === 0) return { since, late: false, text: "Continuous nursing care" };
  const due = info.reassessMin - since;
  return { since, due, late: due < 0, text: due >= 0 ? `Re-assess in ${due} min` : `Re-assessment ${-due} min late` };
}

export interface Fractile {
  level: CtasLevel;
  /** Patients of this level seen by a doctor. */
  seen: number;
  /** Of those, how many were seen inside the target. */
  met: number;
  /** Percent, or undefined when nobody was seen. */
  pct?: number;
  goal: number;
}

/** CTAS fractile response: the share of patients seen within the time target, per level. Level 1 has no minute target, so only levels 2 to 5 are scored. */
export function fractiles(encs: Encounter[]): Fractile[] {
  return CTAS.filter((c) => c.level > 1).map((c) => {
    const seen = encs.filter((e) => e.ed?.ctas === c.level && e.ed.triageAt && e.ed.seenAt);
    const met = seen.filter((e) => (minutesBetween(e.ed!.triageAt, e.ed!.seenAt) ?? 0) <= c.targetMin).length;
    return { level: c.level, seen: seen.length, met, pct: seen.length ? Math.round((met / seen.length) * 100) : undefined, goal: c.fractile };
  });
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

export function saveTriage(visit: string, data: Partial<EdData>, vitals?: { bp: string; pulse: string; temp: string; spo2: string; rr: string }, note?: string) {
  updateEncounter(visit, (e: Encounter) => {
    const base = e.ed ?? { arrivalAt: e.admitAt ?? nowLocal(), arrivalMode: "Walk-in" as const };
    const at = nowLocal();
    const log = data.ctas ? [...(base.triageLog ?? []), { at, ctas: data.ctas, by: data.triageNurse ?? "", note }] : base.triageLog;
    e.ed = { ...base, ...data, triageAt: data.triageAt ?? base.triageAt ?? at, area: data.area ?? base.area ?? "Triage", reassessedAt: at, triageLog: log };
    if (data.complaint) {
      e.reason = data.complaint;
      if (!e.complaints.some((c) => c.text === data.complaint)) e.complaints = [...e.complaints, { code: "", text: data.complaint }];
    }
    if (vitals) e.vitals = { ...(e.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), ...vitals, at };
  }, touch);
}

/** The nurse looked at the waiting patient again. Resets the re-assessment clock. */
export function reassess(visit: string) {
  updateEncounter(visit, (e) => { if (e.ed) e.ed = { ...e.ed, reassessedAt: nowLocal() }; }, touch);
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
