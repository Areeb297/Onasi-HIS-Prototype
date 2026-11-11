/**
 * Builders for the two NPHIES radiology documents:
 *  - Radiology Order Bundle (bundleRadOrder|1.0), page ids 387645441, 387383323, 391020558, 391020567, 390627341
 *  - Radiology Report Bundle, structured form (bundleRadReport|1.0), page ids 413728794, 414154754, 414547978, 414744577, 414744586, 412778514, 413499402, 413696011
 *
 * The embedded-PDF form of the report is not built here. Pure functions: nothing is stored or sent.
 */

import type { Encounter, Patient } from "../model";
import { OID } from "../reference-data";
import {
  EXT, FILLER_OID, PROFILE, SYS, addDays, buildParticipants, codeable, coding, fhirDateTime, identifier, makeBundle, narrative,
  orgIdentifier, oidSystem, participantResources, quantity, refTo, uuid, versionExtension, type Json, type Person,
} from "./common";
import { BODY_REGIONS, MODALITIES, procByCode, type RadProcedure } from "./rad-catalog";
import type { DocStatus, RadOrder } from "./types";

/** Assumption: the code system URL of the "KSA Imaging Procedure" value set is not in the snapshot. */
export const IMAGING_PROCEDURE_SYSTEM = "http://nphies.sa/terminology/CodeSystem/imaging-procedure"; // made-up
/** Fake PACS address for the Endpoint resource. */
export const PACS_BASE = "https://pacs.demo-hospital.example/wado-rs";

/** Section codes. Assumption: the snapshot lists the sections but not their codes; these are LOINC radiology report section codes. */
export const RAD_SECTION = {
  imagingStudy: { code: "18726-0", display: "Radiology studies (set)" },
  clinical: { code: "55752-0", display: "Clinical information" },
  procedures: { code: "29554-3", display: "Procedure Narrative" },
  comparison: { code: "18834-2", display: "Radiology Comparison study" },
  findings: { code: "59776-5", display: "Procedure findings" },
  impression: { code: "19005-8", display: "Radiology Imaging study [Impression]" },
  addendum: { code: "55107-7", display: "Addendum" },
  reason: { code: "18785-6", display: "Reason for study" },
} as const;

const SOP_CLASS: Record<string, string> = {
  CR: "1.2.840.10008.5.1.4.1.1.1",
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

const procCode = (p: RadProcedure) => codeable(IMAGING_PROCEDURE_SYSTEM, p.code, p.display);
const modalityCode = (p: RadProcedure) => codeable(SYS.dicomModality, MODALITIES[p.modality].code, MODALITIES[p.modality].display);
const regionCode = (p: RadProcedure) => codeable(SYS.snomed, BODY_REGIONS[p.region].code, BODY_REGIONS[p.region].display);

function subSection(sec: { code: string; display: string }, text: string, entries: Json[] = []): Json {
  return {
    title: sec.display,
    code: { coding: [coding(SYS.loinc, sec.code, sec.display)], text: sec.display },
    text: narrative(text),
    ...(entries.length ? { entry: entries } : {}),
  };
}

/* ======================================================================== */
/* Radiology Order                                                           */
/* ======================================================================== */

export function buildRadOrderBundle(ctx: RadBuildCtx): Json {
  const { patient, enc, order, orderer } = ctx;
  const proc = procedureOf(order);
  const now = ctx.now ?? new Date().toISOString();
  const nowDt = fhirDateTime(now);
  const parts = buildParticipants(patient, enc, [orderer], order.orderedAt);
  const role = parts.roles[orderer.id].role;

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
    requester: refTo(role),
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
    code: { coding: [coding(SYS.snomedOid, code, display)], text: display },
    subject: refTo(parts.patient),
    effectiveDateTime: nowDt,
    ...value,
  });
  const extra: Json[] = [];
  const dx = enc.dx[0];
  if (dx) extra.push(aoi("148006", "Preliminary diagnosis", { valueCodeableConcept: { coding: [coding("http://hl7.org/fhir/sid/icd-10-am", dx.code, dx.text)], text: dx.text } }));
  extra.push(aoi("424144002", "Current Chronological Age", { valueQuantity: { value: ageYears(patient.dob, now), unit: "years", system: SYS.ucum, code: "a" } }));
  const kg = Number(enc.vitals?.weight);
  if (kg > 0) extra.push(aoi("363808001", "Body Weight Measure", { valueQuantity: quantity(kg, "kg") }));

  const subSections: Json[] = [];
  if (order.indication) subSections.push(subSection(RAD_SECTION.reason, order.indication));
  if (order.clinicalInfo) subSections.push(subSection(RAD_SECTION.clinical, order.clinicalInfo));

  const composition: Json = {
    resourceType: "Composition",
    id: uuid(),
    meta: { profile: [PROFILE.compositionRadOrder] },
    extension: [versionExtension(ctx.version)],
    identifier: orgIdentifier(radOrderSetId(order)),
    status: ctx.docStatus,
    type: codeable(SYS.loinc, "57832-8", "Prescription for diagnostic or specialist care"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    date: nowDt,
    author: [refTo(role)],
    title: "Radiology Order",
    confidentiality: "N",
    custodian: refTo(parts.org),
    section: [
      {
        title: "Radiology Order Section",
        code: { coding: [coding(SYS.loinc, "57832-8", "Prescription for diagnostic or specialist care")] },
        text: narrative(`${proc.display}${order.indication ? `. Reason: ${order.indication}` : ""}`),
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
  const parts = buildParticipants(patient, enc, [radiologist, authenticator, orderer], order.orderedAt);
  const radRole = parts.roles[radiologist.id].role;
  const authRole = parts.roles[authenticator.id].role;
  const orderRole = parts.roles[orderer.id].role;

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
    requester: refTo(orderRole),
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
        modality: coding(SYS.dicomModality, MODALITIES[proc.modality].code),
        instance: Array.from({ length: Math.min(3, Math.max(1, study.instances)) }, (_, i) => ({
          uid: `${study.studyUid}.${s + 1}.${i + 1}`,
          sopClass: coding("urn:ietf:rfc:3986", `urn:oid:${SOP_CLASS[proc.modality] ?? SOP_CLASS.CR}`),
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
    type: codeable(SYS.loinc, "18748-4", "DIAGNOSTIC IMAGING STUDY"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    date: reportDt,
    author: [refTo(radRole)],
    title: "Radiology Report",
    confidentiality: "N",
    attester: [{ mode: "legal", party: refTo(authRole) }],
    custodian: refTo(parts.org),
  };
  const diag: Json = {
    resourceType: "DiagnosticReport",
    id: uuid(),
    meta: { profile: [PROFILE.diagnosticReportRad] },
    identifier: [orgIdentifier(`${order.id}-DR`)],
    status: ctx.docStatus,
    code: codeable(SYS.loinc, "18748-4", "DIAGNOSTIC IMAGING STUDY"),
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
      ? subSection(RAD_SECTION.imagingStudy, `Images are available in PACS (study ${study.studyUid}).`, [refTo(imaging)])
      : subSection(RAD_SECTION.imagingStudy, "No images are related to this report."),
  ];
  if (order.clinicalInfo || order.indication) sections.push(subSection(RAD_SECTION.clinical, [order.indication, order.clinicalInfo].filter(Boolean).join(". ")));
  sections.push(subSection(RAD_SECTION.procedures, report.technique || proc.technique, [refTo(procedure)]));
  if (report.comparison) sections.push(subSection(RAD_SECTION.comparison, report.comparison));
  if (report.findings) sections.push(subSection(RAD_SECTION.findings, report.findings));
  if (report.impression) sections.push(subSection(RAD_SECTION.impression, report.impression));
  if (report.addendum) sections.push(subSection(RAD_SECTION.addendum, report.addendum));
  composition.section = sections;

  return makeBundle({
    profile: PROFILE.bundleRadReport,
    identifierValue: `${radReportSetId(order)}-v${ctx.version}`,
    timestamp: reportDt,
    resources: [composition, diag, sr, ...(imaging ? [imaging] : []), procedure, ...(endpoint ? [endpoint] : []), device, ...participantResources(parts)],
  });
}
