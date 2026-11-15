import { SUB_DEPARTMENTS, type AdmissionRequest } from "./admission-requests";
import { STATUS_LABEL, isLive, type Appointment } from "./appointments";
import { coverageView } from "./chart-entries";
import { coverageLabel, latestEligibility, primaryCoverage, type Coverage } from "./coverage";
import type { Encounter, HisState, Patient } from "./model";
import type { FinCase } from "./nphies-financial";
import { SERVICES } from "./reference-data";

/**
 * Helpers the worklists share: the eligibility cell, the sub-department of a visit, the appointment a clinic visit
 * came from, and the visits reclassified from inpatient to outpatient (A07). Pure functions: callers pass the stores.
 */

/* ---------- eligibility ---------- */

export interface EligibilityCell {
  label: "Eligible" | "Not Eligible" | "Cash";
  tone: "ok" | "danger" | "neutral";
  /** Payer and plan, or "Cash". */
  payer: string;
  /** Where the answer came from, in words. */
  basis: string;
}

/**
 * The eligibility shown on a worklist row. Same order as the chart header: an NPHIES eligibility answer for the visit
 * wins, then the newest answer on the patient's coverages, then the coverage check made at registration.
 */
export function eligibilityCell(patient: Patient | undefined, finCase: Pick<FinCase, "eligibility"> | undefined, coverages: Coverage[], today: string): EligibilityCell {
  if (!patient) return { label: "Cash", tone: "neutral", payer: "Cash", basis: "No patient file" };
  const cell = (eligible: boolean | undefined, payer: string, basis: string): EligibilityCell =>
    eligible === undefined ? { label: "Cash", tone: "neutral", payer: "Cash", basis: "Cash patient" } : { label: eligible ? "Eligible" : "Not Eligible", tone: eligible ? "ok" : "danger", payer, basis };
  if (finCase?.eligibility) {
    const v = coverageView(patient, today, finCase.eligibility);
    return cell(v.eligible, [v.payer, v.plan].filter(Boolean).join(", "), v.basis ?? "");
  }
  const answer = latestEligibility(coverages);
  if (answer && patient.extra?.visitPayType !== "Cash") {
    return cell(answer.eligible, coverageLabel(primaryCoverage(coverages, today)) || "Insurance", `Eligibility check: ${answer.title}`);
  }
  const v = coverageView(patient, today);
  return cell(v.eligible, [v.payer, v.plan].filter(Boolean).join(", "), v.basis ?? "");
}

/* ---------- appointments ---------- */

/** The appointment a clinic visit was opened from, if any. */
export function appointmentOf(visit: string, list: Appointment[]): Appointment | undefined {
  return list.find((a) => a.visitNumber === visit);
}

export function appointmentTone(a: Appointment): "ok" | "move" | "update" | "neutral" | "warn" {
  if (a.status === "completed" || a.status === "checked-out") return "ok";
  if (a.status === "checked-in" || a.status === "waiting" || a.status === "arrived") return "move";
  if (a.status === "booked" || a.status === "confirmed") return "update";
  if (a.status === "no-show") return "warn";
  return "neutral";
}

export const appointmentLabel = (a: Appointment): string => STATUS_LABEL[a.status];

/** Statuses that still wait for the patient: a follow-up is already booked. */
export const isOpenAppointment = (a: Appointment): boolean => isLive(a.status) && a.status !== "completed" && a.status !== "checked-out";

/* ---------- sub-department ---------- */

/**
 * The sub-department of a visit: set on the visit, else from the admission request that opened it, else the clinic
 * of its appointment, else the specialty taken at registration, else the first unit of its service.
 */
export function subDepartmentOf(e: Encounter, requests: AdmissionRequest[], appointments: Appointment[]): string {
  if (e.subDepartment) return e.subDepartment;
  const req = requests.find((r) => r.approval?.visitNumber === e.visitNumber && r.subDepartment);
  if (req) return req.subDepartment;
  const appt = appointmentOf(e.visitNumber, appointments);
  if (appt?.speciality) return appt.speciality;
  if (e.admission?.specialty) return e.admission.specialty;
  if (e.cls === "E") return "Emergency Department";
  const label = SERVICES.find((s) => s.code === e.service)?.label ?? e.service;
  return e.cls === "I" ? SUB_DEPARTMENTS[e.service]?.[0] ?? label : `${label} Clinic`;
}

/* ---------- reclassified to outpatient (A07) ---------- */

export interface Reclassified {
  enc: Encounter;
  /** When the A07 was sent. ISO time. */
  at: string;
  /** The bed the patient left. */
  fromBed?: string;
}

/** Visits changed from inpatient to outpatient with A07 and not changed back since. Newest first. */
export function reclassifiedVisits(state: Pick<HisState, "encounters" | "log">): Reclassified[] {
  const out: Reclassified[] = [];
  for (const e of state.encounters) {
    if (e.cls !== "O" || e.status === "cancelled") continue;
    let last: HisState["log"][number] | undefined;
    for (const l of state.log) if (l.visitNumber === e.visitNumber && ["A01", "A04", "A06", "A07"].includes(l.eventId)) last = l;
    if (last?.eventId === "A07") out.push({ enc: e, at: last.sentAt, fromBed: e.lastBedId });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** The newest appointment booked for the patient since the reclassification. */
export function followUpAfter(patientId: string, sinceIso: string, list: Appointment[]): Appointment | undefined {
  return list
    .filter((a) => a.patientId === patientId && a.bookedAt >= sinceIso)
    .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt))[0];
}
