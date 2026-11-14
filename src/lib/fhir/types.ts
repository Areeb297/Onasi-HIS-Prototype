import type { Check } from "../model";
import type { Json, NphiesResponse } from "./common";
import type { Interp } from "./lab-catalog";

export type Priority = "routine" | "urgent" | "asap" | "stat";
export const PRIORITIES: { code: Priority; label: string }[] = [
  { code: "routine", label: "Routine" },
  { code: "urgent", label: "Urgent" },
  { code: "asap", label: "ASAP" },
  { code: "stat", label: "STAT" },
];

/** Composition status values the guide allows (FHIR R5 list, page ids 351797257 and 391020558). */
export type DocStatus = "final" | "amended" | "corrected" | "cancelled" | "entered-in-error";
/** Observation status values. Assumption: the "nphies FHIR Observation Status" value set is not in the snapshot. */
export type ObsStatus = "final" | "amended" | "corrected" | "cancelled" | "entered-in-error";

export type DocKind = "lab-order" | "lab-result" | "rad-order" | "rad-report";

/** One attempt to send a document to NPHIES, kept with the full JSON, the checks and the answer. */
export interface SendRecord {
  seq: number;
  kind: DocKind;
  /** Version of the document. Accepted amendments raise it. */
  version: number;
  docStatus: DocStatus;
  at: string;
  bundle: Json;
  checks: Check[];
  response: NphiesResponse;
}

export const lastAccepted = (sends: SendRecord[], kind: DocKind): SendRecord | undefined =>
  [...sends].reverse().find((s) => s.kind === kind && s.response.status === "accepted");

export const lastAttempt = (sends: SendRecord[], kind: DocKind): SendRecord | undefined =>
  [...sends].reverse().find((s) => s.kind === kind);

export const nextVersion = (sends: SendRecord[], kind: DocKind): number => (lastAccepted(sends, kind)?.version ?? 0) + 1;

/* ---------- laboratory ---------- */

export type LabStatus = "received" | "collected" | "in-progress" | "resulted" | "amended" | "cancelled";

export interface LabSpecimen {
  id: string;
  /** SpecimenKey from the catalogue. */
  key: "BLD" | "SER" | "PLS" | "URN" | "NPS";
  collectedAt: string;
  receivedAt?: string;
  collectedBy: string;
}

export interface LabResult {
  /** LOINC code of the test this result belongs to. */
  code: string;
  /** What the technologist typed. For microbiology it is the growth comment. */
  value: string;
  interp: Interp;
  status: ObsStatus;
  at: string;
  organism?: { code: string; display: string } | null;
  sens?: { key: string; result: "S" | "I" | "R" }[];
  note?: string;
  /** Who determined this value: provider-directory id and name. Sent as Observation.performer. */
  performedBy?: { id: string; name: string };
}

export interface LabOrder {
  /** Placer order number, for example LO-100001. */
  id: string;
  visitNumber: string;
  patientId: string;
  codes: string[];
  /**
   * Placer order number of each ordered test, by LOINC code. Given once when the test is ordered and never reused,
   * so removing or reordering tests in an amendment cannot move a number onto another test.
   */
  placers?: Record<string, string>;
  priority: Priority;
  /** null = not stated */
  fasting: boolean | null;
  note: string;
  orderedAt: string;
  orderedById: string;
  status: LabStatus;
  specimens: LabSpecimen[];
  results: Record<string, LabResult>;
  /** Tests, priority or note changed after the last accepted order send. */
  orderDirty: boolean;
  /** Results changed after the last accepted result send. */
  resultDirty: boolean;
  sends: SendRecord[];
  /** Sign-off trail. All optional, so orders saved before this was added still load. */
  /** Who sent the results for verification, and when. Cleared when the verifier sends them back. */
  enteredBy?: StaffStamp;
  submittedAt?: string;
  /** Who verified and released the results. */
  verifiedBy?: StaffStamp;
  verifiedAt?: string;
  /** Reason an administrator gave to verify a result they entered themselves. */
  verifyOverrideReason?: string;
  /** The last time a verifier returned the results to entry. */
  sentBack?: { by: string; at: string; reason: string };
  /** Critical result call-back: who was told, by whom, when, and that they read the value back. */
  criticalCall?: CriticalCall;
}

/** An app user at a point in time: user id (for the two-person rule) and the name to show. */
export interface StaffStamp {
  userId: string;
  name: string;
}

export interface CriticalCall {
  toldTo: string;
  toldBy: string;
  at: string;
  readBack: boolean;
}

/* ---------- radiology ---------- */

export type RadStatus = "received" | "performed" | "resulted" | "amended" | "cancelled";

export interface RadReport {
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  addendum: string;
  /** A critical finding that was called to the clinician. */
  critical: boolean;
  communicated: string;
  reportedAt: string;
  reportedById: string;
  /** Sign-off by the reporting radiologist. Optional, so reports saved before this was added still load. */
  signedAt?: string;
  /** Provider-directory id and name of the radiologist who signed. */
  signedBy?: { id: string; name: string };
  /** Notes added after signing. The signed text is never changed. `addendum` holds the same notes as one text for the message. */
  addenda?: { text: string; at: string; by: string }[];
}

export type PregnancyCheck = "not-pregnant" | "pregnant" | "unsure";

export interface RadStudy {
  studyUid: string;
  accession: string;
  performedStart: string;
  performedEnd: string;
  performedBy: string;
  /** Images exist in PACS. When false the report has no ImagingStudy and no Endpoint. */
  images: boolean;
  series: number;
  instances: number;
  /** Technologist record. Optional, so studies saved before this was added still load. */
  machine?: string;
  contrastGiven?: boolean;
  /** Amount of contrast given, for example "80 mL". */
  contrastAmount?: string;
  /** Asked of women aged 12 to 55 before the exam. */
  pregnancy?: PregnancyCheck;
  pregnancyNote?: string;
}

export interface RadOrder {
  /** Placer order number, for example RO-200001. */
  id: string;
  visitNumber: string;
  patientId: string;
  procCode: string;
  priority: Priority;
  /** Reason for the exam (procedure indication). */
  indication: string;
  /** Short clinical history. */
  clinicalInfo: string;
  orderedAt: string;
  orderedById: string;
  status: RadStatus;
  study?: RadStudy;
  report?: RadReport;
  orderDirty: boolean;
  reportDirty: boolean;
  sends: SendRecord[];
}
