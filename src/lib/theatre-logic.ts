/**
 * The surgery pathway as pure rules: the steps, what each step needs before it can start, and the checks on what is entered.
 * No storage, no session and no React here. The store (theatre.ts) and the screens both ask these functions, so the gate
 * is the same everywhere and cannot be skipped by a screen that forgets to check.
 */

export type StepId = "request" | "assessment" | "schedule" | "preop" | "signIn" | "timeOut" | "signOut" | "opNote" | "recovery" | "close";

export const STEPS: { id: StepId; label: string; when?: string }[] = [
  { id: "request", label: "Surgery Request" },
  { id: "assessment", label: "Pre-anaesthesia Assessment" },
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

export const SIDES = ["Left", "Right", "Both", "Midline", "Not applicable"] as const;
export const URGENCIES = ["Elective", "Urgent (within 24 hours)", "Emergency (immediate)"] as const;
export const ANAESTHESIA_TYPES = ["General", "Spinal", "Epidural", "Regional block", "Local with sedation", "Local only"] as const;
export const THEATRE_ROOMS = ["Theatre 1", "Theatre 2", "Theatre 3", "Minor Theatre", "Cath Lab", "Labour Theatre"] as const;
export const ASSESSMENT_RESULTS = ["Fit", "Fit With High Risk", "Not Fit", "Needs More Tests"] as const;
export type AssessmentResult = (typeof ASSESSMENT_RESULTS)[number];
export const ASA_CLASSES = ["I", "II", "III", "IV", "V"] as const;

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
  /** Needed when the result is Not Fit or Needs More Tests: what is wrong or which tests. */
  notes?: string;
}

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

export type PreOpAnswer = "yes" | "na";
export interface PreOpItem {
  key: string;
  label: string;
  /** False for checks that can never be skipped. */
  naAllowed: boolean;
}

export const PREOP_ITEMS: PreOpItem[] = [
  { key: "identity", label: "Patient identity checked against the wristband", naAllowed: false },
  { key: "consent", label: "Consent for surgery signed", naAllowed: false },
  { key: "anaesthesiaConsent", label: "Consent for anaesthesia signed", naAllowed: true },
  { key: "siteMarked", label: "Operation site marked", naAllowed: true },
  { key: "fasting", label: "Fasting confirmed", naAllowed: true },
  { key: "allergies", label: "Allergies checked", naAllowed: false },
  { key: "blood", label: "Blood available", naAllowed: true },
  { key: "jewellery", label: "Jewellery, dentures and contact lenses removed", naAllowed: true },
  { key: "tests", label: "Test results are in the chart", naAllowed: true },
  { key: "medicines", label: "Medicines before surgery given, including the antibiotic if ordered", naAllowed: true },
  { key: "vitals", label: "Vital signs recorded", naAllowed: false },
];

export type PhaseId = "signIn" | "timeOut" | "signOut";
export const PHASE_ROLES = ["Surgeon", "Anaesthetist", "Circulating Nurse", "Scrub Nurse"] as const;
export type PhaseRole = (typeof PHASE_ROLES)[number];

/** WHO Surgical Safety Checklist, in plain words. `lead` is the role that normally confirms the phase. */
export const SAFETY_PHASES: Record<PhaseId, { label: string; when: string; lead: PhaseRole; roles: PhaseRole[]; items: { key: string; label: string }[] }> = {
  signIn: {
    label: "Sign In", when: "Before anaesthesia", lead: "Anaesthetist", roles: ["Anaesthetist", "Circulating Nurse"],
    items: [
      { key: "identity", label: "The patient confirmed name, operation, site and consent" },
      { key: "site", label: "The site is marked, or marking does not apply" },
      { key: "machine", label: "Anaesthesia machine and medicines are checked" },
      { key: "oximeter", label: "Pulse oximeter is on the patient and working" },
      { key: "allergy", label: "Allergies are known to the team" },
      { key: "airway", label: "Difficult airway and aspiration risk are checked, and help is ready if needed" },
      { key: "bloodLoss", label: "Risk of heavy blood loss is checked, and lines and fluids are ready if needed" },
    ],
  },
  timeOut: {
    label: "Time Out", when: "Before the first cut", lead: "Surgeon", roles: ["Surgeon", "Anaesthetist", "Circulating Nurse"],
    items: [
      { key: "introductions", label: "Everyone in the room said their name and role" },
      { key: "confirm", label: "Surgeon, anaesthetist and nurse confirmed the patient, the operation and the site aloud" },
      { key: "antibiotic", label: "Antibiotic was given in the last 60 minutes, or is not needed" },
      { key: "surgeonReview", label: "Surgeon reviewed the critical steps, the expected time and the expected blood loss" },
      { key: "anaesthesiaReview", label: "Anaesthetist reviewed any patient concerns" },
      { key: "nursingReview", label: "Nurses confirmed the instruments are sterile and the equipment is ready" },
      { key: "imaging", label: "Needed images are on display, or none are needed" },
    ],
  },
  signOut: {
    label: "Sign Out", when: "Before the patient leaves the room", lead: "Circulating Nurse", roles: ["Circulating Nurse", "Scrub Nurse", "Surgeon"],
    items: [
      { key: "procedure", label: "The name of the operation done is recorded" },
      { key: "counts", label: "Instrument, sponge and needle counts are correct" },
      { key: "specimens", label: "Specimens are labelled with the patient name, or there are none" },
      { key: "equipment", label: "Equipment problems are reported, or there were none" },
      { key: "recoveryPlan", label: "Surgeon, anaesthetist and nurse reviewed the main concerns for recovery" },
    ],
  },
};

export interface PhaseData {
  /** Keys of the ticked items. */
  checked: string[];
  confirmedRole: string;
  confirmedName: string;
}

export interface OpNoteData {
  /** Local date and time, YYYY-MM-DDTHH:mm */
  start: string;
  end: string;
  procedureDone: string;
  findings: string;
  anaesthesia?: string;
  bloodLossMl?: number;
  specimens?: string;
  complications?: string;
  plan?: string;
}

/* ---------- Aldrete recovery score ---------- */

export const ALDRETE_ITEMS: { key: AldreteKey; label: string; options: [string, string, string] }[] = [
  { key: "activity", label: "Activity", options: ["Cannot move arms or legs", "Moves two limbs", "Moves all four limbs"] },
  { key: "breathing", label: "Breathing", options: ["Not breathing without help", "Shallow or laboured breathing", "Breathes deeply and coughs"] },
  { key: "circulation", label: "Circulation", options: ["Blood pressure 50% or more away from the level before anaesthesia", "Blood pressure 20% to 49% away", "Blood pressure within 20%"] },
  { key: "consciousness", label: "Consciousness", options: ["Does not respond", "Wakes when called", "Fully awake"] },
  { key: "oxygen", label: "Oxygen saturation", options: ["Below 90% even with oxygen", "Needs oxygen to stay above 90%", "Above 92% on room air"] },
];
export type AldreteKey = "activity" | "breathing" | "circulation" | "consciousness" | "oxygen";
export type AldreteScores = Partial<Record<AldreteKey, number>>;
export const ALDRETE_PASS = 9;

/** Total of the five items, 0 to 10. Null until all five are scored, so a half-filled score never passes. */
export function aldreteTotal(s: AldreteScores): number | null {
  let total = 0;
  for (const i of ALDRETE_ITEMS) {
    const n = s[i.key];
    if (n !== 0 && n !== 1 && n !== 2) return null;
    total += n;
  }
  return total;
}

export interface RecoveryScore {
  scores: AldreteScores;
  total: number;
  stamp: Stamp;
}

export interface RecoveryDischarge {
  score: number;
  destination: string;
  /** Present when a doctor let the patient leave below the pass score. */
  override?: { reason: string; doctor: string };
}

export type CloseOutcome = "Completed" | "Cancelled" | "Incomplete";

export interface SurgeryCase {
  id: string;
  visit: string;
  patientId: string;
  request: RequestData & { done: Stamp };
  assessment?: AssessmentData & { done: Stamp };
  schedule?: ScheduleData & { done: Stamp };
  /** Answers can be saved bit by bit. `done` is only set when every item is answered. */
  preop?: { answers: Record<string, PreOpAnswer>; done?: Stamp };
  signIn?: PhaseData & { done: Stamp };
  timeOut?: PhaseData & { done: Stamp };
  signOut?: PhaseData & { done: Stamp };
  opNote?: OpNoteData & { done: Stamp };
  recovery?: { scores: RecoveryScore[]; discharge?: RecoveryDischarge & { done: Stamp } };
  closed?: { outcome: CloseOutcome; reason?: string; done: Stamp };
  /** Operation Request form record kept in step with this case, so the Operative Note document finds the times. */
  linkedRecordId?: string;
}

/* ---------- step state and the gate ---------- */

export const fitForSurgery = (r: AssessmentResult | undefined): boolean => r === "Fit" || r === "Fit With High Risk";

export function stepDone(c: SurgeryCase, step: StepId): boolean {
  switch (step) {
    case "request": return true;
    case "assessment": return !!c.assessment;
    case "schedule": return !!c.schedule;
    case "preop": return !!c.preop?.done;
    case "signIn": return !!c.signIn;
    case "timeOut": return !!c.timeOut;
    case "signOut": return !!c.signOut;
    case "opNote": return !!c.opNote;
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

/** Items of the pre-operative checklist that still need an answer. An answer of "na" is refused where it is not allowed. */
export function preOpMissing(answers: Record<string, PreOpAnswer> | undefined, side?: string): PreOpItem[] {
  const sided = side === "Left" || side === "Right" || side === "Both";
  return PREOP_ITEMS.filter((i) => {
    const a = answers?.[i.key];
    if (a === "yes") return false;
    if (a === "na") return !i.naAllowed || (i.key === "siteMarked" && sided);
    return true;
  });
}

/** True when this item may be answered "Does not apply" for this case. */
export const preOpNaAllowed = (item: PreOpItem, side?: string): boolean =>
  item.naAllowed && !(item.key === "siteMarked" && (side === "Left" || side === "Right" || side === "Both"));

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
      return c.schedule ? shut("The case is already scheduled.") : open();
    case "schedule":
      if (!c.assessment) return shut("Do the pre-anaesthesia assessment first.");
      if (!fitForSurgery(c.assessment.result)) {
        return shut(`The pre-anaesthesia result is ${c.assessment.result}. Only Fit or Fit With High Risk can be scheduled. Assess again when the patient is ready, or cancel the case.`);
      }
      return c.signIn ? shut("The case has started. The schedule cannot change now.") : open();
    case "preop":
      if (!c.schedule) return shut("Schedule the case first.");
      return c.signIn ? shut("Sign In is done. The pre-operative checklist cannot change now.") : open();
    case "signIn": {
      if (c.signIn) return shut("Sign In is already confirmed.");
      if (!c.schedule) return shut("Schedule the case first.");
      const left = preOpMissing(c.preop?.answers, c.request.side);
      if (left.length > 0 || !c.preop?.done) {
        return shut(left.length > 0 ? `The pre-operative checklist is not complete. ${left.length} ${left.length === 1 ? "item is" : "items are"} left.` : "Complete the pre-operative checklist first.");
      }
      return open();
    }
    case "timeOut":
      if (c.timeOut) return shut("Time Out is already confirmed.");
      return c.signIn ? open() : shut("Confirm Sign In first.");
    case "signOut":
      if (c.signOut) return shut("Sign Out is already confirmed.");
      return c.timeOut ? open() : shut("Confirm Time Out first.");
    case "opNote":
      return c.signOut ? open() : shut("Confirm Sign Out first.");
    case "recovery":
      if (c.recovery?.discharge) return shut("The patient has already left recovery.");
      return c.opNote ? open() : shut("Write the operative note first.");
  }
}

/** The first step that is not done. Null when the case is closed. */
export function currentStep(c: SurgeryCase): StepId | null {
  if (c.closed) return null;
  return STEPS.find((s) => !stepDone(c, s.id))?.id ?? null;
}

export type CaseStage = "Waiting For Assessment" | "Not Cleared" | "To Schedule" | "Scheduled" | "In Theatre" | "Note Needed" | "In Recovery" | "Ready To Close" | "Closed";

export function caseStage(c: SurgeryCase): CaseStage {
  if (c.closed) return "Closed";
  if (!c.assessment) return "Waiting For Assessment";
  if (!c.schedule) return fitForSurgery(c.assessment.result) ? "To Schedule" : "Not Cleared";
  if (!c.signIn) return "Scheduled";
  if (!c.signOut) return "In Theatre";
  if (!c.opNote) return "Note Needed";
  if (!c.recovery?.discharge) return "In Recovery";
  return "Ready To Close";
}

/** What the next person has to do, in a few words. */
export function nextAction(c: SurgeryCase): string {
  const step = currentStep(c);
  if (!step) return "No action needed";
  if (step === "schedule" && c.assessment && !fitForSurgery(c.assessment.result)) return c.assessment.result === "Needs More Tests" ? "Do the tests, then assess again" : "Assess again or cancel";
  if (step === "preop") {
    const left = preOpMissing(c.preop?.answers, c.request.side).length;
    return left ? `Pre-operative checklist, ${left} left` : "Confirm the pre-operative checklist";
  }
  if (step === "recovery") return c.recovery?.scores.length ? "Score again or discharge from recovery" : "Record the recovery score";
  if (step === "close") return "Close the case";
  return STEP_LABEL[step];
}

/* ---------- checks on what is entered ---------- */

const blank = (s: string | undefined) => !s || !s.trim();

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
  if (!fitForSurgery(a.result) && blank(a.notes)) return a.result === "Needs More Tests" ? "Say which tests are needed." : "Say why the patient is not fit.";
  if (a.result === "Fit With High Risk" && blank(a.notes)) return "Describe the high risk.";
  return null;
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const clock = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const scheduleEnd = (s: Pick<ScheduleData, "start" | "durationMin">): string => clock(minutes(s.start) + s.durationMin);

/** The case that already holds this room at this time, if any. Cancelled cases free their slot. */
export function roomClash(cases: SurgeryCase[], s: Pick<ScheduleData, "room" | "date" | "start" | "durationMin">, exceptId?: string): SurgeryCase | undefined {
  const a0 = minutes(s.start), a1 = a0 + s.durationMin;
  return cases.find((c) => {
    if (c.id === exceptId || !c.schedule || c.closed?.outcome === "Cancelled") return false;
    if (c.schedule.room !== s.room || c.schedule.date !== s.date) return false;
    const b0 = minutes(c.schedule.start), b1 = b0 + c.schedule.durationMin;
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

export function validatePhase(phase: PhaseId, d: Partial<PhaseData>): string | null {
  const def = SAFETY_PHASES[phase];
  const left = def.items.filter((i) => !d.checked?.includes(i.key));
  if (left.length > 0) return `${left.length} ${left.length === 1 ? "check is" : "checks are"} not ticked. Every check must be done before ${def.label} is confirmed.`;
  if (blank(d.confirmedRole) || !(def.roles as string[]).includes(d.confirmedRole!)) return `Choose who confirms ${def.label}.`;
  if (blank(d.confirmedName)) return "Enter the name of the person who confirms.";
  return null;
}

export function validateOpNote(n: Partial<OpNoteData>): string | null {
  if (blank(n.start)) return "Enter when the operation started.";
  if (blank(n.end)) return "Enter when the operation ended.";
  if (n.end! <= n.start!) return "The end time must be after the start time.";
  if (blank(n.procedureDone)) return "Enter the operation that was done.";
  if (blank(n.findings)) return "Enter the findings.";
  if (n.bloodLossMl !== undefined && n.bloodLossMl < 0) return "Blood loss cannot be below zero.";
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

/** Both operation times are known, so the Operative Note document can be built and published. */
export const readyForOperativeNote = (c: SurgeryCase): boolean => !!c.opNote?.start && !!c.opNote?.end;
