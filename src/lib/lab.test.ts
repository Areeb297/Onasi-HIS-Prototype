import { beforeEach, describe, expect, it } from "vitest";
import {
  amendLabOrder, CONFORMANCE_SAMPLE_CODES, LAB_CATALOG, LAB_DIRECTOR, buildLabOrderBundle, buildLabReportBundle, cancelLabOrder, cancelLabResult,
  collectSpecimens, createConformanceSampleOrder, fillSampleResults, getLab, getOrder, interpretValue, labAmendmentMinimums, labConformance,
  labResultMinimums, missingResults, personFromDoctor, personFromUser, placeLabOrder, publishLabResult, resetLab, saveLabResult,
  sendLabOrder, setRejectNext, startProcessing, testByCode, validateLabOrderBundle, validateLabReportBundle,
} from "./lab";
import { byType, GUID_RE, resourcesOf } from "./fhir/common";
import { LAB_DEPARTMENT_CODES, versionOf } from "./fhir/lab-validate";
import { KSA_LAB_UNITS } from "./fhir/lab-units";
import { ANTIBIOTICS, LAB_DEPTS, SPECIMEN_TYPES } from "./fhir/lab-catalog";
import { placerNumber } from "./fhir/lab-bundles";
import type { LabOrder } from "./fhir/types";
import type { Check } from "./model";
import { currentUser, switchUser } from "./session";
import { getState } from "./store";

const enc = () => getState().encounters.find((e) => e.patientId === "P001")!;
const patient = () => getState().patients.find((p) => p.id === "P001")!;
const errors = (c: Check[]) => c.filter((x) => x.level === "error");

function mkOrder(codes: string[], extra: Partial<LabOrder> = {}): LabOrder {
  const e = enc();
  return {
    id: "LO-900001", visitNumber: e.visitNumber, patientId: e.patientId, codes, priority: "routine", fasting: null, note: "",
    orderedAt: new Date().toISOString(), orderedById: e.attending, status: "in-progress", specimens: [], results: {},
    orderDirty: false, resultDirty: false, sends: [], ...extra,
  };
}

/** A resulted order with the Seha sample values, built without the store. */
function sampleOrder(): LabOrder {
  const o = mkOrder(CONFORMANCE_SAMPLE_CODES, {
    specimens: [
      { id: "SP-900001-BLD", key: "BLD", collectedAt: new Date(Date.now() - 3_600_000).toISOString(), receivedAt: new Date(Date.now() - 3_000_000).toISOString(), collectedBy: "Tech" },
      { id: "SP-900001-SER", key: "SER", collectedAt: new Date(Date.now() - 3_600_000).toISOString(), receivedAt: new Date(Date.now() - 3_000_000).toISOString(), collectedBy: "Tech" },
      { id: "SP-900001-URN", key: "URN", collectedAt: new Date(Date.now() - 3_600_000).toISOString(), receivedAt: new Date(Date.now() - 3_000_000).toISOString(), collectedBy: "Tech" },
    ],
  });
  const at = new Date().toISOString();
  const sex = patient().sex;
  for (const code of CONFORMANCE_SAMPLE_CODES) {
    const t = testByCode(code)!;
    for (const leaf of t.panel ? t.panel.map((m) => testByCode(m)!) : [t]) {
      if (leaf.kind === "organism") {
        o.results[leaf.code] = { code: leaf.code, value: ">100,000 CFU/mL", interp: "POS", status: "final", at, organism: { code: "112283007", display: "Escherichia coli" }, sens: [{ key: "AMP", result: "R" }, { key: "CRO", result: "S" }] };
      } else {
        const v = leaf.code === "718-7" ? "9.8" : leaf.code === "6690-2" ? "7.2" : leaf.code === "1988-5" ? "48" : leaf.kind === "string" ? "Negative" : "1.015";
        o.results[leaf.code] = { code: leaf.code, value: v, interp: interpretValue(leaf, v, sex), status: "final", at };
      }
    }
  }
  return o;
}

const ctx = () => ({ patient: patient(), enc: enc() });

describe("laboratory catalogue", () => {
  it("has about 25 or more tests with LOINC codes and the named examples", () => {
    expect(LAB_CATALOG.length).toBeGreaterThanOrEqual(25);
    for (const code of ["718-7", "2345-7", "2160-0", "6690-2", "777-3", "2951-2", "2823-3", "1742-6", "1920-8", "4548-4"]) {
      expect(testByCode(code), code).toBeTruthy();
    }
    expect(testByCode("58410-2")?.panel).toContain("718-7"); // CBC
    expect(LAB_CATALOG.some((t) => t.kind === "organism")).toBe(true); // microbiology culture
    expect(LAB_CATALOG.some((t) => t.code === "24357-6")).toBe(true); // urinalysis
  });

  it("every panel member exists", () => {
    for (const t of LAB_CATALOG.filter((x) => x.panel)) for (const m of t.panel!) expect(testByCode(m), `${t.code} -> ${m}`).toBeTruthy();
  });

  it("flags values", () => {
    const hb = testByCode("718-7")!;
    expect(interpretValue(hb, "9.8", "M")).toBe("L");
    expect(interpretValue(hb, "14", "M")).toBe("N");
    expect(interpretValue(hb, "6.5", "M")).toBe("LL");
    expect(interpretValue(hb, "12.5", "F")).toBe("N");
    expect(interpretValue(hb, "12.5", "M")).toBe("L");
    expect(interpretValue(testByCode("10839-9")!, "0.52", "M")).toBe("HH");
    expect(interpretValue(testByCode("1988-5")!, "48", "M")).toBe("H");
    expect(interpretValue(testByCode("25428-4")!, "Negative", "M")).toBe("N");
    expect(interpretValue(testByCode("25428-4")!, "2+", "M")).toBe("A");
  });
});

describe("laboratory order bundle", () => {
  const order = mkOrder(["58410-2", "4548-4"], { fasting: true, status: "received" });
  const orderer = personFromDoctor(order.orderedById);
  const bundle = buildLabOrderBundle({ ...ctx(), order, orderer, version: 1, docStatus: "final" });

  it("follows the Bundle page", () => {
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("document");
    expect(GUID_RE.test(bundle.id)).toBe(true);
    expect(bundle.meta.profile).toContain("http://nphies.sa/fhir/ksa/nphies-cs/StructureDefinition/bundleLabOrder|1.0");
    expect(bundle.identifier.system.startsWith("urn:oid:")).toBe(true);
    expect(bundle.timestamp).toMatch(/\+03:00$/);
    expect(bundle.entry[0].resource.resourceType).toBe("Composition");
    for (const e of bundle.entry) expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
  });

  it("carries the visit number, Health ID and one ServiceRequest per ordered test", () => {
    const encounter = byType(bundle, "Encounter")[0];
    expect(encounter.identifier[0].value).toBe(enc().visitNumber);
    expect(byType(bundle, "Patient")[0].identifier[0].value).toBe(patient().healthId);
    expect(byType(bundle, "Patient")[0].identifier[0].system).toBe("urn:oid:2.16.840.1.113883.3.3731.1.1.100.1");
    const srs = byType(bundle, "ServiceRequest");
    expect(srs).toHaveLength(2);
    expect(srs[0].identifier[0].type.coding[0].code).toBe("PLAC");
    expect(srs[0].status).toBe("active");
    expect(srs[0].intent).toBe("order");
    expect(byType(bundle, "Practitioner")[0].identifier[0].system).toBe("urn:oid:2.16.840.1.113883.3.3731.1.2.1");
  });

  it("has Additional Order Information with age and fasting, and passes the validator", () => {
    const codes = byType(bundle, "Observation").map((o) => o.code.coding[0].code);
    expect(codes).toContain("424144002");
    expect(codes).toContain("16985007");
    expect(codes).not.toContain("440565004");
    const checks = validateLabOrderBundle(bundle, { visitNumber: enc().visitNumber, healthId: patient().healthId });
    expect(errors(checks)).toEqual([]);
  });

  it("an amendment replaces the original: same set identifier, higher version, status amended", () => {
    const v2 = buildLabOrderBundle({ ...ctx(), order, orderer, version: 2, docStatus: "amended" });
    const c1 = byType(bundle, "Composition")[0];
    const c2 = byType(v2, "Composition")[0];
    expect(c2.identifier).toEqual(c1.identifier);
    expect(versionOf(v2)).toBe(2);
    expect(c2.status).toBe("amended");
    expect(v2.id).not.toBe(bundle.id);
    expect(v2.identifier.value).not.toBe(bundle.identifier.value);
    const cancelled = buildLabOrderBundle({ ...ctx(), order, orderer, version: 2, docStatus: "cancelled" });
    expect(byType(cancelled, "Composition")[0].status).toBe("cancelled");
    expect(errors(validateLabOrderBundle(cancelled))).toEqual([]);
  });

  it("the validator catches a wrong visit number, missing Health ID and a wrong ServiceRequest status", () => {
    const bad = structuredClone(bundle);
    byType(bad, "Encounter")[0].identifier[0].value = "V999999";
    delete byType(bad, "Patient")[0].identifier;
    byType(bad, "ServiceRequest")[0].status = "completed";
    const texts = errors(validateLabOrderBundle(bad, { visitNumber: enc().visitNumber })).map((c) => c.text).join(" | ");
    expect(texts).toContain("visit number");
    expect(texts).toContain("Health ID");
    expect(texts).toContain("status must be active");
  });

  it("includes a specimen without receivedTime once collected", () => {
    const withSpecimen = mkOrder(["58410-2"], { specimens: [{ id: "SP-1-BLD", key: "BLD", collectedAt: new Date().toISOString(), collectedBy: "Tech" }] });
    const b = buildLabOrderBundle({ ...ctx(), order: withSpecimen, orderer, version: 1, docStatus: "final" });
    const sp = byType(b, "Specimen")[0];
    expect(sp.collection.collectedDateTime).toMatch(/\+03:00$/);
    expect("receivedTime" in sp).toBe(false);
    expect(byType(b, "ServiceRequest")[0].specimen[0].reference).toBe(`Specimen/${sp.id}`);
    expect(errors(validateLabOrderBundle(b))).toEqual([]);
  });
});

describe("laboratory report bundle and the Seha minimum content (2.1.1)", () => {
  const order = sampleOrder();
  const args = { ...ctx(), order, orderer: personFromDoctor(order.orderedById), performer: personFromUser(currentUser()), authenticator: LAB_DIRECTOR };
  const bundle = buildLabReportBundle({ ...args, version: 1, docStatus: "final" });

  it("passes the validator", () => {
    expect(errors(validateLabReportBundle(bundle, { visitNumber: enc().visitNumber, healthId: patient().healthId }))).toEqual([]);
    expect(byType(bundle, "DiagnosticReport")[0].effectivePeriod.end).toBe(byType(bundle, "Composition")[0].date);
    expect(byType(bundle, "PractitionerRole").length).toBeGreaterThanOrEqual(2);
  });

  it("has a panel with an abnormal quantity (structured range) and a normal quantity (text range over 100 characters)", () => {
    const hb = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "718-7")!;
    expect(hb.valueQuantity.unit).toBe("g/dL");
    expect(hb.interpretation[0].coding[0].code).toBe("L");
    expect(hb.referenceRange[0].low.value).toBe(13);
    expect(hb.referenceRange[0].high.value).toBe(17);
    const wbc = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "6690-2")!;
    expect(wbc.interpretation[0].coding[0].code).toBe("N");
    expect(wbc.referenceRange[0].text.length).toBeGreaterThan(100);
    const panel = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "58410-2")!;
    expect(panel.hasMember.length).toBeGreaterThanOrEqual(2);
    expect("valueQuantity" in panel).toBe(false);
  });

  it("has an abnormal integer with < in the text range, a normal text result, an abnormal culture and a specimen", () => {
    const crp = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "1988-5")!;
    expect(crp.valueInteger).toBe(48);
    expect(crp.referenceRange[0].text).toContain("<");
    const ua = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "25428-4")!;
    expect(ua.valueString).toBe("Negative");
    const culture = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "630-4")!;
    expect(culture.valueCodeableConcept.coding[0].display).toBe("Escherichia coli");
    expect(byType(bundle, "Specimen")[0].receivedTime).toMatch(/\+03:00$/);
    const mins = labResultMinimums(bundle);
    expect(mins.map((m) => m.id)).toEqual(["2.1.1.1", "2.1.1.2", "2.1.1.3", "2.1.1.4", "2.1.1.5"]);
    expect(mins.filter((m) => !m.met)).toEqual([]);
  });

  it("minimums fail when content is missing", () => {
    const noSpecimen = structuredClone(bundle);
    noSpecimen.entry = noSpecimen.entry.filter((e: { resource: { resourceType: string } }) => e.resource.resourceType !== "Specimen");
    expect(labResultMinimums(noSpecimen).find((m) => m.id === "2.1.1.5")!.met).toBe(false);
    const plain = buildLabReportBundle({ ...args, order: { ...order, codes: ["4548-4"], results: { "4548-4": order.results["718-7"] } }, version: 1, docStatus: "final" });
    const unmet = labResultMinimums(plain).filter((m) => !m.met).map((m) => m.id);
    expect(unmet).toEqual(expect.arrayContaining(["2.1.1.1", "2.1.1.2", "2.1.1.3", "2.1.1.4"]));
  });

  it("an amendment corrects one observation, cancels another, and replaces the original (2.2.1)", () => {
    const amended = structuredClone(order);
    amended.results["718-7"] = { ...amended.results["718-7"], value: "10.4", interp: "L", status: "corrected" };
    amended.results["630-4"] = { ...amended.results["630-4"], status: "cancelled" };
    const v2 = buildLabReportBundle({ ...args, order: amended, version: 2, docStatus: "corrected" });
    expect(byType(v2, "Composition")[0].identifier).toEqual(byType(bundle, "Composition")[0].identifier);
    expect(byType(v2, "Composition")[0].status).toBe("corrected");
    expect(errors(validateLabReportBundle(v2))).toEqual([]);
    expect(labAmendmentMinimums(v2).filter((m) => !m.met)).toEqual([]);
    const statuses = resourcesOf(v2).filter((r) => r.resourceType === "Observation").map((o) => o.status);
    expect(statuses).toContain("corrected");
    expect(statuses).toContain("cancelled");
  });

  it("the validator catches a missing reference range text and a bad report date", () => {
    const bad = structuredClone(bundle);
    delete byType(bad, "Observation")[1].referenceRange;
    byType(bad, "DiagnosticReport")[0].effectivePeriod.end = "2020-01-01T00:00:00+03:00";
    const texts = errors(validateLabReportBundle(bad)).map((c) => c.text).join(" | ");
    expect(texts).toContain("referenceRange.text");
    expect(texts).toContain("Composition.date");
  });
});

describe("laboratory lifecycle with the simulated NPHIES response", () => {
  beforeEach(() => {
    resetLab();
    switchUser("U9"); // System Administrator: all permissions
  });

  it("places an order with the visit number and sends it (5.1), then amends it (5.2)", () => {
    const o = placeLabOrder(enc(), { codes: ["58410-2", "2345-7"], priority: "urgent", fasting: false, note: "" })!;
    expect(o.visitNumber).toBe(enc().visitNumber);
    expect(o.status).toBe("received");
    const r1 = sendLabOrder(o.id)!;
    expect(r1.response.status).toBe("accepted");
    expect(r1.version).toBe(1);
    expect(r1.docStatus).toBe("final");
    expect(errors(r1.checks)).toEqual([]);
    expect(labConformance(getLab()).find((s) => s.id === "5.1")!.state).toBe("done");

    expect(cancelLabOrder("nope")).toBe(false);
    expect(amendLabOrder(o.id, { codes: ["58410-2", "2345-7", "2160-0"], priority: "stat", fasting: false, note: "Repeat" })).toBe(true);
    expect(getOrder(o.id)!.orderDirty).toBe(true);
    const r2 = sendLabOrder(o.id)!;
    expect(r2.version).toBe(2);
    expect(r2.docStatus).toBe("amended");
    expect(r2.response.status).toBe("accepted");
    expect(getOrder(o.id)!.orderDirty).toBe(false);
    expect(byType(r2.bundle, "Composition")[0].identifier).toEqual(byType(r1.bundle, "Composition")[0].identifier);
    expect(labConformance(getLab()).find((s) => s.id === "5.2")!.state).toBe("done");
  });

  it("sends a cancellation as a replacing document", () => {
    const o = placeLabOrder(enc(), { codes: ["4548-4"], priority: "routine", fasting: null, note: "" })!;
    sendLabOrder(o.id);
    expect(cancelLabOrder(o.id)).toBe(true);
    const r = sendLabOrder(o.id)!;
    expect(r.docStatus).toBe("cancelled");
    expect(r.response.status).toBe("accepted");
  });

  it("a rejection is shown with an OperationOutcome and does not use up the version", () => {
    const o = placeLabOrder(enc(), { codes: ["4548-4"], priority: "routine", fasting: null, note: "" })!;
    setRejectNext(true);
    const bad = sendLabOrder(o.id)!;
    expect(bad.response.status).toBe("rejected");
    expect(bad.response.outcome.resourceType).toBe("OperationOutcome");
    expect(bad.response.outcome.issue[0].severity).toBe("error");
    const good = sendLabOrder(o.id)!;
    expect(good.response.status).toBe("accepted");
    expect(good.version).toBe(1);
    expect(getLab().rejectNext).toBe(false);
  });

  it("collects, processes, results, publishes (2.1) and amends (2.2) the conformance sample", () => {
    const o = createConformanceSampleOrder(enc())!;
    expect(o.status).toBe("in-progress");
    expect(missingResults(getOrder(o.id)!)).toEqual([]);
    expect(getOrder(o.id)!.specimens.length).toBe(3);
    sendLabOrder(o.id);

    const pub = publishLabResult(o.id)!;
    expect(errors(pub.checks)).toEqual([]);
    expect(pub.response.status).toBe("accepted");
    expect(getOrder(o.id)!.status).toBe("resulted");
    expect(labConformance(getLab()).find((s) => s.id === "2.1")!.state).toBe("done");

    // Amend: correct a value, cancel a result.
    expect(saveLabResult(o.id, "718-7", { value: "10.4" })).toBe(true);
    expect(getOrder(o.id)!.results["718-7"].status).toBe("corrected");
    expect(getOrder(o.id)!.resultDirty).toBe(true);
    expect(cancelLabResult(o.id, "630-4", true)).toBe(true);
    const amend = publishLabResult(o.id, "corrected")!;
    expect(amend.version).toBe(2);
    expect(amend.docStatus).toBe("corrected");
    expect(amend.response.status).toBe("accepted");
    expect(getOrder(o.id)!.status).toBe("amended");
    expect(byType(amend.bundle, "Composition")[0].identifier).toEqual(byType(pub.bundle, "Composition")[0].identifier);
    expect(labConformance(getLab()).find((s) => s.id === "2.2")!.state).toBe("done");
  });

  it("will not publish while results are empty", () => {
    const o = placeLabOrder(enc(), { codes: ["58410-2"], priority: "routine", fasting: null, note: "" })!;
    collectSpecimens(o.id);
    startProcessing(o.id);
    expect(missingResults(getOrder(o.id)!).length).toBe(6);
    expect(publishLabResult(o.id)).toBeNull();
    fillSampleResults(o.id);
    expect(missingResults(getOrder(o.id)!)).toEqual([]);
  });

  it("respects permissions: a physician cannot enter results", () => {
    switchUser("U1");
    const o = placeLabOrder(enc(), { codes: ["4548-4"], priority: "routine", fasting: null, note: "" })!;
    expect(o).toBeTruthy();
    expect(collectSpecimens(o.id)).toBe(false);
    switchUser("U5"); // lab technologist cannot order
    expect(placeLabOrder(enc(), { codes: ["4548-4"], priority: "routine", fasting: null, note: "" })).toBeNull();
  });
});

describe("fixes from the audit against the live NPHIES guide", () => {
  beforeEach(() => {
    resetLab();
    switchUser("U9");
  });

  const report = (o: LabOrder) =>
    buildLabReportBundle({ ...ctx(), order: o, orderer: personFromDoctor(o.orderedById), performer: personFromUser(currentUser()), authenticator: LAB_DIRECTOR, version: 1, docStatus: "final" });
  const sectionCodes = (b: ReturnType<typeof report>): { system: string; code: string }[] =>
    byType(b, "Composition")[0].section.map((s: { code: { coding: { system: string; code: string }[] } }) => s.code.coding[0]);

  it("section codes come from the Laboratory Department value set (LOINC), and the validator rejects the old HL7 codes", () => {
    for (const d of Object.values(LAB_DEPTS)) expect(LAB_DEPARTMENT_CODES[d.code], d.code).toBeTruthy();
    const b = report(sampleOrder());
    const codes = sectionCodes(b);
    expect(codes.map((c) => c.code).sort()).toEqual(["18719-5", "18723-7", "18725-2", "18729-4"]);
    for (const c of codes) expect(c.system).toBe("urn:oid:2.16.840.1.113883.6.1");
    const bad = structuredClone(b);
    byType(bad, "Composition")[0].section[0].code.coding[0] = { system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "HM" };
    expect(errors(validateLabReportBundle(bad)).map((c) => c.text).join(" ")).toContain("Laboratory Department value set");
  });

  it("never sends an app user id as the practitioner id, and keeps the performer of each result", () => {
    const o = createConformanceSampleOrder(enc())!; // results filled by U9
    switchUser("U5");
    expect(saveLabResult(o.id, "718-7", { value: "10.1" })).toBe(true); // the lab technologist determines this one
    switchUser("U9");
    const pub = publishLabResult(o.id)!;
    expect(errors(pub.checks)).toEqual([]);
    const ids = byType(pub.bundle, "Practitioner").map((p) => p.identifier[0].value);
    expect(ids).toContain("T5001");
    expect(ids).toContain("A9001");
    for (const id of ids) expect(id).not.toMatch(/^U\d+$/);
    const obs = byType(pub.bundle, "Observation");
    expect(obs.find((x) => x.code.coding[0].code === "718-7")!.performer[0].identifier.value).toBe("T5001");
    expect(obs.find((x) => x.code.coding[0].code === "6690-2")!.performer[0].identifier.value).toBe("A9001");
  });

  it("ceftriaxone uses LOINC 18895-3, not the cefotaxime code", () => {
    expect(ANTIBIOTICS.find((a) => a.key === "CRO")!.code).toBe("18895-3");
    expect(ANTIBIOTICS.map((a) => a.code)).not.toContain("18886-2");
  });

  it("a placer order number stays with its test when the order is amended", () => {
    const o = placeLabOrder(enc(), { codes: ["58410-2", "2345-7", "2160-0"], priority: "routine", fasting: null, note: "" })!;
    const before = placerNumber(o, "2160-0");
    expect(before).toBe(`${o.id}-3`);
    sendLabOrder(o.id);
    // Glucose removed, the list reordered, HbA1c added.
    amendLabOrder(o.id, { codes: ["2160-0", "58410-2", "4548-4"], priority: "routine", fasting: null, note: "" });
    const after = getOrder(o.id)!;
    expect(placerNumber(after, "2160-0")).toBe(before);
    expect(placerNumber(after, "58410-2")).toBe(`${o.id}-1`);
    expect(placerNumber(after, "4548-4")).toBe(`${o.id}-4`); // the number of the removed test is not reused
    const r = sendLabOrder(o.id)!;
    const sr = byType(r.bundle, "ServiceRequest").find((x) => x.code.coding[0].code === "2160-0")!;
    expect(sr.identifier[0].value).toBe(before);
    expect(errors(r.checks)).toEqual([]);
  });

  it("PractitionerRole has no identifier and references to it carry the Practitioner identifier", () => {
    const b = report(sampleOrder());
    for (const role of byType(b, "PractitionerRole")) expect("identifier" in role).toBe(false);
    const comp = byType(b, "Composition")[0];
    expect(comp.author[0].identifier.system).toBe("urn:oid:2.16.840.1.113883.3.3731.1.2.1");
    expect(comp.attester[0].party.identifier.value).toBe(LAB_DIRECTOR.id);
  });

  it("uses the OID form for LOINC, UCUM and ICD-10-AM, and http://loinc.org where the guide fixes it", () => {
    const b = report(sampleOrder());
    expect(byType(b, "Composition")[0].type.coding[0].system).toBe("http://loinc.org");
    expect(byType(b, "DiagnosticReport")[0].code.coding[0].system).toBe("http://loinc.org");
    for (const o of byType(b, "Observation")) expect(o.code.coding[0].system).toBe("urn:oid:2.16.840.1.113883.6.1");
    for (const s of byType(b, "ServiceRequest")) expect(s.code.coding[0].system).toBe("urn:oid:2.16.840.1.113883.6.1");
    expect(byType(b, "Observation").find((o) => o.code.coding[0].code === "718-7")!.valueQuantity.system).toBe("urn:oid:2.16.840.1.113883.6.8");
    const order = buildLabOrderBundle({ ...ctx(), order: mkOrder(["4548-4"], { status: "received" }), orderer: personFromDoctor(enc().attending), version: 1, docStatus: "final" });
    const dx = byType(order, "Observation").find((o) => o.code.coding[0].code === "148006");
    if (dx) expect(dx.valueCodeableConcept.coding[0].system).toBe("urn:oid:2.16.840.1.113883.6.135");
    expect(byType(order, "Observation").find((o) => o.code.coding[0].code === "424144002")!.valueQuantity.system).toBe("urn:oid:2.16.840.1.113883.6.8");
  });

  it("a visit class outside E, I, O, D (the old pre-admit class P) is never sent, and the validator rejects P", () => {
    // Saved data from before the class list was tightened can still hold "P".
    const pre = { ...enc(), cls: "P" as unknown as ReturnType<typeof enc>["cls"] };
    const o = mkOrder(["4548-4"], { status: "received" });
    const b = buildLabOrderBundle({ patient: patient(), enc: pre, order: o, orderer: personFromDoctor(pre.attending), version: 1, docStatus: "final" });
    expect(byType(b, "Encounter")[0].class.code).toBe("O");
    expect(errors(validateLabOrderBundle(b))).toEqual([]);
    const bad = structuredClone(b);
    byType(bad, "Encounter")[0].class.code = "P";
    expect(errors(validateLabOrderBundle(bad)).map((c) => c.text).join(" ")).toContain("E, I, O, D");
  });

  it("the COVID-19 PCR is a molecular test on a nasopharyngeal swab", () => {
    const t = testByCode("94500-6")!;
    expect(SPECIMEN_TYPES[t.specimen].code).toBe("258500001");
    expect(LAB_DEPTS[t.dept].code).toBe("26435-8");
    const o = mkOrder(["94500-6"], { specimens: [{ id: "SP-9-NPS", key: "NPS", collectedAt: new Date().toISOString(), receivedAt: new Date().toISOString(), collectedBy: "Tech" }] });
    o.results["94500-6"] = { code: "94500-6", value: "Not Detected", interp: "N", status: "final", at: new Date().toISOString() };
    const b = report(o);
    expect(byType(b, "Specimen")[0].type.coding[0].code).toBe("258500001");
    expect(sectionCodes(b)[0].code).toBe("26435-8");
    expect(errors(validateLabReportBundle(b))).toEqual([]);
  });

  it("every catalogue unit is in the KSA unit value set, and specific gravity is sent without a unit", () => {
    for (const t of LAB_CATALOG) if (t.unit) expect(KSA_LAB_UNITS.has(t.unit), `${t.code} ${t.unit}`).toBe(true);
    expect(KSA_LAB_UNITS.has("1")).toBe(false);
    const b = report(sampleOrder());
    const sg = byType(b, "Observation").find((o) => o.code.coding[0].code === "5811-5")!;
    expect(sg.valueQuantity).toEqual({ value: 1.015 });
    const bad = structuredClone(b);
    byType(bad, "Observation").find((o) => o.code.coding[0].code === "5811-5")!.valueQuantity = { value: 1.015, unit: "1", system: "urn:oid:2.16.840.1.113883.6.8", code: "1" };
    expect(errors(validateLabReportBundle(bad)).map((c) => c.text).join(" ")).toContain("KSA Laboratory Observation Units");
  });

  it("a ServiceRequest in a report links its specimen", () => {
    const b = report(sampleOrder());
    const specimenIds = byType(b, "Specimen").map((s) => `Specimen/${s.id}`);
    for (const sr of byType(b, "ServiceRequest")) expect(specimenIds).toContain(sr.specimen[0].reference);
  });

  it("will not publish a result for an account without a provider id", () => {
    const o = createConformanceSampleOrder(enc())!;
    const user = currentUser();
    const real = user.providerId;
    user.providerId = undefined;
    try {
      expect(publishLabResult(o.id)).toBeNull();
    } finally {
      user.providerId = real;
    }
    expect(publishLabResult(o.id)).toBeTruthy();
  });
});
