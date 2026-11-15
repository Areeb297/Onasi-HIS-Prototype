import { beforeEach, describe, expect, it } from "vitest";
import { attentionFor, buildTimeline, chartChecks, checkCounts, latestVitals, sbarFor, sbarText, vitalsTime } from "./chart-review";
import { resetDocs } from "./docs";
import { resetLab } from "./lab";
import { resetRx } from "./rx";
import { getState, resetAll, updateEncounter } from "./store";
import { resetVitals, savePanel } from "./vitals";

const ctx = (pid: string) => {
  const s = getState();
  const enc = [...s.encounters].reverse().find((e) => e.patientId === pid && e.status !== "cancelled")!;
  return { enc, patient: s.patients.find((p) => p.id === pid)! };
};
const FULL = { sbp: 120, dbp: 80, pulse: 80, rr: 16, temp: 37, spo2: 98, weight: 70, height: 170 };

beforeEach(() => {
  resetAll(); resetVitals(); resetLab(); resetRx(); resetDocs();
});

describe("timeline", () => {
  it("lists the chart's events newest first, with a time on each", () => {
    const { enc } = ctx("P001");
    savePanel({ visit: enc.visitNumber, context: "admission", values: FULL });
    const items = buildTimeline(getState().encounters.find((e) => e.visitNumber === enc.visitNumber)!);
    expect(items.length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].at).toBeGreaterThanOrEqual(items[i].at);
    expect(items.every((i) => i.at > 0 && i.title && i.section)).toBe(true);
    expect(items.some((i) => i.kind === "vitals")).toBe(true);
  });

  it("flags abnormal vital signs in the timeline", () => {
    const { enc } = ctx("P001");
    savePanel({ visit: enc.visitNumber, context: "routine", values: { ...FULL, spo2: 84, pulse: 150 } });
    const vs = buildTimeline(enc).find((i) => i.kind === "vitals" && i.tone === "warn");
    expect(vs?.detail).toMatch(/Check/);
  });
});

describe("needs attention", () => {
  it("puts urgent items before the rest", () => {
    const { enc, patient } = ctx("P001");
    savePanel({ visit: enc.visitNumber, context: "routine", values: { ...FULL, spo2: 84, pulse: 150, rr: 32, temp: 39.5, sbp: 85 } });
    const rank = { high: 0, medium: 1, info: 2 } as const;
    const list = attentionFor(enc, patient);
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) expect(rank[list[i - 1].level]).toBeLessThanOrEqual(rank[list[i].level]);
    expect(list[0].level).toBe("high");
  });

  it("offers Send Update when the chart changed after the last message", () => {
    const { enc, patient } = ctx("P001");
    updateEncounter(enc.visitNumber, (e) => { e.dirty = true; });
    const fresh = getState().encounters.find((e) => e.visitNumber === enc.visitNumber)!;
    const a = attentionFor(fresh, patient).find((x) => x.id === "dirty");
    expect(a?.action).toBe("send-update");
  });

  it("asks for a diagnosis on an active visit that has none", () => {
    const { enc, patient } = ctx("P001");
    updateEncounter(enc.visitNumber, (e) => { e.dx = []; });
    const fresh = getState().encounters.find((e) => e.visitNumber === enc.visitNumber)!;
    expect(attentionFor(fresh, patient).some((x) => x.id === "no-dx")).toBe(fresh.status === "active");
  });
});

describe("SBAR handoff", () => {
  it("has all four parts and names the patient", () => {
    const { enc, patient } = ctx("P001");
    const s = sbarFor(enc, patient);
    for (const part of [s.situation, s.background, s.assessment, s.recommendation]) expect(part.length).toBeGreaterThan(5);
    expect(s.situation).toContain(patient.given);
    expect(sbarText(s).split("\n").filter((l) => /^[SBAR]: /.test(l))).toHaveLength(4);
  });

  it("states allergies, or says none are recorded", () => {
    const { enc, patient } = ctx("P001");
    const s = sbarFor({ ...enc, allergies: [] }, patient);
    expect(s.background).toContain("none recorded");
  });
});

describe("one reading, one count", () => {
  it("the SBAR quotes the same latest vital signs as the chart header, with their time", () => {
    const { enc, patient } = ctx("P001");
    const latest = latestVitals(enc)!;
    // Seed: the header reading (30 minutes ago) is newer than the last panel (90 minutes ago), so it wins.
    expect(latest.source).toBe("chart");
    expect(String(latest.nums.temp)).toBe(enc.vitals!.temp);
    const s = sbarFor(enc, patient);
    expect(s.situation).toContain(`T ${enc.vitals!.temp}`);
    expect(s.situation).toContain(`BP ${enc.vitals!.bp}`);
    expect(s.vitalsAt).toBe(vitalsTime(enc.vitals!.at));
    expect(s.situation).toContain(`(${s.vitalsAt})`);
    expect(s.assessment).not.toContain("in range");
  });

  it("a newly saved panel becomes the reading everywhere", () => {
    const { enc, patient } = ctx("P001");
    savePanel({ visit: enc.visitNumber, context: "routine", values: { ...FULL, temp: 36.6 } });
    const fresh = getState().encounters.find((e) => e.visitNumber === enc.visitNumber)!;
    expect(latestVitals(fresh)?.source).toBe("panel");
    expect(fresh.vitals?.temp).toBe("36.6");
    expect(sbarFor(fresh, patient).situation).toContain("T 36.6");
  });

  it("says so when no vital signs are recorded", () => {
    const { enc, patient } = ctx("P001");
    resetVitals();
    const s = sbarFor({ ...enc, vitals: undefined, visitNumber: "V-NONE" }, patient);
    expect(s.vitalsAt).toBe("");
    expect(s.situation).toContain("No vital signs recorded.");
  });

  it("merges the chart rules and the safety checks into one list with no repeats", () => {
    const { enc, patient } = ctx("P001");
    const list = chartChecks(enc, patient);
    expect(new Set(list.map((a) => a.text)).size).toBe(list.length);
    expect(list.some((a) => /Fever: 38.4/.test(a.text))).toBe(true);
    expect(list.some((a) => a.id === "abn")).toBe(false);
    const rank = { high: 0, medium: 1, info: 2 } as const;
    for (let i = 1; i < list.length; i++) expect(rank[list[i - 1].level]).toBeLessThanOrEqual(rank[list[i].level]);
    const c = checkCounts(list);
    expect(c.toAct).toBe(c.urgent + c.soon);
    expect(c.total).toBe(list.length);
    expect(list.every((a) => a.section.length > 0)).toBe(true);
  });
});

describe("AI patient brief", () => {
  it("tells the story, what to watch and what to do next", async () => {
    const { buildBrief } = await import("../components/ai/AiChartBrief");
    const { enc, patient } = ctx("P001");
    const b = buildBrief({ ...enc, dx: [], vitals: undefined }, patient);
    expect(b.story).toContain(patient.given);
    expect(b.story).toContain("No diagnosis is recorded yet.");
    expect(b.next.map((n) => n.section)).toEqual(expect.arrayContaining(["vitals", "diagnosis", "soap"]));
    expect(b.watch.every((w) => w.level === "high" || w.level === "medium")).toBe(true);
    expect(b.watch.length).toBeLessThanOrEqual(4);
  });
});
