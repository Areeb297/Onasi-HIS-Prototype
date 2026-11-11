/**
 * Builders for the two NPHIES laboratory documents:
 *  - Laboratory Order Bundle (bundleLabOrder|1.0), Confluence page ids 351502348, 351698947, 351797257, 358580229, 359071746, 359432193
 *  - Laboratory Report Bundle (bundleLabReport|1.0), page ids 63701020, 68091912, 67993636 to 68026555
 *
 * The builders are pure: give them the chart data and they return the JSON. Nothing is stored or sent here.
 */

import type { Encounter, Patient } from "../model";
import { OID } from "../reference-data";
import {
  EXT, FILLER_OID, PROFILE, SPECIMEN_OID, SYS, addDays, buildParticipants, codeable, coding, fhirDateTime, identifier, makeBundle,
  narrative, orgIdentifier, oidSystem, participantResources, quantity, refTo, uuid, versionExtension, type Json, type Person,
} from "./common";
import {
  ANTIBIOTICS, INTERP_TEXT, LAB_DEPTS, SPECIMEN_TYPES, parseNumeric, refTextFor, structuredRange, testByCode, unitText,
  type LabDept, type LabTest,
} from "./lab-catalog";
import type { DocStatus, LabOrder, LabResult, LabSpecimen, ObsStatus } from "./types";

export interface LabBuildCtx {
  patient: Patient;
  enc: Encounter;
  order: LabOrder;
  /** The ordering physician. */
  orderer: Person;
  version: number;
  docStatus: DocStatus;
  /** ISO time used for the bundle timestamp and the document date. Defaults to now. */
  now?: string;
}

export interface LabReportCtx extends LabBuildCtx {
  /** The technologist who performed the tests (author and test performer). */
  performer: Person;
  /** The pathologist or lab director who signs the report (legal authenticator). */
  authenticator: Person;
}

export const labOrderSetId = (o: LabOrder) => `${o.id}-ORD`;
export const labReportSetId = (o: LabOrder) => `${o.id}-RPT`;

const ageYears = (dob: string, at: string) => Math.max(0, Math.floor((new Date(at).getTime() - new Date(dob).getTime()) / (365.25 * 86_400_000)));

/** Snapshot of what the lab section of a document needs to know about each ordered test. */
const orderedTests = (order: LabOrder): LabTest[] => order.codes.map((c) => testByCode(c)).filter((t): t is LabTest => !!t);

export function specimenResource(s: LabSpecimen, forReport: boolean, receiverRole?: Json): Json {
  const type = SPECIMEN_TYPES[s.key];
  return {
    resourceType: "Specimen",
    id: uuid(),
    meta: { profile: [PROFILE.specimen] },
    identifier: [identifier(oidSystem(SPECIMEN_OID), s.id)],
    type: codeable(SYS.snomed, type.code, type.display),
    collection: { collectedDateTime: fhirDateTime(s.collectedAt) },
    // receivedTime and the receiver are for REPORTS only. They must not be in an ORDER.
    ...(forReport
      ? {
          receivedTime: fhirDateTime(s.receivedAt ?? s.collectedAt),
          ...(receiverRole ? { extension: [{ url: EXT.specimenReceiver, valueReference: refTo(receiverRole) }] } : {}),
        }
      : {}),
  };
}

const deptSection = (dept: LabDept, text: string, entries: Json[]): Json => ({
  title: LAB_DEPTS[dept],
  code: { coding: [coding(SYS.labDepartment, dept, LAB_DEPTS[dept])], text: LAB_DEPTS[dept] },
  text: narrative(text),
  entry: entries,
});

const placerIdentifier = (order: LabOrder, i: number) => identifier(oidSystem(OID.participant), `${order.id}-${i + 1}`, "PLAC");

/* ======================================================================== */
/* Laboratory Order                                                          */
/* ======================================================================== */

export function buildLabOrderBundle(ctx: LabBuildCtx): Json {
  const { patient, enc, order, orderer } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const nowDt = fhirDateTime(now);
  const parts = buildParticipants(patient, enc, [orderer], order.orderedAt);
  const role = parts.roles[orderer.id].role;
  const tests = orderedTests(order);

  const specimens = order.specimens.map((s) => ({ key: s.key, res: specimenResource(s, false) }));

  const srs = tests.map((t, i) => {
    const sp = specimens.find((s) => s.key === t.specimen);
    return {
      test: t,
      res: {
        resourceType: "ServiceRequest",
        id: uuid(),
        meta: { profile: [PROFILE.serviceRequest] },
        identifier: [placerIdentifier(order, i)],
        status: "active", // an ORDER is always active. The cancellation lives in Composition.status.
        intent: "order",
        priority: order.priority,
        code: codeable(SYS.loinc, t.code, t.display),
        subject: refTo(parts.patient),
        requester: refTo(role),
        occurrencePeriod: { start: fhirDateTime(order.orderedAt), end: addDays(order.orderedAt, 30) },
        ...(sp ? { specimen: [refTo(sp.res)] } : {}),
      } as Json,
    };
  });

  // Additional Order Information. The bundle page wants at least one, so the age is always sent.
  const based = srs.map((s) => refTo(s.res));
  const aoi = (code: string, display: string, value: Json): Json => {
    const id = uuid();
    return {
      resourceType: "Observation",
      id,
      meta: { profile: [PROFILE.additionalOrderInfo] },
      identifier: [orgIdentifier(`${order.id}-AOI-${code}`)],
      basedOn: based,
      status: "final",
      code: { coding: [coding(SYS.snomedOid, code, display)], text: display },
      subject: refTo(parts.patient),
      effectiveDateTime: nowDt,
      ...value,
    };
  };
  const extra: Json[] = [];
  const dx = enc.dx[0];
  if (dx) {
    extra.push(aoi("148006", "Preliminary diagnosis", { valueCodeableConcept: { coding: [coding("http://hl7.org/fhir/sid/icd-10-am", dx.code, dx.text)], text: dx.text } }));
  }
  extra.push(aoi("424144002", "Current Chronological Age", { valueQuantity: { value: ageYears(patient.dob, now), unit: "years", system: SYS.ucum, code: "a" } }));
  const kg = Number(enc.vitals?.weight);
  if (kg > 0) extra.push(aoi("363808001", "Body Weight Measure", { valueQuantity: quantity(kg, "kg") }));
  if (order.fasting === true) extra.push(aoi("16985007", "Fasting", { valueBoolean: true }));
  if (order.fasting === false) extra.push(aoi("440565004", "Nonfasting", { valueBoolean: true }));

  // One section per laboratory department.
  const depts = [...new Set(tests.map((t) => t.dept))];
  const sections = depts.map((d, idx) => {
    const inDept = srs.filter((s) => s.test.dept === d);
    const text = inDept.map((s) => s.test.short).join(", ") + (idx === 0 && order.note ? `. Note: ${order.note}` : "");
    const entries = inDept.map((s) => refTo(s.res));
    if (idx === 0) entries.push(...extra.map(refTo));
    return deptSection(d, text, entries);
  });

  const composition: Json = {
    resourceType: "Composition",
    id: uuid(),
    meta: { profile: [PROFILE.compositionLabOrder] },
    extension: [versionExtension(ctx.version)],
    identifier: orgIdentifier(labOrderSetId(order)),
    status: ctx.docStatus,
    type: codeable(SYS.loinc, "57832-8", "Prescription for diagnostic or specialist care"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    date: nowDt,
    author: [refTo(role)],
    title: "Laboratory Order",
    confidentiality: "N",
    custodian: refTo(parts.org),
    section: sections,
  };

  return makeBundle({
    profile: PROFILE.bundleLabOrder,
    identifierValue: `${labOrderSetId(order)}-v${ctx.version}`,
    timestamp: nowDt,
    resources: [composition, ...srs.map((s) => s.res), ...extra, ...specimens.map((s) => s.res), ...participantResources(parts)],
  });
}

/* ======================================================================== */
/* Laboratory Report (results)                                               */
/* ======================================================================== */

/** What a result looks like to people: "9.8 g/dL". */
export function formatResult(t: LabTest, r: LabResult): string {
  if (t.kind === "organism") return r.organism ? r.organism.display : r.value || "No growth";
  const v = r.value.trim();
  const u = unitText(t);
  return u && parseNumeric(v) ? `${v} ${u}` : v;
}

function resultValue(t: LabTest, r: LabResult): Json {
  const v = r.value.trim();
  if (t.kind === "organism") {
    if (r.organism) return { valueCodeableConcept: { coding: [coding(SYS.snomed, r.organism.code, r.organism.display)], text: r.organism.display } };
    return { valueString: v || "No growth" };
  }
  const num = parseNumeric(v);
  if (t.kind === "quantity" && num && !num.op && t.unit) return { valueQuantity: quantity(num.n, t.unit) };
  if (t.kind === "integer" && num && !num.op && Number.isInteger(num.n)) return { valueInteger: num.n };
  return { valueString: v };
}

function referenceRange(t: LabTest, sex: "M" | "F"): Json {
  const sr = structuredRange(t, sex);
  const rr: Json = { type: { coding: [coding(SYS.referenceRangeMeaning, "normal", "Normal Range")] }, text: refTextFor(t, sex) };
  if (sr && t.unit) {
    if (sr.low !== undefined) rr.low = quantity(sr.low, t.unit);
    if (sr.high !== undefined) rr.high = quantity(sr.high, t.unit);
  }
  return rr;
}

/** Status of a panel follows its members: all cancelled means cancelled, any change means corrected. */
function panelStatus(members: ObsStatus[]): ObsStatus {
  if (members.length && members.every((s) => s === "cancelled")) return "cancelled";
  if (members.some((s) => s === "corrected" || s === "amended")) return "corrected";
  return "final";
}

export function buildLabReportBundle(ctx: LabReportCtx): Json {
  const { patient, enc, order, orderer, performer, authenticator } = ctx;
  const now = ctx.now ?? new Date().toISOString();
  const reportDt = fhirDateTime(now);
  const parts = buildParticipants(patient, enc, [performer, authenticator, orderer], order.orderedAt);
  const techRole = parts.roles[performer.id].role;
  const authRole = parts.roles[authenticator.id].role;
  const orderRole = parts.roles[orderer.id].role;
  const startDt = fhirDateTime(order.specimens[0]?.collectedAt ?? order.orderedAt);

  const specimens = order.specimens.map((s) => ({ key: s.key, res: specimenResource(s, true, techRole) }));

  const srs = orderedTests(order).map((t, i) => ({
    test: t,
    res: {
      resourceType: "ServiceRequest",
      id: uuid(),
      meta: { profile: [PROFILE.serviceRequestLabReport] },
      identifier: [placerIdentifier(order, i), identifier(oidSystem(FILLER_OID), `${order.id.replace("LO-", "ACC")}-${i + 1}`, "FILL")],
      status: "completed",
      intent: "order",
      priority: order.priority,
      code: codeable(SYS.loinc, t.code, t.display),
      subject: refTo(parts.patient),
      requester: refTo(orderRole),
      occurrencePeriod: { start: fhirDateTime(order.orderedAt), end: addDays(order.orderedAt, 30) },
    } as Json,
  }));

  const observations: Json[] = [];
  /** Top-level results per department, for the composition sections and DiagnosticReport.result. */
  const topLevel: { dept: LabDept; obs: Json; text: string }[] = [];

  const leaf = (t: LabTest, sr: Json): { obs: Json; text: string } | null => {
    const r = order.results[t.code];
    if (!r) return null;
    const sp = specimens.find((s) => s.key === t.specimen);
    const obs: Json = {
      resourceType: "Observation",
      id: uuid(),
      meta: { profile: [PROFILE.observationLab] },
      identifier: [orgIdentifier(`${order.id}-${t.code}`)],
      basedOn: [refTo(sr)],
      status: r.status,
      category: [{ coding: [coding(SYS.observationCategory, "laboratory", "Laboratory")] }],
      code: codeable(SYS.loinc, t.code, t.display),
      subject: refTo(parts.patient),
      effectivePeriod: { start: startDt, end: fhirDateTime(r.at) },
      performer: [refTo(techRole)],
      ...resultValue(t, r),
      interpretation: [{ coding: [coding(SYS.interpretation, r.interp, INTERP_TEXT[r.interp])], text: INTERP_TEXT[r.interp] }],
      ...(sp ? { specimen: refTo(sp.res) } : {}),
      referenceRange: [referenceRange(t, patient.sex)],
      ...(r.note || (t.kind === "organism" && r.value && r.organism) ? { note: [{ text: r.note || r.value }] } : {}),
    };
    observations.push(obs);
    return { obs, text: `${t.short}: ${formatResult(t, r)} (${INTERP_TEXT[r.interp]})` };
  };

  for (const { test: t, res: sr } of srs) {
    if (t.panel) {
      const members = t.panel.map((c) => testByCode(c)).filter((m): m is LabTest => !!m).map((m) => ({ m, l: leaf(m, sr) })).filter((x) => x.l);
      if (!members.length) continue;
      const ends = members.map((x) => (x.l!.obs.effectivePeriod as Json).end as string).sort();
      const panelObs: Json = {
        resourceType: "Observation",
        id: uuid(),
        meta: { profile: [PROFILE.observationLab] },
        identifier: [orgIdentifier(`${order.id}-${t.code}`)],
        basedOn: [refTo(sr)],
        status: panelStatus(members.map((x) => order.results[x.m.code].status)),
        category: [{ coding: [coding(SYS.observationCategory, "laboratory", "Laboratory")] }],
        code: codeable(SYS.loinc, t.code, t.display),
        subject: refTo(parts.patient),
        effectivePeriod: { start: startDt, end: ends[ends.length - 1] },
        performer: [refTo(techRole)],
        // A panel has no value of its own, only members.
        referenceRange: [{ type: { coding: [coding(SYS.referenceRangeMeaning, "normal", "Normal Range")] }, text: "undefined" }],
        hasMember: members.map((x) => refTo(x.l!.obs)),
      };
      observations.push(panelObs);
      topLevel.push({ dept: t.dept, obs: panelObs, text: `${t.short}: ${members.map((x) => x.l!.text).join("; ")}` });
    } else {
      const l = leaf(t, sr);
      if (!l) continue;
      topLevel.push({ dept: t.dept, obs: l.obs, text: l.text });
      // Culture sensitivities are separate observations in the same section.
      const r = order.results[t.code];
      if (t.kind === "organism" && r?.sens?.length) {
        for (const s of r.sens) {
          const abx = ANTIBIOTICS.find((a) => a.key === s.key);
          if (!abx) continue;
          const sp = specimens.find((x) => x.key === t.specimen);
          const sObs: Json = {
            resourceType: "Observation",
            id: uuid(),
            meta: { profile: [PROFILE.observationLab] },
            identifier: [orgIdentifier(`${order.id}-${t.code}-${abx.key}`)],
            basedOn: [refTo(sr)],
            status: r.status === "cancelled" ? "cancelled" : r.status,
            category: [{ coding: [coding(SYS.observationCategory, "laboratory", "Laboratory")] }],
            code: codeable(SYS.loinc, abx.code, abx.display), // made-up
            subject: refTo(parts.patient),
            effectivePeriod: { start: startDt, end: fhirDateTime(r.at) },
            performer: [refTo(techRole)],
            valueCodeableConcept: { coding: [coding(SYS.interpretation, s.result, s.result === "S" ? "Susceptible" : s.result === "I" ? "Intermediate" : "Resistant")], text: s.result },
            interpretation: [{ coding: [coding(SYS.interpretation, s.result)] }],
            ...(sp ? { specimen: refTo(sp.res) } : {}),
            referenceRange: [{ type: { coding: [coding(SYS.referenceRangeMeaning, "normal", "Normal Range")] }, text: "undefined" }],
          };
          observations.push(sObs);
          topLevel.push({ dept: t.dept, obs: sObs, text: `${abx.display.replace(" [Susceptibility]", "")}: ${s.result}` });
        }
      }
    }
  }

  const composition: Json = {
    resourceType: "Composition",
    id: uuid(),
    meta: { profile: [PROFILE.compositionLabReport] },
    identifier: orgIdentifier(labReportSetId(order)),
    status: ctx.docStatus,
    type: codeable(SYS.loinc, "11502-2", "LABORATORY REPORT"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    date: reportDt,
    author: [refTo(techRole)],
    title: "Laboratory Report",
    confidentiality: "N",
    attester: [{ mode: "legal", party: refTo(authRole) }],
    custodian: refTo(parts.org),
  };
  const report: Json = {
    resourceType: "DiagnosticReport",
    id: uuid(),
    meta: { profile: [PROFILE.diagnosticReportLab] },
    identifier: [orgIdentifier(`${order.id}-DR`)],
    status: ctx.docStatus,
    code: codeable(SYS.loinc, "11502-2", "LABORATORY REPORT"),
    subject: refTo(parts.patient),
    encounter: refTo(parts.encounter),
    // The end of this period must equal the date of the Composition.
    effectivePeriod: { start: startDt, end: reportDt },
    ...(specimens.length ? { specimen: specimens.map((s) => refTo(s.res)) } : {}),
    result: topLevel.map((x) => refTo(x.obs)),
  };
  composition.extension = [
    versionExtension(ctx.version),
    ...srs.map((s) => ({ url: EXT.basedOnOrder, valueReference: refTo(s.res) })),
    { url: EXT.diagnosticReportRef, valueReference: refTo(report) },
  ];
  report.extension = [{ url: EXT.reportComposition, valueReference: refTo(composition) }];

  const depts = [...new Set(topLevel.map((x) => x.dept))];
  composition.section = depts.map((d) => {
    const items = topLevel.filter((x) => x.dept === d);
    return deptSection(d, items.map((x) => x.text).join(". "), items.map((x) => refTo(x.obs)));
  });

  return makeBundle({
    profile: PROFILE.bundleLabReport,
    identifierValue: `${labReportSetId(order)}-v${ctx.version}`,
    timestamp: reportDt,
    resources: [composition, report, ...observations, ...srs.map((s) => s.res), ...specimens.map((s) => s.res), ...participantResources(parts)],
  });
}
