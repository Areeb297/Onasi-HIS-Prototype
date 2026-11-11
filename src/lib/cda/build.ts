import { FACILITY_NAME, OID, SERVICES } from "../reference-data";
import { doctor, encounterTimes, isDead, isStillbirth, latest, newbornTempId, pick } from "./chartdata";
import { DOC_SPECS, LOINC, NPHIES_NS } from "./docspec";
import { buildSections, included } from "./sections";
import type { BuiltDoc, Coded, DocInput, Iti41Metadata } from "./types";
import { el, guid, hl7Date, hl7Time, narrative, sha1, tag, txt, utcTime } from "./xml";

/** Made-up provider directory id for this facility (the real one comes from nphies onboarding). */
export const ORG_ID = "11000099990001";
/** Root OID for document ids. OID.participant is a made-up demo value. */
export const DOC_ROOT = OID.participant;
export const SOURCE_ID = `2.16.840.1.113883.3.3731.${ORG_ID}`;
const PHONE = "tel:+96611000000";
const PLACEHOLDER_SYS = "urn:demo:placeholder-IS0200";
const SCHEME = (name: string) => `urn:demo:${name}`;

const cd = (code: string, system: string, display: string): Coded => ({ code, system, display });

function subjectOf(i: DocInput) {
  const p = i.patient;
  if (i.type !== "newborn") return { given: p.given, family: p.family, healthId: p.healthId, sex: p.sex, dob: p.dob, marital: p.maritalStatus, address: p.address, nat: p.nationality, temp: false, mrn: p.mrn };
  const r = latest(i, "delivery-outcomes");
  const sexTxt = pick(r, ["sex"]);
  return {
    given: "Baby of " + p.given, family: p.family, healthId: newbornTempId(p.healthId),
    sex: (sexTxt === "Male" ? "M" : sexTxt === "Female" ? "F" : "UN") as "M" | "F" | "UN",
    dob: (pick(r, ["deliveredAt"]) || i.enc.admitAt || p.dob).slice(0, 10), marital: "", address: p.address, nat: p.nationality, temp: true, mrn: p.mrn + "-B",
  };
}

const addr = (a: string) => el("addr", {}, [txt("streetAddressLine", {}, a), txt("country", {}, "SA")]);
const orgBlock = () => [tag("id", { root: OID.nphiesApp, extension: ORG_ID }), txt("name", {}, FACILITY_NAME), tag("telecom", { value: PHONE }), addr("RHAD0001")];

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

  const nameBlock = (given: string, family: string) => el("name", {}, [txt("given", {}, given), txt("family", {}, family)]);
  const authorId = tag("id", { root: OID.provider, extension: i.author.id });
  const personBlock = (tagName: "assignedAuthor" | "assignedEntity") =>
    el(tagName, {}, [
      authorId,
      tagName === "assignedAuthor" && tag("code", { code: i.author.specialty, codeSystem: PLACEHOLDER_SYS, displayName: i.author.specialty }),
      tag("telecom", { value: PHONE }),
      addr("RHAD0001"),
      el("assignedPerson", {}, [nameBlock(doc?.given ?? authorName, doc?.family ?? "")]),
      el("representedOrganization", {}, orgBlock()),
    ]);

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
    `<!-- Demo document. Made-up patient and codes. Never sent to NPHIES. -->`,
    el("ClinicalDocument", { xmlns: "urn:hl7-org:v3", "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xmlns:nphies": NPHIES_NS }, [
      tag("realmCode", { code: "SA" }),
      tag("typeId", { root: "2.16.840.1.113883.1.3", extension: "POCD_HD000040" }),
      tag("templateId", { root: spec.templateId }),
      tag("id", { root: DOC_ROOT, extension: i.docId }),
      tag("code", { code: spec.typeCode, codeSystem: LOINC, codeSystemName: "LOINC", displayName: spec.typeDisplay }),
      txt("title", {}, spec.title),
      tag("nphies:documentStatus", { code: status }),
      tag("effectiveTime", { value: created }),
      tag("confidentialityCode", { code: "N", codeSystem: "2.16.840.1.113883.5.25", displayName: "Normal" }),
      tag("languageCode", { code: "en-US" }),
      tag("setId", { root: DOC_ROOT, extension: i.setId }),
      tag("versionNumber", { value: i.version }),
      el("recordTarget", {}, [
        el("patientRole", {}, [
          tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.1" }),
          tag("id", { root: OID.healthId, extension: sub.healthId }),
          addr(sub.address),
          el("patient", {}, [
            nameBlock(sub.given, sub.family),
            tag("administrativeGenderCode", { code: sub.sex, codeSystem: "2.16.840.1.113883.5.1" }),
            tag("birthTime", { value: hl7Date(sub.dob) }),
            sub.marital && tag("maritalStatusCode", { code: sub.marital, codeSystem: "2.16.840.1.113883.5.2" }),
          ]),
        ]),
      ]),
      el("author", {}, [
        tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.3" }),
        tag("functionCode", { code: "MD", codeSystem: PLACEHOLDER_SYS, displayName: "Medical practitioner" }),
        tag("time", { value: created }),
        personBlock("assignedAuthor"),
      ]),
      el("custodian", {}, [
        el("assignedCustodian", {}, [
          el("representedCustodianOrganization", {}, [
            tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.4" }),
            tag("id", { root: OID.nphiesApp, extension: ORG_ID }),
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
        personBlock("assignedEntity"),
      ]),
      el("participant", { typeCode: "SBJ" }, [
        el("associatedEntity", { classCode: "CIT" }, [
          tag("templateId", { root: "2.16.840.1.113883.3.3731.1.203.28.2" }),
          tag("code", { code: sub.nat, codeSystem: PLACEHOLDER_SYS }),
        ]),
      ]),
      el("documentationOf", {}, [
        el("serviceEvent", { classCode: "PCPR" }, [
          el("performer", { typeCode: "PRF" }, [
            el("assignedEntity", {}, [authorId, el("assignedPerson", {}, [nameBlock(doc?.given ?? authorName, doc?.family ?? "")])]),
          ]),
        ]),
      ]),
      i.replaces && el("relatedDocument", { typeCode: "RPLC" }, [el("parentDocument", {}, [tag("id", { root: DOC_ROOT, extension: i.replaces })])]),
      el("componentOf", {}, [
        el("encompassingEncounter", {}, [
          tag("templateId", { root: "2.16.840.1.113883.3.3731.1.105.7" }),
          tag("id", { root: DOC_ROOT, extension: i.enc.visitNumber }),
          tag("code", { code: i.enc.cls, codeSystem: "2.16.840.1.113883.18.5", codeSystemName: "HL7 Patient Class" }),
          el("effectiveTime", {}, [times.start && tag("low", { value: hl7Time(times.start) }), times.end && tag("high", { value: hl7Time(times.end) })]),
          el("location", {}, [
            el("healthCareFacility", {}, [
              tag("id", { root: OID.nphiesApp, extension: ORG_ID }),
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
  return {
    type: i.type, title: spec.title, docId: i.docId, setId: i.setId, version: i.version, xml, sections, metadata,
    header: {
      patientName: `${sub.given} ${sub.family}`, healthId: sub.healthId, authorName, org: FACILITY_NAME, encounterId: i.enc.visitNumber,
      encounterStart: times.start, encounterEnd: times.end, createdAt: created, status,
    },
    facts: {
      hasEncounterStart: !!times.start, hasEncounterEnd: !!times.end, encounterFallback: times.fallback, dxCount: i.enc.dx.length,
      procCount: i.enc.pr.length, stillbirth: isStillbirth(i), died: isDead(i), newbornTempId: sub.temp,
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
  return {
    documentEntry: {
      entryUUID: `urn:uuid:${guid(`entry:${i.docId}`)}`,
      uniqueId: `${DOC_ROOT}^${i.docId}`,
      patientId: hid,
      sourcePatientId: `${sub.mrn}^^^&${DOC_ROOT}&ISO`,
      title: spec.title,
      typeCode: cd(spec.typeCode, LOINC, spec.typeDisplay),
      classCode: cd(spec.classCode, SCHEME("KSA-Class-Code"), spec.classCode === "REPORT" ? "Report" : "Summaries"),
      formatCode: cd("urn:ihe:pcc:xds-ms:2007", "urn:ihe:pcc:xds-ms:2007", "XDS-MS"),
      mimeType: "text/xml",
      confidentialityCode: cd("N", "2.16.840.1.113883.5.25", "Normal"),
      creationTime: submissionTime,
      languageCode: "en-US",
      healthcareFacilityTypeCode: cd(i.enc.cls === "I" ? "HOSP-IP" : "HOSP-OP", PLACEHOLDER_SYS, i.enc.cls === "I" ? "Hospital inpatient" : "Hospital outpatient"),
      practiceSettingCode: cd(i.enc.service, PLACEHOLDER_SYS, svc?.label ?? i.enc.service),
      author: {
        institution: `${FACILITY_NAME}^^^^^&${OID.nphiesApp}&ISO^^^^${ORG_ID}`,
        person: `${i.author.id}^${doc?.family ?? ""}^${doc?.given ?? ""}^^^^^^&${OID.provider}&ISO`,
        role: "Medical practitioner",
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
      contentTypeCode: cd(spec.classCode === "REPORT" ? "OPNOTE" : "SUMMARY", PLACEHOLDER_SYS, spec.label),
      patientId: hid,
      availabilityStatus: "Approved",
      intendedRecipient: `nphies^^^^^&${OID.nphiesApp}&ISO^^^^${ORG_ID}`,
    },
    association: i.replaces ? { type: "RPLC", source: i.docId, target: i.replaces } : undefined,
  };
}
