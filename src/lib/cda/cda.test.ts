import { beforeEach, describe, expect, it } from "vitest";
import type { Encounter } from "../model";
import type { FormRecord } from "../schema";
import { seedState } from "../store";
import { amendDoc, currentDoc, deathRecorded, docsForVisit, generateDoc, publishDoc, recordDeath, resetDocs } from "../docs";
import { buildDocument } from "./build";
import { conformanceSteps, type StepFacts } from "./conformance";
import { DOC_SPECS } from "./docspec";
import { renderRequest, simulateResponse } from "./iti41";
import type { DocInput, DocType } from "./types";
import { errorsOf, validateDoc } from "./validate";
import { sha1, wellFormed } from "./xml";

const state = seedState();
const find = (pid: string) => state.encounters.find((e) => e.patientId === pid)!;
const patientOf = (e: Encounter) => state.patients.find((p) => p.id === e.patientId)!;

const rec = (values: FormRecord["values"]): FormRecord => ({ id: "r1", at: "2026-01-01T00:00:00Z", author: "Test", values });

function input(type: DocType, enc: Encounter, forms: Record<string, FormRecord[]> = {}, extra: Partial<DocInput> = {}): DocInput {
  return {
    type, enc, patient: patientOf(enc), forms: (id) => forms[id] ?? [],
    author: { id: "D1001", name: "Dr. Khalid Alharbi", specialty: "Medicine" },
    now: new Date("2026-03-01T06:30:00Z"), docId: `${enc.visitNumber}-T-1`, setId: `${enc.visitNumber}-T-1`, version: 1, ...extra,
  };
}

/** A discharged inpatient with a diagnosis, procedure and vitals. */
function discharged(): Encounter {
  const e = structuredClone(find("P006"));
  e.vitals = { bp: "120/80", pulse: "80", temp: "36.9", spo2: "98", rr: "16", weight: "70", at: "2026-02-28T10:00" };
  e.allergies = [{ text: "Penicillin", severity: "SV", reaction: "Rash" }];
  e.complaints = [{ code: "21522001", text: "Abdominal pain" }];
  e.disposition = "01";
  return e;
}

describe("helpers", () => {
  it("computes SHA-1", () => {
    expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
  it("checks well-formedness", () => {
    expect(wellFormed("<a><b x=\"1\"/></a>")).toBeNull();
    expect(wellFormed("<a><b></a>")).toContain("does not match");
    expect(wellFormed("<a>R&D</a>")).toContain("Unescaped");
  });
});

describe("document builders", () => {
  it("builds a valid Discharge Summary", () => {
    const b = buildDocument(input("discharge", discharged()));
    expect(wellFormed(b.xml)).toBeNull();
    expect(b.xml).toContain('<templateId root="2.16.840.1.113883.3.3731.1.210.2"/>');
    expect(b.xml).toContain('code="18842-5"');
    expect(b.xml).toContain('<realmCode code="SA"/>');
    expect(b.xml).toContain('root="2.16.840.1.113883.3.3731.1.1.100.1"');
    expect(b.xml).toMatch(/<effectiveTime value="\d{14}\+0300"\/>/);
    expect(errorsOf(validateDoc(b))).toEqual([]);
  });

  it("orders sections as in the spec table", () => {
    const b = buildDocument(input("discharge", discharged()));
    const keys = b.sections.map((s) => s.key);
    expect(keys[0]).toBe("chief");
    expect(keys.indexOf("admitdx")).toBe(1);
    expect(keys.at(-1)).toBe("disposition");
    expect(keys.indexOf("dcdx")).toBeLessThan(keys.indexOf("disposition"));
  });

  it("writes diagnoses, allergies and vitals as coded entries", () => {
    const b = buildDocument(input("discharge", discharged()));
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.43"); // problem concern
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.51"); // allergy concern
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.54"); // vital signs organizer
    expect(b.xml).toContain('code="8310-5"');
  });

  it("keeps required sections without data and warns", () => {
    const b = buildDocument(input("discharge", discharged()));
    const meds = b.sections.find((s) => s.key === "dcmeds")!;
    expect(meds.hasData).toBe(false);
    expect(b.xml).toContain("No information available.");
    expect(validateDoc(b).some((c) => c.level === "warn" && c.text.includes("Hospital Discharge Medications"))).toBe(true);
  });

  it("builds an Outpatient Encounter Summary that needs a finished encounter", () => {
    const open = find("P007"); // active outpatient
    const b = buildDocument(input("outpatient", open));
    expect(DOC_SPECS.outpatient.typeCode).toBe("96345-4");
    expect(validateDoc(b).some((c) => c.level === "error" && c.text.includes("finished"))).toBe(true);
    const done = buildDocument(input("outpatient", find("P009")));
    expect(errorsOf(validateDoc(done))).toEqual([]);
  });

  it("builds an Operative Note and needs a procedure", () => {
    const withPr = discharged();
    const b = buildDocument(input("operative", withPr, { "operation-request": [rec({ procedure: "Hip arthroplasty", preopDiagnosis: "Fracture of neck of femur", urgency: "Urgent (within 24 hours)", preferredDate: "2026-02-27" })] }, { procIndex: 0 }));
    expect(b.xml).toContain('<templateId root="2.16.840.1.113883.3.3731.1.210.5"/>');
    expect(b.metadata.documentEntry.classCode.code).toBe("REPORT");
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.53"); // surgery entry
    expect(errorsOf(validateDoc(b))).toEqual([]);
    const none = discharged();
    none.pr = [];
    expect(errorsOf(validateDoc(buildDocument(input("operative", none)))).some((c) => c.text.includes("procedure"))).toBe(true);
  });

  const delivery = { "delivery-outcomes": [rec({ deliveredAt: "2026-02-27T08:00", mode: "Emergency cesarean", birthStatus: "Live birth", sex: "Female", birthWeight: 3100, apgar1: 8, apgar5: 9, gestationalAge: 39, babyDisposition: "Nursery" })] };

  it("builds Maternal and Newborn summaries from the delivery record", () => {
    const e = discharged();
    const m = buildDocument(input("maternal", e, delivery));
    expect(m.xml).toContain('code="11636-8"'); // live births
    expect(m.sections.find((s) => s.key === "labor")!.hasData).toBe(true);
    const n = buildDocument(input("newborn", e, delivery));
    expect(n.xml).toContain('code="9272-6"');
    expect(n.xml).toContain('code="49051-6"');
    expect(n.header.patientName).toContain("Baby of");
    expect(n.facts.newbornTempId).toBe(true);
    expect(validateDoc(n).some((c) => c.level === "warn" && c.text.includes("temporary"))).toBe(true);
  });

  it("blocks the Newborn summary after a stillbirth but still builds the Maternal one", () => {
    const still = { "delivery-outcomes": [rec({ deliveredAt: "2026-02-27T08:00", mode: "Spontaneous vaginal", birthStatus: "Stillbirth (fresh)" })] };
    const e = discharged();
    const n = buildDocument(input("newborn", e, still));
    expect(validateDoc(n).some((c) => c.level === "error" && c.text.includes("stillbirth"))).toBe(true);
    const m = buildDocument(input("maternal", e, still));
    expect(m.xml).toContain('code="57062-2"'); // stillborn births
    expect(errorsOf(validateDoc(m))).toEqual([]);
  });

  it("flags a patient death", () => {
    const e = discharged();
    e.disposition = "20";
    const checks = validateDoc(buildDocument(input("discharge", e)));
    expect(checks.some((c) => c.level === "error" && c.text.includes("died"))).toBe(true);
  });
});

describe("ITI-41 metadata", () => {
  it("fills the required document entry attributes", () => {
    const b = buildDocument(input("discharge", discharged()));
    const d = b.metadata.documentEntry;
    expect(d.classCode.code).toBe("SUMMARIES");
    expect(d.formatCode.code).toBe("urn:ihe:pcc:xds-ms:2007");
    expect(d.mimeType).toBe("text/xml");
    expect(d.patientId).toContain("&2.16.840.1.113883.3.3731.1.1.100.1&ISO");
    expect(d.hash).toBe(sha1(b.xml));
    expect(d.size).toBe(new TextEncoder().encode(b.xml).length);
    expect(d.availabilityStatus).toBe("Approved");
    expect(d.referenceIdList[0]).toMatch(/urn:ksa-ehealth:document:setId:2023$/);
    expect(d.creationTime).toBe("20260301063000"); // UTC
    expect(b.metadata.submissionSet.sourceId).toMatch(/^2\.16\.840\.1\.113883\.3\.3731\./);
    expect(renderRequest(b)).toContain("XDSDocumentEntry.patientId");
  });

  it("simulates success and failure responses", () => {
    const b = buildDocument(input("discharge", discharged()));
    expect(simulateResponse(b, validateDoc(b), new Date()).ok).toBe(true);
    const bad = simulateResponse(b, [{ level: "error", text: "Something is wrong" }], new Date());
    expect(bad.ok).toBe(false);
    expect(bad.xml).toContain("XDSRepositoryMetadata");
  });

  it("catches a broken header", () => {
    const b = buildDocument(input("discharge", discharged()));
    const broken = { ...b, xml: b.xml.replace('<realmCode code="SA"/>', "") };
    expect(validateDoc(broken).some((c) => c.level === "error" && c.text.includes("realmCode"))).toBe(true);
  });
});

describe("publish, amend and death (store)", () => {
  beforeEach(() => resetDocs());

  it("publishes, then amends and deprecates the original", () => {
    const enc = find("P006");
    const patient = patientOf(enc);
    const g = generateDoc(enc, patient, "discharge");
    expect(g.ok).toBe(true);
    const id = (g as { doc: { id: string } }).doc.id;
    const p = publishDoc(id);
    expect(p.ok).toBe(true);
    expect(currentDoc(enc.visitNumber, "discharge")!.status).toBe("published");

    const a = amendDoc(enc, patient, id, "Added the missing allergy");
    expect(a.ok).toBe(true);
    const all = docsForVisit(enc.visitNumber);
    const old = all.find((d) => d.id === id)!;
    const next = all.find((d) => d.id !== id)!;
    expect(old.status).toBe("deprecated");
    expect(old.built.metadata.documentEntry.availabilityStatus).toBe("Deprecated");
    expect(next.version).toBe(2);
    expect(next.setId).toBe(old.setId);
    expect(next.built.xml).toContain('<relatedDocument typeCode="RPLC">');
    expect(next.built.metadata.association).toEqual({ type: "RPLC", source: next.id, target: id });
    expect(next.built.xml).toContain('<nphies:documentStatus code="amended"/>');
  });

  it("will not generate again once published, and rejects an invalid draft", () => {
    const open = find("P007");
    const g = generateDoc(open, patientOf(open), "outpatient");
    expect(g.ok).toBe(true); // a draft can have errors
    const id = (g as { doc: { id: string } }).doc.id;
    const r = publishDoc(id);
    expect(r.ok).toBe(false);
    expect(currentDoc(open.visitNumber, "outpatient")!.status).toBe("draft");
  });

  it("publishes nothing after a patient death", () => {
    const enc = find("P006");
    const patient = patientOf(enc);
    const g = generateDoc(enc, patient, "discharge");
    const id = (g as { doc: { id: string } }).doc.id;
    expect(recordDeath(enc, patient).ok).toBe(true);
    expect(deathRecorded(enc.visitNumber)).toBe(true);
    expect(publishDoc(id).ok).toBe(false);
    expect(generateDoc(enc, patient, "outpatient").ok).toBe(false);
    expect(docsForVisit(enc.visitNumber).every((d) => d.status === "draft")).toBe(true);
  });
});

describe("conformance steps", () => {
  const base: StepFacts = { docs: [], deathRecorded: false, stillbirth: false, cesarean: false, hasDelivery: false };
  const state = (f: StepFacts, id: string) => conformanceSteps(f).find((s) => s.id === id)!.state;

  it("starts with the main flows to do", () => {
    expect(state(base, "4.1.1")).toBe("todo");
    expect(state(base, "4.2.1")).toBe("todo");
    expect(state(base, "4.3.1")).toBe("na");
    expect(state(base, "4.3.15")).toBe("na");
  });

  it("marks steps done from published documents", () => {
    const pubd = { status: "published" as const, accepted: true, version: 1 };
    const f: StepFacts = { ...base, docs: [{ type: "discharge", ...pubd }, { type: "discharge", ...pubd, version: 2, replaces: true }] };
    expect(state(f, "4.2.1")).toBe("done");
    expect(state(f, "4.2.4")).toBe("done");
    expect(state(f, "4.1.1")).toBe("todo");
  });

  it("handles death and stillbirth exceptions", () => {
    expect(state({ ...base, deathRecorded: true }, "4.2.7")).toBe("done");
    const pubd = { status: "published" as const, accepted: true, version: 1 };
    expect(state({ ...base, deathRecorded: true, docs: [{ type: "discharge", ...pubd }] }, "4.2.7")).toBe("fail");
    const f: StepFacts = { ...base, stillbirth: true, hasDelivery: true, docs: [{ type: "maternal", ...pubd }] };
    expect(state(f, "4.3.15")).toBe("done");
    expect(state(f, "4.3.16")).toBe("done");
  });
});
