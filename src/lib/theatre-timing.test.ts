import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRecords } from "./records";
import { switchUser } from "./session";
import { caseById, clearTheatre, closeCase, confirmPhase, confirmSchedule, requestSurgery, saveAssessment, saveOpNote, savePhaseDraft, savePreOp, saveRecovery, saveSchedule } from "./theatre";
import {
  PREOP_ITEMS, SAFETY_PHASES, closureTimingProblem, opNoteTimingProblem, recoveryTimingProblem, slotStartAt, timingGate,
  type OpNoteData, type PhaseData, type PhaseId, type PhaseInput, type PreOpAnswer, type PreOpData, type SafetyAnswer, type SafetySigners, type SurgeryCase,
} from "./theatre-logic";

/** A fixed clock: the slot is 10 Mar 2027, 09:00 to 10:30. */
const slotDay = "2027-03-10";
const at = (t: string) => new Date(`${slotDay}T${t}`);
const stamp = { by: "Dr. Test", role: "Physician", at: `${slotDay}T08:30:00` };

const base = (patch: Partial<SurgeryCase> = {}): SurgeryCase => ({
  id: "SC-1", visit: "V1", patientId: "P1",
  request: { procedure: "Appendicectomy", side: "Not applicable", surgeon: "Dr. S", urgency: "Elective", plannedDate: slotDay, done: stamp },
  schedule: { room: "Theatre 1", date: slotDay, start: "09:00", durationMin: 90, anaesthetist: "Dr. A", scrubNurse: "S", circulatingNurse: "C", status: "Confirmed", done: stamp },
  ...patch,
});
const phaseDone = (extra: Partial<PhaseData> = {}) => ({ confirmedRole: "Surgeon", confirmedName: "Dr. S", ...extra, done: stamp });

describe("the booked slot gates Sign In, Time Out and Sign Out", () => {
  it("reads the slot start", () => {
    expect(slotStartAt(base())?.getTime()).toBe(at("09:00").getTime());
    expect(slotStartAt({ schedule: undefined })).toBeNull();
    expect(slotStartAt({ schedule: { ...base().schedule!, start: "" } })).toBeNull();
  });

  it("blocks every timed step before the slot, and says when the slot starts", () => {
    for (const step of ["signIn", "timeOut", "signOut"] as const) {
      const g = timingGate(base(), step, at("08:00"));
      expect(g.ok, step).toBe(false);
      expect(g.reason).toContain("cannot start before then");
      expect(g.reason).toContain("09:00");
    }
  });

  it("opens at the slot time, with two minutes of clock slack", () => {
    expect(timingGate(base(), "signIn", at("08:57")).ok).toBe(false);
    expect(timingGate(base(), "signIn", at("08:58")).ok).toBe(true);
    expect(timingGate(base(), "signIn", at("09:00")).ok).toBe(true);
    expect(timingGate(base(), "signIn", at("14:00")).ok).toBe(true);
  });

  it("lets a doctor start early, but only with a reason", () => {
    const now = at("08:00");
    expect(timingGate(base(), "signIn", now, { reason: "", isDoctor: true })).toEqual({ ok: false, reason: "Give the reason for starting before the booked time." });
    expect(timingGate(base(), "signIn", now, { reason: "   ", isDoctor: true }).ok).toBe(false);
    expect(timingGate(base(), "signIn", now, { reason: "Trauma list moved up", isDoctor: true }).ok).toBe(true);
    expect(timingGate(base(), "signIn", now, { reason: "Trauma list moved up", isDoctor: false }).reason).toBe("Only a doctor can start before the booked time.");
  });

  it("lets the later phases follow a Sign In that a doctor started early", () => {
    const early = base({ signIn: phaseDone({ earlyStart: { reason: "Moved up", doctor: "Dr. Test" } }) });
    expect(timingGate(early, "timeOut", at("08:10")).ok).toBe(true);
    expect(timingGate(base({ signIn: phaseDone() }), "timeOut", at("08:10")).ok).toBe(false);
  });

  it("has no opinion about a case with no slot", () => {
    expect(timingGate({ ...base(), schedule: undefined }, "signIn", at("01:00")).ok).toBe(true);
  });
});

describe("times typed in the operative note", () => {
  const note = (start: string, end: string): Partial<OpNoteData> => ({ start: `${slotDay}T${start}`, end: `${slotDay}T${end}` });
  const c = base({ signIn: phaseDone() });

  it("refuses a time in the future", () => {
    expect(opNoteTimingProblem(c, note("09:10", "10:20"), at("09:30"))).toMatch(/end time .* is in the future/);
    expect(opNoteTimingProblem(c, note("09:40", "10:20"), at("09:30"))).toMatch(/start time .* is in the future/);
    expect(opNoteTimingProblem(c, note("09:10", "10:20"), at("10:30"))).toBeNull();
  });

  it("refuses a time before the booked slot", () => {
    expect(opNoteTimingProblem(c, note("07:00", "08:00"), at("11:00"))).toMatch(/before the booked slot/);
  });

  it("accepts an early start that a doctor allowed, because Sign In happened earlier", () => {
    const early = base({ signIn: { ...phaseDone({ earlyStart: { reason: "Moved up", doctor: "Dr. T" } }), done: { ...stamp, at: `${slotDay}T07:50:00` } } });
    expect(opNoteTimingProblem(early, note("07:55", "08:40"), at("11:00"))).toBeNull();
  });

  it("is quiet while the times are empty", () => {
    expect(opNoteTimingProblem(c, {}, at("11:00"))).toBeNull();
  });
});

describe("recovery and closing", () => {
  const done = base({ signIn: phaseDone(), opNote: { start: `${slotDay}T09:10`, end: `${slotDay}T10:20`, procedureDone: "x", findings: "y", status: "Completed", done: stamp } });

  it("keeps the recovery arrival after the operation ended and out of the future", () => {
    expect(recoveryTimingProblem(done, { arrivalTime: "10:00" }, at("12:00"))).toMatch(/before the operation ended/);
    expect(recoveryTimingProblem(done, { arrivalTime: "10:30" }, at("12:00"))).toBeNull();
    expect(recoveryTimingProblem(done, { arrivalTime: "10:30" }, at("10:25"))).toMatch(/in the future/);
    expect(recoveryTimingProblem(done, { arrivalTime: "10:30", timeOut: "13:00" }, at("12:00"))).toMatch(/Time Out .* in the future/);
  });

  it("refuses to close as Completed before the recorded end time", () => {
    const g = closureTimingProblem(done, "Completed", { date: slotDay, time: "10:30" }, at("10:00"));
    expect(g).toContain("before the operation ended");
    expect(g).toContain("10:20");
    expect(closureTimingProblem(done, "Completed", { date: slotDay, time: "10:30" }, at("10:40"))).toBeNull();
  });

  it("refuses a closure time in the future, or before the end of the operation", () => {
    expect(closureTimingProblem(done, "Completed", { date: slotDay, time: "23:00" }, at("11:00"))).toMatch(/in the future/);
    expect(closureTimingProblem(done, "Completed", { date: slotDay, time: "10:00" }, at("11:00"))).toMatch(/before the operation ended/);
    expect(closureTimingProblem(done, "Incomplete", { date: slotDay, time: "09:30" }, at("11:00"))).toBeNull();
  });
});

/* ---------- the store ---------- */

const allYes = (): Record<string, PreOpAnswer> => Object.fromEntries(PREOP_ITEMS.map((i) => [i.key, "yes" as const]));
const fullPreop = (date: string): PreOpData => ({
  answers: allYes(), checklistDate: date, reviewed: { allergy: true, vitals: true, medication: true, investigations: true },
  wardNurse: { name: "Ward Nurse", signed: true }, theatreNurse: { name: "Theatre Nurse", signed: true },
});
const signers: SafetySigners = { surgeon: { name: "Dr. S", signed: true }, anaesthetist: { name: "Dr. A", signed: true }, nurse: { name: "Nurse C", signed: true } };
const phase = (id: PhaseId): PhaseInput => {
  const items = SAFETY_PHASES[id].items;
  const answers: Record<string, SafetyAnswer> = Object.fromEntries(items.filter((i) => i.kind !== "text").map((i) => [i.key, i.kind === "check" ? "Yes" : "No"]));
  const texts = Object.fromEntries(items.filter((i) => i.kind === "text" && i.required).map((i) => [i.key, "Stated"]));
  return { answers, texts, confirmedRole: SAFETY_PHASES[id].lead, confirmedName: "Named Person", signers };
};

describe("the store keeps a future slot shut", () => {
  const dayFromNow = (n: number) => {
    const d = new Date(Date.now() + n * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  let tomorrow = "";
  const readyFuture = () => {
    const r = requestSurgery("V900001", "P900", { procedure: "Hernia repair", side: "Left", surgeon: "Dr. S", urgency: "Elective", plannedDate: tomorrow });
    if (!r.ok) throw new Error(r.message);
    saveAssessment(r.id, { result: "Fit For Anesthesia", anaesthesia: "Spinal Anesthesia" });
    const slot = { room: "Theatre 1", date: tomorrow, start: "09:00", durationMin: 90, anaesthetist: "Dr. A", scrubNurse: "Nurse S", circulatingNurse: "Nurse C" };
    if (!saveSchedule(r.id, slot).ok) throw new Error("schedule");
    confirmSchedule(r.id);
    if (!savePreOp(r.id, fullPreop(tomorrow), "complete").ok) throw new Error("preop");
    return r.id;
  };

  beforeEach(() => {
    switchUser("U1"); // physician
    clearTheatre();
    resetRecords();
    tomorrow = dayFromNow(1);
  });

  it("refuses Sign In, as a draft or confirmed, before the slot", () => {
    const id = readyFuture();
    const a = confirmPhase(id, "signIn", phase("signIn"));
    expect(a.ok).toBe(false);
    expect(a.message).toContain("cannot start before then");
    expect(savePhaseDraft(id, "signIn", phase("signIn")).ok).toBe(false);
    expect(caseById(id)!.signIn).toBeUndefined();
  });

  it("lets a doctor start early with a reason, and keeps the reason on the case", () => {
    const id = readyFuture();
    expect(confirmPhase(id, "signIn", phase("signIn"), { reason: "" }).ok).toBe(false);
    const ok = confirmPhase(id, "signIn", phase("signIn"), { reason: "Emergency case needs the room" });
    expect(ok.ok).toBe(true);
    expect(caseById(id)!.signIn!.earlyStart).toMatchObject({ reason: "Emergency case needs the room", doctor: "Dr. Khalid Alharbi" });
    // The later phases follow the early start.
    expect(confirmPhase(id, "timeOut", phase("timeOut")).ok).toBe(true);
  });

  it("does not let a nurse start early, even with a reason", () => {
    const id = readyFuture();
    switchUser("U2"); // nurse
    expect(confirmPhase(id, "signIn", phase("signIn"), { reason: "Doctor said so" }).ok).toBe(false);
    expect(caseById(id)!.signIn).toBeUndefined();
  });

  it("refuses a note with times in the future, accepts one after Sign In, and keeps recovery and closing in order", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = readyFuture();
      const signedAt = Date.now();
      confirmPhase(id, "signIn", phase("signIn"), { reason: "Emergency" });
      confirmPhase(id, "timeOut", phase("timeOut"));
      confirmPhase(id, "signOut", phase("signOut"));
      const local = (ms: number) => {
        const d = new Date(ms);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      const hhmm = (ms: number) => local(ms).slice(11);
      const note = (startMs: number, endMs: number): OpNoteData => ({
        start: local(startMs), end: local(endMs), procedureDone: "Hernia repair", findings: "Indirect hernia", noteDate: local(endMs).slice(0, 10),
        team: [{ role: "Surgeon", staff: "Dr. S", primary: true }], complication: false, complications: "None", specimenToPathology: false, countCorrect: true, signingSurgeon: "Dr. S",
      });
      vi.setSystemTime(signedAt + 2 * 3_600_000); // two hours later
      const now = Date.now();

      const future = saveOpNote(id, note(now + 3_600_000, now + 7_200_000), "draft");
      expect(future.ok).toBe(false);
      expect(future.message).toContain("in the future");
      const early = saveOpNote(id, note(signedAt - 3_600_000, signedAt - 1_800_000), "complete");
      expect(early.ok).toBe(false);
      expect(early.message).toContain("before the booked slot");
      expect(saveOpNote(id, note(signedAt + 600_000, signedAt + 5_400_000), "complete").ok).toBe(true);

      // Recovery: arriving before the operation ended is refused, after it is accepted.
      const rec = { arrivalTime: hhmm(signedAt + 3_600_000) };
      expect(saveRecovery(id, rec, "draft").ok).toBe(false);
      expect(saveRecovery(id, { arrivalTime: hhmm(signedAt + 5_700_000) }, "draft").ok).toBe(true);

      // Closing: a time in the future is refused.
      const closeAt = (ms: number) => ({ date: local(ms).slice(0, 10), time: hhmm(ms), disposition: "Returned To Ward" });
      expect(closeCase(id, "Incomplete", "Patient transferred", closeAt(now + 3_600_000)).message).toContain("in the future");
    } finally {
      vi.useRealTimers();
    }
  });
});
