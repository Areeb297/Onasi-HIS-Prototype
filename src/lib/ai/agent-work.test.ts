import { beforeEach, describe, expect, it } from "vitest";
import { switchUser } from "../session";
import { approveTask, checkNow, dismissTask, getAgentWork, isShortcut, modeOf, progressOf, resetAgentWork, setMode, setPaused, waitingTasks } from "./agent-work";
import { AGENTS, runAgent } from "./agents";
import { answer, patientIn, topicOf } from "./assistant";
import { getState, patientName } from "../store";

describe("agents at work", () => {
  beforeEach(() => { switchUser("U9"); resetAgentWork(); });

  it("a check turns every finding that needs a person into one waiting task, and never an information line", () => {
    checkNow();
    const s = getAgentWork();
    for (const a of AGENTS) expect(s.last[a.id]?.steps.length, a.id).toBeGreaterThan(1);
    const expected = AGENTS.flatMap((a) => runAgent(a.id).proposals.filter((p) => p.level !== "info" && p.action).map((p) => p.id));
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

  it("only an agent with a step it can finish may be set to Automatic", () => {
    setMode("ed-flow", "auto");
    expect(modeOf("ed-flow")).toBe("ask");
    setMode("clearance", "auto");
    expect(modeOf("clearance")).toBe("auto");
  });

  it("Automatic finishes the allowed steps, logs each one, and leaves the rest waiting", () => {
    for (const a of AGENTS) if (a.autoKinds.length) setMode(a.id, "ask");
    checkNow();
    const sendable = waitingTasks().filter((t) => t.agent === "clearance" && t.action?.kind === "send-row").length;
    setMode("clearance", "auto");
    const done = checkNow();
    const s = getAgentWork();
    const finished = Object.values(s.tasks).filter((t) => t.agent === "clearance" && t.status === "done-agent");
    expect(done).toBe(finished.length);
    expect(finished.length).toBeLessThanOrEqual(sendable);
    expect(s.feed.filter((f) => f.kind === "done" && f.by === "agent").length).toBe(finished.length);
    // A step that only opens a page is never finished by an agent.
    expect(Object.values(s.tasks).some((t) => t.status === "done-agent" && isShortcut(t.action))).toBe(false);
  });

  it("a paused agent checks nothing", () => {
    setPaused("claim-guard", true);
    checkNow();
    expect(getAgentWork().last["claim-guard"]).toBeUndefined();
    expect(Object.values(getAgentWork().tasks).some((t) => t.agent === "claim-guard")).toBe(false);
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
