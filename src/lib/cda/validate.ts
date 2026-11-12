import type { Check } from "../model";
import type { BuiltDoc, DocType } from "./types";
import { wellFormed } from "./xml";

/**
 * Checks a built document against the integration guide: CDA header (Clinical Document General, page 15925510),
 * header by type (15925336), body sections (pages 15958062, 15892634, 15958089, 15925379, 15859808), the entry pages,
 * the metadata pages (15892543, 17596480, 17694733) and the exceptions (death, stillbirth).
 * It is not a schema validator.
 *
 * Every fixed value below is written out from the guide or the official samples. Nothing is imported from the
 * builder or from docspec on purpose, so a wrong constant there is caught here.
 */

const OID_HEALTH_ID = "2.16.840.1.113883.3.3731.1.1.100.1";
const OID_PROVIDER = "2.16.840.1.113883.3.3731.1.2.1";
const OID_ORG = "2.16.840.1.113883.3.3731.1.2.2";
const OID_LOINC = "2.16.840.1.113883.6.1";
const OID_ICD10AM = "2.16.840.1.113883.6.135";
const SEC = "2.16.840.1.113883.3.3731.1.210.100.";

/** CDA Header by Document Type (page 15925336) and Document Metadata (page 15892543). */
const DOC: Record<DocType, { templateId: string; typeCode: string; classCode: string; performer: "O" | "M" }> = {
  outpatient: { templateId: "2.16.840.1.113883.3.3731.1.210.1", typeCode: "96345-4", classCode: "SUMMARIES", performer: "O" },
  discharge: { templateId: "2.16.840.1.113883.3.3731.1.210.2", typeCode: "18842-5", classCode: "SUMMARIES", performer: "O" },
  maternal: { templateId: "2.16.840.1.113883.3.3731.1.210.3", typeCode: "97702-5", classCode: "SUMMARIES", performer: "O" },
  newborn: { templateId: "2.16.840.1.113883.3.3731.1.210.4", typeCode: "78418-1", classCode: "SUMMARIES", performer: "O" },
  operative: { templateId: "2.16.840.1.113883.3.3731.1.210.5", typeCode: "11504-8", classCode: "REPORT", performer: "M" },
};

/** Required (usage R) sections per document: [nphies section number, name]. From the CDA Body tables 23 to 27. */
const DISCHARGE_R: [number, string][] = [
  [1, "Chief Complaint"], [17, "Hospital Admission Diagnosis"], [8, "Allergies and Adverse Reactions"], [3, "Active Problems"], [16, "Admission Medications History"],
  [18, "Medications Administered"], [10, "Vital Signs"], [19, "Hospital Discharge Medications"], [13, "Care Plan"], [20, "Discharge Diagnosis"], [22, "Discharge Disposition"],
];
const REQUIRED: Record<DocType, [number, string][]> = {
  outpatient: [[1, "Chief Complaint"], [2, "Reason for Referral"], [8, "Allergies and Adverse Reactions"], [13, "Care Plan"]],
  discharge: DISCHARGE_R,
  maternal: [...DISCHARGE_R, [23, "Pregnancy History"], [24, "Labor and Delivery Events"], [25, "Delivery Event Outcome"], [26, "Newborn Status at Maternal Discharge"]],
  newborn: [...DISCHARGE_R, [23, "Pregnancy History"], [24, "Labor and Delivery Events"], [25, "Delivery Event Outcome"], [27, "Newborn Screening Coded Results"], [26, "Newborn Status at Maternal Discharge"]],
  operative: [
    [28, "Preoperative Diagnosis"], [33, "Operative Note Surgical Procedure"], [39, "Procedure Findings"], [40, "Procedure Description"], [3, "Active Problems"],
    [42, "History of Blood Transfusion"], [31, "Acuity Assessment"], [30, "Postoperative Diagnosis"], [32, "Planned Procedure"], [41, "Procedure Disposition"],
  ],
};
/** Sections whose page asks for a coded entry: [section number, entry template number, name]. */
const MED_SECTIONS: [number, string][] = [[5, "Medications"], [16, "Admission Medications History"], [18, "Medications Administered"], [19, "Hospital Discharge Medications"]];
const DX_SECTIONS: [number, string][] = [[3, "Active Problems"], [17, "Hospital Admission Diagnosis"], [20, "Discharge Diagnosis"], [28, "Preoperative Diagnosis"], [29, "Postprocedure Diagnosis"], [30, "Postoperative Diagnosis"]];

const has = (xml: string, re: RegExp) => re.test(xml);
const dots = (s: string) => s.replace(/\./g, "\\.");
const count = (xml: string, needle: string) => xml.split(needle).length - 1;

/** The XML of one section, found by its nphies template id. "" when the section is not in the document. */
function sectionXml(xml: string, n: number): string {
  const start = xml.indexOf(`<templateId root="${SEC}${n}"/>`);
  if (start < 0) return "";
  const end = xml.indexOf("</section>", start);
  return xml.slice(start, end < 0 ? undefined : end);
}
const entryTid = (n: number) => `<templateId root="${SEC}${n}"/>`;

export function validateDoc(b: BuiltDoc): Check[] {
  const out: Check[] = [];
  const err = (text: string) => out.push({ level: "error", text });
  const warn = (text: string) => out.push({ level: "warn", text });
  const ok = (text: string) => out.push({ level: "ok", text });
  const spec = DOC[b.type];
  const x = b.xml;

  /* exceptions first */
  if (b.facts.died) err("The patient died (discharge disposition Died). Nothing is published to nphies for a patient death. Death reporting is a separate process. (Seha step 4.2.7)");
  if (b.type === "newborn" && b.facts.stillbirth) err("A stillbirth was recorded, so no Newborn Discharge Summary is created. Send only the Maternal Discharge Summary. (Seha step 4.3.15)");

  /* XML */
  const wf = wellFormed(x);
  if (wf) err(`The XML is not well formed. ${wf}.`);
  else ok("The XML is well formed.");

  /* CDA header: Clinical Document General (page 15925510) */
  if (!has(x, /<realmCode code="SA"\/>/)) err('realmCode must be present with code "SA".');
  if (!has(x, new RegExp(`<templateId root="${dots(spec.templateId)}"/>`))) err(`The document templateId must be ${spec.templateId}.`);
  if (!has(x, /<id root="[\d.]+" extension="[^"]+"\/>/)) err("ClinicalDocument/id needs a root OID and an extension.");
  if (!has(x, new RegExp(`<code code="${spec.typeCode}" codeSystem="${dots(OID_LOINC)}"`))) err(`The document type code must be LOINC ${spec.typeCode}.`);
  if (!has(x, /<nphies:documentStatus code="(final|amended|preliminary|registered|partial|corrected|appended|cancelled|entered-in-error|unknown)"[^>]*\/>/)) err("nphies:documentStatus is missing or not from the DiagnosticReport status value set.");
  else if (!has(x, /<nphies:documentStatus code="[^"]+" codeSystem="2\.16\.840\.1\.113883\.4\.642\.4\.236"/)) warn("nphies:documentStatus should carry codeSystem 2.16.840.1.113883.4.642.4.236, as in the official sample.");
  if (!has(x, /<effectiveTime value="\d{14}[+-]\d{4}"\/>/)) err("effectiveTime must have date, time and a time zone offset (CCYYMMDDhhmmss+ZZzz).");
  if (!has(x, /<confidentialityCode code="[^"]+" codeSystem="[\d.]+" displayName="[^"]+"/)) err("confidentialityCode needs code, codeSystem and displayName.");
  if (!has(x, /<languageCode code="[a-z]{2}-[A-Z]{2}"\/>/)) err("languageCode must follow BCP 47, for example en-US.");
  if (!has(x, /<setId root="[\d.]+" extension="[^"]+"\/>/)) err("setId is missing.");
  if (!has(x, /<versionNumber value="\d+"\/>/)) err("versionNumber is missing.");
  if (b.version > 1 && !has(x, /<relatedDocument typeCode="RPLC">/)) err("An amended version must carry relatedDocument RPLC that points to the document it replaces.");
  if (b.version === 1 && has(x, /<relatedDocument/)) warn("Version 1 should not replace another document.");

  /* Patient (page 15859939) */
  if (b.facts.newbornIdMissing) err("The baby needs its own Health ID (temporary or permanent) from the national Health ID service. Enter it on the Delivery Outcomes form. The app does not make one up.");
  else if (!has(x, new RegExp(`<id root="${dots(OID_HEALTH_ID)}" extension="\\d{6,}"/>`))) err(`The patient needs a Health ID with the NHIC OID ${OID_HEALTH_ID}.`);
  else ok("The patient has a Health ID.");
  if (!has(x, /<birthTime value="\d{8}/)) err("The patient birth date (birthTime) is required.");
  if (has(x, /<associatedEntity classCode="CIT">/) && !has(x, /<associatedEntity classCode="CIT">\s*<templateId root="2\.16\.840\.1\.113883\.3\.3731\.1\.203\.28\.2"\/>\s*<code code="[A-Z]{3}" codeSystem="1\.0\.3166\.1"\/>/)) err("Nationality must be a three-letter ISO 3166 code with code system 1.0.3166.1.");

  /* Author, legal authenticator, custodian, performer (pages 15859954, 15958267, 15892888, 15958291) */
  const author = /<author>([\s\S]*?)<\/author>/.exec(x)?.[1] ?? "";
  if (!has(author, new RegExp(`<assignedAuthor>\\s*<id root="${dots(OID_PROVIDER)}" extension="[^"]+"/>`)) || !has(author, /<assignedPerson>/)) err(`The author needs a National Provider ID (OID ${OID_PROVIDER}). The author must be a person.`);
  else ok("The author is a person with a provider ID.");
  if (!has(author, /<functionCode code="[^"]+" codeSystem="[\d.]+"[^>]* displayName="[^"]+"/)) err("The author functionCode needs code, codeSystem and displayName (KSA Individual Provider Type).");
  if (author.indexOf("<telecom") >= 0 && author.indexOf("<telecom") < author.indexOf("<addr")) err("In assignedAuthor the address must come before the telecom (CDA schema order).");
  if (!has(author, new RegExp(`<representedOrganization>\\s*<id root="${dots(OID_ORG)}" extension="[^"]+"/>`))) err(`The author organization needs an id with OID ${OID_ORG}.`);
  const legal = /<legalAuthenticator>([\s\S]*?)<\/legalAuthenticator>/.exec(x)?.[1] ?? "";
  if (!has(legal, /<signatureCode code="S"\/>/)) err("A legal authenticator with signatureCode S is required for this document type.");
  else ok("A legal authenticator is present.");
  if (legal && !has(legal, /<name use="L">/)) err('The legal authenticator name must be marked as the legal name (use="L").');
  if (legal.indexOf("<telecom") >= 0 && legal.indexOf("<telecom") < legal.indexOf("<addr")) err("In the legal authenticator the address must come before the telecom (CDA schema order).");
  if (!has(x, new RegExp(`<representedCustodianOrganization>\\s*<templateId root="2\\.16\\.840\\.1\\.113883\\.3\\.3731\\.1\\.203\\.28\\.4"/>\\s*<id root="${dots(OID_ORG)}" extension="[^"]+"/>`))) err("The custodian organisation with its provider directory id is required.");
  const perf = /<performer typeCode="PRF">([\s\S]*?)<\/performer>/.exec(x)?.[1];
  if (perf === undefined) (spec.performer === "M" ? err : warn)("A performer (the person who provided care) is expected.");
  else if (!has(perf, /<templateId root="2\.16\.840\.1\.113883\.3\.3731\.1\.203\.28\.7"\/>\s*<time value="\d{14}[+-]\d{4}"\/>/) || !has(perf, /<addr/) || !has(perf, /<telecom/)) err("The performer needs templateId 2.16.840.1.113883.3.3731.1.203.28.7, a time, an address and a telecom.");
  for (const a of x.match(/<addr>[\s\S]*?<\/addr>/g) ?? []) {
    if (!a.includes("<city") || !a.includes("<postalCode")) { err("Every address needs a city and a postal code (nullFlavor UNK when not known)."); break; }
  }

  /* Encounter (page 15925336 row 7, page 15892943) */
  if (b.type === "operative") {
    if (b.facts.operationTimesMissing) err("Record when the operation started and ended on the Operation Request form. The Operative Note sends these as the encounter start and end.");
    else ok("The operation start and end times are sent as the encounter times.");
  } else {
    if (!b.facts.hasEncounterStart) err("The encounter start date and time is required.");
    if (!b.facts.hasEncounterEnd) {
      err(b.type === "outpatient" ? "The encounter must be finished before the summary is sent. Add the end time (discharge the visit)." : "The encounter end or discharge time is required. Discharge the visit first.");
    }
  }
  if (!has(x, new RegExp(`<healthCareFacility>\\s*<id root="${dots(OID_ORG)}" extension="[^"]+"/>`))) err("The encounter facility needs its provider directory id.");

  /* Clinical content */
  if (b.facts.dxCount === 0) err(b.type === "operative" ? "At least one diagnosis is required. The preoperative and postoperative diagnosis are sent as coded entries." : "At least one diagnosis is required (principal diagnosis).");
  if (b.type === "operative" && b.facts.procCount === 0) err("At least one procedure is required. One operative note is created for each surgery.");
  const dxCodes = [...x.matchAll(/<value xsi:type="CD" code="([^"]+)" codeSystem="([\d.]+)" codeSystemName="ICD[^"]*"/g)];
  if (dxCodes.some((m) => m[2] !== OID_ICD10AM)) err(`Diagnosis codes must use the ICD-10-AM code system ${OID_ICD10AM}.`);
  const bad = dxCodes.map((m) => m[1]).filter((c) => !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(c));
  if (bad.length) warn(`Diagnosis code format looks wrong: ${[...new Set(bad)].join(", ")}.`);
  if (has(x, /<act classCode="ACT" moodCode="EVN">(?:\s*<templateId[^>]*\/>)+\s*<id root=/)) err("A problem or allergy concern act must carry <id nullFlavor=\"NI\"/>.");

  /* Sections (CDA Body tables 23 to 27), matched by template id */
  for (const [n, name] of REQUIRED[b.type]) {
    if (!sectionXml(x, n)) err(`${name} section is missing from the XML.`);
  }
  let missing = 0;
  for (const s of b.sections) {
    if (s.usage === "R" && !s.hasData) {
      missing++;
      warn(`${s.title} is required but the chart has no data for it. "No information available" is sent.`);
    }
  }
  const filled = b.sections.filter((s) => s.hasData).length;
  ok(`${filled} of ${b.sections.length} sections have data. ${missing} required ${missing === 1 ? "section is" : "sections are"} empty.`);

  /* Entries the section pages ask for */
  const vit = sectionXml(x, 10);
  if (vit && !vit.includes(entryTid(54))) {
    // Vital Signs Organizer Entry is mandatory in the section (page 15860200), and the section is required in the discharge summaries.
    err("Vital signs are required. Record the vital signs in the chart, so the section can carry its coded entry.");
  }
  for (const [n, name] of DX_SECTIONS) {
    const sx = sectionXml(x, n);
    if (sx && b.facts.dxCount > 0 && !sx.includes(entryTid(43))) err(`${name} needs at least one coded diagnosis (Problem Concern Entry).`);
  }
  for (const [n, name] of MED_SECTIONS) {
    const sx = sectionXml(x, n);
    if (sx && sx.includes("<table>") && !sx.includes(entryTid(45))) err(`${name} lists medicines but has no Medications Entry.`);
  }
  if (b.type === "maternal" || b.type === "newborn") {
    const del = sectionXml(x, 25);
    if (del && (count(del, entryTid(60)) !== 1 || count(del, entryTid(61)) !== 1)) err("Delivery Event Outcome needs exactly one live birth entry and one stillbirth entry. Record the delivery on the Delivery Outcomes form.");
    const lab = sectionXml(x, 24);
    if (lab && count(lab, entryTid(59)) !== 1) err("Labor and Delivery Events needs exactly one entry for the mode of delivery. Record it on the Delivery Outcomes form.");
    const preg = sectionXml(x, 23);
    if (preg && !preg.includes(entryTid(58))) err("Pregnancy History needs at least one pregnancy observation. Record the delivery on the Delivery Outcomes form.");
    const nb = sectionXml(x, 26);
    if (nb) {
      const apgar = count(nb, entryTid(63));
      const ga = count(nb, entryTid(62));
      const msg = "Newborn Status needs the gestational age and all three Apgar scores (1, 5 and 10 minutes). Add them on the Delivery Outcomes form.";
      // A stillborn baby has no Apgar scores, so this is only a warning then.
      if (apgar !== 3 || ga !== 1) (b.facts.liveBirth ? err : warn)(msg);
    }
    for (const e of x.match(/<observation classCode="OBS" moodCode="EVN">\s*<templateId root="2\.16\.840\.1\.113883\.3\.3731\.1\.210\.100\.(?:58|60|61|62|63)"\/>[\s\S]*?<\/observation>/g) ?? []) {
      if (!has(e, /<effectiveTime value="\d{14}[+-]\d{4}"\/>/)) { err("Delivery, Apgar, gestational age and pregnancy observations need the date and time (effectiveTime)."); break; }
    }
  }
  const ids = new Set([...x.matchAll(/ ID="([^"]+)"/g)].map((m) => m[1]));
  const dangling = [...new Set([...x.matchAll(/<reference value="#([^"]+)"\/>/g)].map((m) => m[1]).filter((r) => !ids.has(r)))];
  if (dangling.length) err(`Coded entries point at text that is not in the section narrative: ${dangling.slice(0, 5).join(", ")}.`);
  else ok("Every coded entry points at its text in the section narrative.");

  const demoCodes = [...new Set([...x.matchAll(/code="(DEMO-[^"]+)"/g)].map((m) => m[1]))];

  /* Metadata (pages 15892543, 17596480, 17694733 and the official ITI-41 samples) */
  const m = b.metadata.documentEntry;
  const ss = b.metadata.submissionSet;
  if (!m.patientId.includes(`&${OID_HEALTH_ID}&ISO`)) err("Metadata patientId must be the Health ID with the NHIC OID.");
  if (m.hash.length !== 40) err("Metadata hash must be a SHA-1 value.");
  if (m.size <= 0) err("Metadata size must be greater than 0.");
  if (m.classCode.code !== spec.classCode || m.classCode.system !== "2.16.840.1.113883.3.3731.1.203.10") err(`Metadata classCode must be ${spec.classCode} with coding scheme 2.16.840.1.113883.3.3731.1.203.10.`);
  if (m.typeCode.code !== spec.typeCode || m.typeCode.system !== OID_LOINC) err(`Metadata typeCode must be LOINC ${spec.typeCode}.`);
  if (m.formatCode.code !== "urn:ihe:pcc:xds-ms:2007" || m.formatCode.system !== "1.3.6.1.4.1.19376.1.2.3") err("Metadata formatCode must be urn:ihe:pcc:xds-ms:2007 with coding scheme 1.3.6.1.4.1.19376.1.2.3.");
  if (m.mimeType !== "text/xml") err("Metadata mimeType must be text/xml.");
  if (m.confidentialityCode.system !== "2.16.840.1.113883.5.25" || !has(x, new RegExp(`<confidentialityCode code="${m.confidentialityCode.code}"`))) err("Metadata confidentialityCode must match the CDA confidentialityCode.");
  if (m.healthcareFacilityTypeCode.system !== "2.16.840.1.113883.3.3731.1.202.2") err("Metadata healthcareFacilityTypeCode must use coding scheme 2.16.840.1.113883.3.3731.1.202.2.");
  if (m.practiceSettingCode.system !== "2.16.840.1.113883.3.3731.1.202.6") err("Metadata practiceSettingCode must use coding scheme 2.16.840.1.113883.3.3731.1.202.6.");
  if (ss.contentTypeCode.system !== "2.16.840.1.113883.3.3731.1.203.16") err("Submission set contentTypeCode must use coding scheme 2.16.840.1.113883.3.3731.1.203.16.");
  if (!/^2\.16\.840\.1\.113883\.3\.3731\.[\d.]+$/.test(ss.sourceId)) err("Submission set sourceId must be the National Organization OID (2.16.840.1.113883.3.3731.XXXX).");
  if (!m.referenceIdList[0]?.endsWith("urn:ksa-ehealth:document:setId:2023")) err("The first referenceIdList entry must be the CDA setId with urn:ksa-ehealth:document:setId:2023.");
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(m.entryUUID)) err("Metadata entryUUID must be a urn:uuid value.");
  const as = b.metadata.association;
  if (as && (!/^urn:uuid:/.test(as.source) || !/^urn:uuid:/.test(as.target))) err("The replace association must link the entryUUIDs of the new and the old document entry.");
  if (as && as.target === as.source) err("A document cannot replace itself.");
  if (as && as.source !== m.entryUUID) err("The replace association must start at this document's entryUUID.");
  ok("Metadata has the required attributes. serviceStartTime and serviceStopTime are not sent, as the type table says.");

  const metaDemo = [m.healthcareFacilityTypeCode.code, m.practiceSettingCode.code, ss.contentTypeCode.code, m.classCode.code].filter((c) => c.startsWith("DEMO-"));
  const allDemo = [...demoCodes, ...metaDemo];
  if (allDemo.length) warn(`${allDemo.length} demo ${allDemo.length === 1 ? "code is" : "codes are"} used (${allDemo.slice(0, 5).join(", ")}${allDemo.length > 5 ? ", and more" : ""}). Replace them with IS0200 values before a real submission.`);

  return out;
}

export const errorsOf = (c: Check[]) => c.filter((x) => x.level === "error");
