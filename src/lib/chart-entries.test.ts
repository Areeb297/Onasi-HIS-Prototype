import { describe, expect, it } from "vitest";
import {
  COMPLAINT_MAX, al1Reaction, al1Severity, canRetireDx, complaintProblems, coverageView, dxKind, dxListProblems, dxPriority,
  finalizeAllergy, isLiveAllergy, normalizeDx, placeAllergy, reactivateDx, saveDx, searchCodes,
} from "./chart-entries";
import type { Allergy, Dx } from "./model";
import { ALLERGENS, ICD10AM_DIAGNOSES, SNOMED_COMPLAINTS } from "./reference-data";
import { formFromEncounter, planMessage, seedState } from "./store";

const ctx = { discharged: false, inpatient: true, by: "Dr. Khalid Alharbi", at: "2026-11-15T09:00" };
const lines = (msg: string, id: string) => msg.split("\r").filter((l) => l.startsWith(`${id}|`)).map((l) => l.split("|"));
const errors = (p: { checks: { level: string; text: string }[] }) => p.checks.filter((c) => c.level === "error").map((c) => c.text);

describe("code lists and search", () => {
  it("has at least 150 ICD-10-AM diagnoses and 60 coded allergens, with no duplicate codes", () => {
    expect(ICD10AM_DIAGNOSES.length).toBeGreaterThanOrEqual(150);
    expect(ALLERGENS.length).toBeGreaterThanOrEqual(60);
    for (const list of [ICD10AM_DIAGNOSES, ALLERGENS, SNOMED_COMPLAINTS]) expect(new Set(list.map((x) => x.code)).size).toBe(list.length);
    for (const g of ["drug", "food", "substance"]) expect(ALLERGENS.some((a) => a.group === g)).toBe(true);
  });
  it("needs three letters or the start of a code", () => {
    expect(searchCodes(ICD10AM_DIAGNOSES, "pn")).toEqual([]);
    expect(searchCodes(ICD10AM_DIAGNOSES, "pneu").map((x) => x.code)).toContain("J18.9");
    expect(searchCodes(ICD10AM_DIAGNOSES, "J1")[0].code.startsWith("J1")).toBe(true);
    expect(searchCodes(ICD10AM_DIAGNOSES, "e119").map((x) => x.code)).toEqual(["E11.9"]);
    expect(searchCodes(SNOMED_COMPLAINTS, "3866").map((x) => x.code)).toEqual(["386661006"]);
  });
});

describe("diagnosis rules", () => {
  const pneumonia = { code: "J18.9", text: "Pneumonia, unspecified", onAdmission: true };
  const diabetes = { code: "E11.9", text: "Type 2 diabetes mellitus without complication", onAdmission: false };

  it("one Principal diagnosis is mandatory", () => {
    const r = saveDx([], { ...diabetes, kind: "S" }, null, ctx);
    expect(r.error).toMatch(/One Principal diagnosis is mandatory/);
    expect(r.list).toEqual([]);
    const ok = saveDx([], { ...pneumonia, kind: "P" }, null, ctx);
    expect(ok.error).toBeUndefined();
    expect(ok.list[0]).toMatchObject({ code: "J18.9", kind: "P", type: "W", onset: "2", by: ctx.by });
  });

  it("only one Principal: a new Principal makes the old one Secondary and goes first", () => {
    const one = saveDx([], { ...pneumonia, kind: "P" }, null, ctx).list;
    const two = saveDx(one, { ...diabetes, kind: "P" }, null, ctx);
    expect(two.demoted).toContain("J18.9");
    expect(two.list.map((d) => [d.code, d.kind])).toEqual([["E11.9", "P"], ["J18.9", "S"]]);
    expect(dxListProblems(two.list)).toEqual([]);
    expect(dxListProblems([{ ...two.list[0] }, { ...two.list[1], kind: "P" }])).toEqual(["Only one Principal diagnosis is allowed."]);
  });

  it("will not leave the visit without a Principal diagnosis", () => {
    const list = saveDx(saveDx([], { ...pneumonia, kind: "P" }, null, ctx).list, { ...diabetes, kind: "S" }, null, ctx).list;
    expect(saveDx(list, { ...pneumonia, kind: "S" }, 0, ctx).error).toMatch(/mandatory/);
    expect(canRetireDx(list, 0)).toMatch(/Make another diagnosis Principal/);
    expect(canRetireDx(list, 1)).toBeNull();
    expect(canRetireDx([list[0]], 0)).toBeNull();
    expect(saveDx(list, { ...diabetes, kind: "S" }, 0, ctx).error).toMatch(/already in the list/);
  });

  it("maps the HIS types to DG1-6 and keeps the outpatient onset flag empty", () => {
    const p = saveDx([], { ...pneumonia, kind: "P" }, null, { ...ctx, inpatient: false }).list;
    expect(p[0].onset).toBeUndefined();
    const ad = saveDx(p, { code: "I10", text: "Essential (primary) hypertension", kind: "AD", onAdmission: true }, null, ctx).list;
    const df = saveDx(ad, { code: "J20.9", text: "Acute bronchitis, unspecified", kind: "DF", onAdmission: false }, null, { ...ctx, discharged: true }).list;
    expect(df.map((d) => d.type)).toEqual(["W", "A", "W"]);
    expect(saveDx(p, { ...pneumonia, kind: "P" }, 0, { ...ctx, discharged: true }).list[0].type).toBe("F");
  });

  it("brings an inactive diagnosis back without a second Principal", () => {
    const active = saveDx([], { ...pneumonia, kind: "P" }, null, ctx).list;
    const old: Dx = { code: "I10", text: "Essential (primary) hypertension", type: "W", kind: "P" };
    expect(reactivateDx(active, old, false).list[1]).toMatchObject({ code: "I10", kind: "S" });
    expect(reactivateDx([], { ...old, kind: "S" }, false).list[0].kind).toBe("P");
  });
});

describe("older saved diagnoses (Admitting, Working, Final)", () => {
  const old: Dx[] = [
    { code: "J18.9", text: "Pneumonia, unspecified organism", type: "A" },
    { code: "I10", text: "Essential (primary) hypertension", type: "A" },
    { code: "E11.9", text: "Type 2 diabetes mellitus without complications", type: "W" },
    { code: "K35.8", text: "Acute appendicitis, other and unspecified", type: "F" },
  ];
  it("reads the first as Principal, an Admitting one as Admitting and the rest as Secondary", () => {
    expect(old.map((d, i) => dxKind(d, i))).toEqual(["P", "AD", "S", "S"]);
    expect(dxListProblems(old)).toEqual([]);
    expect(old.map((_, i) => dxPriority(old, i))).toEqual(["1", "2", "2", "2"]);
    const n = normalizeDx(old);
    expect(n.map((d) => d.kind)).toEqual(["P", "AD", "S", "S"]);
    // DG1-6 is not rewritten when an old record is read.
    expect(n.map((d) => d.type)).toEqual(["A", "A", "W", "F"]);
  });

  it("still builds the same DG1 segments for an old record", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P006")!;
    const f = formFromEncounter(state, "A08-CNHI", enc);
    f.dx = old.map((d) => ({ ...d }));
    const plan = planMessage(state, "A08-CNHI", f);
    expect(errors(plan)).toEqual([]);
    expect(lines(plan.message, "DG1").map((l) => [l[6].split("^")[0], l[15]])).toEqual([["A", "1"], ["A", "2"], ["W", "2"], ["F", "2"]]);
  });
});

describe("diagnoses typed in the chart, in the messages", () => {
  it("DG1-15 follows the Principal type, DG1-6 is final on discharge and ZDG1-3 follows On Admission", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P006")!;
    let list = saveDx([], { code: "S72.00", text: "Fracture of neck of femur, part unspecified", kind: "P", onAdmission: true }, null, ctx).list;
    list = saveDx(list, { code: "I10", text: "Essential (primary) hypertension", kind: "AD", onAdmission: true }, null, ctx).list;
    list = saveDx(list, { code: "N39.0", text: "Urinary tract infection, site not specified", kind: "S", onAdmission: false }, null, ctx).list;
    const f = formFromEncounter(state, "A08-CNHI", { ...enc, dx: list });
    const plan = planMessage(state, "A08-CNHI", f);
    expect(errors(plan)).toEqual([]);
    expect(lines(plan.message, "DG1").map((l) => [l[3].split("^")[0], l[6].split("^")[0], l[15]])).toEqual([
      ["S72.00", "F", "1"], ["I10", "A", "2"], ["N39.0", "F", "2"],
    ]);
    expect(lines(plan.message, "ZDG1").map((l) => l[3])).toEqual(["2", "2", "1"]);
    // While the visit is open (A08), Principal and Secondary stay Working.
    const open = planMessage(state, "A08", formFromEncounter(state, "A08", { ...enc, dx: list }), { DG1: true });
    expect(lines(open.message, "DG1").map((l) => l[6].split("^")[0])).toEqual(["W", "A", "W"]);
  });
});

describe("allergies", () => {
  const full: Allergy = {
    text: "Peanut", code: "762952008", category: "Food", reactionType: "Allergy", clinicalStatus: "Active", verification: "Confirmed",
    criticality: "High", source: "Patient", severity: "MI", reaction: "",
    reactions: [
      { manifestations: ["Hives", "Lip swelling"], severity: "MO", route: "Ingestion", outcome: "Resolved" },
      { manifestations: ["Wheeze", "hives"], anaphylaxis: true },
    ],
  };

  it("works out AL1-2, AL1-4 and AL1-5 from what the HIS records", () => {
    const a = finalizeAllergy(full);
    expect(a.type).toBe("FALG");
    expect(a.severity).toBe("SV");
    expect(a.reaction).toBe("Anaphylaxis, Hives, Lip swelling, Wheeze");
    expect(al1Severity({ criticality: "Low", reactions: [], severity: "SV" })).toBe("MI");
    expect(al1Severity({ reactions: [{ manifestations: ["Rash"], severity: "MO" }], criticality: "High", severity: "MI" })).toBe("MO");
    expect(al1Reaction({ reaction: "Rash" })).toBe("Rash");
  });

  it("keeps AL1 valid for a full record, a free-text record and an older record", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const f = formFromEncounter(state, "A08", enc);
    f.allergies = [
      finalizeAllergy(full),
      finalizeAllergy({ text: "Hair dye", category: "Environment", reactionType: "Allergy", clinicalStatus: "Active", verification: "Unconfirmed", criticality: "Unable To Assess", source: "Family Member", severity: "MI", reaction: "", reactions: [] }),
      { text: "Penicillin", severity: "SV", reaction: "Rash", type: "DALG", code: "764146007" },
    ];
    const plan = planMessage(state, "A08", f, { AL1: true });
    expect(errors(plan)).toEqual([]);
    const al1 = lines(plan.message, "AL1");
    expect(al1.map((l) => l[2])).toEqual(["FALG", "ALG", "DALG"]);
    expect(al1[0][3]).toBe("762952008^Peanut^2.16.840.1.113883.6.96");
    expect(al1[0][4].split("^")[0]).toBe("SV");
    expect(al1[0][5]).toBe("Anaphylaxis, Hives, Lip swelling, Wheeze");
    expect(al1[1][3]).toBe("^Hair dye");
    expect(al1[1][4].split("^")[0]).toBe("MO");
    expect(al1[2][3]).toBe("764146007^Penicillin^2.16.840.1.113883.6.96");
  });

  it("keeps inactive, resolved, refuted and entered-in-error allergies out of the active list", () => {
    expect(isLiveAllergy({ ...full })).toBe(true);
    for (const p of [{ active: false }, { clinicalStatus: "Resolved" as const }, { verification: "Refuted" as const }, { verification: "Entered In Error" as const }]) {
      expect(isLiveAllergy({ ...full, ...p })).toBe(false);
    }
    const old: Allergy = { text: "Latex", severity: "MO", reaction: "Hives", type: "ALG", code: "111088007" };
    expect(isLiveAllergy(old)).toBe(true);
    const placed = placeAllergy([old], [], { ...full, verification: "Refuted" });
    expect(placed.allergies.map((a) => a.text)).toEqual(["Latex"]);
    expect(placed.allergiesInactive.map((a) => a.text)).toEqual(["Peanut"]);
    const back = placeAllergy(placed.allergies, placed.allergiesInactive, { ...full, verification: "Confirmed" }, { list: "inactive", index: 0 });
    expect(back.allergies.map((a) => a.text)).toEqual(["Latex", "Peanut"]);
    expect(back.allergiesInactive).toEqual([]);
  });
});

describe("chief complaints", () => {
  it("allows codes or free text, not both, and at most 500 characters of text", () => {
    expect(complaintProblems([], "")).toHaveLength(1);
    expect(complaintProblems([{ code: "386661006", text: "Fever" }], "fever")).toEqual(["You can either select code(s) or enter free text."]);
    expect(complaintProblems([], "x".repeat(COMPLAINT_MAX))).toEqual([]);
    expect(complaintProblems([], "x".repeat(COMPLAINT_MAX + 1))[0]).toMatch(/500/);
    expect(complaintProblems([{ code: "R05", text: "Cough" }, { code: "R50.9", text: "Fever, unspecified" }], "")).toEqual([]);
  });
});

describe("patient header payer", () => {
  const card = { payer: "Bupa Arabia", policyNo: "P1", memberId: "M1", className: "Class A", network: "Gold Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 10, status: "Active" as const };
  it("shows Cash without cover, and Eligible or Not Eligible with cover", () => {
    expect(coverageView({}, "2026-11-15")).toEqual({ payer: "Cash" });
    expect(coverageView({ extra: { visitPayType: "Cash", insurance: card } }, "2026-11-15").payer).toBe("Cash");
    expect(coverageView({ extra: { visitPayType: "Insurance", insurance: card } }, "2026-11-15")).toMatchObject({ payer: "Bupa Arabia", plan: "Class A, Gold Network", eligible: true });
    expect(coverageView({ extra: { insurance: { ...card, expiryDate: "2026-06-30" } } }, "2026-11-15").eligible).toBe(false);
    expect(coverageView({ extra: { insurance: card } }, "2026-11-15", { status: "not-eligible" }).eligible).toBe(false);
  });
});
