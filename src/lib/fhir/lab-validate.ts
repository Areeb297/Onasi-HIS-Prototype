/**
 * Validators for the laboratory order and laboratory report bundles, plus the Seha conformance minimums.
 * Each returns checks like our ADT validator: { level: "error" | "warn" | "ok", text }.
 * Rules come from the NPHIES pages listed in lab-bundles.ts. Where the snapshot is silent we check less, not more.
 */

import type { Check } from "../model";
import {
  EXT, FHIR_DATETIME_TZ, PROFILE, SYS, byType, findByRef, firstIdentifier, need, validateBundleBase, validateParticipants,
  validateReferences, type Json,
} from "./common";
import { KSA_LAB_UNITS } from "./lab-units";

export interface ValidateCtx {
  /** The visit number on the chart. The Encounter in the bundle must carry the same one. */
  visitNumber?: string;
  healthId?: string;
}

export const DOC_STATUSES = ["final", "amended", "corrected", "cancelled", "entered-in-error"];
/** Assumption: the nphies Observation Status value set is not in the snapshot. */
export const OBS_STATUSES = ["final", "amended", "corrected", "cancelled", "entered-in-error"];
export const PRIORITY_CODES = ["routine", "urgent", "asap", "stat"];
const AOI_CODES: Record<string, "cc" | "q" | "b"> = {
  "148006": "cc", "102478008": "cc", "80943009": "cc", "424144002": "q", "50373000": "q", "363808001": "q", "16985007": "b", "440565004": "b",
};

/**
 * Fixed values from the guide. The validator checks against these, not against what the builder happens to send.
 *
 * "Laboratory Department" value set, Confluence page id 23234312: LOINC codes for Composition.section.code.
 */
export const LAB_DEPARTMENT_CODES: Record<string, string> = {
  "27898-6": "Anatomic Pathology", "18717-9": "Blood Banking", "18719-5": "Biochemistry", "26438-2": "Cytology", "18727-8": "Serology",
  "18725-2": "Microbiology", "26435-8": "Molecular Biology", "18728-6": "Toxicology", "26436-6": "Laboratory Studies",
  "18767-4": "Blood Gas Studies", "18768-2": "Cell Counts + Differential Studies", "18718-7": "Cell Marker Studies",
  "26437-4": "Chemistry Challenge Studies", "18720-3": "Coagulation Studies", "18722-9": "Fertility Studies", "18723-7": "Hematology Studies",
  "18724-5": "HLA Studies", "18769-0": "Microbial Susceptibility Tests", "18721-1": "Therapeutic Drug Monitoring Studies",
  "18729-4": "Urinalysis Studies",
};
/** Microbiology in the Laboratory Department value set. Used by the Seha minimum "abnormal microbiology result". */
const MICROBIOLOGY_SECTION = "18725-2";
/** LOINC and UCUM may be named by OID (as in the official samples) or by URL. The guide does not fix the form for these elements. */
const LOINC_SYSTEMS = ["urn:oid:2.16.840.1.113883.6.1", "http://loinc.org"];
const UCUM_SYSTEMS = ["urn:oid:2.16.840.1.113883.6.8", "http://unitsofmeasure.org"];

/** Problems with the unit of a Quantity: it must be UCUM and in the "KSA Laboratory Observation Units" value set (page id 23135664). */
function unitProblem(q: Json | undefined): string | null {
  if (!q || (q.unit === undefined && q.code === undefined && q.system === undefined)) return null; // a plain number has no unit to check
  const unit = (q.code ?? q.unit) as string;
  if (!KSA_LAB_UNITS.has(unit)) return `unit ${unit} is not in the KSA Laboratory Observation Units value set`;
  if (!UCUM_SYSTEMS.includes(q.system)) return "unit system must be UCUM";
  return null;
}

export const compositionOf = (b: Json): Json | undefined => byType(b, "Composition")[0];
export const versionOf = (b: Json): number => {
  const ext = (compositionOf(b)?.extension ?? []).find((e: Json) => e.url === EXT.versionNumber);
  return Number(ext?.valueString ?? 0) || 0;
};
const interpCode = (o: Json): string | undefined => o.interpretation?.[0]?.coding?.[0]?.code;
const rangeText = (o: Json): string => o.referenceRange?.[0]?.text ?? "";
const abnormal = (code?: string) => !!code && !["N", "NEG"].includes(code);
const sameInstant = (a?: string, b?: string) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

/** Shared Composition checks. `title` differs per document. */
export function compositionChecks(comp: Json | undefined, c: Check[], o: { title: string; typeCode: string; typeLabel: string }) {
  if (!comp) {
    c.push({ level: "error", text: "There is no Composition." });
    return;
  }
  const ver = (comp.extension ?? []).find((e: Json) => e.url === EXT.versionNumber);
  need(c, !!ver?.valueString, `Composition version number is ${ver?.valueString}.`, "Composition needs the versionNumber extension.");
  need(c, comp.identifier?.system?.startsWith("urn:oid:") && comp.identifier?.value, `Composition set identifier is ${comp.identifier?.value}.`, "Composition.identifier needs the root OID and a value (the id shared by all versions).");
  need(c, DOC_STATUSES.includes(comp.status), `Composition.status is ${comp.status}.`, `Composition.status must be one of ${DOC_STATUSES.join(", ")}.`);
  need(c, comp.type?.coding?.[0]?.code === o.typeCode && comp.type?.coding?.[0]?.system === SYS.loinc, `Composition.type is LOINC ${o.typeCode} (${o.typeLabel}).`, `Composition.type must be LOINC ${o.typeCode} (${o.typeLabel}).`);
  need(c, /^Patient\//.test(comp.subject?.reference ?? "") && !!comp.subject?.identifier, "Composition.subject points at the Patient with its identifier.", "Composition.subject needs the Patient reference and identifier.");
  need(c, FHIR_DATETIME_TZ.test(comp.date ?? ""), "Composition.date has a time zone.", "Composition.date needs date, time and time zone (+03:00).");
  need(c, comp.title === o.title, `Composition.title is "${o.title}".`, `Composition.title must be "${o.title}".`);
  need(c, !!comp.confidentiality, "Composition.confidentiality is present.", "Composition.confidentiality is required.");
  need(c, /^Organization\//.test(comp.custodian?.reference ?? ""), "Composition.custodian is the Organization.", "Composition.custodian must reference the Organization.");
  need(c, !!comp.encounter?.reference, "Composition.encounter links the visit.", "Composition.encounter is missing. It is optional, but it carries the visit number.", "warn");
}

/** Checks on the sections of a composition: code, title, narrative, entries that resolve. */
function sectionChecks(b: Json, comp: Json | undefined, c: Check[], what: string) {
  const sections = (comp?.section ?? []) as Json[];
  need(c, sections.length >= 1, `${sections.length} ${what} section(s).`, `At least one ${what} section is required.`);
  const wrongDept = sections.filter((s) => !(s.code?.coding?.[0]?.code in LAB_DEPARTMENT_CODES) || !LOINC_SYSTEMS.includes(s.code?.coding?.[0]?.system));
  need(
    c,
    wrongDept.length === 0,
    "Every section code is a LOINC code from the Laboratory Department value set.",
    `Section code not in the Laboratory Department value set (LOINC, for example 18723-7 Hematology Studies): ${wrongDept.map((s) => s.code?.coding?.[0]?.code ?? "none").join(", ")}.`,
  );
  const bad = sections.filter((s) => !s.code?.coding?.[0]?.code || !s.title || !s.text?.div || !(s.entry ?? []).length);
  need(c, bad.length === 0, "Every section has code, title, narrative text and entries.", `${bad.length} section(s) lack a code, title, text or entries.`);
  const unresolved = sections.flatMap((s) => (s.entry ?? []) as Json[]).filter((e) => !findByRef(b, e.reference));
  need(c, unresolved.length === 0, "Every section entry resolves to a resource.", `${unresolved.length} section entries point at missing resources.`);
}

/** Additional Order Information observations (lab and radiology orders). Page ids 359432193 and 390627341. */
export function additionalInfoChecks(b: Json, c: Check[]) {
  const aoi = byType(b, "Observation");
  need(c, aoi.length >= 1, `${aoi.length} Additional Order Information observation(s).`, "At least one Additional Order Information observation is required in the bundle.");
  const aoiBad: string[] = [];
  for (const o of aoi) {
    const code = o.code?.coding?.[0]?.code as string;
    const kind = AOI_CODES[code];
    const typeOk = kind === "cc" ? !!o.valueCodeableConcept : kind === "q" ? !!o.valueQuantity : kind === "b" ? o.valueBoolean === true : false;
    const problems = [
      !(o.meta?.profile ?? []).includes(PROFILE.additionalOrderInfo) && "profile",
      !(o.basedOn ?? []).length && "basedOn",
      o.status !== "final" && "status must be final",
      o.code?.coding?.[0]?.system !== SYS.snomedOid && "code system urn:oid:2.16.840.1.113883.6.96",
      !kind && "code not in the allowed list",
      kind && !typeOk && "value type",
    ].filter(Boolean);
    if (problems.length) aoiBad.push(`${code}: ${problems.join(", ")}`);
  }
  need(c, aoiBad.length === 0, "Additional Order Information has the right profile, status final, SNOMED code and value type.", `Additional Order Information problems: ${aoiBad.join(" | ")}.`);
  const codes = aoi.map((o) => o.code?.coding?.[0]?.code);
  need(c, !(codes.includes("16985007") && codes.includes("440565004")), "Fasting and Nonfasting are not both present.", "Fasting and Nonfasting must not both be present.");
}

/* ======================================================================== */

export function validateLabOrderBundle(b: Json, ctx: ValidateCtx = {}): Check[] {
  const c: Check[] = [];
  c.push(...validateBundleBase(b, { profile: PROFILE.bundleLabOrder, label: "Laboratory Order", compositionProfile: PROFILE.compositionLabOrder }));
  const comp = compositionOf(b);
  compositionChecks(comp, c, { title: "Laboratory Order", typeCode: "57832-8", typeLabel: "Prescription for diagnostic or specialist care" });
  need(c, (comp?.author ?? []).length === 1 && /^PractitionerRole\//.test(comp?.author?.[0]?.reference ?? ""), "Composition.author is one PractitionerRole.", "Composition.author must be exactly one PractitionerRole.");
  sectionChecks(b, comp, c, "laboratory order");

  const srs = byType(b, "ServiceRequest");
  need(c, srs.length >= 1, `${srs.length} ServiceRequest (ordered tests).`, "At least one ServiceRequest is required.");
  const bad: string[] = [];
  for (const sr of srs) {
    const plac = (sr.identifier ?? []).find((i: Json) => i.type?.coding?.some((x: Json) => x.code === "PLAC"));
    const problems = [
      !(sr.meta?.profile ?? []).includes(PROFILE.serviceRequest) && "profile",
      !(plac?.system?.startsWith("urn:oid:") && plac?.value) && "PLAC identifier",
      sr.status !== "active" && "status must be active in an order",
      sr.intent !== "order" && "intent must be order",
      !sr.subject?.reference && "subject",
      !(sr.occurrencePeriod?.start && sr.occurrencePeriod?.end) && "occurrencePeriod",
      !PRIORITY_CODES.includes(sr.priority) && "priority",
      !LOINC_SYSTEMS.includes(sr.code?.coding?.[0]?.system) && "LOINC code",
      sr.orderDetail && "orderDetail (modality) is for radiology only",
    ].filter(Boolean);
    if (problems.length) bad.push(`${sr.code?.coding?.[0]?.code ?? "?"}: ${problems.join(", ")}`);
  }
  need(c, bad.length === 0, "Every ServiceRequest has profile, PLAC identifier, status active, intent order, subject, period, priority and a LOINC code.", `ServiceRequest problems: ${bad.join(" | ")}.`);
  const referencedSr = new Set(((comp?.section ?? []) as Json[]).flatMap((s) => (s.entry ?? []).map((e: Json) => e.reference)));
  need(c, srs.every((s) => referencedSr.has(`ServiceRequest/${s.id}`)), "Every ServiceRequest is listed in a section.", "A ServiceRequest is not listed in any section.");

  additionalInfoChecks(b, c);

  for (const sp of byType(b, "Specimen")) {
    need(c, !("receivedTime" in sp), "Specimen has no receivedTime (not allowed in an order).", "Specimen.receivedTime must not be present in an order.");
    need(c, !!sp.collection?.collectedDateTime && !!firstIdentifier(sp)?.value && !!sp.type, "Specimen has identifier, type and collection time.", "Specimen needs identifier, type and collection.collectedDateTime.");
  }

  c.push(...validateParticipants(b, { minRoles: 1, minPractitioners: 1, visitNumber: ctx.visitNumber, healthId: ctx.healthId }));
  c.push(...validateReferences(b));
  return c;
}

/* ======================================================================== */

export function validateLabReportBundle(b: Json, ctx: ValidateCtx = {}): Check[] {
  const c: Check[] = [];
  c.push(...validateBundleBase(b, { profile: PROFILE.bundleLabReport, label: "Laboratory Report", compositionProfile: PROFILE.compositionLabReport }));
  const comp = compositionOf(b);
  compositionChecks(comp, c, { title: "Laboratory Report", typeCode: "11502-2", typeLabel: "LABORATORY REPORT" });
  const authors = (comp?.author ?? []) as Json[];
  need(c, authors.length >= 1 && authors.length <= 2, `${authors.length} Composition.author.`, "Composition.author needs one or two entries.");
  const legal = (comp?.attester ?? []).find((a: Json) => a.mode === "legal");
  need(c, /^PractitionerRole\//.test(legal?.party?.reference ?? ""), "A legal authenticator (attester mode legal) is present.", "Composition.attester with mode legal is required.");
  const basedOn = (comp?.extension ?? []).filter((e: Json) => e.url === EXT.basedOnOrder);
  need(c, basedOn.length >= 1 && basedOn.every((e: Json) => findByRef(b, e.valueReference?.reference)?.resourceType === "ServiceRequest"), `${basedOn.length} reference(s) to the order (ServiceRequest).`, "Composition needs the basedOn-order extension pointing at a ServiceRequest.");
  sectionChecks(b, comp, c, "laboratory");

  const dr = byType(b, "DiagnosticReport");
  need(c, dr.length === 1, "One DiagnosticReport.", `Exactly one DiagnosticReport is required, found ${dr.length}.`);
  const d = dr[0];
  if (d) {
    need(c, (d.meta?.profile ?? []).includes(PROFILE.diagnosticReportLab), "DiagnosticReport profile is diagnosticreportLabReport.", "DiagnosticReport profile is wrong.");
    const diagExt = (comp?.extension ?? []).find((e: Json) => e.url === EXT.diagnosticReportRef);
    need(c, diagExt?.valueReference?.reference === `DiagnosticReport/${d.id}`, "Composition points at the DiagnosticReport.", "Composition needs the diagnosticReportReference extension.");
    const back = (d.extension ?? []).find((e: Json) => e.url === EXT.reportComposition);
    need(c, back?.valueReference?.reference === `Composition/${comp?.id}`, "DiagnosticReport points back at the Composition.", "DiagnosticReport needs the Composition extension.");
    need(c, DOC_STATUSES.includes(d.status), `DiagnosticReport.status is ${d.status}.`, "DiagnosticReport.status is not an allowed value.");
    need(c, d.code?.coding?.[0]?.code === "11502-2", "DiagnosticReport.code is LOINC 11502-2.", "DiagnosticReport.code must be LOINC 11502-2.");
    need(c, !!d.effectivePeriod?.start && sameInstant(d.effectivePeriod?.end, comp?.date), "DiagnosticReport period ends at the Composition date.", "The end of DiagnosticReport.effectivePeriod must equal Composition.date.");
    need(c, (d.result ?? []).length >= 1, `${(d.result ?? []).length} DiagnosticReport.result.`, "DiagnosticReport.result needs at least one Observation.");
    const spec = byType(b, "Specimen");
    const refd = new Set((d.specimen ?? []).map((s: Json) => s.reference));
    need(c, spec.every((s) => refd.has(`Specimen/${s.id}`)), "DiagnosticReport lists every Specimen in the bundle.", "DiagnosticReport.specimen must list every Specimen in the bundle.");
  }

  const obs = byType(b, "Observation");
  need(c, obs.length >= 1, `${obs.length} Observation(s).`, "At least one Observation is required.");
  const tally: Record<string, number> = {};
  const add = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  const hasSpecimen = byType(b, "Specimen").length > 0;
  for (const o of obs) {
    if (!(o.meta?.profile ?? []).includes(PROFILE.observationLab)) add("profile observationLabReport");
    if ((o.basedOn ?? []).length !== 1) add("basedOn (exactly one ServiceRequest)");
    if (!OBS_STATUSES.includes(o.status)) add("status");
    if (o.category?.[0]?.coding?.[0]?.code !== "laboratory") add("category laboratory");
    if (!LOINC_SYSTEMS.includes(o.code?.coding?.[0]?.system)) add("LOINC code");
    if (!o.subject?.reference) add("subject");
    if (!(o.effectivePeriod?.start && o.effectivePeriod?.end)) add("effectivePeriod");
    if (!(o.performer ?? []).length) add("performer");
    const isPanel = (o.hasMember ?? []).length > 0;
    const hasValue = ["valueQuantity", "valueCodeableConcept", "valueString", "valueBoolean", "valueInteger", "valueRange", "valueRatio"].some((k) => k in o);
    if (isPanel && hasValue) add("value must be absent in a panel");
    if (!isPanel && !hasValue) add("value");
    if (o.interpretation && o.interpretation[0]?.coding?.[0]?.system !== SYS.interpretation) add("interpretation system");
    const rr = o.referenceRange?.[0];
    if (!rr?.text) add("referenceRange.text (use 'undefined' when none)");
    if (rr && rr.type?.coding?.[0]?.code !== "normal") add("referenceRange.type normal");
    for (const q of [o.valueQuantity, rr?.low, rr?.high]) {
      const up = unitProblem(q);
      if (up) add(up);
    }
    if (hasSpecimen && !isPanel && !o.specimen && o.category) add("specimen link");
  }
  const tallyText = Object.entries(tally).map(([k, n]) => `${k} (${n})`).join(", ");
  need(c, !tallyText, "Every Observation has profile, status, category, code, subject, period, performer, value, a unit from the KSA value set, interpretation system and reference range.", `Observation problems: ${tallyText}.`);

  const srs = byType(b, "ServiceRequest");
  need(c, srs.length >= 1, `${srs.length} ServiceRequest.`, "At least one ServiceRequest is required in a report.");
  need(
    c,
    srs.every((s) => (s.meta?.profile ?? []).includes(PROFILE.serviceRequestLabReport) && ["active", "completed"].includes(s.status) && s.intent === "order" && !!s.occurrencePeriod),
    "ServiceRequest has profile servicerequestLabReport, a valid status, intent order and a period.",
    "A ServiceRequest has a wrong profile, status, intent or no period.",
  );
  need(
    c,
    srs.every((s) => LOINC_SYSTEMS.includes(s.code?.coding?.[0]?.system) && !s.orderDetail),
    "Each ServiceRequest has a LOINC code and no modality.",
    "A ServiceRequest in a laboratory report needs a LOINC code and must not carry orderDetail (modality).",
  );
  if (hasSpecimen) {
    need(
      c,
      srs.every((s) => (s.specimen ?? []).length > 0),
      "Each ServiceRequest links its Specimen.",
      "A ServiceRequest has no specimen reference. It is required when the specimen is known.",
      "warn",
    );
  }
  need(
    c,
    srs.every((s) => ["PLAC", "FILL"].every((t) => (s.identifier ?? []).some((i: Json) => i.type?.coding?.some((x: Json) => x.code === t) && i.system?.startsWith("urn:oid:") && i.value))),
    "Each ServiceRequest has placer (PLAC) and filler (FILL) numbers.",
    "Each ServiceRequest in a report needs a PLAC and a FILL identifier.",
  );

  for (const sp of byType(b, "Specimen")) {
    need(c, !!sp.collection?.collectedDateTime && !!sp.receivedTime && !!firstIdentifier(sp)?.value && !!sp.type, "Specimen has identifier, type, collection time and received time.", "A report Specimen needs identifier, type, collectedDateTime and receivedTime.");
  }

  c.push(...validateParticipants(b, { minRoles: 2, minPractitioners: 2, visitNumber: ctx.visitNumber, healthId: ctx.healthId }));
  c.push(...validateReferences(b));
  return c;
}

/* ======================================================================== */
/* Seha conformance minimums                                                 */
/* ======================================================================== */

export interface MinStep {
  id: string;
  text: string;
  met: boolean;
  detail?: string;
}

/** Step 2.1.1: the minimum content of the first laboratory result document. */
export function labResultMinimums(b: Json): MinStep[] {
  const obs = byType(b, "Observation");
  const panels = obs.filter((o) => (o.hasMember ?? []).length >= 2);
  let panelDetail = "No panel with two or more observations.";
  let panelMet = false;
  for (const p of panels) {
    const members = (p.hasMember as Json[]).map((m) => findByRef(b, m.reference)).filter((m): m is Json => !!m);
    const abn = members.find((m) => m.valueQuantity?.unit && abnormal(interpCode(m)) && (m.referenceRange?.[0]?.low || m.referenceRange?.[0]?.high));
    const norm = members.find((m) => m.valueQuantity?.unit && interpCode(m) === "N" && rangeText(m).length > 100);
    if (abn && norm) {
      panelMet = true;
      panelDetail = `Panel ${p.code?.coding?.[0]?.display ?? ""}: abnormal ${abn.code?.coding?.[0]?.display}, normal ${norm.code?.coding?.[0]?.display}.`;
      break;
    }
    panelDetail = `Panel needs one abnormal quantity with referenceRange low or high${abn ? " (found)" : " (missing)"} and one normal quantity with a text range over 100 characters${norm ? " (found)" : " (missing)"}.`;
  }
  const textual = obs.filter((o) => (o.valueString !== undefined || o.valueInteger !== undefined) && abnormal(interpCode(o)) && /[<>]/.test(rangeText(o)) && /\d/.test(String(o.valueString ?? o.valueInteger)));
  const normalText = obs.filter((o) => ((o.valueString !== undefined && !/^[<>]?\s*-?\d/.test(o.valueString)) || o.valueCodeableConcept) && ["N", "NEG"].includes(interpCode(o) ?? ""));
  const comp = compositionOf(b);
  const mbEntries = ((comp?.section ?? []) as Json[]).filter((s) => s.code?.coding?.[0]?.code === MICROBIOLOGY_SECTION).flatMap((s) => (s.entry ?? []) as Json[]);
  const micro = mbEntries.map((e) => findByRef(b, e.reference)).filter((o): o is Json => !!o && abnormal(interpCode(o)) && !!(o.valueCodeableConcept || o.valueString));
  const specimens = byType(b, "Specimen").filter((s) => s.collection?.collectedDateTime);
  return [
    { id: "2.1.1.1", text: "A panel with an abnormal quantitative result (structured range) and a normal quantitative result (text range over 100 characters)", met: panelMet, detail: panelDetail },
    { id: "2.1.1.2", text: "An abnormal numeric result as valueString or valueInteger, with a text range containing < or >", met: textual.length > 0, detail: textual.length ? `${textual[0].code?.coding?.[0]?.display}: ${textual[0].valueString ?? textual[0].valueInteger}` : "Add CRP or troponin with an abnormal value." },
    { id: "2.1.1.3", text: "A normal textual result", met: normalText.length > 0, detail: normalText.length ? `${normalText[0].code?.coding?.[0]?.display}` : "Add a urinalysis or other text result that is normal." },
    { id: "2.1.1.4", text: "An abnormal microbiology result", met: micro.length > 0, detail: micro.length ? `${micro[0].code?.coding?.[0]?.display}` : "Add a culture with an organism." },
    { id: "2.1.1.5", text: "A specimen collection entry", met: specimens.length > 0, detail: specimens.length ? `${specimens.length} specimen(s)` : "Collect a specimen before publishing." },
  ];
}

/** Step 2.2.1: the minimum content of an amendment that replaces the original. */
export function labAmendmentMinimums(b: Json): MinStep[] {
  const obs = byType(b, "Observation");
  const comp = compositionOf(b);
  return [
    { id: "2.2.1", text: "Amendment replaces the original: version 2 or higher, status amended or corrected", met: versionOf(b) > 1 && ["amended", "corrected"].includes(comp?.status), detail: `Version ${versionOf(b)}, status ${comp?.status ?? "none"}` },
    { id: "2.2.1.1", text: "One observation is corrected (value or interpretation)", met: obs.some((o) => ["corrected", "amended"].includes(o.status) && (o.hasMember ?? []).length === 0) },
    { id: "2.2.1.2", text: "One observation status is cancelled", met: obs.some((o) => o.status === "cancelled" && (o.hasMember ?? []).length === 0) },
  ];
}
