import type { Check } from "../model";
import { OID } from "../reference-data";
import type { BuiltDoc, Coded, SimResponse } from "./types";
import { el, tag, txt } from "./xml";

/**
 * The ITI-41 Provide and Register Document Set-b request, in ebRIM form, and a simulated registry response.
 * The layout follows the official sample "nphies ITI41 Discharge Summary v4.9beta1 RPLC.xml" ("Sample Messages" page 125206589)
 * and the Associations page (17694743). The classification and identifier scheme UUIDs are the fixed IHE XDS ones.
 * No network call is made. The document itself would travel as an MTOM attachment.
 */

const SCHEME = {
  // XDSDocumentEntry
  docAuthor: "urn:uuid:93606bcf-9494-43ec-9b4e-a7748d1a838d",
  classCode: "urn:uuid:41a5887f-8865-4c09-adf7-e362475b143a",
  confidentialityCode: "urn:uuid:f4f85eac-e6cb-4883-b524-f2705394840f",
  formatCode: "urn:uuid:a09d5840-386c-46f2-b5ad-9c3699a4309d",
  healthcareFacilityTypeCode: "urn:uuid:f33fb8ac-18af-42cc-ae0e-ed0b0bdb91e1",
  practiceSettingCode: "urn:uuid:cccf5598-8b07-4b77-a05e-ae952c785ead",
  typeCode: "urn:uuid:f0306f51-975f-434e-a61c-c59651d33983",
  docPatientId: "urn:uuid:58a6f841-87b3-4a3e-92fd-a8ffeff98427",
  docUniqueId: "urn:uuid:2e82c1f6-a085-4c72-9da3-8640a32e42ab",
  // XDSSubmissionSet
  submissionSetNode: "urn:uuid:a54d6aa5-d40d-43f9-88c5-b4633d873bdd",
  ssAuthor: "urn:uuid:a7058bb9-b4e4-4307-ba5b-e3f0ab85e12d",
  contentTypeCode: "urn:uuid:aa543740-bdda-424e-8c96-df4873be8500",
  ssUniqueId: "urn:uuid:96fdda7c-d067-4183-912e-bf5ee74998a8",
  ssSourceId: "urn:uuid:554ac39e-e3fe-47fe-b233-965d2a147832",
  ssPatientId: "urn:uuid:6b5aea1a-874d-4603-a4bc-96a0a7b38446",
} as const;
const HAS_MEMBER = "urn:oasis:names:tc:ebxml-regrep:AssociationType:HasMember";
const RPLC = "urn:ihe:iti:2007:AssociationType:RPLC";
const APPROVED = "urn:oasis:names:tc:ebxml-regrep:StatusType:Approved";

/** One slot. A list gives one rim:Value per item. */
const slot = (name: string, value: string | number | string[]) =>
  el("rim:Slot", { name }, [el("rim:ValueList", {}, (Array.isArray(value) ? value : [String(value)]).map((v) => txt("rim:Value", {}, v)))]);
const name = (value: string) => el("rim:Name", {}, [tag("rim:LocalizedString", { value })]);

export function renderRequest(b: BuiltDoc): string {
  const d = b.metadata.documentEntry;
  const s = b.metadata.submissionSet;
  let n = 0;
  const id = (p: string) => `${p}${String(++n).padStart(2, "0")}`;
  const cls = (scheme: string, object: string, c: Coded) =>
    el("rim:Classification", { classificationScheme: scheme, classifiedObject: object, id: id("cl"), nodeRepresentation: c.code }, [slot("codingScheme", c.system), name(c.display)]);
  const author = (scheme: string, object: string) =>
    el("rim:Classification", { classificationScheme: scheme, classifiedObject: object, id: id("cl"), nodeRepresentation: "" }, [
      slot("authorPerson", d.author.person), slot("authorInstitution", d.author.institution), slot("authorRole", d.author.role), slot("authorSpecialty", d.author.speciality),
    ]);
  const ext = (scheme: string, object: string, label: string, value: string) =>
    el("rim:ExternalIdentifier", { id: id("ei"), identificationScheme: scheme, registryObject: object, value }, [name(label)]);

  const doc = el("rim:ExtrinsicObject", { id: d.entryUUID, mimeType: d.mimeType, objectType: d.objectType, status: APPROVED }, [
    slot("creationTime", d.creationTime), slot("hash", d.hash), slot("size", d.size), slot("languageCode", d.languageCode),
    slot("urn:ihe:iti:xds:2013:referenceIdList", d.referenceIdList), slot("sourcePatientId", d.sourcePatientId),
    name(d.title),
    d.comments && el("rim:Description", {}, [tag("rim:LocalizedString", { value: d.comments })]),
    author(SCHEME.docAuthor, d.entryUUID),
    cls(SCHEME.classCode, d.entryUUID, d.classCode), cls(SCHEME.confidentialityCode, d.entryUUID, d.confidentialityCode), cls(SCHEME.formatCode, d.entryUUID, d.formatCode),
    cls(SCHEME.healthcareFacilityTypeCode, d.entryUUID, d.healthcareFacilityTypeCode), cls(SCHEME.practiceSettingCode, d.entryUUID, d.practiceSettingCode),
    cls(SCHEME.typeCode, d.entryUUID, d.typeCode),
    ext(SCHEME.docPatientId, d.entryUUID, "XDSDocumentEntry.patientId", d.patientId),
    ext(SCHEME.docUniqueId, d.entryUUID, "XDSDocumentEntry.uniqueId", d.uniqueId),
  ]);
  const set = el("rim:RegistryPackage", { id: s.entryUUID, status: APPROVED }, [
    slot("submissionTime", s.submissionTime), slot("intendedRecipient", s.intendedRecipient),
    name(`${d.title} submission`),
    author(SCHEME.ssAuthor, s.entryUUID),
    cls(SCHEME.contentTypeCode, s.entryUUID, s.contentTypeCode),
    ext(SCHEME.ssUniqueId, s.entryUUID, "XDSSubmissionSet.uniqueId", s.uniqueId),
    ext(SCHEME.ssSourceId, s.entryUUID, "XDSSubmissionSet.sourceId", s.sourceId),
    ext(SCHEME.ssPatientId, s.entryUUID, "XDSSubmissionSet.patientId", s.patientId),
  ]);
  // Marks the registry package as a submission set.
  const node = tag("rim:Classification", { classificationNode: SCHEME.submissionSetNode, classifiedObject: s.entryUUID, id: id("cl") });
  // The submission set contains the document entry.
  const member = el("rim:Association", { associationType: HAS_MEMBER, id: id("as"), sourceObject: s.entryUUID, targetObject: d.entryUUID }, [slot("SubmissionSetStatus", "Original")]);
  // On an amendment the new document entry replaces the old one, which the registry then marks Deprecated.
  const a = b.metadata.association;
  const replace = a && tag("rim:Association", { associationType: RPLC, id: id("as"), status: APPROVED, sourceObject: a.source, targetObject: a.target });

  return el("soap:Envelope", { "xmlns:soap": "http://www.w3.org/2003/05/soap-envelope", "xmlns:addressing": "http://www.w3.org/2005/08/addressing", "xmlns:xdsb": "urn:ihe:iti:xds-b:2007", "xmlns:lcm": "urn:oasis:names:tc:ebxml-regrep:xsd:lcm:3.0", "xmlns:rim": "urn:oasis:names:tc:ebxml-regrep:xsd:rim:3.0" }, [
    el("soap:Header", {}, [
      txt("addressing:MessageID", {}, s.entryUUID),
      txt("addressing:Action", {}, "urn:ihe:iti:2007:ProvideAndRegisterDocumentSet-b"),
    ]),
    el("soap:Body", {}, [
      el("xdsb:ProvideAndRegisterDocumentSetRequest", {}, [
        el("lcm:SubmitObjectsRequest", {}, [el("rim:RegistryObjectList", {}, [node, doc, set, member, replace])]),
        el("xdsb:Document", { id: d.entryUUID }, [tag("xop:Include", { "xmlns:xop": "http://www.w3.org/2004/08/xop/include", href: `cid:${b.docId}.xml` })]),
      ]),
    ]),
  ]);
}

const SUCCESS = "urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Success";
const FAILURE = "urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Failure";

/** What the registry would answer. Any error check in the validator becomes an XDSRepositoryMetadata error. */
export function simulateResponse(b: BuiltDoc, checks: Check[], now: Date): SimResponse {
  const errors = checks.filter((c) => c.level === "error").map((c) => ({ code: "XDSRepositoryMetadata", context: c.text }));
  const ok = errors.length === 0;
  const xml = ok
    ? tag("rs:RegistryResponse", { "xmlns:rs": "urn:oasis:names:tc:ebxml-regrep:xsd:rs:3.0", status: SUCCESS })
    : el("rs:RegistryResponse", { "xmlns:rs": "urn:oasis:names:tc:ebxml-regrep:xsd:rs:3.0", status: FAILURE }, [
        el("rs:RegistryErrorList", {}, errors.map((e) => tag("rs:RegistryError", { errorCode: e.code, codeContext: e.context, severity: "urn:oasis:names:tc:ebxml-regrep:ErrorSeverityType:Error", location: OID.nphiesApp }))),
      ]);
  return { ok, status: ok ? SUCCESS : FAILURE, submissionId: b.metadata.submissionSet.uniqueId, errors, xml, at: now.toISOString() };
}
