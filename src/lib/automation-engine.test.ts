import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry } from "./audit";
import { acknowledgeNotice, advanceRun, approveStep, declineStep, eventFromAudit, sampleEvent, testRun, tick } from "./automation-engine";
import {
  TEMPLATES, clearAutomations, commitAutomations, createAutomation, getAutomations, resetAutomations, setAutomationStatus,
  type Flow, type HisEvent, type Run,
} from "./automations";
import { getCareRequests, resetCareRequests } from "./care-requests";
import { switchUser } from "./session";
import { getState, resetAll } from "./store";

const MIN = 60_000;
const T0 = new Date(2026, 10, 15, 9, 0).getTime();
const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!;

let auditId = 1000;
const entry = (target: string, detail: string, patient?: string, action: AuditEntry["action"] = "update"): AuditEntry =>
  ({ id: ++auditId, at: new Date(T0).toISOString(), user: "Huda Alotaibi, RN", role: "Nurse", action, target, patient, detail });

/** A store with only the given automations, all active. */
function only(...ids: string[]) {
  clearAutomations();
  for (const id of ids) {
    const a = createAutomation({ templateId: id });
    const r = setAutomationStatus(a.id, "active");
    if (!r.ok) throw new Error(r.errors.join(" "));
  }
}

const ctasVisit = () => getState().encounters.find((e) => e.ed?.ctas === 1)!;

beforeEach(() => {
  resetAll();
  resetCareRequests();
  resetAutomations(T0);
  switchUser("U9");
});

describe("events from the HIS", () => {
  it("reads a triage audit entry as Triage Level Set with the CTAS level and patient", () => {
    const e = ctasVisit();
    const ev = eventFromAudit(entry("Triage CTAS 1", `Visit ${e.visitNumber}. Chest pain`, e.patientId))!;
    expect(ev.trigger).toBe("triage-set");
    expect(ev.fields.ctas).toBe(1);
    expect(ev.visit).toBe(e.visitNumber);
    expect(ev.fields.area).toBe("Resus");
    expect(typeof ev.fields.age).toBe("number");
  });

  it("ignores entries the automations wrote themselves", () => {
    expect(eventFromAudit(entry("Automation note RUN-1", "Triage CTAS 1"))).toBeNull();
  });
});

describe("the engine runs a template", () => {
  it("alerts the emergency doctor and the charge nurse for a CTAS 1 arrival", () => {
    only("tpl-ctas");
    tick([], T0); // the first round only remembers where the audit log is
    const e = ctasVisit();
    const r = tick([entry("Triage CTAS 1", `Visit ${e.visitNumber}. Chest pain`, e.patientId)], T0 + MIN);
    expect(r.started).toBe(1);
    const s = getAutomations();
    const run = s.runs[0];
    expect(run.status).toBe("done");
    expect(run.steps.map((x) => x.status)).toEqual(["done", "yes", "done", "done", "done", "end", "end"]);
    expect(s.notices.map((n) => n.to).sort()).toEqual(["Charge Nurse", "Emergency Doctor"]);
    expect(s.notices[0].text).toMatch(/CTAS 1/);
  });

  it("does nothing for CTAS 4 except finish on the No path", () => {
    only("tpl-ctas");
    tick([], T0);
    const e = getState().encounters.find((x) => x.ed?.ctas === 4)!;
    tick([entry("Triage CTAS 4", `Visit ${e.visitNumber}.`, e.patientId)], T0 + MIN);
    const s = getAutomations();
    expect(s.runs[0].steps.find((x) => x.kind === "condition")!.status).toBe("no");
    expect(s.notices).toHaveLength(0);
  });

  it("starts each event once, and not for old history", () => {
    only("tpl-ctas");
    const e = ctasVisit();
    const old = entry("Triage CTAS 1", `Visit ${e.visitNumber}.`, e.patientId);
    tick([old], T0);
    expect(getAutomations().runs).toHaveLength(0);
    tick([old], T0 + MIN);
    expect(getAutomations().runs).toHaveLength(0);
  });

  it("escalates a critical result that nobody acknowledged in 30 minutes, after the wait", () => {
    only("tpl-critical-lab");
    const a = getAutomations().automations[0];
    const ev = sampleEvent("critical-lab", T0);
    const run: Run = { id: "RUN-50", automationId: a.id, automationName: a.name, event: { ...ev, source: "audit" }, startedAt: new Date(T0).toISOString(), status: "running", steps: [], tokens: [{ node: "t", approved: false }] };
    const ctx = { now: T0, dry: false, s: getAutomations() };
    const waiting = advanceRun(run, a.flow, ctx);
    expect(waiting.status).toBe("waiting");
    commitAutomations({ ...ctx.s, runs: [waiting] });
    tick([], T0 + 10 * MIN);
    expect(getAutomations().runs.find((r) => r.id === "RUN-50")!.status).toBe("waiting");
    tick([], T0 + 31 * MIN);
    const done = getAutomations().runs.find((r) => r.id === "RUN-50")!;
    expect(done.status).toBe("done");
    expect(done.steps.find((x) => x.kind === "condition")!.status).toBe("yes");
    expect(getAutomations().notices.some((n) => n.to === "Consultant")).toBe(true);
  });

  it("does not escalate when the doctor acknowledged in time", () => {
    only("tpl-critical-lab");
    const a = getAutomations().automations[0];
    const run: Run = { id: "RUN-51", automationId: a.id, automationName: a.name, event: { ...sampleEvent("critical-lab", T0), source: "audit" }, startedAt: new Date(T0).toISOString(), status: "running", steps: [], tokens: [{ node: "t", approved: false }] };
    const ctx = { now: T0, dry: false, s: getAutomations() };
    const waiting = advanceRun(run, a.flow, ctx);
    commitAutomations({ ...ctx.s, runs: [waiting] });
    const notice = getAutomations().notices.find((n) => n.runId === "RUN-51")!;
    expect(acknowledgeNotice(notice.id, T0 + 5 * MIN).ok).toBe(true);
    tick([], T0 + 31 * MIN);
    const done = getAutomations().runs.find((r) => r.id === "RUN-51")!;
    expect(done.steps.find((x) => x.kind === "condition")!.status).toBe("no");
    expect(getAutomations().notices.some((n) => n.to === "Consultant")).toBe(false);
  });
});

describe("approvals block record changes", () => {
  const consultFlow = (withApproval: boolean): Flow => ({
    nodes: [
      { id: "t", kind: "trigger", x: 0, y: 0, settings: { trigger: "triage-set" } },
      ...(withApproval ? [{ id: "ap", kind: "approval" as const, x: 0, y: 100, settings: { role: "ed-doctor" as const } }] : []),
      { id: "a", kind: "action", x: 0, y: 200, settings: { action: "request-consult", specialty: "Cardiology", urgency: "emergency", message: "Chest pain, please assess." } },
      { id: "e", kind: "end", x: 0, y: 300, settings: {} },
    ],
    edges: withApproval
      ? [{ id: "1", from: "t", to: "ap", port: "out" }, { id: "2", from: "ap", to: "a", port: "out" }, { id: "3", from: "a", to: "e", port: "out" }]
      : [{ id: "1", from: "t", to: "a", port: "out" }, { id: "3", from: "a", to: "e", port: "out" }],
  });
  const event = (): HisEvent => ({ ...sampleEvent("triage-set", T0), source: "audit" });
  const start = (flow: Flow): Run => {
    const s = getAutomations();
    const run: Run = { id: "RUN-60", automationId: "AUT-X", automationName: "Consult Test", event: event(), startedAt: new Date(T0).toISOString(), status: "running", steps: [], tokens: [{ node: "t", approved: false }] };
    const ctx = { now: T0, dry: false, s };
    const out = advanceRun(run, flow, ctx);
    commitAutomations({ ...ctx.s, automations: [...s.automations, { id: "AUT-X", name: "Consult Test", description: "", status: "active", flow, createdAt: "", createdBy: "", updatedAt: "" }], runs: [out] });
    return out;
  };

  it("stops at an action that changes the record when no approval came before it", () => {
    const run = start(consultFlow(false));
    expect(run.status).toBe("stopped");
    expect(run.steps.find((x) => x.nodeId === "a")!.status).toBe("blocked");
    expect(getCareRequests().consults).toHaveLength(0);
  });

  it("waits for the named role, refuses anyone else, and acts only after approval", () => {
    const run = start(consultFlow(true));
    expect(run.status).toBe("approval");
    expect(getCareRequests().consults).toHaveLength(0);
    switchUser("U7"); // billing officer: not the emergency doctor
    expect(approveStep(run.id, 0, T0 + MIN).ok).toBe(false);
    expect(getCareRequests().consults).toHaveLength(0);
    switchUser("U1"); // physician
    const ok = approveStep(run.id, 0, T0 + 2 * MIN);
    if (!ok.ok) throw new Error(ok.errors.join(" "));
    expect(ok.value.status).toBe("done");
    expect(getCareRequests().consults).toHaveLength(1);
    expect(getCareRequests().consults[0].specialty).toBe("Cardiology");
  });

  it("does nothing when the approver declines", () => {
    const run = start(consultFlow(true));
    switchUser("U1");
    expect(declineStep(run.id, 0, "", T0).ok).toBe(false);
    const r = declineStep(run.id, 0, "Already seen by cardiology.", T0 + MIN);
    expect(r.ok && r.value.status).toBe("done");
    expect(getCareRequests().consults).toHaveLength(0);
  });
});

describe("test runs", () => {
  it("walks the whole flow, says what would happen, and changes nothing", () => {
    const before = JSON.stringify(getAutomations());
    const consultsBefore = getCareRequests().consults.length;
    const [run] = testRun({ id: "AUT-T", name: "Discharge", flow: tpl("tpl-discharge").flow }, [sampleEvent("discharge-ordered", T0)], T0);
    expect(run.test).toBe(true);
    expect(run.status).toBe("done");
    expect(run.steps.some((x) => x.kind === "approval" && x.status === "simulated")).toBe(true);
    expect(run.steps.filter((x) => x.kind === "action").every((x) => x.status === "simulated" && /^Would/.test(x.text))).toBe(true);
    expect(JSON.stringify(getAutomations())).toBe(before);
    expect(getCareRequests().consults.length).toBe(consultsBefore);
  });

  it("goes straight through a wait and takes the escalation path for a sample critical result", () => {
    const [run] = testRun({ id: "AUT-T", name: "Lab", flow: tpl("tpl-critical-lab").flow }, [sampleEvent("critical-lab", T0)], T0);
    expect(run.steps.find((x) => x.kind === "wait")!.status).toBe("simulated");
    expect(run.steps.find((x) => x.kind === "condition")!.status).toBe("yes");
  });
});
