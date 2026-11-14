import { beforeEach, describe, expect, it } from "vitest";
import { switchUser } from "../session";
import { approveTask, checkNow, dismissTask, getAgentWork, modeOf, myDoctorId, progressOf, resetAgentWork, setMode, setPaused, tasksOfDoctor, waitingTasks } from "./agent-work";
import { AGENTS, runAgent } from "./agents";
import { answer, patientIn, topicOf } from "./assistant";
import { getState, patientName } from "../store";

describe("agents at work", () => {
  beforeEach(() => { switchUser("U9"); resetAgentWork(); });

  it("a check turns every finding that needs a person into one waiting task, and never an information line", () => {
    checkNow();
    const s = getAgentWork();
    for (const a of AGENTS) expect(s.last[a.id]?.steps.length, a.id).toBeGreaterThan(1);
    const expected = AGENTS.flatMap((a) => runAgent(a.id).proposals.filter((p) => p.level !== "info" && p.action && p.action.kind !== "copy").map((p) => p.id));
    expect(Object.keys(s.tasks).sort()).toEqual([...new Set(expected)].sort());
    // Checking again adds nothing and writes no second "found" line.
    const feed = s.feed.length;
    checkNow();
    expect(getAgentWork().feed.length).toBe(feed);
  });

  it("an agent set to Ask First finishes nothing by itself", () => {
    for (const a of AGENTS) if (a.autoKinds.length) setMode(a.id, "ask");
    expect(checkNow()).toBe(0);
    expect(Object.values(getAgentWork().tasks).some((t) => t.status === "done-agent")).toBe(false);
  });

  it("the starting set is three agents for the doctor, and none of them can change the record", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual(["critical", "discharge", "handoff"]);
    // The only step an agent may finish by itself is telling the doctor. Nothing is sent, nothing is edited.
    for (const a of AGENTS) for (const k of a.autoKinds) expect(k, a.id).toBe("notify");
    setMode("discharge", "auto");
    expect(modeOf("discharge")).toBe("ask");
  });

  it("agents that are not switched on check nothing and raise no task", () => {
    checkNow();
    const s = getAgentWork();
    for (const id of ["ed-flow", "clearance", "claim-guard"] as const) {
      expect(s.last[id], id).toBeUndefined();
      expect(Object.values(s.tasks).some((t) => t.agent === id), id).toBe(false);
    }
  });

  it("a handoff sheet is a document to copy, never a task", () => {
    checkNow();
    expect(Object.values(getAgentWork().tasks).some((t) => t.agent === "handoff")).toBe(false);
    expect(getAgentWork().last.handoff?.headline).toBeTruthy();
  });

  it("a doctor sees the tasks of the patients they are attending", () => {
    checkNow();
    const all = waitingTasks();
    switchUser("U1");
    const me = myDoctorId();
    expect(me).toBe("D1001");
    const mine = tasksOfDoctor(all, me!);
    const visits = new Set(getState().encounters.filter((e) => e.attending === me).map((e) => e.visitNumber));
    for (const t of mine) expect(visits.has(t.visit)).toBe(true);
    expect(mine.length).toBeLessThanOrEqual(all.length);
    switchUser("U9");
    expect(myDoctorId()).toBeUndefined();
  });

  it("a paused agent checks nothing", () => {
    setPaused("discharge", true);
    checkNow();
    expect(getAgentWork().last.discharge).toBeUndefined();
    expect(Object.values(getAgentWork().tasks).some((t) => t.agent === "discharge")).toBe(false);
  });

  it("dismissing closes a task for the day and counts in no one's finished work", () => {
    for (const a of AGENTS) if (a.autoKinds.length) setMode(a.id, "ask");
    checkNow();
    const t = waitingTasks()[0];
    expect(t).toBeTruthy();
    const before = progressOf();
    dismissTask(t.id);
    checkNow();
    expect(getAgentWork().tasks[t.id].status).toBe("dismissed");
    expect(progressOf().waiting).toBe(before.waiting - 1);
    expect(progressOf().done).toBe(before.done);
  });

  it("opening the place to fix a task does not close it", () => {
    for (const a of AGENTS) if (a.autoKinds.length) setMode(a.id, "ask");
    checkNow();
    const t = waitingTasks().find((x) => x.action?.kind === "open");
    if (!t) return;
    (globalThis as { window?: unknown }).window = { location: { hash: "" } };
    approveTask(t.id);
    delete (globalThis as { window?: unknown }).window;
    expect(getAgentWork().tasks[t.id].status).toBe("waiting");
  });
});

describe("assistant questions", () => {
  beforeEach(() => switchUser("U9"));

  it("routes each suggested question to its own agent", () => {
    for (const a of AGENTS) expect(topicOf(a.ask), a.ask).toBe(a.id);
  });

  it("says what it can answer when the question is outside its topics", () => {
    const a = answer("What is the weather in Riyadh?");
    expect(a.agent).toBeNull();
    expect(a.items).toEqual([]);
    expect(a.followUps.length).toBe(AGENTS.length);
    // A topic that belongs to an agent that is not switched on is not answered.
    expect(answer("Which claims would be refused?").agent).toBeNull();
  });

  it("narrows the answer to the patient named in the question", () => {
    const s = getState();
    const enc = s.encounters.find((e) => e.cls === "I" && e.status === "active" && !s.patients.find((p) => p.id === e.patientId)?.confidential)!;
    const p = s.patients.find((x) => x.id === enc.patientId)!;
    expect(patientIn(`Is ${p.family} ready to go home?`)?.name).toBe(patientName(p));
    const a = answer(`Is ${p.family} ready to go home?`);
    expect(a.agent).toBe("discharge");
    expect(a.patient).toBe(patientName(p));
    expect(a.items.length).toBeGreaterThan(0);
    for (const i of a.items) expect(i.patient).toBe(patientName(p));
  });

  it("never matches a confidential patient by name", () => {
    switchUser("U1");
    const c = getState().patients.find((p) => p.confidential);
    if (c) expect(patientIn(`How is ${c.family}?`)?.name).not.toBe(patientName(c));
    switchUser("U9");
  });
});
