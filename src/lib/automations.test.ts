import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTION_BY_ID, NODE_H, NODE_W, TEMPLATES, TRIGGER_BY_ID, addNode, autoLayout, changesRecord, connect, createAutomation, deleteAutomation, duplicateAutomation,
  evaluateCondition, fill, findCycles, flowReady, getAutomations, removeNode, resetAutomations, saveAutomation, setAutomationStatus, validateFlow,
  type Flow, type FlowNode, type NodeKind, type NodeSettings,
} from "./automations";
import { switchUser } from "./session";

const node = (id: string, kind: NodeKind, settings: NodeSettings = {}): FlowNode => ({ id, kind, x: 0, y: 0, settings });
const edge = (from: string, to: string, port: "out" | "yes" | "no" = "out") => ({ id: `${from}-${port}-${to}`, from, to, port });

/** Trigger, notify, end: the smallest flow that can run. */
const simple = (): Flow => ({
  nodes: [node("t", "trigger", { trigger: "triage-set" }), node("a", "action", { action: "notify", role: "ed-doctor", message: "See {patient}" }), node("e", "end")],
  edges: [edge("t", "a"), edge("a", "e")],
});

beforeEach(() => {
  resetAutomations();
  switchUser("U9");
});

describe("flow validation", () => {
  it("passes a complete flow", () => {
    expect(validateFlow(simple()).filter((i) => i.level === "error")).toEqual([]);
    expect(flowReady(simple())).toBe(true);
  });

  it("flags a flow with no trigger", () => {
    const f = simple();
    const issues = validateFlow({ ...f, nodes: f.nodes.filter((n) => n.kind !== "trigger"), edges: f.edges.filter((e) => e.from !== "t") });
    expect(issues.some((i) => /Add a Trigger/.test(i.text))).toBe(true);
  });

  it("flags loose ends, including a condition with only one path", () => {
    const f: Flow = {
      nodes: [node("t", "trigger", { trigger: "triage-set" }), node("c", "condition", { field: "ctas", op: "at-most", value: "2" }), node("e", "end")],
      edges: [edge("t", "c"), edge("c", "e", "yes")],
    };
    const issues = validateFlow(f);
    expect(issues.some((i) => i.nodeId === "c" && /No path/.test(i.text))).toBe(true);
    const cut = validateFlow({ ...simple(), edges: [edge("t", "a")] });
    expect(cut.some((i) => i.nodeId === "a" && /leads nowhere/.test(i.text))).toBe(true);
  });

  it("flags a step nobody can reach", () => {
    const f = simple();
    f.nodes.push(node("x", "action", { action: "audit-note", message: "Note" }));
    f.edges.push(edge("x", "e"));
    expect(validateFlow(f).some((i) => i.nodeId === "x" && /cannot be reached/.test(i.text))).toBe(true);
  });

  it("flags a loop without a wait, and accepts the same loop with a wait in it", () => {
    const loop: Flow = {
      nodes: [
        node("t", "trigger", { trigger: "vitals-overdue" }),
        node("a", "action", { action: "reminder", role: "ward-nurse", message: "Record vital signs" }),
        node("c", "condition", { field: "hoursSinceVitals", op: "at-least", value: "4" }),
        node("e", "end"),
      ],
      edges: [edge("t", "a"), edge("a", "c"), edge("c", "a", "yes"), edge("c", "e", "no")],
    };
    expect(findCycles(loop)).toHaveLength(1);
    expect(validateFlow(loop).some((i) => /loop with no Wait/.test(i.text))).toBe(true);
    const waited: Flow = {
      nodes: [...loop.nodes, node("w", "wait", { minutes: 60 })],
      edges: [edge("t", "a"), edge("a", "c"), edge("c", "w", "yes"), edge("w", "a"), edge("c", "e", "no")],
    };
    expect(validateFlow(waited).some((i) => /loop with no Wait/.test(i.text))).toBe(false);
    expect(flowReady(waited)).toBe(true);
  });

  it("flags missing settings on each kind of step", () => {
    const f: Flow = {
      nodes: [node("t", "trigger"), node("c", "condition", { field: "ctas", op: "is" }), node("w", "wait", {}), node("ap", "approval"), node("a", "action", { action: "create-task" }), node("e", "end")],
      edges: [edge("t", "c"), edge("c", "w", "yes"), edge("c", "e", "no"), edge("w", "ap"), edge("ap", "a"), edge("a", "e")],
    };
    const miss = validateFlow(f).filter((i) => /Missing settings/.test(i.text)).map((i) => i.nodeId);
    expect(miss.sort()).toEqual(["a", "ap", "c", "t", "w"]);
  });

  it("needs an approval before every action that changes a record, on every path", () => {
    const f: Flow = {
      nodes: [
        node("t", "trigger", { trigger: "discharge-ordered" }),
        node("c", "condition", { field: "ward", op: "is", value: "3A" }),
        node("ap", "approval", { role: "attending" }),
        node("fu", "action", { action: "request-follow-up", clinic: "Cardiology Clinic", days: 14 }),
        node("e", "end"),
      ],
      edges: [edge("t", "c"), edge("c", "ap", "yes"), edge("c", "fu", "no"), edge("ap", "fu"), edge("fu", "e")],
    };
    expect(validateFlow(f).some((i) => i.nodeId === "fu" && /changes the record/.test(i.text))).toBe(true);
    // Every path through the approval: fine.
    const safe = { ...f, edges: [edge("t", "c"), edge("c", "ap", "yes"), edge("c", "ap", "no"), edge("ap", "fu"), edge("fu", "e")] };
    expect(validateFlow(safe).some((i) => /changes the record/.test(i.text))).toBe(false);
  });

  it("warns when a condition reads a field the trigger does not give", () => {
    const f = simple();
    f.nodes.splice(1, 0, node("c", "condition", { field: "amount", op: "at-least", value: "100" }));
    f.edges = [edge("t", "c"), edge("c", "a", "yes"), edge("c", "e", "no"), edge("a", "e")];
    expect(validateFlow(f).some((i) => i.level === "warning" && i.nodeId === "c")).toBe(true);
  });
});

describe("condition evaluation", () => {
  it("compares numbers", () => {
    expect(evaluateCondition({ field: "ctas", op: "at-most", value: "2" }, { ctas: 1 }).pass).toBe(true);
    expect(evaluateCondition({ field: "ctas", op: "at-most", value: "2" }, { ctas: 3 }).pass).toBe(false);
    expect(evaluateCondition({ field: "amount", op: "at-least", value: "5000" }, { amount: 5000 }).pass).toBe(true);
    expect(evaluateCondition({ field: "age", op: "is-not", value: "40" }, { age: 41 }).pass).toBe(true);
  });

  it("compares choices and text without minding case", () => {
    expect(evaluateCondition({ field: "payer", op: "is", value: "bupa arabia" }, { payer: "Bupa Arabia" }).pass).toBe(true);
    expect(evaluateCondition({ field: "ward", op: "is-not", value: "ICU" }, { ward: "3A" }).pass).toBe(true);
    expect(evaluateCondition({ field: "complaint", op: "contains", value: "chest" }, { complaint: "Chest pain and sweating" }).pass).toBe(true);
    expect(evaluateCondition({ field: "resultFlag", op: "is", value: "Critical Low" }, { resultFlag: "Critical High" }).pass).toBe(false);
  });

  it("reads yes and no", () => {
    expect(evaluateCondition({ field: "acknowledged", op: "is", value: "no" }, { acknowledged: false }).pass).toBe(true);
    expect(evaluateCondition({ field: "acknowledged", op: "is", value: "no" }, { acknowledged: true }).pass).toBe(false);
    expect(evaluateCondition({ field: "stillPended", op: "is", value: "yes" }, { stillPended: true }).pass).toBe(true);
  });

  it("answers No when the field is not in the event, and says so", () => {
    const r = evaluateCondition({ field: "ctas", op: "at-most", value: "2" }, { age: 40 });
    expect(r.pass).toBe(false);
    expect(r.missing).toBe(true);
    expect(r.text).toMatch(/not recorded/);
  });

  it("fills message placeholders from the event", () => {
    expect(fill("CTAS {ctas} for {patient}, {amount}", { patient: "Faisal Almansour", visit: "V100012", fields: { ctas: 1, amount: 12400 } })).toBe("CTAS 1 for Faisal Almansour, 12,400 SAR");
  });
});

describe("templates", () => {
  it("has the seven templates, each ready to activate", () => {
    expect(TEMPLATES).toHaveLength(7);
    for (const t of TEMPLATES) {
      const errors = validateFlow(t.flow).filter((i) => i.level === "error");
      expect(errors, t.name).toEqual([]);
    }
  });

  it("uses only known triggers and actions, with unique ids and no overlapping steps", () => {
    for (const t of TEMPLATES) {
      const trig = t.flow.nodes.filter((n) => n.kind === "trigger");
      expect(trig).toHaveLength(1);
      expect(TRIGGER_BY_ID[trig[0].settings.trigger!]).toBeTruthy();
      const ids = [...t.flow.nodes.map((n) => n.id), ...t.flow.edges.map((e) => e.id)];
      expect(new Set(ids).size).toBe(ids.length);
      for (const n of t.flow.nodes) if (n.kind === "action") expect(ACTION_BY_ID[n.settings.action!], `${t.name} ${n.id}`).toBeTruthy();
      for (const a of t.flow.nodes) for (const b of t.flow.nodes) {
        if (a.id >= b.id) continue;
        const overlap = Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;
        expect(overlap, `${t.name}: ${a.id} and ${b.id}`).toBe(false);
      }
    }
  });

  it("puts every record change behind an approval", () => {
    const withChanges = TEMPLATES.filter((t) => t.flow.nodes.some(changesRecord));
    expect(withChanges.map((t) => t.id).sort()).toEqual(["tpl-claim", "tpl-discharge"]);
    for (const t of withChanges) expect(t.flow.nodes.some((n) => n.kind === "approval")).toBe(true);
  });

  it("covers the triggers the brief names", () => {
    const used = new Set(TEMPLATES.map((t) => t.flow.nodes.find((n) => n.kind === "trigger")!.settings.trigger));
    for (const id of ["triage-set", "critical-lab", "discharge-ordered", "claim-rejected", "prior-auth-pended", "vitals-overdue", "admission-requested"] as const) expect(used.has(id)).toBe(true);
  });
});

describe("layout and editing", () => {
  it("lays out top to bottom with the trigger on the first row", () => {
    const f = autoLayout(TEMPLATES[0].flow);
    const t = f.nodes.find((n) => n.kind === "trigger")!;
    expect(Math.min(...f.nodes.map((n) => n.y))).toBe(t.y);
    for (const e of f.edges) {
      const a = f.nodes.find((n) => n.id === e.from)!, b = f.nodes.find((n) => n.id === e.to)!;
      expect(b.y).toBeGreaterThan(a.y);
    }
  });

  it("keeps one connection per exit, except for a branch", () => {
    let f = simple();
    f = addNode(f, "end", 0, 300).flow;
    const second = f.nodes[f.nodes.length - 1].id;
    f = connect(f, "a", "out", second);
    expect(f.edges.filter((e) => e.from === "a")).toHaveLength(1);
    expect(connect(f, "t", "out", "t")).toBe(f);
    const removed = removeNode(f, "a");
    expect(removed.edges.some((e) => e.from === "a" || e.to === "a")).toBe(false);
  });
});

describe("the list", () => {
  it("starts with the seven automations, some active, one draft, one paused", () => {
    const s = getAutomations();
    expect(s.automations).toHaveLength(7);
    expect(s.automations.filter((a) => a.status === "active").length).toBeGreaterThan(2);
    expect(s.automations.some((a) => a.status === "draft")).toBe(true);
    expect(s.automations.some((a) => a.status === "paused")).toBe(true);
  });

  it("will not activate a flow with problems, and pauses an active one saved with problems", () => {
    const a = createAutomation({ name: "Empty" });
    const r = setAutomationStatus(a.id, "active");
    expect(r.ok).toBe(false);
    const live = getAutomations().automations.find((x) => x.status === "active")!;
    const saved = saveAutomation(live.id, { flow: { ...live.flow, edges: [] } });
    expect(saved.ok && saved.value.status).toBe("paused");
  });

  it("duplicates as a draft and deletes", () => {
    const first = getAutomations().automations[0];
    const d = duplicateAutomation(first.id);
    if (!d.ok) throw new Error(d.errors.join(" "));
    expect(d.value.status).toBe("draft");
    expect(d.value.flow.nodes).toHaveLength(first.flow.nodes.length);
    expect(d.value.name).toMatch(/Copy/);
    deleteAutomation(d.value.id);
    expect(getAutomations().automations.some((x) => x.id === d.value.id)).toBe(false);
  });

  it("creates from a template as a draft", () => {
    const a = createAutomation({ templateId: "tpl-vitals" });
    expect(a.status).toBe("draft");
    expect(a.flow.nodes.find((n) => n.kind === "trigger")!.settings.trigger).toBe("vitals-overdue");
  });
});
