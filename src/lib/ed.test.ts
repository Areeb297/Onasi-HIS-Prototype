import { describe, expect, it } from "vitest";
import { CTAS, clockOf, ctasInfo, doorToDoctor, fractiles, reassessOf, stageOf } from "./ed";
import type { EdData } from "./model";
import { emptyForm, formFromEncounter, planMessage, seedState, sendOn } from "./store";

const mins = (m: number) => {
  const d = new Date(Date.now() - m * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe("CTAS", () => {
  it("has five levels with the standard time to doctor targets", () => {
    expect(CTAS.map((c) => c.targetMin)).toEqual([0, 15, 30, 60, 120]);
    expect(ctasInfo(2).label).toBe("Emergent");
  });
});

describe("stage and clock", () => {
  const base: EdData = { arrivalAt: mins(20), arrivalMode: "Walk-in" };

  it("moves through the stages", () => {
    expect(stageOf(base)).toBe("waiting-triage");
    expect(stageOf({ ...base, triageAt: mins(15), ctas: 2 })).toBe("waiting-doctor");
    expect(stageOf({ ...base, triageAt: mins(15), ctas: 2, seenAt: mins(5) })).toBe("treatment");
    expect(stageOf({ ...base, triageAt: mins(15), ctas: 2, seenAt: mins(5), stage: "results" })).toBe("results");
    expect(stageOf({ ...base, triageAt: mins(15), ctas: 2, seenAt: mins(5), stage: "ready" })).toBe("ready");
  });

  it("marks a CTAS 2 patient over target after 15 minutes and CTAS 4 under target at 20", () => {
    expect(clockOf({ ...base, triageAt: mins(16), ctas: 2 }).overdue).toBe(true);
    expect(clockOf({ ...base, triageAt: mins(20), ctas: 4 }).overdue).toBe(false);
    expect(clockOf({ ...base, triageAt: mins(20), ctas: 4 }).left).toBeGreaterThan(30);
  });

  it("always needs a doctor now for CTAS 1", () => {
    expect(clockOf({ ...base, triageAt: mins(1), ctas: 1 }).overdue).toBe(true);
  });

  it("calculates door to doctor", () => {
    expect(doorToDoctor({ ...base, arrivalAt: mins(30), seenAt: mins(10) })).toBe(20);
  });
});

describe("re-assessment", () => {
  const base: EdData = { arrivalAt: mins(60), arrivalMode: "Walk-in" };

  it("follows the CTAS interval for the level", () => {
    expect(reassessOf({ ...base, triageAt: mins(10), ctas: 2 })?.due).toBe(5);
    expect(reassessOf({ ...base, triageAt: mins(20), ctas: 2 })?.late).toBe(true);
    expect(reassessOf({ ...base, triageAt: mins(20), ctas: 3 })?.due).toBe(10);
    expect(reassessOf({ ...base, triageAt: mins(20), ctas: 4 })?.due).toBe(40);
    expect(reassessOf({ ...base, triageAt: mins(20), ctas: 1 })?.text).toMatch(/Continuous/);
  });

  it("restarts after a re-assessment and stops once a doctor has started", () => {
    expect(reassessOf({ ...base, triageAt: mins(40), reassessedAt: mins(5), ctas: 3 })?.due).toBe(25);
    expect(reassessOf({ ...base, triageAt: mins(40), seenAt: mins(2), ctas: 3 })).toBeUndefined();
    expect(reassessOf(base)).toBeUndefined();
  });
});

describe("fractile response", () => {
  const mk = (ctas: 2 | 3, waited: number): { ed: EdData } => ({ ed: { arrivalAt: mins(120), arrivalMode: "Walk-in", triageAt: mins(100), seenAt: mins(100 - waited), ctas } });

  it("scores the share seen within the target for levels 2 to 5", () => {
    const encs = [mk(2, 10), mk(2, 20), mk(3, 25), mk(3, 25)] as never[];
    const f = fractiles(encs);
    expect(f.map((x) => x.level)).toEqual([2, 3, 4, 5]);
    expect(f[0]).toMatchObject({ seen: 2, met: 1, pct: 50, goal: 95 });
    expect(f[1]).toMatchObject({ seen: 2, met: 2, pct: 100, goal: 90 });
    expect(f[2].pct).toBeUndefined();
  });
});

describe("ED fields in the CNHI discharge update", () => {
  it("fills ZPV1-17 to ZPV1-22 from the triage data", () => {
    let state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P014")!;
    expect(enc.cls).toBe("E");
    // add a diagnosis, discharge, then build the CNHI update
    const f3 = formFromEncounter(state, "A03", { ...enc, dx: [{ code: "I21.9", text: "Acute myocardial infarction", type: "F" }] });
    state = sendOn(state, "A03", f3).state;
    const done = state.encounters.find((e) => e.visitNumber === enc.visitNumber)!;
    const f = formFromEncounter(state, "A08-CNHI", done);
    const plan = planMessage(state, "A08-CNHI", f);
    const z = plan.message.split("\r").find((l) => l.startsWith("ZPV1|"))!.split("|");
    expect(z[17]).toMatch(/^\d{14}\+0300$/); // arrival
    expect(z[18]).toBe("2"); // ambulance, assumed code
    expect(z[19]).toMatch(/^\d{14}\+0300$/); // doctor started
    expect(z[21]).toMatch(/^\d{14}\+0300$/); // triage time
    expect(z[22]).toBe("1"); // CTAS 1
    // the validator reminds us that ZPV1-20 (disposition) is missing
    expect(plan.checks.some((c) => c.level === "warn" && c.text.includes("ZPV1-20"))).toBe(true);
  });

  it("does not add ED fields for an outpatient visit", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P007")!;
    const f = formFromEncounter(state, "A08-CNHI", { ...enc, status: "discharged" });
    const plan = planMessage(state, "A08-CNHI", { ...f, encounterId: enc.visitNumber });
    const z = plan.message.split("\r").find((l) => l.startsWith("ZPV1|"))!.split("|");
    expect(z[22]).toBeUndefined();
  });
});

describe("seed", () => {
  it("has emergency patients at every stage", () => {
    const st = seedState();
    const stages = new Set(st.encounters.filter((e) => e.cls === "E" && e.ed).map((e) => stageOf(e.ed!)));
    for (const s of ["waiting-triage", "waiting-doctor", "treatment", "results"]) expect(stages.has(s as never)).toBe(true);
    expect(emptyForm(st, "A04").cls).toBe("O");
  });
});
