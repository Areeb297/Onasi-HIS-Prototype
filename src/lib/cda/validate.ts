import type { Check } from "../model";
import { OID } from "../reference-data";
import { DOC_SPECS } from "./docspec";
import type { BuiltDoc } from "./types";
import { wellFormed } from "./xml";

/**
 * Checks a built document against the rules we can see in the snapshot:
 * CDA header (Clinical Document General), header by type (Table 22), body sections (Tables 23 to 27),
 * metadata (Document Metadata and Provide and Register optionality), and the exceptions (death, stillbirth).
 * It is not a schema validator.
 */

const has = (xml: string, re: RegExp) => re.test(xml);
const dots = (s: string) => s.replace(/\./g, "\\.");

export function validateDoc(b: BuiltDoc): Check[] {
  const out: Check[] = [];
  const err = (text: string) => out.push({ level: "error", text });
  const warn = (text: string) => out.push({ level: "warn", text });
  const ok = (text: string) => out.push({ level: "ok", text });
  const spec = DOC_SPECS[b.type];
  const x = b.xml;

  /* exceptions first */
  if (b.facts.died) err("The patient died (disposition 20). Nothing is published to nphies for a patient death. Death reporting is a separate process. (Seha step 4.2.7)");
  if (b.type === "newborn" && b.facts.stillbirth) err("A stillbirth was recorded, so no Newborn Discharge Summary is created. Send only the Maternal Discharge Summary. (Seha step 4.3.15)");

  /* XML */
  const wf = wellFormed(x);
  if (wf) err(`The XML is not well formed. ${wf}.`);
  else ok("The XML is well formed.");

  /* CDA header: Clinical Document General (Table 32) */
  if (!has(x, /<realmCode code="SA"\/>/)) err('realmCode must be present with code "SA".');
  if (!has(x, new RegExp(`<templateId root="${dots(spec.templateId)}"/>`))) err(`The document templateId must be ${spec.templateId}.`);
  if (!has(x, /<id root="[\d.]+" extension="[^"]+"\/>/)) err("ClinicalDocument/id needs a root OID and an extension.");
  if (!has(x, new RegExp(`<code code="${spec.typeCode}" codeSystem="2\\.16\\.840\\.1\\.113883\\.6\\.1"`))) err(`The document type code must be LOINC ${spec.typeCode}.`);
  if (!has(x, /<nphies:documentStatus code="(final|amended|preliminary|registered|partial|corrected|appended|cancelled|entered-in-error|unknown)"\/>/)) err("nphies:documentStatus is missing or not from the DiagnosticReport status value set.");
  if (!has(x, /<effectiveTime value="\d{14}[+-]\d{4}"\/>/)) err("effectiveTime must have date, time and a time zone offset (CCYYMMDDhhmmss+ZZzz).");
  if (!has(x, /<confidentialityCode code="[^"]+"/)) err("confidentialityCode is missing.");
  if (!has(x, /<languageCode code="[a-z]{2}-[A-Z]{2}"\/>/)) err("languageCode must follow BCP 47, for example en-US.");
  if (!has(x, /<setId root="[\d.]+" extension="[^"]+"\/>/)) err("setId is missing.");
  if (!has(x, /<versionNumber value="\d+"\/>/)) err("versionNumber is missing.");
  if (b.version > 1 && !has(x, /<relatedDocument typeCode="RPLC">/)) err("An amended version must carry relatedDocument RPLC that points to the document it replaces.");
  if (b.version === 1 && has(x, /<relatedDocument/)) warn("Version 1 should not replace another document.");

  /* Patient (Table 33) */
  if (!has(x, new RegExp(`<id root="${dots(OID.healthId)}" extension="\\d{6,}"/>`))) err("The patient needs a Health ID with the NHIC OID 2.16.840.1.113883.3.3731.1.1.100.1.");
  else ok("The patient has a Health ID.");
  if (b.facts.newbornTempId) warn("The newborn has no Health ID of its own. A made-up temporary ID is used. Send an amendment when the permanent ID is assigned.");
  if (!has(x, /<birthTime value="\d{8}/)) err("The patient birth date (birthTime) is required.");

  /* Author, legal authenticator, custodian (Tables 34, 37, 38, Table 22 rows 4 and 5) */
  if (!has(x, /<author>[\s\S]*<assignedAuthor>[\s\S]*<id root="2\.16\.840\.1\.113883\.3\.3731\.1\.2\.1" extension="[^"]+"\/>/)) err("The author needs a National Provider ID (OID 2.16.840.1.113883.3.3731.1.2.1). The author must be a person.");
  else ok("The author is a person with a provider ID.");
  if (!has(x, /<legalAuthenticator>[\s\S]*<signatureCode code="S"\/>/)) err("A legal authenticator with signatureCode S is required for this document type.");
  else ok("A legal authenticator is present.");
  if (!has(x, /<custodian>/)) err("The custodian organisation is required.");
  if (!has(x, /<performer typeCode="PRF">/)) (spec.performer === "M" ? err : warn)("A performer (the person who provided care) is expected.");

  /* Encounter (Table 22 row 7, Table 42) */
  if (!b.facts.hasEncounterStart) err("The encounter start date and time is required.");
  if (!b.facts.hasEncounterEnd) {
    err(b.type === "outpatient" ? "The encounter must be finished before the summary is sent. Add the end time (discharge the visit)." : "The encounter end or discharge time is required. Discharge the visit first.");
  }
  if (b.facts.encounterFallback) warn("Operative date and time in and out are not recorded. The visit times are used instead. Add them to the operation record.");

  /* Clinical content */
  if (b.type !== "operative" && b.facts.dxCount === 0) err("At least one diagnosis is required (principal diagnosis).");
  if (b.type === "operative" && b.facts.procCount === 0) err("At least one procedure is required. One operative note is created for each surgery.");
  const bad = [...x.matchAll(/xsi:type="CD" code="([^"]+)" codeSystem="2\.16\.840\.1\.113883\.6\.3"/g)].map((m) => m[1]).filter((c) => !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(c));
  if (bad.length) warn(`Diagnosis code format looks wrong: ${[...new Set(bad)].join(", ")}.`);

  /* Sections (Tables 23 to 27) */
  let missing = 0;
  for (const s of b.sections) {
    if (s.usage === "R" && !s.hasData) {
      missing++;
      warn(`${s.title} is required but the chart has no data for it. "No information available" is sent.`);
    }
    if (s.usage === "R" && !x.includes(`displayName="${s.loincName}"`)) err(`${s.title} section is missing from the XML.`);
  }
  const filled = b.sections.filter((s) => s.hasData).length;
  ok(`${filled} of ${b.sections.length} sections have data. ${missing} required ${missing === 1 ? "section is" : "sections are"} empty.`);

  /* Metadata (Document Metadata tables) */
  const m = b.metadata.documentEntry;
  if (!m.patientId.includes(`&${OID.healthId}&ISO`)) err("Metadata patientId must be the Health ID with the NHIC OID.");
  if (m.hash.length !== 40) err("Metadata hash must be a SHA-1 value.");
  if (m.size <= 0) err("Metadata size must be greater than 0.");
  if (m.classCode.code !== spec.classCode) err(`Metadata classCode must be ${spec.classCode}.`);
  if (m.typeCode.code !== spec.typeCode) err(`Metadata typeCode must be ${spec.typeCode}.`);
  if (m.formatCode.code !== "urn:ihe:pcc:xds-ms:2007") err("Metadata formatCode must be urn:ihe:pcc:xds-ms:2007.");
  if (m.mimeType !== "text/xml") err("Metadata mimeType must be text/xml.");
  if (!m.referenceIdList[0]?.endsWith("urn:ksa-ehealth:document:setId:2023")) err("The first referenceIdList entry must be the CDA setId with urn:ksa-ehealth:document:setId:2023.");
  if (b.metadata.association && b.metadata.association.target === b.docId) err("A document cannot replace itself.");
  ok("Metadata has the required attributes. serviceStartTime and serviceStopTime are not sent, as the type table says.");
  warn("Facility type, practice setting, content type and class code values use placeholder codes. Replace them with IS0200 values.");

  return out;
}

export const errorsOf = (c: Check[]) => c.filter((x) => x.level === "error");
