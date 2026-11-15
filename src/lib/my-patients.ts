import type { LabOrder, RadOrder } from "@/lib/fhir/types";
import type { Encounter } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";

/**
 * My Patients: the doctor's landing list. The signed-in doctor's current patients, grouped as inpatients, today's
 * clinic and emergency, with what is new on each one. Pure helpers, so the rules can be tested without a screen.
 */

export type PatientGroup = "inpatient" | "clinic" | "emergency";
export const GROUP_LABEL: Record<PatientGroup, string> = { inpatient: "Inpatient", clinic: "Today's Clinic", emergency: "Emergency" };

/** How long a result counts as new. */
export const NEW_RESULT_HOURS = 24;

/** The doctor record of a signed-in user, matched by name ("Dr. Khalid Alharbi"). None for staff who are not doctors. */
export function doctorIdOf(userName: string): string | undefined {
  const name = userName.replace(/^Dr\.?\s+/i, "").trim().toLowerCase();
  return DOCTORS.find((d) => `${d.given} ${d.family}`.toLowerCase() === name)?.id;
}

const dayOf = (iso?: string) => (iso ?? "").slice(0, 10);

/** Which group a visit belongs to today, or null when it is not a current patient. */
export function groupOf(e: Encounter, today: string): PatientGroup | null {
  if (e.status !== "active") return null;
  if (e.cls === "I") return "inpatient";
  if (e.cls === "E") return "emergency";
  return dayOf(e.admitAt ?? e.expectedAdmitAt) === today ? "clinic" : null;
}

export interface ResultSummary {
  /** Laboratory results and radiology reports from the last 24 hours. */
  fresh: number;
  /** Critical laboratory values (very high or very low) and critical imaging findings on the visit. */
  critical: number;
  /** Abnormal laboratory values among the new results. */
  abnormal: number;
  /** Orders still waiting for a result. */
  pending: number;
  /** Time of the newest result. */
  latest?: string;
}

/** What the laboratory and radiology have returned for one visit. */
export function resultsOf(visit: string, labs: LabOrder[], rads: RadOrder[], now: number = Date.now()): ResultSummary {
  const since = now - NEW_RESULT_HOURS * 3_600_000;
  const out: ResultSummary = { fresh: 0, critical: 0, abnormal: 0, pending: 0 };
  const see = (at?: string) => {
    if (!at) return false;
    if (!out.latest || at > out.latest) out.latest = at;
    return new Date(at).getTime() >= since;
  };
  for (const o of labs) {
    if (o.visitNumber !== visit || o.status === "cancelled") continue;
    if (o.status !== "resulted" && o.status !== "amended") { out.pending += 1; continue; }
    for (const r of Object.values(o.results)) {
      if (r.status === "cancelled" || r.status === "entered-in-error") continue;
      const isNew = see(r.at);
      if (isNew) out.fresh += 1;
      if (r.interp === "HH" || r.interp === "LL") out.critical += 1;
      else if (isNew && r.interp !== "N" && r.interp !== "NEG") out.abnormal += 1;
    }
  }
  for (const o of rads) {
    if (o.visitNumber !== visit || o.status === "cancelled") continue;
    if (!o.report || (o.status !== "resulted" && o.status !== "amended")) { out.pending += 1; continue; }
    if (see(o.report.reportedAt)) out.fresh += 1;
    if (o.report.critical) out.critical += 1;
  }
  return out;
}
