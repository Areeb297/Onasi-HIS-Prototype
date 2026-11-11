import { describe, expect, it } from "vitest";
import { DRUG_BY_ID } from "../rx-catalogue";
import type { DispenseLine, RxItem } from "../rx-types";
import {
  buildDispenseBundle, buildPrescriptionBundle, ksaTimestamp, PROFILE, SYS, type DispenseIn, type Json, type PrescriptionIn,
} from "./medication";
import {
  makeRaqeebRef, simulateResponse, validateDispenseBundle, validateDispenseInput, validatePrescriptionBundle, validatePrescriptionInput,
} from "./medication-validate";

let n = 0;
const gen = () => {
  n += 1;
  const h = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
};

const item = (drugId: string, over: Partial<RxItem> = {}): RxItem => ({
  id: `i-${drugId}`,
  identifier: `RXI-${drugId}`,
  drugId,
  dose: 1,
  frequencyId: "BID",
  asNeeded: false,
  durationDays: 5,
  quantity: 10,
  quantityManual: false,
  route: DRUG_BY_ID[drugId].defaultRoute,
  patientInstruction: "After food",
  fulfillmentNote: "",
  refills: 0,
  reason: { code: "J18.9", text: "Pneumonia, unspecified organism" },
  status: "active",
  version: 1,
  ...over,
});

const rxIn = (drugId: string, over: Partial<PrescriptionIn> = {}, itemOver: Partial<RxItem> = {}): PrescriptionIn => {
  const drug = DRUG_BY_ID[drugId];
  return {
    groupId: "RXG-100001",
    groupIsRaqeeb: false,
    controlled: drug.controlClass !== "U",
    usage: "outpatient",
    authoredAt: new Date(Date.now() - 60_000),
    patient: { id: "P1", healthId: "1090000001", family: "Almutairi", given: "Saad", dob: "1968-03-14", sex: "M", phone: "+966512345678" },
    practitioner: { npi: "NPI1001", family: "Alharbi", given: "Khalid", phone: "+966551001", specialtyCode: "internal-medicine", specialtyText: "Internal Medicine", role: "prescriber" },
    org: { id: "DEMO-HOSP-01", name: "Demo General Hospital" },
    encounter: { visitNumber: "V100001", cls: "O", startAt: "2026-11-11T08:00", facilityName: "Demo General Hospital" },
    heightCm: 175,
    weightKg: 84,
    ageYears: 58,
    allergies: [{ text: "Penicillin", severity: "SV", reaction: "Rash" }],
    items: [{ item: item(drugId, itemOver), drug, dispensed: 0 }],
    ...over,
  };
};

const errors = <T extends { level: string }>(c: T[]): T[] => c.filter((x) => x.level === "error");
const res = (b: { entry: { resource: Json }[] }, t: string) => b.entry.map((e) => e.resource).filter((r) => r.resourceType === t);

describe("time", () => {
  it("formats with seconds and +03:00", () => {
    expect(ksaTimestamp(new Date("2026-11-11T00:00:00Z"))).toBe("2026-11-11T03:00:00+03:00");
  });
});

describe("prescription bundle", () => {
  const b = buildPrescriptionBundle(rxIn("DRG001"), { uuid: gen });

  it("is a message bundle with the nphies profile and a MessageHeader first", () => {
    expect(b.type).toBe("message");
    expect(b.meta.profile[0]).toBe(PROFILE.bundlePrescription);
    expect(b.entry[0].resource.resourceType).toBe("MessageHeader");
    expect(b.entry.every((e) => e.fullUrl === `urn:uuid:${e.resource.id as string}`)).toBe(true);
  });

  it("holds patient, practitioner, role, organization, encounter, height and weight", () => {
    for (const t of ["Patient", "Practitioner", "PractitionerRole", "Organization", "Encounter"]) expect(res(b, t)).toHaveLength(1);
    const codes = res(b, "Observation").map((o) => ((o.code as Json).coding as Json[])[0].code);
    expect(codes).toContain("50373000");
    expect(codes).toContain("363808001");
    expect(res(b, "AllergyIntolerance")).toHaveLength(1);
  });

  it("builds the MedicationRequest the way the page says", () => {
    const r = res(b, "MedicationRequest")[0];
    expect((r.contained as Json[])[0].id).toBe("medicationprescribed");
    expect((r.medicationReference as Json).reference).toBe("#medicationprescribed");
    expect(r.intent).toBe("order");
    expect(r.category).toHaveLength(2);
    expect(((r.text as Json).div as string)).toContain("xhtml");
    expect(r.dosageInstruction).toHaveLength(2);
    expect((r.supportingInformation as Json[]).length).toBeGreaterThanOrEqual(2);
    const patientId = res(b, "Patient")[0].id;
    expect((r.subject as Json).reference).toBe(`Patient/${patientId as string}`);
  });

  it("passes every validator", () => {
    const checks = [...validatePrescriptionInput(rxIn("DRG001"), { previouslySent: false }), ...validatePrescriptionBundle(b)];
    expect(errors(checks)).toEqual([]);
    expect(checks.filter((c) => c.level === "ok").length).toBeGreaterThan(20);
  });
});

describe("prescription validators", () => {
  it("rejects a missing height", () => {
    const input = rxIn("DRG001", { heightCm: undefined });
    const checks = [...validatePrescriptionInput(input, { previouslySent: false }), ...validatePrescriptionBundle(buildPrescriptionBundle(input, { uuid: gen }))];
    expect(errors(checks).length).toBeGreaterThanOrEqual(2);
    expect(errors(checks).every((c) => c.code === "required")).toBe(true);
  });

  it("rejects a missing weight", () => {
    const checks = validatePrescriptionInput(rxIn("DRG001", { weightKg: undefined }), { previouslySent: false });
    expect(errors(checks)[0].text).toContain("Weight");
  });

  it("rejects repeats on a controlled item", () => {
    const input = rxIn("DRG033", {}, { refills: 2 });
    const checks = [...validatePrescriptionInput(input, { previouslySent: false }), ...validatePrescriptionBundle(buildPrescriptionBundle(input, { uuid: gen }))];
    expect(errors(checks).some((c) => c.text.includes("repeats"))).toBe(true);
  });

  it("needs an E.164 phone for Raqeeb items", () => {
    const input = rxIn("DRG033");
    input.patient.phone = "0512345678";
    expect(errors(validatePrescriptionBundle(buildPrescriptionBundle(input, { uuid: gen }))).some((c) => c.text.includes("E.164"))).toBe(true);
  });

  it("does not need structured phone rank for uncontrolled items", () => {
    const input = rxIn("DRG001");
    input.patient.phone = "0512345678";
    expect(errors(validatePrescriptionBundle(buildPrescriptionBundle(input, { uuid: gen })))).toEqual([]);
  });

  it("applies the cancelled and stopped status rules", () => {
    const cancelled = validatePrescriptionInput(
      { ...rxIn("DRG001"), items: [{ item: item("DRG001", { status: "cancelled" }), drug: DRUG_BY_ID.DRG001, dispensed: 4 }] },
      { previouslySent: true },
    );
    expect(errors(cancelled)).toHaveLength(1);
    const stopped = validatePrescriptionInput(
      { ...rxIn("DRG001"), items: [{ item: item("DRG001", { status: "stopped" }), drug: DRUG_BY_ID.DRG001, dispensed: 0 }] },
      { previouslySent: true },
    );
    expect(stopped.some((c) => c.level === "warn")).toBe(true);
  });

  it("asks a sent Raqeeb prescription to carry the Raqeeb reference id", () => {
    const checks = validatePrescriptionInput(rxIn("DRG033"), { previouslySent: true });
    expect(errors(checks).some((c) => c.code === "not-found")).toBe(true);
    const ok = validatePrescriptionInput(rxIn("DRG033", { groupIsRaqeeb: true, groupId: "RQB10007919" }), { previouslySent: true });
    expect(errors(ok)).toEqual([]);
  });

  it("flags a Health ID the registry would not find", () => {
    const input = rxIn("DRG001");
    input.patient.healthId = "ABC";
    const checks = validatePrescriptionBundle(buildPrescriptionBundle(input, { uuid: gen }));
    expect(errors(checks).some((c) => c.code === "not-found")).toBe(true);
  });
});

describe("simulated response", () => {
  it("accepts Raqeeb scope and returns a reference id", () => {
    const r = simulateResponse({ checks: [], kind: "prescription", raqeebScope: true, groupId: "RXG-1", newRef: makeRaqeebRef(1) });
    expect(r.http).toBe(201);
    expect(r.refId).toMatch(/^RQB\d{8}$/);
    const issue = (r.outcome.issue as Json[])[0];
    expect(issue.severity).toBe("information");
    expect((issue.details as Json).text).toContain(r.refId as string);
  });

  it("keeps the existing reference id on updates", () => {
    const r = simulateResponse({ checks: [], kind: "prescription", raqeebScope: true, groupId: "RQB10007919", existingRef: "RQB10007919", newRef: "RQB99999999" });
    expect(r.refId).toBe("RQB10007919");
  });

  it("gives no reference id outside Raqeeb scope", () => {
    const r = simulateResponse({ checks: [], kind: "prescription", raqeebScope: false, groupId: "RXG-1", newRef: "RQB1" });
    expect(r.refId).toBeUndefined();
    expect(r.http).toBe(201);
  });

  it("rejects with an OperationOutcome when a check fails", () => {
    const r = simulateResponse({
      checks: [{ level: "error", text: "Body height is required", code: "required", spec: "Prescription Bundle 1.7" }, { level: "ok", text: "fine" }],
      kind: "prescription",
      raqeebScope: false,
      groupId: "RXG-1",
      newRef: "RQB1",
    });
    expect(r.http).toBe(400);
    const issues = r.outcome.issue as Json[];
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "required" });
  });
});

describe("dispense bundle", () => {
  const line = (drugId: string, over: Partial<DispenseLine> = {}): DispenseLine => ({
    id: "l1",
    identifier: "DSP-100001-1",
    itemId: `i-${drugId}`,
    drugId,
    quantity: 10,
    type: "FF",
    status: "completed",
    refillsRemaining: 0,
    daysSupply: 5,
    version: 1,
    ...over,
  });
  const dIn = (drugId: string, over: Partial<DispenseIn> = {}, lineOver: Partial<DispenseLine> = {}): DispenseIn => {
    const base = rxIn(drugId);
    return {
      usage: "outpatient",
      raqeebScope: DRUG_BY_ID[drugId].controlClass !== "U",
      handedOverAt: new Date(Date.now() - 1000),
      patient: base.patient,
      dispenser: { npi: "NPI-PH-4", family: "Alzahrani", given: "Noura", phone: "+96654000004", specialtyCode: "pharmacy", specialtyText: "Pharmacy", role: "pharmacist" },
      org: base.org,
      encounter: base.encounter,
      lines: [{ line: line(drugId, lineOver), item: item(drugId), drug: DRUG_BY_ID[drugId], controlled: DRUG_BY_ID[drugId].controlClass !== "U" }],
      ...over,
    };
  };

  it("builds and validates an uncontrolled FF dispense", () => {
    const input = dIn("DRG001");
    const b = buildDispenseBundle(input, { uuid: gen });
    expect(b.meta.profile[0]).toBe(PROFILE.bundleDispense);
    const d = res(b, "MedicationDispense")[0];
    expect(((d.type as Json).coding as Json[])[0].code).toBe("FF");
    expect((d.authorizingPrescription as Json[])[0]).toEqual({ identifier: { system: SYS.rxItem, value: "RXI-DRG001" } });
    expect(((d.contained as Json[]).map((c) => c.id))).toEqual(["medicationdispensed", "medicationknowledge"]);
    expect(errors([...validateDispenseInput(input), ...validateDispenseBundle(b)])).toEqual([]);
  });

  it("carries the SecureCode tag for a Raqeeb dispense", () => {
    const input = dIn("DRG033", { secure: { mode: "authenticated", value: "482913" } });
    const d = res(buildDispenseBundle(input, { uuid: gen }), "MedicationDispense")[0];
    const tag = ((d.meta as Json).tag as Json[])[0];
    expect(tag.code).toBe("Code-Authenticated");
    expect(errors(validateDispenseBundle(buildDispenseBundle(input, { uuid: gen })))).toEqual([]);
  });

  it("needs a justification and receiver for Code-Override", () => {
    const input = dIn("DRG033", { secure: { mode: "override", justification: "" } });
    const checks = validateDispenseBundle(buildDispenseBundle(input, { uuid: gen }));
    expect(errors(checks).some((c) => c.text.includes("justification"))).toBe(true);
    const ok = dIn("DRG033", { secure: { mode: "override", justification: "Patient has no phone" } });
    expect(errors(validateDispenseBundle(buildDispenseBundle(ok, { uuid: gen })))).toEqual([]);
  });

  it("requires 0 refills remaining for a Raqeeb dispense", () => {
    const input = dIn("DRG033", { secure: { mode: "authenticated", value: "1" } }, { refillsRemaining: 1 });
    expect(errors(validateDispenseInput(input)).length).toBe(1);
  });

  it("builds a bundle with several dispense items", () => {
    const input = dIn("DRG001");
    input.lines.push({ line: line("DRG002", { id: "l2", identifier: "DSP-100001-2" }), item: item("DRG002"), drug: DRUG_BY_ID.DRG002, controlled: false });
    const b = buildDispenseBundle(input, { uuid: gen });
    expect(res(b, "MedicationDispense")).toHaveLength(2);
    expect(errors(validateDispenseBundle(b))).toEqual([]);
  });
});
