/**
 * Validators for the radiology order and radiology report (structured) bundles.
 *
 * The fixed values below are copied from the NPHIES guide (Confluence page ids in the comments), not from the builder,
 * so a wrong constant in rad-bundles.ts or rad-catalog.ts is caught here.
 */

import type { Check } from "../model";
import { OID } from "../reference-data";
import {
  EXT, FHIR_DATETIME_TZ, PROFILE, byType, findByRef, firstIdentifier, need, oidSystem, validateBundleBase, walkReferences, warn, type Json,
} from "./common";
import { additionalInfoChecks, compositionOf, versionOf, type MinStep, type ValidateCtx } from "./lab-validate";

/* ---------- fixed values from the guide ---------- */

const LOINC = "http://loinc.org";
/** Composition and DiagnosticReport status (page ids 391020558, 414547978, 414744577). */
const GUIDE_DOC_STATUSES = ["final", "amended", "corrected", "cancelled", "entered-in-error"];
/** ServiceRequest.priority (page id 391020567). */
const GUIDE_PRIORITIES = ["routine", "urgent", "asap", "stat"];
/** Encounter.class codes (page id 414875649). */
const GUIDE_ENCOUNTER_CLASSES = ["E", "I", "O", "D"];
const GUIDE_PATIENT_CLASS_SYSTEM = "urn:oid:2.16.840.1.113883.18.5";

/** Composition.title of a radiology report: one of twelve (page id 414547978). */
export const GUIDE_REPORT_TITLES = [
  "CT Report", "MR Report", "Nuclear Medicine Report", "PET Scan Report", "Ultrasound Report", "Obstetric Ultrasound Report",
  "X-Ray Report", "Fluoroscopy Study Report", "Mammography Screening Report", "Mammography Diagnostic Report",
  "Bone Density Report", "Interventional Radiology Report",
];

/** KSA Body Regions value set: 11 SNOMED CT codes (page id 39846061). */
export const GUIDE_BODY_REGION_CODES = [
  "69536005", "45048000", "51185008", "76752008", "113257007", "113345001", "12921003", "280717001", "53120007", "61685007", "243928005",
];
const GUIDE_BODY_REGION_SYSTEM = "urn:oid:2.16.840.1.113883.6.96";

/** Modalities value set (page id 39780455), code system 1.2.840.10008.2.16.4. */
export const GUIDE_MODALITY_CODES = [
  "ANN", "AR", "ARCHIVE", "AS", "ASMT", "AU", "BDUS", "BI", "BMD", "CAD", "CAPTURE", "CD", "CF", "COMP", "CP", "CR", "CS", "CT", "CTPROTOCOL",
  "DD", "DF", "DG", "DM", "DMS", "DOC", "DOCD", "DS", "DSS", "DX", "EC", "ECG", "EEG", "EMG", "EOG", "EPS", "ES", "FA", "FID", "FILMD", "FS",
  "GM", "H", "HC", "HD", "IO", "IOL", "IVOCT", "IVUS", "KER", "KO", "LEN", "LOG", "LP", "LS", "M3D", "MA", "MCD", "MEDIM", "MG", "MR", "MS",
  "NEARLINE", "NM", "OAM", "OCT", "OFFLINE", "ONLINE", "OP", "OPM", "OPR", "OPT", "OPTBSV", "OPTENF", "OPV", "OSS", "OT", "PLAN", "POS", "PR",
  "PRINT", "PT", "PX", "REG", "RESP", "RF", "RG", "RT", "RTDOSE", "RTIMAGE", "RTPLAN", "RTRECORD", "RTSTRUCT", "RWV", "SEG", "SM", "SMR", "SR",
  "SRF", "ST", "STAIN", "TEXTUREMAP", "TG", "UNAVAILABLE", "US", "VA", "VF", "VIDD", "WSD", "XA", "XC",
];
const GUIDE_MODALITY_SYSTEM = "urn:oid:1.2.840.10008.2.16.4";

/**
 * An extract of the KSA Imaging Procedure value set (CS-Rad-Procedure v2.0, page id 23168870, 5,514 codes).
 * Each code here was looked up in the workbook. The full list is too large to ship, so a code outside this extract
 * is reported as "not checked" and must be looked up in the workbook before it is added to the catalogue.
 */
export const GUIDE_IMAGING_PROCEDURE_EXTRACT = [
  "XCHES-PA", "XCHES", "XABDO", "X-LSJ", "XKNER", "XKNEL", "XKNEB", "XFIRL",
  "CSKUH", "CCHES", "CABPEC", "CABPE", "CAPLVC",
  "MSKUH", "MSKUHC", "MLUSP", "MLUSPC",
  "UABDO", "UABPE", "UPELV", "UPETV",
  "XMAMB", "XSCMB", "XBDXW", "XDEXA",
];
/** Code system the official order sample sends for the procedure code (page id 387481602). */
const GUIDE_IMAGING_PROCEDURE_SYSTEM = "urn:oid:2.16.840.1.113883.3.3731.1.204.15";

/** Section code, code display and title, each from its own page. */
const S = {
  order: { code: "57832-8", display: "Prescription for diagnostic or specialist care", title: "Radiology Order Section" }, // 391020558
  indication: { code: "59768-2", display: "Procedure Indications", title: "Procedure Indications" }, // 390627332
  clinical: { code: "55752-0", display: "Clinical Information", title: "Clinical Information" }, // 390299687, 413990915
  imagingStudy: { code: "18726-0", display: "Radiology studies (set)", title: "Imaging Study" }, // 415006721
  procedures: { code: "55111-9", display: "Current Imaging Procedure Descriptions", title: "Procedures" }, // 415039489
  radiation: { code: "73569-6", display: "Radiation Exposure and Protection Information", title: "Radiation Exposure and Protection Information" }, // 415137793
  comparison: { code: "18834-2", display: "Comparison / Previous Findings", title: "Comparison / Previous Findings" }, // 415039498
  findings: { code: "59776-5", display: "Procedure findings", title: "Procedure findings" }, // 414449674
  impression: { code: "19005-8", display: "Impressions", title: "Impressions" }, // 414253059
  communication: { code: "73568-8", display: "Communication of Critical Results", title: "Communication" }, // 414613515
  keyImages: { code: "55113-5", display: "Key Images", title: "Key Images" }, // 413892621
  addendum: { code: "55107-7", display: "Addendum", title: "Addendum" }, // 414646295
} as const;
type GuideSection = { code: string; display: string; title: string };

/** Units of Additional Order Information quantities (page ids 23169515, 24313997, 23234332). */
const GUIDE_UNIT_SYSTEM = "urn:oid:2.16.840.1.113883.6.8";
const GUIDE_UNITS: Record<string, string[]> = { "424144002": ["d", "wk", "mo", "a"], "50373000": ["m", "cm"], "363808001": ["g", "kg"] };

/* ---------- helpers ---------- */

const sectionCode = (s: Json): string | undefined => s.code?.coding?.[0]?.code;
const allSections = (list: Json[]): Json[] => list.flatMap((s) => [s, ...allSections((s.section ?? []) as Json[])]);
const findSection = (list: Json[], code: string) => list.find((s) => sectionCode(s) === code);
const firstCoding = (cc: Json | undefined): Json | undefined => (Array.isArray(cc) ? cc[0] : cc)?.coding?.[0];

/** Tags the portal does not accept in a section narrative (rule on every section page, for example 390627332). */
const BAD_NARRATIVE = /<\/?(div|p|b|i|u|br|span|ul|ol|li|h[1-6])\b|xmlns/i;

/** Every section, at any depth: known code with the fixed display and title, and a narrative in the portal form. */
function sectionFormChecks(sections: Json[], allowed: GuideSection[], c: Check[]) {
  const all = allSections(sections);
  const byCode = new Map(allowed.map((g) => [g.code, g]));
  const unknown = all.filter((s) => !byCode.has(sectionCode(s) ?? "") || s.code?.coding?.[0]?.system !== LOINC);
  need(c, unknown.length === 0, "Every section uses a LOINC code the guide defines.", `Section code(s) not defined by the guide: ${unknown.map((s) => sectionCode(s) ?? "none").join(", ")}.`);
  const wrongText = all.filter((s) => {
    const g = byCode.get(sectionCode(s) ?? "");
    return g && (s.title !== g.title || s.code?.coding?.[0]?.display !== g.display);
  });
  need(
    c,
    wrongText.length === 0,
    "Every section has the title and code display the guide fixes.",
    `Section title or display differs from the guide: ${wrongText.map((s) => `${sectionCode(s)} must be titled "${byCode.get(sectionCode(s)!)!.title}" with display "${byCode.get(sectionCode(s)!)!.display}"`).join("; ")}.`,
  );
  const badText = all.filter((s) => typeof s.text?.div !== "string" || !s.text.div.trim() || BAD_NARRATIVE.test(s.text.div));
  need(
    c,
    badText.length === 0,
    "Every section narrative uses portal tags only (no <div>, no XHTML).",
    `Section narrative must use portal tags such as <paragraph>, with no <div> wrapper, XHTML tags or xmlns: ${badText.map((s) => sectionCode(s) ?? "none").join(", ")}.`,
  );
}

/** Composition rows shared by the order and the report. The title rule differs, so the caller passes it. */
function compositionChecks(comp: Json | undefined, c: Check[], o: { typeCode: string; typeDisplay: string; titleOk: (t: unknown) => boolean; titleRule: string }) {
  if (!comp) {
    c.push({ level: "error", text: "There is no Composition." });
    return;
  }
  const ver = (comp.extension ?? []).find((e: Json) => e.url === EXT.versionNumber);
  need(c, !!ver?.valueString, `Composition version number is ${ver?.valueString}.`, "Composition needs the versionNumber extension.");
  need(c, comp.identifier?.system?.startsWith("urn:oid:") && comp.identifier?.value, `Composition set identifier is ${comp.identifier?.value}.`, "Composition.identifier needs the root OID and a value (the id shared by all versions).");
  need(c, GUIDE_DOC_STATUSES.includes(comp.status), `Composition.status is ${comp.status}.`, `Composition.status must be one of ${GUIDE_DOC_STATUSES.join(", ")}.`);
  const type = comp.type?.coding?.[0];
  need(c, type?.code === o.typeCode && type?.system === LOINC && type?.display === o.typeDisplay, `Composition.type is LOINC ${o.typeCode} (${o.typeDisplay}).`, `Composition.type must be LOINC ${o.typeCode} with display "${o.typeDisplay}".`);
  need(c, /^Patient\//.test(comp.subject?.reference ?? "") && !!comp.subject?.identifier, "Composition.subject points at the Patient with its identifier.", "Composition.subject needs the Patient reference and identifier.");
  need(c, FHIR_DATETIME_TZ.test(comp.date ?? ""), "Composition.date has a time zone.", "Composition.date needs date, time and time zone (+03:00).");
  need(c, o.titleOk(comp.title), `Composition.title is "${comp.title}".`, `Composition.title is "${comp.title ?? ""}". ${o.titleRule}`);
  need(c, ["N", "R"].includes(comp.confidentiality), `Composition.confidentiality is ${comp.confidentiality}.`, "Composition.confidentiality must be N or R (KSA Confidentiality Code).");
  need(c, /^Organization\//.test(comp.custodian?.reference ?? ""), "Composition.custodian is the Organization.", "Composition.custodian must reference the Organization.");
  need(c, !!comp.encounter?.reference, "Composition.encounter links the visit.", "Composition.encounter is missing. It is optional, but it carries the visit number.", "warn");
}

function identifierOk(sr: Json, second: "ACSN" | null): boolean {
  const has = (t: string) => (sr.identifier ?? []).some((i: Json) => i.type?.coding?.some((x: Json) => x.code === t) && i.system?.startsWith("urn:oid:") && i.value);
  return has("PLAC") && (!second || has(second));
}

/** Imaging procedure code: system from the official sample, code looked up in the value set extract. */
function procedureCodeChecks(cc: Json | undefined, where: string, c: Check[]) {
  const pc = firstCoding(cc);
  if (!need(c, !!pc?.code, `${where} carries imaging procedure code ${pc?.code}.`, `${where} (imaging procedure) is required.`)) return;
  need(c, pc?.system === GUIDE_IMAGING_PROCEDURE_SYSTEM, `${where} uses the KSA Imaging Procedure code system.`, `${where} system must be ${GUIDE_IMAGING_PROCEDURE_SYSTEM}.`);
  need(
    c,
    GUIDE_IMAGING_PROCEDURE_EXTRACT.includes(pc?.code),
    `${pc?.code} is in the KSA Imaging Procedure value set.`,
    `${pc?.code} is not in the checked extract of the KSA Imaging Procedure value set. Look it up in CS-Rad-Procedure before sending.`,
  );
}

function bodySiteChecks(cc: Json | undefined, where: string, c: Check[]) {
  const bs = firstCoding(cc);
  need(
    c,
    GUIDE_BODY_REGION_CODES.includes(bs?.code) && bs?.system === GUIDE_BODY_REGION_SYSTEM,
    `${where} is a KSA Body Region (${bs?.code}).`,
    `${where} must carry one of the 11 KSA Body Region codes with system ${GUIDE_BODY_REGION_SYSTEM}${bs?.code ? `, found ${bs.code}` : ""}.`,
  );
}

/** ServiceRequest rows for radiology: modality and body region are mandatory. */
function radServiceRequestChecks(sr: Json | undefined, c: Check[], status: "active" | "completed") {
  need(c, !!sr, "One ServiceRequest (the imaging procedure).", "Exactly one ServiceRequest is required.");
  if (!sr) return;
  need(c, (sr.meta?.profile ?? []).includes(PROFILE.serviceRequest), "ServiceRequest profile is servicerequest.", "ServiceRequest profile is wrong.");
  need(c, identifierOk(sr, status === "completed" ? "ACSN" : null), status === "completed" ? "Placer (PLAC) and accession (ACSN) numbers are present." : "Placer order number (PLAC) is present.", status === "completed" ? "ServiceRequest needs PLAC and ACSN identifiers with root OIDs." : "ServiceRequest needs a PLAC identifier with the root OID.");
  if (status === "active") need(c, !(sr.identifier ?? []).some((i: Json) => i.type?.coding?.some((x: Json) => x.code === "ACSN" || x.code === "FILL")), "No filler or accession number in the order.", "An order must not carry a filler or accession number.");
  need(c, sr.status === status, `ServiceRequest.status is ${status}.`, `ServiceRequest.status must be ${status}.`);
  need(c, sr.intent === "order", "ServiceRequest.intent is order.", "ServiceRequest.intent must be order.");
  need(c, GUIDE_PRIORITIES.includes(sr.priority), `Priority is ${sr.priority}.`, "ServiceRequest.priority must be routine, urgent, asap or stat.");
  procedureCodeChecks(sr.code, "ServiceRequest.code", c);
  const mod = firstCoding(sr.orderDetail);
  need(
    c,
    GUIDE_MODALITY_CODES.includes(mod?.code) && mod?.system === GUIDE_MODALITY_SYSTEM,
    `Modality ${mod?.code} is in orderDetail.`,
    `ServiceRequest.orderDetail must carry a code from the Modalities value set with system ${GUIDE_MODALITY_SYSTEM}.`,
  );
  bodySiteChecks(sr.bodySite, "ServiceRequest.bodySite", c);
  need(c, !!sr.occurrencePeriod?.start && !!sr.occurrencePeriod?.end, "ServiceRequest.occurrencePeriod is present.", "ServiceRequest.occurrencePeriod is required.");
  need(c, /^Patient\//.test(sr.subject?.reference ?? ""), "ServiceRequest.subject is the Patient.", "ServiceRequest.subject must reference the Patient.");
}

/** Patient, Practitioner, PractitionerRole, Organization and Encounter rows as the radiology pages and samples have them. */
function radParticipantChecks(b: Json, c: Check[], o: { minRoles: number; visitNumber?: string; healthId?: string }) {
  const patients = byType(b, "Patient");
  need(c, patients.length === 1, "One Patient resource.", `Exactly one Patient is required, found ${patients.length}.`);
  const pid = firstIdentifier(patients[0] ?? {});
  need(c, pid?.system === oidSystem(OID.healthId) && !!pid?.value, "Patient.identifier is the Health ID with the NHIC OID.", `Patient.identifier must be the Health ID with system ${oidSystem(OID.healthId)}.`);
  if (o.healthId) need(c, pid?.value === o.healthId, "Patient Health ID matches the chart.", "Patient Health ID differs from the chart.");

  const roles = byType(b, "PractitionerRole");
  const pracs = byType(b, "Practitioner");
  need(c, roles.length >= o.minRoles, `${roles.length} PractitionerRole resources.`, `At least ${o.minRoles} PractitionerRole resources are required, found ${roles.length}.`);
  need(c, pracs.length >= o.minRoles, `${pracs.length} Practitioner resources.`, `At least ${o.minRoles} Practitioner resources are required, found ${pracs.length}.`);
  need(
    c,
    pracs.every((p) => firstIdentifier(p)?.system === oidSystem(OID.provider) && firstIdentifier(p)?.value),
    "Every Practitioner has a provider id with the provider OID.",
    `Practitioner.identifier needs system ${oidSystem(OID.provider)} and a value.`,
  );
  need(c, pracs.every((p) => (p.name ?? []).length > 0), "Every Practitioner has a name.", "Practitioner.name is missing. The pages linked from the radiology guide make it mandatory.", "warn");
  need(c, roles.every((r) => r.practitioner?.reference && r.organization?.reference), "Every PractitionerRole links a Practitioner and an Organization.", "PractitionerRole needs practitioner and organization.");
  need(c, roles.every((r) => !("identifier" in r)), "PractitionerRole has no identifier of its own.", "PractitionerRole must not carry an identifier. References to it repeat the practitioner's provider id.");

  const orgs = byType(b, "Organization");
  need(c, orgs.length >= 1, `${orgs.length} Organization resource.`, "At least one Organization is required.");
  need(
    c,
    orgs.every((g) => firstIdentifier(g)?.system === oidSystem(OID.nphiesApp) && firstIdentifier(g)?.value),
    "Organization.identifier uses the provider-directory OID.",
    `Organization.identifier needs system ${oidSystem(OID.nphiesApp)} and a value.`,
  );

  const encs = byType(b, "Encounter");
  if (!encs.length) {
    c.push(warn("No Encounter in the bundle. It is optional if known, but the visit number links the document to ADT."));
    return;
  }
  const e = encs[0];
  const vis = firstIdentifier(e)?.value;
  if (o.visitNumber) need(c, vis === o.visitNumber, `Encounter carries the visit number ${o.visitNumber}.`, `Encounter.identifier is ${vis ?? "empty"}, expected the chart visit number ${o.visitNumber}.`);
  else need(c, !!vis, "Encounter has a visit number.", "Encounter.identifier is empty.");
  const cls = e.class?.code ?? e.class?.coding?.[0]?.code;
  const clsSystem = e.class?.system ?? e.class?.coding?.[0]?.system;
  need(
    c,
    clsSystem === GUIDE_PATIENT_CLASS_SYSTEM && GUIDE_ENCOUNTER_CLASSES.includes(cls),
    `Encounter.class is ${cls}.`,
    `Encounter.class must be E, I, O or D with system ${GUIDE_PATIENT_CLASS_SYSTEM}, found ${cls ?? "none"}.`,
  );
  need(c, !!e.period?.start, "Encounter.period.start is present.", "Encounter.period.start is required.");
  need(c, !!e.serviceProvider?.display, "Encounter.serviceProvider.display is present.", "Encounter.serviceProvider.display is required.");
}

const sameIdentifier = (a?: Json, b?: Json) => !!a && !!b && a.system === b.system && a.value === b.value;

/**
 * Every reference resolves inside the bundle and repeats the identifier of its target.
 * A reference to a PractitionerRole repeats the practitioner's provider id, as the official samples do.
 */
function radReferenceChecks(b: Json, c: Check[]) {
  const missing: string[] = [];
  const mismatched: string[] = [];
  let count = 0;
  walkReferences(b, (ref, path) => {
    if (!path.startsWith("$.entry[")) return;
    count++;
    const target = findByRef(b, ref.reference);
    if (!target) {
      missing.push(`${ref.reference} (${path})`);
      return;
    }
    if (target.resourceType === "PractitionerRole") {
      const prac = findByRef(b, target.practitioner?.reference);
      if (!sameIdentifier(ref.identifier, firstIdentifier(prac ?? {}))) mismatched.push(`${ref.reference} (${path})`);
    } else if (ref.identifier && !sameIdentifier(ref.identifier, firstIdentifier(target))) mismatched.push(`${ref.reference} (${path})`);
  });
  need(c, missing.length === 0, `All ${count} references resolve inside the bundle.`, `References not found in the bundle: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}.`);
  need(
    c,
    mismatched.length === 0,
    "Every reference/identifier matches its target (the practitioner's provider id for a PractitionerRole).",
    `reference/identifier differs from the target identifier: ${mismatched.slice(0, 3).join(", ")}.`,
  );
}

/** Units of the Additional Order Information quantities, and the code display of each observation. */
function radAdditionalInfoChecks(b: Json, c: Check[]) {
  additionalInfoChecks(b, c);
  const bad: string[] = [];
  for (const o of byType(b, "Observation")) {
    const code = o.code?.coding?.[0]?.code as string;
    const units = GUIDE_UNITS[code];
    if (units && (o.valueQuantity?.system !== GUIDE_UNIT_SYSTEM || !units.includes(o.valueQuantity?.code))) bad.push(`${code} needs unit code ${units.join(" / ")} with system ${GUIDE_UNIT_SYSTEM}`);
  }
  need(c, bad.length === 0, "Additional Order Information units come from the KSA unit value sets.", `Additional Order Information units: ${bad.join("; ")}.`);
}

/* ---------- order ---------- */

export function validateRadOrderBundle(b: Json, ctx: ValidateCtx = {}): Check[] {
  const c: Check[] = [];
  c.push(...validateBundleBase(b, { profile: PROFILE.bundleRadOrder, label: "Radiology Order", compositionProfile: PROFILE.compositionRadOrder }));
  const comp = compositionOf(b);
  compositionChecks(comp, c, {
    typeCode: S.order.code, typeDisplay: S.order.display,
    titleOk: (t) => t === "Radiology Order", titleRule: 'It must be "Radiology Order".',
  });
  need(c, (comp?.author ?? []).length === 1 && /^PractitionerRole\//.test(comp?.author?.[0]?.reference ?? ""), "Composition.author is one PractitionerRole.", "Composition.author must be exactly one PractitionerRole.");

  const sections = (comp?.section ?? []) as Json[];
  need(c, sections.length === 1, "Exactly one Radiology Order Section.", `Exactly one section is required, found ${sections.length}.`);
  const s = sections[0];
  if (s) {
    need(c, sectionCode(s) === S.order.code && s.code?.coding?.[0]?.system === LOINC, "Section code is LOINC 57832-8.", "Section code must be LOINC 57832-8.");
    const srRefs = (s.entry ?? []).filter((e: Json) => /^ServiceRequest\//.test(e.reference ?? ""));
    need(c, srRefs.length >= 1, "Section lists the ServiceRequest.", "Section.entry must reference the ServiceRequest.");
    need(c, (s.entry ?? []).every((e: Json) => !!findByRef(b, e.reference)), "Every section entry resolves.", "A section entry points at a missing resource.");
    const subs = (s.section ?? []) as Json[];
    // NPHIES rejects "Radiology Order - Sub-Section Procedure Indications missing" (Error Handling Guide 1.1.7).
    need(c, !!findSection(subs, S.indication.code), "Procedure Indications sub-section is present.", "The Procedure Indications sub-section (LOINC 59768-2) is missing. Enter the reason for the exam.");
    sectionFormChecks(sections, [S.order, S.indication, S.clinical], c);
  }

  const srs = byType(b, "ServiceRequest");
  need(c, srs.length === 1, "Exactly one ServiceRequest in the bundle.", `A radiology order bundle holds exactly one ServiceRequest, found ${srs.length}.`);
  radServiceRequestChecks(srs[0], c, "active");
  radAdditionalInfoChecks(b, c);
  radParticipantChecks(b, c, { minRoles: 1, visitNumber: ctx.visitNumber, healthId: ctx.healthId });
  radReferenceChecks(b, c);
  return c;
}

/* ---------- report ---------- */

export function validateRadReportBundle(b: Json, ctx: ValidateCtx = {}): Check[] {
  const c: Check[] = [];
  c.push(...validateBundleBase(b, { profile: PROFILE.bundleRadReport, label: "Radiology Report", compositionProfile: PROFILE.compositionRadReport }));
  const comp = compositionOf(b);
  compositionChecks(comp, c, {
    typeCode: "18748-4", typeDisplay: "DIAGNOSTIC IMAGING STUDY",
    titleOk: (t) => GUIDE_REPORT_TITLES.includes(t as string),
    titleRule: `It must be one of: ${GUIDE_REPORT_TITLES.join(", ")}.`,
  });
  const authors = (comp?.author ?? []) as Json[];
  need(c, authors.length >= 1 && authors.length <= 2, `${authors.length} Composition.author.`, "Composition.author needs one or two entries.");
  const legal = (comp?.attester ?? []).filter((a: Json) => a.mode === "legal");
  need(c, legal.length === 1 && /^PractitionerRole\//.test(legal[0]?.party?.reference ?? ""), "A legal authenticator (attester mode legal) is present.", "Composition.attester with mode legal is required, exactly once.");
  const basedOn = (comp?.extension ?? []).filter((e: Json) => e.url === EXT.basedOnOrder);
  need(c, basedOn.length === 1 && findByRef(b, basedOn[0].valueReference?.reference)?.resourceType === "ServiceRequest", "Composition points at the ServiceRequest.", "Composition needs exactly one basedOn-order extension pointing at the ServiceRequest.");

  const hasImages = byType(b, "ImagingStudy").length > 0;
  const sections = (comp?.section ?? []) as Json[];
  const top = [S.imagingStudy, S.clinical, S.procedures, S.comparison, S.findings, S.impression, S.addendum];
  const studySection = findSection(sections, S.imagingStudy.code);
  const procSection = findSection(sections, S.procedures.code);
  need(c, !!studySection, "Imaging Study section is present.", "The Imaging Study section (LOINC 18726-0) is required (a narrative when there are no images).");
  need(c, !!procSection, "Procedures section is present.", "The Procedures section (LOINC 55111-9) is required.");
  const repeated = top.filter((g) => sections.filter((x) => sectionCode(x) === g.code).length > 1);
  need(c, repeated.length === 0, "No section is repeated.", `Each section may appear once: ${repeated.map((g) => g.title).join(", ")}.`);
  const subOnly: string[] = [S.radiation.code, S.communication.code, S.keyImages.code];
  const misplaced = sections.filter((x) => subOnly.includes(sectionCode(x) ?? ""));
  need(c, misplaced.length === 0, "Sub-sections sit under their parent section.", "Radiation Exposure belongs under Procedures; Communication and Key Images belong under Impressions.");
  const optional = [S.findings, S.impression].filter((g) => !findSection(sections, g.code));
  if (optional.length) c.push(warn(`Missing section(s): ${optional.map((g) => g.title).join(", ")}. They are R2 (send if known).`));
  sectionFormChecks(sections, [...top, S.radiation, S.communication, S.keyImages], c);
  need(c, allSections(sections).flatMap((x) => (x.entry ?? []) as Json[]).every((e) => !!findByRef(b, e.reference)), "Every section entry resolves.", "A section entry points at a missing resource.");
  need(
    c,
    hasImages ? (studySection?.entry ?? []).some((e: Json) => /^ImagingStudy\//.test(e.reference ?? "")) : !(studySection?.entry ?? []).length,
    hasImages ? "Imaging Study section references the study." : "Imaging Study section has no entries, as there are no images.",
    hasImages ? "With images, the Imaging Study section must reference the ImagingStudy." : "Without images, the Imaging Study section must have no entries.",
  );
  need(c, (procSection?.entry ?? []).some((e: Json) => /^Procedure\//.test(e.reference ?? "")), "Procedures section references the Imaging Procedure.", "The Procedures section must reference the Imaging Procedure.");

  const dr = byType(b, "DiagnosticReport");
  need(c, dr.length === 1, "One DiagnosticReport.", `Exactly one DiagnosticReport is required, found ${dr.length}.`);
  const d = dr[0];
  if (d) {
    need(c, (d.meta?.profile ?? []).includes(PROFILE.diagnosticReportRad), "DiagnosticReport profile is diagnosticreportRadReport.", "DiagnosticReport profile is wrong.");
    const diagExt = (comp?.extension ?? []).find((e: Json) => e.url === EXT.diagnosticReportRef);
    need(c, diagExt?.valueReference?.reference === `DiagnosticReport/${d.id}`, "Composition points at the DiagnosticReport.", "Composition needs the diagnosticReportReference extension.");
    const back = (d.extension ?? []).find((e: Json) => e.url === EXT.reportComposition);
    need(c, back?.valueReference?.reference === `Composition/${comp?.id}`, "DiagnosticReport points back at the Composition.", "DiagnosticReport needs the Composition extension.");
    need(c, GUIDE_DOC_STATUSES.includes(d.status), `DiagnosticReport.status is ${d.status}.`, "DiagnosticReport.status is not an allowed value.");
    need(c, d.code?.coding?.[0]?.code === "18748-4" && d.code?.coding?.[0]?.system === LOINC, "DiagnosticReport.code is LOINC 18748-4.", "DiagnosticReport.code must be LOINC 18748-4.");
    need(c, !!d.effectivePeriod?.start && new Date(d.effectivePeriod?.end).getTime() === new Date(comp?.date).getTime(), "DiagnosticReport period ends at the Composition date.", "The end of DiagnosticReport.effectivePeriod must equal Composition.date.");
    need(c, hasImages ? (d.imagingStudy ?? []).length > 0 : !("imagingStudy" in d), hasImages ? "DiagnosticReport references the ImagingStudy." : "No ImagingStudy reference, as there are no images.", hasImages ? "DiagnosticReport.imagingStudy is required when images exist." : "DiagnosticReport.imagingStudy must be absent when there are no images.");
  }

  const srs = byType(b, "ServiceRequest");
  need(c, srs.length === 1, "Exactly one ServiceRequest in the bundle.", `A radiology report holds exactly one ServiceRequest, found ${srs.length}.`);
  radServiceRequestChecks(srs[0], c, "completed");

  const procs = byType(b, "Procedure");
  need(c, procs.length === 1, "One Imaging Procedure.", `Exactly one Procedure (imaging) is required, found ${procs.length}.`);
  const p = procs[0];
  if (p) {
    need(c, (p.meta?.profile ?? []).includes(PROFILE.imagingProcedure), "Procedure profile is ImagingProcedure.", "Procedure profile is wrong.");
    need(c, !!p.identifier?.[0]?.value && !!p.status, "Procedure has identifier and status.", "Procedure needs an identifier and status.");
    need(c, (p.basedOn ?? []).length === 1 && !!findByRef(b, p.basedOn[0].reference), "Procedure is based on the ServiceRequest.", "Procedure.basedOn must reference the ServiceRequest.");
    procedureCodeChecks(p.code, "Procedure.code", c);
    need(c, findByRef(b, p.performer?.[0]?.actor?.reference)?.resourceType === "Device", "Procedure.performer.actor is the modality Device.", "Procedure.performer.actor must reference the modality Device.");
    bodySiteChecks(p.bodySite, "Procedure.bodySite", c);
  }
  need(c, byType(b, "Device").length >= 1, "Modality Device is in the bundle.", "A Device (the modality) is required.");

  const studies = byType(b, "ImagingStudy");
  const endpoints = byType(b, "Endpoint");
  if (studies.length) {
    const st = studies[0];
    need(c, studies.length === 1, "One ImagingStudy.", "Exactly one ImagingStudy is allowed.");
    need(c, st.identifier?.[0]?.system === "urn:dicom:uid" && !!st.identifier?.[0]?.value, "ImagingStudy.identifier is a DICOM UID.", "ImagingStudy.identifier needs system urn:dicom:uid and the study UID.");
    need(c, st.status === "available", "ImagingStudy.status is available.", "ImagingStudy.status must be available.");
    need(c, (st.basedOn ?? []).length >= 1 && !!st.procedureReference?.reference, "ImagingStudy is linked to the order and the procedure.", "ImagingStudy needs basedOn and procedureReference.");
    need(c, (st.endpoint ?? []).length >= 1 && endpoints.length >= 1, "ImagingStudy has an Endpoint.", "ImagingStudy needs at least one Endpoint.");
    need(
      c,
      (st.series ?? []).every((x: Json) => x.uid && GUIDE_MODALITY_CODES.includes(x.modality?.code) && x.modality?.system === GUIDE_MODALITY_SYSTEM),
      "Every series has a UID and a modality from the Modalities value set.",
      `Each series needs uid and a modality from the Modalities value set with system ${GUIDE_MODALITY_SYSTEM}.`,
    );
    need(
      c,
      endpoints.every((e) => e.status === "active" && ["dicom-wado-rs", "dicom-wado-uri"].includes(e.connectionType?.code) && e.payloadType?.[0]?.coding?.[0]?.code === "any" && e.address),
      "Endpoint is active with a DICOM WADO connection type, payload type any and an address.",
      "Endpoint needs status active, connectionType dicom-wado-rs or dicom-wado-uri, payloadType any and address.",
    );
  } else {
    need(c, endpoints.length === 0, "No images, so no ImagingStudy and no Endpoint.", "Endpoint must not be present when there is no ImagingStudy.");
  }

  radParticipantChecks(b, c, { minRoles: 2, visitNumber: ctx.visitNumber, healthId: ctx.healthId });
  radReferenceChecks(b, c);
  return c;
}

/** Step 3.2.1 and 6.2.1: the document must replace the earlier one. */
export function amendmentChecks(b: Json): MinStep[] {
  const comp = compositionOf(b);
  return [
    { id: "replace", text: "Version 2 or higher with status amended or corrected", met: versionOf(b) > 1 && ["amended", "corrected"].includes(comp?.status), detail: comp ? `Version ${versionOf(b)}, status ${comp.status ?? "none"}` : undefined },
  ];
}
