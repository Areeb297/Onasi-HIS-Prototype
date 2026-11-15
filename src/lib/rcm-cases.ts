import { audit } from "./audit";
import { claimFor, reviewModel, sendFromClaim, type ClaimModel, type Finding } from "./claims";
import { createStore } from "./fhir/store-util";
import { getInvoices, invoiceView, payerPaid, round2 } from "./invoice";
import { getLab } from "./lab";
import { caseOf, getFinancial, insuredPayer, PAYERS, runFinancial } from "./nphies-financial";
import { getRx } from "./rx";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";

/**
 * Revenue cycle case work after the payer answers: rejections, denials, fraud waste and abuse (FWA) flags, accounts
 * receivable (AR) follow-up, payment reconciliation and manual payer answers. Follows the HIS pages under rcm/ and
 * finance/payment-reconciliations.
 *
 * One source of money. Every amount on these screens comes from one of two places, never both:
 *  - Claims sent from this system (live claims): the visit invoice (invoice.ts) and the payer answer in NPHIES Financial
 *    (nphies-financial.ts). Their payment is recorded only through runFinancial, so the invoice insurance balance drops
 *    exactly as it does from the NPHIES Financial page.
 *  - Claims from before this system or loaded from a file (the claim ledger below): each holds its own service lines with
 *    the claimed and approved amount. Payments on them are the allocations of payment notices, nothing else.
 *
 * Choices to confirm with the hospital (made here so the screens work):
 *  - The rejection and denial reason codes are sample codes in the NPHIES format. Check the wording against the current
 *    NPHIES code lists before go-live.
 *  - A payment notice can only be sent once all of its money is adjusted to claims.
 *  - A claim sent from this system is paid in full by its payer answer, so its allocation must be the whole amount due.
 *  - A write-off needs a second person to approve it.
 */

/* ---------- code lists ---------- */

export const RCM_PAYERS = PAYERS;
export const COLLECTORS = ["Majed Aldosari", "Amal Alharbi", "Sultan Alqahtani", "Hind Alotaibi"];
export const FWA_REVIEWERS = ["Amal Alharbi", "Dr. Tariq Aldossary", "Hind Alotaibi", "Majed Aldosari"];
export const COLLECTION_STAGES = ["Initial Contact", "Follow Up", "Final Notice", "Legal Review", "Write Off Review"];
export const ESCALATION_LEVELS = ["Level 0 - None", "Level 1 - Minor", "Level 2 - Major", "Level 3 - Critical"];
export const CONTACT_MEDIUMS = ["Phone", "Email", "Payer Portal", "NPHIES Communication", "Meeting"];
export const CONTACT_OUTCOMES = ["Resolved", "Awaiting Payer Reply", "Escalated", "No Answer"];
export const PAY_METHODS = ["Bank Transfer", "Cheque", "Cash", "Card", "Online"];

/** Claim-level and line-level errors a payer sends back with a rejected claim. Sample codes in the NPHIES format. */
export const REJECTION_CODES: Record<string, string> = {
  "BV-00027": "There is no principal diagnosis on the claim.",
  "BV-00045": "The service needs prior authorization and no approval number was sent.",
  "BV-00112": "The member was not covered by the policy on the service date.",
  "BV-00230": "A service line is not linked to a diagnosis.",
  "BV-00318": "The service code is not in the payer price list.",
  "BV-00402": "This claim repeats a claim that was already sent.",
  "BV-00501": "The chief complaint is missing.",
  "BV-00763": "Required vital signs are missing.",
};

/** Why the payer did not pay a line (adjudication reason). Sample codes in the NPHIES format. */
export const DENIAL_CODES: Record<string, string> = {
  "MN-1-1": "The service is not medically justified for the diagnosis given.",
  "BE-1-4": "Prior authorization was needed and not obtained.",
  "CV-4-1": "The service is not covered by the member's policy class.",
  "AD-1-4": "The diagnosis does not match the service.",
  "SE-1-6": "The price is above the agreed contract price.",
  "AD-3-5": "A supporting document (discharge summary) was not sent.",
  "BE-1-3": "The member's annual benefit limit is used up.",
};

/** Where on the claim each rejection code is fixed. The claim page opens at this section. */
export const CODE_FIELD: Record<string, { field: string; label: string }> = {
  "BV-00027": { field: "diagnoses", label: "Diagnoses" },
  "BV-00045": { field: "review", label: "Prior Authorization" },
  "BV-00112": { field: "claim", label: "Coverage" },
  "BV-00230": { field: "lines", label: "Service Lines" },
  "BV-00318": { field: "lines", label: "Service Lines" },
  "BV-00402": { field: "claim", label: "Claim" },
  "BV-00501": { field: "supporting-information", label: "Supporting Information" },
  "BV-00763": { field: "supporting-information", label: "Supporting Information" },
};

const RULE_CODE: Record<string, string> = {
  "no-principal-dx": "BV-00027", "many-principal-dx": "BV-00027", "no-chief-complaint": "BV-00501", "no-vitals": "BV-00763",
  "vitals-missing": "BV-00763", "auth-not-approved": "BV-00045", "line-no-dx": "BV-00230", "line-zero-cost": "BV-00318",
};

/* ---------- statuses and their flow ---------- */

export type RejectionStatus = "Open" | "In Review" | "Corrected" | "Resubmitted" | "Closed";
export type DenialStatus = "Open" | "Appealed" | "Resolved" | "Closed";
export type FwaStatus = "Open" | "In Review" | "Closed";
export type ArStatus = "Open" | "In Review" | "Follow Up" | "Closed";

export const REJECTION_FLOW: Record<RejectionStatus, RejectionStatus[]> = {
  Open: ["In Review", "Corrected", "Closed"],
  "In Review": ["Corrected", "Resubmitted", "Closed"],
  Corrected: ["Resubmitted", "In Review", "Closed"],
  Resubmitted: ["Closed", "Open"],
  Closed: ["Open"],
};
export const DENIAL_FLOW: Record<DenialStatus, DenialStatus[]> = {
  Open: ["Appealed", "Resolved", "Closed"],
  Appealed: ["Resolved", "Open"],
  Resolved: ["Closed", "Open"],
  Closed: ["Open"],
};
export const FWA_FLOW: Record<FwaStatus, FwaStatus[]> = {
  Open: ["In Review", "Closed"],
  "In Review": ["Closed", "Open"],
  Closed: ["Open"],
};
export const AR_FLOW: Record<ArStatus, ArStatus[]> = {
  Open: ["In Review", "Follow Up", "Closed"],
  "In Review": ["Follow Up", "Closed", "Open"],
  "Follow Up": ["In Review", "Follow Up", "Closed"],
  Closed: ["Open"],
};

export function canMove<S extends string>(flow: Record<S, S[]>, from: S, to: S): boolean {
  return (flow[from] ?? []).includes(to);
}

export const isActive = (s: string) => s !== "Closed" && s !== "Resolved";

/* ---------- ageing ---------- */

export const BUCKETS = ["0-30", "31-60", "61-90", "91-120", "121+"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** YYYY-MM-DD of a date in local time. */
export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysAgo = (n: number, today: Date = new Date()) => dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));

/** Whole days from a date (YYYY-MM-DD or ISO) to today. Never below zero. */
export function ageDays(from: string, today: Date = new Date()): number {
  const day = from.slice(0, 10);
  const a = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Number.isFinite(a) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
}

export function bucketOf(days: number): Bucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 120) return "91-120";
  return "121+";
}

export interface AgeingRow { bucket: Bucket; insurance: number; patient: number; total: number; cases: number }

/** Outstanding money per ageing bucket, split into insurance and patient AR. Closed cases are left out. */
export function ageingOf(cases: Pick<ArCase, "bucket" | "kind" | "outstanding" | "status">[]): AgeingRow[] {
  return BUCKETS.map((bucket) => {
    const rows = cases.filter((c) => c.bucket === bucket && c.status !== "Closed" && c.outstanding > 0.004);
    const insurance = round2(rows.filter((c) => c.kind === "Insurance").reduce((n, c) => n + c.outstanding, 0));
    const patient = round2(rows.filter((c) => c.kind === "Patient").reduce((n, c) => n + c.outstanding, 0));
    return { bucket, insurance, patient, total: round2(insurance + patient), cases: rows.length };
  });
}

/* ---------- records ---------- */

export interface Note {
  id: string;
  at: string;
  by: string;
  text: string;
  /** Contact with the payer (HIS Claim Notes dialog). */
  medium?: string;
  outcome?: string;
  person?: string;
  reference?: string;
  followUp?: string;
}
export interface HistoryEntry { at: string; by: string; action: string; from?: string; to?: string; note?: string }

export type ClaimState = "Submitted" | "Approved" | "Partly Approved" | "Rejected" | "Denied";
export type PayState = "Not Paid" | "Partly Paid" | "Paid";

export interface LedgerLine {
  seq: number;
  code: string;
  text: string;
  claimed: number;
  /** What the payer approved. Missing while the claim waits for an answer. */
  approved?: number;
  /** The patient's share (co-pay) of the line. */
  patientShare?: number;
  /** Adjudication reason when the payer approved less than claimed less the patient share. */
  reason?: string;
}
export interface RejectionError { code: string; scope: "Claim" | "Item"; seq?: number; fix?: string }

/** A claim from before this system, or loaded from a file. It holds its own amounts. */
export interface LedgerClaim {
  claimNumber: string;
  patientName: string;
  mrn: string;
  nationalId?: string;
  payer: string;
  type: string;
  serviceDate: string;
  submittedOn: string;
  answeredOn?: string;
  diagnosis: string;
  state: ClaimState;
  errors?: RejectionError[];
  lines: LedgerLine[];
  /** Set on an appeal: the claim it appeals. */
  appealOf?: string;
  source: "earlier" | "import" | "appeal";
}

/** A claim as every RCM screen reads it, live or from the ledger. */
export interface RcmClaim {
  /** Visit number for a live claim, claim number for a ledger claim. Cases and allocations point here. */
  key: string;
  live: boolean;
  visit?: string;
  claimNumber: string;
  patientName: string;
  mrn: string;
  payer: string;
  type: string;
  serviceDate: string;
  submittedOn: string;
  answeredOn?: string;
  state: ClaimState;
  claimed: number;
  approved: number;
  patientShare: number;
  denied: number;
  paid: number;
  /** Approved less paid: what the payer still owes. */
  outstanding: number;
  pay: PayState;
  lines: (LedgerLine & { denied: number })[];
  errors: RejectionError[];
  appealOf?: string;
}

interface CaseOverlay { status?: string; notes: Note[]; history: HistoryEntry[]; assignee?: string }
interface RejectionOverlay extends CaseOverlay { fixes?: Record<string, string> }
interface DenialOverlay extends CaseOverlay {
  appeal?: { claimNumber: string; reason: string; attachments: string[]; seqs: number[]; at: string; by: string };
  writeOff?: { status: "Pending" | "Approved" | "Declined"; amount: number; reason: string; by: string; at: string; decidedBy?: string; decidedAt?: string };
  movedToPatient?: { amount: number; at: string; by: string };
}
interface FwaOverlay extends CaseOverlay { outcome?: string }
interface ArOverlay extends CaseOverlay {
  stage?: string;
  level?: number;
  nextFollowUp?: string;
  lastFollowUp?: string;
  promise?: { date: string; amount: number };
}

export interface FwaFlag {
  id: string;
  claimKey: string;
  ruleCode: string;
  ruleName: string;
  findingType: "Error" | "Waste" | "Abuse" | "Suspected Fraud" | "Anomaly";
  description: string;
  evidence: string[];
  score: number;
  stage: "Pre Submission" | "Post Claim Response";
  lineSeq?: number;
  openedOn: string;
  atRisk: number;
}

/** Patient AR from outside the visit invoices: earlier invoices, and denied money moved to the patient. */
export interface PatientDebt { ref: string; patientName: string; mrn: string; amount: number; since: string; from?: string }

export interface Allocation { claimKey: string; claimNumber: string; amount: number; at: string; by: string }
export interface PaymentNotice {
  /** Reconciliation number. */
  id: string;
  payer: string;
  amount: number;
  date: string;
  reference: string;
  allocations: Allocation[];
  createdAt: string;
  by: string;
  manual?: { method: string; writeOff: number; active: boolean };
  notice?: { status: "Paid" | "Cleared"; at: string; by: string };
  /** Payment advice recorded in NPHIES Financial for a live claim, shown here so all payments are in one list. */
  fromNphies?: boolean;
}

export interface ImportBatch { id: string; fileName: string; at: string; by: string; total: number; saved: number; created: number; updated: number; invalid: number }

export interface RcmState {
  v: 1;
  claims: LedgerClaim[];
  rejections: Record<string, RejectionOverlay>;
  denials: Record<string, DenialOverlay>;
  fwaFlags: FwaFlag[];
  fwa: Record<string, FwaOverlay>;
  ar: Record<string, ArOverlay>;
  patientDebts: PatientDebt[];
  notices: PaymentNotice[];
  imports: ImportBatch[];
  seq: number;
}

/* ---------- seed ---------- */

const L = (seq: number, code: string, text: string, claimed: number, approved?: number, patientShare = 0, reason?: string): LedgerLine =>
  ({ seq, code, text, claimed, approved, patientShare, reason });

const ts = (dayIso: string, hm = "10:00") => new Date(`${dayIso}T${hm}:00`).toISOString();

export function seedRcm(today: Date = new Date()): RcmState {
  const d = (n: number) => daysAgo(n, today);
  const claim = (c: Omit<LedgerClaim, "source">): LedgerClaim => ({ ...c, source: "earlier" });
  const claims: LedgerClaim[] = [
    // Rejected for errors.
    claim({ claimNumber: "CLM-26-4403", patientName: "Nasser Alzahrani", mrn: "MRN-100156", nationalId: "1029384756", payer: "MedGulf", type: "Institutional", serviceDate: d(12), submittedOn: d(10), answeredOn: d(9), diagnosis: "S72.0 Fracture of neck of femur", state: "Rejected",
      errors: [{ code: "BV-00045", scope: "Claim" }], lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 3200), L(2, "SBS-SAMPLE-4120", "X-Ray Hip", 320), L(3, "SBS-SAMPLE-3015", "Complete Blood Count", 85)] }),
    claim({ claimNumber: "CLM-26-4377", patientName: "Khalid Alrashidi", mrn: "MRN-100221", nationalId: "1048826301", payer: "Tawuniya", type: "Professional", serviceDate: d(16), submittedOn: d(15), answeredOn: d(14), diagnosis: "M54.5 Low back pain", state: "Rejected",
      errors: [{ code: "BV-00230", scope: "Item", seq: 2 }, { code: "BV-00763", scope: "Claim" }], lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350), L(2, "SBS-SAMPLE-4310", "MRI Lumbar Spine", 1450)] }),
    claim({ claimNumber: "CLM-26-4359", patientName: "Noura Alshehri", mrn: "MRN-100274", nationalId: "1077310428", payer: "Bupa Arabia", type: "Professional", serviceDate: d(20), submittedOn: d(19), answeredOn: d(18), diagnosis: "J06.9 Acute upper respiratory infection, unspecified", state: "Rejected",
      errors: [{ code: "BV-00402", scope: "Claim" }], lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350)] }),
    claim({ claimNumber: "CLM-26-4341", patientName: "Meshal Alanazi", mrn: "MRN-100299", nationalId: "2310458871", payer: "NextCare", type: "Institutional", serviceDate: d(34), submittedOn: d(33), answeredOn: d(31), diagnosis: "S06.0 Concussion", state: "Rejected",
      errors: [{ code: "BV-00112", scope: "Claim" }], lines: [L(1, "SBS-SAMPLE-1002", "Emergency Department Visit", 900), L(2, "SBS-SAMPLE-4205", "CT Brain Without Contrast", 1250)] }),
    claim({ claimNumber: "CLM-26-4322", patientName: "Hessa Almansour", mrn: "MRN-100318", nationalId: "1093372615", payer: "Daman", type: "Professional", serviceDate: d(47), submittedOn: d(45), answeredOn: d(44), diagnosis: "E11.9 Type 2 diabetes mellitus without complication", state: "Rejected",
      errors: [{ code: "BV-00318", scope: "Item", seq: 2 }], lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350), L(2, "SBS-SAMPLE-3044", "Glycated Haemoglobin (HbA1c)", 120)] }),
    // Denied in part or in full.
    claim({ claimNumber: "CLM-26-4298", patientName: "Abdulaziz Alotaibi", mrn: "MRN-100331", nationalId: "1061129934", payer: "Tawuniya", type: "Institutional", serviceDate: d(40), submittedOn: d(38), answeredOn: d(33), diagnosis: "J18.9 Pneumonia, unspecified", state: "Partly Approved",
      lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 3200, 3200), L(2, "SBS-SAMPLE-4310", "MRI Lumbar Spine", 1450, 0, 0, "MN-1-1"), L(3, "SBS-SAMPLE-3015", "Complete Blood Count", 255, 255)] }),
    claim({ claimNumber: "CLM-26-4275", patientName: "Joud Alsalem", mrn: "MRN-100266", nationalId: "1100458823", payer: "Daman", type: "Institutional", serviceDate: d(55), submittedOn: d(52), answeredOn: d(46), diagnosis: "K35.8 Acute appendicitis, other and unspecified", state: "Partly Approved",
      lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 9600, 7200, 0, "SE-1-6"), L(2, "SBS-SAMPLE-5011", "Ceftriaxone 1 g Injection", 380, 380)] }),
    claim({ claimNumber: "CLM-26-4260", patientName: "Bandar Alharthi", mrn: "MRN-100342", nationalId: "1058821177", payer: "MedGulf", type: "Professional", serviceDate: d(70), submittedOn: d(68), answeredOn: d(61), diagnosis: "M17.1 Primary osteoarthritis of knee", state: "Partly Approved",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350, 315, 35), L(2, "SBS-SAMPLE-6020", "Physiotherapy Session (4)", 720, 0, 0, "CV-4-1")] }),
    claim({ claimNumber: "CLM-26-4231", patientName: "Rakan Alshahrani", mrn: "MRN-100355", nationalId: "1088452290", payer: "Bupa Arabia", type: "Professional", serviceDate: d(26), submittedOn: d(25), answeredOn: d(21), diagnosis: "R10.4 Other and unspecified abdominal pain", state: "Partly Approved",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350, 315, 35), L(2, "SBS-SAMPLE-4230", "CT Abdomen With Contrast", 1250, 0, 0, "BE-1-4")] }),
    claim({ claimNumber: "CLM-26-4210", patientName: "Maha Alshammari", mrn: "MRN-100302", nationalId: "1072215546", payer: "Malath Insurance", type: "Institutional", serviceDate: d(18), submittedOn: d(17), answeredOn: d(12), diagnosis: "R07.4 Chest pain, unspecified", state: "Denied",
      lines: [L(1, "SBS-SAMPLE-1002", "Emergency Department Visit", 900, 0, 0, "AD-3-5"), L(2, "SBS-SAMPLE-3061", "Troponin I", 170, 0, 0, "AD-3-5")] }),
    // Approved, waiting for the payer's money.
    claim({ claimNumber: "CLM-26-4401", patientName: "Sara Almutairi", mrn: "MRN-100245", nationalId: "1044712280", payer: "Bupa Arabia", type: "Professional", serviceDate: d(13), submittedOn: d(12), answeredOn: d(11), diagnosis: "J06.9 Acute upper respiratory infection, unspecified", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350, 315, 35), L(2, "SBS-SAMPLE-3015", "Complete Blood Count", 170, 153, 17)] }),
    claim({ claimNumber: "CLM-26-4402", patientName: "Fahad Alqarni", mrn: "MRN-100187", nationalId: "1035567104", payer: "Tawuniya", type: "Professional", serviceDate: d(11), submittedOn: d(10), answeredOn: d(8), diagnosis: "M23.2 Derangement of meniscus due to old tear or injury", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350, 280, 70), L(2, "SBS-SAMPLE-4320", "MRI Knee", 1122, 897.6, 224.4)] }),
    claim({ claimNumber: "CLM-26-4188", patientName: "Omar Alqahtani", mrn: "MRN-100362", nationalId: "1029947731", payer: "MedGulf", type: "Institutional", serviceDate: d(48), submittedOn: d(46), answeredOn: d(40), diagnosis: "I50.9 Heart failure, unspecified", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 3200, 3200), L(2, "SBS-SAMPLE-5044", "Furosemide 40 mg Injection", 660, 660)] }),
    claim({ claimNumber: "CLM-26-3975", patientName: "Lama Alghamdi", mrn: "MRN-100377", nationalId: "1081136649", payer: "Bupa Arabia", type: "Professional", serviceDate: d(75), submittedOn: d(74), answeredOn: d(70), diagnosis: "L30.9 Dermatitis, unspecified", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350, 315, 35), L(2, "SBS-SAMPLE-6110", "Skin Biopsy", 610, 549, 61)] }),
    claim({ claimNumber: "CLM-26-3610", patientName: "Saad Aldawsari", mrn: "MRN-100388", nationalId: "1015583302", payer: "MedGulf", type: "Institutional", serviceDate: d(138), submittedOn: d(136), answeredOn: d(128), diagnosis: "N10 Acute pyelonephritis", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 2600, 2600), L(2, "SBS-SAMPLE-4410", "Ultrasound Kidneys", 500, 500)] }),
    claim({ claimNumber: "CLM-26-3802", patientName: "Reema Alharbi", mrn: "MRN-100266", nationalId: "1100231184", payer: "Daman", type: "Institutional", serviceDate: d(100), submittedOn: d(98), answeredOn: d(92), diagnosis: "O80 Single spontaneous delivery", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 6400, 6400), L(2, "SBS-SAMPLE-7010", "Normal Delivery", 2250, 2250)] }),
    claim({ claimNumber: "CLM-26-4415", patientName: "Faris Alenezi", mrn: "MRN-100391", nationalId: "2298874410", payer: "NextCare", type: "Institutional", serviceDate: d(6), submittedOn: d(5), answeredOn: d(4), diagnosis: "R51 Headache", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1002", "Emergency Department Visit", 900, 810, 90), L(2, "SBS-SAMPLE-4205", "CT Brain Without Contrast", 940, 846, 94)] }),
    claim({ claimNumber: "CLM-26-4380", patientName: "Turki Alotaibi", mrn: "MRN-100402", nationalId: "1037759921", payer: "Bupa Arabia", type: "Professional", serviceDate: d(25), submittedOn: d(24), answeredOn: d(20), diagnosis: "J20.9 Acute bronchitis, unspecified", state: "Approved",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350, 315, 35), L(2, "SBS-SAMPLE-4101", "X-Ray Chest", 850, 765, 85)] }),
    // Sent, no answer yet (Manual Responses).
    claim({ claimNumber: "CLM-26-4431", patientName: "Ibrahim Alghamdi", mrn: "MRN-100415", nationalId: "1052286617", payer: "Tawuniya", type: "Institutional", serviceDate: d(9), submittedOn: d(3), diagnosis: "K80.2 Calculus of gallbladder without cholecystitis", state: "Submitted",
      lines: [L(1, "SBS-SAMPLE-1003", "Inpatient Stay", 4800), L(2, "SBS-SAMPLE-8020", "Laparoscopic Cholecystectomy", 6200)] }),
    claim({ claimNumber: "CLM-26-4436", patientName: "Wafa Alsubaie", mrn: "MRN-100421", nationalId: "1066614402", payer: "Bupa Arabia", type: "Professional", serviceDate: d(3), submittedOn: d(2), diagnosis: "E03.9 Hypothyroidism, unspecified", state: "Submitted",
      lines: [L(1, "SBS-SAMPLE-1001", "Outpatient Consultation", 350), L(2, "SBS-SAMPLE-3071", "Thyroid Stimulating Hormone", 95), L(3, "SBS-SAMPLE-3072", "Free T4", 95), L(4, "SBS-SAMPLE-3073", "Thyroid Function Panel", 200)] }),
  ];
  const approvedOf = (n: string) => round2(claims.find((c) => c.claimNumber === n)!.lines.reduce((s, l) => s + (l.approved ?? 0), 0));
  const alloc = (claimNumber: string, amount: number, at: string): Allocation => ({ claimKey: claimNumber, claimNumber, amount, at, by: "Majed Aldosari" });
  const notices: PaymentNotice[] = [
    // Bupa paid CLM-26-4380 in full; the rest of the transfer is waiting to be adjusted to two more claims.
    { id: "RCN-2611-0101", payer: "Bupa Arabia", amount: round2(approvedOf("CLM-26-4380") + approvedOf("CLM-26-4401") + approvedOf("CLM-26-3975")), date: d(4), reference: "RMT-88120",
      allocations: [alloc("CLM-26-4380", approvedOf("CLM-26-4380"), ts(d(3)))], createdAt: ts(d(4)), by: "Majed Aldosari" },
    // Daman paid part of a delivery claim and the notice went back.
    { id: "RCN-2611-0102", payer: "Daman", amount: 5000, date: d(30), reference: "RMT-88145",
      allocations: [alloc("CLM-26-3802", 5000, ts(d(29)))], createdAt: ts(d(30)), by: "Majed Aldosari", notice: { status: "Paid", at: ts(d(29), "11:20"), by: "Majed Aldosari" } },
    // MedGulf paid the heart failure stay; not adjusted yet.
    { id: "RCN-2611-0103", payer: "MedGulf", amount: approvedOf("CLM-26-4188"), date: d(2), reference: "RMT-88171", allocations: [], createdAt: ts(d(2)), by: "Majed Aldosari" },
    // A cheque from Tawuniya, keyed in by hand.
    { id: "MP-2611-0001", payer: "Tawuniya", amount: approvedOf("CLM-26-4402"), date: d(1), reference: "CHQ-009817", allocations: [], createdAt: ts(d(1)), by: "Majed Aldosari",
      manual: { method: "Cheque", writeOff: 0, active: true } },
  ];
  const n = (id: string, at: string, by: string, text: string, extra: Partial<Note> = {}): Note => ({ id, at, by, text, ...extra });
  const h = (at: string, by: string, action: string, from?: string, to?: string, note?: string): HistoryEntry => ({ at, by, action, from, to, note });
  return {
    v: 1,
    claims,
    rejections: {
      "RJ-CLM-26-4403": { status: "In Review", assignee: "Amal Alharbi", history: [h(ts(d(8)), "Amal Alharbi", "Start Review", "Open", "In Review", "Asked the approvals office for the authorization number.")],
        notes: [n("N-1", ts(d(8), "10:30"), "Amal Alharbi", "Payer asked for the approval number before the claim is sent again.", { medium: "Phone", outcome: "Awaiting Payer Reply", person: "MedGulf provider desk", reference: "MG-CALL-4471", followUp: d(-1) })] },
      "RJ-CLM-26-4359": { status: "Corrected", history: [h(ts(d(17)), "Majed Aldosari", "Correct", "Open", "Corrected", "First claim CLM-26-4380 covers a different day. Added the visit date to the claim.")], notes: [], fixes: { "0": "Visit on a different day from CLM-26-4380; service date checked." } },
      "RJ-CLM-26-4322": { status: "Resubmitted", history: [h(ts(d(43)), "Majed Aldosari", "Correct", "Open", "Corrected", "Changed the HbA1c code to the payer's code."), h(ts(d(42)), "Majed Aldosari", "Resubmit", "Corrected", "Resubmitted")], notes: [] },
    },
    denials: {
      "DN-CLM-26-4275": { status: "Appealed", history: [h(ts(d(40)), "Amal Alharbi", "Appeal", "Open", "Appealed", "Contract price list of 2026 attached.")], notes: [],
        appeal: { claimNumber: "CLM-26-4275-AP1", reason: "The stay was billed at the 2026 contract price for a double room.", attachments: ["Daman contract 2026 price list.pdf"], seqs: [1], at: ts(d(40)), by: "Amal Alharbi" } },
      "DN-CLM-26-4260": { status: "Open", history: [], notes: [n("N-2", ts(d(55), "12:00"), "Majed Aldosari", "Policy class C does not cover physiotherapy. Patient to be told.", { medium: "Payer Portal", outcome: "Resolved" })] },
    },
    fwaFlags: [
      { id: "FWA-501", claimKey: "CLM-26-4298", ruleCode: "FWA-R-031", ruleName: "Imaging Without A Matching Diagnosis", findingType: "Waste", lineSeq: 2, score: 64, stage: "Post Claim Response", openedOn: d(33), atRisk: 1450,
        description: "An MRI of the lumbar spine was billed on a pneumonia admission.", evidence: ["Principal diagnosis J18.9 Pneumonia, unspecified", "No back pain in the chief complaint or the notes", "Payer denied the line for medical necessity (MN-1-1)"] },
      { id: "FWA-502", claimKey: "CLM-26-4359", ruleCode: "FWA-R-012", ruleName: "Same Service Billed Twice In 7 Days", findingType: "Waste", lineSeq: 1, score: 72, stage: "Post Claim Response", openedOn: d(18), atRisk: 350,
        description: "A consultation for the same patient and doctor was billed twice within a week.", evidence: ["CLM-26-4380 billed SBS-SAMPLE-1001 five days earlier", "Same treating doctor on both claims"] },
      { id: "FWA-503", claimKey: "CLM-26-4431", ruleCode: "FWA-R-044", ruleName: "Stay Longer Than Expected For The Diagnosis", findingType: "Anomaly", score: 58, stage: "Pre Submission", openedOn: d(3), atRisk: 4800,
        description: "Six days in hospital for an elective laparoscopic cholecystectomy.", evidence: ["Expected stay for this diagnosis group: 1 to 2 days", "No complication coded"] },
      { id: "FWA-504", claimKey: "CLM-26-4415", ruleCode: "FWA-R-020", ruleName: "Emergency Visit For A Routine Complaint", findingType: "Abuse", score: 41, stage: "Post Claim Response", openedOn: d(4), atRisk: 900,
        description: "Emergency visit billed for a headache triaged at CTAS 5.", evidence: ["Triage level CTAS 5", "Seen and sent home within 40 minutes"] },
      { id: "FWA-505", claimKey: "CLM-26-4436", ruleCode: "FWA-R-007", ruleName: "Panel Tests Billed Separately", findingType: "Error", lineSeq: 4, score: 35, stage: "Pre Submission", openedOn: d(2), atRisk: 190,
        description: "TSH and Free T4 were billed on their own and again inside the thyroid panel.", evidence: ["Lines 2 and 3 are part of line 4"] },
      { id: "FWA-506", claimKey: "CLM-26-4188", ruleCode: "FWA-R-052", ruleName: "Medicine Above The Usual Daily Dose", findingType: "Suspected Fraud", lineSeq: 2, score: 86, stage: "Post Claim Response", openedOn: d(40), atRisk: 660,
        description: "Furosemide billed at three times the usual daily amount for six days.", evidence: ["22 vials billed for a 6-day stay", "Medication chart shows 8 doses given"] },
    ],
    fwa: {
      "FWA-502": { status: "In Review", assignee: "Amal Alharbi", history: [h(ts(d(16)), "Amal Alharbi", "Start Review", "Open", "In Review")], notes: [] },
      "FWA-506": { status: "In Review", assignee: "Dr. Tariq Aldossary", history: [h(ts(d(38)), "Majed Aldosari", "Assign Reviewer", undefined, undefined, "Needs a medical auditor."), h(ts(d(37)), "Dr. Tariq Aldossary", "Start Review", "Open", "In Review")],
        notes: [n("N-3", ts(d(37), "09:15"), "Dr. Tariq Aldossary", "Asked pharmacy for the dispensing record of this admission.")] },
    },
    ar: {
      "AR-CLM-26-3610": { status: "Follow Up", assignee: "Amal Alharbi", level: 3, stage: "Final Notice", nextFollowUp: d(2), lastFollowUp: d(14),
        history: [h(ts(d(60)), "Amal Alharbi", "Record Follow-Up", "Open", "Follow Up", "Payer says the claim is in their payment run."), h(ts(d(14)), "Amal Alharbi", "Escalate", undefined, undefined, "Escalated to the payer relations manager.")], notes: [] },
      "AR-CLM-26-4188": { status: "In Review", assignee: "Majed Aldosari", level: 1, stage: "Follow Up", promise: { date: d(-10), amount: approvedOf("CLM-26-4188") },
        history: [h(ts(d(6)), "Majed Aldosari", "Promise To Pay", "In Review", "In Review", "MedGulf promised payment in the next remittance.")], notes: [] },
      "AR-CLM-26-3975": { status: "Open", assignee: "Sultan Alqahtani", nextFollowUp: d(-2), history: [], notes: [] },
    },
    patientDebts: [
      { ref: "INV-26-00795", patientName: "Rakan Alshahrani", mrn: "MRN-100355", amount: 540, since: d(113) },
      { ref: "INV-26-00812", patientName: "Fatimah Alzahrani", mrn: "MRN-100428", amount: 1260, since: d(64) },
      { ref: "INV-26-00840", patientName: "Yazeed Almutairi", mrn: "MRN-100433", amount: 310, since: d(22) },
    ],
    notices,
    imports: [],
    seq: 10,
  };
}

const store = createStore<RcmState>("onasi-rcm-cases-v1", () => seedRcm());
export const useRcm = store.use;
export const getRcm = store.get;
export const resetRcm = (today?: Date) => store.set(seedRcm(today));

/* ---------- reading claims ---------- */

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

function payState(approved: number, paid: number): PayState {
  if (paid > 0.004 && paid >= approved - 0.004) return "Paid";
  return paid > 0.004 ? "Partly Paid" : "Not Paid";
}

export function ledgerView(c: LedgerClaim, s: RcmState): RcmClaim {
  const answered = c.state !== "Submitted";
  const lines = c.lines.map((l) => {
    const approved = answered ? (l.approved ?? 0) : 0;
    const ps = l.patientShare ?? 0;
    return { ...l, approved, denied: answered && c.state !== "Rejected" ? round2(Math.max(0, l.claimed - approved - ps)) : 0 };
  });
  const claimed = sum(lines.map((l) => l.claimed));
  const approved = sum(lines.map((l) => l.approved));
  const paid = sum(s.notices.flatMap((n) => n.allocations).filter((a) => a.claimKey === c.claimNumber).map((a) => a.amount));
  return {
    key: c.claimNumber, live: false, claimNumber: c.claimNumber, patientName: c.patientName, mrn: c.mrn, payer: c.payer, type: c.type,
    serviceDate: c.serviceDate, submittedOn: c.submittedOn, answeredOn: c.answeredOn, state: c.state, claimed, approved,
    patientShare: sum(lines.map((l) => l.patientShare ?? 0)), denied: sum(lines.map((l) => l.denied)), paid,
    outstanding: round2(Math.max(0, approved - paid)), pay: payState(approved, paid), lines, errors: c.errors ?? [], appealOf: c.appealOf,
  };
}

/** Errors on a live rejected claim: the claim review findings as payer codes, or one claim-level error. */
export function errorsFromFindings(findings: Pick<Finding, "rule" | "lineKey" | "text">[], lines: { key: string; seq: number }[]): RejectionError[] {
  const out: RejectionError[] = [];
  for (const f of findings) {
    const code = RULE_CODE[f.rule];
    if (!code || (f.rule === "line-zero-cost")) continue;
    const seq = f.lineKey ? lines.find((l) => l.key === f.lineKey)?.seq : undefined;
    if (out.some((e) => e.code === code && e.seq === seq)) continue;
    out.push({ code, scope: seq ? "Item" : "Claim", seq });
  }
  return out;
}

function liveView(m: ClaimModel, fin = getFinancial()): RcmClaim | null {
  const fc = caseOf(m.visit, fin).claim;
  if (!fc) return null;
  const state: ClaimState = fc.status === "rejected" ? "Rejected" : fc.status === "approved" ? "Approved" : "Submitted";
  const approved = state === "Approved" ? round2(fc.approved ?? 0) : 0;
  const paid = payerPaid(m.visit, fin);
  const share = m.totals.taxable > 0 ? m.totals.patientAmount / m.totals.taxable : 0;
  const lines = m.lines.map((l) => {
    const ps = round2(l.net * share);
    return { seq: l.seq, code: l.code, text: l.text, claimed: l.net, approved: state === "Approved" ? round2(l.net - ps) : 0, patientShare: ps, denied: 0 };
  });
  const errors = state === "Rejected" ? errorsFromFindings(reviewModel(m, "claim"), m.lines) : [];
  return {
    key: m.visit, live: true, visit: m.visit, claimNumber: fc.claimNumber, patientName: patientName(m.patient), mrn: m.patient.mrn, payer: m.payer,
    type: m.type === "institutional" ? "Institutional" : "Professional", serviceDate: m.start, submittedOn: fc.at.slice(0, 10),
    answeredOn: state === "Submitted" ? undefined : fc.at.slice(0, 10), state, claimed: m.net, approved, patientShare: round2(m.totals.patientAmount),
    denied: 0, paid, outstanding: round2(Math.max(0, approved - paid)), pay: payState(approved, paid), lines,
    errors: state === "Rejected" && !errors.length ? [{ code: "BV-00318", scope: "Claim" }] : errors,
  };
}

/** Every claim the RCM screens work on: live claims that went to the payer, then the ledger. */
export function allClaims(s: RcmState = store.get(), fin = getFinancial()): RcmClaim[] {
  const live: RcmClaim[] = [];
  for (const c of fin.cases) {
    if (!c.claim || c.claim.status === "cancelled") continue;
    const m = claimFor(c.visit);
    const v = m && liveView(m, fin);
    if (v) live.push(v);
  }
  return [...live, ...s.claims.map((c) => ledgerView(c, s))];
}

export const claimByKey = (key: string, claims: RcmClaim[] = allClaims()) => claims.find((c) => c.key === key);

/* ---------- cases ---------- */

export interface RejectionCase {
  id: string;
  claim: RcmClaim;
  status: RejectionStatus;
  assignee?: string;
  errors: (RejectionError & { text: string; field: string; fieldLabel: string; fixed?: string })[];
  ageDays: number;
  notes: Note[];
  history: HistoryEntry[];
}

export function rejectionCases(s: RcmState = store.get(), claims: RcmClaim[] = allClaims(s), today: Date = new Date()): RejectionCase[] {
  const out: RejectionCase[] = [];
  for (const c of claims) {
    const id = `RJ-${c.key}`;
    const o = s.rejections[id];
    if (c.state !== "Rejected" && !o) continue;
    let status = (o?.status as RejectionStatus | undefined) ?? "Open";
    // A live claim sent again from the claim page or NPHIES Financial has left the rejected state.
    if (c.live && c.state !== "Rejected" && status !== "Closed") status = "Resubmitted";
    const errors = c.errors.map((e, i) => ({
      ...e, text: REJECTION_CODES[e.code] ?? "The payer did not give a reason.", field: CODE_FIELD[e.code]?.field ?? "claim",
      fieldLabel: CODE_FIELD[e.code]?.label ?? "Claim", fixed: o?.fixes?.[String(i)],
    }));
    out.push({ id, claim: c, status, assignee: o?.assignee, errors, ageDays: ageDays(c.answeredOn ?? c.submittedOn, today), notes: o?.notes ?? [], history: o?.history ?? [] });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

export interface DenialCase {
  id: string;
  claim: RcmClaim;
  status: DenialStatus;
  deniedLines: (LedgerLine & { denied: number; reasonText: string })[];
  denied: number;
  /** Denied money still open: not recovered on appeal, written off or moved to the patient. */
  open: number;
  recovered: number;
  appeal?: DenialOverlay["appeal"] & { state: ClaimState; approved: number };
  writeOff?: DenialOverlay["writeOff"];
  movedToPatient?: DenialOverlay["movedToPatient"];
  ageDays: number;
  notes: Note[];
  history: HistoryEntry[];
}

export function denialCases(s: RcmState = store.get(), claims: RcmClaim[] = allClaims(s), today: Date = new Date()): DenialCase[] {
  const out: DenialCase[] = [];
  for (const c of claims) {
    if (c.appealOf || c.state === "Rejected" || c.state === "Submitted" || c.denied <= 0.004) continue;
    const id = `DN-${c.key}`;
    const o = s.denials[id];
    const deniedLines = c.lines.filter((l) => l.denied > 0.004).map((l) => ({ ...l, reasonText: DENIAL_CODES[l.reason ?? ""] ?? "No reason given." }));
    const ap = o?.appeal && claims.find((x) => x.claimNumber === o.appeal!.claimNumber);
    const recovered = ap && ap.state !== "Submitted" ? ap.approved : 0;
    const written = o?.writeOff?.status === "Approved" ? o.writeOff.amount : 0;
    const moved = o?.movedToPatient?.amount ?? 0;
    out.push({
      id, claim: c, status: (o?.status as DenialStatus | undefined) ?? "Open", deniedLines, denied: c.denied,
      open: round2(Math.max(0, c.denied - recovered - written - moved)), recovered,
      appeal: o?.appeal && { ...o.appeal, state: ap?.state ?? "Submitted", approved: recovered },
      writeOff: o?.writeOff, movedToPatient: o?.movedToPatient, ageDays: ageDays(c.answeredOn ?? c.submittedOn, today), notes: o?.notes ?? [], history: o?.history ?? [],
    });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

export interface FwaCase {
  id: string;
  flag: FwaFlag;
  claim?: RcmClaim;
  patientName: string;
  payer: string;
  claimNumber: string;
  status: FwaStatus;
  reviewer?: string;
  outcome?: string;
  ageDays: number;
  notes: Note[];
  history: HistoryEntry[];
}

export const FWA_OUTCOMES = ["Cleared", "Error Corrected", "Waste Confirmed", "Abuse Confirmed", "Referred For Investigation"];

/**
 * Simple checks over the live visits that carry a claim or are ready for one. Sample rules: the payer's and the
 * hospital's FWA rule engine decides the real list.
 */
export function liveFwaFlags(today: Date = new Date()): FwaFlag[] {
  const his = getState();
  const fin = getFinancial();
  const lab = getLab().orders;
  const rx = getRx().prescriptions;
  const out: FwaFlag[] = [];
  for (const enc of his.encounters) {
    if (enc.status === "cancelled" || enc.status === "preadmit") continue;
    const p = his.patients.find((x) => x.id === enc.patientId);
    if (!p || !insuredPayer(p)) continue;
    const v = enc.visitNumber;
    const fc = caseOf(v, fin).claim;
    const stage = fc && fc.status !== "cancelled" ? "Post Claim Response" : "Pre Submission";
    const opened = (enc.admitAt ?? enc.ed?.arrivalAt ?? dayOf(today)).slice(0, 10);
    const codes = lab.filter((o) => o.visitNumber === v && o.status !== "cancelled").flatMap((o) => o.codes);
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length) out.push({ id: `FWA-${v}-DUP`, claimKey: v, ruleCode: "FWA-R-013", ruleName: "Same Test Ordered Twice In One Visit", findingType: "Waste", score: 55, stage, openedOn: opened, atRisk: dup.length * 85,
      description: `${dup.length} laboratory test${dup.length === 1 ? " was" : "s were"} ordered more than once in this visit.`, evidence: [`Repeated test codes: ${[...new Set(dup)].join(", ")}`] });
    if (enc.cls === "O" && codes.length >= 6) out.push({ id: `FWA-${v}-LAB`, claimKey: v, ruleCode: "FWA-R-021", ruleName: "High Test Volume For An Outpatient Visit", findingType: "Anomaly", score: 46, stage, openedOn: opened, atRisk: codes.length * 85,
      description: `${codes.length} laboratory tests in one clinic visit.`, evidence: [`${codes.length} tests ordered; the usual clinic visit has fewer than 6`] });
    const meds = rx.filter((x) => x.visitNumber === v).flatMap((x) => x.items.filter((i) => i.status !== "cancelled" && !i.patientProvided));
    if (meds.length >= 5) out.push({ id: `FWA-${v}-RX`, claimKey: v, ruleCode: "FWA-R-033", ruleName: "Five Or More Medicines In One Visit", findingType: "Anomaly", score: 40, stage, openedOn: opened, atRisk: meds.length * 40,
      description: `${meds.length} medicines prescribed in one visit.`, evidence: ["Check each medicine has a diagnosis on the claim"] });
  }
  return out;
}

export function fwaCases(s: RcmState = store.get(), claims: RcmClaim[] = allClaims(s), today: Date = new Date(), live: FwaFlag[] = liveFwaFlags(today)): FwaCase[] {
  const his = getState();
  return [...live, ...s.fwaFlags].map((flag) => {
    const o = s.fwa[flag.id];
    const claim = claims.find((c) => c.key === flag.claimKey);
    const enc = his.encounters.find((e) => e.visitNumber === flag.claimKey);
    const p = enc && his.patients.find((x) => x.id === enc.patientId);
    return {
      id: flag.id, flag, claim, patientName: claim?.patientName ?? patientName(p), payer: claim?.payer ?? (p ? insuredPayer(p) ?? "" : ""),
      claimNumber: claim?.claimNumber ?? "Not Sent Yet", status: (o?.status as FwaStatus | undefined) ?? "Open", reviewer: o?.assignee, outcome: o?.outcome,
      ageDays: ageDays(flag.openedOn, today), notes: o?.notes ?? [], history: o?.history ?? [],
    };
  }).sort((a, b) => b.flag.score - a.flag.score);
}

export type Priority = "High" | "Medium" | "Low";
export interface ArCase {
  id: string;
  kind: "Insurance" | "Patient";
  ref: string;
  claimKey?: string;
  visit?: string;
  patientName: string;
  mrn: string;
  payer: string;
  agingStart: string;
  days: number;
  bucket: Bucket;
  outstanding: number;
  priority: Priority;
  status: ArStatus;
  assignee?: string;
  stage?: string;
  level: number;
  nextFollowUp?: string;
  lastFollowUp?: string;
  promise?: { date: string; amount: number };
  followUpOverdue: boolean;
  promiseOverdue: boolean;
  notes: Note[];
  history: HistoryEntry[];
}

export function priorityOf(days: number, amount: number): Priority {
  if (days > 90 || amount >= 10000) return "High";
  if (days > 30 || amount >= 3000) return "Medium";
  return "Low";
}

export function arCases(s: RcmState = store.get(), claims: RcmClaim[] = allClaims(s), today: Date = new Date()): ArCase[] {
  const his = getState();
  const todayIso = dayOf(today);
  const rows: Omit<ArCase, "id" | "days" | "bucket" | "priority" | "status" | "assignee" | "stage" | "level" | "nextFollowUp" | "lastFollowUp" | "promise" | "followUpOverdue" | "promiseOverdue" | "notes" | "history">[] = [];
  for (const c of claims) {
    if (c.state !== "Approved" && c.state !== "Partly Approved") continue;
    if (c.outstanding <= 0.004 && !s.ar[`AR-${c.key}`]) continue;
    rows.push({ kind: "Insurance", ref: c.claimNumber, claimKey: c.key, visit: c.visit, patientName: c.patientName, mrn: c.mrn, payer: c.payer, agingStart: c.submittedOn, outstanding: c.outstanding });
  }
  // Patient balances on finished visit invoices.
  for (const inv of getInvoices().invoices) {
    if (!inv.finalizedAt) continue;
    const v = invoiceView(inv);
    const id = `AR-INV-${inv.number}`;
    if (v.totals.patientBalance <= 0.004 && !s.ar[id]) continue;
    const p = his.patients.find((x) => x.id === inv.patientId);
    rows.push({ kind: "Patient", ref: `INV-${inv.number}`, visit: inv.visit, patientName: patientName(p), mrn: p?.mrn ?? "", payer: "Self Pay", agingStart: inv.finalizedAt.slice(0, 10), outstanding: round2(Math.max(0, v.totals.patientBalance)) });
  }
  for (const d of s.patientDebts) rows.push({ kind: "Patient", ref: d.ref, patientName: d.patientName, mrn: d.mrn, payer: "Self Pay", agingStart: d.since, outstanding: d.amount });
  return rows.map((r) => {
    const id = `AR-${r.claimKey ?? r.ref}`;
    const o = s.ar[id];
    const days = ageDays(r.agingStart, today);
    const status: ArStatus = (o?.status as ArStatus | undefined) ?? "Open";
    const live = status !== "Closed" && r.outstanding > 0.004;
    return {
      ...r, id, days, bucket: bucketOf(days), priority: priorityOf(days, r.outstanding), status, assignee: o?.assignee, stage: o?.stage, level: o?.level ?? 0,
      nextFollowUp: o?.nextFollowUp, lastFollowUp: o?.lastFollowUp, promise: o?.promise,
      followUpOverdue: live && !!o?.nextFollowUp && o.nextFollowUp < todayIso,
      promiseOverdue: live && !!o?.promise && o.promise.date < todayIso,
      notes: o?.notes ?? [], history: o?.history ?? [],
    };
  }).sort((a, b) => b.days - a.days);
}

/* ---------- payment notices ---------- */

export type NoticeStatus = "Received" | "Partly Adjusted" | "Adjusted" | "Notice Sent";
export interface NoticeView extends PaymentNotice { allocated: number; remaining: number; status: NoticeStatus }

export function noticeView(n: PaymentNotice): NoticeView {
  const allocated = sum(n.allocations.map((a) => a.amount));
  const remaining = round2(n.amount - allocated);
  const status: NoticeStatus = n.notice ? "Notice Sent" : allocated <= 0.004 ? "Received" : remaining > 0.004 ? "Partly Adjusted" : "Adjusted";
  return { ...n, allocated, remaining, status };
}

/** Payment advices recorded in NPHIES Financial for live claims that no notice here has adjusted. */
export function nphiesNotices(s: RcmState = store.get(), fin = getFinancial()): PaymentNotice[] {
  const adjusted = new Set(s.notices.flatMap((n) => n.allocations.map((a) => a.claimKey)));
  const his = getState();
  const out: PaymentNotice[] = [];
  for (const c of fin.cases) {
    const pay = c.payment;
    if (!pay || adjusted.has(c.visit)) continue;
    const enc = his.encounters.find((e) => e.visitNumber === c.visit);
    const p = enc && his.patients.find((x) => x.id === enc.patientId);
    const payer = (p && insuredPayer(p)) ?? "";
    const at = pay.at;
    out.push({
      id: pay.batch, payer, amount: pay.amount, date: at.slice(0, 10), reference: pay.ref, createdAt: at, by: "NPHIES", fromNphies: true,
      allocations: [{ claimKey: c.visit, claimNumber: c.claim?.claimNumber ?? c.visit, amount: pay.amount, at, by: "NPHIES" }],
      notice: pay.status === "notice-sent" ? { status: "Paid", at, by: "NPHIES" } : undefined,
    });
  }
  return out;
}

export function allNotices(s: RcmState = store.get(), fin = getFinancial()): NoticeView[] {
  return [...nphiesNotices(s, fin), ...s.notices].map(noticeView).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Checks an Adjust To Claim entry: amounts above zero, each no more than the claim still owes, the claims of the same
 * payer, the total no more than the notice has left, and a live claim taken in full.
 */
export function validateAllocation(n: NoticeView, claims: RcmClaim[], amounts: Record<string, number>): { errors: string[]; total: number; remaining: number } {
  const errors: string[] = [];
  let total = 0;
  for (const [key, raw] of Object.entries(amounts)) {
    const a = round2(Number(raw) || 0);
    if (a === 0) continue;
    const c = claims.find((x) => x.key === key);
    if (!c) { errors.push("A claim in the list was not found."); continue; }
    if (a < 0) { errors.push(`${c.claimNumber}: the amount cannot be below zero.`); continue; }
    if (c.payer !== n.payer) errors.push(`${c.claimNumber} belongs to ${c.payer}, not ${n.payer}.`);
    if (a > c.outstanding + 0.004) errors.push(`${c.claimNumber}: ${a.toFixed(2)} SAR is more than the ${c.outstanding.toFixed(2)} SAR it still owes.`);
    else if (c.live && Math.abs(a - c.outstanding) > 0.004) errors.push(`${c.claimNumber} was sent from this system and is paid in full by one payment advice. Adjust ${c.outstanding.toFixed(2)} SAR.`);
    total = round2(total + a);
  }
  if (!errors.length && total <= 0) errors.push("Enter an amount for at least one claim.");
  if (total > n.remaining + 0.004) errors.push(`The total ${total.toFixed(2)} SAR is more than the ${n.remaining.toFixed(2)} SAR left on this payment.`);
  return { errors, total, remaining: round2(n.remaining - total) };
}

/** Fills the payer's claims oldest first until the money runs out. Live claims are skipped when they do not fit whole. */
export function fillInOrder(n: NoticeView, claims: RcmClaim[]): Record<string, number> {
  let left = n.remaining;
  const out: Record<string, number> = {};
  for (const c of [...claims].filter((x) => x.payer === n.payer && x.outstanding > 0.004).sort((a, b) => a.submittedOn.localeCompare(b.submittedOn))) {
    if (left <= 0.004) break;
    if (c.live && c.outstanding > left + 0.004) continue;
    const put = round2(Math.min(left, c.outstanding));
    out[c.key] = put;
    left = round2(left - put);
  }
  return out;
}

/* ---------- actions ---------- */

export type Res = { ok: true; id?: string } | { ok: false; errors: string[] };

const who = () => { try { return currentUser().name; } catch { return "Unknown"; } };
const nowIso = () => new Date().toISOString();

function guard(target: string): Res | null {
  if (can("billing")) return null;
  audit("denied", target, { detail: "Needs billing" });
  return { ok: false, errors: ["Your role cannot do this. It needs the billing permission."] };
}

type Kind = "rejections" | "denials" | "fwa" | "ar";
const KIND_WORD: Record<Kind, string> = { rejections: "Rejection case", denials: "Denial case", fwa: "FWA case", ar: "AR case" };

function patchCase<O extends CaseOverlay>(kind: Kind, id: string, fn: (o: O) => O, s: RcmState = store.get()): RcmState {
  const map = s[kind] as Record<string, O>;
  const cur = (map[id] ?? { notes: [], history: [] }) as O;
  const next = { ...s, [kind]: { ...map, [id]: fn({ ...cur, notes: [...(cur.notes ?? [])], history: [...(cur.history ?? [])] }) } } as RcmState;
  store.set(next);
  return next;
}

function log(kind: Kind, id: string, detail: string, patient?: string) {
  audit("update", `${KIND_WORD[kind]} ${id}`, { patient, detail });
}

export interface NoteInput { text: string; medium?: string; outcome?: string; person?: string; reference?: string; followUp?: string }

/** Claim Notes: one contact with the payer, or a plain note. Notes is required; a ticked follow-up needs its date. */
export function addNote(kind: Kind, id: string, input: NoteInput, patient?: string): Res {
  const no = guard(`${KIND_WORD[kind]} ${id}`);
  if (no) return no;
  const errors: string[] = [];
  const text = input.text.trim();
  if (text.length < 3) errors.push("Type the note.");
  if (input.medium && !CONTACT_MEDIUMS.includes(input.medium)) errors.push("Choose the contact medium from the list.");
  if (input.medium && !input.outcome) errors.push("Choose the contact outcome.");
  if (input.followUp !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.followUp)) errors.push("Choose the follow-up date.");
  if (errors.length) return { ok: false, errors };
  const s = store.get();
  const seq = s.seq + 1;
  store.set({ ...s, seq });
  patchCase(kind, id, (o) => ({ ...o, notes: [...o.notes, { id: `N-${seq}`, at: nowIso(), by: who(), text, medium: input.medium || undefined, outcome: input.outcome || undefined, person: input.person?.trim() || undefined, reference: input.reference?.trim() || undefined, followUp: input.followUp }] }));
  log(kind, id, `Note added${input.medium ? ` (${input.medium}, ${input.outcome})` : ""}`, patient);
  return { ok: true };
}

function move<S extends string>(kind: Kind, flow: Record<S, S[]>, id: string, from: S, to: S, action: string, note: string, patient?: string, extra: (o: CaseOverlay) => Partial<CaseOverlay> = () => ({})): Res {
  const no = guard(`${KIND_WORD[kind]} ${id}`);
  if (no) return no;
  if (!canMove(flow, from, to)) return { ok: false, errors: [`A case that is ${from} cannot move to ${to}.`] };
  const text = note.trim();
  if (text.length < 3) return { ok: false, errors: ["Type a note that says what was done."] };
  patchCase(kind, id, (o) => ({ ...o, ...extra(o), status: to, history: [...o.history, { at: nowIso(), by: who(), action, from, to, note: text }] }));
  log(kind, id, `${action}: ${from} to ${to}. ${text}`, patient);
  return { ok: true };
}

/* Rejections */

export function moveRejection(c: RejectionCase, to: RejectionStatus, note: string, action = to === "Closed" ? "Close" : to === "Open" ? "Reopen" : to === "In Review" ? "Start Review" : to): Res {
  return move("rejections", REJECTION_FLOW, c.id, c.status, to, action, note, c.claim.patientName);
}

/** Correct a ledger claim: what was changed for each error. A live claim is corrected on the claim page. */
export function correctRejection(c: RejectionCase, fixes: Record<string, string>, note: string): Res {
  const clean = Object.fromEntries(Object.entries(fixes).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  if (!c.claim.live && Object.keys(clean).length < c.errors.length) return { ok: false, errors: ["Say what you changed for each error."] };
  const r = move("rejections", REJECTION_FLOW, c.id, c.status, "Corrected", "Correct", note || "Corrected the claim.", c.claim.patientName, (o) => ({ fixes: { ...((o as RejectionOverlay).fixes ?? {}), ...clean } } as Partial<CaseOverlay>));
  return r;
}

/** Opening the claim to fix it puts an open case in review, so the team sees someone has it. */
export function startCorrection(c: RejectionCase): Res {
  if (c.status !== "Open") return { ok: true };
  return move("rejections", REJECTION_FLOW, c.id, "Open", "In Review", "Start Review", "Opened the claim to correct it.", c.claim.patientName, () => ({ assignee: who() }));
}

/**
 * Resubmit. A live claim goes through the claim review and NPHIES Financial (sendFromClaim); a ledger claim goes back to
 * Submitted and waits for the payer's answer (Manual Responses).
 */
export function resubmitRejection(c: RejectionCase, note: string): Res {
  const no = guard(`${KIND_WORD.rejections} ${c.id}`);
  if (no) return no;
  if (!canMove(REJECTION_FLOW, c.status, "Resubmitted")) return { ok: false, errors: [`A case that is ${c.status} cannot be resubmitted. Correct it first.`] };
  if (c.claim.live) {
    const r = sendFromClaim(c.claim.visit!, "claim");
    if (!r.ok) return { ok: false, errors: r.problems };
  } else {
    const s = store.get();
    store.set({ ...s, claims: s.claims.map((x) => (x.claimNumber === c.claim.claimNumber ? { ...x, state: "Submitted", answeredOn: undefined, errors: [], submittedOn: dayOf(new Date()) } : x)) });
  }
  return move("rejections", REJECTION_FLOW, c.id, c.status, "Resubmitted", "Resubmit", note || "Sent the corrected claim to the payer.", c.claim.patientName);
}

/* Denials */

export interface AppealInput { seqs: number[]; reason: string; attachments: string[] }

/** Appeal: a new claim linked to the denied one, for the chosen denied lines, with the reason and the attachment names. */
export function appealDenial(c: DenialCase, input: AppealInput): Res {
  const no = guard(`${KIND_WORD.denials} ${c.id}`);
  if (no) return no;
  const errors: string[] = [];
  if (c.status !== "Open") errors.push("Only open cases can be appealed.");
  const lines = c.deniedLines.filter((l) => input.seqs.includes(l.seq));
  if (!lines.length) errors.push("Choose at least one denied line to appeal.");
  if (input.reason.trim().length < 10) errors.push("Type why the payer should pay (at least 10 characters).");
  if (errors.length) return { ok: false, errors };
  const s = store.get();
  const base = c.claim.claimNumber;
  const n = s.claims.filter((x) => x.appealOf === base).length + 1;
  const claimNumber = `${base}-AP${n}`;
  const src = s.claims.find((x) => x.claimNumber === base);
  const appeal: LedgerClaim = {
    claimNumber, patientName: c.claim.patientName, mrn: c.claim.mrn, nationalId: src?.nationalId, payer: c.claim.payer, type: c.claim.type,
    serviceDate: c.claim.serviceDate, submittedOn: dayOf(new Date()), diagnosis: src?.diagnosis ?? "", state: "Submitted", appealOf: base, source: "appeal",
    lines: lines.map((l, i) => ({ seq: i + 1, code: l.code, text: l.text, claimed: l.denied })),
  };
  store.set({ ...s, claims: [...s.claims, appeal] });
  const attachments = input.attachments.map((a) => a.trim()).filter(Boolean);
  const r = move("denials", DENIAL_FLOW, c.id, c.status, "Appealed", "Appeal", input.reason, c.claim.patientName, () => ({ appeal: { claimNumber, reason: input.reason.trim(), attachments, seqs: lines.map((l) => l.seq), at: nowIso(), by: who() } } as Partial<CaseOverlay>));
  return r.ok ? { ok: true, id: claimNumber } : r;
}

/** Write Off asks for approval; nothing is written off until a second person approves. */
export function requestWriteOff(c: DenialCase, reason: string): Res {
  const no = guard(`${KIND_WORD.denials} ${c.id}`);
  if (no) return no;
  if (c.status === "Closed") return { ok: false, errors: ["This case is closed."] };
  if (c.writeOff?.status === "Pending") return { ok: false, errors: ["A write-off is already waiting for approval."] };
  if (c.open <= 0.004) return { ok: false, errors: ["Nothing is left to write off."] };
  if (reason.trim().length < 5) return { ok: false, errors: ["Type why this money should be written off."] };
  patchCase("denials", c.id, (o) => ({ ...o, writeOff: { status: "Pending", amount: c.open, reason: reason.trim(), by: who(), at: nowIso() }, history: [...o.history, { at: nowIso(), by: who(), action: "Request Write Off", note: reason.trim() }] }) as DenialOverlay);
  log("denials", c.id, `Write-off of ${c.open.toFixed(2)} SAR requested. ${reason.trim()}`, c.claim.patientName);
  return { ok: true };
}

export function decideWriteOff(c: DenialCase, approve: boolean, note: string): Res {
  const no = guard(`${KIND_WORD.denials} ${c.id}`);
  if (no) return no;
  const w = c.writeOff;
  if (!w || w.status !== "Pending") return { ok: false, errors: ["No write-off is waiting for approval."] };
  if (w.by === who()) return { ok: false, errors: ["The person who asked for the write-off cannot approve it. Ask another billing officer or a manager."] };
  if (note.trim().length < 3) return { ok: false, errors: ["Type a note for the decision."] };
  const to: DenialStatus = approve ? "Closed" : c.status;
  patchCase("denials", c.id, (o) => ({
    ...o, status: to, writeOff: { ...w, status: approve ? "Approved" : "Declined", decidedBy: who(), decidedAt: nowIso() },
    history: [...o.history, { at: nowIso(), by: who(), action: approve ? "Approve Write Off" : "Decline Write Off", from: c.status, to, note: note.trim() }],
  }) as DenialOverlay);
  log("denials", c.id, `${approve ? "Approved" : "Declined"} the write-off of ${w.amount.toFixed(2)} SAR. ${note.trim()}`, c.claim.patientName);
  return { ok: true };
}

/** The denied money becomes the patient's to pay: it appears in AR Management as patient AR. */
export function moveToPatient(c: DenialCase, note: string): Res {
  const no = guard(`${KIND_WORD.denials} ${c.id}`);
  if (no) return no;
  if (c.status !== "Open" && c.status !== "Appealed") return { ok: false, errors: [`A case that is ${c.status} cannot be moved to the patient.`] };
  if (c.open <= 0.004) return { ok: false, errors: ["Nothing is left to move to the patient."] };
  if (c.writeOff?.status === "Pending") return { ok: false, errors: ["A write-off is waiting for approval. Decide it first."] };
  const amount = c.open;
  const r = move("denials", DENIAL_FLOW, c.id, c.status, "Resolved", "Move To Patient Responsibility", note, c.claim.patientName, () => ({ movedToPatient: { amount, at: nowIso(), by: who() } } as Partial<CaseOverlay>));
  if (!r.ok) return r;
  const s = store.get();
  store.set({ ...s, patientDebts: [...s.patientDebts, { ref: `PR-${c.claim.claimNumber}`, patientName: c.claim.patientName, mrn: c.claim.mrn, amount, since: dayOf(new Date()), from: c.id }] });
  return { ok: true };
}

export function moveDenial(c: DenialCase, to: DenialStatus, note: string): Res {
  return move("denials", DENIAL_FLOW, c.id, c.status, to, to === "Closed" ? "Close" : to === "Open" ? "Reopen" : to === "Resolved" ? "Resolve" : to, note, c.claim.patientName);
}

/* Manual responses: the payer's answer typed in by hand, for ledger claims (live claims answer through NPHIES). */

export interface ResponseInput {
  outcome: "Approved" | "Partly Approved" | "Rejected";
  date: string;
  lines?: { seq: number; approved: number; patientShare?: number; reason?: string }[];
  errors?: { code: string; seq?: number }[];
}

export function recordResponse(claimNumber: string, r: ResponseInput, today: Date = new Date()): Res {
  const no = guard(`Manual response ${claimNumber}`);
  if (no) return no;
  const s = store.get();
  const c = s.claims.find((x) => x.claimNumber === claimNumber);
  if (!c) return { ok: false, errors: ["Choose a claim that was not sent from this system."] };
  if (c.state !== "Submitted") return { ok: false, errors: ["This claim already has the payer's answer."] };
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push("Choose the response date.");
  else if (r.date > dayOf(today)) errors.push("The response date cannot be in the future.");
  else if (r.date < c.submittedOn) errors.push("The response date is before the claim was sent.");
  let lines = c.lines;
  if (r.outcome === "Rejected") {
    if (!r.errors?.length) errors.push("Add at least one error code.");
    for (const e of r.errors ?? []) if (!REJECTION_CODES[e.code]) errors.push(`${e.code} is not in the error code list.`);
  } else {
    lines = c.lines.map((l) => {
      const a = r.lines?.find((x) => x.seq === l.seq);
      const approved = round2(Number(a?.approved ?? l.claimed));
      const ps = round2(Number(a?.patientShare ?? 0));
      if (!Number.isFinite(approved) || approved < 0) errors.push(`Line ${l.seq}: the approved amount cannot be below zero.`);
      if (approved + ps > l.claimed + 0.004) errors.push(`Line ${l.seq}: approved plus patient share is more than the ${l.claimed.toFixed(2)} SAR claimed.`);
      const short = l.claimed - approved - ps > 0.004;
      if (short && !a?.reason) errors.push(`Line ${l.seq}: choose why the payer did not pay all of it.`);
      return { ...l, approved, patientShare: ps, reason: short ? a?.reason : undefined };
    });
    const anyShort = lines.some((l) => l.claimed - (l.approved ?? 0) - (l.patientShare ?? 0) > 0.004);
    if (!errors.length && r.outcome === "Approved" && anyShort) errors.push("Some lines are approved for less than claimed. Choose Partly Approved.");
    if (!errors.length && r.outcome === "Partly Approved" && !anyShort) errors.push("Every line is approved in full. Choose Approved.");
  }
  if (errors.length) return { ok: false, errors };
  const allZero = lines.every((l) => (l.approved ?? 0) <= 0.004);
  const state: ClaimState = r.outcome === "Rejected" ? "Rejected" : allZero ? "Denied" : r.outcome;
  store.set({ ...s, claims: s.claims.map((x) => (x.claimNumber === claimNumber ? { ...x, state, answeredOn: r.date, lines, errors: r.outcome === "Rejected" ? r.errors!.map((e) => ({ code: e.code, scope: e.seq ? "Item" as const : "Claim" as const, seq: e.seq })) : [] } : x)) });
  // An answer to a rejected claim sent again reopens its case if the payer rejected it again.
  const rj = s.rejections[`RJ-${claimNumber}`];
  if (rj && state === "Rejected") patchCase("rejections", `RJ-${claimNumber}`, (o) => ({ ...o, status: "Open", history: [...o.history, { at: nowIso(), by: who(), action: "Payer Rejected Again", from: o.status, to: "Open" }] }));
  // The answer to an appeal resolves its denial case.
  if (c.appealOf) {
    const id = `DN-${c.appealOf}`;
    if (store.get().denials[id]?.status === "Appealed") patchCase("denials", id, (o) => ({ ...o, status: "Resolved", history: [...o.history, { at: nowIso(), by: who(), action: "Appeal Answered", from: "Appealed", to: "Resolved", note: `Payer answer: ${state}.` }] }));
  }
  audit("update", `Manual response ${claimNumber}`, { patient: c.patientName, detail: `Payer answer recorded: ${state}` });
  return { ok: true };
}

/* FWA */

export function assignFwa(c: FwaCase, reviewer: string, note: string): Res {
  const no = guard(`${KIND_WORD.fwa} ${c.id}`);
  if (no) return no;
  if (!FWA_REVIEWERS.includes(reviewer)) return { ok: false, errors: ["Choose a reviewer from the list."] };
  if (note.trim().length < 3) return { ok: false, errors: ["Type a note for the reviewer."] };
  patchCase("fwa", c.id, (o) => ({ ...o, assignee: reviewer, history: [...o.history, { at: nowIso(), by: who(), action: "Assign Reviewer", note: `${reviewer}. ${note.trim()}` }] }));
  log("fwa", c.id, `Reviewer ${reviewer}`, c.patientName);
  return { ok: true };
}

export function moveFwa(c: FwaCase, to: FwaStatus, note: string, outcome?: string): Res {
  if (to === "Closed" && (!outcome || !FWA_OUTCOMES.includes(outcome))) return { ok: false, errors: ["Choose the outcome of the review."] };
  if (to === "In Review" && !c.reviewer) return { ok: false, errors: ["Assign a reviewer first."] };
  return move("fwa", FWA_FLOW, c.id, c.status, to, to === "Closed" ? `Close: ${outcome}` : to === "Open" ? "Reopen" : "Start Review", note, c.patientName,
    () => ({ outcome: to === "Closed" ? outcome : undefined }) as Partial<CaseOverlay>);
}

/* AR */

export type ArAction = "in-review" | "follow-up" | "promise" | "assign" | "escalate" | "close" | "reopen";
export const AR_ACTION_LABEL: Record<ArAction, string> = {
  "in-review": "In Review", "follow-up": "Record Follow-Up", promise: "Promise To Pay", assign: "Assign Collector", escalate: "Escalate", close: "Close Case", reopen: "Reopen Case",
};
export interface ArInput { notes: string; date?: string; amount?: number; collector?: string; level?: number; stage?: string }

/** The HIS Manage Workflow dialog. Notes are required for every action; dates cannot be in the past. */
export function validateArAction(c: Pick<ArCase, "status" | "outstanding" | "level" | "assignee">, action: ArAction, i: ArInput, today: Date = new Date()): string[] {
  const errors: string[] = [];
  const t = dayOf(today);
  const to: ArStatus | null = action === "in-review" ? "In Review" : action === "follow-up" ? "Follow Up" : action === "close" ? "Closed" : action === "reopen" ? "Open" : null;
  if (to && !canMove(AR_FLOW, c.status, to)) errors.push(`A case that is ${c.status} cannot move to ${to}.`);
  if (!to && c.status === "Closed") errors.push("This case is closed. Reopen it first.");
  if (action === "follow-up") {
    if (!i.date) errors.push("Next follow-up date is required.");
    else if (i.date < t) errors.push("Next follow-up date cannot be in the past.");
  }
  if (action === "promise") {
    const a = Number(i.amount);
    if (!Number.isFinite(a) || a <= 0) errors.push("Promise to pay amount must be greater than zero.");
    else if (a > c.outstanding + 0.004) errors.push(`Promise to pay amount cannot be more than the ${c.outstanding.toFixed(2)} SAR outstanding.`);
    if (!i.date) errors.push("Promise to pay date is required.");
    else if (i.date < t) errors.push("Promise to pay date cannot be in the past.");
  }
  if (action === "assign") {
    if (!i.collector || !COLLECTORS.includes(i.collector)) errors.push("Choose a collector.");
    else if (i.collector === c.assignee) errors.push(`${i.collector} already has this case.`);
  }
  if (action === "escalate") {
    const l = Number(i.level);
    if (!Number.isInteger(l) || l < 0 || l > 3) errors.push("Choose an escalation level from 0 to 3.");
    else if (l === c.level) errors.push(`The case is already at ${ESCALATION_LEVELS[l]}.`);
  }
  if (i.stage && !COLLECTION_STAGES.includes(i.stage)) errors.push("Choose a collection stage from the list.");
  if (!i.notes.trim()) errors.push("Action notes are required.");
  return errors;
}

export function arAction(c: ArCase, action: ArAction, i: ArInput, today: Date = new Date()): Res {
  const no = guard(`${KIND_WORD.ar} ${c.id}`);
  if (no) return no;
  const errors = validateArAction(c, action, i, today);
  if (errors.length) return { ok: false, errors };
  const to: ArStatus = action === "in-review" ? "In Review" : action === "follow-up" ? "Follow Up" : action === "close" ? "Closed" : action === "reopen" ? "Open" : c.status;
  const label = AR_ACTION_LABEL[action];
  patchCase<ArOverlay>("ar", c.id, (o) => ({
    ...o, status: to,
    stage: i.stage || o.stage,
    assignee: action === "assign" ? i.collector : o.assignee,
    level: action === "escalate" ? Number(i.level) : o.level,
    nextFollowUp: action === "follow-up" ? i.date : action === "close" ? undefined : o.nextFollowUp,
    lastFollowUp: action === "follow-up" ? dayOf(today) : o.lastFollowUp,
    promise: action === "promise" ? { date: i.date!, amount: round2(Number(i.amount)) } : action === "close" ? undefined : o.promise,
    history: [...o.history, {
      at: nowIso(), by: who(), action: label, from: c.status, to,
      note: [i.notes.trim(), action === "assign" && `Collector ${i.collector}`, action === "escalate" && ESCALATION_LEVELS[Number(i.level)], action === "promise" && `${round2(Number(i.amount)).toFixed(2)} SAR by ${i.date}`, action === "follow-up" && `Next follow-up ${i.date}`, i.stage && `Stage ${i.stage}`].filter(Boolean).join(". "),
    }],
  }));
  log("ar", c.id, `${label}. ${i.notes.trim()}`, c.patientName);
  return { ok: true };
}

/* Payment reconciliation */

/**
 * Adjust To Claim: places the notice money on claims. A live claim's payment is recorded through NPHIES Financial
 * (runFinancial poll-payment), so the visit invoice's insurance balance drops by the same amount.
 */
export function adjustToClaims(noticeId: string, amounts: Record<string, number>, claims: RcmClaim[] = allClaims()): Res {
  const no = guard(`Payment notice ${noticeId}`);
  if (no) return no;
  const s = store.get();
  const raw = s.notices.find((n) => n.id === noticeId);
  if (!raw) return { ok: false, errors: ["This payment was recorded in NPHIES Financial and is already adjusted to its claim."] };
  if (raw.manual && !raw.manual.active) return { ok: false, errors: ["This manual payment is not active."] };
  const n = noticeView(raw);
  if (n.status === "Notice Sent") return { ok: false, errors: ["The payment notice was already sent. Nothing more can be adjusted."] };
  const v = validateAllocation(n, claims, amounts);
  if (v.errors.length) return { ok: false, errors: v.errors };
  const at = nowIso();
  const added: Allocation[] = [];
  for (const [key, rawAmt] of Object.entries(amounts)) {
    const a = round2(Number(rawAmt) || 0);
    if (a <= 0) continue;
    const c = claims.find((x) => x.key === key)!;
    if (c.live) {
      const before = caseOf(c.visit!).payment;
      if (!before && !runFinancial(c.visit!, "poll-payment")) return { ok: false, errors: [`NPHIES Financial did not record the payment for ${c.claimNumber}.`] };
    }
    added.push({ claimKey: key, claimNumber: c.claimNumber, amount: a, at, by: who() });
  }
  const now = store.get();
  store.set({ ...now, notices: now.notices.map((x) => (x.id === noticeId ? { ...x, allocations: [...x.allocations, ...added] } : x)) });
  audit("update", `Payment notice ${noticeId}`, { detail: `${v.total.toFixed(2)} SAR adjusted to ${added.length} claim(s). ${v.remaining.toFixed(2)} SAR left.` });
  return { ok: true };
}

/** Generate Payment Notice: tells the payer the money arrived. Live claims send their notice through NPHIES Financial. */
export function generatePaymentNotice(noticeId: string, status: "Paid" | "Cleared"): Res {
  const no = guard(`Payment notice ${noticeId}`);
  if (no) return no;
  const s = store.get();
  const fin = getFinancial();
  const n = allNotices(s, fin).find((x) => x.id === noticeId);
  if (!n) return { ok: false, errors: ["This payment was not found."] };
  if (n.status === "Notice Sent") return { ok: false, errors: ["The payment notice was already sent."] };
  if (n.remaining > 0.004) return { ok: false, errors: [`${n.remaining.toFixed(2)} SAR is not adjusted to a claim yet. Adjust all of it first.`] };
  const his = getState();
  for (const a of n.allocations) {
    if (!his.encounters.some((e) => e.visitNumber === a.claimKey)) continue;
    if (caseOf(a.claimKey, fin).payment?.status === "reconciliation-received" && !runFinancial(a.claimKey, "confirm-payment")) return { ok: false, errors: [`NPHIES Financial did not send the notice for ${a.claimNumber}.`] };
  }
  if (!n.fromNphies) {
    const now = store.get();
    store.set({ ...now, notices: now.notices.map((x) => (x.id === noticeId ? { ...x, notice: { status, at: nowIso(), by: who() } } : x)) });
  }
  audit("send-fhir", `Payment notice ${noticeId}`, { detail: `${status}, ${n.amount.toFixed(2)} SAR for ${n.allocations.length} claim(s)` });
  return { ok: true };
}

export interface ManualPaymentInput { method: string; reference: string; date: string; payer: string; amount: number; writeOff?: number }

export function validateManualPayment(i: ManualPaymentInput, existing: PaymentNotice[], today: Date = new Date()): string[] {
  const errors: string[] = [];
  if (!PAY_METHODS.includes(i.method)) errors.push("Payment method is required.");
  const ref = i.reference.trim();
  if (!ref) errors.push("Reference number is required.");
  else if (ref.length > 100) errors.push("The reference number is longer than 100 characters.");
  else if (existing.some((n) => n.reference.toLowerCase() === ref.toLowerCase() && n.payer === i.payer)) errors.push(`Reference ${ref} is already recorded for ${i.payer}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) errors.push("Payment date is required.");
  else if (i.date > dayOf(today)) errors.push("The payment date cannot be in the future.");
  if (!RCM_PAYERS.includes(i.payer)) errors.push("Payer is required.");
  const a = Number(i.amount);
  if (!Number.isFinite(a) || a <= 0) errors.push("Payment amount must be greater than zero.");
  const w = Number(i.writeOff ?? 0);
  if (!Number.isFinite(w) || w < 0) errors.push("The discounted or write-off amount cannot be below zero.");
  return errors;
}

export function addManualPayment(i: ManualPaymentInput, today: Date = new Date()): Res {
  const no = guard("Manual payment");
  if (no) return no;
  const s = store.get();
  const errors = validateManualPayment(i, s.notices, today);
  if (errors.length) return { ok: false, errors };
  const seq = s.seq + 1;
  const id = `MP-${dayOf(today).slice(2, 4)}${dayOf(today).slice(5, 7)}-${String(seq).padStart(4, "0")}`;
  const n: PaymentNotice = { id, payer: i.payer, amount: round2(Number(i.amount)), date: i.date, reference: i.reference.trim(), allocations: [], createdAt: nowIso(), by: who(), manual: { method: i.method, writeOff: round2(Number(i.writeOff ?? 0)), active: true } };
  store.set({ ...s, seq, notices: [n, ...s.notices] });
  audit("create", `Manual payment ${id}`, { detail: `${i.payer}, ${n.amount.toFixed(2)} SAR by ${i.method}, reference ${n.reference}` });
  return { ok: true, id };
}

export function setManualPaymentActive(id: string, active: boolean): Res {
  const no = guard(`Manual payment ${id}`);
  if (no) return no;
  const s = store.get();
  const n = s.notices.find((x) => x.id === id);
  if (!n?.manual) return { ok: false, errors: ["This manual payment was not found."] };
  if (!active && n.allocations.length) return { ok: false, errors: ["Money from this payment is already adjusted to claims. It cannot be made inactive."] };
  store.set({ ...s, notices: s.notices.map((x) => (x.id === id ? { ...x, manual: { ...x.manual!, active } } : x)) });
  audit("update", `Manual payment ${id}`, { detail: active ? "Made active" : "Made inactive" });
  return { ok: true };
}

/* Claim import (see rcm-import.ts for reading the file) */

export interface ImportClaim { claimNumber: string; patientName: string; mrn: string; nationalId?: string; payer: string; type: string; serviceDate: string; diagnosis: string; serviceCode: string; serviceText: string; claimed: number; approved?: number; state: ClaimState }

export function saveImported(fileName: string, rows: { claim: ImportClaim; update: boolean }[], invalid: number, total: number): Res {
  const no = guard("Claim import");
  if (no) return no;
  if (!rows.length) return { ok: false, errors: ["Select at least one ready row."] };
  let s = store.get();
  let created = 0, updated = 0;
  const claims = [...s.claims];
  for (const { claim: c } of rows) {
    const answered = c.state !== "Submitted" && c.state !== "Rejected";
    const approved = answered ? (c.approved ?? (c.state === "Approved" ? c.claimed : 0)) : undefined;
    // A file has no patient share column: on an Approved claim the difference is the patient's share; on a partly approved
    // or denied claim it is denied, with no reason code until someone records it.
    const gap = approved === undefined ? 0 : round2(c.claimed - approved);
    const line: LedgerLine = { seq: 1, code: c.serviceCode, text: c.serviceText || c.serviceCode, claimed: c.claimed, approved, patientShare: c.state === "Approved" ? gap : 0 };
    const rec: LedgerClaim = {
      claimNumber: c.claimNumber, patientName: c.patientName, mrn: c.mrn, nationalId: c.nationalId, payer: c.payer, type: c.type, serviceDate: c.serviceDate,
      submittedOn: c.serviceDate, answeredOn: c.state !== "Submitted" ? c.serviceDate : undefined, diagnosis: c.diagnosis, state: c.state, lines: [line], source: "import", errors: [],
    };
    const i = claims.findIndex((x) => x.claimNumber === c.claimNumber);
    if (i >= 0) { claims[i] = { ...claims[i], ...rec, source: claims[i].source }; updated++; } else { claims.push(rec); created++; }
  }
  const seq = s.seq + 1;
  const batch: ImportBatch = { id: `IMP-${String(seq).padStart(3, "0")}`, fileName, at: nowIso(), by: who(), total, saved: rows.length, created, updated, invalid };
  s = { ...s, seq, claims, imports: [batch, ...s.imports] };
  store.set(s);
  audit("create", `Claim import ${batch.id}`, { detail: `${fileName}: ${created} new, ${updated} updated, ${invalid} invalid` });
  return { ok: true, id: batch.id };
}
