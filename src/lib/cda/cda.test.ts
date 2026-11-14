import { beforeEach, describe, expect, it } from "vitest";
import type { Encounter } from "../model";
import type { FormRecord } from "../schema";
import { seedState } from "../store";
import { amendDoc, currentDoc, deathRecorded, docsForVisit, generateDoc, publishDoc, recordDeath, resetDocs } from "../docs";
import { ORG_ID, ORG_OID } from "../reference-data";
import { buildDocument, entryUuid } from "./build";
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
  e.disposition = "306689006";
  return e;
}

const MED = { name: "Paracetamol 500 mg", code: "DEMO-DRG-001", codeSystem: "2.16.840.1.113883.3.3731.1.205.1", formCode: "6401", formName: "Tablet", strengthValue: 500, strengthUnit: "mg", dose: "2 tablet", route: "Oral", frequency: "3 times daily", instruction: "After food" };
const refsResolve = (xml: string) => {
  const ids = new Set([...xml.matchAll(/ ID="([^"]+)"/g)].map((m) => m[1]));
  return [...xml.matchAll(/<reference value="#([^"]+)"\/>/g)].every((m) => ids.has(m[1]));
};

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

  it("follows the CDA order and the header rules of the guide", () => {
    const b = buildDocument(input("discharge", discharged()));
    const author = /<assignedAuthor>([\s\S]*?)<\/assignedAuthor>/.exec(b.xml)![1];
    expect(author.indexOf("<addr")).toBeLessThan(author.indexOf("<telecom"));
    expect(b.xml).toContain('<functionCode code="100000003" codeSystem="2.16.840.1.113883.3.3731.1.202.1"');
    expect(b.xml).toContain('<nphies:documentStatus code="final" codeSystem="2.16.840.1.113883.4.642.4.236"');
    expect(b.xml).toContain('<name use="L">');
    expect(b.xml).toContain('<templateId root="2.16.840.1.113883.3.3731.1.203.28.7"/>'); // performer
    expect(b.xml).toMatch(/<city nullFlavor="UNK"\/>\s*<postalCode nullFlavor="UNK"\/>/);
    expect(b.xml).toMatch(/<associatedEntity classCode="CIT">[\s\S]*?<code code="[A-Z]{3}" codeSystem="1\.0\.3166\.1"\/>/);
    // Same organisation id and root OID as the ADT messages.
    expect(b.xml).toContain(`extension="${ORG_ID}"`);
    expect(b.xml).toContain(`<id root="${ORG_OID}" extension="${discharged().visitNumber}"/>`);
  });

  it("writes entries the way the entry pages ask", () => {
    const b = buildDocument(input("discharge", discharged(), {}, { medications: [MED] }));
    expect(b.xml).toContain('codeSystem="2.16.840.1.113883.6.135" codeSystemName="ICD10-AM"');
    expect(b.xml).not.toContain("2.16.840.1.113883.6.3\"");
    expect(b.xml).toContain('codeSystem="2.16.840.1.113883.3.3731.50.2" codeSystemName="ACHI"');
    expect(b.xml).not.toMatch(/<act classCode="ACT" moodCode="EVN">(?:\s*<templateId[^>]*\/>)+\s*<id root=/);
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.45"); // medications entry
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.66"); // patient instructions
    expect(b.xml).toContain("2.16.840.1.113883.10.20.1.12"); // HL7 CCD procedures section
    expect(refsResolve(b.xml)).toBe(true);
    expect(errorsOf(validateDoc(b))).toEqual([]);
  });

  it("needs vital signs for a discharge summary", () => {
    const e = discharged();
    e.vitals = undefined;
    expect(errorsOf(validateDoc(buildDocument(input("discharge", e)))).some((c) => c.text.includes("Vital signs are required"))).toBe(true);
  });

  it("states no known allergies only when a nurse ticked it", () => {
    const e = discharged();
    e.allergies = [];
    const silent = buildDocument(input("discharge", e));
    expect(silent.xml).not.toContain('code="160244002"');
    const asked = buildDocument(input("discharge", e, { "nursing-initial-assessment": [rec({ noKnownAllergies: true })] }));
    expect(asked.xml).toContain('code="160244002"');
    expect(asked.xml).toContain("No known allergies.");
    expect(refsResolve(asked.xml)).toBe(true);
  });

  it("sends 'no current problems' when the visit has only a principal diagnosis", () => {
    const e = discharged();
    e.dx = e.dx.slice(0, 1);
    const b = buildDocument(input("discharge", e));
    expect(b.xml).toContain('code="160245001"');
    expect(errorsOf(validateDoc(b))).toEqual([]);
  });

  it("keeps required sections without data and warns", () => {
    const b = buildDocument(input("discharge", discharged()));
    const meds = b.sections.find((s) => s.key === "dcmeds")!;
    expect(meds.hasData).toBe(false);
    expect(b.xml).toContain("No information available.");
    expect(validateDoc(b).some((c) => c.level === "warn" && c.text.includes("Hospital Discharge Medications"))).toBe(true);
    expect(validateDoc(b).some((c) => c.level === "warn" && c.text.includes("demo"))).toBe(true);
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
    const b = buildDocument(input("operative", withPr, { "operation-request": [rec({ procedure: "Hip arthroplasty", preopDiagnosis: "Fracture of neck of femur", urgency: "Urgent (within 24 hours)", preferredDate: "2026-02-27", operationStart: "2026-02-27T09:10", operationEnd: "2026-02-27T11:25" })] }, { procIndex: 0 }));
    // The encounter times are the operation start and end, not the visit times.
    expect(b.xml).toMatch(/<encompassingEncounter>[\s\S]*?<low value="20260227091000\+0300"\/>\s*<high value="20260227112500\+0300"\/>/);
    expect(refsResolve(b.xml)).toBe(true);
    const noTimes = buildDocument(input("operative", withPr, { "operation-request": [rec({ procedure: "Hip arthroplasty" })] }, { procIndex: 0 }));
    expect(errorsOf(validateDoc(noTimes)).some((c) => c.text.includes("operation started and ended"))).toBe(true);
    // An operative note does not wait for the discharge.
    const open = discharged();
    open.dischargeAt = undefined;
    open.status = "active";
    const early = buildDocument(input("operative", open, { "operation-request": [rec({ procedure: "Hip arthroplasty", operationStart: "2026-02-27T09:10", operationEnd: "2026-02-27T11:25" })] }, { procIndex: 0 }));
    expect(errorsOf(validateDoc(early))).toEqual([]);
    // The surgery case's operative note fills findings, specimens, complications and blood loss.
    const full = buildDocument(input("operative", withPr, { "operation-request": [rec({ procedure: "Hip arthroplasty", operationStart: "2026-02-27T09:10", operationEnd: "2026-02-27T11:25", opFindings: "Displaced fracture confirmed", specimens: "Femoral head to histology", complications: "None", bloodLossMl: 350 })] }, { procIndex: 0 }));
    for (const t of ["Displaced fracture confirmed", "Femoral head to histology", "350 mL"]) expect(full.xml).toContain(t);
    expect(errorsOf(validateDoc(full))).toEqual([]);
    expect(b.xml).toContain('<templateId root="2.16.840.1.113883.3.3731.1.210.5"/>');
    expect(b.metadata.documentEntry.classCode.code).toBe("REPORT");
    expect(b.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.53"); // surgery entry
    expect(errorsOf(validateDoc(b))).toEqual([]);
    const none = discharged();
    none.pr = [];
    expect(errorsOf(validateDoc(buildDocument(input("operative", none)))).some((c) => c.text.includes("procedure"))).toBe(true);
  });

  const delivery = { "delivery-outcomes": [rec({ deliveredAt: "2026-02-27T08:00", mode: "Emergency cesarean", birthStatus: "Live birth", sex: "Female", birthWeight: 3100, apgar1: 8, apgar5: 9, apgar10: 9, gestationalAge: 39, babyDisposition: "Nursery", babyHealthId: "1190000077" })] };

  it("builds Maternal and Newborn summaries from the delivery record", () => {
    const e = discharged();
    const m = buildDocument(input("maternal", e, delivery));
    expect(m.xml).toContain('code="11636-8"'); // live births
    expect(m.sections.find((s) => s.key === "labor")!.hasData).toBe(true);
    // Both counts are always sent, plus the mode of delivery and a pregnancy observation.
    expect(m.xml).toMatch(/code="11636-8"[\s\S]*?<value xsi:type="INT" value="1"\/>/);
    expect(m.xml).toMatch(/code="57062-2"[\s\S]*?<value xsi:type="INT" value="0"\/>/);
    expect(m.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.59");
    expect(m.xml).toContain("2.16.840.1.113883.3.3731.1.210.100.58");
    expect(m.xml).toContain('code="DEMO-MODE-EMERGENCY-CESAREAN" codeSystem="2.16.840.1.113883.3.3731.1.203.22"');
    expect(refsResolve(m.xml)).toBe(true);
    expect(errorsOf(validateDoc(m))).toEqual([]);
    const n = buildDocument(input("newborn", e, delivery));
    expect(n.xml).toContain('code="9272-6"');
    expect(n.xml).toContain('code="9271-8"'); // 10 minute Apgar
    expect(n.xml).toContain('code="49051-6"');
    expect(n.xml.split("2.16.840.1.113883.3.3731.1.210.100.63").length - 1).toBe(3);
    expect(n.header.patientName).toContain("Baby of");
    // The baby's own Health ID from the form is used. Nothing is made up.
    expect(n.header.healthId).toBe("1190000077");
    expect(n.facts.newbornIdMissing).toBe(false);
    expect(errorsOf(validateDoc(n))).toEqual([]);
  });

  it("blocks the Newborn summary without the baby's Health ID or with a missing Apgar score", () => {
    const e = discharged();
    const r = { ...delivery["delivery-outcomes"][0].values };
    const noId = buildDocument(input("newborn", e, { "delivery-outcomes": [rec({ ...r, babyHealthId: "" })] }));
    expect(noId.facts.newbornIdMissing).toBe(true);
    expect(errorsOf(validateDoc(noId)).some((c) => c.text.includes("Health ID"))).toBe(true);
    const noApgar = buildDocument(input("newborn", e, { "delivery-outcomes": [rec({ ...r, apgar10: "" })] }));
    expect(errorsOf(validateDoc(noApgar)).some((c) => c.text.includes("Apgar"))).toBe(true);
  });

  it("blocks the Newborn summary after a stillbirth but still builds the Maternal one", () => {
    const still = { "delivery-outcomes": [rec({ deliveredAt: "2026-02-27T08:00", mode: "Spontaneous vaginal", birthStatus: "Stillbirth (fresh)" })] };
    const e = discharged();
    const n = buildDocument(input("newborn", e, still));
    expect(validateDoc(n).some((c) => c.level === "error" && c.text.includes("stillbirth"))).toBe(true);
    const m = buildDocument(input("maternal", e, still));
    expect(m.xml).toMatch(/code="57062-2"[\s\S]*?<value xsi:type="INT" value="1"\/>/); // stillborn births
    expect(m.xml).toMatch(/code="11636-8"[\s\S]*?<value xsi:type="INT" value="0"\/>/); // live births, zero
    expect(m.xml).toContain('code="1" codeSystem="2.16.840.1.113883.3.3731.1.203.22"'); // real mode of delivery code
    expect(errorsOf(validateDoc(m))).toEqual([]);
  });

  it("flags a patient death", () => {
    const e = discharged();
    e.disposition = "79779006";
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
    expect(d.classCode.system).toBe("2.16.840.1.113883.3.3731.1.203.10");
    expect(d.formatCode.system).toBe("1.3.6.1.4.1.19376.1.2.3");
    expect(d.healthcareFacilityTypeCode.system).toBe("2.16.840.1.113883.3.3731.1.202.2");
    expect(d.practiceSettingCode.system).toBe("2.16.840.1.113883.3.3731.1.202.6");
    expect(b.metadata.submissionSet.contentTypeCode).toMatchObject({ code: "HOSPITAL-VISIT", system: "2.16.840.1.113883.3.3731.1.203.16" });
    expect(b.metadata.submissionSet.sourceId).toBe(ORG_OID);
  });

  it("renders the request as ebRIM like the official sample", () => {
    const b = buildDocument(input("discharge", discharged(), {}, { docId: "V-T-2", replaces: "V-T-1", version: 2 }));
    const r = renderRequest(b);
    expect(wellFormed(r)).toBeNull();
    expect(r).toContain("XDSDocumentEntry.patientId");
    expect(r).toContain('classificationScheme="urn:uuid:41a5887f-8865-4c09-adf7-e362475b143a"'); // classCode
    expect(r).toContain('identificationScheme="urn:uuid:554ac39e-e3fe-47fe-b233-965d2a147832"'); // sourceId
    expect(r).toContain('<rim:Slot name="authorSpecialty">');
    expect(r).not.toContain("authorSpeciality");
    expect(r).toContain('<rim:Slot name="urn:ihe:iti:xds:2013:referenceIdList">');
    expect(r).toContain("urn:oasis:names:tc:ebxml-regrep:AssociationType:HasMember");
    const a = b.metadata.association!;
    expect(a.source).toBe(b.metadata.documentEntry.entryUUID);
    expect(a.target).toMatch(/^urn:uuid:/);
    expect(a.target).toBe(entryUuid("V-T-1"));
    expect(r).toContain(`associationType="urn:ihe:iti:2007:AssociationType:RPLC"`);
    expect(r).toContain(`targetObject="${a.target}"`);
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
    const enc = discharged();
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
    // The replace association links the two document entries by entryUUID.
    expect(next.built.metadata.association).toEqual({ type: "RPLC", source: next.built.metadata.documentEntry.entryUUID, target: old.built.metadata.documentEntry.entryUUID });
    expect(next.built.xml).toContain('<nphies:documentStatus code="amended"');
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
