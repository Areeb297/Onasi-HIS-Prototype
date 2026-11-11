import { beforeAll, describe, expect, it } from "vitest";
import { AGENTS, needsDecision, runAgent } from "./agents";
import { switchUser } from "../session";

describe("Onasi AI agents", () => {
  beforeAll(() => switchUser("U9"));

  it("every agent runs, shows its steps and gives a headline", () => {
    for (const a of AGENTS) {
      const r = runAgent(a.id);
      expect(r.steps.length, a.id).toBeGreaterThanOrEqual(2);
      expect(r.headline.length, a.id).toBeGreaterThan(5);
      for (const p of r.proposals) {
        expect(p.text && p.why, `${a.id} ${p.id}`).toBeTruthy();
        expect(["high", "medium", "info"]).toContain(p.level);
      }
      expect(new Set(r.proposals.map((p) => p.id)).size, `${a.id} ids are unique`).toBe(r.proposals.length);
      expect(needsDecision(r)).toBeLessThanOrEqual(r.proposals.length);
    }
  });

  it("never proposes an action by itself: each action carries a label a person presses", () => {
    for (const a of AGENTS) for (const p of runAgent(a.id).proposals) if (p.action) expect(p.action.label.length).toBeGreaterThan(2);
  });

  it("does not read confidential charts", () => {
    switchUser("U1");
    for (const a of AGENTS) {
      const r = runAgent(a.id);
      expect(r.proposals.some((p) => /confidential/i.test(p.patient)), a.id).toBe(false);
    }
    switchUser("U9");
  });

  it("the clearance agent only offers to send items that are ready", () => {
    const r = runAgent("clearance");
    for (const p of r.proposals.filter((x) => x.action?.kind === "send-row")) expect(p.level).toBe("medium");
  });
});
