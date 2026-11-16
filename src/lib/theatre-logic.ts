import { fmtDate, fmtTime } from "./format";
/**
 * The surgery pathway as pure rules: the steps, what each step needs before it can start, and the checks on what is entered.
 * No storage, no session and no React here. The store (theatre.ts) and the screens both ask these functions, so the gate
 * is the same everywhere and cannot be skipped by a screen that forgets to check.
 *
 * Most steps can be saved as a draft and completed later, as in the HIS operating theatre forms. Only a completed step
 * opens the next one.
 */

export type StepId = "request" | "assessment" | "schedule" | "preop" | "signIn" | "timeOut" | "signOut" | "opNote" | "recovery" | "close";

export const STEPS: { id: StepId; label: string; when?: string }[] = [
  { id: "request", label: "Surgery Request" },
  { id: "assessment", label: "Pre-Anesthesia Assessment" },
  { id: "schedule", label: "Schedule" },
  { id: "preop", label: "Pre-operative Checklist" },
  { id: "signIn", label: "Sign In", when: "Before anaesthesia" },
  { id: "timeOut", label: "Time Out", when: "Before the first cut" },
  { id: "signOut", label: "Sign Out", when: "Before the patient leaves the room" },
  { id: "opNote", label: "Operative Note" },
  { id: "recovery", label: "Recovery" },
  { id: "close", label: "Case Closed" },
];
export const STEP_LABEL = Object.fromEntries(STEPS.map((s) => [s.id, s.label])) as Record<StepId, string>;

/** Who did a step and when. Written by the store from the signed-in user, never typed. */
export interface Stamp {
  by: string;
  role: string;
  /** ISO time. */
  at: string;
}

/** A named person who signs part of the record. `at` and `by` are written by the store when the signature is first saved. */
export interface Signer {
  name: string;
  signed?: boolean;
  /** ISO time the signature was saved. */
  at?: string;
  /** The signed-in user who recorded the signature. */
  by?: string;
}

export const SIDES = ["Left", "Right", "Both", "Midline", "Not applicable"] as const;
export const URGENCIES = ["Elective", "Urgent (within 24 hours)", "Emergency (immediate)"] as const;
/** HIS lookup "Type of Anesthesia" (OperativeNote.TypeOfAnesthesiaId). */
export const ANAESTHESIA_TYPES = ["General Anesthesia", "Regional Anesthesia", "Spinal Anesthesia", "Epidural Anesthesia", "Combined Spinal Epidural", "Local Anesthesia", "Sedation", "Monitored Anesthesia Care", "Nerve Block", "Other"] as const;
export const THEATRE_ROOMS = ["Theatre 1", "Theatre 2", "Theatre 3", "Minor Theatre", "Cath Lab", "Labour Theatre"] as const;
/** HIS Operation Request Status values set by the pre-anesthesia assessment. */
export const ASSESSMENT_RESULTS = ["Fit For Anesthesia", "Fit With High Risk", "Not Fit For Anesthesia", "Need More Investigation"] as const;
export type AssessmentResult = (typeof ASSESSMENT_RESULTS)[number];
export const ASA_CLASSES = ["I", "II", "III", "IV", "V"] as const;
/** HIS lookup "Surgery Category" (OperativeNote.OperationCategoryId). */
export const OPERATION_CATEGORIES = ["Day Case", "Minor", "Major", "Package"] as const;
/** HIS lookup "OT Roster Role" (OperativeNoteTeam.RoleId). */
export const TEAM_ROLES = ["Lead Surgeon", "Surgeon", "Assistant Surgeon", "Anesthetist", "Anesthesia Technician", "Scrub Nurse", "Circulating Nurse", "OT Technician", "Recovery Nurse"] as const;
export const PAIN_TOOLS = ["Faces", "Numerical", "CRIES"] as const;
export const DISPOSITIONS = ["Returned To Ward", "Admitted To Intensive Care", "Discharged Home", "Day Surgery Unit", "Transferred To Another Facility", "Died"] as const;

export interface RequestData {
  procedure: string;
  side: string;
  surgeon: string;
  urgency: string;
  /** YYYY-MM-DD */
  plannedDate: string;
  preopDiagnosis?: string;
  notes?: string;
}

export interface AssessmentData {
  result: AssessmentResult;
  asa?: string;
  anaesthesia?: string;
  /** Needed when the result is Not Fit For Anesthesia or Need More Investigation: what is wrong or which tests. */
  notes?: string;
}

/* ---------- schedule ---------- */

/** The HIS operating theatre schedule statuses, in order. Postponed and Cancelled can happen before the case starts. */
export const SCHEDULE_STATUSES = ["Draft", "Scheduled", "Confirmed", "In Progress", "Completed", "Postponed", "Cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
/** The statuses kept on the record. In Progress, Completed and Cancelled follow from the case itself. */
export type StoredScheduleStatus = "Draft" | "Scheduled" | "Confirmed" | "Postponed";

export interface ScheduleData {
  room: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  start: string;
  durationMin: number;
  anaesthetist: string;
  scrubNurse: string;
  circulatingNurse: string;
  assistant?: string;
}

export interface ScheduleRecord extends ScheduleData {
  /** Missing on cases saved before statuses existed: read as Scheduled. */
  status?: StoredScheduleStatus;
  /** Who confirmed the slot. */
  confirmed?: Stamp;
  /** Last save. */
  done: Stamp;
}

export interface Postponement {
  reason: string;
  /** The slot that was given up, in words. */
  slot: string;
  stamp: Stamp;
}

/* ---------- pre-operative checklist ---------- */

export type PreOpAnswer = "yes" | "no" | "na";
export const PREOP_SECTIONS = ["Identity And Consent", "Preparation", "Investigations And Blood", "Medicines And Observations"] as const;
export interface PreOpItem {
  key: string;
  label: string;
  section: (typeof PREOP_SECTIONS)[number];
  /** False for checks that can never be skipped: these must be answered Yes. */
  naAllowed: boolean;
  /** A short free text asked with the item, as in the HIS. */
  textLabel?: string;
}

/** Labels follow the HIS published Surgical Safety Checklist template (form 5, a ward pre-operative checklist); keys are unchanged. */
export const PREOP_ITEMS: PreOpItem[] = [
  { key: "identity", label: "Checked hand on band identification", section: "Identity And Consent", naAllowed: false },
  { key: "consent", label: "Signed consent surgical", section: "Identity And Consent", naAllowed: false },
  { key: "anaesthesiaConsent", label: "Special consents signed (anesthesia)", section: "Identity And Consent", naAllowed: true },
  { key: "siteMarked", label: "Marked correct site and side", section: "Identity And Consent", naAllowed: true },
  { key: "fasting", label: "NPO from midnight", section: "Preparation", naAllowed: true },
  { key: "jewellery", label: "Valuables and jewelry removed or secured, dentures and contact lenses removed", section: "Preparation", naAllowed: true },
  { key: "surgicalPrep", label: "Surgical prep done", section: "Preparation", naAllowed: true },
  { key: "enema", label: "Enema", section: "Preparation", naAllowed: true },
  { key: "urinaryCatheter", label: "Urinary catheter", section: "Preparation", naAllowed: true },
  { key: "cleanGown", label: "Clean gown, cap on, clean bath blanket", section: "Preparation", naAllowed: false },
  { key: "otherItems", label: "Hairpins, makeup and nail polish removed, other items removed", section: "Preparation", naAllowed: true, textLabel: "Other Items Removed" },
  { key: "tests", label: "Test results are in the chart", section: "Investigations And Blood", naAllowed: true, textLabel: "Other Investigation" },
  { key: "blood", label: "Blood available", section: "Investigations And Blood", naAllowed: true, textLabel: "Blood Units And Type" },
  { key: "allergies", label: "Allergies to drugs checked", section: "Medicines And Observations", naAllowed: false },
  { key: "medicines", label: "Pre-op medication administered, including prophylactic antibiotics", section: "Medicines And Observations", naAllowed: true, textLabel: "Pre-operative Medication" },
  { key: "vitals", label: "Vital signs recorded", section: "Medicines And Observations", naAllowed: false },
];

export const PREOP_REVIEWS = [
  { key: "allergy", label: "Allergy Reviewed" },
  { key: "vitals", label: "Vitals Reviewed" },
  { key: "medication", label: "Medication Reviewed" },
  { key: "investigations", label: "Investigation Reviewed" },
] as const;
export type PreOpReviewKey = (typeof PREOP_REVIEWS)[number]["key"];

export interface PreOpData {
  answers: Record<string, PreOpAnswer>;
  /** A remark per item. Needed when an item is answered No. */
  remarks?: Record<string, string>;
  /** Free text asked with some items: blood units and type, other investigation, other items removed, pre-operative medication. */
  texts?: Record<string, string>;
  /** YYYY-MM-DD */
  checklistDate?: string;
  /** HH:mm */
  urineVoidedTime?: string;
  urineVoidedAmount?: string;
  /** HH:mm */
  enemaTime?: string;
  isolationPrecaution?: string;
  catheterOrDrain?: string;
  generalRemarks?: string;
  reviewed?: Partial<Record<PreOpReviewKey, boolean>>;
  /** The ward nurse who hands the patient over. */
  wardNurse?: Signer;
  /** The theatre nurse who receives the patient. */
  theatreNurse?: Signer;
}

/* ---------- surgical safety checklist ---------- */

export type PhaseId = "signIn" | "timeOut" | "signOut";
export const PHASE_ROLES = ["Surgeon", "Anaesthetist", "Circulating Nurse", "Scrub Nurse"] as const;
export type PhaseRole = (typeof PHASE_ROLES)[number];

export type SafetyAnswer = "Yes" | "No" | "N/A";
/**
 * check: must be Yes (or N/A where offered) before the phase is confirmed.
 * question: any answer is fine, the team only has to know it.
 * risk: any answer, and a Yes needs the details.
 * text: written in words. `required` marks the ones that must be filled.
 */
export type SafetyKind = "check" | "question" | "risk" | "text";
export interface SafetyItem {
  key: string;
  label: string;
  kind: SafetyKind;
  options?: SafetyAnswer[];
  required?: boolean;
  detailLabel?: string;
  placeholder?: string;
}

const YES_NO: SafetyAnswer[] = ["Yes", "No"];
const YES_NO_NA: SafetyAnswer[] = ["Yes", "No", "N/A"];
const YES_NA: SafetyAnswer[] = ["Yes", "N/A"];

/** WHO Surgical Safety Checklist, with the items of the HIS form. `lead` is the role that normally confirms the phase. */
export const SAFETY_PHASES: Record<PhaseId, { label: string; when: string; read: string; lead: PhaseRole; roles: PhaseRole[]; items: SafetyItem[] }> = {
  signIn: {
    label: "Sign In", when: "Before anaesthesia", read: "Read aloud in the operating room with at least the nurse and the anaesthetist.",
    lead: "Anaesthetist", roles: ["Anaesthetist", "Circulating Nurse"],
    items: [
      { key: "identity", label: "The patient confirmed their identity", kind: "check", options: YES_NO },
      { key: "procedure", label: "The patient confirmed the operation", kind: "check", options: YES_NO },
      { key: "consent", label: "The patient confirmed the consent", kind: "check", options: YES_NO },
      { key: "siteMarked", label: "The site is marked", kind: "check", options: YES_NO_NA },
      { key: "machine", label: "Anaesthesia machine and medicine check is complete", kind: "check", options: YES_NO },
      { key: "oximeter", label: "Pulse oximeter is on the patient and working", kind: "check", options: YES_NO },
      { key: "allergy", label: "Does the patient have a known allergy?", kind: "question", options: YES_NO },
      { key: "airway", label: "Difficult airway or aspiration risk?", kind: "risk", options: YES_NO, detailLabel: "Airway Risk Details", placeholder: "Equipment and help available" },
      { key: "bloodLoss", label: "Risk of more than 500 mL blood loss (7 mL/kg in children)?", kind: "risk", options: YES_NO, detailLabel: "Blood Loss Risk Details", placeholder: "Two lines or central access and fluids planned" },
    ],
  },
  timeOut: {
    label: "Time Out", when: "Before the first cut", read: "Read aloud before the first cut with the nurse, the anaesthetist and the surgeon.",
    lead: "Surgeon", roles: ["Surgeon", "Anaesthetist", "Circulating Nurse"],
    items: [
      { key: "introductions", label: "Every team member said their name and role", kind: "check", options: YES_NO },
      { key: "patient", label: "Correct patient confirmed", kind: "check", options: YES_NO },
      { key: "procedure", label: "Correct operation confirmed", kind: "check", options: YES_NO },
      { key: "site", label: "Correct site confirmed", kind: "check", options: YES_NO },
      { key: "side", label: "Correct side confirmed", kind: "check", options: YES_NO_NA },
      { key: "position", label: "Patient position confirmed", kind: "check", options: YES_NO },
      { key: "implants", label: "Implants and special equipment are available", kind: "check", options: YES_NO_NA },
      { key: "equipment", label: "Equipment is checked and working", kind: "check", options: YES_NO },
      { key: "sterility", label: "Sterility is confirmed, including indicator results", kind: "check", options: YES_NO },
      { key: "antibiotic", label: "Antibiotic was given in the last 60 minutes", kind: "check", options: YES_NA },
      { key: "imaging", label: "Needed images are on display", kind: "check", options: YES_NA },
      { key: "criticalSteps", label: "Critical Or Unexpected Steps", kind: "text", required: true, placeholder: "What the surgeon told the team, or None" },
      { key: "duration", label: "Expected Duration", kind: "text", required: true, placeholder: "About 90 minutes" },
      { key: "bloodLossExpected", label: "Expected Blood Loss", kind: "text", required: true, placeholder: "Under 100 mL" },
      { key: "anaesthesiaConcerns", label: "Anaesthetic Concerns", kind: "text", placeholder: "None" },
      { key: "nursingConcerns", label: "Nursing Concerns", kind: "text", placeholder: "None" },
      { key: "agreement", label: "The team agrees to go ahead", kind: "check", options: YES_NO },
    ],
  },
  signOut: {
    label: "Sign Out", when: "Before the patient leaves the room", read: "Read aloud before the patient leaves the operating room.",
    lead: "Circulating Nurse", roles: ["Circulating Nurse", "Scrub Nurse", "Surgeon"],
    items: [
      { key: "procedureRecorded", label: "The name of the operation done is recorded", kind: "check", options: YES_NO },
      { key: "procedureName", label: "Procedure Name Recorded", kind: "text", required: true },
      { key: "counts", label: "Instrument, sponge and needle counts are correct", kind: "check", options: YES_NO },
      { key: "specimens", label: "Specimens are labelled with the patient name", kind: "check", options: YES_NO_NA },
      { key: "equipmentProblems", label: "Equipment Problems To Report", kind: "text", placeholder: "None" },
      { key: "recoveryConcerns", label: "Main Concerns For Recovery", kind: "text", placeholder: "Surgeon, anaesthetist and nurse review" },
    ],
  },
};

export type SafetyRole = "surgeon" | "anaesthetist" | "nurse";
export const SAFETY_SIGNERS: { key: SafetyRole; label: string }[] = [
  { key: "surgeon", label: "Surgeon" },
  { key: "anaesthetist", label: "Anaesthetist" },
  { key: "nurse", label: "Nurse" },
];
export type SafetySigners = Partial<Record<SafetyRole, Signer>>;

export interface PhaseData {
  answers?: Record<string, SafetyAnswer>;
  texts?: Record<string, string>;
  /** Remarks for this stage. */
  remarks?: string;
  /** Cases saved before each item had its own answer: the keys that were ticked. */
  checked?: string[];
  confirmedRole: string;
  confirmedName: string;
  /** Set when a doctor started this phase before the booked slot, with the reason. Later phases of the case follow it. */
  earlyStart?: { reason: string; doctor: string };
}

/** What the screen sends: the phase plus the three people who sign the whole checklist. */
export type PhaseInput = PhaseData & { signers?: SafetySigners };

/* ---------- operative note ---------- */

export interface CodedDx {
  /** ICD-10-AM */
  code: string;
  text: string;
}

export interface TeamMember {
  role: string;
  staff: string;
  primary?: boolean;
  remarks?: string;
}

export type NoteStatus = "Draft" | "Completed";

export interface OpNoteData {
  /** Local date and time, YYYY-MM-DDTHH:mm */
  start: string;
  end: string;
  procedureDone: string;
  /** Findings and procedure details. Feeds the Findings section of the Operative Note document. */
  findings: string;
  anaesthesia?: string;
  bloodLossMl?: number;
  /** Specimen type sent to pathology, or None. Feeds the document. */
  specimens?: string;
  /** Complication details, or None. Feeds the document. */
  complications?: string;
  plan?: string;
  /** YYYY-MM-DD */
  noteDate?: string;
  theatre?: string;
  theatreNurse?: string;
  category?: string;
  anaesthetist?: string;
  postopDiagnosis?: CodedDx;
  team?: TeamMember[];
  specimenToPathology?: boolean;
  complication?: boolean;
  transfusion?: boolean;
  transfusionMl?: number;
  countCorrect?: boolean;
  signingSurgeon?: string;
}

/* ---------- Aldrete recovery score ---------- */

export type AldreteKey = "activity" | "breathing" | "circulation" | "consciousness" | "colour" | "oxygen";
export const ALDRETE_ITEMS: { key: AldreteKey; label: string; options: [string, string, string] }[] = [
  { key: "activity", label: "Activity", options: ["Cannot move arms or legs", "Moves two limbs", "Moves all four limbs"] },
  { key: "breathing", label: "Breathing", options: ["Not breathing without help", "Shallow or laboured breathing", "Breathes deeply and coughs"] },
  { key: "circulation", label: "Circulation", options: ["Blood pressure 50% or more away from the level before anaesthesia", "Blood pressure 20% to 49% away", "Blood pressure within 20%"] },
  { key: "consciousness", label: "Consciousness", options: ["Does not respond", "Wakes when called", "Fully awake"] },
  { key: "colour", label: "Colour", options: ["Blue (cyanosed)", "Pale, dusky or blotchy", "Normal pink"] },
  { key: "oxygen", label: "Oxygen Saturation", options: ["Below 90% even with oxygen", "Needs oxygen to stay above 90%", "Above 92% on room air"] },
];
export type AldreteScores = Partial<Record<AldreteKey, number>>;
export const ALDRETE_PASS = 9;
export const ALDRETE_MAX = ALDRETE_ITEMS.length * 2;

/** Total of the six items, 0 to 12. Null until all six are scored, so a half-filled score never passes. */
export function aldreteTotal(s: AldreteScores | undefined): number | null {
  if (!s) return null;
  let total = 0;
  for (const i of ALDRETE_ITEMS) {
    const n = s[i.key];
    if (n !== 0 && n !== 1 && n !== 2) return null;
    total += n;
  }
  return total;
}

/** The most a saved score could reach. Scores saved before Colour was added had five items, out of 10. */
export const aldreteMaxOf = (s: AldreteScores): number => (s.colour === undefined ? 10 : ALDRETE_MAX);

/** A score saved by the earlier recovery screen, one at a time. Kept so old cases still show them. */
export interface RecoveryScore {
  scores: AldreteScores;
  total: number;
  stamp: Stamp;
}

export interface RecoveryVitals {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  temperature?: number;
  spo2?: number;
  respRate?: number;
}

export const RECOVERY_CHECKS = [
  { key: "infectedCase", label: "Questionable Infected Case" },
  { key: "ngTube", label: "Nasogastric Tube In Place" },
  { key: "drainsOk", label: "Drains Or Catheters Satisfactory" },
  { key: "woundOk", label: "Wound Or Dressing Satisfactory" },
  { key: "pressureAreasOk", label: "Pressure Areas Satisfactory" },
  { key: "bloodTests", label: "Blood Tests Taken" },
  { key: "complications", label: "Surgical Or Anaesthetic Complications" },
] as const;
export type RecoveryCheckKey = (typeof RECOVERY_CHECKS)[number]["key"];

export interface RecoveryData {
  /** HH:mm */
  arrivalTime?: string;
  /** HH:mm. Filled with the time of discharge when left blank. */
  timeOut?: string;
  responsibleNurse?: string;
  receivedBy?: string;
  airway?: string;
  drains?: string;
  dressing?: string;
  skin?: string;
  bloodIv?: string;
  observations?: string;
  conditionOnTransfer?: string;
  remarks?: string;
  vitals?: RecoveryVitals;
  inPain?: boolean;
  painIntensity?: number;
  painTool?: string;
  checks?: Partial<Record<RecoveryCheckKey, boolean>>;
  complicationDetails?: string;
  aldrete?: { admission?: AldreteScores; admissionRemarks?: string; discharge?: AldreteScores; dischargeRemarks?: string };
  /** Where the patient goes from recovery. */
  destination?: string;
}

export interface RecoveryDischarge {
  score: number;
  destination: string;
  /** Present when a doctor let the patient leave below the pass score. */
  override?: { reason: string; doctor: string };
}

export type CloseOutcome = "Completed" | "Cancelled" | "Incomplete";

export interface ClosureDetails {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  disposition: string;
  dispositionRemarks?: string;
}

export interface SurgeryCase {
  id: string;
  visit: string;
  patientId: string;
  request: RequestData & { done: Stamp };
  assessment?: AssessmentData & { done: Stamp };
  schedule?: ScheduleRecord;
  /** Slots given up, oldest first. */
  postponements?: Postponement[];
  /** Saved bit by bit. `done` is set only when the checklist is completed. */
  preop?: PreOpData & { done?: Stamp; saved?: Stamp };
  signIn?: PhaseData & { done: Stamp };
  timeOut?: PhaseData & { done: Stamp };
  signOut?: PhaseData & { done: Stamp };
  /** A phase saved as a draft and not yet confirmed. */
  phaseDrafts?: Partial<Record<PhaseId, PhaseData & { saved: Stamp }>>;
  /** The three people who sign the surgical safety checklist. */
  safetySigners?: SafetySigners;
  /** Draft until completed and signed. Notes saved before statuses existed have no status and count as completed. */
  opNote?: OpNoteData & { status?: NoteStatus; done?: Stamp; saved?: Stamp };
  recovery?: { scores: RecoveryScore[]; form?: RecoveryData; saved?: Stamp; discharge?: RecoveryDischarge & { done: Stamp } };
  closed?: { outcome: CloseOutcome; reason?: string; done: Stamp } & Partial<ClosureDetails>;
  /** Operation Request form record kept in step with this case, so the Operative Note document finds the times. */
  linkedRecordId?: string;
}

/* ---------- step state and the gate ---------- */

export const fitForSurgery = (r: AssessmentResult | undefined): boolean => r === "Fit For Anesthesia" || r === "Fit With High Risk";

/** Values saved before the lists followed the HIS lookups, read as their HIS value. */
export const LEGACY_THEATRE_VALUES: Record<string, string> = {
  Fit: "Fit For Anesthesia", "Not Fit": "Not Fit For Anesthesia", "Needs More Tests": "Need More Investigation",
  General: "General Anesthesia", Spinal: "Spinal Anesthesia", Epidural: "Epidural Anesthesia", "Regional block": "Regional Anesthesia",
  "Local with sedation": "Sedation", "Local only": "Local Anesthesia", Intermediate: "Major", Complex: "Major",
  Anaesthetist: "Anesthetist", "Anaesthesia Technician": "Anesthesia Technician",
};

/** The schedule status shown to people. Null before anything is scheduled. */
export function scheduleStatus(c: SurgeryCase): ScheduleStatus | null {
  if (!c.schedule) return null;
  if (c.closed?.outcome === "Cancelled") return "Cancelled";
  const s = c.schedule.status ?? "Scheduled";
  if (s === "Draft" || s === "Postponed") return s;
  if (c.signOut) return "Completed";
  if (c.signIn) return "In Progress";
  return s;
}

/** The slot is booked: a schedule that is not a draft and not postponed. */
export const isBooked = (c: SurgeryCase): boolean => !!c.schedule && c.schedule.status !== "Draft" && c.schedule.status !== "Postponed";
/** The theatre team confirmed the slot. Cases saved before statuses existed are read as Scheduled, so they need a confirmation. */
export const isConfirmed = (c: SurgeryCase): boolean => c.schedule?.status === "Confirmed";
export const opNoteDone = (c: SurgeryCase): boolean => !!c.opNote && c.opNote.status !== "Draft";

export function stepDone(c: SurgeryCase, step: StepId): boolean {
  switch (step) {
    case "request": return true;
    case "assessment": return !!c.assessment;
    case "schedule": return isBooked(c);
    case "preop": return !!c.preop?.done;
    case "signIn": return !!c.signIn;
    case "timeOut": return !!c.timeOut;
    case "signOut": return !!c.signOut;
    case "opNote": return opNoteDone(c);
    case "recovery": return !!c.recovery?.discharge;
    case "close": return !!c.closed;
  }
}

export interface Gate {
  ok: boolean;
  /** Why the step cannot start. Empty when it can. */
  reason: string;
}
const open = (): Gate => ({ ok: true, reason: "" });
const shut = (reason: string): Gate => ({ ok: false, reason });
const blank = (s: string | undefined) => !s || !s.trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const sided = (side?: string) => side === "Left" || side === "Right" || side === "Both";

/** True when this item may be answered "N/A" or "No" for this case. Checks that always apply must be Yes. */
export const preOpNaAllowed = (item: PreOpItem, side?: string): boolean => item.naAllowed && !(item.key === "siteMarked" && sided(side));

/**
 * Items of the pre-operative checklist that still need an acceptable answer.
 * Yes is always fine. N/A only where allowed. No only where allowed and with a remark that says why.
 */
export function preOpMissing(answers: Record<string, PreOpAnswer> | undefined, side?: string, remarks?: Record<string, string>): PreOpItem[] {
  return PREOP_ITEMS.filter((i) => {
    const a = answers?.[i.key];
    if (a === "yes") return false;
    if (a === "na") return !preOpNaAllowed(i, side);
    if (a === "no") return !preOpNaAllowed(i, side) || blank(remarks?.[i.key]);
    return true;
  });
}

/** Everything that stops the pre-operative checklist from being completed, in words. Empty when it can be completed. */
export function preOpProblems(p: Partial<PreOpData> | undefined, side?: string): string[] {
  const out: string[] = [];
  if (blank(p?.checklistDate)) out.push("Enter the checklist date.");
  const left = preOpMissing(p?.answers, side, p?.remarks);
  const noRemark = left.filter((i) => p?.answers?.[i.key] === "no" && preOpNaAllowed(i, side));
  const wrong = left.filter((i) => (p?.answers?.[i.key] === "no" || p?.answers?.[i.key] === "na") && !preOpNaAllowed(i, side));
  const unanswered = left.length - noRemark.length - wrong.length;
  if (unanswered > 0) out.push(`${plural(unanswered, "checklist item is", "checklist items are")} not answered.`);
  for (const i of wrong) out.push(`"${i.label}" must be Yes before the operation.`);
  for (const i of noRemark) out.push(`"${i.label}" is answered No. Write a remark that says why.`);
  for (const r of PREOP_REVIEWS) if (!p?.reviewed?.[r.key]) out.push(`Tick ${r.label}.`);
  if (blank(p?.wardNurse?.name)) out.push("Choose the ward nurse.");
  else if (!p?.wardNurse?.signed) out.push("The ward nurse has not signed.");
  if (blank(p?.theatreNurse?.name)) out.push("Choose the theatre nurse.");
  else if (!p?.theatreNurse?.signed) out.push("The theatre nurse has not signed.");
  if (!blank(p?.wardNurse?.name) && p?.wardNurse?.name === p?.theatreNurse?.name) out.push("The ward nurse and the theatre nurse must be two people.");
  return out;
}

/**
 * May this step start now? Each step needs the one before it. The reason is written for the person at the screen.
 * This answers "may I open and save this step", for a step that is not done yet and for the few that may be redone.
 */
export function stepGate(c: SurgeryCase, step: StepId): Gate {
  if (step === "close") return c.closed ? shut("This case is already closed.") : open();
  if (c.closed) return shut(`This case is closed (${c.closed.outcome}). Nothing more can be recorded.`);
  switch (step) {
    case "request":
      return c.assessment ? shut("The request cannot change after the pre-anaesthesia assessment. Cancel the case and make a new request.") : open();
    case "assessment":
      return isBooked(c) ? shut("The case is already scheduled.") : open();
    case "schedule":
      if (!c.assessment) return shut("Do the pre-anaesthesia assessment first.");
      if (!fitForSurgery(c.assessment.result)) {
        return shut(`The pre-anaesthesia result is ${c.assessment.result}. Only Fit or Fit With High Risk can be scheduled. Assess again when the patient is ready, or cancel the case.`);
      }
      return c.signIn ? shut("The case has started. The schedule cannot change now.") : open();
    case "preop":
      if (!isBooked(c)) return shut(c.schedule?.status === "Postponed" ? "The case is postponed. Schedule it again first." : "Schedule the case first.");
      return c.signIn ? shut("Sign In is done. The pre-operative checklist cannot change now.") : open();
    case "signIn": {
      if (c.signIn) return shut("Sign In is already confirmed.");
      if (!isBooked(c)) return shut(c.schedule?.status === "Postponed" ? "The case is postponed. Schedule it again first." : "Schedule the case first.");
      const left = preOpProblems(c.preop, c.request.side);
      if (left.length > 0 || !c.preop?.done) {
        return shut(left.length > 0 ? `The pre-operative checklist is not complete. ${plural(left.length, "item is", "items are")} left.` : "Complete the pre-operative checklist first.");
      }
      if (!isConfirmed(c)) return shut("Confirm the schedule first. The theatre team confirms the slot before the patient is sent for.");
      return open();
    }
    case "timeOut":
      if (c.timeOut) return shut("Time Out is already confirmed.");
      return c.signIn ? open() : shut("Confirm Sign In first.");
    case "signOut":
      if (c.signOut) return shut("Sign Out is already confirmed.");
      return c.timeOut ? open() : shut("Confirm Time Out first.");
    case "opNote":
      if (!c.signOut) return shut("Confirm Sign Out first.");
      return opNoteDone(c) ? shut("The operative note is completed and signed. It cannot change now.") : open();
    case "recovery":
      if (c.recovery?.discharge) return shut("The patient has already left recovery.");
      return opNoteDone(c) ? open() : shut("Complete and sign the operative note first.");
  }
}

/** May the slot be confirmed now? Only a Scheduled slot can be confirmed. */
export function confirmGate(c: SurgeryCase): Gate {
  if (c.closed) return shut("This case is closed.");
  const s = scheduleStatus(c);
  if (!s) return shut("Schedule the case first.");
  if (s === "Confirmed") return shut("The schedule is already confirmed.");
  if (s === "Draft") return shut("The schedule is a draft. Save it as Scheduled first.");
  if (s === "Postponed") return shut("The case is postponed. Schedule it again first.");
  if (s !== "Scheduled") return shut("The case has started.");
  return open();
}

/** May the slot be postponed? Only before Sign In, and only with a reason. */
export function postponeGate(c: SurgeryCase, reason?: string): Gate {
  if (c.closed) return shut("This case is closed.");
  if (!c.schedule) return shut("The case is not scheduled.");
  if (c.signIn) return shut("The case has started, so it cannot be postponed. Close it as Incomplete and give the reason.");
  if (c.schedule.status === "Postponed") return shut("The case is already postponed.");
  return blank(reason) ? shut("Give the reason for postponing.") : open();
}

/** The first step that is not done. Null when the case is closed. */
export function currentStep(c: SurgeryCase): StepId | null {
  if (c.closed) return null;
  return STEPS.find((s) => !stepDone(c, s.id))?.id ?? null;
}

export type CaseStage = "Waiting For Assessment" | "Not Cleared" | "To Schedule" | "Postponed" | "Scheduled" | "In Theatre" | "Note Needed" | "In Recovery" | "Ready To Close" | "Closed";

export function caseStage(c: SurgeryCase): CaseStage {
  if (c.closed) return "Closed";
  if (!c.assessment) return "Waiting For Assessment";
  if (!isBooked(c)) {
    if (!fitForSurgery(c.assessment.result)) return "Not Cleared";
    return c.schedule?.status === "Postponed" ? "Postponed" : "To Schedule";
  }
  if (!c.signIn) return "Scheduled";
  if (!c.signOut) return "In Theatre";
  if (!opNoteDone(c)) return "Note Needed";
  if (!c.recovery?.discharge) return "In Recovery";
  return "Ready To Close";
}

/** What the next person has to do, in a few words. */
export function nextAction(c: SurgeryCase): string {
  const step = currentStep(c);
  if (!step) return "No action needed";
  if (step === "schedule") {
    if (c.assessment && !fitForSurgery(c.assessment.result)) return c.assessment.result === "Need More Investigation" ? "Do the tests, then assess again" : "Assess again or cancel";
    if (c.schedule?.status === "Postponed") return "Postponed: schedule again";
    if (c.schedule?.status === "Draft") return "Finish the schedule draft";
  }
  if (step === "preop") {
    const left = preOpMissing(c.preop?.answers, c.request.side, c.preop?.remarks).length;
    return left ? `Pre-operative checklist, ${left} left` : "Complete the pre-operative checklist";
  }
  if (step === "signIn" && !isConfirmed(c)) return "Confirm the schedule";
  if ((step === "signIn" || step === "timeOut" || step === "signOut") && c.phaseDrafts?.[step]) return `Finish ${STEP_LABEL[step]}`;
  if (step === "opNote" && c.opNote) return "Complete and sign the operative note";
  if (step === "recovery") return c.recovery?.form ? "Finish the recovery assessment" : "Recovery assessment";
  if (step === "close") return "Close the case";
  return STEP_LABEL[step];
}

/* ---------- checks on what is entered ---------- */

export function validateRequest(r: Partial<RequestData>): string | null {
  if (blank(r.procedure)) return "Enter the procedure.";
  if (blank(r.side)) return "Choose the side.";
  if (blank(r.surgeon)) return "Choose the surgeon.";
  if (blank(r.urgency)) return "Choose the urgency.";
  if (blank(r.plannedDate)) return "Enter the planned date.";
  return null;
}

export function validateAssessment(a: Partial<AssessmentData>): string | null {
  if (!a.result || !ASSESSMENT_RESULTS.includes(a.result)) return "Choose the result of the assessment.";
  if (!fitForSurgery(a.result) && blank(a.notes)) return a.result === "Need More Investigation" ? "Say which tests are needed." : "Say why the patient is not fit.";
  if (a.result === "Fit With High Risk" && blank(a.notes)) return "Describe the high risk.";
  return null;
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const clock = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const scheduleEnd = (s: Pick<ScheduleData, "start" | "durationMin">): string => clock(minutes(s.start) + s.durationMin);
export const slotText = (s: Pick<ScheduleData, "room" | "date" | "start" | "durationMin">): string =>
  s.room && s.date && s.start ? `${s.room}, ${s.date} ${s.start} to ${scheduleEnd(s)}` : "No slot chosen";

/** The case that already holds this room at this time, if any. Drafts, postponed and cancelled cases do not hold a slot. */
export function roomClash(cases: SurgeryCase[], s: Pick<ScheduleData, "room" | "date" | "start" | "durationMin">, exceptId?: string): SurgeryCase | undefined {
  const a0 = minutes(s.start), a1 = a0 + s.durationMin;
  return cases.find((c) => {
    if (c.id === exceptId || !isBooked(c) || c.closed?.outcome === "Cancelled") return false;
    if (c.schedule!.room !== s.room || c.schedule!.date !== s.date) return false;
    const b0 = minutes(c.schedule!.start), b1 = b0 + c.schedule!.durationMin;
    return a0 < b1 && b0 < a1;
  });
}

export function validateSchedule(s: Partial<ScheduleData>, cases: SurgeryCase[], exceptId?: string): string | null {
  if (blank(s.room)) return "Choose the room.";
  if (blank(s.date)) return "Enter the date.";
  if (blank(s.start) || !/^\d{2}:\d{2}$/.test(s.start!)) return "Enter the start time.";
  if (!s.durationMin || s.durationMin <= 0) return "Enter how long the operation will take, in minutes.";
  if (blank(s.anaesthetist)) return "Choose the anaesthetist.";
  if (blank(s.scrubNurse)) return "Choose the scrub nurse.";
  if (blank(s.circulatingNurse)) return "Choose the circulating nurse.";
  if (s.scrubNurse === s.circulatingNurse) return "The scrub nurse and the circulating nurse must be two people.";
  const clash = roomClash(cases, s as ScheduleData, exceptId);
  if (clash?.schedule) {
    return `${s.room} is already booked on ${s.date} from ${clash.schedule.start} to ${scheduleEnd(clash.schedule)} for ${clash.request.procedure}. Choose another time or room.`;
  }
  return null;
}

/** A draft schedule may be incomplete. It does not hold the room, so there is no clash check yet. */
export function validateScheduleDraft(s: Partial<ScheduleData>): string | null {
  if (!blank(s.start) && !/^\d{2}:\d{2}$/.test(s.start!)) return "Enter the start time as hours and minutes.";
  if (s.durationMin !== undefined && s.durationMin < 0) return "The length cannot be below zero.";
  if (!blank(s.scrubNurse) && s.scrubNurse === s.circulatingNurse) return "The scrub nurse and the circulating nurse must be two people.";
  return null;
}

/** Items of a phase that have no answer yet. */
export function phaseUnanswered(phase: PhaseId, d: Partial<PhaseData>): SafetyItem[] {
  return SAFETY_PHASES[phase].items.filter((i) => (i.kind === "text" ? i.required && blank(d.texts?.[i.key]) : !d.answers?.[i.key]));
}

export function validatePhase(phase: PhaseId, d: Partial<PhaseInput>): string | null {
  const def = SAFETY_PHASES[phase];
  const left = phaseUnanswered(phase, d);
  if (left.length > 0) return `${plural(left.length, "item is", "items are")} not answered. Every item must be answered before ${def.label} is confirmed.`;
  for (const i of def.items) {
    const a = d.answers?.[i.key];
    if (i.kind !== "text" && a && i.options && !i.options.includes(a)) return `"${i.label}" cannot be answered ${a}.`;
    if (i.kind === "check" && a === "No") return `"${i.label}" is answered No. Put it right before ${def.label} is confirmed, or stop and close the case.`;
    if (i.kind === "risk" && a === "Yes" && blank(d.texts?.[i.key])) return `Enter the ${(i.detailLabel ?? "details").toLowerCase()}.`;
  }
  if (blank(d.confirmedRole) || !(def.roles as string[]).includes(d.confirmedRole!)) return `Choose who confirms ${def.label}.`;
  if (blank(d.confirmedName)) return "Enter the name of the person who confirms.";
  if (phase === "signOut") {
    const missing = SAFETY_SIGNERS.filter((s) => blank(d.signers?.[s.key]?.name) || !d.signers?.[s.key]?.signed);
    if (missing.length > 0) return `The checklist needs the signature of the ${missing.map((s) => s.label.toLowerCase()).join(", the ")} before Sign Out is confirmed.`;
  }
  return null;
}

/** Checks on the operative note. A draft only needs the operation done and sensible numbers. Completing needs the rest. */
export function validateOpNote(n: Partial<OpNoteData>, mode: "draft" | "complete" = "complete"): string | null {
  if (blank(n.procedureDone)) return "Enter the operation that was done.";
  if (!blank(n.start) && !blank(n.end) && n.end! <= n.start!) return "The end time must be after the start time.";
  if (n.bloodLossMl !== undefined && (Number.isNaN(n.bloodLossMl) || n.bloodLossMl < 0)) return "Blood loss cannot be below zero.";
  if (n.transfusionMl !== undefined && (Number.isNaN(n.transfusionMl) || n.transfusionMl < 0)) return "The transfusion volume cannot be below zero.";
  const team = n.team ?? [];
  const seen = new Set<string>();
  for (const m of team) {
    if (blank(m.role) || blank(m.staff)) return "Every team row needs a role and a staff member.";
    const k = `${m.role}|${m.staff}`;
    if (seen.has(k)) return "The same staff member and role cannot be added twice.";
    seen.add(k);
  }
  for (const role of new Set(team.map((m) => m.role))) {
    if (team.filter((m) => m.role === role && m.primary).length > 1) return `Only one ${role.toLowerCase()} can be primary.`;
  }
  if (mode === "draft") return null;
  if (blank(n.noteDate)) return "Enter the note date.";
  if (blank(n.start)) return "Enter when the operation started.";
  if (blank(n.end)) return "Enter when the operation ended.";
  if (blank(n.findings)) return "Enter the findings.";
  if (!team.some((m) => m.role === "Surgeon" || m.role === "Lead Surgeon")) return "Add at least one surgeon to the surgical team.";
  if (n.complication === undefined) return "Answer Intra-operative Complication.";
  if (n.complication && blank(n.complications)) return "Enter the complication details.";
  if (n.specimenToPathology === undefined) return "Answer Specimen Sent To Pathology.";
  if (n.specimenToPathology && blank(n.specimens)) return "Enter the specimen type.";
  if (n.transfusion && !n.transfusionMl) return "Enter the transfusion volume in mL.";
  if (n.countCorrect === undefined) return "Answer Instrument And Swab Count Correct.";
  if (blank(n.signingSurgeon)) return "Choose the surgeon who signs the note.";
  return null;
}

const outside = (v: number | undefined, lo: number, hi: number) => v !== undefined && (Number.isNaN(v) || v < lo || v > hi);

/** Checks on the recovery assessment. A draft only needs sensible values. Completing needs everything the nurse must record. */
export function validateRecovery(d: Partial<RecoveryData>, mode: "draft" | "complete" = "complete"): string | null {
  if (outside(d.painIntensity, 0, 10)) return "Pain intensity must be between 0 and 10.";
  if (!blank(d.arrivalTime) && !blank(d.timeOut) && d.timeOut! < d.arrivalTime!) return "Time Out cannot be before the arrival time.";
  const v = d.vitals ?? {};
  if (outside(v.spo2, 0, 100)) return "SpO2 must be between 0 and 100.";
  if (outside(v.pulse, 0, 300) || outside(v.respRate, 0, 100) || outside(v.bpSystolic, 0, 300) || outside(v.bpDiastolic, 0, 250)) return "Check the vital signs: a value is out of range.";
  if (outside(v.temperature, 25, 45)) return "Temperature must be between 25 and 45 °C.";
  if (mode === "draft") return null;
  if (blank(d.arrivalTime)) return "Enter the arrival time.";
  if (blank(d.responsibleNurse)) return "Choose the responsible nurse.";
  if (d.inPain === undefined) return "Answer whether the patient is in pain.";
  if (d.inPain && d.painIntensity === undefined) return "Choose the pain intensity.";
  if (d.inPain && blank(d.painTool)) return "Choose the pain tool.";
  if (aldreteTotal(d.aldrete?.admission) === null) return "Score all six Aldrete items on admission.";
  if (aldreteTotal(d.aldrete?.discharge) === null) return "Score all six Aldrete items at discharge.";
  if (d.checks?.complications && blank(d.complicationDetails)) return "Enter the complication details.";
  if (blank(d.observations)) return "Enter the nursing observations.";
  if (blank(d.conditionOnTransfer)) return "Enter the condition on transfer.";
  if (blank(d.destination)) return "Choose where the patient goes.";
  return null;
}

/**
 * May the patient leave recovery? Needs an Aldrete score of 9 or more. Below that, only a doctor can let the patient go,
 * and must give a reason.
 */
export function recoveryDischargeGate(lastTotal: number | null | undefined, override?: { reason: string; isDoctor: boolean }): Gate {
  if (lastTotal === null || lastTotal === undefined) return shut("Record a full Aldrete score first.");
  if (lastTotal >= ALDRETE_PASS) return open();
  if (!override) return shut(`The Aldrete score is ${lastTotal}. The patient can leave recovery at ${ALDRETE_PASS} or more, or when a doctor overrides with a reason.`);
  if (!override.isDoctor) return shut("Only a doctor can override the recovery score.");
  if (blank(override.reason)) return shut("Give the reason for the override.");
  return open();
}

/** The latest full Aldrete total on a case: the discharge score, else the admission score, else the last score from the older screen. */
export function latestAldrete(c: SurgeryCase): { total: number; max: number; when: "Discharge" | "Admission" | "Earlier" } | null {
  const f = c.recovery?.form?.aldrete;
  const d = aldreteTotal(f?.discharge);
  if (d !== null) return { total: d, max: ALDRETE_MAX, when: "Discharge" };
  const a = aldreteTotal(f?.admission);
  if (a !== null) return { total: a, max: ALDRETE_MAX, when: "Admission" };
  const last = c.recovery?.scores[c.recovery.scores.length - 1];
  return last ? { total: last.total, max: aldreteMaxOf(last.scores), when: "Earlier" } : null;
}

/** Which ways of closing are open now, and why the others are not. */
export function closeGate(c: SurgeryCase, outcome: CloseOutcome, reason?: string): Gate {
  if (c.closed) return shut("This case is already closed.");
  if (outcome === "Completed") {
    const step = currentStep(c);
    return step === "close" ? open() : shut(`The case is not finished. Next step: ${step ? STEP_LABEL[step] : "none"}.`);
  }
  if (outcome === "Cancelled") {
    if (c.signIn) return shut("The case has started, so it cannot be cancelled. Close it as Incomplete and give the reason.");
    return blank(reason) ? shut("Give the reason for cancelling.") : open();
  }
  if (!c.signIn) return shut("The case has not started. Cancel it instead.");
  if (c.recovery?.discharge) return shut("Every step is done. Close the case as Completed.");
  return blank(reason) ? shut("Give the reason the case is incomplete.") : open();
}

export function validateClosure(d: Partial<ClosureDetails> | undefined): string | null {
  if (blank(d?.date)) return "Enter the closure date.";
  if (blank(d?.time) || !/^\d{2}:\d{2}$/.test(d!.time!)) return "Enter the closure time.";
  if (blank(d?.disposition)) return "Choose the patient disposition.";
  return null;
}

/** The operative note is completed and both operation times are known, so the Operative Note document can be built and published. */
export const readyForOperativeNote = (c: SurgeryCase): boolean => opNoteDone(c) && !!c.opNote?.start && !!c.opNote?.end;

/* ---------- time of the booked slot ---------- */

/** Clocks differ a little between machines and people type times by hand. */
export const CLOCK_SLACK_MS = 2 * 60_000;

const parseLocal = (day: string | undefined, time: string | undefined): Date | null => {
  if (!day || !time || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${day}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseLocalDateTime = (v: string | undefined): Date | null => {
  if (!v || blank(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** When the booked slot starts, or null when there is no usable slot. */
export const slotStartAt = (c: Pick<SurgeryCase, "schedule">): Date | null => parseLocal(c.schedule?.date, c.schedule?.start);

const when = (d: Date): string =>
  `${fmtDate(d)} at ${fmtTime(d)}`;

export type TimedStep = "signIn" | "timeOut" | "signOut";

/**
 * Surgery steps from Sign In on cannot start before the booked slot. A doctor may start early, with a reason.
 * Once Sign In was done early, the later phases follow it. Pass the override the doctor typed, if any.
 */
export function timingGate(c: SurgeryCase, step: TimedStep, now: Date = new Date(), override?: { reason: string; isDoctor: boolean }): Gate {
  const slot = slotStartAt(c);
  if (!slot) return open();
  if (now.getTime() + CLOCK_SLACK_MS >= slot.getTime()) return open();
  if (step !== "signIn" && c.signIn?.earlyStart) return open();
  if (!override) return shut(`The booked slot starts on ${when(slot)}. ${STEP_LABEL[step]} cannot start before then. A doctor can start early with a reason.`);
  if (!override.isDoctor) return shut("Only a doctor can start before the booked time.");
  if (blank(override.reason)) return shut("Give the reason for starting before the booked time.");
  return open();
}

/**
 * Checks on the times typed in the operative note: not in the future, and not before the booked slot (or before Sign In,
 * when a doctor started the case early). Returns the first problem, or null.
 */
export function opNoteTimingProblem(c: SurgeryCase, n: Partial<OpNoteData>, now: Date = new Date()): string | null {
  const start = parseLocalDateTime(n.start);
  const end = parseLocalDateTime(n.end);
  const limit = now.getTime() + CLOCK_SLACK_MS;
  if (start && start.getTime() > limit) return `The operation start time (${when(start)}) is in the future.`;
  if (end && end.getTime() > limit) return `The operation end time (${when(end)}) is in the future.`;
  const slot = slotStartAt(c);
  const signedIn = parseLocalDateTime(c.signIn?.done.at);
  const floor = slot && signedIn ? Math.min(slot.getTime(), signedIn.getTime()) : (slot ?? signedIn)?.getTime();
  if (floor !== undefined) {
    const lowest = new Date(floor);
    if (start && start.getTime() < floor) return `The operation start time (${when(start)}) is before the booked slot (${when(lowest)}).`;
    if (end && end.getTime() < floor) return `The operation end time (${when(end)}) is before the booked slot (${when(lowest)}).`;
  }
  return null;
}

/** The day the recovery times belong to: the day the operation ended, else the booked day, else today. */
function recoveryDay(c: SurgeryCase, now: Date): string {
  const end = c.opNote?.end;
  if (end && /^\d{4}-\d{2}-\d{2}/.test(end)) return end.slice(0, 10);
  return c.schedule?.date ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Recovery times are HH:mm. Arrival cannot be before the operation ended, and neither time can be in the future. */
export function recoveryTimingProblem(c: SurgeryCase, d: Partial<RecoveryData>, now: Date = new Date()): string | null {
  const day = recoveryDay(c, now);
  const arrival = parseLocal(day, d.arrivalTime);
  const out = parseLocal(day, d.timeOut);
  const limit = now.getTime() + CLOCK_SLACK_MS;
  if (arrival && arrival.getTime() > limit) return `The arrival time (${when(arrival)}) is in the future.`;
  if (out && out.getTime() > limit) return `The recovery Time Out (${when(out)}) is in the future.`;
  const opEnd = parseLocalDateTime(c.opNote?.end);
  if (arrival && opEnd && arrival.getTime() < opEnd.getTime()) return `The patient cannot arrive in recovery (${when(arrival)}) before the operation ended (${when(opEnd)}).`;
  return null;
}

/**
 * Closing the case. The closure time cannot be in the future or before the operation ended. A case cannot be closed as
 * Completed while the recorded end time of the operation has not passed.
 */
export function closureTimingProblem(c: SurgeryCase, outcome: CloseOutcome, d: Partial<ClosureDetails> | undefined, now: Date = new Date()): string | null {
  const opEnd = parseLocalDateTime(c.opNote?.end);
  const limit = now.getTime() + CLOCK_SLACK_MS;
  if (outcome === "Completed" && opEnd && opEnd.getTime() > limit) return `The case cannot be closed as Completed before the operation ended. The recorded end time is ${when(opEnd)}.`;
  const at = parseLocal(d?.date, d?.time);
  if (at && at.getTime() > limit) return `The closure time (${when(at)}) is in the future.`;
  if (at && opEnd && outcome === "Completed" && at.getTime() < opEnd.getTime()) return `The closure time (${when(at)}) is before the operation ended (${when(opEnd)}).`;
  return null;
}
