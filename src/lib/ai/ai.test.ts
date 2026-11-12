import { describe, expect, it } from "vitest";
import type { Encounter } from "../model";
import { formFromEncounter, planMessage, seedState, sendOn } from "../store";
import { drugAllergyFlags, missingBeforeDischarge, qsofa, runCds, vitalFlags } from "./cds";
import { suggestCodes } from "./coding";
import type { AiContext, AiMed } from "./context";
import { AI_LABEL } from "./context";
import { pickLeaflet, renderLeaflet } from "./education";
import { ruleEngine, USE_CASES } from "./engine";
import { explainCheck } from "./nphies";
import { suggestOrders } from "./orders";
import { draftSoap } from "./soap";
import { qualityCheck } from "./summaries";

const seed = seedState();
const enc = (pid: string): Encounter => structuredClone(seed.encounters.find((e) => e.patientId === pid)!);

function ctx(e: Encounter, extra: Partial<AiContext> = {}): AiContext {
  return { enc: e, patient: seed.patients.find((p) => p.id === e.patientId)!, forms: () => [], soap: [], meds: [], log: [], now: new Date("2026-03-01T08:00:00Z"), ...extra };
}

const amoxicillin: AiMed = { name: "Amoxicillin 500 mg", dose: "1 capsule", allergyKeys: ["amoxicillin", "penicillin"], crossKeys: ["cephalosporin"] };

describe("clinical decision support", () => {
  it("flags fever and fast breathing from P001's vitals", () => {
    const flags = vitalFlags(ctx(enc("P001")));
    expect(flags.some((f) => f.text.includes("Fever") && f.text.includes("38.4"))).toBe(true);
    expect(flags.some((f) => f.text.includes("Fast breathing"))).toBe(true);
  });

  it("uses the thresholds: SpO2 below 94, temperature 38 or more, pulse above 100", () => {
    const e = enc("P001");
    e.vitals = { bp: "120/80", pulse: "101", temp: "38.0", spo2: "93", rr: "16", weight: "80", at: "2026-03-01T07:00" };
    const t = vitalFlags(ctx(e)).map((f) => f.text).join(" ");
    expect(t).toContain("Fever");
    expect(t).toContain("Oxygen saturation is 93%");
    expect(t).toContain("tachycardia");
    e.vitals = { bp: "120/80", pulse: "100", temp: "37.9", spo2: "94", rr: "16", weight: "80", at: "x" };
    expect(vitalFlags(ctx(e))).toEqual([]);
  });

  it("gives a qSOFA screen and escalates at 2 of 3", () => {
    const e = enc("P001");
    e.vitals = { bp: "92/60", pulse: "110", temp: "39.1", spo2: "92", rr: "24", weight: "80", at: "x" };
    const f = qsofa(ctx(e));
    expect(f[0].level).toBe("high");
    expect(f[0].text).toContain("2 of 3");
  });

  it("finds a drug-allergy conflict and says where it came from", () => {
    const flags = drugAllergyFlags(ctx(enc("P001"), { meds: [amoxicillin] })); // P001 is allergic to penicillin
    expect(flags[0].level).toBe("high");
    expect(flags[0].source).toContain("Allergies");
  });

  it("lists what is missing before discharge", () => {
    const e = enc("P001");
    e.dx = [];
    e.disposition = undefined;
    const t = missingBeforeDischarge(ctx(e)).map((f) => f.text).join(" ");
    expect(t).toContain("No diagnosis");
    expect(t).toContain("disposition");
    expect(runCds(ctx(e))[0].level).toBe("high"); // sorted, high first
  });

  it("does not ask for discharge data once the patient has gone", () => {
    expect(missingBeforeDischarge(ctx(enc("P006")))).toEqual([]);
  });
});

describe("drafts", () => {
  it("drafts SOAP from complaints, vitals and diagnoses", () => {
    const s = draftSoap(ctx(enc("P001")));
    expect(s.subjective).toContain("fever, cough");
    expect(s.subjective).toContain("Penicillin");
    expect(s.objective).toContain("38.4");
    expect(s.assessment).toContain("J18.9");
    expect(s.plan).toContain("clinician to complete");
    expect(s.sources).toEqual(expect.arrayContaining(["Chief Complaints", "Vitals", "Diagnosis"]));
  });

  it("says plainly when the chart is empty", () => {
    const e = enc("P004");
    e.vitals = undefined;
    e.complaints = [];
    e.reason = "";
    const s = draftSoap(ctx(e));
    expect(s.assessment).toContain("No diagnosis");
    expect(s.objective).toContain("No vital signs");
  });

  it("suggests codes from the dictionary and marks where the words came from", () => {
    const sug = suggestCodes([{ from: "Chief Complaints", text: "Fever and cough, sore throat" }]);
    const codes = sug.map((s) => s.icd);
    expect(codes).toEqual(expect.arrayContaining(["R50.9", "R05", "J02.9"]));
    expect(sug[0].snomed).toBe("386661006");
    expect(sug[0].from).toBe("Chief Complaints");
    expect(suggestCodes([{ from: "x", text: "nothing relevant" }])).toEqual([]);
  });

  it("does not match a code word inside another word", () => {
    expect(suggestCodes([{ from: "x", text: "scoughing" }]).some((s) => s.icd === "R05")).toBe(false);
  });

  it("gives leaflets in simple English and short Arabic for four topics", () => {
    const l = pickLeaflet("high blood sugar");
    expect(l.id).toBe("diabetes");
    expect(renderLeaflet(l, "Reem", false)).toContain("For: Reem");
    expect(renderLeaflet(l, "Reem", true)).toMatch(/[؀-ۿ]/);
    expect(["fever", "diabetes", "hypertension", "asthma"].every((id) => !!pickLeaflet(id).ar)).toBe(true);
    expect(pickLeaflet("pneumonia").ar).toBeUndefined();
  });

  it("suggests orders for a complaint", () => {
    const sets = suggestOrders("chest pain since morning");
    expect(sets[0].labs.join(" ")).toContain("Troponin");
    expect(sets[0].imaging).toContain("Chest X-ray");
    expect(suggestOrders("back pain").some((s) => s.label === "Back pain")).toBe(true);
  });

  it("checks documentation quality", () => {
    const e = enc("P004"); // outpatient with nothing but a complaint
    const t = qualityCheck(ctx(e)).map((q) => q.text).join(" ");
    expect(t).toContain("Allergies are not recorded");
    expect(t).toContain("no primary diagnosis");
    const e2 = enc("P006");
    e2.dischargeAt = undefined;
    e2.pr = [{ code: "47519-00", text: "Hip arthroplasty" }];
    expect(qualityCheck(ctx(e2)).some((q) => q.text.includes("no date"))).toBe(true);
  });
});

describe("NPHIES error explanation", () => {
  it("explains a missing DG1 and tells the user how to fix it", () => {
    const state = seedState();
    const e = state.encounters.find((x) => x.patientId === "P001")!;
    const f = formFromEncounter(state, "A03", e);
    f.dx = [];
    const plan = planMessage(state, "A03", f, { DG1: false });
    const err = plan.checks.find((c) => c.level === "error")!;
    const x = explainCheck(err);
    expect(x.meaning).toContain("diagnosis");
    expect(x.fix).toContain("Diagnosis");
  });

  it("uses the last message log entry for the visit", async () => {
    let state = seedState();
    const e = state.encounters.find((x) => x.patientId === "P001")!;
    const f = formFromEncounter(state, "A03", e);
    f.dx = [];
    const sent = sendOn(state, "A03", f);
    state = sent.state;
    const c = ctx(e, { log: state.log.filter((l) => l.visitNumber === e.visitNumber).sort((a, b) => b.seq - a.seq) });
    const out = await ruleEngine.run({ useCase: "nphies-error", ctx: c });
    // A discharge with no diagnosis code is now an error, because DG1-3 is required.
    expect(out.text).toContain("DG1-3");
    expect(out.text).toContain("Fix:");
    expect(out.explained?.some((i) => i.fix.includes("ICD-10-AM"))).toBe(true);
    expect(out.sources[0]).toContain("ADT message log");
  });

  it("says so when there is no message yet", async () => {
    const out = await ruleEngine.run({ useCase: "nphies-error", ctx: ctx(enc("P005")) });
    expect(out.text).toContain("nothing to explain");
  });
});

describe("engine", () => {
  it("labels every output and lists its sources", async () => {
    for (const u of USE_CASES) {
      const out = await ruleEngine.run({ useCase: u.id, ctx: ctx(enc("P001"), { meds: [amoxicillin] }) });
      expect(out.label).toBe(AI_LABEL);
      expect(out.label).toBe("AI draft. A clinician must review.");
      expect(out.simulated).toBe(true);
      expect(out.text.length).toBeGreaterThan(10);
      expect(out.sources).toBeDefined();
    }
  });

  it("routes free text to the right use case", () => {
    const d = (m: string) => ruleEngine.detectIntent(m);
    expect(d("Draft a SOAP note")).toBe("soap");
    expect(d("is there a drug allergy problem?")).toBe("cds");
    expect(d("suggest ICD-10 codes")).toBe("codes");
    expect(d("write the discharge summary")).toBe("discharge");
    expect(d("summarise this chart")).toBe("summary");
    expect(d("give me a leaflet in Arabic")).toBe("education");
    expect(d("what orders for back pain")).toBe("orders");
    expect(d("why was my message rejected")).toBe("nphies-error");
    expect(d("what documentation is missing")).toBe("quality");
    expect(d("hello")).toBe("help");
  });

  it("gives an Arabic leaflet when asked", async () => {
    const out = await ruleEngine.run({ useCase: "education", ctx: ctx(enc("P001")), message: "diabetes leaflet in arabic" });
    expect(out.text).toMatch(/[؀-ۿ]/);
    expect(out.alt?.label).toBe("English");
  });

  it("is deterministic for the same chart", async () => {
    const c = ctx(enc("P001"));
    const a = await ruleEngine.run({ useCase: "soap", ctx: c });
    const b = await ruleEngine.run({ useCase: "soap", ctx: c });
    expect(a.text).toBe(b.text);
  });
});

describe("SOAP text round trip", () => {
  it("reads an edited note back into its four parts", async () => {
    const { parseSoapText, soapAsText } = await import("./soap");
    const s = draftSoap(ctx(enc("P001")));
    const edited = soapAsText(s).replace("Plan:", "Plan:").replace("the clinician to complete.", "review in 2 days.");
    const back = parseSoapText(edited, s);
    expect(back.subjective).toBe(s.subjective);
    expect(back.plan).toContain("review in 2 days");
    expect(parseSoapText("no headings", s)).toBe(s);
  });
});

describe("governance", () => {
  it("registers every use case the engine offers", async () => {
    const { REGISTER, FRAMEWORKS, usageOf, countStatus } = await import("./governance");
    expect(REGISTER.map((r) => r.id).sort()).toEqual(USE_CASES.map((u) => u.id).sort());
    for (const r of REGISTER) {
      expect(r.hitl.length).toBeGreaterThan(10);
      expect(["Low", "Medium", "High"]).toContain(r.risk);
    }
    // honest: no framework claims certification, and the SFDA note says it is not a certified device
    const sfda = FRAMEWORKS.find((f) => f.id === "sfda")!;
    expect(sfda.note).toMatch(/NOT a certified medical device/);
    expect(sfda.items.some((i) => i.status === "Applied" && /certif|registered|approved/i.test(i.how))).toBe(false);
    expect(countStatus(sfda).Applied + countStatus(sfda).Partial + countStatus(sfda)["Not applied"]).toBe(sfda.items.length);
    // usage and acceptance rate from audit entries
    const e = (id: number, action: "ai-suggest" | "ai-accept" | "ai-reject", detail = "") => ({ id, at: "", user: "u", role: "r", action, target: "AI soap: SOAP note draft", detail });
    const u = usageOf([e(1, "ai-suggest"), e(2, "ai-suggest"), e(3, "ai-suggest"), e(4, "ai-accept", "Edited before accepting."), e(5, "ai-accept", "Accepted as written."), e(6, "ai-reject")]);
    expect(u).toMatchObject({ suggested: 3, accepted: 2, rejected: 1, edited: 1 });
    expect(u.acceptance).toBeCloseTo(2 / 3);
    expect(usageOf([]).acceptance).toBeNull();
    expect(usageOf([e(1, "ai-suggest")], "cds").suggested).toBe(0);
  });
});
