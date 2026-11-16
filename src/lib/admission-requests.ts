import { useSyncExternalStore } from "react";
import { quickCreate, quickSend, type Outcome } from "./actions";
import { CODE_DICTIONARY } from "./ai/coding";
import { audit } from "./audit";
import { bedProblem } from "./beds";
import type { Dx, Encounter, HisState } from "./model";
import { caseOf, insuredPayer } from "./nphies-financial";
import { ADMISSION_METHODS, DOCTORS, DX_SAMPLES, SERVICES, cnhiAdmissionMethod } from "./reference-data";
import { can, currentUser } from "./session";
import { getState, patientName, toLocalInput, updateEncounter } from "./store";

/**
 * Admission requests, as the HIS runs them. A doctor raises a request, an approver approves or rejects it,
 * and approval admits the patient with the app's own ADT actions, so the NPHIES message follows:
 * - a bed and no open visit: admit (A01),
 * - a bed and an open outpatient or emergency visit: change that visit to inpatient (A06),
 * - Pre-Admit: pre-admit (A05), with or without a bed held.
 * Reject and Cancel only close the request. No visit is made and no message is sent.
 * Own localStorage store.
 */

/* ---------- lists ---------- */

export type RequestStatus = "pending" | "approved" | "preadmitted" | "rejected" | "cancelled";
export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Pending", approved: "Approved", preadmitted: "Pre-Admitted", rejected: "Rejected", cancelled: "Cancelled",
};
export const STATUS_TONE: Record<RequestStatus, "warn" | "ok" | "merge" | "danger" | "neutral"> = {
  pending: "warn", approved: "ok", preadmitted: "merge", rejected: "danger", cancelled: "neutral",
};
export const STATUSES: RequestStatus[] = ["pending", "approved", "preadmitted", "rejected", "cancelled"];

/** Departments that take inpatients. Codes are the app's services, so PV1-10 follows. */
export const ADMITTING_DEPARTMENTS = SERVICES.filter((s) => ["MED", "SUR", "ORT", "ICU"].includes(s.code));

export const SUB_DEPARTMENTS: Record<string, string[]> = {
  MED: ["General Medicine", "Cardiology", "Pulmonology", "Endocrinology", "Nephrology", "Gastroenterology", "Infectious Diseases"],
  SUR: ["General Surgery", "Vascular Surgery", "Urology", "Bariatric Surgery"],
  ORT: ["Trauma", "Joint Replacement", "Spine", "Sports Medicine"],
  ICU: ["Medical Intensive Care", "Surgical Intensive Care", "Cardiac Care Unit"],
};

/** The ward that usually takes each department. Beds in other wards can still be picked. */
export const WARD_OF: Record<string, string> = { MED: "3A", SUR: "4B", ORT: "4B", ICU: "ICU" };

/** Admission type is sent in PV1-4, so the list is CS-Adm-AdmissionMethod. */
export const ADMISSION_TYPES = ADMISSION_METHODS;
export const admissionTypeLabel = (code: string): string => ADMISSION_TYPES.find((m) => m.code === code)?.label ?? code;

/** HIS lookups "Patient Condition" and "Activity Level" (AdmitPatients.PatientConditionId, ActivityLevelId). */
export const PATIENT_CONDITIONS = ["Stable", "Sick", "Seriously Ill", "Very Seriously Ill", "Critical", "Conscious", "Semi Conscious", "Unconscious"];
export const ACTIVITY_LEVELS = ["Up & About", "Ambulatory", "Bed Ridden", "On Wheel Chair", "On Crutches"];
export const ADMISSION_SPECIALTIES = [
  "Internal Medicine", "Cardiology", "Pulmonology", "Endocrinology", "Nephrology", "Gastroenterology", "Infectious Diseases",
  "General Surgery", "Orthopedics", "Urology", "Intensive Care", "Neurology",
];
/** HIS lookup "Family Relation Type" (AdmitPatients.AttendantRelationId). */
export const RELATIONS = ["Father", "Mother", "Brother", "Sister", "Spouse", "Son", "Daughter", "Grandfather", "Grandmother", "Uncle", "Aunt", "Cousin", "Caregiver", "Other"];
export type PayPlan = "Insurance" | "Cash";

/** The app's ICD-10-AM diagnosis list: the chart samples plus the coding dictionary, one entry per code. */
export const ADMISSION_DIAGNOSES: { code: string; text: string }[] = (() => {
  const seen = new Set<string>();
  const out: { code: string; text: string }[] = [];
  for (const d of [...DX_SAMPLES.map((x) => ({ code: x.code, text: x.text })), ...CODE_DICTIONARY.map((x) => ({ code: x.icd, text: x.text }))]) {
    if (seen.has(d.code)) continue;
    seen.add(d.code);
    out.push(d);
  }
  return out;
})();

/** Search the diagnosis list by code or words. */
export function searchDiagnoses(q: string, limit = 8): { code: string; text: string }[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ADMISSION_DIAGNOSES.filter((d) => {
    const hay = `${d.code} ${d.text}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }).slice(0, limit);
}

export const doctorLabel = (id: string | undefined): string => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "None";
};
export const departmentLabel = (code: string): string => SERVICES.find((s) => s.code === code)?.label ?? code;

/* ---------- records ---------- */

export interface Approval {
  department: string;
  admitAt: string;
  admissionType: string;
  patientClass: "I" | "O";
  preAdmit: boolean;
  bedId?: string;
  consulting?: string;
  plan: PayPlan;
  expectedDays?: number;
  activityLevel: string;
  condition: string;
  attendantName: string;
  attendantPhone: string;
  attendantRelation: string;
  notes: string;
  /** What approval did. */
  eventId: "A01" | "A05" | "A06";
  visitNumber: string;
  controlId: string;
}

export interface AdmissionRequest {
  id: string;
  patientId: string;
  /** The outpatient or emergency visit the request comes from. Empty: approval opens a new visit. */
  fromVisit?: string;
  admittingDoctor: string;
  approvingDoctor: string;
  /** Local date-time, YYYY-MM-DDTHH:mm. */
  admitAt: string;
  department: string;
  subDepartment: string;
  /** CS-Adm-AdmissionMethod code. */
  admissionType: string;
  condition: string;
  activityLevel: string;
  expectedStayDays?: number;
  specialty: string;
  dx?: { code: string; text: string };
  reason: string;
  status: RequestStatus;
  requestedBy: string;
  /** ISO time. */
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  /** Why it was rejected or cancelled. */
  decisionReason?: string;
  approval?: Approval;
}

interface State {
  requests: AdmissionRequest[];
  seq: number;
}

/* ---------- store ---------- */

const KEY = "onasi-his-admission-requests-v1";
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* storage may be blocked */
  }
  return seed();
}

function get(): State {
  if (!state) state = load();
  return state;
}

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useAdmissionRequests(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}
export const getAdmissionRequests = get;
/** Back to the three sample requests. */
export const resetAdmissionRequests = () => commit(seed());

const who = (): string => {
  try { return currentUser().name; } catch { return "Unknown"; }
};
const iso = (t: number) => new Date(t).toISOString();

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Raising a request is a clinical order: it needs chart write access. */
export const canRequestAdmission = (): boolean => can("emr.write");
/** Approving, rejecting and cancelling admit the patient or close the request, so they need the right to send ADT. */
/** Approving or rejecting an admission request is the Insurance Approvals Officer's step (and the administrator's). */
export const canDecideAdmission = (): boolean => can("approvals");

/* ---------- selectors ---------- */

export const admittedVisitOf = (patientId: string, s: HisState = getState()): Encounter | undefined =>
  s.encounters.find((e) => e.patientId === patientId && e.status === "active" && e.cls === "I");

export const pendingRequestOf = (patientId: string, s: State = get()): AdmissionRequest | undefined =>
  s.requests.find((r) => r.patientId === patientId && r.status === "pending");

/** Open outpatient or emergency visits the request can come from. */
export const sourceVisitsOf = (patientId: string, s: HisState = getState()): Encounter[] =>
  s.encounters.filter((e) => e.patientId === patientId && e.status === "active" && (e.cls === "O" || e.cls === "E"));

/** Why this patient cannot get a new request. null when the patient can. */
export function requestBlock(patientId: string): string | null {
  const adm = admittedVisitOf(patientId);
  if (adm) return `This patient is already admitted (visit ${adm.visitNumber}).`;
  const pending = pendingRequestOf(patientId);
  if (pending) return `This patient already has a pending admission request (${pending.id}).`;
  return null;
}

/** The visit approval will change to inpatient, when it is still an open outpatient or emergency visit. */
export function openSourceVisit(r: AdmissionRequest, s: HisState = getState()): Encounter | undefined {
  if (!r.fromVisit) return undefined;
  const e = s.encounters.find((x) => x.visitNumber === r.fromVisit);
  return e && e.status === "active" && (e.cls === "O" || e.cls === "E") ? e : undefined;
}

/** Default admission type for where the patient comes from: 02 from the ER, 03 from a clinic, 14 elective. */
export const defaultAdmissionType = (fromCls?: string): string => (fromCls === "E" ? "02" : fromCls === "O" ? "03" : "14");

/* ---------- raise a request ---------- */

export interface RequestInput {
  patientId: string;
  fromVisit?: string;
  admittingDoctor: string;
  approvingDoctor: string;
  admitAt: string;
  department: string;
  subDepartment: string;
  admissionType: string;
  condition: string;
  activityLevel: string;
  /** Text from the form. Empty when not given. */
  expectedStayDays: string;
  specialty: string;
  dx?: { code: string; text: string };
  reason: string;
}

export function requestProblems(input: RequestInput): string[] {
  const errors: string[] = [];
  const s = getState();
  const patient = s.patients.find((p) => p.id === input.patientId);
  if (!patient) errors.push("Choose the patient.");
  else {
    const block = requestBlock(patient.id);
    if (block) errors.push(block);
  }
  if (input.fromVisit && patient && !sourceVisitsOf(patient.id, s).some((e) => e.visitNumber === input.fromVisit)) {
    errors.push("The visit must be an open outpatient or emergency visit of this patient.");
  }
  if (!input.admittingDoctor) errors.push("Choose the admitting doctor.");
  if (!input.approvingDoctor) errors.push("Choose the approving doctor.");
  if (!input.admitAt || Number.isNaN(new Date(input.admitAt).getTime())) errors.push("Enter the admission date and time.");
  if (!input.department) errors.push("Choose the department.");
  if (!input.admissionType) errors.push("Choose the admission type.");
  if (!input.condition) errors.push("Choose the patient condition.");
  if (input.expectedStayDays.trim()) {
    const n = Number(input.expectedStayDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) errors.push("Expected stay is a whole number of days, 1 to 365.");
  }
  if (input.reason.trim().length < 5) errors.push("Write the reason for admission (at least 5 characters).");
  return errors;
}

export function createRequest(input: RequestInput, now: number = Date.now()): Result<AdmissionRequest> {
  if (!canRequestAdmission()) {
    audit("denied", "Admission request", { detail: "Raising an admission request needs chart write access." });
    return { ok: false, errors: ["Your role cannot raise an admission request."] };
  }
  const errors = requestProblems(input);
  if (errors.length) return { ok: false, errors };
  const s = get();
  const seq = s.seq + 1;
  const r: AdmissionRequest = {
    id: `AR-${1000 + seq}`,
    patientId: input.patientId,
    fromVisit: input.fromVisit || undefined,
    admittingDoctor: input.admittingDoctor,
    approvingDoctor: input.approvingDoctor,
    admitAt: input.admitAt,
    department: input.department,
    subDepartment: input.subDepartment,
    admissionType: input.admissionType,
    condition: input.condition,
    activityLevel: input.activityLevel,
    expectedStayDays: input.expectedStayDays.trim() ? Number(input.expectedStayDays) : undefined,
    specialty: input.specialty,
    dx: input.dx,
    reason: input.reason.trim(),
    status: "pending",
    requestedBy: who(),
    requestedAt: iso(now),
  };
  commit({ ...s, seq, requests: [r, ...s.requests] });
  audit("create", `Admission request ${r.id}`, {
    patient: patientName(getState().patients.find((p) => p.id === r.patientId)),
    detail: `${departmentLabel(r.department)}, ${admissionTypeLabel(r.admissionType)}. Approver ${doctorLabel(r.approvingDoctor)}.${r.fromVisit ? ` From visit ${r.fromVisit}.` : ""}`,
  });
  return { ok: true, value: r };
}

/* ---------- approve ---------- */

export interface ApprovalInput {
  department: string;
  admitAt: string;
  admissionType: string;
  patientClass: "I" | "O";
  preAdmit: boolean;
  bedId: string;
  consulting: string;
  plan: PayPlan;
  /** Text from the form. Empty when not given. */
  expectedDays: string;
  activityLevel: string;
  condition: string;
  attendantName: string;
  attendantPhone: string;
  attendantRelation: string;
  notes: string;
}

/** The approval form, filled from the request. */
export function approvalDefaults(r: AdmissionRequest): ApprovalInput {
  const p = getState().patients.find((x) => x.id === r.patientId);
  return {
    department: r.department,
    admitAt: r.admitAt,
    admissionType: r.admissionType,
    patientClass: "I",
    preAdmit: false,
    bedId: "",
    consulting: "",
    plan: p?.extra?.visitPayType === "Cash" || !p?.extra?.insurance ? "Cash" : "Insurance",
    expectedDays: r.expectedStayDays ? String(r.expectedStayDays) : "",
    activityLevel: r.activityLevel,
    condition: r.condition,
    attendantName: p?.extra?.relationName ?? "",
    attendantPhone: p?.extra?.relationPhone ?? "",
    attendantRelation: "",
    notes: "",
  };
}

/** What approval will do with these choices. */
export function approvalEvent(r: AdmissionRequest, a: Pick<ApprovalInput, "preAdmit">): "A01" | "A05" | "A06" {
  if (a.preAdmit) return "A05";
  return openSourceVisit(r) ? "A06" : "A01";
}

/** Problems that stop approval, in words for the screen. Empty when it can go ahead. */
export function approvalProblems(r: AdmissionRequest, a: ApprovalInput, now: number = Date.now()): string[] {
  const errors: string[] = [];
  const s = getState();
  if (r.status !== "pending") return [`This request is ${STATUS_LABEL[r.status].toLowerCase()}. Only a pending request can be approved.`];
  const adm = admittedVisitOf(r.patientId, s);
  if (adm) errors.push(`This patient is already admitted (visit ${adm.visitNumber}).`);
  if (!a.department) errors.push("Choose the department.");
  if (!a.admissionType) errors.push("Choose the admission type.");
  const t = new Date(a.admitAt).getTime();
  if (!a.admitAt || Number.isNaN(t)) errors.push("Enter the admission date and time.");
  else if (!a.preAdmit && t > now + 5 * 60_000) errors.push("The admission date is in the future. Tick Pre-Admit to plan it, or set it to now.");
  if (a.expectedDays.trim()) {
    const n = Number(a.expectedDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) errors.push("Expected days is a whole number, 1 to 365.");
  }
  if (a.attendantPhone.trim() && !/^\+?[0-9 ]{9,15}$/.test(a.attendantPhone.trim())) errors.push("Enter the contact number with digits only, for example 0551234567.");
  const source = openSourceVisit(r, s);
  // CHI: an insured elective admission waits for the payer's prior authorization. An emergency admission goes ahead
  // and the authorization follows within 24 hours. A pre-admission only plans the stay, so it may wait for the answer.
  const payer = insuredPayer(s.patients.find((p) => p.id === r.patientId) ?? {});
  if (!a.preAdmit && payer && a.admissionType && cnhiAdmissionMethod(a.admissionType) === "14") {
    const auth = source ? caseOf(source.visitNumber).authorization : undefined;
    if (auth?.status !== "approved") {
      errors.push(`${payer} has not approved this elective admission yet. Request prior authorization on NPHIES Financial, tick Pre-Admit to plan the stay meanwhile, or choose an emergency admission type.`);
    }
  }
  if (a.preAdmit) {
    const pre = s.encounters.find((e) => e.patientId === r.patientId && e.status === "preadmit");
    if (pre) errors.push(`This patient already has a pre-admission (visit ${pre.visitNumber}).`);
  } else {
    if (a.patientClass === "O" && source) errors.push("The open visit is changed to inpatient. Choose Inpatient as the patient class.");
    if (a.patientClass === "I" && !a.bedId) errors.push("Pick a free bed, or tick Pre-Admit to approve without a bed.");
  }
  if (a.bedId) {
    // The app's own bed rules: a free bed, or the bed held for this patient.
    const why = bedProblem(s, a.bedId, { visit: a.preAdmit ? undefined : source?.visitNumber, patientId: r.patientId });
    if (why) errors.push(why);
  }
  return errors;
}

export function approveRequest(id: string, a: ApprovalInput, now: number = Date.now()): Result<AdmissionRequest> {
  const r = get().requests.find((x) => x.id === id);
  if (!r) return { ok: false, errors: ["This request was not found."] };
  const patient = patientName(getState().patients.find((p) => p.id === r.patientId));
  if (!canDecideAdmission()) {
    audit("denied", `Admission request ${id}`, { patient, detail: "Approve" });
    return { ok: false, errors: ["Your role cannot approve admission requests."] };
  }
  const errors = approvalProblems(r, a, now);
  if (errors.length) return { ok: false, errors };

  const eventId = approvalEvent(r, a);
  const source = openSourceVisit(r);
  const dx: Dx[] = r.dx ? [{ code: r.dx.code, text: r.dx.text, type: "A", at: a.admitAt }] : [];
  const bedId = a.bedId || undefined;
  let out: Outcome;
  if (eventId === "A06") {
    out = quickSend("A06", source!.visitNumber, (f) => {
      f.bedId = a.bedId;
      f.attending = r.admittingDoctor;
      f.admitting = r.admittingDoctor;
      f.consulting = a.consulting;
      f.service = a.department;
      f.reason = r.reason;
      f.admissionMethod = a.admissionType;
      f.admitAt = a.admitAt;
      for (const d of dx) if (!f.dx.some((x) => x.code === d.code)) f.dx.push(d);
    });
  } else {
    out = quickCreate(eventId, {
      patientId: r.patientId,
      attending: r.admittingDoctor,
      service: a.department,
      reason: r.reason,
      admitClass: a.patientClass,
      admissionMethod: a.admissionType,
      consulting: a.consulting || undefined,
      bedId: eventId === "A01" ? bedId : undefined,
      expectedAdmitAt: eventId === "A05" ? a.admitAt : undefined,
      reserveBedId: eventId === "A05" ? bedId : undefined,
      // The admitting diagnosis goes in the admit or pre-admit message itself (DG1).
      dx: dx.length ? dx : undefined,
    });
  }
  if (!out.ok || !out.entry) return { ok: false, errors: ["The admission could not be saved. See the message on screen."] };

  const s = get();
  const approval: Approval = {
    department: a.department, admitAt: a.admitAt, admissionType: a.admissionType, patientClass: a.patientClass, preAdmit: a.preAdmit,
    bedId, consulting: a.consulting || undefined, plan: a.plan,
    expectedDays: a.expectedDays.trim() ? Number(a.expectedDays) : undefined,
    activityLevel: a.activityLevel, condition: a.condition,
    attendantName: a.attendantName.trim(), attendantPhone: a.attendantPhone.trim(), attendantRelation: a.attendantRelation, notes: a.notes.trim(),
    eventId, visitNumber: out.entry.visitNumber, controlId: out.entry.controlId,
  };
  const next: AdmissionRequest = { ...r, status: a.preAdmit ? "preadmitted" : "approved", decidedBy: who(), decidedAt: iso(now), approval };
  commit({ ...s, requests: s.requests.map((x) => (x.id === id ? next : x)) });
  audit("update", `Admission request ${id}`, {
    patient,
    detail: `${STATUS_LABEL[next.status]}. ${eventId} sent for visit ${approval.visitNumber}${bedId ? `, bed ${bedId}` : ", no bed"}. ${a.plan}.`,
  });
  return { ok: true, value: next };
}

/* ---------- reject, cancel ---------- */

function close(id: string, status: "rejected" | "cancelled", reason: string, now: number): Result<AdmissionRequest> {
  const verb = status === "rejected" ? "reject" : "cancel";
  const r = get().requests.find((x) => x.id === id);
  if (!r) return { ok: false, errors: ["This request was not found."] };
  const patient = patientName(getState().patients.find((p) => p.id === r.patientId));
  // The doctor who can raise a request may also cancel it; only the approvals officer rejects.
  const allowed = status === "cancelled" ? canDecideAdmission() || canRequestAdmission() : canDecideAdmission();
  if (!allowed) {
    audit("denied", `Admission request ${id}`, { patient, detail: status === "rejected" ? "Reject" : "Cancel" });
    return { ok: false, errors: [`Your role cannot ${verb} admission requests.`] };
  }
  if (r.status !== "pending") return { ok: false, errors: [`This request is ${STATUS_LABEL[r.status].toLowerCase()}. Only a pending request can be ${status}.`] };
  if (reason.trim().length < 3) return { ok: false, errors: [`Write why the request is ${status}.`] };
  const s = get();
  const next: AdmissionRequest = { ...r, status, decidedBy: who(), decidedAt: iso(now), decisionReason: reason.trim() };
  commit({ ...s, requests: s.requests.map((x) => (x.id === id ? next : x)) });
  audit("update", `Admission request ${id}`, { patient, detail: `${STATUS_LABEL[status]}. Reason: ${reason.trim()}. No visit made, no message sent.` });
  return { ok: true, value: next };
}

export const rejectRequest = (id: string, reason: string, now: number = Date.now()) => close(id, "rejected", reason, now);
export const cancelRequest = (id: string, reason: string, now: number = Date.now()) => close(id, "cancelled", reason, now);

export const REJECT_REASONS = ["Does not meet admission criteria", "Can be treated as an outpatient", "Refer to another hospital", "Insurance approval refused"];
export const CANCEL_REQUEST_REASONS = ["Patient refused admission", "Requested by mistake", "Patient left the hospital", "Duplicate request"];

/* ---------- sample data ---------- */

function seed(): State {
  const s = getState();
  const at = (minsAgo: number) => toLocalInput(new Date(Date.now() - minsAgo * 60_000));
  const dxOf = (code: string) => ADMISSION_DIAGNOSES.find((d) => d.code === code);
  const free = (pid: string) => s.patients.some((p) => p.id === pid) && !admittedVisitOf(pid, s);
  const from = (pid: string) => sourceVisitsOf(pid, s)[0];
  const rows: Omit<AdmissionRequest, "id">[] = [];
  const add = (pid: string, minsAgo: number, r: Omit<AdmissionRequest, "id" | "patientId" | "status" | "requestedAt" | "fromVisit" | "admissionType"> & { admissionType?: string }) => {
    if (!free(pid)) return;
    const visit = from(pid);
    rows.push({
      ...r, patientId: pid, fromVisit: visit?.visitNumber, status: "pending", requestedAt: new Date(Date.now() - minsAgo * 60_000).toISOString(),
      admissionType: r.admissionType ?? defaultAdmissionType(visit?.cls),
    });
  };
  // From the emergency department: abdominal pain with fever, likely appendicitis.
  add("P012", 25, {
    admittingDoctor: "D1002", approvingDoctor: "D1002", admitAt: at(20), department: "SUR", subDepartment: "General Surgery",
    condition: "Serious", activityLevel: "Bed Rest", expectedStayDays: 3, specialty: "General Surgery", dx: dxOf("K35.80"),
    reason: "Right lower abdominal pain with fever. Ultrasound suggests acute appendicitis. Admit for surgery.", requestedBy: "Dr. Noura Alzahrani",
  });
  // From the medicine clinic: an older man with fever, likely pneumonia.
  add("P007", 35, {
    admittingDoctor: "D1001", approvingDoctor: "D1003", admitAt: at(30), department: "MED", subDepartment: "Pulmonology",
    condition: "Fair", activityLevel: "Walks With Help", expectedStayDays: 5, specialty: "Pulmonology", dx: dxOf("J18.9"),
    reason: "Fever and cough for four days, low oxygen on room air. Needs intravenous antibiotics.", requestedBy: "Dr. Khalid Alharbi",
  });
  // No open visit: planned admission to start insulin.
  add("P009", 90, {
    admittingDoctor: "D1001", approvingDoctor: "D1001", admitAt: at(-60), department: "MED", subDepartment: "Endocrinology",
    condition: "Stable", activityLevel: "Walks Without Help", expectedStayDays: 2, specialty: "Endocrinology", dx: dxOf("E11.9"),
    reason: "Blood sugar not controlled on tablets. Planned admission to start insulin and teach self-injection.", requestedBy: "Dr. Khalid Alharbi",
    admissionType: "14",
  });
  return { requests: rows.map((r, i) => ({ ...r, id: `AR-${1001 + i}` })), seq: rows.length };
}
