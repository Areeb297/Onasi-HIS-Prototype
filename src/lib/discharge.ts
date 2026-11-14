import type { Clearance, ClearanceKey, DischargeOutcome, DischargeRecord, Encounter } from "./model";
import type { Permission } from "./session";

/**
 * Discharge rules: the four clearances, the outcomes and their PV1-36 codes, and the wait between the
 * discharge order and the patient leaving the ward. Pure functions. The actions are in actions.ts.
 */

/* ---------- clearances ---------- */

export interface ClearanceDef {
  key: ClearanceKey;
  label: string;
  /** Who gives it, in words. */
  who: string;
  /** What it confirms. */
  meaning: string;
}

export const CLEARANCES: ClearanceDef[] = [
  { key: "clinical", label: "Clinical", who: "Doctor", meaning: "The doctor agrees the patient is fit to leave." },
  { key: "pharmacy", label: "Pharmacy", who: "Pharmacist", meaning: "Discharge medicines are checked and ready." },
  { key: "nursing", label: "Nursing", who: "Nurse", meaning: "Nursing care is complete and the patient is taught." },
  { key: "finance", label: "Finance", who: "Billing officer", meaning: "The bill is settled or approved." },
];

export const clearanceLabel = (k: ClearanceKey): string => CLEARANCES.find((c) => c.key === k)!.label;

/**
 * Which role may give a clearance, from the permissions the roles already have:
 * Clinical needs docs.publish (doctors), Pharmacy needs rx.dispense, Finance needs billing,
 * Nursing needs emr.write without rx.write (nurses). An administrator can give all four.
 */
export function canGiveClearance(key: ClearanceKey, permissions: Permission[]): boolean {
  const has = (p: Permission) => permissions.includes(p);
  if (has("admin")) return true;
  switch (key) {
    case "clinical": return has("docs.publish");
    case "pharmacy": return has("rx.dispense");
    case "nursing": return has("emr.write") && !has("rx.write");
    case "finance": return has("billing");
  }
}

/** Clearances apply to inpatient stays only. */
export const needsClearances = (e: Pick<Encounter, "cls">): boolean => e.cls === "I";

export function clearanceList(e: Pick<Encounter, "clearances">): (ClearanceDef & { done?: Clearance })[] {
  return CLEARANCES.map((c) => ({ ...c, done: e.clearances?.[c.key] }));
}

export function missingClearances(e: Pick<Encounter, "cls" | "clearances">): ClearanceKey[] {
  if (!needsClearances(e)) return [];
  return CLEARANCES.filter((c) => !e.clearances?.[c.key]).map((c) => c.key);
}

/** An override reason must say something: at least this many characters. */
export const OVERRIDE_MIN = 10;
export const overrideOk = (reason: string): boolean => reason.trim().length >= OVERRIDE_MIN;

/** Why the discharge cannot go ahead because of clearances. null when it can. */
export function clearanceBlock(e: Pick<Encounter, "cls" | "clearances">, overrideReason = ""): string | null {
  const missing = missingClearances(e);
  if (missing.length === 0 || overrideOk(overrideReason)) return null;
  return `Discharge is blocked. Waiting for: ${missing.map(clearanceLabel).join(", ")}.`;
}

/* ---------- outcomes ---------- */

export interface OutcomeDef {
  id: DischargeOutcome;
  label: string;
  /** PV1-36, SNOMED CT code from CS-Adm-DischargeDisposition. All four are among the nine the discharge update accepts. */
  code: string;
  hint: string;
}

export const OUTCOMES: OutcomeDef[] = [
  { id: "home", label: "Home", code: "306689006", hint: "The patient goes home." },
  { id: "transfer", label: "Transfer To Another Hospital", code: "306699001", hint: "Another hospital takes over the care." },
  { id: "ama", label: "Left Against Medical Advice", code: "225928004", hint: "The patient chose to leave against the doctor's advice." },
  { id: "died", label: "Died", code: "79779006", hint: "The patient died during this stay." },
];

export const outcomeDef = (id: DischargeOutcome): OutcomeDef => OUTCOMES.find((o) => o.id === id)!;
export const outcomeCode = (id: DischargeOutcome): string => outcomeDef(id).code;
/** The outcome a saved PV1-36 code stands for, when it is one of the four. */
export const outcomeOfCode = (code: string | undefined): DischargeOutcome | undefined => OUTCOMES.find((o) => o.code === code)?.id;

export const TRANSPORT_MODES = ["Hospital ambulance", "Red Crescent ambulance", "Air ambulance", "Private vehicle"];
export const TRANSFER_REASONS = ["Needs a service this hospital does not have", "No bed available", "Patient or family request", "Insurance or coverage", "Other"];

export type TransferDetails = NonNullable<DischargeRecord["transfer"]>;
export type DeathDetails = NonNullable<DischargeRecord["death"]>;

export const emptyTransfer = (): TransferDetails => ({ hospital: "", reason: "", acceptingDoctor: "", transport: "", consent: false });
export const emptyDeath = (): DeathDetails => ({ at: "", cause: "", certifiedBy: "" });

export interface OutcomeInput {
  outcome: DischargeOutcome;
  transfer?: TransferDetails;
  death?: DeathDetails;
}

/** What is still missing for the chosen outcome. Empty when it is complete. Times are local date-time strings. */
export function outcomeProblems(input: OutcomeInput, ctx: { admitAt?: string; now: string }): string[] {
  const out: string[] = [];
  if (input.outcome === "transfer") {
    const t = input.transfer ?? emptyTransfer();
    if (!t.hospital.trim()) out.push("Enter the receiving hospital.");
    if (!t.reason.trim()) out.push("Choose the reason for the transfer.");
    if (!t.acceptingDoctor.trim()) out.push("Enter the accepting doctor.");
    if (!t.transport.trim()) out.push("Choose the transport.");
    if (!t.consent) out.push("Confirm the patient or family consent.");
  }
  if (input.outcome === "died") {
    const d = input.death ?? emptyDeath();
    if (!d.at) out.push("Enter the date and time of death.");
    else if (d.at > ctx.now) out.push("The time of death cannot be in the future.");
    else if (ctx.admitAt && d.at < ctx.admitAt) out.push("The time of death cannot be before the admission.");
    if (!d.cause.trim()) out.push("Enter the cause of death.");
    if (!d.certifiedBy.trim()) out.push("Choose the certifying doctor.");
  }
  return out;
}

/* ---------- leaving the ward ---------- */

const minutes = (a: string, b: string): number => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

export interface DepartureGap {
  /** Minutes from the discharge order to leaving the ward, or to now while the patient is still there. */
  minutes: number;
  /** false while the patient is still on the ward. */
  left: boolean;
}

/** The wait between the discharge order and the patient leaving. Undefined when no bed was held. */
export function departureGap(e: Pick<Encounter, "status" | "discharge">, now: string): DepartureGap | undefined {
  const d = e.discharge;
  if (e.status !== "discharged" || !d?.bedId) return undefined;
  return d.leftWardAt ? { minutes: minutes(d.orderedAt, d.leftWardAt), left: true } : { minutes: minutes(d.orderedAt, now), left: false };
}

/** Why the leaving time cannot be saved. null when it can. */
export function leftWardProblem(e: Pick<Encounter, "status" | "discharge">, at: string, now: string): string | null {
  if (e.status !== "discharged" || !e.discharge?.bedId) return "This patient is not waiting to leave a bed.";
  if (e.discharge.leftWardAt) return "The leaving time is already recorded.";
  if (!at) return "Enter the time the patient left.";
  if (at < e.discharge.orderedAt) return "The patient cannot leave before the discharge.";
  if (at > now) return "The leaving time cannot be in the future.";
  return null;
}

/** 45 becomes "45 min", 125 becomes "2 h 5 min". */
export function gapText(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The date format of the worklists: 14 November 2026 3:05 PM. */
export function niceDate(local: string | undefined): string {
  if (!local) return "None";
  const d = new Date(local);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/* ---------- reasons for destructive actions ---------- */

export const CANCEL_REASONS: Record<"A11" | "A38" | "A12" | "A07", string[]> = {
  A11: ["Registered by mistake", "Wrong patient", "Duplicate visit", "Patient did not arrive", "Patient declined", "Other"],
  A38: ["Surgery or treatment postponed", "Patient declined", "No bed available", "Booked by mistake", "Other"],
  A12: ["Moved by mistake", "Wrong bed chosen", "Bed was not ready", "Other"],
  A07: ["Does not need an inpatient bed", "Admitted by mistake", "Changed to day care", "Other"],
};

/** A reason from the list is needed. "Other" also needs a few words. */
export function reasonProblem(reason: string, note: string): string | null {
  if (!reason) return "Choose a reason.";
  if (reason === "Other" && note.trim().length < 3) return "Say what the reason is.";
  return null;
}

export const reasonText = (reason: string, note: string): string => (note.trim() ? `${reason}: ${note.trim()}` : reason);
