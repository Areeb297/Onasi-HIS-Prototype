import { beforeEach, describe, expect, it } from "vitest";
import { getFormRecords, resetRecords } from "./records";
import { switchUser } from "./session";
import {
  caseById, clearTheatre, closeCase, confirmPhase, confirmSchedule, postponeSchedule, requestSurgery, saveAssessment, saveOpNote, savePhaseDraft, savePreOp,
  saveRecovery, saveSchedule,
} from "./theatre";
import {
  ALDRETE_ITEMS, ALDRETE_MAX, PREOP_ITEMS, SAFETY_PHASES, STEPS, aldreteMaxOf, aldreteTotal, caseStage, closeGate, confirmGate, currentStep, fitForSurgery,
  latestAldrete, nextAction, phaseUnanswered, postponeGate, preOpMissing, preOpProblems, readyForOperativeNote, recoveryDischargeGate, roomClash, scheduleStatus,
  stepDone, stepGate, validateAssessment, validateClosure, validateOpNote, validatePhase, validateRecovery, validateRequest, validateSchedule, validateScheduleDraft,
  type AldreteScores, type ClosureDetails, type OpNoteData, type PhaseData, type PhaseId, type PhaseInput, type PreOpAnswer, type PreOpData, type RecoveryData,
  type SafetyAnswer, type SafetySigners, type ScheduleData, type Stamp, type SurgeryCase,
} from "./theatre-logic";

const stamp: Stamp = { by: "Dr. Test", role: "Physician", at: "2026-03-09T08:00:00.000Z" };
const allYes = (): Record<string, PreOpAnswer> => Object.fromEntries(PREOP_ITEMS.map((i) => [i.key, "yes" as const]));
const fullPreop = (patch: Partial<PreOpData> = {}): PreOpData => ({
  answers: allYes(), checklistDate: "2026-03-10", reviewed: { allergy: true, vitals: true, medication: true, investigations: true },
  wardNurse: { name: "Ward Nurse", signed: true }, theatreNurse: { name: "Theatre Nurse", signed: true }, ...patch,
});
const signers: SafetySigners = { surgeon: { name: "Dr. S", signed: true }, anaesthetist: { name: "Dr. A", signed: true }, nurse: { name: "Nurse C", signed: true } };
/** Every check Yes, every question and risk No, every required text filled. */
const phaseData = (id: PhaseId): PhaseData => {
  const items = SAFETY_PHASES[id].items;
  const answers: Record<string, SafetyAnswer> = Object.fromEntries(items.filter((i) => i.kind !== "text").map((i) => [i.key, i.kind === "check" ? "Yes" : "No"]));
  const texts = Object.fromEntries(items.filter((i) => i.kind === "text" && i.required).map((i) => [i.key, "Stated"]));
  return { answers, texts, confirmedRole: SAFETY_PHASES[id].lead, confirmedName: "Named Person" };
};
const phase = (id: PhaseId): PhaseInput => ({ ...phaseData(id), signers });
const slot: ScheduleData = { room: "Theatre 1", date: "2026-03-10", start: "09:00", durationMin: 90, anaesthetist: "Dr. A", scrubNurse: "Nurse S", circulatingNurse: "Nurse C" };
const full: AldreteScores = { activity: 2, breathing: 2, circulation: 2, consciousness: 2, colour: 2, oxygen: 2 };
const note = (patch: Partial<OpNoteData> = {}): OpNoteData => ({
  start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Appendicectomy", findings: "Inflamed appendix", noteDate: "2026-03-10",
  team: [{ role: "Surgeon", staff: "Dr. S", primary: true }], complication: false, complications: "None", specimenToPathology: true, specimens: "Appendix to histopathology",
  countCorrect: true, signingSurgeon: "Dr. S", ...patch,
});
const recovery = (discharge: AldreteScores = full, patch: Partial<RecoveryData> = {}): RecoveryData => ({
  arrivalTime: "10:30", responsibleNurse: "Nurse R", inPain: false, painIntensity: 0, aldrete: { admission: { ...full, consciousness: 1 }, discharge },
  observations: "Stable, wound dry", conditionOnTransfer: "Awake and comfortable", destination: "Ward", ...patch,
});
const closure: ClosureDetails = { date: "2026-03-10", time: "14:00", disposition: "Returned To Ward" };

/** A case built up to (and including) the given step. */
function caseAt(upTo: (typeof STEPS)[number]["id"], patch: Partial<SurgeryCase> = {}): SurgeryCase {
  const order = STEPS.map((s) => s.id);
  const has = (s: string) => order.indexOf(s as never) <= order.indexOf(upTo);
  const c: SurgeryCase = {
    id: "SC-1", visit: "V1", patientId: "P1",
    request: { procedure: "Appendicectomy", side: "Not applicable", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10", done: stamp },
  };
  if (has("assessment")) c.assessment = { result: "Fit For Anesthesia", done: stamp };
  if (has("schedule")) c.schedule = { ...slot, status: "Confirmed", done: stamp };
  if (has("preop")) c.preop = { ...fullPreop(), done: stamp };
  if (has("signIn")) c.signIn = { ...phaseData("signIn"), done: stamp };
  if (has("timeOut")) c.timeOut = { ...phaseData("timeOut"), done: stamp };
  if (has("signOut")) c.signOut = { ...phaseData("signOut"), done: stamp };
  if (has("opNote")) c.opNote = { ...note(), status: "Completed", done: stamp };
  if (has("recovery")) c.recovery = { scores: [], form: recovery(), discharge: { score: 12, destination: "Ward", done: stamp } };
  if (has("close")) c.closed = { outcome: "Completed", ...closure, done: stamp };
  return { ...c, ...patch };
}

describe("the steps run in order", () => {
  it("opens exactly the next step and keeps every later step shut", () => {
    const order = STEPS.map((s) => s.id);
    for (let n = 0; n < order.length - 2; n++) {
      const c = caseAt(order[n]);
      expect(currentStep(c), `after ${order[n]}`).toBe(order[n + 1]);
      expect(stepGate(c, order[n + 1]).ok, `${order[n + 1]} after ${order[n]}`).toBe(true);
      for (const later of order.slice(n + 2, -1)) {
        const g = stepGate(c, later);
        expect(g.ok, `${later} must wait after ${order[n]}`).toBe(false);
        expect(g.reason.length, `${later} needs a reason`).toBeGreaterThan(10);
      }
    }
  });

  it("marks each step done only when its data is there", () => {
    const c = caseAt("schedule");
    expect(STEPS.filter((s) => stepDone(c, s.id)).map((s) => s.id)).toEqual(["request", "assessment", "schedule"]);
  });

  it("names the stage and the next action", () => {
    expect(caseStage(caseAt("request"))).toBe("Waiting For Assessment");
    expect(caseStage(caseAt("assessment"))).toBe("To Schedule");
    expect(caseStage(caseAt("assessment", { assessment: { result: "Not Fit For Anesthesia", notes: "Chest infection", done: stamp } }))).toBe("Not Cleared");
    expect(caseStage(caseAt("preop"))).toBe("Scheduled");
    expect(caseStage(caseAt("timeOut"))).toBe("In Theatre");
    expect(caseStage(caseAt("signOut"))).toBe("Note Needed");
    expect(caseStage(caseAt("opNote"))).toBe("In Recovery");
    expect(caseStage(caseAt("recovery"))).toBe("Ready To Close");
    expect(caseStage(caseAt("close"))).toBe("Closed");
    expect(nextAction(caseAt("request"))).toBe("Pre-Anesthesia Assessment");
    expect(nextAction(caseAt("schedule"))).toBe(`Pre-operative checklist, ${PREOP_ITEMS.length} left`);
    expect(nextAction(caseAt("close"))).toBe("No action needed");
  });

  it("locks a closed case", () => {
    const c = caseAt("assessment", { closed: { outcome: "Cancelled", reason: "Patient declined", ...closure, done: stamp } });
    for (const s of STEPS) expect(stepGate(c, s.id).ok, s.id).toBe(false);
    expect(currentStep(c)).toBeNull();
  });

  it("still opens a case saved before drafts, statuses and the new fields existed", () => {
    // The shape the earlier version wrote: ticked phases, no schedule status, no note status, five-item Aldrete scores.
    const old = {
      id: "SC-9", visit: "V1", patientId: "P1",
      request: { procedure: "Hernia repair", side: "Left", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10", done: stamp },
      assessment: { result: "Fit For Anesthesia", done: stamp },
      schedule: { ...slot, done: stamp },
      preop: { answers: allYes(), done: stamp },
      signIn: { checked: ["identity"], confirmedRole: "Anaesthetist", confirmedName: "Dr. A", done: stamp },
      timeOut: { checked: ["introductions"], confirmedRole: "Surgeon", confirmedName: "Dr. S", done: stamp },
      signOut: { checked: ["counts"], confirmedRole: "Circulating Nurse", confirmedName: "Nurse C", done: stamp },
      opNote: { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Hernia repair", findings: "Indirect hernia", done: stamp },
      recovery: { scores: [{ scores: { activity: 2, breathing: 2, circulation: 2, consciousness: 1, oxygen: 2 }, total: 9, stamp }] },
    } as SurgeryCase;
    expect(scheduleStatus(old)).toBe("Completed");
    expect(stepDone(old, "schedule")).toBe(true);
    expect(stepDone(old, "opNote")).toBe(true);
    expect(readyForOperativeNote(old)).toBe(true);
    expect(currentStep(old)).toBe("recovery");
    expect(caseStage(old)).toBe("In Recovery");
    expect(latestAldrete(old)).toEqual({ total: 9, max: 10, when: "Earlier" });
    expect(stepGate(old, "recovery").ok).toBe(true);
  });
});

describe("pre-anaesthesia assessment gates the schedule", () => {
  it("lets only Fit and Fit With High Risk be scheduled", () => {
    expect(fitForSurgery("Fit For Anesthesia")).toBe(true);
    expect(fitForSurgery("Fit With High Risk")).toBe(true);
    expect(fitForSurgery("Not Fit For Anesthesia")).toBe(false);
    expect(fitForSurgery("Need More Investigation")).toBe(false);
    for (const result of ["Not Fit For Anesthesia", "Need More Investigation"] as const) {
      const g = stepGate(caseAt("assessment", { assessment: { result, notes: "x", done: stamp } }), "schedule");
      expect(g.ok).toBe(false);
      expect(g.reason).toContain(result);
    }
    expect(stepGate(caseAt("assessment", { assessment: { result: "Fit With High Risk", notes: "Heart failure", done: stamp } }), "schedule").ok).toBe(true);
    expect(stepGate(caseAt("request"), "schedule").reason).toBe("Do the pre-anaesthesia assessment first.");
  });

  it("lets the patient be assessed again until the case is booked", () => {
    expect(stepGate(caseAt("assessment", { assessment: { result: "Need More Investigation", notes: "ECG", done: stamp } }), "assessment").ok).toBe(true);
    expect(stepGate(caseAt("schedule"), "assessment").ok).toBe(false);
    expect(stepGate(caseAt("schedule", { schedule: { ...slot, status: "Postponed", done: stamp } }), "assessment").ok).toBe(true);
  });

  it("asks for the reason behind a result that is not a plain Fit", () => {
    expect(validateAssessment({})).toBeTruthy();
    expect(validateAssessment({ result: "Fit For Anesthesia" })).toBeNull();
    expect(validateAssessment({ result: "Not Fit For Anesthesia" })).toBe("Say why the patient is not fit.");
    expect(validateAssessment({ result: "Need More Investigation" })).toBe("Say which tests are needed.");
    expect(validateAssessment({ result: "Fit With High Risk" })).toBe("Describe the high risk.");
    expect(validateAssessment({ result: "Need More Investigation", notes: "Echocardiogram" })).toBeNull();
  });
});

describe("request and schedule checks", () => {
  it("needs procedure, side, surgeon, urgency and planned date", () => {
    const ok = { procedure: "Hernia repair", side: "Left", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10" };
    expect(validateRequest(ok)).toBeNull();
    for (const k of Object.keys(ok) as (keyof typeof ok)[]) expect(validateRequest({ ...ok, [k]: " " }), k).toBeTruthy();
  });

  it("refuses two cases in the same room at the same time", () => {
    const booked = caseAt("schedule");
    const at = (start: string, durationMin = 60, room = "Theatre 1", date = "2026-03-10") => ({ ...slot, start, durationMin, room, date });
    expect(roomClash([booked], at("09:30"))?.id).toBe("SC-1");
    expect(roomClash([booked], at("08:00", 61))?.id).toBe("SC-1");
    expect(roomClash([booked], at("08:00", 240))?.id).toBe("SC-1");
    expect(roomClash([booked], at("08:00", 60))).toBeUndefined(); // ends as the other starts
    expect(roomClash([booked], at("10:30"))).toBeUndefined(); // starts as the other ends
    expect(roomClash([booked], at("09:30", 60, "Theatre 2"))).toBeUndefined();
    expect(roomClash([booked], at("09:30", 60, "Theatre 1", "2026-03-11"))).toBeUndefined();
    expect(roomClash([booked], at("09:30"), "SC-1")).toBeUndefined(); // moving the same case
    expect(roomClash([{ ...booked, closed: { outcome: "Cancelled", reason: "x", ...closure, done: stamp } }], at("09:30"))).toBeUndefined();
    expect(validateSchedule(at("09:30"), [booked])).toContain("Theatre 1 is already booked on 2026-03-10 from 09:00 to 10:30");
  });

  it("does not hold the room for a draft or a postponed slot", () => {
    for (const status of ["Draft", "Postponed"] as const) {
      expect(roomClash([caseAt("schedule", { schedule: { ...slot, status, done: stamp } })], { ...slot, start: "09:30" }), status).toBeUndefined();
    }
    expect(roomClash([caseAt("schedule", { schedule: { ...slot, done: stamp } })], { ...slot, start: "09:30" })?.id).toBe("SC-1"); // older cases have no status
  });

  it("needs a room, a time and a full team to schedule, but a draft may be partial", () => {
    expect(validateSchedule(slot, [])).toBeNull();
    for (const k of ["room", "date", "start", "anaesthetist", "scrubNurse", "circulatingNurse"] as const) expect(validateSchedule({ ...slot, [k]: "" }, []), k).toBeTruthy();
    expect(validateSchedule({ ...slot, durationMin: 0 }, [])).toBeTruthy();
    expect(validateSchedule({ ...slot, scrubNurse: "Nurse C" }, [])).toContain("two people");
    expect(validateScheduleDraft({ room: "Theatre 1", date: "", start: "", durationMin: 0, anaesthetist: "", scrubNurse: "", circulatingNurse: "" })).toBeNull();
    expect(validateScheduleDraft({ ...slot, start: "9" })).toBeTruthy();
    expect(validateScheduleDraft({ ...slot, scrubNurse: "Nurse C" })).toContain("two people");
  });
});

describe("schedule status", () => {
  it("runs Draft, Scheduled, Confirmed, In Progress, Completed", () => {
    expect(scheduleStatus(caseAt("assessment"))).toBeNull();
    expect(scheduleStatus(caseAt("schedule", { schedule: { ...slot, status: "Draft", done: stamp } }))).toBe("Draft");
    expect(scheduleStatus(caseAt("schedule", { schedule: { ...slot, status: "Scheduled", done: stamp } }))).toBe("Scheduled");
    expect(scheduleStatus(caseAt("preop"))).toBe("Confirmed");
    expect(scheduleStatus(caseAt("timeOut"))).toBe("In Progress");
    expect(scheduleStatus(caseAt("signOut"))).toBe("Completed");
    expect(scheduleStatus(caseAt("preop", { closed: { outcome: "Cancelled", reason: "Declined", ...closure, done: stamp } }))).toBe("Cancelled");
  });

  it("keeps a draft or postponed slot as not scheduled", () => {
    const draft = caseAt("schedule", { schedule: { ...slot, status: "Draft", done: stamp } });
    expect(stepDone(draft, "schedule")).toBe(false);
    expect(caseStage(draft)).toBe("To Schedule");
    expect(nextAction(draft)).toBe("Finish the schedule draft");
    expect(stepGate(draft, "preop").reason).toBe("Schedule the case first.");
    const later = caseAt("preop", { schedule: { ...slot, status: "Postponed", done: stamp } });
    expect(caseStage(later)).toBe("Postponed");
    expect(nextAction(later)).toBe("Postponed: schedule again");
    expect(stepGate(later, "signIn").ok).toBe(false);
    expect(stepGate(later, "schedule").ok).toBe(true);
  });

  it("needs the slot confirmed before Sign In", () => {
    const c = caseAt("preop", { schedule: { ...slot, status: "Scheduled", done: stamp } });
    expect(stepGate(c, "signIn").reason).toContain("Confirm the schedule first");
    expect(nextAction(c)).toBe("Confirm the schedule");
    expect(confirmGate(c).ok).toBe(true);
    expect(confirmGate(caseAt("preop")).reason).toBe("The schedule is already confirmed.");
    expect(confirmGate(caseAt("schedule", { schedule: { ...slot, status: "Draft", done: stamp } })).ok).toBe(false);
    expect(confirmGate(caseAt("assessment")).ok).toBe(false);
  });

  it("postpones only before the case starts, with a reason", () => {
    expect(postponeGate(caseAt("preop"), "Surgeon called to an emergency").ok).toBe(true);
    expect(postponeGate(caseAt("schedule", { schedule: { ...slot, status: "Draft", done: stamp } }), "x").ok).toBe(true);
    expect(postponeGate(caseAt("preop"), " ").reason).toBe("Give the reason for postponing.");
    expect(postponeGate(caseAt("signIn"), "x").ok).toBe(false);
    expect(postponeGate(caseAt("assessment"), "x").ok).toBe(false);
    expect(postponeGate(caseAt("schedule", { schedule: { ...slot, status: "Postponed", done: stamp } }), "x").reason).toBe("The case is already postponed.");
  });
});

describe("the case cannot start with an incomplete pre-operative checklist", () => {
  it("keeps Sign In shut until the checklist is complete", () => {
    const p = fullPreop();
    delete p.answers.consent;
    const c = caseAt("schedule", { preop: p });
    expect(preOpMissing(p.answers).map((i) => i.key)).toEqual(["consent"]);
    const g = stepGate(c, "signIn");
    expect(g.ok).toBe(false);
    expect(g.reason).toBe("The pre-operative checklist is not complete. 1 item is left.");
    expect(stepGate(caseAt("schedule"), "signIn").ok).toBe(false);
    expect(stepGate(caseAt("preop"), "signIn").ok).toBe(true);
    expect(stepGate(caseAt("schedule", { preop: fullPreop() }), "signIn").reason).toBe("Complete the pre-operative checklist first."); // answered but never completed
  });

  it("does not trust a done mark on a checklist that has gaps", () => {
    const p = fullPreop();
    delete p.answers.allergies;
    expect(stepGate(caseAt("schedule", { preop: { ...p, done: stamp } }), "signIn").ok).toBe(false);
    expect(stepGate(caseAt("schedule", { preop: { ...fullPreop({ reviewed: {} }), done: stamp } }), "signIn").ok).toBe(false);
  });

  it("accepts N/A or No only where allowed, and No only with a remark", () => {
    expect(preOpMissing({ ...allYes(), consent: "na" }).map((i) => i.key)).toEqual(["consent"]);
    expect(preOpMissing({ ...allYes(), identity: "na", allergies: "no", vitals: "na" }, undefined, { allergies: "Not asked" })).toHaveLength(3);
    expect(preOpMissing({ ...allYes(), blood: "na", jewellery: "na" })).toEqual([]);
    expect(preOpMissing({ ...allYes(), jewellery: "no" }).map((i) => i.key)).toEqual(["jewellery"]);
    expect(preOpMissing({ ...allYes(), jewellery: "no" }, undefined, { jewellery: "Wedding ring taped" })).toEqual([]);
  });

  it("needs the site marked when the operation has a side", () => {
    const answers = { ...allYes(), siteMarked: "na" as const };
    expect(preOpMissing(answers, "Not applicable")).toEqual([]);
    expect(preOpMissing(answers, "Left").map((i) => i.key)).toEqual(["siteMarked"]);
    expect(preOpMissing({ ...allYes(), siteMarked: "no" }, "Left", { siteMarked: "Forgot" }).map((i) => i.key)).toEqual(["siteMarked"]);
    expect(stepGate(caseAt("preop", { preop: { ...fullPreop({ answers }), done: stamp }, request: { ...caseAt("request").request, side: "Right" } }), "signIn").ok).toBe(false);
  });

  it("needs the date, the four reviews and both nurse signatures", () => {
    expect(preOpProblems(fullPreop())).toEqual([]);
    expect(preOpProblems(fullPreop({ checklistDate: "" }))).toEqual(["Enter the checklist date."]);
    expect(preOpProblems(fullPreop({ reviewed: { allergy: true, vitals: true } }))).toEqual(["Tick Medication Reviewed.", "Tick Investigation Reviewed."]);
    expect(preOpProblems(fullPreop({ wardNurse: undefined }))).toEqual(["Choose the ward nurse."]);
    expect(preOpProblems(fullPreop({ theatreNurse: { name: "Theatre Nurse" } }))).toEqual(["The theatre nurse has not signed."]);
    expect(preOpProblems(fullPreop({ theatreNurse: { name: "Ward Nurse", signed: true } }))).toContain("The ward nurse and the theatre nurse must be two people.");
    expect(preOpProblems(fullPreop({ answers: { ...allYes(), fasting: "no" } }))).toEqual(['"NPO from midnight" is answered No. Write a remark that says why.']);
    expect(preOpProblems(fullPreop({ answers: { ...allYes(), vitals: "no" } }))).toEqual(['"Vital signs recorded" must be Yes before the operation.']);
    expect(preOpProblems(undefined).length).toBeGreaterThan(5);
  });

  it("freezes the schedule and the pre-operative checklist once the case has started", () => {
    expect(stepGate(caseAt("signIn"), "schedule").ok).toBe(false);
    expect(stepGate(caseAt("signIn"), "preop").ok).toBe(false);
    expect(stepGate(caseAt("preop"), "schedule").ok).toBe(true);
  });
});

describe("surgical safety checklist", () => {
  it("runs Sign In, Time Out and Sign Out strictly in that order", () => {
    expect(stepGate(caseAt("preop"), "timeOut").reason).toBe("Confirm Sign In first.");
    expect(stepGate(caseAt("signIn"), "signOut").reason).toBe("Confirm Time Out first.");
    expect(stepGate(caseAt("timeOut"), "opNote").reason).toBe("Confirm Sign Out first.");
    expect(stepGate(caseAt("signIn"), "signIn").ok).toBe(false);
  });

  it("has the HIS items in each stage", () => {
    const keys = (id: PhaseId) => SAFETY_PHASES[id].items.map((i) => i.key);
    expect(keys("signIn")).toEqual(expect.arrayContaining(["identity", "procedure", "consent", "siteMarked", "airway", "bloodLoss"]));
    expect(keys("timeOut")).toEqual(expect.arrayContaining(["patient", "procedure", "site", "side", "position", "implants", "criticalSteps", "duration", "bloodLossExpected", "anaesthesiaConcerns", "nursingConcerns"]));
    expect(keys("signOut")).toEqual(expect.arrayContaining(["procedureName", "equipmentProblems", "recoveryConcerns"]));
  });

  it("confirms a phase only when every item is answered and a role is named", () => {
    for (const id of ["signIn", "timeOut", "signOut"] as const) {
      const ok = phase(id);
      expect(validatePhase(id, ok), id).toBeNull();
      const firstKey = Object.keys(ok.answers!)[0];
      const less = { ...ok.answers };
      delete less[firstKey];
      expect(validatePhase(id, { ...ok, answers: less }), id).toContain("1 item is not answered");
      expect(validatePhase(id, { ...ok, answers: {} }), id).toBeTruthy();
      expect(validatePhase(id, { ...ok, confirmedRole: "" }), id).toBeTruthy();
      expect(validatePhase(id, { ...ok, confirmedRole: "Porter" }), id).toBeTruthy();
      expect(validatePhase(id, { ...ok, confirmedName: "  " }), id).toBeTruthy();
      expect(SAFETY_PHASES[id].roles).toContain(SAFETY_PHASES[id].lead);
    }
  });

  it("refuses a check answered No, but accepts a No to a question", () => {
    const ok = phase("signIn");
    expect(validatePhase("signIn", { ...ok, answers: { ...ok.answers, oximeter: "No" } })).toContain("is answered No");
    expect(validatePhase("signIn", { ...ok, answers: { ...ok.answers, allergy: "Yes" } })).toBeNull();
    expect(validatePhase("signIn", { ...ok, answers: { ...ok.answers, siteMarked: "N/A" } })).toBeNull();
    expect(validatePhase("timeOut", { ...phase("timeOut"), answers: { ...phase("timeOut").answers, antibiotic: "No" } })).toContain("cannot be answered No");
  });

  it("needs the details when an airway or blood loss risk is Yes", () => {
    const ok = phase("signIn");
    expect(validatePhase("signIn", { ...ok, answers: { ...ok.answers, airway: "Yes" } })).toBe("Enter the airway risk details.");
    expect(validatePhase("signIn", { ...ok, answers: { ...ok.answers, airway: "Yes" }, texts: { airway: "Video laryngoscope ready" } })).toBeNull();
    expect(validatePhase("signIn", { ...ok, answers: { ...ok.answers, bloodLoss: "Yes" } })).toBe("Enter the blood loss risk details.");
  });

  it("needs the critical steps, duration and blood loss said at Time Out", () => {
    const ok = phase("timeOut");
    expect(phaseUnanswered("timeOut", { ...ok, texts: {} }).map((i) => i.key)).toEqual(["criticalSteps", "duration", "bloodLossExpected"]);
    expect(validatePhase("timeOut", { ...ok, texts: { ...ok.texts, duration: " " } })).toContain("1 item is not answered");
  });

  it("needs the surgeon, the anaesthetist and the nurse to sign before Sign Out", () => {
    const ok = phase("signOut");
    expect(validatePhase("signOut", { ...ok, signers: { ...signers, surgeon: { name: "Dr. S" } } })).toContain("signature of the surgeon");
    expect(validatePhase("signOut", { ...ok, signers: {} })).toContain("the surgeon, the anaesthetist, the nurse");
    expect(validatePhase("signIn", { ...phase("signIn"), signers: {} })).toBeNull(); // only Sign Out needs all three
  });
});

describe("operative note", () => {
  it("saves a draft with only the operation done", () => {
    expect(validateOpNote({ procedureDone: "Appendicectomy" }, "draft")).toBeNull();
    expect(validateOpNote({ procedureDone: "" }, "draft")).toBe("Enter the operation that was done.");
    expect(validateOpNote({ procedureDone: "x", start: "2026-03-10T10:00", end: "2026-03-10T09:00" }, "draft")).toBe("The end time must be after the start time.");
    expect(validateOpNote({ procedureDone: "x", bloodLossMl: -1 }, "draft")).toBeTruthy();
  });

  it("needs times, findings, a surgeon on the team and the yes or no answers to complete", () => {
    expect(validateOpNote(note())).toBeNull();
    expect(validateOpNote(note({ start: "" }))).toBeTruthy();
    expect(validateOpNote(note({ end: "" }))).toBeTruthy();
    expect(validateOpNote(note({ end: "2026-03-10T09:10" }))).toBe("The end time must be after the start time.");
    expect(validateOpNote(note({ findings: "" }))).toBeTruthy();
    expect(validateOpNote(note({ noteDate: "" }))).toBe("Enter the note date.");
    expect(validateOpNote(note({ team: [{ role: "Scrub Nurse", staff: "Nurse S" }] }))).toBe("Add at least one surgeon to the surgical team.");
    expect(validateOpNote(note({ complication: true, complications: "" }))).toBe("Enter the complication details.");
    expect(validateOpNote(note({ specimenToPathology: undefined }))).toBe("Answer Specimen Sent To Pathology.");
    expect(validateOpNote(note({ specimenToPathology: true, specimens: " " }))).toBe("Enter the specimen type.");
    expect(validateOpNote(note({ transfusion: true }))).toBe("Enter the transfusion volume in mL.");
    expect(validateOpNote(note({ transfusion: true, transfusionMl: 300 }))).toBeNull();
    expect(validateOpNote(note({ countCorrect: undefined }))).toBe("Answer Instrument And Swab Count Correct.");
    expect(validateOpNote(note({ signingSurgeon: "" }))).toBe("Choose the surgeon who signs the note.");
  });

  it("checks the surgical team rows", () => {
    const team = note().team!;
    expect(validateOpNote(note({ team: [...team, { role: "Surgeon", staff: "Dr. S" }] }))).toContain("cannot be added twice");
    expect(validateOpNote(note({ team: [...team, { role: "", staff: "Dr. X" }] }))).toContain("needs a role");
    expect(validateOpNote(note({ team: [...team, { role: "Surgeon", staff: "Dr. X", primary: true }] }))).toBe("Only one surgeon can be primary.");
  });

  it("opens recovery and the document only for a completed note, and then locks it", () => {
    const draft = caseAt("signOut", { opNote: { ...note(), status: "Draft", saved: stamp } });
    expect(stepDone(draft, "opNote")).toBe(false);
    expect(stepGate(draft, "opNote").ok).toBe(true);
    expect(stepGate(draft, "recovery").reason).toBe("Complete and sign the operative note first.");
    expect(readyForOperativeNote(draft)).toBe(false);
    expect(nextAction(draft)).toBe("Complete and sign the operative note");
    expect(readyForOperativeNote(caseAt("signOut"))).toBe(false);
    expect(readyForOperativeNote(caseAt("opNote"))).toBe(true);
    expect(stepGate(caseAt("opNote"), "opNote").ok).toBe(false);
  });
});

describe("recovery", () => {
  it("totals the six Aldrete items only when all are scored", () => {
    expect(ALDRETE_ITEMS.map((i) => i.key)).toEqual(["activity", "breathing", "circulation", "consciousness", "colour", "oxygen"]);
    expect(ALDRETE_MAX).toBe(12);
    expect(aldreteTotal(full)).toBe(12);
    expect(aldreteTotal({ ...full, oxygen: 1, activity: 0 })).toBe(9);
    expect(aldreteTotal({ ...full, colour: undefined })).toBeNull();
    expect(aldreteTotal({})).toBeNull();
    expect(aldreteTotal(undefined)).toBeNull();
    expect(aldreteMaxOf(full)).toBe(12);
    expect(aldreteMaxOf({ activity: 2, breathing: 2, circulation: 2, consciousness: 2, oxygen: 2 })).toBe(10);
  });

  it("uses the discharge score, then the admission score, then an earlier score", () => {
    const c = caseAt("opNote", { recovery: { scores: [{ scores: {}, total: 7, stamp }], form: { aldrete: { admission: { ...full, consciousness: 0 } } } } });
    expect(latestAldrete(c)).toEqual({ total: 10, max: 12, when: "Admission" });
    expect(latestAldrete(caseAt("recovery"))).toEqual({ total: 12, max: 12, when: "Discharge" });
    expect(latestAldrete(caseAt("opNote"))).toBeNull();
  });

  it("lets the patient leave at 9 or more", () => {
    expect(recoveryDischargeGate(9).ok).toBe(true);
    expect(recoveryDischargeGate(12).ok).toBe(true);
    expect(recoveryDischargeGate(8).ok).toBe(false);
    expect(recoveryDischargeGate(null).ok).toBe(false);
    expect(recoveryDischargeGate(undefined).reason).toBe("Record a full Aldrete score first.");
  });

  it("below 9 needs a doctor and a reason", () => {
    expect(recoveryDischargeGate(7, { reason: "Going to intensive care on a ventilator", isDoctor: true }).ok).toBe(true);
    expect(recoveryDischargeGate(7, { reason: "Going to intensive care", isDoctor: false }).reason).toBe("Only a doctor can override the recovery score.");
    expect(recoveryDischargeGate(7, { reason: "  ", isDoctor: true }).reason).toBe("Give the reason for the override.");
    expect(recoveryDischargeGate(null, { reason: "x", isDoctor: true }).ok).toBe(false);
  });

  it("saves a partial draft but needs the required items to complete", () => {
    expect(validateRecovery({}, "draft")).toBeNull();
    expect(validateRecovery({ painIntensity: 11 }, "draft")).toBe("Pain intensity must be between 0 and 10.");
    expect(validateRecovery({ arrivalTime: "10:30", timeOut: "10:00" }, "draft")).toBe("Time Out cannot be before the arrival time.");
    expect(validateRecovery({ vitals: { spo2: 120 } }, "draft")).toBeTruthy();
    expect(validateRecovery(recovery())).toBeNull();
    expect(validateRecovery(recovery(full, { arrivalTime: "" }))).toBe("Enter the arrival time.");
    expect(validateRecovery(recovery(full, { responsibleNurse: "" }))).toBe("Choose the responsible nurse.");
    expect(validateRecovery(recovery(full, { inPain: undefined }))).toBe("Answer whether the patient is in pain.");
    expect(validateRecovery(recovery(full, { inPain: true, painIntensity: undefined }))).toBe("Choose the pain intensity.");
    expect(validateRecovery(recovery(full, { inPain: true, painIntensity: 4 }))).toBe("Choose the pain tool.");
    expect(validateRecovery(recovery(full, { inPain: true, painIntensity: 4, painTool: "Numerical" }))).toBeNull();
    expect(validateRecovery(recovery({ ...full, colour: undefined }))).toBe("Score all six Aldrete items at discharge.");
    expect(validateRecovery(recovery(full, { aldrete: { discharge: full } }))).toBe("Score all six Aldrete items on admission.");
    expect(validateRecovery(recovery(full, { checks: { complications: true } }))).toBe("Enter the complication details.");
    expect(validateRecovery(recovery(full, { observations: "" }))).toBe("Enter the nursing observations.");
    expect(validateRecovery(recovery(full, { conditionOnTransfer: "" }))).toBe("Enter the condition on transfer.");
    expect(validateRecovery(recovery(full, { destination: "" }))).toBe("Choose where the patient goes.");
  });
});

describe("closing a case", () => {
  it("closes as Completed only after recovery", () => {
    expect(closeGate(caseAt("recovery"), "Completed").ok).toBe(true);
    const g = closeGate(caseAt("opNote"), "Completed");
    expect(g.ok).toBe(false);
    expect(g.reason).toContain("Recovery");
  });

  it("cancels only before the case starts, with a reason", () => {
    expect(closeGate(caseAt("preop"), "Cancelled", "Patient has a fever").ok).toBe(true);
    expect(closeGate(caseAt("preop"), "Cancelled", " ").ok).toBe(false);
    expect(closeGate(caseAt("signIn"), "Cancelled", "Too late").ok).toBe(false);
  });

  it("closes as Incomplete only for a started case, with a reason", () => {
    expect(closeGate(caseAt("timeOut"), "Incomplete", "Unstable under anaesthesia, operation stopped").ok).toBe(true);
    expect(closeGate(caseAt("timeOut"), "Incomplete").ok).toBe(false);
    expect(closeGate(caseAt("preop"), "Incomplete", "x").ok).toBe(false);
    expect(closeGate(caseAt("recovery"), "Incomplete", "x").ok).toBe(false);
    expect(closeGate(caseAt("close"), "Completed").ok).toBe(false);
  });

  it("needs the closure date and time and the patient disposition", () => {
    expect(validateClosure(closure)).toBeNull();
    expect(validateClosure({ ...closure, date: "" })).toBe("Enter the closure date.");
    expect(validateClosure({ ...closure, time: "2pm" })).toBe("Enter the closure time.");
    expect(validateClosure({ ...closure, disposition: "" })).toBe("Choose the patient disposition.");
    expect(validateClosure(undefined)).toBeTruthy();
  });
});

describe("the store enforces the gate", () => {
  beforeEach(() => {
    switchUser("U1"); // physician
    clearTheatre();
    resetRecords();
  });

  const request = () => {
    const r = requestSurgery("V900001", "P900", { procedure: "Hernia repair", side: "Left", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10" });
    if (!r.ok) throw new Error(r.message);
    return r.id;
  };
  /** Request, assess, schedule, confirm and complete the checklist. */
  const ready = () => {
    const id = request();
    saveAssessment(id, { result: "Fit For Anesthesia", anaesthesia: "Spinal Anesthesia" });
    saveSchedule(id, slot);
    confirmSchedule(id);
    savePreOp(id, fullPreop(), "complete");
    return id;
  };
  const operated = () => {
    const id = ready();
    for (const p of ["signIn", "timeOut", "signOut"] as const) confirmPhase(id, p, phase(p));
    return id;
  };

  it("walks a case from request to Completed and stamps every step", () => {
    const id = request();
    // Nothing can be skipped.
    expect(saveSchedule(id, slot).ok).toBe(false);
    expect(confirmPhase(id, "signIn", phase("signIn")).ok).toBe(false);
    expect(saveOpNote(id, note(), "complete").ok).toBe(false);
    expect(closeCase(id, "Completed", undefined, closure).ok).toBe(false);

    expect(saveAssessment(id, { result: "Need More Investigation", notes: "ECG" }).ok).toBe(true);
    expect(saveSchedule(id, slot).ok).toBe(false);
    expect(saveAssessment(id, { result: "Fit For Anesthesia" }).ok).toBe(true);
    expect(saveSchedule(id, { ...slot, anaesthetist: "" }, "draft").ok).toBe(true);
    expect(caseById(id)!.schedule!.status).toBe("Draft");
    expect(savePreOp(id, fullPreop()).ok).toBe(false); // a draft slot is not booked
    expect(saveSchedule(id, slot).ok).toBe(true);
    expect(scheduleStatus(caseById(id)!)).toBe("Scheduled");

    const part = fullPreop();
    delete part.answers.fasting;
    expect(savePreOp(id, part).ok).toBe(true); // saved as a draft
    expect(savePreOp(id, part, "complete").ok).toBe(false);
    expect(caseById(id)!.preop!.done).toBeUndefined();
    expect(savePreOp(id, fullPreop(), "complete").ok).toBe(true);
    expect(confirmPhase(id, "signIn", phase("signIn")).ok).toBe(false); // the slot is not confirmed
    expect(confirmSchedule(id).ok).toBe(true);
    expect(confirmSchedule(id).ok).toBe(false);

    expect(confirmPhase(id, "timeOut", phase("timeOut")).ok).toBe(false);
    expect(confirmPhase(id, "signIn", { ...phase("signIn"), answers: {} }).ok).toBe(false);
    expect(savePhaseDraft(id, "signIn", { ...phase("signIn"), answers: { identity: "Yes" } }).ok).toBe(true);
    expect(caseById(id)!.signIn).toBeUndefined();
    expect(caseById(id)!.phaseDrafts!.signIn!.answers).toEqual({ identity: "Yes" });
    expect(confirmPhase(id, "signIn", phase("signIn")).ok).toBe(true);
    expect(caseById(id)!.phaseDrafts!.signIn).toBeUndefined();
    expect(scheduleStatus(caseById(id)!)).toBe("In Progress");
    expect(confirmPhase(id, "signOut", phase("signOut")).ok).toBe(false);
    expect(confirmPhase(id, "timeOut", phase("timeOut")).ok).toBe(true);
    expect(confirmPhase(id, "signOut", phase("signOut")).ok).toBe(true);

    expect(saveOpNote(id, note({ findings: "" }), "complete").ok).toBe(false);
    expect(saveOpNote(id, note({ findings: "" }), "draft").ok).toBe(true);
    expect(saveRecovery(id, recovery(), "draft").ok).toBe(false); // the note is still a draft
    expect(saveOpNote(id, note({ procedureDone: "Left inguinal hernia repair" }), "complete").ok).toBe(true);
    expect(saveOpNote(id, note(), "draft").ok).toBe(false); // a completed note is locked

    expect(saveRecovery(id, recovery(full, { observations: "" }), "complete").ok).toBe(false);
    expect(saveRecovery(id, { arrivalTime: "10:30" }, "draft").ok).toBe(true);
    expect(caseById(id)!.recovery!.discharge).toBeUndefined();
    expect(saveRecovery(id, recovery({ ...full, consciousness: 0, oxygen: 0, colour: 0, activity: 1 }), "complete").ok).toBe(false); // 6
    expect(closeCase(id, "Completed", undefined, closure).ok).toBe(false);
    expect(saveRecovery(id, recovery(), "complete").ok).toBe(true);
    expect(closeCase(id, "Completed", undefined, { ...closure, disposition: "" }).ok).toBe(false);
    expect(closeCase(id, "Completed", undefined, closure).ok).toBe(true);

    const c = caseById(id)!;
    for (const s of [c.request.done, c.assessment!.done, c.schedule!.done, c.schedule!.confirmed!, c.preop!.done!, c.signIn!.done, c.timeOut!.done, c.signOut!.done, c.opNote!.done!, c.recovery!.discharge!.done, c.closed!.done]) {
      expect(s.by).toBe("Dr. Khalid Alharbi");
      expect(s.role).toBe("Physician");
      expect(Number.isNaN(Date.parse(s.at))).toBe(false);
    }
    expect(c.opNote!.status).toBe("Completed");
    expect(c.recovery!.discharge!.score).toBe(12);
    expect(c.recovery!.form!.timeOut).toMatch(/^\d{2}:\d{2}$/); // filled with the discharge time
    expect(c.closed).toMatchObject({ outcome: "Completed", disposition: "Returned To Ward", date: "2026-03-10", time: "14:00" });
    expect(c.signIn!.confirmedRole).toBe("Anaesthetist");
    expect(scheduleStatus(c)).toBe("Completed");
    expect(saveOpNote(id, note(), "complete").ok).toBe(false); // closed
  });

  it("stamps a nurse signature once and keeps it", () => {
    const id = request();
    saveAssessment(id, { result: "Fit For Anesthesia" });
    saveSchedule(id, slot);
    expect(savePreOp(id, fullPreop({ theatreNurse: { name: "Theatre Nurse" } })).ok).toBe(true);
    const first = caseById(id)!.preop!;
    expect(first.wardNurse).toMatchObject({ name: "Ward Nurse", signed: true, by: "Dr. Khalid Alharbi" });
    expect(first.theatreNurse).toEqual({ name: "Theatre Nurse" });
    savePreOp(id, fullPreop({ wardNurse: { name: "Someone Else", signed: false } }));
    expect(caseById(id)!.preop!.wardNurse).toEqual(first.wardNurse); // a saved signature does not change
  });

  it("keeps the three checklist signatures across the stages", () => {
    const id = ready();
    expect(confirmPhase(id, "signIn", { ...phase("signIn"), signers: { anaesthetist: { name: "Dr. A", signed: true } } }).ok).toBe(true);
    confirmPhase(id, "timeOut", { ...phase("timeOut"), signers: { surgeon: { name: "Dr. S", signed: true } } });
    const out = confirmPhase(id, "signOut", { ...phase("signOut"), signers: {} });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("signature of the nurse");
    expect(confirmPhase(id, "signOut", { ...phase("signOut"), signers: { nurse: { name: "Nurse C", signed: true } } }).ok).toBe(true);
    expect(Object.keys(caseById(id)!.safetySigners!).sort()).toEqual(["anaesthetist", "nurse", "surgeon"]);
  });

  it("passes the operation details to the form the Operative Note document reads, only once the note is completed", () => {
    const id = operated();
    expect(getFormRecords("V900001", "operation-request")).toHaveLength(1);
    saveOpNote(id, note({ findings: "Draft findings" }), "draft");
    expect(getFormRecords("V900001", "operation-request")[0].values.opFindings ?? "").toBe("");
    saveOpNote(id, note({ procedureDone: "Hernia repair", findings: "Indirect hernia", bloodLossMl: 50, category: "Major" }), "complete");
    const recs = getFormRecords("V900001", "operation-request");
    expect(recs).toHaveLength(1);
    expect(recs[0].values).toMatchObject({
      procedure: "Hernia repair", urgency: "Elective", operationStart: "2026-03-10T09:10", operationEnd: "2026-03-10T10:20", anesthesiaType: "Spinal Anesthesia", preferredDate: "2026-03-10",
      opFindings: "Indirect hernia", specimens: "Appendix to histopathology", complications: "None", bloodLossMl: 50, surgeryCategory: "Major",
    });
  });

  it("refuses a second case in a booked room, and frees the room when a case is postponed or cancelled", () => {
    const a = request(), b = request();
    saveAssessment(a, { result: "Fit For Anesthesia" });
    saveAssessment(b, { result: "Fit For Anesthesia" });
    expect(saveSchedule(a, slot).ok).toBe(true);
    const clash = saveSchedule(b, { ...slot, start: "10:00" });
    expect(clash.ok).toBe(false);
    expect(clash.message).toContain("already booked");
    expect(saveSchedule(b, { ...slot, start: "10:00" }, "draft").ok).toBe(true); // a draft does not hold the room
    expect(saveSchedule(a, { ...slot, start: "09:30" }).ok).toBe(true); // moving a case does not clash with itself
    expect(postponeSchedule(a, "").ok).toBe(false);
    expect(postponeSchedule(a, "Surgeon called to an emergency").ok).toBe(true);
    expect(caseById(a)!.postponements).toHaveLength(1);
    expect(caseById(a)!.postponements![0]).toMatchObject({ reason: "Surgeon called to an emergency", slot: "Theatre 1, 2026-03-10 09:30 to 11:00" });
    expect(caseStage(caseById(a)!)).toBe("Postponed");
    expect(saveSchedule(b, { ...slot, start: "10:00" }).ok).toBe(true); // a postponed case frees its slot
    expect(saveSchedule(a, { ...slot, date: "2026-03-11" }).ok).toBe(true); // and can be scheduled again
    expect(closeCase(a, "Cancelled", "Patient declined", closure).ok).toBe(true);
  });

  it("asks for confirmation again after a confirmed slot changes", () => {
    const id = ready();
    expect(caseById(id)!.schedule!.status).toBe("Confirmed");
    const r = saveSchedule(id, { ...slot, start: "11:00" });
    expect(r.ok && r.message).toContain("Confirm the slot again");
    expect(caseById(id)!.schedule!.status).toBe("Scheduled");
  });

  it("lets only a doctor override the recovery score", () => {
    const id = operated();
    saveOpNote(id, note(), "complete");
    const low = recovery({ ...full, consciousness: 0, oxygen: 1, colour: 1, activity: 1 }); // 7

    switchUser("U2"); // nurse
    const nurse = saveRecovery(id, { ...low, destination: "Intensive Care Unit" }, "complete", "Planned transfer on a ventilator");
    expect(nurse.ok).toBe(false);
    expect(nurse.message).toBe("Only a doctor can override the recovery score.");
    expect(saveRecovery(id, low, "complete").message).toContain("The Aldrete score is 7");

    switchUser("U1");
    expect(saveRecovery(id, { ...low, destination: "Intensive Care Unit" }, "complete", "").ok).toBe(false);
    expect(saveRecovery(id, { ...low, destination: "Intensive Care Unit" }, "complete", "Planned transfer on a ventilator").ok).toBe(true);
    expect(caseById(id)!.recovery!.discharge).toMatchObject({ score: 7, destination: "Intensive Care Unit", override: { reason: "Planned transfer on a ventilator", doctor: "Dr. Khalid Alharbi" } });
  });

  it("refuses a role that cannot write to the chart", () => {
    const id = request();
    switchUser("U7"); // billing
    expect(saveAssessment(id, { result: "Fit For Anesthesia" })).toEqual({ ok: false, message: "Your role cannot record surgery steps." });
    expect(requestSurgery("V900001", "P900", { procedure: "x", side: "Left", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10" }).ok).toBe(false);
    expect(postponeSchedule(id, "x").ok).toBe(false);
    switchUser("U1");
  });

  it("closes a started case as Incomplete, not Cancelled", () => {
    const id = ready();
    confirmPhase(id, "signIn", phase("signIn"));
    expect(postponeSchedule(id, "Too late").ok).toBe(false);
    expect(closeCase(id, "Cancelled", "Stopped", closure).ok).toBe(false);
    expect(closeCase(id, "Incomplete", "Unstable after anaesthesia, operation not started", { ...closure, disposition: "Admitted To Intensive Care", dispositionRemarks: " Bed 4 " }).ok).toBe(true);
    expect(caseById(id)!.closed).toMatchObject({ outcome: "Incomplete", reason: "Unstable after anaesthesia, operation not started", disposition: "Admitted To Intensive Care", dispositionRemarks: "Bed 4" });
  });
});
