import { countryCode, FACILITY_NAME, OID, ORG_ID as SHARED_ORG_ID, ORG_OID, SERVICES, unitCodeOf } from "../reference-data";
import { babyHealthId, deliveredAt, doctor, encounterTimes, isDead, isStillbirth, latest, pick } from "./chartdata";
import { DOC_SPECS, LOINC, NPHIES_NS } from "./docspec";
import { buildSections, included } from "./sections";
import type { BuiltDoc, Coded, DocInput, Iti41Metadata } from "./types";
import { el, guid, hl7Date, hl7Time, narrative, sha1, tag, txt, utcTime } from "./xml";

/**
 * Builds the CDA document and its ITI-41 metadata.
 * Fixed values come from the guide pages (ids in the comments) and the official samples
 * ("Sample Messages" page 125206589: CDA and SOAP/ITI-41 folders).
 */

/** Organisation id in the KSA-wide provider directory. The shared demo value from reference-data: ADT sends the same id in MSH-4. */
export const ORG_ID = SHARED_ORG_ID;
/** Root OID for document ids, set ids and the visit number: the shared organisation OID, the same one ADT uses for PV1-19. */
export const DOC_ROOT = ORG_OID;
/** XDSSubmissionSet.sourceId is the National Organization OID (page 17694733 row 2.10). */
export const SOURCE_ID = ORG_OID;
const PHONE = "tel:+96611000000";

/** Code systems shown in the official samples. */
export const CS = {
  documentStatus: "2.16.840.1.113883.4.642.4.236",
  confidentiality: "2.16.840.1.113883.5.25",
  providerType: "2.16.840.1.113883.3.3731.1.202.1",
  specialty: "2.16.840.1.113883.3.3731.1.202.5",
  country: "1.0.3166.1",
  classCode: "2.16.840.1.113883.3.3731.1.203.10",
  formatCode: "1.3.6.1.4.1.19376.1.2.3",
  facilityType: "2.16.840.1.113883.3.3731.1.202.2",
  practiceSetting: "2.16.840.1.113883.3.3731.1.202.6",
  contentType: "2.16.840.1.113883.3.3731.1.203.16",
} as const;
/** KSA Individual Provider Type code for a doctor, from the official samples. */
const AUTHOR_ROLE = { code: "100000003", display: "Medicine and Surgery" };
const STATUS_NAME: Record<string, string> = { final: "Final", amended: "Amended" };

const cd = (code: string, system: string, display: string): Coded => ({ code, system, display });
const demo = (s: string) => `DEMO-${s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** entryUUID of the document entry for a document id. The same id always gives the same UUID, so a replacement can point at the old entry. */
export const entryUuid = (docId: string): string => `urn:uuid:${guid(`entry:${docId}`)}`;

function subjectOf(i: DocInput) {
  const p = i.patient;
  if (i.type !== "newborn") return { given: p.given, family: p.family, healthId: p.healthId, sex: p.sex, dob: p.dob, marital: p.maritalStatus, address: p.address, nat: p.nationality, mrn: p.mrn };
  const r = latest(i, "delivery-outcomes");
  const sexTxt = pick(r, ["sex"]);
  return {
    given: "Baby of " + p.given, family: p.family, healthId: babyHealthId(i),
    sex: (sexTxt === "Male" ? "M" : sexTxt === "Female" ? "F" : "UN") as "M" | "F" | "UN",
    dob: (deliveredAt(i) || p.dob).slice(0, 10), marital: "", address: p.address, nat: p.nationality, mrn: p.mrn + "-B",
  };
}

/** Street line, city and postal code are required. The chart has no city or postal code, so they carry nullFlavor UNK (page 15859889). */
const addr = (a: string) => el("addr", {}, [a ? txt("streetAddressLine", {}, a) : tag("streetAddressLine", { nullFlavor: "UNK" }), tag("city", { nullFlavor: "UNK" }), tag("postalCode", { nullFlavor: "UNK" })]);
const SAME_AS_AUTHOR = { nullFlavor: "NI" };

export function buildDocument(i: DocInput): BuiltDoc {
  const spec = DOC_SPECS[i.type];
  const sub = subjectOf(i);
  const doc = doctor(i.enc.attending);
  const authorName = i.author.name;
  const times = encounterTimes(i);
  const status: "final" | "amended" = i.version > 1 ? "amended" : "final";
  const sections = buildSections(i);
  const body = sections.filter(included);
  const created = hl7Time(i.now);
  const nat = countryCode(sub.nat);

  const personName = (legal = false) => el("name", legal ? { use: "L" } : {}, [txt("given", {}, doc?.given ?? authorName), txt("family", {}, doc?.family ?? "")]);
  const authorId = tag("id", { root: OID.provider, extension: i.author.id });
  const orgId = tag("id", { root: OID.nphiesApp, extension: ORG_ID });
  const specialtyCode = demo(`SPEC-${i.author.specialty}`);

  const sectionXml = body.map((s) =>
    el("component", {}, [
      el("section", {}, [
        ...s.templateIds.map((r) => tag("templateId", { root: r })),
        tag("code", { code: s.loinc, codeSystem: LOINC, codeSystemName: "LOINC", displayName: s.loincName }),
        txt("title", {}, s.title),
        narrative(s.blocks),
        ...s.entries,
      ]),
    ]),
  );

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- Demo document. Made-up patient. Codes that start with DEMO- are stand-ins. Never sent to NPHIES. -->`,
    el("ClinicalDocument", { xmlns: "urn:hl7-org:v3", "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xmlns:nphies": NPHIES_NS, "xmlns:pharm": "urn:ihe:pharm" }, [
      tag("realmCode", { code: "SA" }),
      tag("typeId", { root: "2.16.840.1.113883.1.3", extension: "POCD_HD000040" }),
      tag("templateId", { root: spec.templateId }),
      tag("id", { root: DOC_ROOT, extension: i.docId }),
      tag("code", { code: spec.typeCode, codeSystem: LOINC, codeSystemName: "LOINC", displayName: spec.typeDisplay }),
      txt("title", {}, spec.title),
      tag("nphies:documentStatus", { code: status, codeSystem: CS.documentStatus, codeSystemName: "FHIRDiagnosticReportStatus", displayName: STATUS_NAME[status] }),
      tag("effectiveTime", { value: created }),
      tag("confidentialityCode", { code: "N", codeSystem: CS.confidentiality, displayName: "normal" }),
      tag("languageCode", { code: "en-US" }),
      tag("setId", { root: DOC_ROOT, extension: i.setId }),
      tag("versionNumber", { value: i.version }),
      el("recordTarget", {}, [
        el("patientRole", {}, [
          tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.1" }),
          tag("id", { root: OID.healthId, extension: sub.healthId }),
          addr(sub.address),
          el("patient", {}, [
            el("name", {}, [txt("given", {}, sub.given), txt("family", {}, sub.family)]),
            tag("administrativeGenderCode", { code: sub.sex, codeSystem: "2.16.840.1.113883.5.1" }),
            tag("birthTime", { value: hl7Date(sub.dob) }),
            sub.marital && tag("maritalStatusCode", { code: sub.marital, codeSystem: "2.16.840.1.113883.5.2" }),
          ]),
        ]),
      ]),
      el("author", {}, [
        tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.3" }),
        tag("functionCode", { code: AUTHOR_ROLE.code, codeSystem: CS.providerType, codeSystemName: "KSA Individual Provider Type", displayName: AUTHOR_ROLE.display }),
        tag("time", { value: created }),
        // CDA order inside assignedAuthor: id, code, addr, telecom, person, organization.
        el("assignedAuthor", {}, [
          authorId,
          tag("code", { code: specialtyCode, codeSystem: CS.specialty, codeSystemName: "Healthcare Specialty Identifier", displayName: i.author.specialty }),
          addr("RHAD0001"),
          tag("telecom", { value: PHONE }),
          el("assignedPerson", {}, [personName()]),
          el("representedOrganization", {}, [orgId, txt("name", {}, FACILITY_NAME), tag("telecom", SAME_AS_AUTHOR), tag("addr", SAME_AS_AUTHOR)]),
        ]),
      ]),
      el("custodian", {}, [
        el("assignedCustodian", {}, [
          el("representedCustodianOrganization", {}, [
            tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.4" }),
            orgId,
            txt("name", {}, FACILITY_NAME),
            tag("telecom", { value: PHONE }),
            addr("RHAD0001"),
          ]),
        ]),
      ]),
      el("legalAuthenticator", {}, [
        tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.5" }),
        tag("time", { value: created }),
        tag("signatureCode", { code: "S" }),
        // Same address and phone as the author, so nullFlavor NI is used instead of repeating them. One name is marked legal.
        el("assignedEntity", {}, [authorId, tag("addr", SAME_AS_AUTHOR), tag("telecom", SAME_AS_AUTHOR), el("assignedPerson", {}, [personName(true)])]),
      ]),
      nat &&
        el("participant", { typeCode: "SBJ" }, [
          el("associatedEntity", { classCode: "CIT" }, [
            tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.2" }),
            tag("code", { code: nat, codeSystem: CS.country }),
          ]),
        ]),
      el("documentationOf", {}, [
        el("serviceEvent", { classCode: "PCPR" }, [
          el("performer", { typeCode: "PRF" }, [
            tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.7" }),
            tag("time", { value: times.start ? hl7Time(times.start) : created }),
            el("assignedEntity", {}, [authorId, tag("addr", SAME_AS_AUTHOR), tag("telecom", SAME_AS_AUTHOR), el("assignedPerson", {}, [personName()])]),
          ]),
        ]),
      ]),
      i.replaces && el("relatedDocument", { typeCode: "RPLC" }, [el("parentDocument", {}, [tag("id", { root: DOC_ROOT, extension: i.replaces })])]),
      el("componentOf", {}, [
        el("encompassingEncounter", {}, [
          tag("templateId", { root: "2.16.840.1.113883.3.3731.1.105.7" }),
          tag("id", { root: DOC_ROOT, extension: i.enc.visitNumber }),
          tag("code", { code: i.enc.cls, codeSystem: "2.16.840.1.113883.18.5", codeSystemName: "HL7 Patient Class" }),
          el("effectiveTime", {}, [times.start ? tag("low", { value: hl7Time(times.start) }) : tag("low", { nullFlavor: "UNK" }), times.end && tag("high", { value: hl7Time(times.end) })]),
          el("location", {}, [
            el("healthCareFacility", {}, [
              orgId,
              el("location", {}, [txt("name", {}, SERVICES.find((s) => s.code === i.enc.service)?.label ?? i.enc.service)]),
              el("serviceProviderOrganization", {}, [txt("name", {}, FACILITY_NAME)]),
            ]),
          ]),
        ]),
      ]),
      el("component", {}, [el("structuredBody", {}, sectionXml)]),
    ]),
  ].join("\n");

  const metadata = buildMetadata(i, xml, sub);
  const still = isStillbirth(i);
  return {
    type: i.type, title: spec.title, docId: i.docId, setId: i.setId, version: i.version, xml, sections, metadata,
    header: {
      patientName: `${sub.given} ${sub.family}`, healthId: sub.healthId, authorName, org: FACILITY_NAME, encounterId: i.enc.visitNumber,
      encounterStart: times.start, encounterEnd: times.end, createdAt: created, status,
    },
    facts: {
      hasEncounterStart: !!times.start, hasEncounterEnd: !!times.end, operationTimesMissing: i.type === "operative" && (!times.start || !times.end),
      dxCount: i.enc.dx.length, procCount: i.enc.pr.length, stillbirth: still, died: isDead(i),
      newbornIdMissing: i.type === "newborn" && !sub.healthId, liveBirth: !!latest(i, "delivery-outcomes") && !still,
    },
  };
}

function buildMetadata(i: DocInput, xml: string, sub: ReturnType<typeof subjectOf>): Iti41Metadata {
  const spec = DOC_SPECS[i.type];
  const svc = SERVICES.find((s) => s.code === i.enc.service);
  const doc = doctor(i.enc.attending);
  const hid = `${sub.healthId}^^^&${OID.healthId}&ISO`;
  const refs = [`${i.setId}^^^&${DOC_ROOT}&ISO^urn:ksa-ehealth:document:setId:2023`, `${i.enc.visitNumber}^^^&${DOC_ROOT}&ISO^urn:ihe:iti:xds:2015:encounterId`];
  const submissionTime = utcTime(i.now);
  const unit = unitCodeOf(i.enc.service);
  const inpatient = i.enc.cls === "I";
  return {
    documentEntry: {
      entryUUID: entryUuid(i.docId),
      uniqueId: `${DOC_ROOT}^${i.docId}`,
      patientId: hid,
      sourcePatientId: `${sub.mrn}^^^&${DOC_ROOT}&ISO`,
      title: spec.title,
      typeCode: cd(spec.typeCode, LOINC, spec.typeDisplay),
      classCode: cd(spec.classCode, CS.classCode, spec.classCode === "REPORT" ? "Report" : "Summaries"),
      formatCode: cd("urn:ihe:pcc:xds-ms:2007", CS.formatCode, "Medical Summary"),
      mimeType: "text/xml",
      confidentialityCode: cd("N", CS.confidentiality, "normal"),
      creationTime: submissionTime,
      languageCode: "en-US",
      // Demo codes: the "Healthcare Facility Type of Care" list is in IS0200.
      healthcareFacilityTypeCode: cd(inpatient ? "DEMO-FACILITY-HOSPITAL-INPATIENT" : "DEMO-FACILITY-HOSPITAL-OUTPATIENT", CS.facilityType, inpatient ? "Hospital inpatient" : "Hospital outpatient"),
      // The medical unit code ADT sends in PV1-10. A service with no published unit gets a DEMO- code.
      practiceSettingCode: cd(unit || demo(`UNIT-${i.enc.service}`), CS.practiceSetting, svc?.label ?? i.enc.service),
      author: {
        institution: `${FACILITY_NAME}^^^^^&${OID.nphiesApp}&ISO^^^^${ORG_ID}`,
        person: `${i.author.id}^${doc?.family ?? ""}^${doc?.given ?? ""}^^^^^^&${OID.provider}&ISO`,
        // Derived from the CDA author functionCode and specialty display names (page 17596480 rows 1.1.3 and 1.1.4).
        role: AUTHOR_ROLE.display,
        speciality: i.author.specialty,
      },
      availabilityStatus: "Approved",
      hash: sha1(xml),
      size: new TextEncoder().encode(xml).length,
      referenceIdList: refs,
      objectType: "urn:uuid:7edca82f-054d-47f2-a032-9b2a5b5186c1",
      comments: i.amendReason,
    },
    submissionSet: {
      entryUUID: `urn:uuid:${guid(`ss:${i.docId}`)}`,
      uniqueId: `${DOC_ROOT}.2.${submissionTime}`,
      sourceId: SOURCE_ID,
      submissionTime,
      contentTypeCode: cd("HOSPITAL-VISIT", CS.contentType, "Hospital visit"),
      patientId: hid,
      availabilityStatus: "Approved",
      intendedRecipient: `nphies^^^^^&${OID.nphiesApp}&ISO^^^^${ORG_ID}`,
    },
    association: i.replaces ? { type: "RPLC", source: entryUuid(i.docId), target: entryUuid(i.replaces) } : undefined,
  };
}
