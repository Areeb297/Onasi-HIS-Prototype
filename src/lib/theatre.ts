import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { addFormRecord, getFormRecords, updateFormRecord } from "./records";
import { DOCTORS } from "./reference-data";
import { can, currentUser, roleOf } from "./session";
import { getState } from "./store";
import {
  ALDRETE_PASS, aldreteTotal, closeGate, confirmGate, opNoteDone, postponeGate, preOpProblems, recoveryDischargeGate, slotText, stepGate,
  validateAssessment, validateClosure, validateOpNote, validatePhase, validateRecovery, validateRequest, validateSchedule, validateScheduleDraft,
  type AssessmentData, type ClosureDetails, type CloseOutcome, type CodedDx, type OpNoteData, type PhaseId, type PhaseInput, type PreOpData,
  type RecoveryData, type RequestData, type SafetySigners, type ScheduleData, type Signer, type Stamp, type SurgeryCase, SAFETY_PHASES,
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
export const WARD_NURSES = ["Reem Alshehri, RN", "Fahad Aldossari, RN", "Amal Alghamdi, RN"];
export const RECOVERY_NURSES = ["Latifa Alanazi, RN", "Majed Alshammari, RN", ...THEATRE_NURSES];
export const ANAESTHESIA_TECHNICIANS = ["Nasser Alyami, Anaesthesia Technician", "Hind Alqahtani, Anaesthesia Technician"];
/** Everyone who can be put on the surgical team of an operative note. */
export const THEATRE_STAFF: string[] = [...SURGEONS, ...ANAESTHETISTS, ...THEATRE_NURSES, ...ANAESTHESIA_TECHNICIANS, "Latifa Alanazi, RN", "Majed Alshammari, RN"];
export const RECOVERY_DESTINATIONS = ["Ward", "Intensive Care Unit", "Day Surgery Unit", "Home"];

/** Common diagnoses after an operation, ICD-10-AM. The visit's own diagnoses are offered first on the screen. */
export const POSTOP_DIAGNOSES: CodedDx[] = [
  { code: "K80.20", text: "Calculus of gallbladder without cholecystitis, without obstruction" },
  { code: "K80.10", text: "Calculus of gallbladder with other cholecystitis, without obstruction" },
  { code: "K35.80", text: "Acute appendicitis, unspecified" },
  { code: "K40.90", text: "Unilateral or unspecified inguinal hernia, without obstruction or gangrene" },
  { code: "S72.00", text: "Fracture of neck of femur, part unspecified" },
  { code: "N20.0", text: "Calculus of kidney" },
  { code: "D25.9", text: "Leiomyoma of uterus, unspecified" },
];

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
      schedule: { room: "Theatre 2", date: localDay(0), start: "13:00", durationMin: 60, anaesthetist: ANAESTHETISTS[0], scrubNurse: THEATRE_NURSES[1], circulatingNurse: THEATRE_NURSES[0], status: "Scheduled", done: stamp(SURGEONS[4], 1100) },
      preop: { answers: { identity: "yes", consent: "yes", anaesthesiaConsent: "yes", allergies: "yes" }, checklistDate: localDay(0), reviewed: { allergy: true }, saved: stamp("Reem Alshehri, RN", 300) },
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
export type SaveMode = "draft" | "complete";

const stampNow = (): Stamp => ({ by: currentUser().name, role: roleOf(currentUser()).label, at: new Date().toISOString() });
const fail = (message: string): Result => ({ ok: false, message });
const nowTime = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

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

/** A signature saved once stays as it was. A new signature gets the time and the signed-in user. */
function mergeSigner(prev: Signer | undefined, next: Signer | undefined): Signer | undefined {
  if (prev?.signed) return prev;
  if (!next || !next.name?.trim()) return undefined;
  if (!next.signed) return { name: next.name };
  return { name: next.name, signed: true, at: new Date().toISOString(), by: currentUser().name };
}

function mergeSigners(prev: SafetySigners | undefined, next: SafetySigners | undefined): SafetySigners {
  const out: SafetySigners = {};
  for (const k of ["surgeon", "anaesthetist", "nurse"] as const) {
    const s = mergeSigner(prev?.[k], next?.[k]);
    if (s) out[k] = s;
  }
  return out;
}

/**
 * Keep an Operation Request form record in step with the case. The Operative Note document reads the procedure,
 * the urgency and the operation start and end times from that form, so nothing has to be typed twice.
 * The operative note fields are passed on only once the note is completed, so a draft never reaches the document.
 */
function syncOperationRequest(c: SurgeryCase): string | undefined {
  const note = opNoteDone(c) ? c.opNote : undefined;
  const values: Record<string, string | number> = {
    procedure: c.request.procedure, preopDiagnosis: c.request.preopDiagnosis ?? "", side: c.request.side, urgency: c.request.urgency,
    preferredDate: c.schedule?.date ?? c.request.plannedDate, surgeon: c.request.surgeon,
    anesthesiaType: note?.anaesthesia ?? c.assessment?.anaesthesia ?? "", instructions: c.request.notes ?? "",
    operationStart: note?.start ?? "", operationEnd: note?.end ?? "",
    opFindings: note?.findings ?? "", specimens: note?.specimens ?? "", complications: note?.complications ?? "",
    bloodLossMl: note?.bloodLossMl ?? "",
  };
  if (note?.category) values.surgeryCategory = note.category;
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

/**
 * Save the slot. As a draft it may be incomplete and does not hold the room. Scheduling checks everything, books the room
 * and sets the status to Scheduled. A slot that was Confirmed must be confirmed again after a change.
 */
export function saveSchedule(id: string, data: ScheduleData, mode: "draft" | "schedule" = "schedule"): Result {
  const s = start(id, "schedule");
  if ("error" in s) return s.error;
  const bad = mode === "draft" ? validateScheduleDraft(data) : validateSchedule(data, allCases(), id);
  if (bad) return fail(bad);
  const wasConfirmed = s.c.schedule?.status === "Confirmed";
  let c: SurgeryCase = { ...s.c, schedule: { ...data, status: mode === "draft" ? "Draft" : "Scheduled", done: stampNow() } };
  c = { ...c, linkedRecordId: syncOperationRequest(c) };
  save(c, "update", mode === "draft" ? "schedule draft" : "schedule", `${slotText(data)}, ${data.durationMin} minutes`);
  if (mode === "draft") return { ok: true, id, message: "Schedule saved as a draft. It does not hold the room until it is scheduled." };
  return { ok: true, id, message: `Scheduled in ${data.room} on ${data.date} at ${data.start}.${wasConfirmed ? " Confirm the slot again." : " Next: confirm the slot."}` };
}

export function confirmSchedule(id: string): Result {
  const c = caseById(id);
  if (!c) return fail("Surgery case not found.");
  const no = denied(`Surgery case ${id}`, c.patientId);
  if (no) return no;
  const gate = confirmGate(c);
  if (!gate.ok) return fail(gate.reason);
  save({ ...c, schedule: { ...c.schedule!, status: "Confirmed", confirmed: stampNow() } }, "update", "schedule confirmed", slotText(c.schedule!));
  return { ok: true, id, message: "Schedule confirmed." };
}

/** Give up the slot with a reason. The room is freed and the case waits to be scheduled again. */
export function postponeSchedule(id: string, reason: string): Result {
  const c = caseById(id);
  if (!c) return fail("Surgery case not found.");
  const no = denied(`Surgery case ${id}`, c.patientId);
  if (no) return no;
  const gate = postponeGate(c, reason);
  if (!gate.ok) return fail(gate.reason);
  const slot = slotText(c.schedule!);
  const stamp = stampNow();
  save({ ...c, schedule: { ...c.schedule!, status: "Postponed", confirmed: undefined, done: stamp }, postponements: [...(c.postponements ?? []), { reason: reason.trim(), slot, stamp }] },
    "update", "schedule postponed", `${slot}: ${reason.trim()}`);
  return { ok: true, id, message: "Schedule postponed. The room is free. Schedule the case again when it can go ahead." };
}

/** Save the pre-operative checklist as a draft, or complete it. Completing needs every item, review and nurse signature. */
export function savePreOp(id: string, data: PreOpData, mode: SaveMode = "draft"): Result {
  const s = start(id, "preop");
  if ("error" in s) return s.error;
  const merged: PreOpData = {
    ...data,
    wardNurse: mergeSigner(s.c.preop?.wardNurse, data.wardNurse),
    theatreNurse: mergeSigner(s.c.preop?.theatreNurse, data.theatreNurse),
  };
  const left = preOpProblems(merged, s.c.request.side);
  if (mode === "complete" && left.length > 0) return fail(left[0]);
  const stamp = stampNow();
  const done = mode === "complete" ? stamp : undefined;
  save({ ...s.c, preop: { ...merged, saved: stamp, done } }, "update", "pre-operative checklist", done ? "Complete" : `Draft, ${left.length} open`);
  return {
    ok: true, id,
    message: done ? "Pre-operative checklist complete. Sign In can start once the schedule is confirmed." : `Draft saved. ${left.length} ${left.length === 1 ? "thing is" : "things are"} still open.`,
  };
}

/** Save a safety checklist phase without confirming it. */
export function savePhaseDraft(id: string, phase: PhaseId, data: PhaseInput): Result {
  const s = start(id, phase);
  if ("error" in s) return s.error;
  const { signers, ...phaseData } = data;
  const label = SAFETY_PHASES[phase].label;
  save({ ...s.c, phaseDrafts: { ...s.c.phaseDrafts, [phase]: { ...phaseData, saved: stampNow() } }, safetySigners: mergeSigners(s.c.safetySigners, signers) }, "update", `${label} draft`);
  return { ok: true, id, message: `${label} saved as a draft.` };
}

export function confirmPhase(id: string, phase: PhaseId, data: PhaseInput): Result {
  const s = start(id, phase);
  if ("error" in s) return s.error;
  const signers = mergeSigners(s.c.safetySigners, data.signers);
  const bad = validatePhase(phase, { ...data, signers });
  if (bad) return fail(bad);
  const { signers: _ignored, ...phaseData } = data;
  void _ignored;
  const label = SAFETY_PHASES[phase].label;
  const drafts = { ...s.c.phaseDrafts };
  delete drafts[phase];
  save({ ...s.c, [phase]: { ...phaseData, done: stampNow() }, phaseDrafts: drafts, safetySigners: signers }, "update", label, `Confirmed by ${data.confirmedRole} ${data.confirmedName}`);
  return { ok: true, id, message: `${label} confirmed.` };
}

/** Save the operative note as a draft, or complete and sign it. A completed note cannot change. */
export function saveOpNote(id: string, data: OpNoteData, mode: SaveMode): Result {
  const s = start(id, "opNote");
  if ("error" in s) return s.error;
  const bad = validateOpNote(data, mode);
  if (bad) return fail(bad);
  const stamp = stampNow();
  const note = mode === "complete" ? { ...data, status: "Completed" as const, saved: stamp, done: stamp } : { ...data, status: "Draft" as const, saved: stamp };
  let c: SurgeryCase = { ...s.c, opNote: note };
  if (mode === "complete") c = { ...c, linkedRecordId: syncOperationRequest(c) };
  save(c, "update", mode === "complete" ? "operative note completed" : "operative note draft", data.start && data.end ? `Operation ${data.start} to ${data.end}` : undefined);
  return {
    ok: true, id,
    message: mode === "complete" ? "Operative note completed and signed. The Operative Note document can now be published from Clinical Documents." : "Operative note saved as a draft.",
  };
}

/**
 * Save the recovery assessment as a draft, or complete it and discharge the patient from recovery.
 * Completing needs the discharge Aldrete score at 9 or more, or a doctor's override with a reason.
 */
export function saveRecovery(id: string, data: RecoveryData, mode: SaveMode, overrideReason?: string): Result {
  const s = start(id, "recovery");
  if ("error" in s) return s.error;
  const bad = validateRecovery(data, mode);
  if (bad) return fail(bad);
  const stamp = stampNow();
  const scores = s.c.recovery?.scores ?? [];
  if (mode === "draft") {
    save({ ...s.c, recovery: { scores, form: data, saved: stamp } }, "update", "recovery assessment draft");
    return { ok: true, id, message: "Recovery assessment saved as a draft." };
  }
  const total = aldreteTotal(data.aldrete?.discharge)!;
  const override = overrideReason !== undefined ? { reason: overrideReason, isDoctor: isDoctor() } : undefined;
  const gate = recoveryDischargeGate(total, override);
  if (!gate.ok) return fail(gate.reason);
  const used = total < ALDRETE_PASS && override ? { reason: override.reason.trim(), doctor: currentUser().name } : undefined;
  const form: RecoveryData = { ...data, timeOut: data.timeOut || nowTime() };
  save({ ...s.c, recovery: { scores, form, saved: stamp, discharge: { score: total, destination: data.destination!, override: used, done: stamp } } }, "update", "discharge from recovery",
    used ? `Doctor override at Aldrete ${total}: ${used.reason}` : `Aldrete ${total}, to ${data.destination}`);
  return { ok: true, id, message: `Recovery assessment completed. Patient left recovery for ${data.destination}.` };
}

export function closeCase(id: string, outcome: CloseOutcome, reason: string | undefined, details: ClosureDetails): Result {
  const c = caseById(id);
  if (!c) return fail("Surgery case not found.");
  const no = denied(`Surgery case ${id}`, c.patientId);
  if (no) return no;
  const gate = closeGate(c, outcome, reason);
  if (!gate.ok) return fail(gate.reason);
  const bad = validateClosure(details);
  if (bad) return fail(bad);
  const d: ClosureDetails = { date: details.date, time: details.time, disposition: details.disposition, dispositionRemarks: details.dispositionRemarks?.trim() || undefined };
  save({ ...c, closed: { outcome, reason: reason?.trim() || undefined, ...d, done: stampNow() } }, "update", `closed as ${outcome}`, [reason?.trim(), `Disposition: ${d.disposition}`].filter(Boolean).join(". "));
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
