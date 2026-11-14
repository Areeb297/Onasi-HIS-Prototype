import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { addFormRecord, getFormRecords, updateFormRecord } from "./records";
import { DOCTORS } from "./reference-data";
import { can, currentUser, roleOf } from "./session";
import { getState } from "./store";
import {
  ALDRETE_PASS, aldreteTotal, closeGate, preOpMissing, recoveryDischargeGate, stepGate, validateAssessment, validateOpNote, validatePhase, validateRequest, validateSchedule,
  type AldreteScores, type AssessmentData, type CloseOutcome, type OpNoteData, type PhaseData, type PhaseId, type PreOpAnswer, type RequestData,
  type ScheduleData, type Stamp, type SurgeryCase, SAFETY_PHASES,
} from "./theatre-logic";

/**
 * Surgery cases: one record per operation, taken through the gated steps in theatre-logic.ts.
 * Every write goes through an action here. Each action checks the role, asks the gate, checks the data, stamps who and when,
 * and writes the audit trail. The screens only show what the gate says. Browser storage only.
 */

interface State {
  cases: SurgeryCase[];
  seq: number;
  /** The demo cases were added once. Reset adds them again. */
  seeded: boolean;
}

const KEY = "onasi-emr-theatre-v1";
let state: State = { cases: [], seq: 1001, seeded: false };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<State>) };
} catch {
  /* storage may be blocked */
}

const listeners = new Set<() => void>();
function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/* ---------- staff lists (made-up names) ---------- */

export const SURGEONS: string[] = DOCTORS.map((d) => `Dr. ${d.given} ${d.family}`);
export const ANAESTHETISTS = ["Dr. Tariq Alrashid", "Dr. Salma Alharthi", "Dr. Yousef Almalki"];
export const THEATRE_NURSES = ["Huda Alotaibi, RN", "Maha Alsubaie, RN", "Sara Almutairi, RN", "Abdullah Alenezi, RN"];
export const RECOVERY_DESTINATIONS = ["Ward", "Intensive Care Unit", "Day Surgery Unit", "Home"];

/* ---------- demo data ---------- */

const localDay = (offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Two cases on admitted patients, so the Theatre List is not empty the first time it opens. */
function seedCases(): SurgeryCase[] {
  let inpatients: { visitNumber: string; patientId: string }[] = [];
  try {
    inpatients = getState().encounters.filter((e) => e.status === "active" && e.cls === "I");
  } catch {
    /* the visit store is not ready */
  }
  const stamp = (by: string, minsAgo: number): Stamp => ({ by, role: "Physician", at: new Date(Date.now() - minsAgo * 60_000).toISOString() });
  const out: SurgeryCase[] = [];
  const [a, b] = inpatients;
  if (a) {
    out.push({
      id: "SC-1001", visit: a.visitNumber, patientId: a.patientId,
      request: { procedure: "Laparoscopic cholecystectomy", side: "Not applicable", surgeon: SURGEONS[1], urgency: "Elective", plannedDate: localDay(1), preopDiagnosis: "Gallstones with repeated pain", done: stamp(SURGEONS[1], 600) },
    });
  }
  if (b) {
    out.push({
      id: "SC-1002", visit: b.visitNumber, patientId: b.patientId,
      request: { procedure: "Right knee arthroscopy", side: "Right", surgeon: SURGEONS[4], urgency: "Elective", plannedDate: localDay(0), preopDiagnosis: "Torn meniscus, right knee", done: stamp(SURGEONS[4], 1500) },
      assessment: { result: "Fit", asa: "II", anaesthesia: "Spinal", done: stamp(ANAESTHETISTS[0], 1200) },
      schedule: { room: "Theatre 2", date: localDay(0), start: "13:00", durationMin: 60, anaesthetist: ANAESTHETISTS[0], scrubNurse: THEATRE_NURSES[1], circulatingNurse: THEATRE_NURSES[0], done: stamp(SURGEONS[4], 1100) },
      preop: { answers: { identity: "yes", consent: "yes", anaesthesiaConsent: "yes", allergies: "yes" } },
    });
  }
  return out;
}

function ensureSeed() {
  if (state.seeded) return;
  // Not committed to storage here: reading must not write. The first real action saves it.
  state = { ...state, seeded: true, cases: [...seedCases(), ...state.cases], seq: Math.max(state.seq, 1003) };
}

/* ---------- reading ---------- */

export function useTheatre(): State {
  ensureSeed();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export const allCases = (): SurgeryCase[] => (ensureSeed(), state.cases);
export const casesForVisit = (visit: string): SurgeryCase[] => allCases().filter((c) => c.visit === visit);
export const caseById = (id: string): SurgeryCase | undefined => allCases().find((c) => c.id === id);

/** Doctors may override the recovery score. */
export const isDoctor = (): boolean => ["physician", "admin"].includes(roleOf(currentUser()).id);

/* ---------- writing ---------- */

export type Result = { ok: true; message: string; id: string } | { ok: false; message: string };

const stampNow = (): Stamp => ({ by: currentUser().name, role: roleOf(currentUser()).label, at: new Date().toISOString() });
const fail = (message: string): Result => ({ ok: false, message });

function denied(target: string, patientId?: string): Result | null {
  if (can("emr.write")) return null;
  audit("denied", target, { patient: patientId });
  return fail("Your role cannot record surgery steps.");
}

function save(c: SurgeryCase, action: "create" | "update", what: string, detail?: string): void {
  ensureSeed();
  const exists = state.cases.some((x) => x.id === c.id);
  commit({ ...state, cases: exists ? state.cases.map((x) => (x.id === c.id ? c : x)) : [...state.cases, c] });
  audit(action, `Surgery case ${c.id}: ${what}`, { patient: c.patientId, detail: detail ?? `Visit ${c.visit}` });
}

/** Load a case and check the role and the gate in one place. Every step action starts here. */
function start(id: string, step: Parameters<typeof stepGate>[1]): { c: SurgeryCase } | { error: Result } {
  const c = caseById(id);
  if (!c) return { error: fail("Surgery case not found.") };
  const no = denied(`Surgery case ${id}`, c.patientId);
  if (no) return { error: no };
  const gate = stepGate(c, step);
  if (!gate.ok) return { error: fail(gate.reason) };
  return { c };
}

/**
 * Keep an Operation Request form record in step with the case. The Operative Note document reads the procedure,
 * the urgency and the operation start and end times from that form, so nothing has to be typed twice.
 */
function syncOperationRequest(c: SurgeryCase): string | undefined {
  const values: Record<string, string | number> = {
    procedure: c.request.procedure, preopDiagnosis: c.request.preopDiagnosis ?? "", side: c.request.side, urgency: c.request.urgency,
    preferredDate: c.schedule?.date ?? c.request.plannedDate, surgeon: c.request.surgeon,
    anesthesiaType: c.opNote?.anaesthesia ?? c.assessment?.anaesthesia ?? "", instructions: c.request.notes ?? "",
    operationStart: c.opNote?.start ?? "", operationEnd: c.opNote?.end ?? "",
  };
  const existing = c.linkedRecordId && getFormRecords(c.visit, "operation-request").find((r) => r.id === c.linkedRecordId);
  if (existing) {
    updateFormRecord(c.visit, "operation-request", existing.id, { ...existing.values, ...values }, c.patientId);
    return existing.id;
  }
  return addFormRecord(c.visit, "operation-request", values, c.patientId).id;
}

export function requestSurgery(visit: string, patientId: string, data: RequestData): Result {
  const no = denied(`Surgery request, visit ${visit}`, patientId);
  if (no) return no;
  const bad = validateRequest(data);
  if (bad) return fail(bad);
  ensureSeed();
  const id = `SC-${state.seq}`;
  let c: SurgeryCase = { id, visit, patientId, request: { ...data, done: stampNow() } };
  state = { ...state, seq: state.seq + 1 };
  c = { ...c, linkedRecordId: syncOperationRequest(c) };
  save(c, "create", "request", `${data.procedure}, ${data.urgency}, planned ${data.plannedDate}`);
  return { ok: true, id, message: "Surgery request saved. Next: pre-anaesthesia assessment." };
}

export function saveAssessment(id: string, data: AssessmentData): Result {
  const s = start(id, "assessment");
  if ("error" in s) return s.error;
  const bad = validateAssessment(data);
  if (bad) return fail(bad);
  save({ ...s.c, assessment: { ...data, done: stampNow() } }, "update", "pre-anaesthesia assessment", `Result: ${data.result}`);
  const fit = data.result === "Fit" || data.result === "Fit With High Risk";
  return { ok: true, id, message: fit ? `Result: ${data.result}. The case can be scheduled.` : `Result: ${data.result}. The case cannot be scheduled yet.` };
}

export function saveSchedule(id: string, data: ScheduleData): Result {
  const s = start(id, "schedule");
  if ("error" in s) return s.error;
  const bad = validateSchedule(data, allCases(), id);
  if (bad) return fail(bad);
  let c: SurgeryCase = { ...s.c, schedule: { ...data, done: stampNow() } };
  c = { ...c, linkedRecordId: syncOperationRequest(c) };
  save(c, "update", "schedule", `${data.room}, ${data.date} ${data.start}, ${data.durationMin} minutes`);
  return { ok: true, id, message: `Scheduled in ${data.room} on ${data.date} at ${data.start}.` };
}

/** Save the pre-operative answers. The step is only marked done when every item is answered. */
export function savePreOp(id: string, answers: Record<string, PreOpAnswer>): Result {
  const s = start(id, "preop");
  if ("error" in s) return s.error;
  const left = preOpMissing(answers, s.c.request.side);
  const done = left.length === 0 ? stampNow() : undefined;
  save({ ...s.c, preop: { answers, done } }, "update", "pre-operative checklist", done ? "Complete" : `${left.length} items left`);
  return { ok: true, id, message: done ? "Pre-operative checklist complete. Sign In can start." : `Saved. ${left.length} ${left.length === 1 ? "item is" : "items are"} still open.` };
}

export function confirmPhase(id: string, phase: PhaseId, data: PhaseData): Result {
  const s = start(id, phase);
  if ("error" in s) return s.error;
  const bad = validatePhase(phase, data);
  if (bad) return fail(bad);
  const label = SAFETY_PHASES[phase].label;
  save({ ...s.c, [phase]: { ...data, done: stampNow() } }, "update", label, `Confirmed by ${data.confirmedRole} ${data.confirmedName}`);
  return { ok: true, id, message: `${label} confirmed.` };
}

export function saveOpNote(id: string, data: OpNoteData): Result {
  const s = start(id, "opNote");
  if ("error" in s) return s.error;
  const bad = validateOpNote(data);
  if (bad) return fail(bad);
  let c: SurgeryCase = { ...s.c, opNote: { ...data, done: stampNow() } };
  c = { ...c, linkedRecordId: syncOperationRequest(c) };
  save(c, "update", "operative note", `Operation ${data.start} to ${data.end}`);
  return { ok: true, id, message: "Operative note saved. The Operative Note document can now be published from Clinical Documents." };
}

export function addRecoveryScore(id: string, scores: AldreteScores): Result {
  const s = start(id, "recovery");
  if ("error" in s) return s.error;
  const total = aldreteTotal(scores);
  if (total === null) return fail("Score all five items.");
  const rec = s.c.recovery ?? { scores: [] };
  save({ ...s.c, recovery: { ...rec, scores: [...rec.scores, { scores, total, stamp: stampNow() }] } }, "update", "recovery score", `Aldrete ${total} of 10`);
  return { ok: true, id, message: `Aldrete score ${total} of 10 recorded.` };
}

export function dischargeFromRecovery(id: string, destination: string, overrideReason?: string): Result {
  const s = start(id, "recovery");
  if ("error" in s) return s.error;
  const last = s.c.recovery?.scores[s.c.recovery.scores.length - 1];
  if (!destination.trim()) return fail("Choose where the patient goes.");
  const override = overrideReason !== undefined ? { reason: overrideReason, isDoctor: isDoctor() } : undefined;
  const gate = recoveryDischargeGate(last?.total, override);
  if (!gate.ok) return fail(gate.reason);
  const used = last!.total < ALDRETE_PASS && override ? { reason: override.reason.trim(), doctor: currentUser().name } : undefined;
  save({ ...s.c, recovery: { scores: s.c.recovery!.scores, discharge: { score: last!.total, destination, override: used, done: stampNow() } } }, "update", "discharge from recovery",
    used ? `Doctor override at Aldrete ${last!.total}: ${used.reason}` : `Aldrete ${last!.total}, to ${destination}`);
  return { ok: true, id, message: `Patient left recovery for ${destination}.` };
}

export function closeCase(id: string, outcome: CloseOutcome, reason?: string): Result {
  const c = caseById(id);
  if (!c) return fail("Surgery case not found.");
  const no = denied(`Surgery case ${id}`, c.patientId);
  if (no) return no;
  const gate = closeGate(c, outcome, reason);
  if (!gate.ok) return fail(gate.reason);
  save({ ...c, closed: { outcome, reason: reason?.trim() || undefined, done: stampNow() } }, "update", `closed as ${outcome}`, reason?.trim() || undefined);
  return { ok: true, id, message: `Case closed: ${outcome}.` };
}

/** Bring back the demo cases and drop everything else. */
export function resetTheatre() {
  commit({ cases: seedCases(), seq: 1003, seeded: true });
}

/** For tests: start from an empty list with no demo cases. */
export function clearTheatre() {
  commit({ cases: [], seq: 1001, seeded: true });
}
