/**
 * Validators for the radiology order and radiology report (structured) bundles.
 * Rules come from the NPHIES pages listed in rad-bundles.ts. Where the snapshot is silent we check less, not more.
 */

import type { Check } from "../model";
import {
  EXT, PROFILE, SYS, byType, findByRef, need, validateBundleBase, validateParticipants, validateReferences, warn, type Json,
} from "./common";
import {
  DOC_STATUSES, PRIORITY_CODES, additionalInfoChecks, compositionChecks, compositionOf, versionOf, type MinStep, type ValidateCtx,
} from "./lab-validate";
import { RAD_SECTION } from "./rad-bundles";

const sectionCode = (s: Json): string | undefined => s.code?.coding?.[0]?.code;
const hasSection = (comp: Json | undefined, code: string) => ((comp?.section ?? []) as Json[]).some((s) => sectionCode(s) === code);

function placerOk(sr: Json, second: "ACSN" | null): boolean {
  const has = (t: string) => (sr.identifier ?? []).some((i: Json) => i.type?.coding?.some((x: Json) => x.code === t) && i.system?.startsWith("urn:oid:") && i.value);
  return has("PLAC") && (!second || has(second));
}

/** Radiology specific parts of a ServiceRequest: modality and body region are mandatory. */
function radServiceRequestChecks(sr: Json | undefined, c: Check[], status: "active" | "completed") {
  need(c, !!sr, "One ServiceRequest (the imaging procedure).", "Exactly one ServiceRequest is required.");
  if (!sr) return;
  need(c, (sr.meta?.profile ?? []).includes(PROFILE.serviceRequest), "ServiceRequest profile is servicerequest.", "ServiceRequest profile is wrong.");
  need(c, placerOk(sr, status === "completed" ? "ACSN" : null), status === "completed" ? "Placer (PLAC) and accession (ACSN) numbers are present." : "Placer order number (PLAC) is present.", status === "completed" ? "ServiceRequest needs PLAC and ACSN identifiers with root OIDs." : "ServiceRequest needs a PLAC identifier with the root OID.");
  need(c, sr.status === status, `ServiceRequest.status is ${status}.`, `ServiceRequest.status must be ${status}.`);
  need(c, sr.intent === "order", "ServiceRequest.intent is order.", "ServiceRequest.intent must be order.");
  need(c, PRIORITY_CODES.includes(sr.priority), `Priority is ${sr.priority}.`, "ServiceRequest.priority must be routine, urgent, asap or stat.");
  need(c, !!sr.code?.coding?.[0]?.code, `Imaging procedure code ${sr.code?.coding?.[0]?.code}.`, "ServiceRequest.code (imaging procedure) is required.");
  need(c, !!sr.orderDetail?.[0]?.coding?.[0]?.code, "Modality is in orderDetail.", "ServiceRequest.orderDetail must carry the modality for radiology.");
  need(c, !!sr.bodySite?.[0]?.coding?.[0]?.code, "Body region is in bodySite.", "ServiceRequest.bodySite must carry the body region for radiology.");
  need(c, !!sr.occurrencePeriod?.start && !!sr.occurrencePeriod?.end, "ServiceRequest.occurrencePeriod is present.", "ServiceRequest.occurrencePeriod is required.");
  need(c, /^Patient\//.test(sr.subject?.reference ?? ""), "ServiceRequest.subject is the Patient.", "ServiceRequest.subject must reference the Patient.");
}

export function validateRadOrderBundle(b: Json, ctx: ValidateCtx = {}): Check[] {
  const c: Check[] = [];
  c.push(...validateBundleBase(b, { profile: PROFILE.bundleRadOrder, label: "Radiology Order", compositionProfile: PROFILE.compositionRadOrder }));
  const comp = compositionOf(b);
  compositionChecks(comp, c, { title: "Radiology Order", typeCode: "57832-8", typeLabel: "Prescription for diagnostic or specialist care" });
  need(c, (comp?.author ?? []).length === 1 && /^PractitionerRole\//.test(comp?.author?.[0]?.reference ?? ""), "Composition.author is one PractitionerRole.", "Composition.author must be exactly one PractitionerRole.");

  const sections = (comp?.section ?? []) as Json[];
  need(c, sections.length === 1, "Exactly one Radiology Order Section.", `Exactly one section is required, found ${sections.length}.`);
  const s = sections[0];
  if (s) {
    need(c, sectionCode(s) === "57832-8" && s.code?.coding?.[0]?.system === SYS.loinc, "Section code is LOINC 57832-8.", "Section code must be LOINC 57832-8.");
    need(c, s.title === "Radiology Order Section", 'Section title is "Radiology Order Section".', 'Section title must be "Radiology Order Section".');
    need(c, !!s.text?.div, "Section has narrative text.", "Section.text is required.");
    const srRefs = (s.entry ?? []).filter((e: Json) => /^ServiceRequest\//.test(e.reference ?? ""));
    need(c, srRefs.length >= 1, "Section lists the ServiceRequest.", "Section.entry must reference the ServiceRequest.");
    need(c, (s.entry ?? []).every((e: Json) => !!findByRef(b, e.reference)), "Every section entry resolves.", "A section entry points at a missing resource.");
  }

  const srs = byType(b, "ServiceRequest");
  need(c, srs.length === 1, "Exactly one ServiceRequest in the bundle.", `A radiology order bundle holds exactly one ServiceRequest, found ${srs.length}.`);
  radServiceRequestChecks(srs[0], c, "active");
  additionalInfoChecks(b, c);
  c.push(...validateParticipants(b, { minRoles: 1, minPractitioners: 1, visitNumber: ctx.visitNumber, healthId: ctx.healthId }));
  c.push(...validateReferences(b));
  return c;
}

export function validateRadReportBundle(b: Json, ctx: ValidateCtx = {}): Check[] {
  const c: Check[] = [];
  c.push(...validateBundleBase(b, { profile: PROFILE.bundleRadReport, label: "Radiology Report", compositionProfile: PROFILE.compositionRadReport }));
  const comp = compositionOf(b);
  compositionChecks(comp, c, { title: "Radiology Report", typeCode: "18748-4", typeLabel: "DIAGNOSTIC IMAGING STUDY" });
  const authors = (comp?.author ?? []) as Json[];
  need(c, authors.length >= 1 && authors.length <= 2, `${authors.length} Composition.author.`, "Composition.author needs one or two entries.");
  const legal = (comp?.attester ?? []).find((a: Json) => a.mode === "legal");
  need(c, /^PractitionerRole\//.test(legal?.party?.reference ?? ""), "A legal authenticator (attester mode legal) is present.", "Composition.attester with mode legal is required.");
  const basedOn = (comp?.extension ?? []).filter((e: Json) => e.url === EXT.basedOnOrder);
  need(c, basedOn.length === 1 && findByRef(b, basedOn[0].valueReference?.reference)?.resourceType === "ServiceRequest", "Composition points at the ServiceRequest.", "Composition needs exactly one basedOn-order extension pointing at the ServiceRequest.");

  const hasImages = byType(b, "ImagingStudy").length > 0;
  need(c, hasSection(comp, RAD_SECTION.imagingStudy.code), "Imaging Study section is present.", "The Imaging Study section is required (a narrative when there are no images).");
  need(c, hasSection(comp, RAD_SECTION.procedures.code), "Procedures section is present.", "The Procedures section is required.");
  const optional = [RAD_SECTION.findings, RAD_SECTION.impression].filter((x) => !hasSection(comp, x.code));
  if (optional.length) c.push(warn(`Missing optional section(s): ${optional.map((x) => x.display).join(", ")}. They are R2 (send if known).`));
  const sections = (comp?.section ?? []) as Json[];
  need(c, sections.every((x) => x.title && x.text?.div && x.code?.coding?.[0]?.code), "Every section has code, title and narrative.", "A section lacks a code, title or narrative.");
  need(c, sections.flatMap((x) => (x.entry ?? []) as Json[]).every((e) => !!findByRef(b, e.reference)), "Every section entry resolves.", "A section entry points at a missing resource.");
  const studySection = sections.find((x) => sectionCode(x) === RAD_SECTION.imagingStudy.code);
  need(c, !hasImages || (studySection?.entry ?? []).length > 0, "Imaging Study section references the study.", "With images, the Imaging Study section must reference the ImagingStudy.");

  const dr = byType(b, "DiagnosticReport");
  need(c, dr.length === 1, "One DiagnosticReport.", `Exactly one DiagnosticReport is required, found ${dr.length}.`);
  const d = dr[0];
  if (d) {
    need(c, (d.meta?.profile ?? []).includes(PROFILE.diagnosticReportRad), "DiagnosticReport profile is diagnosticreportRadReport.", "DiagnosticReport profile is wrong.");
    const diagExt = (comp?.extension ?? []).find((e: Json) => e.url === EXT.diagnosticReportRef);
    need(c, diagExt?.valueReference?.reference === `DiagnosticReport/${d.id}`, "Composition points at the DiagnosticReport.", "Composition needs the diagnosticReportReference extension.");
    const back = (d.extension ?? []).find((e: Json) => e.url === EXT.reportComposition);
    need(c, back?.valueReference?.reference === `Composition/${comp?.id}`, "DiagnosticReport points back at the Composition.", "DiagnosticReport needs the Composition extension.");
    need(c, DOC_STATUSES.includes(d.status), `DiagnosticReport.status is ${d.status}.`, "DiagnosticReport.status is not an allowed value.");
    need(c, d.code?.coding?.[0]?.code === "18748-4", "DiagnosticReport.code is LOINC 18748-4.", "DiagnosticReport.code must be LOINC 18748-4.");
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
    need(c, !!p.code?.coding?.[0]?.code, "Procedure has the imaging procedure code.", "Procedure.code is required.");
    need(c, findByRef(b, p.performer?.[0]?.actor?.reference)?.resourceType === "Device", "Procedure.performer.actor is the modality Device.", "Procedure.performer.actor must reference the modality Device.");
    need(c, !!p.bodySite?.[0]?.coding?.[0]?.code, "Procedure has a body site.", "Procedure.bodySite is required.");
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
    need(c, (st.series ?? []).every((x: Json) => x.uid && x.modality?.code), "Every series has a UID and a modality.", "Each series needs uid and modality.");
    need(c, endpoints.every((e) => e.status === "active" && e.connectionType?.code && e.payloadType?.[0]?.coding?.[0]?.code === "any" && e.address), "Endpoint is active with connection type, payload type any and an address.", "Endpoint needs status active, connectionType, payloadType any and address.");
  } else {
    need(c, endpoints.length === 0, "No images, so no ImagingStudy and no Endpoint.", "Endpoint must not be present when there is no ImagingStudy.");
  }

  c.push(...validateParticipants(b, { minRoles: 2, minPractitioners: 2, visitNumber: ctx.visitNumber, healthId: ctx.healthId }));
  c.push(...validateReferences(b));
  return c;
}

/** Step 3.2.1 and 6.2.1: the document must replace the earlier one. */
export function amendmentChecks(b: Json): MinStep[] {
  const comp = compositionOf(b);
  return [
    { id: "replace", text: "Version 2 or higher with status amended or corrected", met: versionOf(b) > 1 && ["amended", "corrected"].includes(comp?.status), detail: `Version ${versionOf(b)}, status ${comp?.status ?? "none"}` },
  ];
}
