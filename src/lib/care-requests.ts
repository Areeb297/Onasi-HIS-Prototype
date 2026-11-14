import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import type { Encounter } from "./model";
import { getRx, rxForVisit } from "./rx";
import { DRUG_BY_ID } from "./rx-catalogue";
import { currentUser } from "./session";
import { getState } from "./store";

/**
 * Two things a doctor asks for from the chart that somebody else must act on:
 * a follow-up visit (a booking request for the appointments desk) and a consult from another specialty.
 * Own localStorage store.
 */

const MIN = 60_000;

/* ---------- lists ---------- */

export const CLINICS = [
  "General Medicine Clinic", "Family Medicine Clinic", "Surgery Clinic", "Orthopedics Clinic", "Cardiology Clinic",
  "Diabetes And Endocrine Clinic", "Pediatrics Clinic", "Obstetrics And Gynecology Clinic",
];

export const SPECIALTIES = [
  "Cardiology", "General Surgery", "Orthopedics", "Intensive Care", "Neurology", "Nephrology", "Pulmonology",
  "Infectious Diseases", "Endocrinology", "Psychiatry", "Obstetrics And Gynecology", "Pediatrics", "Anesthesia",
];

export type VisitType = "in-person" | "telehealth";
export const VISIT_TYPE_LABEL: Record<VisitType, string> = { "in-person": "In person", telehealth: "Telehealth" };

export type FollowUpStatus = "requested" | "booked" | "done" | "cancelled";
export const FOLLOW_UP_LABEL: Record<FollowUpStatus, string> = { requested: "Requested", booked: "Booked", done: "Done", cancelled: "Cancelled" };

export type Urgency = "routine" | "urgent" | "emergency";
export const URGENCY_LABEL: Record<Urgency, string> = { routine: "Routine", urgent: "Urgent", emergency: "Emergency" };

/** Minutes from the request until the patient should be seen. The 30 minutes for emergency consults is the measured one. */
export const CONSULT_TARGET_MIN: Record<Urgency, number> = { emergency: 30, urgent: 240, routine: 1440 };

export type ConsultStatus = "requested" | "accepted" | "seen" | "closed";
export const CONSULT_LABEL: Record<ConsultStatus, string> = { requested: "Requested", accepted: "Accepted", seen: "Seen", closed: "Closed" };

/* ---------- records ---------- */

export interface FollowUp {
  id: string;
  visit: string;
  patientId: string;
  amount: number;
  unit: "days" | "weeks";
  /** YYYY-MM-DD the patient should be seen by, counted from the order. */
  targetDate: string;
  clinic: string;
  /** Doctor id. Empty means any doctor in the clinic. */
  doctorId: string;
  visitType: VisitType;
  instructions: string;
  status: FollowUpStatus;
  orderedBy: string;
  orderedAt: string;
  /** Local date-time of the appointment. */
  bookedFor?: string;
  bookedBy?: string;
  bookedAt?: string;
  doneBy?: string;
  doneAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface Consult {
  id: string;
  visit: string;
  patientId: string;
  specialty: string;
  urgency: Urgency;
  question: string;
  findings: string;
  status: ConsultStatus;
  requestedBy: string;
  requestedAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
  seenBy?: string;
  seenAt?: string;
  answer?: string;
  recommendations?: string;
  closedBy?: string;
  closedAt?: string;
  closeReason?: string;
}

interface State {
  followUps: FollowUp[];
  consults: Consult[];
  seq: number;
}

const KEY = "onasi-emr-care-requests-v1";
const EMPTY: State = { followUps: [], consults: [], seq: 0 };
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as State) };
  } catch {
    /* storage may be blocked */
  }
  return EMPTY;
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

export function useCareRequests(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}
export const getCareRequests = get;
export const resetCareRequests = () => commit({ followUps: [], consults: [], seq: 0 });

const who = (): string => {
  try { return currentUser().name; } catch { return "Unknown"; }
};
const iso = (t: number) => new Date(t).toISOString();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ---------- follow-up ---------- */

export const followUpsOf = (visit: string, s: State = get()): FollowUp[] =>
  s.followUps.filter((f) => f.visit === visit).sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));

export const followUpTitle = (f: Pick<FollowUp, "amount" | "unit">) => `Follow up in ${f.amount} ${f.amount === 1 ? f.unit.slice(0, -1) : f.unit}`;

export function followUpTarget(amount: number, unit: "days" | "weeks", from: number = Date.now()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + amount * (unit === "weeks" ? 7 : 1));
  return ymd(d);
}

export interface FollowUpInput {
  visit: string;
  amount: number;
  unit: "days" | "weeks";
  clinic: string;
  doctorId: string;
  visitType: VisitType;
  instructions: string;
}

export function orderFollowUp(input: FollowUpInput, now: number = Date.now()): Result<FollowUp> {
  const enc = getState().encounters.find((e) => e.visitNumber === input.visit);
  const errors: string[] = [];
  if (!enc) errors.push("This visit was not found.");
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 365) errors.push("Enter a whole number of days or weeks, 1 or more.");
  if (!input.clinic.trim()) errors.push("Choose the clinic.");
  if (errors.length || !enc) return { ok: false, errors };
  const s = get();
  const seq = s.seq + 1;
  const f: FollowUp = {
    id: `FU-${seq}`, visit: enc.visitNumber, patientId: enc.patientId, amount: input.amount, unit: input.unit,
    targetDate: followUpTarget(input.amount, input.unit, now), clinic: input.clinic.trim(), doctorId: input.doctorId,
    visitType: input.visitType, instructions: input.instructions.trim(), status: "requested", orderedBy: who(), orderedAt: iso(now),
  };
  commit({ ...s, seq, followUps: [...s.followUps, f] });
  audit("create", `Follow-up order ${f.id}`, { patient: enc.patientId, detail: `Visit ${enc.visitNumber}. ${followUpTitle(f)}, ${f.clinic}, ${VISIT_TYPE_LABEL[f.visitType].toLowerCase()}` });
  return { ok: true, value: f };
}

function patchFollowUp(id: string, from: FollowUpStatus[], patch: (f: FollowUp) => FollowUp, what: string): Result<FollowUp> {
  const s = get();
  const f = s.followUps.find((x) => x.id === id);
  if (!f) return { ok: false, errors: ["This follow-up was not found."] };
  if (!from.includes(f.status)) return { ok: false, errors: [`A follow-up that is ${FOLLOW_UP_LABEL[f.status].toLowerCase()} cannot be ${what}.`] };
  const next = patch(f);
  commit({ ...s, followUps: s.followUps.map((x) => (x.id === id ? next : x)) });
  audit("update", `Follow-up order ${id}`, { patient: f.patientId, detail: `Visit ${f.visit}. ${FOLLOW_UP_LABEL[next.status]}` });
  return { ok: true, value: next };
}

/** The appointments desk found a slot. `when` is a local date-time (YYYY-MM-DDTHH:mm). */
export function bookFollowUp(id: string, when: string, now: number = Date.now()): Result<FollowUp> {
  if (!when || Number.isNaN(new Date(when).getTime())) return { ok: false, errors: ["Enter the appointment date and time."] };
  if (new Date(when).getTime() < now - MIN) return { ok: false, errors: ["The appointment cannot be in the past."] };
  return patchFollowUp(id, ["requested", "booked"], (f) => ({ ...f, status: "booked", bookedFor: when, bookedBy: who(), bookedAt: iso(now) }), "booked");
}

export function completeFollowUp(id: string, now: number = Date.now()): Result<FollowUp> {
  return patchFollowUp(id, ["booked"], (f) => ({ ...f, status: "done", doneBy: who(), doneAt: iso(now) }), "marked done");
}

export function cancelFollowUp(id: string, reason: string, now: number = Date.now()): Result<FollowUp> {
  if (!reason.trim()) return { ok: false, errors: ["Write why the follow-up is cancelled."] };
  return patchFollowUp(id, ["requested", "booked"], (f) => ({ ...f, status: "cancelled", cancelledBy: who(), cancelledAt: iso(now), cancelReason: reason.trim() }), "cancelled");
}

/** Follow-ups ordered on a visit that nobody has booked yet. A discharged patient should not leave without one. */
export const unbookedFollowUps = (visit: string, s: State = get()): FollowUp[] => followUpsOf(visit, s).filter((f) => f.status === "requested");

/* ---------- consult ---------- */

export const consultsOf = (visit: string, s: State = get()): Consult[] =>
  s.consults.filter((c) => c.visit === visit).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

export interface ConsultInput {
  visit: string;
  specialty: string;
  urgency: Urgency;
  question: string;
  findings: string;
}

export function requestConsult(input: ConsultInput, now: number = Date.now()): Result<Consult> {
  const enc = getState().encounters.find((e) => e.visitNumber === input.visit);
  const errors: string[] = [];
  if (!enc) errors.push("This visit was not found.");
  if (!input.specialty.trim()) errors.push("Choose the specialty.");
  if (!input.question.trim()) errors.push("Write the clinical question.");
  if (errors.length || !enc) return { ok: false, errors };
  const s = get();
  const seq = s.seq + 1;
  const c: Consult = {
    id: `CN-${seq}`, visit: enc.visitNumber, patientId: enc.patientId, specialty: input.specialty.trim(), urgency: input.urgency,
    question: input.question.trim(), findings: input.findings.trim(), status: "requested", requestedBy: who(), requestedAt: iso(now),
  };
  commit({ ...s, seq, consults: [...s.consults, c] });
  audit("create", `Consult request ${c.id}`, { patient: enc.patientId, detail: `Visit ${enc.visitNumber}. ${c.specialty}, ${URGENCY_LABEL[c.urgency].toLowerCase()}` });
  return { ok: true, value: c };
}

function patchConsult(id: string, from: ConsultStatus[], patch: (c: Consult) => Consult, what: string): Result<Consult> {
  const s = get();
  const c = s.consults.find((x) => x.id === id);
  if (!c) return { ok: false, errors: ["This consult was not found."] };
  if (!from.includes(c.status)) return { ok: false, errors: [`A consult that is ${CONSULT_LABEL[c.status].toLowerCase()} cannot be ${what}.`] };
  const next = patch(c);
  commit({ ...s, consults: s.consults.map((x) => (x.id === id ? next : x)) });
  audit("update", `Consult request ${id}`, { patient: c.patientId, detail: `Visit ${c.visit}. ${CONSULT_LABEL[next.status]}` });
  return { ok: true, value: next };
}

export function acceptConsult(id: string, now: number = Date.now()): Result<Consult> {
  return patchConsult(id, ["requested"], (c) => ({ ...c, status: "accepted", acceptedBy: who(), acceptedAt: iso(now) }), "accepted");
}

/** The consultant saw the patient and writes the answer. Seeing a consult that was not accepted yet accepts it at the same time. */
export function answerConsult(id: string, answer: string, recommendations: string, now: number = Date.now()): Result<Consult> {
  if (!answer.trim()) return { ok: false, errors: ["Write the answer to the clinical question."] };
  return patchConsult(id, ["requested", "accepted"], (c) => ({
    ...c, status: "seen", acceptedBy: c.acceptedBy ?? who(), acceptedAt: c.acceptedAt ?? iso(now),
    seenBy: who(), seenAt: iso(now), answer: answer.trim(), recommendations: recommendations.trim(),
  }), "answered");
}

/** Close a consult. One that was never seen needs a reason. */
export function closeConsult(id: string, reason = "", now: number = Date.now()): Result<Consult> {
  const c = get().consults.find((x) => x.id === id);
  if (c && c.status !== "seen" && c.status !== "closed" && !reason.trim()) return { ok: false, errors: ["The patient was not seen. Write why the consult is closed."] };
  return patchConsult(id, ["requested", "accepted", "seen"], (x) => ({ ...x, status: "closed", closedBy: who(), closedAt: iso(now), closeReason: reason.trim() || undefined }), "closed");
}

export interface ConsultTimes {
  target: number;
  /** Minutes from request to accepted. Undefined until accepted. */
  toAccepted?: number;
  /** Minutes from request to seen. Undefined until seen. */
  toSeen?: number;
  /** Minutes the request has waited so far. Only while nobody has seen the patient. */
  waiting?: number;
  /** Still not seen and past the target. */
  overdue: boolean;
  /** Seen, but after the target. */
  seenLate: boolean;
}

const minsBetween = (a: string, b: string | number) => Math.max(0, Math.round(((typeof b === "number" ? b : new Date(b).getTime()) - new Date(a).getTime()) / MIN));

export function consultTimes(c: Consult, now: number = Date.now()): ConsultTimes {
  const target = CONSULT_TARGET_MIN[c.urgency];
  const toAccepted = c.acceptedAt ? minsBetween(c.requestedAt, c.acceptedAt) : undefined;
  const toSeen = c.seenAt ? minsBetween(c.requestedAt, c.seenAt) : undefined;
  const open = c.status === "requested" || c.status === "accepted";
  const waiting = open ? minsBetween(c.requestedAt, now) : undefined;
  return { target, toAccepted, toSeen, waiting, overdue: open && (waiting as number) > target, seenLate: toSeen !== undefined && toSeen > target };
}

/** Open consults that have waited longer than their target. */
export function consultsPastTarget(visit: string, now: number = Date.now(), s: State = get()): Consult[] {
  return consultsOf(visit, s).filter((c) => consultTimes(c, now).overdue);
}

/** Minutes as "45 minutes" or "3 hours 10 minutes". */
export function minutesText(m: number): string {
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} hour${h === 1 ? "" : "s"}${r ? ` ${r} minute${r === 1 ? "" : "s"}` : ""}`;
}

/** Findings for the consultant, written from the chart. The doctor can edit the text before sending. */
export function chartFindings(enc: Encounter): string {
  const lines: string[] = [];
  if (enc.reason) lines.push(`Reason for the visit: ${enc.reason}.`);
  if (enc.dx.length) lines.push(`Diagnoses: ${enc.dx.map((d) => `${d.text} (${d.code})`).join("; ")}.`);
  lines.push(`Allergies: ${enc.allergies.length ? enc.allergies.map((a) => a.text).join(", ") : "none recorded"}.`);
  const v = enc.vitals;
  if (v) {
    const parts = [v.bp && `BP ${v.bp}`, v.pulse && `pulse ${v.pulse}`, v.rr && `breathing ${v.rr}`, v.temp && `temperature ${v.temp}`, v.spo2 && `oxygen ${v.spo2}%`].filter(Boolean);
    if (parts.length) lines.push(`Latest vital signs: ${parts.join(", ")}.`);
  }
  if (enc.pr.length) lines.push(`Procedures: ${enc.pr.map((p) => p.text).join("; ")}.`);
  const drugs = rxForVisit(getRx(), enc.visitNumber)
    .flatMap((rx) => rx.items.filter((i) => i.status === "active" || i.status === "on-hold"))
    .map((i) => DRUG_BY_ID[i.drugId]?.generic)
    .filter(Boolean);
  if (drugs.length) lines.push(`Current medicines: ${[...new Set(drugs)].join(", ")}.`);
  const note = enc.notes[enc.notes.length - 1];
  if (note) lines.push(`Last note: ${note.text.slice(0, 200)}`);
  return lines.join("\n");
}
