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
    /** What the payer answered for an active card. Covered when empty. */
    coverage?: "Covered" | "Not Covered" | "Out Of Network" | "Limit Exhausted";
  };
  /** Cards saved to the patient file with the Archive buttons. */
  archive?: { kind: "Insurance card" | "ID card"; at: string; summary: string }[];
  /** Safety flags set at registration. Shown as badges in the patient banner. HIS only. */
  flags?: PatientFlags;
  /** What the clerk chose when the insurance did not cover the visit, in words. HIS only. */
  coverageDecision?: string;
  /** Mr, Mrs, Miss, Ms, Dr or Baby. HIS only. */
  title?: string;
  /** Alias shown instead of the name for a confidential patient. HIS only. */
  nickName?: string;
  /** Registered as a newborn. `parentId` is the parent's patient id. HIS only. */
  newborn?: boolean;
  parentId?: string;
  /** Registered as unknown or unconscious in the emergency department. The details are completed later. HIS only. */
  unknown?: boolean;
  /** State or region and city of the address. HIS only. */
  region?: string;
  city?: string;
  addressLine1?: string;
  addressLine2?: string;
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
  /** The patient agreed to share their health data (HIS Patients.ShareData). Off unless the patient says yes. */
  shareData?: boolean;
  extra?: PatientExtra;
  /** Set when this file was merged into another one (the patient id kept). A merged file leaves the patient lists. */
  mergedInto?: string;
  /** When the merge was done. ISO time. */
  mergedAt?: string;
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
  /** The fields below come from Bed Setup. All optional, so older saved data still loads. HIS only, never sent. */
  floor?: string;
  roomType?: string;
  bedType?: string;
  /** Who may use the bed. Any when empty. */
  gender?: BedGender;
  isolation?: boolean;
  oxygen?: boolean;
  ventilator?: boolean;
  monitor?: boolean;
  /** False when the bed is inactive and cannot take a patient. Active when empty. */
  active?: boolean;
  notes?: string;
}

/** Gender restriction of a bed. */
export type BedGender = "Any" | "Male" | "Female";

export interface Dx {
  code: string;
  text: string;
  /** A = admitting, W = working, F = final */
  type: "A" | "W" | "F";
  /** When the diagnosis was made. Local date-time. DG1-5. */
  at?: string;
  /** ZDG1-3 condition onset flag (CS-Clinical-ConditionOnsetFlag: 1, 2 or 9). Inpatients only. */
  onset?: "1" | "2" | "9";
  /**
   * Diagnosis type as the HIS records it: P Principal, S Secondary, AD Admitting, DF Differential.
   * Empty on older records, which are read from `type` and their place in the list. HIS only:
   * DG1-6 still carries A, W or F in `type`, and DG1-15 is 1 for the Principal diagnosis.
   */
  kind?: "P" | "S" | "AD" | "DF" | "WK" | "FN" | "DC";
  /** The condition was present on admission. Sets the ZDG1-3 onset flag of an inpatient. HIS only. */
  onAdmission?: boolean;
  /** Who entered or last changed the diagnosis. HIS only. */
  by?: string;
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
  /** Clinical procedure type chosen in the HIS, such as "Minor Surgical". HIS only, not sent. Separate from the PR1-6 functional type. */
  procType?: string;
  /** ICD-10-AM code of the visit diagnosis this procedure is for. HIS only. */
  dxCode?: string;
  /** Who pays for this procedure. HIS only. Empty means it follows the visit. */
  coverage?: "Insured" | "Cash";
  /** Whether the procedure is done yet. HIS only. Empty means Completed, as older records were. */
  status?: "Completed" | "Pending";
}

export interface Allergy {
  text: string;
  severity: "SV" | "MO" | "MI";
  reaction: string;
  /** AL1-2, from CS-Allergy-Type: DALG drug, FALG food, ALG other. Drug when empty. */
  type?: "DALG" | "FALG" | "ALG";
  /** SNOMED CT code of the allergen for AL1-3. Empty means free text only. */
  code?: string;
  /** The fields below are HIS only. AL1-2, AL1-4 and AL1-5 are worked out from them when the allergy is saved. */
  category?: AllergyCategory;
  /** Allergy or intolerance. */
  reactionType?: "Allergy" | "Intolerance";
  clinicalStatus?: "Active" | "Inactive" | "Resolved";
  verification?: "Unconfirmed" | "Presumed" | "Confirmed" | "Refuted" | "Entered In Error";
  criticality?: "Low" | "High" | "Unable To Assess";
  /** Who reported the allergy. */
  source?: string;
  reactions?: AllergyReaction[];
  notes?: string;
  /** False when the record was deactivated. Empty means active. */
  active?: boolean;
  at?: string;
  by?: string;
}

export type AllergyCategory = "Medication" | "Food" | "Environment" | "Biologic";

/** One reaction to an allergen, as the HIS records it. */
export interface AllergyReaction {
  manifestations: string[];
  severity?: "SV" | "MO" | "MI";
  route?: string;
  outcome?: string;
  anaphylaxis?: boolean;
  notes?: string;
}

export interface Complaint {
  code: string;
  text: string;
  /** Code system of `code`. SNOMED CT when empty. HIS only. */
  system?: "SNOMED" | "ICD10AM";
  at?: string;
  by?: string;
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
  /** Stable id. Older notes have none; one is worked out from the note when it is first changed. HIS only. */
  id?: string;
  /** Role of the author, such as Physician or Nurse. HIS only. */
  role?: string;
  /** Last edit. HIS only. */
  editedAt?: string;
  editedBy?: string;
}

/** A progress note taken off the chart. It is kept, with who removed it and why, for the audit. HIS only. */
export interface DeletedNote extends Note {
  deletedAt: string;
  deletedBy: string;
  deleteReason: string;
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
  /**
   * Entries set to Inactive in the chart. They are kept apart so that messages, documents, the allergy strip
   * and every other reader of `dx`, `allergies` and `complaints` see active entries only. HIS only.
   */
  dxInactive?: Dx[];
  allergiesInactive?: Allergy[];
  complaintsInactive?: Complaint[];
  vitals?: Vitals;
  notes: Note[];
  /** Progress notes set to Inactive. Kept apart, like `dxInactive`, so readers of `notes` see active notes only. HIS only. */
  notesInactive?: Note[];
  /** Progress notes deleted with a reason. HIS only. */
  notesDeleted?: DeletedNote[];
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
  /** Admission details taken at registration. HIS only, except the admission type, which sets PV1-4. */
  admission?: AdmissionDetails;
  /** Sub-department (clinic or specialty unit) within the service. HIS only. Worked out from the request or appointment when empty. */
  subDepartment?: string;
  /** Every ward transfer with its reason, newest last. HIS only: A02 carries just the bed and the department. */
  transferLog?: TransferEntry[];
  /** The visit was moved from another patient's file (A45), newest last. HIS only. */
  moves?: VisitMove[];
}

/** Inpatient admission details from the registration desk, the admit dialogs or the change to inpatient. */
export interface AdmissionDetails {
  admissionType?: string;
  patientCondition?: string;
  expectedStayDays?: number;
  activityLevel?: string;
  specialty?: string;
  /** The fields below are HIS only and optional, so older visits still open. */
  attendantName?: string;
  attendantPhone?: string;
  attendantRelation?: string;
  notes?: string;
  /** Why an outpatient or emergency visit was changed to an inpatient stay (A06). */
  conversionReason?: string;
  convertedAt?: string;
  convertedBy?: string;
}

/** One ward transfer (A02). HIS only. */
export interface TransferEntry {
  /** Local date-time. */
  at: string;
  by: string;
  fromBed?: string;
  toBed: string;
  fromService: string;
  toService: string;
  fromSubDepartment?: string;
  subDepartment?: string;
  reason: string;
  /** Set when the transfer was cancelled (A12). */
  cancelledAt?: string;
}

/** A visit moved from the wrong patient to the right one (A45). HIS only. */
export interface VisitMove {
  /** Local date-time. */
  at: string;
  by: string;
  fromPatientId: string;
  toPatientId: string;
  reason: string;
  controlId?: string;
}

/** Who takes the patient home. HIS only. */
export interface DischargeAttendant {
  name: string;
  phone: string;
  relation: string;
  idType: string;
  idNumber: string;
}

/** The inpatient clinical summary written at discharge. HIS only. */
export interface DischargeSummary {
  reasonForAdmission: string;
  admittingDiagnosis: string;
  procedures: string;
  findings: string;
  /** Hospital course. */
  course: string;
}

/** One doctor who approved the discharge. HIS only. */
export interface DischargeApproval {
  role: string;
  /** Doctor id. */
  doctor: string;
  /** Local date-time. */
  at: string;
  remarks: string;
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
  /** The fields below are HIS only and optional, so discharges saved before them still open. */
  condition?: string;
  /** Discharge date and time as recorded by the doctor. Local date-time. Also sent as the discharge time of A03. */
  dischargeAt?: string;
  attendant?: DischargeAttendant;
  summary?: DischargeSummary;
  instructions?: string;
  educatedBy?: string;
  ambulance?: boolean;
  approvals?: DischargeApproval[];
}

/** The discharge details the dialog records on top of the outcome. */
export type DischargeDetails = Pick<DischargeRecord, "condition" | "dischargeAt" | "attendant" | "summary" | "instructions" | "educatedBy" | "ambulance" | "approvals">;

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
