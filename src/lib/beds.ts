import { allBeds, isActive } from "./bed-setup";
import type { Bed, Encounter, HisState } from "./model";
import { BED_BY_ID } from "./reference-data";

/**
 * Bed states. A bed is in exactly one state, worked out from the visits and the bed flags:
 * - occupied: an active visit is in the bed.
 * - discharging: the patient is discharged but has not left the ward yet.
 * - out: taken out of service, with a reason.
 * - cleaning: the patient left, housekeeping has not marked the bed ready.
 * - reserved: held for a pre-admission.
 * - free: none of the above. Only a free bed (or the bed reserved for that patient) can take an admission or transfer.
 * A bed made inactive in Bed Setup shows as out of service ("Inactive") once it is empty.
 * A bed with a gender restriction takes only patients of that sex.
 * Pure functions over the HIS state and the bed setup. They never write anything.
 */

export type BedState = "free" | "occupied" | "reserved" | "discharging" | "cleaning" | "out";

export const BED_STATES: { id: BedState; label: string; hint: string }[] = [
  { id: "free", label: "Free", hint: "Ready for a patient." },
  { id: "occupied", label: "Occupied", hint: "A patient is in the bed." },
  { id: "reserved", label: "Reserved", hint: "Held for a planned admission." },
  { id: "discharging", label: "Being Discharged", hint: "Discharged, the patient has not left the ward yet." },
  { id: "cleaning", label: "Cleaning", hint: "The patient left. The bed is not ready yet." },
  { id: "out", label: "Out Of Service", hint: "Cannot be used. A reason is recorded." },
];

export const bedStateLabel = (s: BedState): string => BED_STATES.find((x) => x.id === s)!.label;

export const OUT_OF_SERVICE_REASONS = ["Maintenance", "Broken equipment", "Infection control", "Deep cleaning", "Staff shortage", "Other"];

export interface BedInfo {
  bed: Bed;
  state: BedState;
  /** The visit that occupies, is leaving, or has reserved the bed. */
  enc?: Encounter;
  /** When the state started, when the HIS knows it. Local date-time. */
  since?: string;
  /** Out of service reason. */
  reason?: string;
  /** Out of service because the bed is inactive in Bed Setup. It comes back from Bed Setup, not with Return To Service. */
  inactive?: boolean;
}

export const INACTIVE_REASON = "Inactive";

/** The bed a discharged visit still holds: set at discharge, cleared when the patient leaves the ward. */
export function heldBedOf(e: Encounter): string | undefined {
  return e.status === "discharged" && e.discharge?.bedId && !e.discharge.leftWardAt ? e.discharge.bedId : undefined;
}

export function bedInfos(state: HisState): BedInfo[] {
  const occupied: Record<string, Encounter> = {};
  const leaving: Record<string, Encounter> = {};
  const reserved: Record<string, Encounter> = {};
  for (const e of state.encounters) {
    if (e.status === "active" && e.bedId) occupied[e.bedId] = e;
    const held = heldBedOf(e);
    if (held) leaving[held] = e;
    if (e.status === "preadmit" && e.reservedBedId) reserved[e.reservedBedId] = e;
  }
  return allBeds().map((bed): BedInfo => {
    const flag = state.bedFlags?.[bed.id];
    if (occupied[bed.id]) return { bed, state: "occupied", enc: occupied[bed.id], since: occupied[bed.id].admitAt };
    if (leaving[bed.id]) return { bed, state: "discharging", enc: leaving[bed.id], since: leaving[bed.id].discharge?.orderedAt };
    if (!isActive(bed)) return { bed, state: "out", reason: INACTIVE_REASON, inactive: true };
    if (flag?.state === "out") return { bed, state: "out", since: flag.since, reason: flag.reason };
    if (flag?.state === "cleaning") return { bed, state: "cleaning", since: flag.since };
    if (reserved[bed.id]) return { bed, state: "reserved", enc: reserved[bed.id], since: reserved[bed.id].expectedAdmitAt };
    return { bed, state: "free" };
  });
}

export function bedInfo(state: HisState, bedId: string): BedInfo | undefined {
  return BED_BY_ID[bedId] ? bedInfos(state).find((b) => b.bed.id === bedId) : undefined;
}

/** Who is asking for the bed. A reserved bed is open to the patient it is held for, and a held bed to its own visit. */
export interface BedAsker { visit?: string; patientId?: string; sex?: "M" | "F" }

/** The sex of the patient asking, from `who.sex`, the patient id or the visit. */
export function askerSex(state: HisState, who: BedAsker): "M" | "F" | undefined {
  if (who.sex) return who.sex;
  const pid = who.patientId || (who.visit ? state.encounters.find((e) => e.visitNumber === who.visit)?.patientId : undefined);
  return pid ? state.patients.find((p) => p.id === pid)?.sex : undefined;
}

/** Whether a patient of this sex may use the bed. Unknown sex fits any bed. */
export function genderFits(bed: Pick<Bed, "gender">, sex: "M" | "F" | undefined): boolean {
  if (!sex || !bed.gender || bed.gender === "Any") return true;
  return bed.gender === (sex === "M" ? "Male" : "Female");
}

const genderText = (bed: Pick<Bed, "gender">): string => (bed.gender === "Male" ? "male" : "female");

/** Why a bed cannot take this patient, in words for the screen. null when it can. */
export function bedProblem(state: HisState, bedId: string, who: BedAsker = {}, info: BedInfo | undefined = bedInfo(state, bedId)): string | null {
  if (!info) return "That bed does not exist.";
  const mine = !!info.enc && ((!!who.visit && info.enc.visitNumber === who.visit) || (info.state === "reserved" && !!who.patientId && info.enc.patientId === who.patientId));
  const gender = genderFits(info.bed, askerSex(state, who)) ? null : `That bed is for ${genderText(info.bed)} patients only.`;
  switch (info.state) {
    case "free": return gender;
    case "occupied": return mine ? null : "That bed is taken.";
    case "discharging": return mine ? null : "That bed is not free yet. The discharged patient has not left the ward.";
    case "reserved": return mine ? gender : "That bed is reserved for a planned admission.";
    case "cleaning": return "That bed is being cleaned. Mark it ready first.";
    case "out": return info.inactive ? "That bed is inactive. Make it active in Bed Setup first." : `That bed is out of service${info.reason ? ` (${info.reason})` : ""}.`;
  }
}

/** Short reason shown next to a bed that cannot be picked. Called only for beds that `bedProblem` refuses. */
export function unavailableLabel(info: BedInfo, who: BedAsker = {}): string {
  if (who.visit && info.enc?.visitNumber === who.visit && info.state === "occupied") return "Current bed";
  const genderOnly = info.bed.gender && info.bed.gender !== "Any" ? `${info.bed.gender} patients only` : "";
  switch (info.state) {
    case "free": return genderOnly;
    case "occupied": return "Occupied";
    case "discharging": return "Patient has not left yet";
    case "reserved": return who.patientId && info.enc?.patientId === who.patientId && genderOnly ? genderOnly : "Reserved for another patient";
    case "cleaning": return "Being cleaned";
    case "out": return info.inactive ? "Inactive" : `Out of service${info.reason ? `: ${info.reason}` : ""}`;
    default: return "";
  }
}

/** Beds this patient can go to: free, active beds that fit the patient's sex, plus the bed reserved for the patient. */
export function availableBeds(state: HisState, who: BedAsker = {}): Bed[] {
  return bedInfos(state).filter((i) => (i.state === "free" || i.state === "reserved") && bedProblem(state, i.bed.id, who, i) === null).map((i) => i.bed);
}

/** The bed held for this patient's pre-admission, if any. */
export function reservedBedFor(state: HisState, patientId: string): string | undefined {
  return state.encounters.find((e) => e.status === "preadmit" && e.patientId === patientId && e.reservedBedId)?.reservedBedId;
}

export function bedCounts(state: HisState, ward?: string): Record<BedState, number> & { total: number } {
  const out = { free: 0, occupied: 0, reserved: 0, discharging: 0, cleaning: 0, out: 0, total: 0 };
  for (const i of bedInfos(state)) {
    if (ward && i.bed.ward !== ward) continue;
    out[i.state] += 1;
    out.total += 1;
  }
  return out;
}
