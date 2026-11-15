import { bedInfos, bedProblem, type BedAsker, type BedInfo } from "./beds";
import { phoneOk } from "./discharge";
import type { AdmissionDetails, HisState } from "./model";

/**
 * Rules for the visit dialogs that are not the discharge: transfer, change to inpatient, admit and pre-admit details,
 * and moving a visit to the right patient (A45). Pure functions. The actions are in actions.ts.
 */

/* ---------- beds by floor and room ---------- */

/** The floor each ward is on. The HIS keeps floors in its bed setup; these are the wards this app has. */
export const FLOOR_OF: Record<string, string> = { "3A": "Floor 3", "4B": "Floor 4", ICU: "Floor 2" };
export const floorOf = (ward: string): string => FLOOR_OF[ward] ?? "Other Floor";

export interface FloorGroup {
  floor: string;
  rooms: { room: string; wardName: string; beds: BedInfo[] }[];
}

/**
 * Beds this patient can take (free, or reserved for the patient), grouped by floor and then room.
 * The ward that usually takes the department comes first.
 */
export function freeBedsByFloor(state: HisState, who: BedAsker, firstWard?: string): FloorGroup[] {
  const open = bedInfos(state).filter((i) => (i.state === "free" || i.state === "reserved") && !bedProblem(state, i.bed.id, who, i));
  const sorted = [...open].sort((a, b) => Number(b.bed.ward === firstWard) - Number(a.bed.ward === firstWard));
  const out: FloorGroup[] = [];
  for (const i of sorted) {
    const floor = floorOf(i.bed.ward);
    let g = out.find((x) => x.floor === floor);
    if (!g) out.push((g = { floor, rooms: [] }));
    let r = g.rooms.find((x) => x.room === i.bed.room);
    if (!r) g.rooms.push((r = { room: i.bed.room, wardName: i.bed.wardName, beds: [] }));
    r.beds.push(i);
  }
  return out;
}

/* ---------- transfer ---------- */

export const WARD_TRANSFER_REASONS = [
  "Needs a higher level of care", "Needs a lower level of care", "Moved to the specialty ward", "Isolation needed",
  "Patient or family request", "Bed management", "Other",
];

/* ---------- change to inpatient (A06) ---------- */

export interface ConversionInput {
  bedId: string;
  service: string;
  subDepartment: string;
  /** CS-Adm-AdmissionMethod code for PV1-4. */
  admissionType: string;
  condition: string;
  /** Local date-time of the admission. */
  at: string;
  reason: string;
  activityLevel: string;
}

export const CONVERSION_REASON_MIN = 5;

/** What is still missing for the change to inpatient, apart from the bed rules. Times are local date-time strings. */
export function conversionProblems(c: ConversionInput, ctx: { visitStart?: string; now: string }): string[] {
  const out: string[] = [];
  if (!c.service) out.push("Choose the department.");
  if (!c.admissionType) out.push("Choose the admission type.");
  if (!c.condition) out.push("Choose the patient condition.");
  if (!c.at) out.push("Enter the admission date and time.");
  else if (c.at > ctx.now) out.push("The admission time cannot be in the future.");
  else if (ctx.visitStart && c.at < ctx.visitStart) out.push("The admission time cannot be before the visit started.");
  if (c.reason.trim().length < CONVERSION_REASON_MIN) out.push(`Write the reason for the admission (at least ${CONVERSION_REASON_MIN} characters).`);
  if (!c.bedId) out.push("Pick a bed.");
  return out;
}

/* ---------- admit and pre-admit details ---------- */

export interface AdmissionExtras {
  consulting: string;
  /** Text from the form. Empty when not given. */
  expectedDays: string;
  activityLevel: string;
  condition: string;
  attendantName: string;
  attendantPhone: string;
  attendantRelation: string;
  notes: string;
}

export const emptyExtras = (): AdmissionExtras => ({
  consulting: "", expectedDays: "", activityLevel: "", condition: "", attendantName: "", attendantPhone: "", attendantRelation: "", notes: "",
});

/** The details as they are kept on the visit. The consulting doctor goes on the visit itself (PV1-9), not here. */
export function extrasToAdmission(x: AdmissionExtras): AdmissionDetails {
  const n = Number(x.expectedDays);
  const out: AdmissionDetails = {};
  if (x.condition) out.patientCondition = x.condition;
  if (x.activityLevel) out.activityLevel = x.activityLevel;
  if (x.expectedDays.trim() && Number.isInteger(n) && n > 0) out.expectedStayDays = n;
  if (x.attendantName.trim()) out.attendantName = x.attendantName.trim();
  if (x.attendantPhone.trim()) out.attendantPhone = x.attendantPhone.trim();
  if (x.attendantRelation) out.attendantRelation = x.attendantRelation;
  if (x.notes.trim()) out.notes = x.notes.trim();
  return out;
}

/** The form filled from a visit that already has details, for example a pre-admission being admitted. */
export function extrasFrom(e: { consulting?: string; admission?: AdmissionDetails } | undefined): AdmissionExtras {
  const a = e?.admission ?? {};
  return {
    consulting: e?.consulting ?? "", expectedDays: a.expectedStayDays ? String(a.expectedStayDays) : "", activityLevel: a.activityLevel ?? "",
    condition: a.patientCondition ?? "", attendantName: a.attendantName ?? "", attendantPhone: a.attendantPhone ?? "",
    attendantRelation: a.attendantRelation ?? "", notes: a.notes ?? "",
  };
}

export function extrasProblems(x: AdmissionExtras): string[] {
  const out: string[] = [];
  if (x.expectedDays.trim()) {
    const n = Number(x.expectedDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) out.push("Expected days is a whole number, 1 to 365.");
  }
  if (x.attendantPhone.trim() && !phoneOk(x.attendantPhone)) out.push("Enter the contact number with digits only, for example 0551234567.");
  return out;
}

/* ---------- move visit (A45) ---------- */

export const MOVE_REASONS = [
  "Registered on the wrong patient", "Wrong file picked from similar names", "Wrong ID card scanned", "Newborn registered on the mother", "Other",
];

/**
 * Why this visit cannot move to that patient. null when it can.
 * Assumption (the NPHIES pages do not cover it): an open inpatient stay or pre-admission cannot move to a patient
 * who already has one, because one person cannot be admitted twice.
 */
export function moveVisitProblem(state: HisState, visit: string, toPatientId: string): string | null {
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  if (!enc) return "That visit was not found.";
  if (enc.status === "cancelled") return "A cancelled visit cannot be moved.";
  if (!toPatientId) return "Choose the correct patient.";
  if (toPatientId === enc.patientId) return "The correct patient must be a different person.";
  const to = state.patients.find((p) => p.id === toPatientId);
  if (!to) return "That patient was not found.";
  if (to.mergedInto) return "That file was merged into another one. Choose the file that was kept.";
  const admitted = (e: { status: string; cls: string }) => e.status === "preadmit" || (e.status === "active" && e.cls === "I");
  if (admitted(enc)) {
    const other = state.encounters.find((e) => e.patientId === toPatientId && admitted(e));
    if (other) return `The correct patient already has an open admission (visit ${other.visitNumber}).`;
  }
  return null;
}
