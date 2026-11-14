import { beforeEach, describe, expect, it } from "vitest";
import { getFormRecords, resetRecords } from "./records";
import { switchUser } from "./session";
import {
  addRecoveryScore, caseById, clearTheatre, closeCase, confirmPhase, dischargeFromRecovery, requestSurgery, saveAssessment, saveOpNote, savePreOp, saveSchedule,
} from "./theatre";
import {
  ALDRETE_ITEMS, PREOP_ITEMS, SAFETY_PHASES, STEPS, aldreteTotal, caseStage, closeGate, currentStep, fitForSurgery, nextAction, preOpMissing, readyForOperativeNote,
  recoveryDischargeGate, roomClash, stepDone, stepGate, validateAssessment, validateOpNote, validatePhase, validateRequest, validateSchedule,
  type PhaseData, type PhaseId, type PreOpAnswer, type ScheduleData, type Stamp, type SurgeryCase,
} from "./theatre-logic";

const stamp: Stamp = { by: "Dr. Test", role: "Physician", at: "2026-03-09T08:00:00.000Z" };
const allYes = (): Record<string, PreOpAnswer> => Object.fromEntries(PREOP_ITEMS.map((i) => [i.key, "yes" as const]));
const phase = (id: PhaseId): PhaseData => ({ checked: SAFETY_PHASES[id].items.map((i) => i.key), confirmedRole: SAFETY_PHASES[id].lead, confirmedName: "Named Person" });
const slot: ScheduleData = { room: "Theatre 1", date: "2026-03-10", start: "09:00", durationMin: 90, anaesthetist: "Dr. A", scrubNurse: "Nurse S", circulatingNurse: "Nurse C" };
const full = { activity: 2, breathing: 2, circulation: 2, consciousness: 2, oxygen: 2 };

/** A case built up to (and including) the given step. */
function caseAt(upTo: (typeof STEPS)[number]["id"], patch: Partial<SurgeryCase> = {}): SurgeryCase {
  const order = STEPS.map((s) => s.id);
  const has = (s: string) => order.indexOf(s as never) <= order.indexOf(upTo);
  const c: SurgeryCase = {
    id: "SC-1", visit: "V1", patientId: "P1",
    request: { procedure: "Appendicectomy", side: "Not applicable", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10", done: stamp },
  };
  if (has("assessment")) c.assessment = { result: "Fit", done: stamp };
  if (has("schedule")) c.schedule = { ...slot, done: stamp };
  if (has("preop")) c.preop = { answers: allYes(), done: stamp };
  if (has("signIn")) c.signIn = { ...phase("signIn"), done: stamp };
  if (has("timeOut")) c.timeOut = { ...phase("timeOut"), done: stamp };
  if (has("signOut")) c.signOut = { ...phase("signOut"), done: stamp };
  if (has("opNote")) c.opNote = { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Appendicectomy", findings: "Inflamed appendix", done: stamp };
  if (has("recovery")) c.recovery = { scores: [{ scores: full, total: 10, stamp }], discharge: { score: 10, destination: "Ward", done: stamp } };
  if (has("close")) c.closed = { outcome: "Completed", done: stamp };
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
    expect(caseStage(caseAt("assessment", { assessment: { result: "Not Fit", notes: "Chest infection", done: stamp } }))).toBe("Not Cleared");
    expect(caseStage(caseAt("preop"))).toBe("Scheduled");
    expect(caseStage(caseAt("timeOut"))).toBe("In Theatre");
    expect(caseStage(caseAt("signOut"))).toBe("Note Needed");
    expect(caseStage(caseAt("opNote"))).toBe("In Recovery");
    expect(caseStage(caseAt("recovery"))).toBe("Ready To Close");
    expect(caseStage(caseAt("close"))).toBe("Closed");
    expect(nextAction(caseAt("request"))).toBe("Pre-anaesthesia Assessment");
    expect(nextAction(caseAt("schedule"))).toBe(`Pre-operative checklist, ${PREOP_ITEMS.length} left`);
    expect(nextAction(caseAt("close"))).toBe("No action needed");
  });

  it("locks a closed case", () => {
    const c = caseAt("assessment", { closed: { outcome: "Cancelled", reason: "Patient declined", done: stamp } });
    for (const s of STEPS) expect(stepGate(c, s.id).ok, s.id).toBe(false);
    expect(currentStep(c)).toBeNull();
  });
});

describe("pre-anaesthesia assessment gates the schedule", () => {
  it("lets only Fit and Fit With High Risk be scheduled", () => {
    expect(fitForSurgery("Fit")).toBe(true);
    expect(fitForSurgery("Fit With High Risk")).toBe(true);
    expect(fitForSurgery("Not Fit")).toBe(false);
    expect(fitForSurgery("Needs More Tests")).toBe(false);
    for (const result of ["Not Fit", "Needs More Tests"] as const) {
      const g = stepGate(caseAt("assessment", { assessment: { result, notes: "x", done: stamp } }), "schedule");
      expect(g.ok).toBe(false);
      expect(g.reason).toContain(result);
    }
    expect(stepGate(caseAt("assessment", { assessment: { result: "Fit With High Risk", notes: "Heart failure", done: stamp } }), "schedule").ok).toBe(true);
    expect(stepGate(caseAt("request"), "schedule").reason).toBe("Do the pre-anaesthesia assessment first.");
  });

  it("lets the patient be assessed again until the case is scheduled", () => {
    expect(stepGate(caseAt("assessment", { assessment: { result: "Needs More Tests", notes: "ECG", done: stamp } }), "assessment").ok).toBe(true);
    expect(stepGate(caseAt("schedule"), "assessment").ok).toBe(false);
  });

  it("asks for the reason behind a result that is not a plain Fit", () => {
    expect(validateAssessment({})).toBeTruthy();
    expect(validateAssessment({ result: "Fit" })).toBeNull();
    expect(validateAssessment({ result: "Not Fit" })).toBe("Say why the patient is not fit.");
    expect(validateAssessment({ result: "Needs More Tests" })).toBe("Say which tests are needed.");
    expect(validateAssessment({ result: "Fit With High Risk" })).toBe("Describe the high risk.");
    expect(validateAssessment({ result: "Needs More Tests", notes: "Echocardiogram" })).toBeNull();
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
    expect(roomClash([{ ...booked, closed: { outcome: "Cancelled", reason: "x", done: stamp } }], at("09:30"))).toBeUndefined();
    expect(validateSchedule(at("09:30"), [booked])).toContain("Theatre 1 is already booked on 2026-03-10 from 09:00 to 10:30");
  });

  it("needs a room, a time and a full team", () => {
    expect(validateSchedule(slot, [])).toBeNull();
    for (const k of ["room", "date", "start", "anaesthetist", "scrubNurse", "circulatingNurse"] as const) expect(validateSchedule({ ...slot, [k]: "" }, []), k).toBeTruthy();
    expect(validateSchedule({ ...slot, durationMin: 0 }, [])).toBeTruthy();
    expect(validateSchedule({ ...slot, scrubNurse: "Nurse C" }, [])).toContain("two people");
  });
});

describe("the case cannot start with an incomplete checklist", () => {
  it("keeps Sign In shut until every pre-operative item is answered", () => {
    const answers = allYes();
    delete answers.consent;
    const c = caseAt("schedule", { preop: { answers } });
    expect(preOpMissing(answers).map((i) => i.key)).toEqual(["consent"]);
    const g = stepGate(c, "signIn");
    expect(g.ok).toBe(false);
    expect(g.reason).toBe("The pre-operative checklist is not complete. 1 item is left.");
    expect(stepGate(caseAt("schedule"), "signIn").ok).toBe(false);
    expect(stepGate(caseAt("preop"), "signIn").ok).toBe(true);
  });

  it("does not trust a done mark on a checklist that has gaps", () => {
    const answers = allYes();
    delete answers.allergies;
    expect(stepGate(caseAt("schedule", { preop: { answers, done: stamp } }), "signIn").ok).toBe(false);
  });

  it("does not accept 'does not apply' for checks that always apply", () => {
    expect(preOpMissing({ ...allYes(), consent: "na" }).map((i) => i.key)).toEqual(["consent"]);
    expect(preOpMissing({ ...allYes(), identity: "na", allergies: "na", vitals: "na" })).toHaveLength(3);
    expect(preOpMissing({ ...allYes(), blood: "na", jewellery: "na" })).toEqual([]);
  });

  it("needs the site marked when the operation has a side", () => {
    const answers = { ...allYes(), siteMarked: "na" as const };
    expect(preOpMissing(answers, "Not applicable")).toEqual([]);
    expect(preOpMissing(answers, "Left").map((i) => i.key)).toEqual(["siteMarked"]);
    expect(stepGate(caseAt("preop", { preop: { answers, done: stamp }, request: { ...caseAt("request").request, side: "Right" } }), "signIn").ok).toBe(false);
  });

  it("runs Sign In, Time Out and Sign Out strictly in that order", () => {
    expect(stepGate(caseAt("preop"), "timeOut").reason).toBe("Confirm Sign In first.");
    expect(stepGate(caseAt("signIn"), "signOut").reason).toBe("Confirm Time Out first.");
    expect(stepGate(caseAt("timeOut"), "opNote").reason).toBe("Confirm Sign Out first.");
    expect(stepGate(caseAt("signIn"), "signIn").ok).toBe(false);
  });

  it("confirms a phase only with every check ticked and a named role", () => {
    for (const id of ["signIn", "timeOut", "signOut"] as const) {
      const ok = phase(id);
      expect(validatePhase(id, ok), id).toBeNull();
      expect(validatePhase(id, { ...ok, checked: ok.checked.slice(1) }), id).toContain("1 check is not ticked");
      expect(validatePhase(id, { ...ok, checked: [] }), id).toBeTruthy();
      expect(validatePhase(id, { ...ok, confirmedRole: "" }), id).toBeTruthy();
      expect(validatePhase(id, { ...ok, confirmedRole: "Porter" }), id).toBeTruthy();
      expect(validatePhase(id, { ...ok, confirmedName: "  " }), id).toBeTruthy();
      expect(SAFETY_PHASES[id].roles).toContain(SAFETY_PHASES[id].lead);
    }
  });

  it("freezes the schedule and the pre-operative checklist once the case has started", () => {
    expect(stepGate(caseAt("signIn"), "schedule").ok).toBe(false);
    expect(stepGate(caseAt("signIn"), "preop").ok).toBe(false);
    expect(stepGate(caseAt("preop"), "schedule").ok).toBe(true);
  });
});

describe("operative note", () => {
  it("needs start and end times in the right order, the operation and the findings", () => {
    const ok = { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Appendicectomy", findings: "Inflamed appendix" };
    expect(validateOpNote(ok)).toBeNull();
    expect(validateOpNote({ ...ok, start: "" })).toBeTruthy();
    expect(validateOpNote({ ...ok, end: "" })).toBeTruthy();
    expect(validateOpNote({ ...ok, end: "2026-03-10T09:10" })).toBe("The end time must be after the start time.");
    expect(validateOpNote({ ...ok, findings: "" })).toBeTruthy();
    expect(validateOpNote({ ...ok, bloodLossMl: -1 })).toBeTruthy();
  });

  it("says when the Operative Note document can be published", () => {
    expect(readyForOperativeNote(caseAt("signOut"))).toBe(false);
    expect(readyForOperativeNote(caseAt("opNote"))).toBe(true);
  });
});

describe("recovery", () => {
  it("totals the Aldrete score only when all five items are scored", () => {
    expect(ALDRETE_ITEMS).toHaveLength(5);
    expect(aldreteTotal(full)).toBe(10);
    expect(aldreteTotal({ ...full, oxygen: 1, activity: 0 })).toBe(7);
    expect(aldreteTotal({ activity: 2, breathing: 2 })).toBeNull();
    expect(aldreteTotal({})).toBeNull();
  });

  it("lets the patient leave at 9 or more", () => {
    expect(recoveryDischargeGate(9).ok).toBe(true);
    expect(recoveryDischargeGate(10).ok).toBe(true);
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

  it("walks a case from request to Completed and stamps every step", () => {
    const id = request();
    // Nothing can be skipped.
    expect(saveSchedule(id, slot).ok).toBe(false);
    expect(confirmPhase(id, "signIn", phase("signIn")).ok).toBe(false);
    expect(saveOpNote(id, { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "x", findings: "y" }).ok).toBe(false);
    expect(closeCase(id, "Completed").ok).toBe(false);

    expect(saveAssessment(id, { result: "Needs More Tests", notes: "ECG" }).ok).toBe(true);
    expect(saveSchedule(id, slot).ok).toBe(false);
    expect(saveAssessment(id, { result: "Fit" }).ok).toBe(true);
    expect(saveSchedule(id, slot).ok).toBe(true);

    const part = allYes();
    delete part.fasting;
    expect(savePreOp(id, part).ok).toBe(true); // saved, but not complete
    expect(caseById(id)!.preop!.done).toBeUndefined();
    expect(confirmPhase(id, "signIn", phase("signIn")).ok).toBe(false);
    expect(savePreOp(id, allYes()).ok).toBe(true);

    expect(confirmPhase(id, "timeOut", phase("timeOut")).ok).toBe(false);
    expect(confirmPhase(id, "signIn", { ...phase("signIn"), checked: [] }).ok).toBe(false);
    expect(confirmPhase(id, "signIn", phase("signIn")).ok).toBe(true);
    expect(confirmPhase(id, "signOut", phase("signOut")).ok).toBe(false);
    expect(confirmPhase(id, "timeOut", phase("timeOut")).ok).toBe(true);
    expect(confirmPhase(id, "signOut", phase("signOut")).ok).toBe(true);
    expect(saveOpNote(id, { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Left inguinal hernia repair", findings: "Indirect hernia" }).ok).toBe(true);

    expect(dischargeFromRecovery(id, "Ward").ok).toBe(false); // no score yet
    expect(addRecoveryScore(id, { activity: 2 }).ok).toBe(false);
    expect(addRecoveryScore(id, { ...full, consciousness: 1, oxygen: 1 }).ok).toBe(true); // 8
    expect(dischargeFromRecovery(id, "Ward").ok).toBe(false);
    expect(addRecoveryScore(id, full).ok).toBe(true);
    expect(closeCase(id, "Completed").ok).toBe(false);
    expect(dischargeFromRecovery(id, "Ward").ok).toBe(true);
    expect(closeCase(id, "Completed").ok).toBe(true);

    const c = caseById(id)!;
    for (const s of [c.request.done, c.assessment!.done, c.schedule!.done, c.preop!.done!, c.signIn!.done, c.timeOut!.done, c.signOut!.done, c.opNote!.done, c.recovery!.discharge!.done, c.closed!.done]) {
      expect(s.by).toBe("Dr. Khalid Alharbi");
      expect(s.role).toBe("Physician");
      expect(Number.isNaN(Date.parse(s.at))).toBe(false);
    }
    expect(c.recovery!.scores.map((s) => s.total)).toEqual([8, 10]);
    expect(c.signIn!.confirmedRole).toBe("Anaesthetist");
    expect(saveOpNote(id, { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "x", findings: "y" }).ok).toBe(false); // closed
  });

  it("passes the operation times to the form the Operative Note document reads", () => {
    const id = request();
    expect(getFormRecords("V900001", "operation-request")).toHaveLength(1);
    saveAssessment(id, { result: "Fit", anaesthesia: "Spinal" });
    saveSchedule(id, slot);
    savePreOp(id, allYes());
    for (const p of ["signIn", "timeOut", "signOut"] as const) confirmPhase(id, p, phase(p));
    saveOpNote(id, { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Hernia repair", findings: "Indirect hernia" });
    const recs = getFormRecords("V900001", "operation-request");
    expect(recs).toHaveLength(1);
    expect(recs[0].values).toMatchObject({ procedure: "Hernia repair", urgency: "Elective", operationStart: "2026-03-10T09:10", operationEnd: "2026-03-10T10:20", anesthesiaType: "Spinal", preferredDate: "2026-03-10" });
  });

  it("refuses a second case in a booked room", () => {
    const a = request(), b = request();
    saveAssessment(a, { result: "Fit" });
    saveAssessment(b, { result: "Fit" });
    expect(saveSchedule(a, slot).ok).toBe(true);
    const clash = saveSchedule(b, { ...slot, start: "10:00" });
    expect(clash.ok).toBe(false);
    expect(clash.message).toContain("already booked");
    expect(saveSchedule(a, { ...slot, start: "09:30" }).ok).toBe(true); // moving a case does not clash with itself
    expect(closeCase(a, "Cancelled", "Patient declined").ok).toBe(true);
    expect(saveSchedule(b, { ...slot, start: "10:00" }).ok).toBe(true); // a cancelled case frees its slot
  });

  it("lets only a doctor override the recovery score", () => {
    const id = request();
    saveAssessment(id, { result: "Fit" });
    saveSchedule(id, slot);
    savePreOp(id, allYes());
    for (const p of ["signIn", "timeOut", "signOut"] as const) confirmPhase(id, p, phase(p));
    saveOpNote(id, { start: "2026-03-10T09:10", end: "2026-03-10T10:20", procedureDone: "Hernia repair", findings: "Indirect hernia" });
    addRecoveryScore(id, { ...full, consciousness: 0, oxygen: 1 }); // 7

    switchUser("U2"); // nurse
    const nurse = dischargeFromRecovery(id, "Intensive Care Unit", "Planned transfer on a ventilator");
    expect(nurse.ok).toBe(false);
    expect(nurse.message).toBe("Only a doctor can override the recovery score.");

    switchUser("U1");
    expect(dischargeFromRecovery(id, "Intensive Care Unit", "").ok).toBe(false);
    expect(dischargeFromRecovery(id, "Intensive Care Unit", "Planned transfer on a ventilator").ok).toBe(true);
    expect(caseById(id)!.recovery!.discharge).toMatchObject({ score: 7, destination: "Intensive Care Unit", override: { reason: "Planned transfer on a ventilator", doctor: "Dr. Khalid Alharbi" } });
  });

  it("refuses a role that cannot write to the chart", () => {
    const id = request();
    switchUser("U7"); // billing
    expect(saveAssessment(id, { result: "Fit" })).toEqual({ ok: false, message: "Your role cannot record surgery steps." });
    expect(requestSurgery("V900001", "P900", { procedure: "x", side: "Left", surgeon: "Dr. S", urgency: "Elective", plannedDate: "2026-03-10" }).ok).toBe(false);
    switchUser("U1");
  });

  it("closes a started case as Incomplete, not Cancelled", () => {
    const id = request();
    saveAssessment(id, { result: "Fit" });
    saveSchedule(id, slot);
    savePreOp(id, allYes());
    confirmPhase(id, "signIn", phase("signIn"));
    expect(closeCase(id, "Cancelled", "Stopped").ok).toBe(false);
    expect(closeCase(id, "Incomplete", "Unstable after anaesthesia, operation not started").ok).toBe(true);
    expect(caseById(id)!.closed).toMatchObject({ outcome: "Incomplete", reason: "Unstable after anaesthesia, operation not started" });
  });
});
