/**
 * Builders for the two NPHIES radiology documents:
 *  - Radiology Order Bundle (bundleRadOrder|1.0), page ids 387645441, 387383323, 391020558, 390627332, 390299687, 391020567, 390627341
 *  - Radiology Report Bundle, structured form (bundleRadReport|1.0), page ids 413728794, 414154754, 414547978 and its section
 *    pages, 414744577, 414744586, 412778514, 413499402, 413696011
 *
 * Fixed values (section codes and titles, code systems, narrative form) follow the live Confluence pages and the official
 * sample bundles of 17-09-2026 (pages 387481602 and 414089220).
 * The embedded-PDF form of the report is not built here. Pure functions: nothing is stored or sent.
 */

import type { Encounter, Patient } from "../model";
import { OID } from "../reference-data";
import {
  EXT, FILLER_OID, PROFILE, SYS, addDays, buildParticipants, coding, fhirDateTime, identifier, makeBundle,
  orgIdentifier, oidSystem, participantResources, refTo, uuid, versionExtension, type Json, type Participants, type Person,
} from "./common";
import { BODY_REGIONS, MODALITIES, procByCode, type RadProcedure } from "./rad-catalog";
import type { DocStatus, RadOrder } from "./types";

/**
 * Code system of the "KSA Imaging Procedure" value set, as the official order sample sends it.
 * Assumed to hold for reports too: the report sample uses ...1.204.15.1 and the value set workbook lists 1.2.840.10008.6.1.1437 for most codes.
 */
export const IMAGING_PROCEDURE_SYSTEM = "urn:oid:2.16.840.1.113883.3.3731.1.204.15";
/** DICOM modality code system as an OID (Modalities value set, page id 39780455). */
export const MODALITY_SYSTEM = "urn:oid:1.2.840.10008.2.16.4";
/** SNOMED CT as an OID (KSA Body Regions value set, page id 39846061). */
export const BODY_REGION_SYSTEM = SYS.snomedOid;
/** UCUM as an OID (KSA Weight Units and KSA Height Units value sets, page ids 23234332 and 24313997). */
export const UNIT_SYSTEM = "urn:oid:2.16.840.1.113883.6.8";
/** ICD-10-AM as an OID, as the official order sample sends the preliminary diagnosis. */
export const DIAGNOSIS_SYSTEM = "urn:oid:2.16.840.1.113883.6.135";
/** Fake PACS address for the Endpoint resource. */
export const PACS_BASE = "https://pacs.demo-hospital.example/wado-rs";

/** Section code, code display and title, each fixed by its own Confluence page. */
export const RAD_SECTION = {
  imagingStudy: { code: "18726-0", display: "Radiology studies (set)", title: "Imaging Study" }, // 415006721
  clinical: { code: "55752-0", display: "Clinical Information", title: "Clinical Information" }, // 413990915, 390299687
  procedures: { code: "55111-9", display: "Current Imaging Procedure Descriptions", title: "Procedures" }, // 415039489
  comparison: { code: "18834-2", display: "Comparison / Previous Findings", title: "Comparison / Previous Findings" }, // 415039498
  findings: { code: "59776-5", display: "Procedure findings", title: "Procedure findings" }, // 414449674
  impression: { code: "19005-8", display: "Impressions", title: "Impressions" }, // 414253059
  communication: { code: "73568-8", display: "Communication of Critical Results", title: "Communication" }, // 414613515
  addendum: { code: "55107-7", display: "Addendum", title: "Addendum" }, // 414646295
  indication: { code: "59768-2", display: "Procedure Indications", title: "Procedure Indications" }, // 390627332
} as const;

const SOP_CLASS: Record<string, string> = {
  DX: "1.2.840.10008.5.1.4.1.1.1.1",
  CT: "1.2.840.10008.5.1.4.1.1.2",
  MR: "1.2.840.10008.5.1.4.1.1.4",
  US: "1.2.840.10008.5.1.4.1.1.6.1",
  MG: "1.2.840.10008.5.1.4.1.1.1.2",
  BMD: "1.2.840.10008.5.1.4.1.1.1",
};

export interface RadBuildCtx {
  patient: Patient;
  enc: Encounter;
  order: RadOrder;
  orderer: Person;
  version: number;
  docStatus: DocStatus;
  now?: string;
}

export interface RadReportCtx extends RadBuildCtx {
  /** The reporting radiologist (author). */
  radiologist: Person;
  /** The consultant who signs the report (legal authenticator). */
  authenticator: Person;
}

export const radOrderSetId = (o: RadOrder) => `${o.id}-ORD`;
export const radReportSetId = (o: RadOrder) => `${o.id}-RPT`;

const ageYears = (dob: string, at: string) => Math.max(0, Math.floor((new Date(at).getTime() - new Date(dob).getTime()) / (365.25 * 86_400_000)));

/** A DICOM UID under the 2.25 root (UUID based). Made-up, unique enough for a demo. */
export function newDicomUid(): string {
  return `2.25.${BigInt(`0x${uuid().replace(/-/g, "")}`).toString()}`;
}

function procedureOf(order: RadOrder): RadProcedure {
  const p = procByCode(order.procCode);
  if (!p) throw new Error(`Unknown imaging procedure ${order.procCode}`);
  return p;
}

const concept = (system: string, code: string, display: string): Json => ({ coding: [coding(system, code, display)] });
const procCode = (p: RadProcedure) => concept(IMAGING_PROCEDURE_SYSTEM, p.code, p.display);
const modalityCode = (p: RadProcedure) => concept(MODALITY_SYSTEM, MODALITIES[p.modality].code, MODALITIES[p.modality].display);
const regionCode = (p: RadProcedure) => concept(BODY_REGION_SYSTEM, BODY_REGIONS[p.region].code, BODY_REGIONS[p.region].display);

/**
 * Section narrative in the form the NPHIES portal reads: portal tags only, no <div> wrapper, no XHTML namespace
 * (rule on every section page, for example 390627332). The official samples send status "additional".
 */
export function portalNarrative(text: string): Json {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { status: "additional", div: `<paragraph>${esc}</paragraph>` };
}

function section(sec: { code: string; display: string; title: string }, text: string, entries: Json[] = [], children: Json[] = []): Json {
  return {
    code: { coding: [coding(SYS.loinc, sec.code, sec.display)] },
    title: sec.title,
    text: portalNarrative(text),
    ...(entries.length ? { entry: entries } : {}),
    ...(children.length ? { section: children } : {}),
  };
}

/** "Dr. Khalid Alharbi" becomes family Alharbi, given Khalid. Credentials after a comma are dropped. */
function humanName(full: string): Json {
  const clean = full.replace(/^Dr\.?\s+/i, "").split(",")[0].trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { text: clean || full };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1) };
}

/**
 * Participants for a radiology bundle. Two differences from the shared builder:
 *  - PractitionerRole has no identifier of its own (page id 45023260 lists none). A reference to a role carries the
 *    practitioner's provider id, as the official samples do.
 *  - Practitioner.name is sent (the pages linked from the radiology guide make it mandatory; the order sample sends it).
 */
function radParticipants(patient: Patient, enc: Encounter, people: Person[], fallbackStart: string): Participants {
  const parts = buildParticipants(patient, enc, people, fallbackStart);
  for (const p of people) {
    const entry = parts.roles[p.id];
    if (!entry) continue;
    delete entry.role.identifier;
    entry.practitioner.name = [humanName(p.name)];
  }
  return parts;
}

const roleRef = (parts: Participants, person: Person): Json => {
  const { role, practitioner } = parts.roles[person.id];
  return { reference: `PractitionerRole/${role.id}`, identifier: practitioner.identifier[0] };
};

/* ======================================================================== */
/* Radiology Order                                                           */
/* ======================================================================== */

export function buildRadOrderBundle(ctx: RadBuildCtx): Json {
  const { patient, enc, order, orderer } = ctx;
  const proc = procedureOf(order);
  const now = ctx.now ?? new Date().toISOString();
  const nowDt = fhirDateTime(now);
  const parts = radParticipants(patient, enc, [orderer], order.orderedAt);
  const ordererRef = () => roleRef(parts, orderer);

  const sr: Json = {
    resourceType: "ServiceRequest",
    id: uuid(),
    meta: { profile: [PROFILE.serviceRequest] },
    identifier: [identifier(oidSystem(OID.participant), order.id, "PLAC")],
    status: "active",
    intent: "order",
    priority: order.priority,
    code: procCode(proc),
    subject: refTo(parts.patient),
    requester: ordererRef(),
    occurrencePeriod: { start: fhirDateTime(order.orderedAt), end: addDays(order.orderedAt, 30) },
    orderDetail: [modalityCode(proc)],
    bodySite: [regionCode(proc)],
  };

  // Additional Order Information. The bundle page wants at least one, so the age is always sent.
  const aoi = (code: string, display: string, value: Json): Json => ({
    resourceType: "Observation",
    id: uuid(),
    meta: { profile: [PROFILE.additionalOrderInfo] },
    identifier: [orgIdentifier(`${order.id}-AOI-${code}`)],
    basedOn: [refTo(sr)],
    status: "final",
    code: { coding: [coding(SYS.snomedOid, code, display)] },
    subject: refTo(parts.patient),
    effectiveDateTime: nowDt,
    ...value,
  });
  const extra: Json[] = [];
  const dx = enc.dx[0];
  if (dx) extra.push(aoi("148006", "Preliminary diagnosis", { valueCodeableConcept: { coding: [coding(DIAGNOSIS_SYSTEM, dx.code, dx.text)] } }));
  // Units: code "a" (year) from KSA Time Units (page id 23169515), "kg" from KSA Weight Units (page id 23234332).
  extra.push(aoi("424144002", "Current Chronological Age", { valueQuantity: { value: ageYears(patient.dob, now), unit: "year", system: UNIT_SYSTEM, code: "a" } }));
  const kg = Number(enc.vitals?.weight);
  if (kg > 0) extra.push(aoi("363808001", "Body Weight Measure", { valueQuantity: { value: kg, unit: "kg", system: UNIT_SYSTEM, code: "kg" } }));

  // NPHIES rejects an order without the Procedure Indications sub-section (Error Handling Guide 1.1.7), so the app makes the reason mandatory.
  const subSections: Json[] = [];
  if (order.indication) subSections.push(section(RAD_SECTION.indication, order.indication));
  if (order.clinicalInfo) subSections.push(section(RAD_SECTION.clinical, order.clinicalInfo));

  const composition: Json = {
    resourceType: "Composition",
    id: uuid(),
    meta: { profile: [PROFILE.compositionRadOrder] },
    extension: [versionExtension(ctx.version)],
    identifier: orgIdentifier(radOrderSetId(order)),
    status: ctx.docStatus,
    type: concept(SYS.loinc, "57832-8", "Prescription for diagnostic or specialist care"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    date: nowDt,
    author: [ordererRef()],
    title: "Radiology Order",
    confidentiality: "N",
    custodian: refTo(parts.org),
    section: [
      {
        code: { coding: [coding(SYS.loinc, "57832-8", "Prescription for diagnostic or specialist care")] },
        title: "Radiology Order Section",
        text: portalNarrative(`${proc.display}${order.indication ? `. Reason: ${order.indication}` : ""}`),
        entry: [refTo(sr), ...extra.map(refTo)],
        ...(subSections.length ? { section: subSections } : {}),
      },
    ],
  };

  return makeBundle({
    profile: PROFILE.bundleRadOrder,
    identifierValue: `${radOrderSetId(order)}-v${ctx.version}`,
    timestamp: nowDt,
    resources: [composition, sr, ...extra, ...participantResources(parts)],
  });
}

/* ======================================================================== */
/* Radiology Report (structured)                                             */
/* ======================================================================== */

export function buildRadReportBundle(ctx: RadReportCtx): Json {
  const { patient, enc, order, orderer, radiologist, authenticator } = ctx;
  const proc = procedureOf(order);
  const report = order.report;
  const study = order.study;
  if (!report || !study) throw new Error("The exam and report must be recorded before building the report bundle.");
  const now = ctx.now ?? new Date().toISOString();
  const reportDt = fhirDateTime(now);
  const parts = radParticipants(patient, enc, [radiologist, authenticator, orderer], order.orderedAt);

  const sr: Json = {
    resourceType: "ServiceRequest",
    id: uuid(),
    meta: { profile: [PROFILE.serviceRequest] },
    identifier: [identifier(oidSystem(OID.participant), order.id, "PLAC"), identifier(oidSystem(FILLER_OID), study.accession, "ACSN")],
    status: "completed",
    intent: "order",
    priority: order.priority,
    code: procCode(proc),
    subject: refTo(parts.patient),
    requester: roleRef(parts, orderer),
    occurrencePeriod: { start: fhirDateTime(order.orderedAt), end: addDays(order.orderedAt, 30) },
    orderDetail: [modalityCode(proc)],
    bodySite: [regionCode(proc)],
  };

  const device: Json = {
    resourceType: "Device",
    id: uuid(),
    meta: { profile: [PROFILE.device] },
    identifier: [orgIdentifier(`DEV-${proc.modality}-01`)],
    deviceName: [{ name: `Demo ${MODALITIES[proc.modality].display} Unit`, type: "model-name" }],
  };

  const procedure: Json = {
    resourceType: "Procedure",
    id: uuid(),
    meta: { profile: [PROFILE.imagingProcedure] },
    identifier: [orgIdentifier(`${order.id}-PROC`)],
    status: "completed",
    code: procCode(proc),
    subject: refTo(parts.patient),
    basedOn: [refTo(sr)],
    performedPeriod: { start: fhirDateTime(study.performedStart), end: fhirDateTime(study.performedEnd) },
    performer: [{ actor: refTo(device) }],
    bodySite: [regionCode(proc)],
  };

  // Images: ImagingStudy and Endpoint exist together, or not at all.
  let imaging: Json | undefined;
  let endpoint: Json | undefined;
  if (study.images) {
    endpoint = {
      resourceType: "Endpoint",
      id: uuid(),
      meta: { profile: [PROFILE.endpoint] },
      identifier: [orgIdentifier(`${order.id}-EP`)],
      status: "active",
      connectionType: coding(SYS.endpointType, "dicom-wado-rs"),
      payloadType: [{ coding: [coding(SYS.endpointPayload, "any")] }],
      address: PACS_BASE,
    };
    const seriesUid = `${study.studyUid}.1`;
    imaging = {
      resourceType: "ImagingStudy",
      id: uuid(),
      meta: { profile: [PROFILE.imagingStudy] },
      identifier: [identifier("urn:dicom:uid", study.studyUid)],
      status: "available",
      subject: refTo(parts.patient),
      basedOn: [refTo(sr)],
      procedureReference: refTo(procedure),
      endpoint: [refTo(endpoint)],
      series: Array.from({ length: Math.max(1, study.series) }, (_, s) => ({
        uid: s === 0 ? seriesUid : `${study.studyUid}.${s + 1}`,
        number: s + 1,
        modality: coding(MODALITY_SYSTEM, MODALITIES[proc.modality].code),
        instance: Array.from({ length: Math.min(3, Math.max(1, study.instances)) }, (_, i) => ({
          uid: `${study.studyUid}.${s + 1}.${i + 1}`,
          sopClass: coding("urn:ietf:rfc:3986", `urn:oid:${SOP_CLASS[proc.modality] ?? SOP_CLASS.DX}`),
          number: i + 1,
        })),
      })),
    };
  }

  const composition: Json = {
    resourceType: "Composition",
    id: uuid(),
    meta: { profile: [PROFILE.compositionRadReport] },
    identifier: orgIdentifier(radReportSetId(order)),
    status: ctx.docStatus,
    type: concept(SYS.loinc, "18748-4", "DIAGNOSTIC IMAGING STUDY"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    date: reportDt,
    author: [roleRef(parts, radiologist)],
    // One of the twelve fixed titles (page id 414547978). The value set workbook links each procedure to its title.
    title: proc.reportTitle,
    confidentiality: "N",
    attester: [{ mode: "legal", party: roleRef(parts, authenticator) }],
    custodian: refTo(parts.org),
  };
  const diag: Json = {
    resourceType: "DiagnosticReport",
    id: uuid(),
    meta: { profile: [PROFILE.diagnosticReportRad] },
    identifier: [orgIdentifier(`${order.id}-DR`)],
    status: ctx.docStatus,
    code: concept(SYS.loinc, "18748-4", "DIAGNOSTIC IMAGING STUDY"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    effectivePeriod: { start: fhirDateTime(study.performedStart), end: reportDt },
    ...(imaging ? { imagingStudy: [refTo(imaging)] } : {}),
  };
  composition.extension = [
    versionExtension(ctx.version),
    { url: EXT.basedOnOrder, valueReference: refTo(sr) },
    { url: EXT.diagnosticReportRef, valueReference: refTo(diag) },
  ];
  diag.extension = [{ url: EXT.reportComposition, valueReference: refTo(composition) }];

  const sections: Json[] = [
    imaging
      ? section(RAD_SECTION.imagingStudy, `Images are available in PACS (study ${study.studyUid}).`, [refTo(imaging)])
      : section(RAD_SECTION.imagingStudy, "This report includes no images."),
  ];
  if (order.clinicalInfo || order.indication) sections.push(section(RAD_SECTION.clinical, [order.indication, order.clinicalInfo].filter(Boolean).join(". ")));
  sections.push(section(RAD_SECTION.procedures, report.technique || proc.technique, [refTo(procedure)]));
  if (report.comparison) sections.push(section(RAD_SECTION.comparison, report.comparison));
  if (report.findings) sections.push(section(RAD_SECTION.findings, report.findings));
  if (report.impression) {
    // A critical result that was called to the clinician goes in the Communication sub-section (send if known).
    const told = (report.communicated ?? "").trim();
    const communication = told ? [section(RAD_SECTION.communication, `Critical result communicated to ${told}.`)] : [];
    sections.push(section(RAD_SECTION.impression, report.impression, [], communication));
  }
  if (report.addendum) sections.push(section(RAD_SECTION.addendum, report.addendum));
  composition.section = sections;

  return makeBundle({
    profile: PROFILE.bundleRadReport,
    identifierValue: `${radReportSetId(order)}-v${ctx.version}`,
    timestamp: reportDt,
    resources: [composition, diag, sr, ...(imaging ? [imaging] : []), procedure, ...(endpoint ? [endpoint] : []), device, ...participantResources(parts)],
  });
}
