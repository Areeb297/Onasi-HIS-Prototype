import { describe, expect, it } from "vitest";
import { CTAS_LEVELS, ageInMonths, ageText, assessCtas, bandLevel, needsReason, whyLine, type TriageInput } from "./ctas";

const adult = (x: Partial<TriageInput> = {}): TriageInput => ({ ageMonths: 40 * 12, ...x });
const child = (months: number, x: Partial<TriageInput> = {}): TriageInput => ({ ageMonths: months, ...x });
const level = (i: TriageInput) => assessCtas(i).level;

describe("CTAS levels", () => {
  it("has the published time targets, fractile response and re-assessment intervals", () => {
    expect(CTAS_LEVELS.map((l) => l.targetMin)).toEqual([0, 15, 30, 60, 120]);
    expect(CTAS_LEVELS.map((l) => l.fractile)).toEqual([98, 95, 90, 85, 80]);
    expect(CTAS_LEVELS.map((l) => l.reassessMin)).toEqual([0, 15, 30, 60, 120]);
  });
});

describe("age", () => {
  it("counts whole months and picks the table", () => {
    expect(ageInMonths("2026-05-11", new Date("2026-11-11"))).toBe(6);
    expect(ageInMonths("2026-05-12", new Date("2026-11-11"))).toBe(5);
    expect(ageText(2)).toBe("2 months");
    expect(ageText(30 * 12)).toBe("30 years");
    expect(assessCtas(child(17 * 12 + 11)).band).toBe("paediatric");
    expect(assessCtas(child(18 * 12)).band).toBe("adult");
  });
});

describe("adult first order modifiers", () => {
  it("breathing from oxygen saturation (Table 1)", () => {
    expect(level(adult({ spo2: 88 }))).toBe(1);
    expect(level(adult({ spo2: 91 }))).toBe(2);
    expect(level(adult({ spo2: 93 }))).toBe(3);
    expect(level(adult({ spo2: 94 }))).toBeUndefined();
    expect(level(adult({ spo2: 98 }))).toBeUndefined();
  });

  it("breathing from the nurse's judgement of distress", () => {
    expect(level(adult({ distress: "severe" }))).toBe(1);
    expect(level(adult({ distress: "moderate" }))).toBe(2);
    expect(level(adult({ distress: "mild" }))).toBe(3);
    expect(level(adult({ distress: "none" }))).toBeUndefined();
  });

  it("circulation from perfusion (Table 2)", () => {
    expect(level(adult({ perfusion: "shock" }))).toBe(1);
    expect(level(adult({ perfusion: "compromised" }))).toBe(2);
    expect(level(adult({ perfusion: "borderline" }))).toBe(3);
    expect(level(adult({ perfusion: "normal" }))).toBeUndefined();
  });

  it("consciousness from the coma score (Table 3)", () => {
    expect(level(adult({ gcs: 8 }))).toBe(1);
    expect(level(adult({ gcs: 12 }))).toBe(2);
    expect(level(adult({ gcs: 14 }))).toBeUndefined();
  });

  it("temperature depends on how the patient looks (Table 4)", () => {
    expect(level(adult({ temp: 38.2 }))).toBeUndefined(); // under 38.5 is not a fever for CTAS
    expect(level(adult({ temp: 38.6, appearance: "well" }))).toBe(4);
    expect(level(adult({ temp: 38.6, appearance: "unwell" }))).toBe(3);
    expect(level(adult({ temp: 38.6, appearance: "septic" }))).toBe(2);
    expect(level(adult({ temp: 38.6, appearance: "well", immunocompromised: true }))).toBe(2);
  });

  it("assumes unwell and asks when the temperature is raised and nothing else is said", () => {
    const a = assessCtas(adult({ temp: 39 }));
    expect(a.level).toBe(3);
    expect(a.prompts.join(" ")).toMatch(/how the patient looks/);
  });

  it("pain depends on severity, location and duration (Table 5)", () => {
    expect(level(adult({ pain: 9, painLocation: "central", painDuration: "acute" }))).toBe(2);
    expect(level(adult({ pain: 9, painLocation: "peripheral", painDuration: "acute" }))).toBe(3);
    expect(level(adult({ pain: 9, painLocation: "central", painDuration: "chronic" }))).toBe(3);
    expect(level(adult({ pain: 5, painLocation: "central", painDuration: "acute" }))).toBe(3);
    expect(level(adult({ pain: 5, painLocation: "peripheral", painDuration: "chronic" }))).toBe(5);
    expect(level(adult({ pain: 2, painLocation: "central", painDuration: "acute" }))).toBe(4);
    expect(level(adult({ pain: 0 }))).toBeUndefined();
  });

  it("bleeding on an anticoagulant and high risk injury (Tables 6 and 7)", () => {
    expect(level(adult({ bleeding: "major" }))).toBe(2);
    expect(level(adult({ bleeding: "minor" }))).toBe(3);
    expect(level(adult({ highRiskInjury: true }))).toBe(2);
  });

  it("high blood pressure, second order (Table 9)", () => {
    expect(level(adult({ sbp: 225, dbp: 100, symptomatic: true }))).toBe(2);
    expect(level(adult({ sbp: 225, dbp: 100 }))).toBe(3);
    expect(level(adult({ sbp: 210, dbp: 100, symptomatic: true }))).toBe(3);
    expect(level(adult({ sbp: 210, dbp: 100 }))).toBeUndefined();
  });

  it("the most urgent modifier wins, and every modifier is listed (the guide's own example)", () => {
    // Shortness of breath, 39.0, oxygen 91%, systolic 80, pale and diaphoretic: shock makes it level 1.
    const a = assessCtas(adult({ spo2: 91, temp: 39, appearance: "septic", sbp: 80, perfusion: "shock" }));
    expect(a.level).toBe(1);
    expect(a.drivers.map((d) => d.id)).toEqual(expect.arrayContaining(["breathing", "temperature", "circulation"]));
    expect(a.drivers[0].level).toBe(1);
    expect(whyLine(a)).toMatch(/Circulation/);
  });

  it("only prompts, and never sets a level, for adult blood pressure and heart rate numbers", () => {
    const a = assessCtas(adult({ sbp: 80, hr: 140 }));
    expect(a.level).toBeUndefined();
    expect(a.prompts.length).toBeGreaterThan(0);
    expect(assessCtas(adult({ sbp: 80, hr: 140, perfusion: "compromised" })).prompts).toEqual([]);
  });
});

describe("paediatric tables", () => {
  it("band edges (Tables 15 and 17)", () => {
    const e: [number, number, number, number, number, number] = [10, 20, 30, 60, 70, 80];
    expect(bandLevel(9, e)).toBe(1);
    expect(bandLevel(10, e)).toBe(2);
    expect(bandLevel(20, e)).toBe(3);
    expect(bandLevel(30, e)).toBeUndefined();
    expect(bandLevel(60, e)).toBeUndefined();
    expect(bandLevel(65, e)).toBe(3);
    expect(bandLevel(75, e)).toBe(2);
    expect(bandLevel(81, e)).toBe(1);
  });

  it("the same heart rate depends on age", () => {
    expect(level(child(4, { hr: 150 }))).toBeUndefined(); // 3 to 6 months: 80 to 160
    expect(level(child(8, { hr: 150 }))).toBe(3); // 6 to 12 months: 80 to 140, then 140 to 160 is level 3
    expect(level(child(24, { hr: 150 }))).toBe(2); // 1 to 3 years: 145 to 165
    expect(level(child(24, { hr: 170 }))).toBe(1);
    expect(level(child(12 * 12, { hr: 100 }))).toBe(3); // 10 years: 90 to 105
  });

  it("respiratory rate", () => {
    expect(level(child(24, { rr: 25 }))).toBeUndefined();
    expect(level(child(24, { rr: 45 }))).toBe(1);
    expect(level(child(2, { rr: 75 }))).toBe(2);
  });

  it("temperature depends on age (Tables 21 and 22)", () => {
    expect(level(child(2, { temp: 38 }))).toBe(2);
    expect(level(adult({ temp: 38 }))).toBeUndefined();
    expect(level(child(12, { temp: 38.6, appearance: "unwell" }))).toBe(2);
    expect(level(child(12, { temp: 38.6, appearance: "well" }))).toBe(3);
    expect(level(child(5 * 12, { temp: 38.6, appearance: "unwell" }))).toBe(3);
    expect(level(child(5 * 12, { temp: 38.6, appearance: "well" }))).toBe(4);
    expect(level(child(12, { temp: 31 }))).toBe(2);
    expect(level(child(12, { temp: 34 }))).toBe(3);
  });

  it("pain is by severity only (Table 23)", () => {
    expect(level(child(60, { pain: 9 }))).toBe(2);
    expect(level(child(60, { pain: 5 }))).toBe(3);
    expect(level(child(60, { pain: 2 }))).toBe(4);
  });

  it("does not use the adult-only rules for children", () => {
    expect(level(child(60, { bleeding: "major" }))).toBeUndefined();
    expect(level(child(60, { sbp: 230, dbp: 140 }))).toBeUndefined();
  });
});

describe("override rule", () => {
  it("asks for a reason only when the nurse picks a less urgent level than the modifiers", () => {
    const a = assessCtas(adult({ spo2: 91 })); // level 2
    expect(needsReason(4, a)).toBe(true);
    expect(needsReason(3, a)).toBe(true);
    expect(needsReason(2, a)).toBe(false);
    expect(needsReason(1, a)).toBe(false);
    expect(needsReason(undefined, a)).toBe(false);
    expect(needsReason(5, assessCtas(adult()))).toBe(false); // nothing to override
  });
});
