/**
 * Types for the medication workstream (e-prescribe and e-dispense).
 * All drugs, codes and people are made up. Codes marked "test" are not real NPHIES or Saudi code-set values.
 */

/** U uncontrolled, N narcotic, C controlled, R restricted. The class letters follow the conformance sheet. */
export type ControlClass = "U" | "N" | "C" | "R";

/** FHIR MedicationRequest status values allowed by the Raqeeb page. */
export type ItemStatus = "active" | "on-hold" | "stopped" | "cancelled" | "completed";

/** Usage setting (second MedicationRequest category). Raqeeb scope is outpatient, discharge or community. */
export type UsageSetting = "outpatient" | "inpatient" | "discharge" | "community";

/** v3 ActCode dispense types. FF first fill, FFP first fill part, FFC first fill complete, then the refill ones. */
export type FillType = "FF" | "FFP" | "FFC" | "RF" | "RFP" | "RFC";

export interface Drug {
  id: string;
  /** Demo code (DEMO-DRG-nnn). Not a real "KSA Prescription Pharmacy Item Name" (MRID) value. */
  code: string;
  generic: string;
  /** Fictional brand name used as the dispensed product. */
  brand: string;
  strengthValue: number;
  strengthUnit: string;
  /** Strength amount in one dispensing unit. Equals the strength for tablets. Used for dose maths. */
  perUnit: number;
  form: string;
  formCode: string;
  /** Unit used for quantities, for example tablet, mL, pen. */
  unit: string;
  routes: string[];
  controlClass: ControlClass;
  /** Therapeutic class for the duplicate therapy check. */
  therapeuticClass: string;
  /** Allergy words that mean a direct conflict. */
  allergyKeys: string[];
  /** Allergy words that mean possible cross-reactivity. */
  crossKeys: string[];
  /** Usual single dose in dispensing units. */
  defaultDose: number;
  defaultFrequency: string;
  defaultDays: number;
  defaultRoute: string;
  /** Maximum total daily dose in the strength unit. Used for the dose sanity check. */
  maxDailyDose: number;
  pack: { type: string; size: number };
  /** Made-up barcode for the scan simulation. */
  barcode: string;
}

export interface Frequency {
  id: string;
  label: string;
  perDay: number;
  /** FHIR Timing.repeat values */
  frequency: number;
  period: number;
  periodUnit: "d" | "h" | "wk";
  when?: string;
}

export interface Reason {
  code: string;
  text: string;
}

export interface RxItem {
  id: string;
  /** Business identifier of the Prescription Item (MedicationRequest.identifier). */
  identifier: string;
  drugId: string;
  /** Units per dose (tablets, mL...). */
  dose: number;
  frequencyId: string;
  asNeeded: boolean;
  durationDays: number;
  /** Quantity to dispense per fill. */
  quantity: number;
  /** True when the user typed the quantity instead of using the calculated one. */
  quantityManual: boolean;
  route: string;
  /** Comments from prescriber to patient. */
  patientInstruction: string;
  /** Comments from prescriber to dispenser. */
  fulfillmentNote: string;
  /** Number of repeats allowed. Zero means a single fill. Always zero for N, C and R. */
  refills: number;
  reason: Reason;
  status: ItemStatus;
  statusReason?: string;
  /** Raised each time the item changes after it was sent. */
  version: number;
  allergyOverride?: { reason: string; by: string; at: string; allergy: string };
  /** Pharmacist check before dispensing. Hospital record only, never sent to nphies. Empty means not checked yet. */
  verify?: RxVerification;
}

/** The latest pharmacist decision on an item. It counts only while the item version is the one that was checked. */
export interface RxVerification {
  status: "verified" | "queried" | "rejected";
  /** Item version the pharmacist looked at. An edit by the prescriber raises the item version and asks for a new check. */
  version: number;
  /** Pharmacist name and staff number. */
  by: string;
  byId: string;
  at: string;
  /** Note typed when verifying, needed when the check sheet shows a serious finding. */
  note?: string;
  /** Why the item was rejected. */
  reason?: string;
  /** Question to the prescriber and the answer. */
  query?: { text: string; answer?: string; answeredBy?: string; answeredAt?: string };
}

/** Second person who checks a controlled drug at hand over. */
export interface Witness {
  name: string;
  staffNo: string;
}

export interface SentMark {
  at: string;
  http: number;
  ok: boolean;
}

export interface Prescription {
  id: string;
  /** Local prescription number shown to staff. */
  number: string;
  visitNumber: string;
  patientId: string;
  prescriberId: string;
  authoredAt: string;
  usage: UsageSetting;
  /** Overarching prescription id. Replaced by the reference id nphies returns after the first accepted submission (all medication types). */
  groupId: string;
  /** Reference id returned by nphies on the first accepted submission. Set for every prescription. */
  nationalRef?: string;
  /** The same reference id, kept only when the prescription is in Raqeeb scope. */
  raqeebRef?: string;
  /** True when the items are N, C or R. Controlled items are kept on their own prescription. */
  controlled: boolean;
  items: RxItem[];
  /** Set after the first accepted send. */
  sentAt?: string;
  /** Changed since the last accepted send. */
  dirty: boolean;
  lastSend?: SentMark;
}

export interface DispenseLine {
  id: string;
  identifier: string;
  itemId: string;
  drugId: string;
  quantity: number;
  type: FillType;
  status: "completed" | "cancelled";
  lot?: string;
  expiry?: string;
  refillsRemaining: number;
  daysSupply: number;
  version: number;
}

export interface Dispense {
  id: string;
  number: string;
  rxId: string;
  visitNumber: string;
  patientId: string;
  dispenser: string;
  handedOverAt: string;
  lines: DispenseLine[];
  /** Raqeeb secure code workflow, only for controlled items in Raqeeb scope. */
  secure?: { mode: "authenticated" | "override"; value?: string; /** Code from OVERRIDE_REASONS. */ justification?: string };
  /** Closed-loop scan result. */
  verification: { patientScan: boolean; drugScans: string[]; skippedReason?: string };
  /** Witness of a controlled drug hand over. Hospital record only. */
  witness?: Witness;
}

export interface RxCheck {
  level: "error" | "warn" | "ok";
  text: string;
  /** OperationOutcome issue code used in the simulated response. */
  code?: IssueCode;
  /** Spec reference shown in Developer View. */
  spec?: string;
}

export type IssueCode =
  | "invalid" | "structure" | "code-invalid" | "required" | "not-found" | "too-long" | "duplicate" | "not-supported" | "exception";

/** One message sent to the simulated Raqeeb endpoint. */
export interface SendRecord {
  id: string;
  at: string;
  kind: "prescription" | "dispense";
  /** Conformance step ids this send counts for. */
  steps: string[];
  action: string;
  targetId: string;
  http: number;
  ok: boolean;
  refId?: string;
  summary: string;
  checks: RxCheck[];
  bundle: unknown;
  outcome: unknown;
}

export interface RxState {
  prescriptions: Prescription[];
  dispenses: Dispense[];
  sends: SendRecord[];
  /** Height per visit in cm. The chart vitals do not hold height yet. */
  heights: Record<string, number>;
  counters: { rx: number; item: number; disp: number; ref: number };
}
