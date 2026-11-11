import type { Check } from "../model";
import { OID } from "../reference-data";
import type { BuiltDoc, Coded, SimResponse } from "./types";
import { el, tag, txt } from "./xml";

/** Simplified ITI-41 request and a simulated registry response. No network call is made. */

const slot = (name: string, value: string | number) => el("rim:Slot", { name }, [el("rim:ValueList", {}, [txt("rim:Value", {}, String(value))])]);
const cls = (scheme: string, c: Coded) =>
  el("rim:Classification", { classificationScheme: scheme, nodeRepresentation: c.code }, [slot("codingScheme", c.system), el("rim:Name", {}, [tag("rim:LocalizedString", { value: c.display })])]);

/** Readable form of the Provide and Register request. The real message uses ebRIM ExtrinsicObject and scheme UUIDs. */
export function renderRequest(b: BuiltDoc): string {
  const d = b.metadata.documentEntry;
  const s = b.metadata.submissionSet;
  const obj = el("rim:ExtrinsicObject", { id: d.entryUUID, mimeType: d.mimeType, objectType: d.objectType, status: `urn:oasis:names:tc:ebxml-regrep:StatusType:${d.availabilityStatus}` }, [
    slot("creationTime", d.creationTime), slot("languageCode", d.languageCode), slot("hash", d.hash), slot("size", d.size),
    slot("sourcePatientId", d.sourcePatientId), slot("referenceIdList", d.referenceIdList.join(" ")),
    slot("authorPerson", d.author.person), slot("authorInstitution", d.author.institution),
    slot("authorRole", d.author.role), slot("authorSpeciality", d.author.speciality),
    el("rim:Name", {}, [tag("rim:LocalizedString", { value: d.title })]),
    d.comments && el("rim:Description", {}, [tag("rim:LocalizedString", { value: d.comments })]),
    cls("classCode", d.classCode), cls("typeCode", d.typeCode), cls("formatCode", d.formatCode), cls("confidentialityCode", d.confidentialityCode),
    cls("healthcareFacilityTypeCode", d.healthcareFacilityTypeCode), cls("practiceSettingCode", d.practiceSettingCode),
    tag("rim:ExternalIdentifier", { identificationScheme: "XDSDocumentEntry.patientId", value: d.patientId }),
    tag("rim:ExternalIdentifier", { identificationScheme: "XDSDocumentEntry.uniqueId", value: d.uniqueId }),
  ]);
  const set = el("rim:RegistryPackage", { id: s.entryUUID }, [
    slot("submissionTime", s.submissionTime), slot("intendedRecipient", s.intendedRecipient),
    cls("contentTypeCode", s.contentTypeCode),
    tag("rim:ExternalIdentifier", { identificationScheme: "XDSSubmissionSet.patientId", value: s.patientId }),
    tag("rim:ExternalIdentifier", { identificationScheme: "XDSSubmissionSet.sourceId", value: s.sourceId }),
    tag("rim:ExternalIdentifier", { identificationScheme: "XDSSubmissionSet.uniqueId", value: s.uniqueId }),
  ]);
  const assoc = b.metadata.association && tag("rim:Association", { associationType: "urn:ihe:iti:2007:AssociationType:RPLC", sourceObject: b.metadata.association.source, targetObject: b.metadata.association.target });
  return [
    `<!-- Simplified for reading. A real request uses ebRIM scheme UUIDs and the document as an MTOM attachment. -->`,
    el("xdsb:ProvideAndRegisterDocumentSetRequest", { "xmlns:xdsb": "urn:ihe:iti:xds-b:2007", "xmlns:rim": "urn:oasis:names:tc:ebxml-regrep:xsd:rim:3.0", "xmlns:lcm": "urn:oasis:names:tc:ebxml-regrep:xsd:lcm:3.0" }, [
      el("lcm:SubmitObjectsRequest", {}, [el("rim:RegistryObjectList", {}, [obj, set, assoc])]),
      el("xdsb:Document", { id: d.entryUUID }, [tag("xop:Include", { href: `cid:${b.docId}` })]),
    ]),
  ].join("\n");
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
