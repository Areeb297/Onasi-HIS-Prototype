import type { EventId, SegId } from "./spec";

/** PV1-2, from CS-Adm-PatientClass. A pre-admission is a visit status, not a class. */
export type PatientClass = "I" | "O" | "E";
export type EncounterStatus = "preadmit" | "active" | "discharged" | "cancelled";

/** Registration details kept by the HIS. Most are not sent in ADT messages. */
export interface PatientExtra {
  secondName?: string;
  thirdName?: string;
  nameAr?: { first: string; second: string; third: string; family: string };
  religion?: string;
  bloodGroup?: string;
  fileStatus?: string;
  socialStatus?: string;
  placeOfBirth?: string;
  occupation?: string;
  employeeNo?: string;
  idType?: string;
  idNumber?: string;
  idIssuer?: string;
  idIssueDate?: string;
  idExpiry?: string;
  idCopyNo?: string;
  addressType?: string;
  addressText?: string;
  homePhone?: string;
  mobile?: string;
  otherPhone?: string;
  countryCode?: string;
  areaCode?: string;
  relationName?: string;
  relationPhone?: string;
  email?: string;
  mainFileNo?: string;
  registrationNo?: string;
  visitPayType?: "Cash" | "Insurance";
  insurance?: {
    payer: string; policyNo: string; memberId: string; className: string; network: string;
    startDate: string; expiryDate: string; copayPercent: number; status: "Active" | "Expired";
  };
  /** Cards saved to the patient file with the Archive buttons. */
  archive?: { kind: "Insurance card" | "ID card"; at: string; summary: string }[];
  /** Safety flags set at registration. Shown as badges in the patient banner. HIS only. */
  flags?: PatientFlags;
  /** What the clerk chose when the insurance did not cover the visit, in words. HIS only. */
  coverageDecision?: string;
}

/** Safety flags on the patient file. All optional, so older saved patients still load. */
export interface PatientFlags {
  /** Do Not Resuscitate. Needs the doctor who ordered it and the date of the order. */
  dnr?: { doctor: string; date: string };
  /** The patient needs an interpreter in this language. */
  interpreter?: { language: string };
  fallRisk?: boolean;
  isolation?: boolean;
}

export interface Patient {
  id: string;
  mrn: string;
  nationalId: string;
  family: string;
  given: string;
  /** YYYY-MM-DD */
  dob: string;
  sex: "M" | "F";
  /** NHIC Health ID. nphies needs it in PID-3. Made-up values only. */
  healthId: string;
  /** Country code for PID-28, from CS-Adm-Country (ISO 3166 alpha-3, 999 = unknown). */
  nationality: string;
  /** PID-16, from CS-Adm-MaritalStatus. S single, M married, D divorced, W widowed, A separated, U unknown. */
  maritalStatus: string;
  /** PID-11. Saudi Post short address, AAAANNNN. */
  address: string;
  /** Restricted record. Opening it needs break-the-glass. */
  confidential?: boolean;
  /** Consent to process and share the record. ISO time when given. */
  consentAt?: string;
  extra?: PatientExtra;
}

export interface Doctor {
  id: string;
  family: string;
  given: string;
  service: string;
}

export interface Bed {
  id: string;
  ward: string;
  wardName: string;
  room: string;
  bed: string;
}

export interface Dx {
  code: string;
  text: string;
  /** A = admitting, W = working, F = final */
  type: "A" | "W" | "F";
  /** When the diagnosis was made. Local date-time. DG1-5. */
  at?: string;
  /** ZDG1-3 condition onset flag (CS-Clinical-ConditionOnsetFlag: 1, 2 or 9). Inpatients only. */
  onset?: "1" | "2" | "9";
}

export interface Pr {
  code: string;
  text: string;
  /** When the procedure started. Local date-time. PR1-5 (required). */
  at?: string;
  /** When the procedure ended. Local date-time. ZPR1-3. */
  endAt?: string;
  /** Code list the code comes from. Decides the coding system OID in PR1-3. ACHI when empty. */
  system?: "ACHI" | "ADA" | "IMG";
  /** PR1-6 functional type: A anesthesia, D diagnostic, I invasive (other), P treatment. */
  type?: "A" | "D" | "I" | "P";
  /** Doctor id. PR1-11. */
  surgeon?: string;
}

export interface Allergy {
  text: string;
  severity: "SV" | "MO" | "MI";
  reaction: string;
  /** AL1-2, from CS-Allergy-Type: DALG drug, FALG food, ALG other. Drug when empty. */
  type?: "DALG" | "FALG" | "ALG";
  /** SNOMED CT code of the allergen for AL1-3. Empty means free text only. */
  code?: string;
}

export interface Complaint {
  code: string;
  text: string;
}

export interface Vitals {
  /** Height in cm. Needed for the NPHIES prescription bundle. */
  height?: string;
  bp: string;
  pulse: string;
  temp: string;
  spo2: string;
  rr: string;
  weight: string;
  at: string;
}

export interface Note {
  at: string;
  author: string;
  text: string;
}

export type CtasLevel = 1 | 2 | 3 | 4 | 5;

/** Emergency department data. Feeds ZPV1.17 to ZPV1.22 of the CNHI discharge update (A08). */
export interface EdData {
  /** ZPV1.17. Local date-time. */
  arrivalAt: string;
  /**
   * ZPV1.18. The names from "Other" on are the published CS-Adm-EDArrivalMode list.
   * "Walk-in", "Ambulance", "Referral" and "Police" are HIS values kept so saved records still open.
   */
  arrivalMode:
    | "Walk-in" | "Ambulance" | "Referral" | "Police" | "Other"
    | "Ground EMS Ambulance" | "Ground MOH Ambulance" | "Ground Civil Defense Ambulance" | "Ground Military Ambulance"
    | "Ground Private Ambulance" | "EMS Air Ambulance" | "Air Civil Defense Ambulance" | "Air Military Ambulance"
    | "Police Vehicle" | "Other Government Vehicles" | "Personal Vehicle" | "Not Stated";
  /** ZPV1.21 */
  triageAt?: string;
  /** ZPV1.22. CTAS level 1 to 5. */
  ctas?: CtasLevel;
  /** Which modifier set the level, in words. HIS only. */
  ctasWhy?: string;
  /** Written reason when the nurse chose a less urgent level than the modifiers give. HIS only. */
  ctasOverride?: string;
  /** Every triage and re-triage, newest last. HIS only. */
  triageLog?: { at: string; ctas: CtasLevel; by: string; note?: string }[];
  /** Last time the nurse re-assessed the waiting patient. HIS only. */
  reassessedAt?: string;
  /** Registered with minimal details because the patient could not give them. The details are completed later. */
  temporaryId?: boolean;
  triageNurse?: string;
  complaint?: string;
  gcs?: number;
  pain?: number;
  area?: "Triage" | "Resus" | "Acute" | "Fast Track" | "Observation";
  /** ZPV1.19. When a doctor starts care. */
  seenAt?: string;
  stage?: "treatment" | "results" | "ready";
  /** ZPV1.20 */
  disposition?: "Discharged" | "Admitted" | "Transferred" | "Left Without Being Seen" | "Left Against Advice" | "Died" | "Dead On Arrival";
  dispositionAt?: string;
}

export interface Encounter {
  visitNumber: string;
  patientId: string;
  cls: PatientClass;
  status: EncounterStatus;
  bedId?: string;
  /** Beds the patient was in before each transfer, newest last. Used by A12. */
  transfers: string[];
  /** The bed held before discharge. Used as the default for A13. */
  lastBedId?: string;
  attending: string;
  admitting: string;
  service: string;
  reason: string;
  /** ICD-10-AM code for the reason, when it is coded. PV2-3 is sent only with a code. */
  reasonCode?: string;
  /** Doctor id. PV1-9. */
  consulting?: string;
  /** PV1-4, from CS-Adm-AdmissionMethod. */
  admissionMethod?: string;
  /** Local date-time strings: YYYY-MM-DDTHH:mm */
  admitAt?: string;
  dischargeAt?: string;
  expectedAdmitAt?: string;
  expectedDischargeAt?: string;
  disposition?: string;
  dx: Dx[];
  pr: Pr[];
  allergies: Allergy[];
  /** EMR data. Not part of the ADT message, except the reason (PV2-3). */
  complaints: Complaint[];
  vitals?: Vitals;
  notes: Note[];
  /** Outpatient worklist step. Checking in does not send an ADT message. */
  checkedIn?: boolean;
  /** Emergency data. Only for patient class E. */
  ed?: EdData;
  /** Diagnoses, procedures, allergies or complaints changed after the last A08. */
  dirty?: boolean;
  /** Discharge clearances of an inpatient stay: who gave each one and when. HIS only. */
  clearances?: Partial<Record<ClearanceKey, Clearance>>;
  /** Outcome and steps of the discharge. HIS only: the message carries just the PV1-36 code in `disposition`. */
  discharge?: DischargeRecord;
  /** Bed held for a pre-admission. Counts only while the visit is a pre-admission. HIS only. */
  reservedBedId?: string;
  /** Why the visit, admission or transfer was cancelled. HIS only. */
  cancelReason?: string;
}

export type ClearanceKey = "clinical" | "pharmacy" | "nursing" | "finance";
export interface Clearance { by: string; role: string; at: string }
export type DischargeOutcome = "home" | "transfer" | "ama" | "died";

export interface DischargeRecord {
  outcome: DischargeOutcome;
  /** When the doctor's discharge was recorded. Local date-time. */
  orderedAt: string;
  orderedBy: string;
  /** The bed the patient still holds until the nurse records that the patient left the ward. */
  bedId?: string;
  leftWardAt?: string;
  leftBy?: string;
  /** Discharge went ahead with clearances missing. */
  override?: { reason: string; by: string; at: string; missing: ClearanceKey[] };
  /** Transfer to another hospital. Recorded in the HIS only. */
  transfer?: { hospital: string; reason: string; acceptingDoctor: string; transport: string; consent: boolean };
  death?: { at: string; cause: string; certifiedBy: string };
}

/** A bed that is not free although no patient holds it. */
export interface BedFlag { state: "cleaning" | "out"; since: string; reason?: string; by?: string }

/** Everything a scenario screen can fill in. Each event uses the part it needs. */
export interface ScenarioForm {
  patientId: string;
  /** Existing visit number. For new visits this stays empty until Send. */
  encounterId: string;
  /** Visit number to use for a new visit. */
  visitNumber: string;
  cls: PatientClass;
  bedId: string;
  attending: string;
  admitting: string;
  /** PV1-8, referring doctor. Empty means none. */
  referring: string;
  /** PV1-9, consulting doctor. Empty means none. */
  consulting: string;
  /** PV1-4, from CS-Adm-AdmissionMethod. */
  admissionMethod: string;
  service: string;
  reason: string;
  /** ICD-10-AM code for the reason. Empty means free text only. */
  reasonCode: string;
  eventAt: string;
  admitAt: string;
  dischargeAt: string;
  expectedAdmitAt: string;
  expectedDischargeAt: string;
  disposition: string;
  dx: Dx[];
  pr: Pr[];
  allergies: Allergy[];
  /** A31 identity changes */
  family: string;
  given: string;
  dob: string;
  sex: "M" | "F";
  /** A45: the patient who should own the visit. */
  correctPatientId: string;
  /** A50 */
  newVisitNumber: string;
  oldPatientId: string;
}

export type LogSource = "seed" | "user" | "runner";

export interface Check {
  level: "error" | "warn" | "ok";
  text: string;
}

export interface LogEntry {
  seq: number;
  controlId: string;
  eventId: EventId;
  trigger: string;
  sentAt: string; // ISO
  patientId: string;
  patientName: string;
  visitNumber: string;
  message: string; // segments joined with \r
  segments: SegId[];
  errors: number;
  warnings: number;
  checks: Check[];
  source: LogSource;
}

export interface HisState {
  patients: Patient[];
  encounters: Encounter[];
  log: LogEntry[];
  counters: { visit: number; seq: number; patient: number };
  /** Beds being cleaned or out of service, by bed id. */
  bedFlags?: Record<string, BedFlag>;
}
