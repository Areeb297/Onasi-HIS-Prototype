/**
 * Shared FHIR R4 helpers for the NPHIES UHR document bundles (lab and radiology orders and reports).
 * The medication workstream may import from here too, so keep these exports stable.
 *
 * What is in here:
 *  - ids, date-times with the Saudi time zone, identifiers with OIDs, references
 *  - builders for the resources every bundle needs: Patient, Practitioner, PractitionerRole, Organization, Encounter
 *  - a document Bundle builder
 *  - generic validator helpers that return our usual checks ({ level, text })
 *  - a simulated NPHIES response (accepted, or rejected with an OperationOutcome)
 *
 * Page ids in the comments are the Confluence page ids in the nphies-uhr skill snapshot.
 */

import type { Check, Encounter, Patient } from "../model";
import { FACILITY, FACILITY_NAME, OID } from "../reference-data";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/* ---------- constants ---------- */

export const NPHIES_SD = "http://nphies.sa/fhir/ksa/nphies-cs/StructureDefinition/";
export const NPHIES_EXT = "http://nphies.sa/fhir/ksa/nphies-cs/Extension/";

/** Profile URLs from the integration guide. The `|1.0` version suffix is part of the URL. */
export const PROFILE = {
  bundleLabOrder: `${NPHIES_SD}bundleLabOrder|1.0`,
  compositionLabOrder: `${NPHIES_SD}compositionLabOrder|1.0`,
  bundleLabReport: `${NPHIES_SD}bundleLabReport|1.0`,
  compositionLabReport: `${NPHIES_SD}compositionLabReport|1.0`,
  diagnosticReportLab: `${NPHIES_SD}diagnosticreportLabReport|1.0`,
  observationLab: `${NPHIES_SD}observationLabReport|1.0`,
  serviceRequestLabReport: `${NPHIES_SD}servicerequestLabReport|1.0`,
  bundleRadOrder: `${NPHIES_SD}bundleRadOrder|1.0`,
  compositionRadOrder: `${NPHIES_SD}compositionRadOrder|1.0`,
  bundleRadReport: `${NPHIES_SD}bundleRadReport|1.0`,
  compositionRadReport: `${NPHIES_SD}compositionRadReportStructured|1.0`,
  diagnosticReportRad: `${NPHIES_SD}diagnosticreportRadReport|1.0`,
  serviceRequest: `${NPHIES_SD}servicerequest|1.0`,
  additionalOrderInfo: `${NPHIES_SD}AdditionalOrderInformation|1.0`,
  specimen: `${NPHIES_SD}specimen|1.0`,
  patient: `${NPHIES_SD}patient|1.0`,
  practitioner: `${NPHIES_SD}practitioner|1.0`,
  practitionerRole: `${NPHIES_SD}practitionerrole|1.0`,
  organization: `${NPHIES_SD}organization|1.0`,
  encounter: `${NPHIES_SD}encounter|1.0`,
  device: `${NPHIES_SD}device|1.0`,
  imagingProcedure: `${NPHIES_SD}ImagingProcedure|1.0`,
  imagingStudy: `${NPHIES_SD}ImagingStudy|1.0`,
  endpoint: `${NPHIES_SD}Endpoint|1.0`,
} as const;

export const SYS = {
  loinc: "http://loinc.org",
  /** Plain SNOMED CT system. Used where the guide does not name the system. */
  snomed: "http://snomed.info/sct",
  /** SNOMED CT as an OID. The guide asks for this form on Additional Order Information and on incomplete results. */
  snomedOid: "urn:oid:2.16.840.1.113883.6.96",
  ucum: "http://unitsofmeasure.org",
  compositionStatus: "http://hl7.org/fhir/composition-status",
  diagnosticReportStatus: "http://hl7.org/fhir/diagnostic-report-status",
  observationStatus: "http://hl7.org/fhir/observation-status",
  observationCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  referenceRangeMeaning: "http://terminology.hl7.org/CodeSystem/referencerange-meaning",
  identifierType: "http://terminology.hl7.org/CodeSystem/v2-0203",
  participationType: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
  patientClass: "urn:oid:2.16.840.1.113883.18.5",
  confidentiality: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
  dicomModality: "http://dicom.nema.org/resources/ontology/DCM",
  endpointType: "http://terminology.hl7.org/CodeSystem/endpoint-connection-type",
  endpointPayload: "http://terminology.hl7.org/CodeSystem/endpoint-payload-type",
  deviceNameType: "http://hl7.org/fhir/device-nametype",
} as const;

/**
 * How LOINC, UCUM and ICD-10-AM are named on coded values (test and section codes, units, the diagnosis value).
 * The guide does not state the form for these elements. Every official sample bundle (Confluence pages 358776855,
 * 358514693, 387481602, 414089220) uses the OID form, so "oid" is the default. Set it to "url" if a test send shows
 * NPHIES wants the FHIR URLs. Composition.type and DiagnosticReport.code always use http://loinc.org (SYS.loinc),
 * because the guide fixes that value.
 */
export const CODE_SYSTEM_FORM: "oid" | "url" = "oid";

const CODE_SYSTEM_FORMS = {
  oid: { loinc: "urn:oid:2.16.840.1.113883.6.1", ucum: "urn:oid:2.16.840.1.113883.6.8", icd10am: "urn:oid:2.16.840.1.113883.6.135" },
  url: { loinc: "http://loinc.org", ucum: "http://unitsofmeasure.org", icd10am: "http://hl7.org/fhir/sid/icd-10-am" },
} as const;

/** The code system URIs picked by CODE_SYSTEM_FORM. Use these for test codes, section codes, units and diagnoses. */
export const TERM: { loinc: string; ucum: string; icd10am: string } = CODE_SYSTEM_FORMS[CODE_SYSTEM_FORM];

/** Both accepted spellings of each system, for validators. */
export const TERM_FORMS = {
  loinc: [CODE_SYSTEM_FORMS.oid.loinc, CODE_SYSTEM_FORMS.url.loinc],
  ucum: [CODE_SYSTEM_FORMS.oid.ucum, CODE_SYSTEM_FORMS.url.ucum],
  icd10am: [CODE_SYSTEM_FORMS.oid.icd10am, CODE_SYSTEM_FORMS.url.icd10am],
} as const;

/**
 * Encounter.class codes the Encounter page allows with the HL7 Patient Class OID (page id 67961103):
 * E Emergency, I Inpatient, O Outpatient, D Inpatient Daycase.
 */
export const ENCOUNTER_CLASS_CODES = ["E", "I", "O", "D"] as const;

export const EXT = {
  versionNumber: "http://hl7.org/fhir/StructureDefinition/composition-clinicaldocument-versionNumber",
  basedOnOrder: "http://hl7.org/fhir/uv/lab-report/StructureDefinition/composition-basedOn-order-or-requisition",
  diagnosticReportRef: "http://hl7.org/fhir/uv/lab-report/StructureDefinition/composition-diagnosticReportReference",
  reportComposition: "http://hl7.org/fhir/5.0/StructureDefinition/extension-DiagnosticReport.composition",
  specimenHandling: "http://hl7.org/fhir/StructureDefinition/specimen-specialHandling",
  specimenRisk: `${NPHIES_EXT}specimenRisk`,
  specimenReceiver: `${NPHIES_EXT}specimenReceiver`,
  performerFunction: "http://hl7.org/fhir/extensions/StructureDefinition-event-performerFunction.html",
} as const;

/** Saudi Arabia is UTC+3 all year (no daylight saving time). */
export const KSA_TZ = "+03:00";

/* ---------- ids and dates ---------- */

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FHIR_DATETIME_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** A new GUID. Every bundle and every resource id must be one. */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * FHIR date-time with the time zone, as NPHIES asks: YYYY-MM-DDThh:mm:ss+03:00.
 * Local strings from the UI (YYYY-MM-DDTHH:mm) are taken as Saudi clock time.
 * Dates and ISO instants are converted to Saudi time.
 */
export function fhirDateTime(input: Date | string | number = new Date()): string {
  if (typeof input === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return `${input}:00${KSA_TZ}`;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input)) return `${input}${KSA_TZ}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input}T00:00:00${KSA_TZ}`;
  }
  const d = new Date(input);
  const shifted = new Date(d.getTime() + 3 * 3_600_000);
  return `${shifted.toISOString().slice(0, 19)}${KSA_TZ}`;
}

export function addDays(iso: string, days: number): string {
  return fhirDateTime(new Date(new Date(iso).getTime() + days * 86_400_000));
}

/* ---------- small element builders ---------- */

export const oidSystem = (oid: string) => `urn:oid:${oid}`;

export function coding(system: string, code: string, display?: string): Json {
  return display ? { system, code, display } : { system, code };
}

export function codeable(system: string, code: string, display?: string, text?: string): Json {
  return { coding: [coding(system, code, display)], text: text ?? display };
}

export function identifier(system: string, value: string, typeCode?: string): Json {
  return {
    ...(typeCode ? { type: { coding: [coding(SYS.identifierType, typeCode)] } } : {}),
    system,
    value,
  };
}

/** The identifier NPHIES expects for the organization that runs this system (root OID). */
export const orgIdentifier = (value: string, typeCode?: string) => identifier(oidSystem(OID.participant), value, typeCode);

/** Namespace for ids this demo hands out as filler order numbers and specimen ids. Made-up sub-OIDs of the participant OID. */
export const FILLER_OID = `${OID.participant}.3`;
export const SPECIMEN_OID = `${OID.participant}.4`;

export function narrative(text: string): Json {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${esc}</div>` };
}

export function quantity(value: number, unit: string): Json {
  return { value, unit, system: TERM.ucum, code: unit };
}

/** First identifier of a resource (resources may carry one object or a list). */
export function firstIdentifier(res: Json): Json | undefined {
  return Array.isArray(res.identifier) ? res.identifier[0] : res.identifier;
}

/**
 * The identifier a reference to this resource repeats. A PractitionerRole has no identifier of its own in the guide
 * (page id 67993867); the official samples put the Practitioner's provider id on references to a role.
 */
export function referenceIdentifier(res: Json): Json | undefined {
  if (res?.resourceType === "PractitionerRole") {
    const p = res.practitioner?.identifier;
    return Array.isArray(p) ? p[0] : p;
  }
  return firstIdentifier(res ?? {});
}

/**
 * Reference to a resource inside the bundle: "Type/<GUID>" plus the same identifier as the target,
 * which is what the NPHIES pages ask for ("reference/identifier SHALL contain exactly the same Identifier").
 */
export function refTo(res: Json): Json {
  const ident = referenceIdentifier(res);
  return { reference: `${res.resourceType}/${res.id}`, ...(ident ? { identifier: ident } : {}) };
}

export function versionExtension(version: number): Json {
  return { url: EXT.versionNumber, valueString: String(version) };
}

/* ---------- people, organization, patient, encounter ---------- */

export interface Person {
  /** Provider id. Made-up NPI-style value in this demo. */
  id: string;
  name: string;
  title?: string;
}

export function practitionerResource(p: Person): Json {
  // Name, address and telecom are ignored by NPHIES (pulled from the provider registry), so only the identifier is sent.
  return {
    resourceType: "Practitioner",
    id: uuid(),
    meta: { profile: [PROFILE.practitioner] },
    identifier: [identifier(oidSystem(OID.provider), p.id)],
  };
}

export function organizationResource(): Json {
  return {
    resourceType: "Organization",
    id: uuid(),
    meta: { profile: [PROFILE.organization] },
    identifier: [identifier(oidSystem(OID.nphiesApp), FACILITY)],
  };
}

export function practitionerRoleResource(_p: Person, practitioner: Json, org: Json): Json {
  return {
    resourceType: "PractitionerRole",
    id: uuid(),
    meta: { profile: [PROFILE.practitionerRole] },
    // No identifier: the PractitionerRole page lists none. References to a role repeat the Practitioner's identifier.
    practitioner: refTo(practitioner),
    organization: refTo(org),
  };
}

export function patientResource(p: Patient): Json {
  // Name, gender, birth date and address are ignored by NPHIES (taken from the NHIC registry), so only the Health ID is sent.
  return {
    resourceType: "Patient",
    id: uuid(),
    meta: { profile: [PROFILE.patient] },
    identifier: [identifier(oidSystem(OID.healthId), p.healthId)],
  };
}

/**
 * Encounter.class for the HL7 Patient Class OID. The ADT pre-admit class "P" must not be sent here: in the NPHIES
 * Patient Class value set (page id 23134851) "P" means primary care under a different code system. A pre-admitted
 * patient is not an inpatient yet, so the visit is sent as outpatient (O) until the admission.
 */
export function encounterClassCode(cls: string): string {
  return (ENCOUNTER_CLASS_CODES as readonly string[]).includes(cls) ? cls : "O";
}

export function encounterResource(enc: Encounter, fallbackStart: string): Json {
  const start = enc.admitAt ?? enc.expectedAdmitAt ?? fallbackStart;
  return {
    resourceType: "Encounter",
    id: uuid(),
    meta: { profile: [PROFILE.encounter] },
    // One visit number everywhere: the same value as PV1-19 in the ADT messages.
    identifier: [orgIdentifier(enc.visitNumber)],
    status: enc.status === "discharged" ? "finished" : "in-progress",
    class: coding(SYS.patientClass, encounterClassCode(enc.cls)),
    period: {
      start: fhirDateTime(start),
      ...(enc.dischargeAt ? { end: fhirDateTime(enc.dischargeAt) } : {}),
    },
    serviceProvider: { display: FACILITY_NAME },
  };
}

/** The standard set of participants most bundles share. */
export interface Participants {
  patient: Json;
  org: Json;
  encounter: Json;
  /** Practitioner and role per person id. */
  roles: Record<string, { practitioner: Json; role: Json }>;
}

export function buildParticipants(patient: Patient, enc: Encounter, people: Person[], fallbackStart: string): Participants {
  const org = organizationResource();
  const roles: Participants["roles"] = {};
  for (const p of people) {
    if (roles[p.id]) continue;
    const practitioner = practitionerResource(p);
    roles[p.id] = { practitioner, role: practitionerRoleResource(p, practitioner, org) };
  }
  return { patient: patientResource(patient), org, encounter: encounterResource(enc, fallbackStart), roles };
}

export function participantResources(p: Participants): Json[] {
  const list: Json[] = [p.patient, p.org, p.encounter];
  for (const r of Object.values(p.roles)) list.push(r.role, r.practitioner);
  return list;
}

/* ---------- bundle ---------- */

export function makeBundle(args: { profile: string; identifierValue: string; resources: Json[]; timestamp?: string }): Json {
  return {
    resourceType: "Bundle",
    id: uuid(),
    meta: { profile: [args.profile] },
    identifier: orgIdentifier(args.identifierValue),
    type: "document",
    timestamp: args.timestamp ?? fhirDateTime(),
    // The first entry of a document Bundle is the Composition. fullUrl carries the resource id.
    entry: args.resources.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
  };
}

/* ---------- reading a bundle ---------- */

export const resourcesOf = (b: Json): Json[] => ((b?.entry ?? []) as Json[]).map((e) => e.resource as Json).filter(Boolean);
export const byType = (b: Json, type: string): Json[] => resourcesOf(b).filter((r) => r.resourceType === type);
export const findByRef = (b: Json, ref?: string): Json | undefined => {
  if (!ref) return undefined;
  const [type, id] = ref.split("/");
  return resourcesOf(b).find((r) => r.resourceType === type && r.id === id);
};

/** Visit every object that has a string "reference" property. */
export function walkReferences(node: unknown, visit: (ref: Json, path: string) => void, path = "$"): void {
  if (Array.isArray(node)) node.forEach((n, i) => walkReferences(n, visit, `${path}[${i}]`));
  else if (node && typeof node === "object") {
    const o = node as Json;
    if (typeof o.reference === "string") visit(o, path);
    for (const [k, v] of Object.entries(o)) walkReferences(v, visit, `${path}.${k}`);
  }
}

/* ---------- validator helpers ---------- */

export const ok = (text: string): Check => ({ level: "ok", text });
export const warn = (text: string): Check => ({ level: "warn", text });
export const err = (text: string): Check => ({ level: "error", text });

/** Push an error when `cond` is false, an ok line when it is true. */
export function need(checks: Check[], cond: unknown, okText: string, errText: string, level: "error" | "warn" = "error"): boolean {
  checks.push(cond ? ok(okText) : level === "error" ? err(errText) : warn(errText));
  return !!cond;
}

export function countLevels(checks: Check[]): { errors: number; warnings: number } {
  return { errors: checks.filter((c) => c.level === "error").length, warnings: checks.filter((c) => c.level === "warn").length };
}

const sameIdentifier = (a?: Json, b?: Json) => !!a && !!b && a.system === b.system && a.value === b.value;

/** Checks every NPHIES document Bundle must pass (Bundle page of each use case). */
export function validateBundleBase(b: Json, o: { profile: string; label: string; compositionProfile: string }): Check[] {
  const c: Check[] = [];
  need(c, b?.resourceType === "Bundle", "Resource type is Bundle.", "Resource type must be Bundle.");
  need(c, b?.type === "document", "Bundle.type is document.", "Bundle.type must be document.");
  need(c, GUID_RE.test(b?.id ?? ""), "Bundle.id is a GUID.", "Bundle.id must be a GUID.");
  need(c, (b?.meta?.profile ?? []).includes(o.profile), `Bundle profile is ${o.profile}.`, `Bundle.meta.profile must be ${o.profile}.`);
  const ident = b?.identifier;
  need(
    c,
    ident?.system?.startsWith("urn:oid:") && ident?.value,
    "Bundle.identifier has the organization root OID and a local value.",
    "Bundle.identifier needs system urn:oid:<root OID> and a value.",
  );
  need(c, FHIR_DATETIME_TZ.test(b?.timestamp ?? ""), "Bundle.timestamp has a time zone.", "Bundle.timestamp needs date, time and time zone.");
  const entries = (b?.entry ?? []) as Json[];
  need(c, entries.length > 0, `${entries.length} entries in the bundle.`, "The bundle has no entries.");
  need(
    c,
    entries.every((e) => e.resource && e.fullUrl === `urn:uuid:${e.resource.id}`),
    "Every entry fullUrl matches the resource id.",
    "Every entry fullUrl must be urn:uuid: plus the resource id.",
  );
  need(c, entries.every((e) => GUID_RE.test(e.resource?.id ?? "")), "Every resource id is a GUID.", "Every resource id must be a GUID.");
  const first = entries[0]?.resource;
  need(c, first?.resourceType === "Composition", "The first entry is the Composition.", "The first entry must be the Composition.");
  need(
    c,
    (first?.meta?.profile ?? []).includes(o.compositionProfile),
    `Composition profile is ${o.compositionProfile.split("/").pop()}.`,
    `Composition.meta.profile must be ${o.compositionProfile}.`,
  );
  return c;
}

/** Every reference points at a resource in the bundle, and its identifier matches the target. */
export function validateReferences(b: Json): Check[] {
  const missing: string[] = [];
  const mismatched: string[] = [];
  let count = 0;
  walkReferences(b, (ref, path) => {
    if (path.startsWith("$.entry[") === false) return;
    count++;
    const target = findByRef(b, ref.reference);
    if (!target) missing.push(`${ref.reference} (${path})`);
    else if (ref.identifier && !sameIdentifier(ref.identifier, referenceIdentifier(target))) mismatched.push(`${ref.reference} (${path})`);
  });
  const c: Check[] = [];
  need(c, missing.length === 0, `All ${count} references resolve inside the bundle.`, `References not found in the bundle: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}.`);
  need(
    c,
    mismatched.length === 0,
    "Every reference/identifier matches the identifier of the target.",
    `reference/identifier differs from the target identifier: ${mismatched.slice(0, 3).join(", ")}.`,
  );
  return c;
}

/** Patient, Practitioner, PractitionerRole, Organization and Encounter rules shared by all four use cases. */
export function validateParticipants(
  b: Json,
  o: { minRoles: number; minPractitioners: number; visitNumber?: string; healthId?: string },
): Check[] {
  const c: Check[] = [];
  const patients = byType(b, "Patient");
  need(c, patients.length === 1, "One Patient resource.", `Exactly one Patient is required, found ${patients.length}.`);
  const pid = firstIdentifier(patients[0] ?? {});
  need(c, pid?.system === oidSystem(OID.healthId) && !!pid?.value, "Patient.identifier is the Health ID with the NHIC OID.", `Patient.identifier must be the Health ID with system ${oidSystem(OID.healthId)}.`);
  if (o.healthId) need(c, pid?.value === o.healthId, "Patient Health ID matches the chart.", "Patient Health ID differs from the chart.");
  need(
    c,
    !patients[0] || !("name" in patients[0] || "gender" in patients[0] || "birthDate" in patients[0]),
    "No demographics sent (NPHIES ignores them).",
    "Name, gender and birth date are ignored by NPHIES. Remove them.",
    "warn",
  );
  const roles = byType(b, "PractitionerRole");
  const pracs = byType(b, "Practitioner");
  need(c, roles.length >= o.minRoles, `${roles.length} PractitionerRole resources.`, `At least ${o.minRoles} PractitionerRole resources are required, found ${roles.length}.`);
  need(c, pracs.length >= o.minPractitioners, `${pracs.length} Practitioner resources.`, `At least ${o.minPractitioners} Practitioner resources are required, found ${pracs.length}.`);
  need(
    c,
    pracs.every((p) => firstIdentifier(p)?.system === oidSystem(OID.provider) && firstIdentifier(p)?.value),
    "Every Practitioner has a provider id with the provider OID.",
    `Practitioner.identifier needs system ${oidSystem(OID.provider)} and a value.`,
  );
  need(c, roles.every((r) => r.practitioner?.reference && r.organization?.reference), "Every PractitionerRole links a Practitioner and an Organization.", "PractitionerRole needs practitioner and organization.");
  need(c, roles.every((r) => !("identifier" in r)), "No PractitionerRole carries its own identifier.", "PractitionerRole has an identifier. The guide lists none; references to a role repeat the Practitioner identifier.", "warn");
  const orgs = byType(b, "Organization");
  need(c, orgs.length >= 1, `${orgs.length} Organization resource.`, "At least one Organization is required.");
  need(
    c,
    orgs.every((g) => firstIdentifier(g)?.system === oidSystem(OID.nphiesApp) && firstIdentifier(g)?.value),
    "Organization.identifier uses the provider-directory OID.",
    `Organization.identifier needs system ${oidSystem(OID.nphiesApp)} and a value.`,
  );
  const encs = byType(b, "Encounter");
  if (encs.length) {
    const e = encs[0];
    const vis = firstIdentifier(e)?.value;
    if (o.visitNumber) need(c, vis === o.visitNumber, `Encounter carries the visit number ${o.visitNumber}.`, `Encounter.identifier is ${vis ?? "empty"}, expected the chart visit number ${o.visitNumber}.`);
    else need(c, !!vis, "Encounter has a visit number.", "Encounter.identifier is empty.");
    need(
      c,
      e.class?.system === "urn:oid:2.16.840.1.113883.18.5" && ["E", "I", "O", "D"].includes(e.class?.code),
      `Encounter.class is ${e.class?.code} with the HL7 Patient Class OID.`,
      "Encounter.class needs system urn:oid:2.16.840.1.113883.18.5 and one of E, I, O, D.",
    );
    need(c, !!e.period?.start, "Encounter.period.start is present.", "Encounter.period.start is required.");
    need(c, !!e.serviceProvider?.display, "Encounter.serviceProvider.display is present.", "Encounter.serviceProvider.display is required.");
  } else {
    c.push(warn("No Encounter in the bundle. It is optional if known, but the visit number links the document to ADT."));
  }
  return c;
}

/* ---------- simulated NPHIES response ---------- */

export interface OperationOutcome {
  resourceType: "OperationOutcome";
  id: string;
  issue: { severity: "fatal" | "error" | "warning" | "information"; code: string; details: { text: string }; diagnostics?: string }[];
}

export interface NphiesResponse {
  status: "accepted" | "rejected";
  http: number;
  at: string;
  /** Simulated transaction id. */
  transactionId: string;
  outcome: OperationOutcome;
}

/**
 * Pretend to be NPHIES. Not a real call.
 * Accepts the document when it has no validation errors. Rejects with an OperationOutcome when:
 *  - the tester asked for a rejection (forceReject),
 *  - the validator found errors (HTTP 400),
 *  - an amendment has no accepted original to replace (HTTP 422),
 *  - the same document identifier was already accepted (HTTP 409).
 */
export function simulateNphies(args: {
  label: string;
  checks: Check[];
  version: number;
  hasAcceptedOriginal: boolean;
  duplicate?: boolean;
  forceReject?: boolean;
}): NphiesResponse {
  const at = new Date().toISOString();
  const transactionId = `SIM-${uuid().slice(0, 8).toUpperCase()}`;
  const issues: OperationOutcome["issue"] = [];
  let http = 200;
  const errors = args.checks.filter((c) => c.level === "error");

  if (args.forceReject) {
    http = 500;
    issues.push({ severity: "error", code: "processing", details: { text: "Simulated rejection requested by the tester." }, diagnostics: "Turn the switch off to get a normal response." });
  } else if (errors.length) {
    http = 400;
    for (const e of errors) issues.push({ severity: "error", code: "invalid", details: { text: e.text } });
  } else if (args.duplicate) {
    http = 409;
    issues.push({ severity: "error", code: "duplicate", details: { text: "A document with this identifier was already accepted." } });
  } else if (args.version > 1 && !args.hasAcceptedOriginal) {
    http = 422;
    issues.push({ severity: "error", code: "not-found", details: { text: "The original document to replace was not found." }, diagnostics: "Send the original (version 1) and get it accepted first." });
  }

  if (issues.length) {
    return { status: "rejected", http, at, transactionId, outcome: { resourceType: "OperationOutcome", id: uuid(), issue: issues } };
  }
  const warns = args.checks.filter((c) => c.level === "warn");
  const accepted: OperationOutcome["issue"] = [
    {
      severity: "information",
      code: "informational",
      details: { text: args.version > 1 ? `${args.label} version ${args.version} accepted. It replaces the earlier version.` : `${args.label} accepted.` },
    },
    ...warns.map((w) => ({ severity: "warning" as const, code: "informational", details: { text: w.text } })),
  ];
  return { status: "accepted", http, at, transactionId, outcome: { resourceType: "OperationOutcome", id: uuid(), issue: accepted } };
}
