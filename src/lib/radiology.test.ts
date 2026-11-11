import { beforeEach, describe, expect, it } from "vitest";
import {
  RAD_CATALOG, RAD_CONSULTANT, amendRadOrder, applyReportTemplate, buildRadOrderBundle, buildRadReportBundle, cancelRadOrder,
  createRadConformanceSample, getRad, getRadOrder, markPerformed, placeRadOrder, procByCode, publishRadReport, radConformance,
  resetRad, saveRadReport, sendRadOrder, setRadRejectNext, setStudyImages, validateRadOrderBundle, validateRadReportBundle,
} from "./radiology";
import { byType, GUID_RE, type Json } from "./fhir/common";
import { BODY_REGIONS, MODALITIES } from "./fhir/rad-catalog";
import { GUIDE_BODY_REGION_CODES, GUIDE_IMAGING_PROCEDURE_EXTRACT, GUIDE_MODALITY_CODES, GUIDE_REPORT_TITLES } from "./fhir/rad-validate";
import { versionOf } from "./fhir/lab-validate";
import { newDicomUid } from "./fhir/rad-bundles";
import { personFromDoctor, personFromUser } from "./fhir/people";
import type { RadOrder } from "./fhir/types";
import type { Check } from "./model";
import { currentUser, switchUser } from "./session";
import { getState } from "./store";

const enc = () => getState().encounters.find((e) => e.patientId === "P001")!;
const patient = () => getState().patients.find((p) => p.id === "P001")!;
const errors = (c: Check[]) => c.filter((x) => x.level === "error");

function mkOrder(extra: Partial<RadOrder> = {}): RadOrder {
  const e = enc();
  return {
    id: "RO-900001", visitNumber: e.visitNumber, patientId: e.patientId, procCode: "XCHES-PA", priority: "urgent",
    indication: "Fever and cough", clinicalInfo: "Admitted yesterday", orderedAt: new Date(Date.now() - 7_200_000).toISOString(),
    orderedById: e.attending, status: "performed", orderDirty: false, reportDirty: false, sends: [], ...extra,
  };
}

const reported = (images = true): RadOrder =>
  mkOrder({
    study: { studyUid: newDicomUid(), accession: "ACC900001", performedStart: new Date(Date.now() - 3_600_000).toISOString(), performedEnd: new Date(Date.now() - 3_000_000).toISOString(), performedBy: "Tech", images, series: 1, instances: 2 },
    report: { technique: "PA erect view of the chest.", comparison: "None.", findings: "Right lower zone consolidation.", impression: "Right lower lobe pneumonia.", addendum: "", critical: false, communicated: "", reportedAt: new Date().toISOString(), reportedById: "U6" },
  });

describe("radiology catalogue", () => {
  it("has about 12 imaging procedures with modality and body region", () => {
    expect(RAD_CATALOG.length).toBeGreaterThanOrEqual(12);
    for (const p of RAD_CATALOG) {
      // Every catalogue row must hold values the guide publishes (lists copied from the guide in rad-validate.ts).
      expect(GUIDE_IMAGING_PROCEDURE_EXTRACT).toContain(p.code);
      expect(GUIDE_MODALITY_CODES).toContain(MODALITIES[p.modality].code);
      expect(GUIDE_BODY_REGION_CODES).toContain(BODY_REGIONS[p.region].code);
      expect(GUIDE_REPORT_TITLES).toContain(p.reportTitle);
    }
    expect(procByCode("CSKUH")?.reportTitle).toBe("CT Report");
    expect(procByCode("X-LSJ")?.modality).toBe("DX");
    // Codes that were made up before the audit are gone.
    for (const old of ["XCHPA", "XKNEE", "CTCHE", "CTABP", "MBRAN", "MLSPI", "MBILA", "DBMDW"]) expect(procByCode(old)).toBeUndefined();
  });
});

describe("radiology order bundle", () => {
  const order = mkOrder({ status: "received" });
  const orderer = personFromDoctor(order.orderedById);
  const bundle = buildRadOrderBundle({ patient: patient(), enc: enc(), order, orderer, version: 1, docStatus: "final" });

  it("follows the Bundle and Composition pages", () => {
    expect(bundle.type).toBe("document");
    expect(GUID_RE.test(bundle.id)).toBe(true);
    expect(bundle.meta.profile).toContain("http://nphies.sa/fhir/ksa/nphies-cs/StructureDefinition/bundleRadOrder|1.0");
    const comp = byType(bundle, "Composition")[0];
    expect(comp.title).toBe("Radiology Order");
    expect(comp.type.coding[0].code).toBe("57832-8");
    expect(comp.section).toHaveLength(1);
    expect(comp.section[0].title).toBe("Radiology Order Section");
    expect(comp.section[0].section.map((s: { title: string }) => s.title)).toEqual(["Procedure Indications", "Clinical Information"]);
    expect(comp.section[0].section.map((s: { code: { coding: { code: string }[] } }) => s.code.coding[0].code)).toEqual(["59768-2", "55752-0"]);
    // Narrative in the portal form: no <div>, no XHTML namespace.
    expect(comp.section[0].text).toEqual({ status: "additional", div: "<paragraph>XR Chest PA. Reason: Fever and cough</paragraph>" });
    expect(comp.status).toBe("final");
  });

  it("has exactly one ServiceRequest with modality and body region, the visit number and the Health ID", () => {
    const srs = byType(bundle, "ServiceRequest");
    expect(srs).toHaveLength(1);
    expect(srs[0].code.coding[0]).toEqual({ system: "urn:oid:2.16.840.1.113883.3.3731.1.204.15", code: "XCHES-PA", display: "XR Chest PA" });
    expect(srs[0].orderDetail[0].coding[0]).toEqual({ system: "urn:oid:1.2.840.10008.2.16.4", code: "DX", display: "Digital Radiography" });
    expect(srs[0].bodySite[0].coding[0]).toEqual({ system: "urn:oid:2.16.840.1.113883.6.96", code: "51185008", display: "Thoracic structure" });
    // A role has no identifier; the reference to it repeats the practitioner's provider id. The practitioner has a name.
    const role = byType(bundle, "PractitionerRole")[0];
    const prac = byType(bundle, "Practitioner")[0];
    expect("identifier" in role).toBe(false);
    expect(srs[0].requester).toEqual({ reference: `PractitionerRole/${role.id}`, identifier: prac.identifier[0] });
    expect(prac.name[0].family).toBeTruthy();
    const age = byType(bundle, "Observation").find((o) => o.code.coding[0].code === "424144002")!;
    expect(age.valueQuantity.system).toBe("urn:oid:2.16.840.1.113883.6.8");
    expect(age.valueQuantity.code).toBe("a");
    expect(srs[0].priority).toBe("urgent");
    expect(byType(bundle, "Encounter")[0].identifier[0].value).toBe(enc().visitNumber);
    expect(byType(bundle, "Patient")[0].identifier[0].value).toBe(patient().healthId);
    expect(byType(bundle, "Observation").length).toBeGreaterThanOrEqual(1);
    expect(errors(validateRadOrderBundle(bundle, { visitNumber: enc().visitNumber, healthId: patient().healthId }))).toEqual([]);
  });

  it("the validator catches a missing modality, two service requests and a wrong visit number", () => {
    const bad = structuredClone(bundle);
    delete byType(bad, "ServiceRequest")[0].orderDetail;
    bad.entry.push({ fullUrl: "urn:uuid:x", resource: { ...structuredClone(byType(bad, "ServiceRequest")[0]), id: "11111111-1111-4111-8111-111111111111" } });
    byType(bad, "Encounter")[0].identifier[0].value = "V0";
    const texts = errors(validateRadOrderBundle(bad, { visitNumber: enc().visitNumber })).map((c) => c.text).join(" | ");
    expect(texts).toContain("orderDetail");
    expect(texts).toContain("exactly one ServiceRequest");
    expect(texts).toContain("visit number");
  });

  it("the validator checks the guide's fixed values, not the builder's", () => {
    const run = (mut: (b: typeof bundle) => void) => {
      const bad = structuredClone(bundle);
      mut(bad);
      return errors(validateRadOrderBundle(bad)).map((c) => c.text).join(" | ");
    };
    const sr = (b: typeof bundle) => byType(b, "ServiceRequest")[0];
    const sec = (b: typeof bundle) => byType(b, "Composition")[0].section[0];
    expect(run((b) => { sr(b).code.coding[0].code = "XCHPA"; })).toContain("KSA Imaging Procedure");
    expect(run((b) => { sr(b).code.coding[0].system = "http://nphies.sa/terminology/CodeSystem/imaging-procedure"; })).toContain("ServiceRequest.code system");
    expect(run((b) => { sr(b).bodySite[0].coding[0].code = "72696002"; })).toContain("KSA Body Region");
    expect(run((b) => { sr(b).bodySite[0].coding[0].system = "http://snomed.info/sct"; })).toContain("KSA Body Region");
    expect(run((b) => { sr(b).orderDetail[0].coding[0].system = "http://dicom.nema.org/resources/ontology/DCM"; })).toContain("Modalities value set");
    expect(run((b) => { sr(b).orderDetail[0].coding[0].code = "XRAY"; })).toContain("Modalities value set");
    expect(run((b) => { sec(b).section[0].code.coding[0].code = "18785-6"; })).toContain("Procedure Indications");
    expect(run((b) => { sec(b).section = sec(b).section.slice(1); })).toContain("Procedure Indications");
    expect(run((b) => { sec(b).section[1].title = "Clinical information"; })).toContain("title or display");
    expect(run((b) => { sec(b).text.div = '<div xmlns="http://www.w3.org/1999/xhtml">x</div>'; })).toContain("portal tags");
    expect(run((b) => { byType(b, "Encounter")[0].class.code = "P"; })).toContain("E, I, O or D");
    expect(run((b) => { byType(b, "PractitionerRole")[0].identifier = [{ system: "urn:oid:1.2.3", value: "PR-1" }]; })).toContain("PractitionerRole must not carry an identifier");
    expect(run((b) => { sr(b).requester.identifier = { system: "urn:oid:1.2.3", value: "PR-1" }; })).toContain("reference/identifier differs");
    expect(run((b) => { byType(b, "Observation").forEach((o: { valueQuantity?: { system: string } }) => { if (o.valueQuantity) o.valueQuantity.system = "http://unitsofmeasure.org"; }); })).toContain("units");
  });

  it("an amendment replaces the original (6.2)", () => {
    const v2 = buildRadOrderBundle({ patient: patient(), enc: enc(), order, orderer, version: 2, docStatus: "amended" });
    expect(byType(v2, "Composition")[0].identifier).toEqual(byType(bundle, "Composition")[0].identifier);
    expect(versionOf(v2)).toBe(2);
    expect(byType(v2, "Composition")[0].status).toBe("amended");
    expect(errors(validateRadOrderBundle(v2))).toEqual([]);
  });
});

describe("radiology report bundle (structured)", () => {
  const args = (order: RadOrder) => ({
    patient: patient(), enc: enc(), order, orderer: personFromDoctor(order.orderedById), radiologist: personFromUser(currentUser()), authenticator: RAD_CONSULTANT,
  });

  it("with images: ImagingStudy, Endpoint, Procedure and Device, and it passes the validator", () => {
    const order = reported(true);
    const b = buildRadReportBundle({ ...args(order), version: 1, docStatus: "final" });
    expect(b.meta.profile).toContain("http://nphies.sa/fhir/ksa/nphies-cs/StructureDefinition/bundleRadReport|1.0");
    const comp = byType(b, "Composition")[0];
    expect(comp.type.coding[0].code).toBe("18748-4");
    expect(comp.title).toBe("X-Ray Report");
    expect(comp.section.map((s: { code: { coding: { code: string }[] }; title: string }) => [s.code.coding[0].code, s.title])).toEqual([
      ["18726-0", "Imaging Study"], ["55752-0", "Clinical Information"], ["55111-9", "Procedures"],
      ["18834-2", "Comparison / Previous Findings"], ["59776-5", "Procedure findings"], ["19005-8", "Impressions"],
    ]);
    expect(comp.section.every((s: { text: { div: string } }) => s.text.div.startsWith("<paragraph>") && s.text.div.endsWith("</paragraph>"))).toBe(true);
    expect(byType(b, "ImagingStudy")[0].series[0].modality).toEqual({ system: "urn:oid:1.2.840.10008.2.16.4", code: "DX" });
    expect(comp.attester[0].mode).toBe("legal");
    expect(byType(b, "ImagingStudy")).toHaveLength(1);
    expect(byType(b, "Endpoint")).toHaveLength(1);
    expect(byType(b, "Procedure")).toHaveLength(1);
    expect(byType(b, "Device")).toHaveLength(1);
    expect(byType(b, "ImagingStudy")[0].identifier[0].system).toBe("urn:dicom:uid");
    expect(byType(b, "ServiceRequest")[0].identifier.map((i: { type: { coding: { code: string }[] } }) => i.type.coding[0].code)).toEqual(["PLAC", "ACSN"]);
    expect(byType(b, "DiagnosticReport")[0].effectivePeriod.end).toBe(comp.date);
    expect(byType(b, "PractitionerRole").length).toBeGreaterThanOrEqual(2);
    expect(errors(validateRadReportBundle(b, { visitNumber: enc().visitNumber, healthId: patient().healthId }))).toEqual([]);
  });

  it("without images there is no ImagingStudy and no Endpoint, and the validator says so", () => {
    const b = buildRadReportBundle({ ...args(reported(false)), version: 1, docStatus: "final" });
    expect(byType(b, "ImagingStudy")).toHaveLength(0);
    expect(byType(b, "Endpoint")).toHaveLength(0);
    expect("imagingStudy" in byType(b, "DiagnosticReport")[0]).toBe(false);
    expect(errors(validateRadReportBundle(b))).toEqual([]);
    // Put an Endpoint in anyway.
    const withImages = buildRadReportBundle({ ...args(reported(true)), version: 1, docStatus: "final" });
    b.entry.push(withImages.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === "Endpoint"));
    expect(errors(validateRadReportBundle(b)).map((c) => c.text).join(" ")).toContain("Endpoint must not be present");
  });

  it("an amendment keeps the document set and raises the version (3.2)", () => {
    const order = reported();
    const v1 = buildRadReportBundle({ ...args(order), version: 1, docStatus: "final" });
    const fixed = { ...order, report: { ...order.report!, impression: "Right lower lobe pneumonia. Follow up in 6 weeks." } };
    const v2 = buildRadReportBundle({ ...args(fixed), version: 2, docStatus: "amended" });
    expect(byType(v2, "Composition")[0].identifier).toEqual(byType(v1, "Composition")[0].identifier);
    expect(versionOf(v2)).toBe(2);
    expect(errors(validateRadReportBundle(v2))).toEqual([]);
  });

  it("sends a communicated critical result in the Communication sub-section, and each procedure gets its fixed title", () => {
    const order = reported();
    const told = { ...order, report: { ...order.report!, critical: true, communicated: "Dr. Khalid Alharbi at 10:05" } };
    const b = buildRadReportBundle({ ...args(told), version: 1, docStatus: "final" });
    const impression = byType(b, "Composition")[0].section.find((s: { title: string }) => s.title === "Impressions");
    expect(impression.section).toHaveLength(1);
    expect(impression.section[0].code.coding[0]).toEqual({ system: "http://loinc.org", code: "73568-8", display: "Communication of Critical Results" });
    expect(impression.section[0].title).toBe("Communication");
    expect(impression.section[0].text.div).toContain("Dr. Khalid Alharbi at 10:05");
    expect(errors(validateRadReportBundle(b))).toEqual([]);
    for (const p of RAD_CATALOG) {
      const each = buildRadReportBundle({ ...args({ ...order, procCode: p.code }), version: 1, docStatus: "final" });
      expect(byType(each, "Composition")[0].title).toBe(p.reportTitle);
      expect(errors(validateRadReportBundle(each))).toEqual([]);
      const ord = buildRadOrderBundle({ patient: patient(), enc: enc(), order: { ...order, procCode: p.code }, orderer: personFromDoctor(order.orderedById), version: 1, docStatus: "final" });
      expect(errors(validateRadOrderBundle(ord))).toEqual([]);
    }
  });

  it("the validator rejects the old title, the old Procedures code and a missing mandatory section", () => {
    const run = (mut: (comp: Json) => void) => {
      const b = buildRadReportBundle({ ...args(reported()), version: 1, docStatus: "final" });
      mut(byType(b, "Composition")[0]);
      return errors(validateRadReportBundle(b)).map((c) => c.text).join(" | ");
    };
    expect(run((c) => { c.title = "Radiology Report"; })).toContain("It must be one of: CT Report");
    expect(run((c) => { c.section[2].code.coding[0].code = "29554-3"; })).toContain("55111-9");
    expect(run((c) => { c.section = c.section.filter((s: Json) => s.code.coding[0].code !== "18726-0"); })).toContain("Imaging Study section");
  });

  it("the validator catches a missing procedure body site and a wrong DiagnosticReport date", () => {
    const b = buildRadReportBundle({ ...args(reported()), version: 1, docStatus: "final" });
    delete byType(b, "Procedure")[0].bodySite;
    byType(b, "DiagnosticReport")[0].effectivePeriod.end = "2020-01-01T00:00:00+03:00";
    const texts = errors(validateRadReportBundle(b)).map((c) => c.text).join(" | ");
    expect(texts).toContain("Procedure.bodySite");
    expect(texts).toContain("Composition.date");
  });
});

describe("radiology lifecycle with the simulated NPHIES response", () => {
  beforeEach(() => {
    resetRad();
    switchUser("U9");
  });

  it("order 6.1 and amended order 6.2", () => {
    const o = placeRadOrder(enc(), { procCode: "CSKUH", priority: "stat", indication: "Head injury", clinicalInfo: "" })!;
    expect(o.visitNumber).toBe(enc().visitNumber);
    const r1 = sendRadOrder(o.id)!;
    expect(r1.response.status).toBe("accepted");
    expect(errors(r1.checks)).toEqual([]);
    expect(radConformance(getRad()).find((s) => s.id === "6.1")!.state).toBe("done");

    expect(amendRadOrder(o.id, { procCode: "CCHES", priority: "urgent", indication: "Chest trauma", clinicalInfo: "Fall" })).toBe(true);
    expect(getRadOrder(o.id)!.orderDirty).toBe(true);
    const r2 = sendRadOrder(o.id)!;
    expect(r2.version).toBe(2);
    expect(r2.docStatus).toBe("amended");
    expect(r2.response.status).toBe("accepted");
    expect(byType(r2.bundle, "ServiceRequest")[0].code.coding[0].code).toBe("CCHES");
    expect(radConformance(getRad()).find((s) => s.id === "6.2")!.state).toBe("done");
  });

  it("cancelling a sent order sends a replacing document with status cancelled", () => {
    const o = placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })!;
    sendRadOrder(o.id);
    expect(cancelRadOrder(o.id)).toBe(true);
    const r = sendRadOrder(o.id)!;
    expect(r.docStatus).toBe("cancelled");
    expect(r.response.status).toBe("accepted");
    // A cancellation is not an amendment, so it does not complete step 6.2.
    expect(radConformance(getRad()).find((s) => s.id === "6.2")!.state).not.toBe("done");
  });

  it("does not place or change an order without a reason for the exam", () => {
    expect(placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "routine", indication: "  ", clinicalInfo: "" })).toBeNull();
    const o = placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })!;
    expect(amendRadOrder(o.id, { procCode: "XCHES-PA", priority: "routine", indication: "", clinicalInfo: "" })).toBe(false);
    expect(getRadOrder(o.id)!.indication).toBe("Cough");
  });

  it("report 3.1 and amended report 3.2", () => {
    const o = createRadConformanceSample(enc())!;
    expect(o.status).toBe("performed");
    const pub = publishRadReport(o.id)!;
    expect(errors(pub.checks)).toEqual([]);
    expect(pub.response.status).toBe("accepted");
    expect(getRadOrder(o.id)!.status).toBe("resulted");
    expect(radConformance(getRad()).find((s) => s.id === "3.1")!.state).toBe("done");

    expect(saveRadReport(o.id, { impression: "Normal study. No follow-up needed." })).toBe(true);
    expect(getRadOrder(o.id)!.reportDirty).toBe(true);
    const amend = publishRadReport(o.id, "amended")!;
    expect(amend.version).toBe(2);
    expect(amend.response.status).toBe("accepted");
    expect(getRadOrder(o.id)!.status).toBe("amended");
    expect(byType(amend.bundle, "Composition")[0].identifier).toEqual(byType(pub.bundle, "Composition")[0].identifier);
    expect(radConformance(getRad()).find((s) => s.id === "3.2")!.state).toBe("done");
  });

  it("a report without images is accepted too", () => {
    const o = placeRadOrder(enc(), { procCode: "UABDO", priority: "routine", indication: "Pain", clinicalInfo: "" })!;
    markPerformed(o.id, { images: false });
    applyReportTemplate(o.id, "abnormal");
    setStudyImages(o.id, false);
    const pub = publishRadReport(o.id)!;
    expect(pub.response.status).toBe("accepted");
    expect(byType(pub.bundle, "ImagingStudy")).toHaveLength(0);
  });

  it("a critical finding is kept on the report", () => {
    const o = placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "stat", indication: "Shortness of breath", clinicalInfo: "" })!;
    markPerformed(o.id);
    applyReportTemplate(o.id, "critical");
    expect(getRadOrder(o.id)!.report!.critical).toBe(true);
  });

  it("does not publish an empty report, and shows a rejection with an OperationOutcome", () => {
    const o = placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })!;
    markPerformed(o.id);
    expect(publishRadReport(o.id)).toBeNull();
    applyReportTemplate(o.id, "normal");
    setRadRejectNext(true);
    const bad = publishRadReport(o.id)!;
    expect(bad.response.status).toBe("rejected");
    expect(bad.response.outcome.issue[0].severity).toBe("error");
    expect(getRadOrder(o.id)!.status).toBe("performed");
    const good = publishRadReport(o.id)!;
    expect(good.response.status).toBe("accepted");
    expect(good.version).toBe(1);
  });

  it("respects permissions: a nurse cannot order, a physician cannot report", () => {
    switchUser("U2");
    expect(placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })).toBeNull();
    switchUser("U1");
    const o = placeRadOrder(enc(), { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })!;
    expect(o).toBeTruthy();
    expect(markPerformed(o.id)).toBe(false);
  });
});
