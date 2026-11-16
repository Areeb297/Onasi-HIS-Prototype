import { useSyncExternalStore } from "react";
import { quickCreate, quickSend } from "./actions";
import { audit } from "./audit";
import type { Encounter, Patient } from "./model";
import { DOCTORS } from "./reference-data";
import { coverageOutcome, type CoverageOutcome } from "./registration";
import { retrieveInsurance, type InsuranceCard } from "./registry";
import { currentUser } from "./session";
import { bedLabel, getState, patientName, updateEncounter } from "./store";
import { fmtDayHeading } from "./format";

/**
 * Outpatient appointments: the board the front desk works from and the booking rules.
 * Own localStorage store. Follows the HIS scheduler: five board columns over ten statuses, the same allowed moves,
 * and the visit opened at check-in.
 *
 * Deliberate differences from the HIS:
 *  - Coverage is checked before the visit opens. A patient who is not covered goes on only as a cash patient, and only
 *    when the clerk chooses that.
 *  - The visit is opened with the app's own A04 (quickCreate), so the national message and the OPD worklist follow.
 *  - Check-out is offered only once the doctor has ended the linked visit.
 *  - A cancelled or no-show appointment keeps no open visit: a visit opened at the desk is cancelled (A11) with it.
 */

const DAY = 86_400_000;

/* ---------- lists ---------- */

export type ApptStatus =
  | "booked" | "confirmed" | "arrived" | "waiting" | "checked-in" | "checked-out" | "completed" | "cancelled" | "no-show" | "rescheduled";

export const STATUS_LABEL: Record<ApptStatus, string> = {
  booked: "Booked", confirmed: "Confirmed", arrived: "Arrived", waiting: "Waiting", "checked-in": "Checked In",
  "checked-out": "Checked Out", completed: "Completed", cancelled: "Cancelled", "no-show": "No Show", rescheduled: "Rescheduled",
};

export type ApptColumn = "booked" | "scheduled" | "checkin" | "checkout" | "cancelled";

export const COLUMN_LABEL: Record<ApptColumn, string> = {
  booked: "Booked", scheduled: "Scheduled", checkin: "Check-In / Arrived", checkout: "Check-Out", cancelled: "Cancelled",
};

export const COLUMN_ORDER: ApptColumn[] = ["booked", "scheduled", "checkin", "checkout", "cancelled"];

const COLUMN_OF: Record<ApptStatus, ApptColumn> = {
  booked: "booked", confirmed: "scheduled", arrived: "checkin", waiting: "checkin", "checked-in": "checkin",
  "checked-out": "checkout", completed: "checkout", cancelled: "cancelled", "no-show": "cancelled", rescheduled: "cancelled",
};
export const columnOf = (s: ApptStatus): ApptColumn => COLUMN_OF[s];

/** Statuses that hold the doctor's time. A cancelled, no-show or rescheduled appointment frees the slot. */
export const isLive = (s: ApptStatus) => s !== "cancelled" && s !== "no-show" && s !== "rescheduled";

export type VisitType = "in-person" | "online";
/** HIS Appointments.AppointmentType has New, Follow Up, Online Visit and Walk-In; here only In Person and Online Visit are kept. */
export const VISIT_TYPE_LABEL: Record<VisitType, string> = { "in-person": "In Person", online: "Online Visit" };

/** The clinic speciality of each service the doctors belong to. */
const SPECIALITY_OF_SERVICE: Record<string, string> = {
  MED: "Internal Medicine", SUR: "General Surgery", ICU: "Pulmonology And Critical Care", RAD: "Radiology", ORT: "Orthopedics",
};
export const specialityOf = (doctorId: string): string => SPECIALITY_OF_SERVICE[DOCTORS.find((d) => d.id === doctorId)?.service ?? ""] ?? "General Clinic";
export const SPECIALITIES: string[] = [...new Set(DOCTORS.map((d) => specialityOf(d.id)))];
export const doctorsFor = (speciality: string) => DOCTORS.filter((d) => !speciality || specialityOf(d.id) === speciality);
export const doctorName = (id: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "Unknown doctor";
};

export const CANCEL_REASONS = ["Patient request", "Patient unwell", "Doctor not available", "Booked by mistake", "Other"];
export const NO_SHOW_REASONS = ["Did not arrive", "Left before being seen", "Could not be reached", "Other"];
export const RESCHEDULE_REASONS = ["Patient request", "Doctor not available", "Clinic time changed", "Other"];

/** The doctor's clinic day. 20 minute slots, 08:00 to 16:00, with the midday break. Demo values: a real HIS reads shift assignments. */
export const SLOT_MIN = 20;
const DAY_START = 8 * 60;
const DAY_END = 16 * 60;
const BREAK = { from: 12 * 60, to: 13 * 60 };

/** Minutes a patient may wait at the desk before the card's clock turns red. */
export const WAIT_TARGET_MIN = 30;

/** The move every refused status change shows, as in the HIS. */
export const NOT_ALLOWED = "This move is not allowed for the current appointment status.";

/* ---------- records ---------- */

export interface StatusStep {
  status: ApptStatus;
  at: string;
  by: string;
  note?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  speciality: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  start: string;
  end: string;
  visitType: VisitType;
  reason: string;
  status: ApptStatus;
  /** ISO time the appointment entered its current status. */
  statusAt: string;
  bookedBy: string;
  bookedAt: string;
  history: StatusStep[];
  /** The outpatient visit opened at check-in. */
  visitNumber?: string;
  /** A visit that was opened and then cancelled with the appointment. */
  cancelledVisit?: string;
  /** How the visit is paid, decided at check-in. */
  payType?: "Cash" | "Insurance";
  /** The coverage answer at check-in, in words. */
  coverageNote?: string;
  /** Why the last move failed. Shown on the card until the next move works. */
  problem?: string;
  closeReason?: string;
  rescheduledTo?: string;
  rescheduledFrom?: string;
}

interface State {
  appointments: Appointment[];
  seq: number;
}

/* ---------- time helpers ---------- */

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayOf = (now: number = Date.now()) => ymd(new Date(now));
export const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
};
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** "Sun 15 Nov" */
export const dayLabel = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return fmtDayHeading(new Date(y, m - 1, d));
};

/* ---------- store ---------- */

const KEY = "onasi-appointments-v1";
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* storage may be blocked */
  }
  return seedAppointments();
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

export function useAppointments(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}
export const getAppointments = get;
/** Back to the sample appointments. */
export const resetAppointments = (now: number = Date.now()) => commit(seedAppointments(now));
/** No appointments at all. Used by the tests. */
export const clearAppointments = () => commit({ appointments: [], seq: 0 });

const who = (): string => {
  try { return currentUser().name; } catch { return "Unknown"; }
};

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const failed = <T>(...errors: string[]): Result<T> => ({ ok: false, errors });

const findAppt = (id: string) => get().appointments.find((a) => a.id === id);
const patientOf = (id: string): Patient | undefined => getState().patients.find((p) => p.id === id);
const visitOf = (visit?: string): Encounter | undefined => (visit ? getState().encounters.find((e) => e.visitNumber === visit) : undefined);

function save(a: Appointment) {
  const s = get();
  commit({ ...s, appointments: s.appointments.map((x) => (x.id === a.id ? a : x)) });
}

function withStatus(a: Appointment, status: ApptStatus, now: number, note?: string): Appointment {
  const at = new Date(now).toISOString();
  return { ...a, status, statusAt: at, problem: undefined, history: [...a.history, { status, at, by: who(), note }] };
}

function logChange(a: Appointment, detail: string) {
  audit("update", `Appointment ${a.id}`, { patient: patientName(patientOf(a.patientId)), detail: `${dayLabel(a.date)} ${a.start}, ${doctorName(a.doctorId)}. ${detail}` });
}

/* ---------- rules ---------- */

/** Next statuses the HIS allows from each status. Online appointments may go straight to Checked In. */
const NEXT: Record<ApptStatus, ApptStatus[]> = {
  booked: ["confirmed", "arrived", "cancelled", "rescheduled"],
  confirmed: ["arrived", "cancelled", "no-show", "rescheduled"],
  arrived: ["waiting", "checked-in", "cancelled"],
  waiting: ["checked-in", "no-show", "cancelled"],
  "checked-in": ["checked-out", "completed"],
  "checked-out": ["completed"],
  completed: [],
  cancelled: [],
  "no-show": [],
  rescheduled: [],
};

export function nextStatuses(a: Pick<Appointment, "status" | "visitType" | "visitNumber">): ApptStatus[] {
  const out = [...NEXT[a.status]];
  if (a.visitType === "online" && (a.status === "booked" || a.status === "confirmed")) {
    // Online: there is no desk arrival. Check-in opens the visit at once.
    out.splice(out.indexOf("arrived"), 1, "checked-in");
  }
  // The visit opened at the desk was cancelled (for example with Undo): the appointment can still be closed.
  if (a.status === "checked-in" && a.visitNumber && visitOf(a.visitNumber)?.status === "cancelled") out.push("cancelled");
  return out;
}

/** Which status a move to a column means, in the HIS order of preference. Null when none is allowed. */
const COLUMN_TARGETS: Record<ApptColumn, ApptStatus[]> = {
  booked: ["booked"],
  scheduled: ["confirmed"],
  checkin: ["arrived", "checked-in", "waiting"],
  checkout: ["checked-out", "completed"],
  cancelled: ["cancelled", "no-show", "rescheduled"],
};

export function targetStatus(a: Pick<Appointment, "status" | "visitType" | "visitNumber">, column: ApptColumn): ApptStatus | null {
  if (columnOf(a.status) === column) return null;
  const allowed = nextStatuses(a);
  return COLUMN_TARGETS[column].find((s) => allowed.includes(s)) ?? null;
}

/** The statuses the Cancelled column offers for this appointment. */
export const closeChoices = (a: Pick<Appointment, "status" | "visitType" | "visitNumber">): ApptStatus[] =>
  COLUMN_TARGETS.cancelled.filter((s) => nextStatuses(a).includes(s));

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** One rule for every move on the board, by drag or by the Move menu. */
export function canMoveTo(a: Appointment, column: ApptColumn, now: number = Date.now()): MoveCheck {
  const to = targetStatus(a, column);
  if (!to) return { ok: false, reason: NOT_ALLOWED };
  if (column === "checkin" && a.date !== todayOf(now)) {
    return { ok: false, reason: `${NOT_ALLOWED} Check-in is on the day of the appointment, ${dayLabel(a.date)}.` };
  }
  if (column === "checkout") {
    const v = visitOf(a.visitNumber);
    if (!v || v.status === "cancelled") return { ok: false, reason: `${NOT_ALLOWED} There is no open visit to check out.` };
    if (v.status !== "discharged") return { ok: false, reason: `${NOT_ALLOWED} Check-out is offered once visit ${v.visitNumber} has ended.` };
  }
  return { ok: true };
}

/* ---------- slots ---------- */

export interface Slot {
  start: string;
  end: string;
  /** Free to book. */
  free: boolean;
  /** Why it cannot be booked, in words. */
  why?: string;
}

/** The doctor's slots for a day. Taken and past slots are not free. `ignoreId` leaves one appointment out (rescheduling it). */
export function slotsFor(doctorId: string, date: string, now: number = Date.now(), ignoreId?: string, s: State = get()): Slot[] {
  const taken = new Map(
    s.appointments.filter((a) => a.doctorId === doctorId && a.date === date && isLive(a.status) && a.id !== ignoreId).map((a) => [a.start, a]),
  );
  const today = todayOf(now);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const out: Slot[] = [];
  for (let m = DAY_START; m + SLOT_MIN <= DAY_END; m += SLOT_MIN) {
    if (m >= BREAK.from && m < BREAK.to) continue;
    const start = fromMin(m);
    const end = fromMin(m + SLOT_MIN);
    const hit = taken.get(start);
    if (hit) out.push({ start, end, free: false, why: "Booked" });
    else if (date < today || (date === today && m < nowMin)) out.push({ start, end, free: false, why: "Past" });
    else out.push({ start, end, free: true });
  }
  return out;
}

/* ---------- booking ---------- */

export interface BookingInput {
  patientId: string;
  speciality: string;
  doctorId: string;
  date: string;
  start: string;
  visitType: VisitType;
  reason: string;
}

/** Problems that stop a booking, one per line, in the order of the form. Empty when it can be saved. */
export function bookingProblems(i: BookingInput, now: number = Date.now(), ignoreId?: string): string[] {
  const out: string[] = [];
  const doctor = DOCTORS.find((d) => d.id === i.doctorId);
  if (!i.patientId || !patientOf(i.patientId)) out.push("Pick the patient.");
  if (!i.speciality) out.push("Pick the speciality.");
  if (!doctor) out.push("Pick the doctor.");
  else if (i.speciality && specialityOf(doctor.id) !== i.speciality) out.push(`${doctorName(doctor.id)} does not work in ${i.speciality}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) out.push("Pick the date.");
  else if (i.date < todayOf(now)) out.push("The date cannot be in the past.");
  if (!i.start) out.push("Pick a free time.");
  else if (doctor && /^\d{4}-\d{2}-\d{2}$/.test(i.date)) {
    const slot = slotsFor(doctor.id, i.date, now, ignoreId).find((x) => x.start === i.start);
    if (!slot) out.push("That time is not in the doctor's clinic hours.");
    else if (slot.why === "Booked") out.push(`${i.start} on ${dayLabel(i.date)} is already booked for ${doctorName(doctor.id)}. Pick a free time.`);
    else if (slot.why === "Past") out.push("That time has already passed. Pick a later time.");
    else {
      const clash = get().appointments.find((a) => a.patientId === i.patientId && a.date === i.date && a.start === i.start && isLive(a.status) && a.id !== ignoreId);
      if (clash) out.push(`The patient already has an appointment at ${i.start} with ${doctorName(clash.doctorId)}.`);
    }
  }
  if (!i.reason.trim()) out.push("Enter the reason for the visit.");
  return out;
}

function make(i: BookingInput, id: string, now: number, extra: Partial<Appointment> = {}): Appointment {
  const at = new Date(now).toISOString();
  return {
    id, patientId: i.patientId, doctorId: i.doctorId, speciality: specialityOf(i.doctorId), date: i.date, start: i.start,
    end: fromMin(toMin(i.start) + SLOT_MIN), visitType: i.visitType, reason: i.reason.trim(), status: "booked", statusAt: at,
    bookedBy: who(), bookedAt: at, history: [{ status: "booked", at, by: who() }], ...extra,
  };
}

/** Book an appointment. It is saved as Booked. */
export function bookAppointment(i: BookingInput, now: number = Date.now()): Result<Appointment> {
  const errors = bookingProblems(i, now);
  if (errors.length) return failed(...errors);
  const s = get();
  const seq = s.seq + 1;
  const a = make(i, `AP-${1000 + seq}`, now);
  commit({ ...s, seq, appointments: [...s.appointments, a] });
  audit("create", `Appointment ${a.id}`, {
    patient: patientName(patientOf(a.patientId)),
    detail: `Booked for ${dayLabel(a.date)} ${a.start}, ${doctorName(a.doctorId)}, ${a.speciality}, ${VISIT_TYPE_LABEL[a.visitType]}. Reason: ${a.reason}`,
  });
  return { ok: true, value: a };
}

/* ---------- moves ---------- */

function step(id: string, to: ApptStatus, now: number, note?: string): Result<Appointment> {
  const a = findAppt(id);
  if (!a) return failed("This appointment was not found.");
  if (!nextStatuses(a).includes(to)) return failed(NOT_ALLOWED);
  const next = withStatus(a, to, now, note);
  save(next);
  logChange(next, `${STATUS_LABEL[a.status]} to ${STATUS_LABEL[to]}.${note ? ` ${note}` : ""}`);
  return { ok: true, value: next };
}

/** The patient confirmed the appointment. */
export const confirmAppointment = (id: string, now: number = Date.now()) => step(id, "confirmed", now);

/** The patient went to the waiting area after the desk check-in. */
export const sendToWaiting = (id: string, now: number = Date.now()) => step(id, "waiting", now);

/** The patient is called in to the doctor. The visit is marked checked in on the OPD worklist. No ADT message. */
export function callIn(id: string, now: number = Date.now()): Result<Appointment> {
  const a = findAppt(id);
  if (!a) return failed("This appointment was not found.");
  const v = visitOf(a.visitNumber);
  if (!v || v.status !== "active") return failed("The visit for this appointment is not open.");
  const res = step(id, "checked-in", now);
  if (res.ok) updateEncounter(v.visitNumber, (e) => { e.checkedIn = true; }, { touch: false });
  return res;
}

/** Check-out once the doctor has ended the visit. */
export function checkOut(id: string, now: number = Date.now()): Result<Appointment> {
  const a = findAppt(id);
  if (!a) return failed("This appointment was not found.");
  const chk = canMoveTo(a, "checkout", now);
  if (!chk.ok) return failed(chk.reason);
  return step(id, "checked-out", now);
}

/** Close the appointment after check-out. */
export const completeAppointment = (id: string, now: number = Date.now()) => step(id, "completed", now);

/* ---------- coverage and check-in ---------- */

export interface CoverageAnswer {
  card: InsuranceCard | null;
  outcome: CoverageOutcome;
  /** How the patient would pay if the payer answer is accepted. */
  payType: "Cash" | "Insurance";
  /** The visit cannot open as an insurance visit. The clerk must choose to go on as cash. */
  stops: boolean;
}

/**
 * The coverage answer for a patient, from the same eligibility check and plain-word answer the registration form uses.
 * "No insurance" stops only a patient whose file says Insurance. A cash patient goes on as cash.
 */
export function coverageFor(patientId: string, now: number = Date.now()): CoverageAnswer {
  const p = patientOf(patientId);
  const idNumber = p?.extra?.idNumber || p?.nationalId || "";
  const card = retrieveInsurance(idNumber) ?? p?.extra?.insurance ?? null;
  const outcome = coverageOutcome(card, todayOf(now));
  const fileSays = p?.extra?.visitPayType ?? (card ? "Insurance" : "Cash");
  const stops = outcome.blocking && (outcome.kind !== "no-insurance" || fileSays === "Insurance");
  return { card, outcome, payType: outcome.blocking ? "Cash" : card ? "Insurance" : "Cash", stops };
}

/** Why a visit cannot open for this patient now. Null when it can. */
export function visitBlock(patientId: string): string | null {
  const p = patientOf(patientId);
  if (!p) return "The patient file was not found.";
  const open = getState().encounters.find((e) => e.patientId === patientId && e.status === "active" && (e.cls === "I" || e.cls === "E"));
  if (open?.cls === "I") {
    return `${patientName(p)} is admitted now (visit ${open.visitNumber}${open.bedId ? `, ${bedLabel(open.bedId)}` : ""}). An outpatient visit cannot open during the stay. Ask the ward, or reschedule.`;
  }
  if (open?.cls === "E") {
    return `${patientName(p)} is in the emergency department now (visit ${open.visitNumber}). Finish the emergency visit first, or reschedule.`;
  }
  return null;
}

export type CheckInResult =
  | { ok: true; value: Appointment; visitNumber: string }
  | { ok: false; errors: string[]; needsCashChoice?: CoverageAnswer };

/**
 * The desk check-in. Opens the outpatient visit with A04, the app's normal way, so the national message and the
 * OPD worklist follow. In person: the appointment becomes Arrived, then Waiting and Checked In when called in.
 * Online: Checked In at once. A patient who is not covered goes on only with `cash: true`.
 * When the visit cannot open, the appointment stays where it was and keeps the reason.
 */
export function checkInAppointment(id: string, opts: { cash?: boolean } = {}, now: number = Date.now()): CheckInResult {
  const a = findAppt(id);
  if (!a) return { ok: false, errors: ["This appointment was not found."] };
  if (a.visitNumber) return { ok: false, errors: [`Visit ${a.visitNumber} is already linked to this appointment.`] };
  const chk = canMoveTo(a, "checkin", now);
  if (!chk.ok) return { ok: false, errors: [chk.reason] };
  const to = targetStatus(a, "checkin")!;
  const keep = (why: string): CheckInResult => {
    save({ ...a, problem: why });
    return { ok: false, errors: [why] };
  };

  const block = visitBlock(a.patientId);
  if (block) return keep(block);

  const cover = coverageFor(a.patientId, now);
  if (cover.stops && !opts.cash) return { ok: false, errors: [`${cover.outcome.title}. ${cover.outcome.text}`], needsCashChoice: cover };
  const patient = patientName(patientOf(a.patientId));
  if (cover.stops) {
    audit("update", "Coverage decision at check-in", { patient, detail: `${cover.outcome.title}. Clerk chose Continue As Cash Patient. Appointment ${a.id}.` });
  } else {
    audit("view", "Insurance eligibility check", { patient, detail: cover.card ? `${cover.card.payer}: ${cover.outcome.title}` : cover.outcome.title });
  }

  const out = quickCreate("A04", { patientId: a.patientId, attending: a.doctorId, service: "OPD", reason: a.reason, cls: "O" });
  const visitNumber = out.entry?.visitNumber;
  if (!out.ok || !visitNumber) return keep("The visit could not be opened, so the appointment was not checked in. See the message for the reason.");

  if (to === "checked-in") updateEncounter(visitNumber, (e) => { e.checkedIn = true; }, { touch: false });
  const payType = cover.payType;
  const coverageNote = cover.stops ? `${cover.outcome.title}. Continued as a cash patient.` : cover.outcome.title;
  const next: Appointment = { ...withStatus(a, to, now, `Visit ${visitNumber} opened. ${coverageNote}`), visitNumber, payType, coverageNote };
  save(next);
  logChange(next, `Checked in. ${STATUS_LABEL[a.status]} to ${STATUS_LABEL[to]}. Visit ${visitNumber} opened, ${payType}.`);
  return { ok: true, value: next, visitNumber };
}

/* ---------- cancel, no show, reschedule ---------- */

/** A visit opened at the desk is cancelled with the appointment, so a cancelled or no-show appointment keeps no visit. */
function dropVisit(a: Appointment, why: string): { visit?: string; error?: string } {
  const v = visitOf(a.visitNumber);
  if (!v) return {};
  if (v.status === "cancelled") return { visit: v.visitNumber };
  if (v.status !== "active") return { error: `Visit ${v.visitNumber} has already ended. It cannot be cancelled with the appointment.` };
  const out = quickSend("A11", v.visitNumber);
  if (!out.ok) return { error: `Visit ${v.visitNumber} could not be cancelled, so the appointment stays as it is.` };
  updateEncounter(v.visitNumber, (e) => { e.cancelReason = why; }, { touch: false });
  return { visit: v.visitNumber };
}

function reasonOk(reason: string): string | null {
  return reason.trim().length < 3 ? "Choose or write the reason." : null;
}

/** Cancel or mark as no show. A visit opened at check-in is cancelled too. */
export function closeAppointment(id: string, to: "cancelled" | "no-show", reason: string, now: number = Date.now()): Result<Appointment> {
  const a = findAppt(id);
  if (!a) return failed("This appointment was not found.");
  if (!nextStatuses(a).includes(to)) return failed(NOT_ALLOWED);
  const bad = reasonOk(reason);
  if (bad) return failed(bad);
  const dropped = dropVisit(a, `Appointment ${STATUS_LABEL[to].toLowerCase()}: ${reason.trim()}`);
  if (dropped.error) {
    save({ ...a, problem: dropped.error });
    return failed(dropped.error);
  }
  const next: Appointment = {
    ...withStatus(a, to, now, reason.trim()), closeReason: reason.trim(), visitNumber: undefined,
    cancelledVisit: dropped.visit ?? a.cancelledVisit,
  };
  save(next);
  logChange(next, `${STATUS_LABEL[to]}. Reason: ${reason.trim()}${dropped.visit ? `. Visit ${dropped.visit} cancelled (A11).` : ""}`);
  return { ok: true, value: next };
}

/** Move the appointment to a new day or time. The old one is kept as Rescheduled and a new Booked one is made. */
export function rescheduleAppointment(
  id: string, slot: { doctorId?: string; date: string; start: string }, reason: string, now: number = Date.now(),
): Result<{ old: Appointment; fresh: Appointment }> {
  const a = findAppt(id);
  if (!a) return failed("This appointment was not found.");
  if (!nextStatuses(a).includes("rescheduled")) return failed(NOT_ALLOWED);
  const bad = reasonOk(reason);
  const doctorId = slot.doctorId || a.doctorId;
  const input: BookingInput = { patientId: a.patientId, speciality: specialityOf(doctorId), doctorId, date: slot.date, start: slot.start, visitType: a.visitType, reason: a.reason };
  const errors = [...(bad ? [bad] : []), ...bookingProblems(input, now, a.id)];
  if (slot.date === a.date && slot.start === a.start && doctorId === a.doctorId) errors.push("Pick a different time from the current one.");
  if (errors.length) return failed(...errors);
  const s = get();
  const seq = s.seq + 1;
  const fresh = make(input, `AP-${1000 + seq}`, now, { rescheduledFrom: a.id });
  const old: Appointment = { ...withStatus(a, "rescheduled", now, `${reason.trim()}. New appointment ${fresh.id}.`), closeReason: reason.trim(), rescheduledTo: fresh.id };
  commit({ ...s, seq, appointments: [...s.appointments.map((x) => (x.id === a.id ? old : x)), fresh] });
  logChange(old, `Rescheduled to ${dayLabel(fresh.date)} ${fresh.start}, ${doctorName(fresh.doctorId)} (${fresh.id}). Reason: ${reason.trim()}`);
  return { ok: true, value: { old, fresh } };
}

/* ---------- views ---------- */

export interface ApptFilter {
  from: string;
  to: string;
  doctorId?: string;
  speciality?: string;
  q?: string;
}

/** Appointments in the date range and filters, in slot order. */
export function filterAppointments(list: Appointment[], f: ApptFilter): Appointment[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const patients = getState().patients;
  return list
    .filter((a) => a.date >= f.from && a.date <= f.to)
    .filter((a) => !f.doctorId || a.doctorId === f.doctorId)
    .filter((a) => !f.speciality || a.speciality === f.speciality)
    .filter((a) => {
      if (!q) return true;
      const p = patients.find((x) => x.id === a.patientId);
      return `${patientName(p)} ${p?.mrn ?? ""} ${a.id} ${a.visitNumber ?? ""}`.toLowerCase().includes(q);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** The visit linked to an appointment, when it has one. */
export const linkedVisit = (a: Appointment): Encounter | undefined => visitOf(a.visitNumber);

/* ---------- seed ---------- */

/** About twelve appointments for today and the next two days, with existing patients and doctors. */
export function seedAppointments(now: number = Date.now()): State {
  const today = todayOf(now);
  const his = getState();
  const openOpd = (pid: string) => his.encounters.find((e) => e.patientId === pid && e.cls === "O" && e.status === "active");
  const at = new Date(now).toISOString();
  const by = "Omar Alshehri";
  type Row = [string, string, number, string, VisitType, string, ApptStatus, string?];
  const rows: Row[] = [
    // patient, doctor, day offset, time, type, reason, status, close reason
    ["P012", "D1005", 0, "08:00", "in-person", "Knee pain on climbing stairs", "no-show", "Did not arrive"],
    ["P011", "D1002", 0, "08:20", "in-person", "Review of a skin lump", "cancelled", "Patient request"],
    ["P004", "D1004", 0, "08:40", "in-person", "Chest X-ray review", "checked-in"],
    ["P007", "D1001", 0, "09:00", "in-person", "Fever", "checked-in"],
    ["P010", "D1001", 0, "10:00", "in-person", "Blood pressure follow-up", "confirmed"],
    ["P006", "D1005", 0, "10:20", "in-person", "Follow-up after hip replacement", "booked"],
    ["P009", "D1001", 0, "11:00", "online", "Results of blood tests", "confirmed"],
    ["P001", "D1003", 0, "13:20", "in-person", "Breathing test follow-up", "confirmed"],
    ["P005", "D1002", 0, "14:00", "in-person", "Assessment before planned surgery", "booked"],
    ["P002", "D1001", 1, "09:00", "in-person", "Diabetes review", "booked"],
    ["P003", "D1003", 1, "10:00", "in-person", "Follow-up after chest pain", "confirmed"],
    ["P008", "D1001", 1, "11:20", "online", "Medicine review", "booked"],
    ["P013", "D1005", 2, "09:40", "in-person", "Wrist pain after a fall", "booked"],
    ["P014", "D1003", 2, "13:00", "in-person", "Follow-up after emergency visit", "confirmed"],
  ];
  const appointments: Appointment[] = [];
  rows.forEach(([pid, doc, off, start, type, reason, status, closeReason], i) => {
    if (!his.patients.some((p) => p.id === pid)) return;
    const date = addDays(today, off);
    const history: StatusStep[] = [{ status: "booked", at, by }];
    const a: Appointment = {
      id: `AP-${1001 + i}`, patientId: pid, doctorId: doc, speciality: specialityOf(doc), date, start, end: fromMin(toMin(start) + SLOT_MIN),
      visitType: type, reason, status: "booked", statusAt: at, bookedBy: by, bookedAt: at, history,
    };
    let s = status;
    if (s === "checked-in") {
      // Linked to the outpatient visit the patient already has today. Without one it stays confirmed.
      const v = openOpd(pid);
      if (v) {
        a.visitNumber = v.visitNumber;
        a.payType = "Cash";
        a.coverageNote = "No Insurance Found";
      } else s = "confirmed";
    }
    if (s !== "booked") history.push({ status: s, at, by, note: closeReason });
    a.status = s;
    if (closeReason) a.closeReason = closeReason;
    appointments.push(a);
  });
  return { appointments, seq: rows.length };
}
