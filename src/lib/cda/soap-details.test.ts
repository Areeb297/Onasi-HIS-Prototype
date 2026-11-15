import { describe, expect, it } from "vitest";
import { seedState } from "../store";
import { buildDocument } from "./build";
import type { DocInput, DocType, SoapLite } from "./types";

const state = seedState();
const enc = structuredClone(state.encounters.find((e) => e.patientId === "P006")!);
enc.vitals = { bp: "120/80", pulse: "80", temp: "36.9", spo2: "98", rr: "16", weight: "70", at: "2026-02-28T10:00" };
const patient = state.patients.find((p) => p.id === enc.patientId)!;

const soap = (over: Partial<SoapLite> = {}): SoapLite => ({ subjective: "Cough for 3 days", objective: "Chest clear", assessment: "Viral illness", plan: "Rest", ...over });
const build = (type: DocType, s: SoapLite[]) => {
  const i: DocInput = {
    type, enc, patient, forms: () => [], author: { id: "D1001", name: "Dr. Khalid Alharbi", specialty: "Medicine" },
    now: new Date("2026-03-01T06:30:00Z"), docId: "V-T-1", setId: "V-T-1", version: 1, soap: s,
  };
  return buildDocument(i).xml;
};

describe("SOAP sub-fields in the clinical documents", () => {
  for (const type of ["outpatient", "discharge"] as const) {
    it(`${type}: history and examination sections carry the structured parts`, () => {
      const xml = build(type, [soap({ hpi: "Started after a flight", pastMedical: "Asthma", familyHistory: "Father had diabetes", socialHistory: "Non-smoker", vitalSigns: "BP 120/80", physicalExam: "No wheeze" })]);
      for (const t of ["Cough for 3 days", "Started after a flight", "Asthma", "Father had diabetes", "Non-smoker", "Chest clear", "BP 120/80", "No wheeze"]) expect(xml, t).toContain(t);
    });
  }

  it("a note with no sub-fields reads as before", () => {
    const xml = build("outpatient", [soap()]);
    expect(xml).toContain("Cough for 3 days");
    expect(xml).toContain("Chest clear");
    expect(xml).not.toContain("Physical examination:");
  });

  it("sub-fields alone are enough, with no subjective or objective text", () => {
    const xml = build("outpatient", [soap({ subjective: "", objective: "", hpi: "Chest pain on climbing stairs", physicalExam: "Mild tenderness" })]);
    expect(xml).toContain("Chest pain on climbing stairs");
    expect(xml).toContain("Mild tenderness");
  });
});
