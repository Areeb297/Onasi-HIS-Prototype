import { OID, ORG_OID } from "../reference-data";
import { FREQ_BY_ID, OVERRIDE_LABEL, ROUTE_BY_CODE, ROUTE_LABEL } from "../rx-catalogue";
import { addDays } from "../rx-logic";
import type { ControlClass, Drug, DispenseLine, Frequency, ItemStatus, RxItem, UsageSetting } from "../rx-types";

/**
 * FHIR R4 builders for the nphies Medication Prescription and Dispense (Raqeeb) messages.
 * Follows the Confluence guide (page ids in the comments) and the official sample messages
 * ("Sample Messages" page 125206589 and "Samples - Raqeeb" page 927268883).
 *
 * Two kinds of codes are sent:
 *  - real code systems and codes, where the guide or an official sample shows them;
 *  - demo codes, always with the prefix DEMO-, where the real value set is in IS0200 and was not available.
 *    Every demo code is listed in ASSUMPTIONS and raised as a warning by the validator.
 */

export type Json = Record<string, unknown>;

export interface FhirBundle extends Json {
  resourceType: "Bundle";
  id: string;
  meta: { profile: string[] };
  type: "message";
  timestamp: string;
  entry: { fullUrl: string; resource: Json }[];
}

const SD = "http://nphies.sa/fhir/ksa/nphies-cs/StructureDefinition/";
const EXT = "http://nphies.sa/fhir/ksa/nphies-cs/Extension/";
export const PROFILE = {
  bundlePrescription: `${SD}bundlePrescription|1.0`,
  bundleDispense: `${SD}bundleDispense|1.0`,
  messageHeader: `${SD}messageheader|1.0`,
  patient: `${SD}patient|1.0`,
  practitioner: `${SD}practitioner|1.0`,
  practitionerRole: `${SD}practitionerrole|1.0`,
  organization: `${SD}organization|1.0`,
  encounter: `${SD}encounter|1.0`,
  allergy: `${SD}AllergyIntolerance|1.0`,
  additionalOrderInfo: `${SD}additionalorderinformation|1.0`,
  medicationRequest: `${SD}medicationrequest|1.0`,
  medicationPrescribed: `${SD}medicationprescribed|1.0`,
  medicationDispense: `${SD}medicationdispense|1.0`,
  medicationDispensed: `${SD}medicationdispensed|1.0`,
  medicationKnowledge: `${SD}medicationknowledge|1.0`,
} as const;

/** Prefix of every code that is a stand-in for an IS0200 value this app could not load. */
export const DEMO_PREFIX = "DEMO-";

/**
 * One root OID for every identifier this system hands out (prescription items, prescriptions, dispenses, visits).
 * It is ORG_OID from reference-data, the same organisation OID the ADT messages use as the assigning authority of the
 * visit number (PV1-19), so nphies can link them. The real OID is assigned at onboarding.
 */
const LOCAL_ROOT = `urn:oid:${ORG_OID}`;

export const SYS = {
  healthId: `urn:oid:${OID.healthId}`,
  provider: `urn:oid:${OID.provider}`,
  organization: `urn:oid:${OID.nphiesApp}`,
  snomed: "urn:oid:2.16.840.1.113883.6.96",
  icd: "urn:oid:2.16.840.1.113883.6.135",
  encounterClass: "urn:oid:2.16.840.1.113883.18.5",
  actCode: "urn:oid:2.16.840.1.113883.5.4",
  eventCoding: "http://nphies.sa/fhir/ksa/nphies-cs/terminology/CodeSystem/EventCoding",
  // Code systems shown in the official sample messages.
  /** KSA Medication Prescription Type */
  rxType: "urn:oid:2.16.840.1.113883.3.3731.1.205.14",
  /** Prescription Category Codes (usage setting) */
  usage: "urn:oid:2.16.840.1.113883.4.642.3.1322",
  /** KSA Prescription Pharmacy Item Name (generic MRID) */
  drug: "urn:oid:2.16.840.1.113883.3.3731.1.205.1",
  /** KSA Dispensation Pharmacy Item Name (brand MRID) */
  product: "urn:oid:2.16.840.1.113883.3.3731.1.205.2",
  /** KSA Medication Pharmaceutical Dose Form */
  form: "urn:oid:2.16.840.1.113883.3.3731.1.205.8",
  /** KSA Medication Package Form */
  packForm: "urn:oid:2.16.840.1.113883.3.3731.1.205.9",
  /** KSA Individual Provider Type */
  providerType: "urn:oid:2.16.840.1.113883.3.3731.1.202.1",
  /** Healthcare Specialty Identifier */
  specialty: "urn:oid:2.16.840.1.113883.3.3731.1.202.5",
  /** SecureCode Status */
  secureCode: "urn:oid:2.16.840.1.113883.3.3731.1.203.53",
  /** Override-SecureCode-Justification */
  override: "urn:oid:2.16.840.1.113883.3.3731.1.203.52",
  // Identifiers this system issues. All share the organization root OID.
  rxItem: LOCAL_ROOT,
  rxGroup: LOCAL_ROOT,
  dispenseItem: LOCAL_ROOT,
  encounter: LOCAL_ROOT,
  /** Demo value. The reference id nphies returns sits in an OID range the guide does not publish (page 118162249). */
  nationalRef: `urn:oid:${ORG_OID}.90`,
} as const;

/** Real provider type codes from the official samples (KSA Individual Provider Type). */
export const PROVIDER_TYPE = {
  prescriber: { code: "100000003", display: "Medicine and Surgery" },
  pharmacist: { code: "100000005", display: "Pharmacists and Pharmacy Technicians" },
} as const;

/** Things the guide and samples do not settle. Shown as "Assumption" notes in Developer View. */
export const ASSUMPTIONS: string[] = [
  "Codes that start with DEMO- are stand-ins. The real values are in the IS0200 data dictionary, which was not available. The validator warns about each one.",
  "Prescription type (page 118128831, KSA Medication Prescription Type): U and C are the real codes from the official samples. Narcotic and restricted use DEMO-NARCOTIC and DEMO-RESTRICTED.",
  "Drug codes (pages 118063634 and 118161914): the real codes are NHIC registry ids (MRID), generic for prescribing and brand for dispensing. The demo catalogue sends DEMO-DRG codes.",
  "Dose form (page 118063634, KSA Medication Pharmaceutical Dose Form): 6401 tablet is real. Other forms use DEMO-FORM codes. Package form (page 118129076) uses DEMO-PACK codes.",
  "Route (page 117965427, KSA Medication Route of Administration): 26643006 oral route is real. Other routes use DEMO-ROUTE codes.",
  "Frequency code for Raqeeb items (page 118129183, Frequency Code value set): DEMO-FREQ codes are sent in timing.code.",
  "Specialty (page 118063485, Healthcare Specialty Identifier): Pharmacy is the real code from the samples. Doctor specialties use DEMO-SPEC codes.",
  "Override reason (page 117965118, Override-SecureCode-Justification): code 3 is real. The other reasons use DEMO-OVR codes.",
  "Drug allergy (page 117965377, KSA Drug Allergy): the SNOMED CT code from the chart is sent. An allergy typed as free text gets a DEMO-ALG code.",
  "Quantity units (KSA Medication Quantity Unit, page 118128831) and the age unit (KSA Time Units, page 118063524) are plain words, not the IS0200 values.",
  "Organization id, provider ids and the root OID for identifiers are demo values. Real ones come from the KSA-wide provider directory and from onboarding.",
  "The reference id nphies returns after the first submission is simulated (RQB or NRX plus 8 digits) and its OID is a demo value.",
  "Bundle entry fullUrl is written as urn:uuid:<id>. The page says only 'the UUID in the id element'.",
  "The page lists 'extension/definition/reference' for the medication definition link. A valid FHIR extension needs value[x], so valueReference is used.",
  "Patient phone is mandatory for Raqeeb items but is not held in the demo patient record. A made-up E.164 number is derived from the national id.",
  "Health ID is checked as 10 digits in the simulator. The real format is not in the integration guide.",
  "Narcotic, controlled and restricted classes in the drug catalogue are for demonstration only.",
  "Validity period end is treatment days times fills plus 7 days. The real rule is not in the guide.",
  "Cancel on a completed controlled item (Seha step 7.2.5) is allowed. The status definitions say cancelled is for items with no dispense, so a dispense should be cancelled first.",
  "Controlled items are issued on their own prescription so one Raqeeb reference id covers them.",
  "On a partial dispense, the duration in the dosage is set to the days supplied, so it equals daysSupply as the page asks.",
];

/* ---------- inputs ---------- */

export interface PatientIn {
  id: string;
  healthId: string;
  family: string;
  given: string;
  dob: string;
  sex: "M" | "F";
  phone: string;
}
export interface PractitionerIn {
  /** Value in the KSA-wide provider directory. In the demo it is the same id the ADT messages send in PV1-7. */
  providerId: string;
  family: string;
  given: string;
  phone: string;
  specialtyCode: string;
  specialtyText: string;
  role: "prescriber" | "pharmacist";
}
export interface OrgIn {
  id: string;
  name: string;
}
export interface EncounterIn {
  visitNumber: string;
  cls: "I" | "O" | "E" | "P";
  startAt: string;
  endAt?: string;
  facilityName: string;
}
export interface AllergyIn {
  /** SNOMED CT code of the allergen, when the chart holds one. */
  code?: string;
  text: string;
  severity: "SV" | "MO" | "MI";
  reaction: string;
}
export interface ItemIn {
  item: RxItem;
  drug: Drug;
  /** Total dispensed in completed lines. Used to check cancel and stop. */
  dispensed: number;
  /** Status before the change being sent. Cancel of a completed item is a separate conformance step. */
  statusBefore?: ItemStatus;
}
export interface PrescriptionIn {
  groupId: string;
  /** True when the group id is the reference id nphies returned on the first submission. */
  groupFromNphies: boolean;
  controlled: boolean;
  usage: UsageSetting;
  authoredAt: Date;
  patient: PatientIn;
  practitioner: PractitionerIn;
  org: OrgIn;
  encounter: EncounterIn;
  heightCm?: number;
  weightKg?: number;
  ageYears: number;
  allergies: AllergyIn[];
  items: ItemIn[];
}
export interface DispenseLineIn {
  line: DispenseLine;
  item: RxItem;
  drug: Drug;
  controlled: boolean;
}
export interface DispenseIn {
  usage: UsageSetting;
  raqeebScope: boolean;
  handedOverAt: Date;
  patient: PatientIn;
  dispenser: PractitionerIn;
  org: OrgIn;
  encounter: EncounterIn;
  lines: DispenseLineIn[];
  secure?: { mode: "authenticated" | "override"; value?: string; justification?: string };
}
export interface BuildOpts {
  uuid?: () => string;
  now?: Date;
}

/* ---------- helpers ---------- */

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Saudi Arabia is UTC+3 all year. Format as YYYY-MM-DDThh:mm:ss+03:00. */
export function ksaTimestamp(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19) + "+03:00";
}
export const ksaDate = (d: Date): string => ksaTimestamp(d).slice(0, 10);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xhtml = (text: string): Json => ({ status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${esc(text)}</div>` });
const coding = (system: string, code: string, display: string): Json => ({ system, code, display });
const cc = (system: string, code: string, display: string): Json => ({ coding: [coding(system, code, display)] });
const ident = (system: string, value: string): Json => ({ system, value });
const ref = (type: string, id: string): string => `${type}/${id}`;
const meta = (profile: string): Json => ({ profile: [profile] });
/** KSA Medication Duration Unit, written as in the official samples: code "d", concept name "day(s)". */
const dayDuration = (n: number): Json => ({ value: n, unit: "day(s)", code: "d" });

export const PRESCRIPTION_TYPE: Record<ControlClass, { code: string; display: string }> = {
  U: { code: "U", display: "Uncontrolled" },
  C: { code: "C", display: "Controlled" },
  N: { code: `${DEMO_PREFIX}NARCOTIC`, display: "Narcotic" },
  R: { code: `${DEMO_PREFIX}RESTRICTED`, display: "Restricted" },
};
const CLASS_TEXT: Record<string, string> = { I: "Inpatient", O: "Outpatient", E: "Emergency", P: "Preadmit" };

function routeConcept(code: string): Json {
  const r = ROUTE_BY_CODE[code];
  return r?.snomed ? cc(SYS.snomed, r.snomed, r.snomedName ?? r.label) : cc(SYS.snomed, `${DEMO_PREFIX}ROUTE-${code}`, r?.label ?? code);
}
const USAGE_TEXT: Record<UsageSetting, string> = { outpatient: "Outpatient", inpatient: "Inpatient", discharge: "Discharge", community: "Community" };

export function freqOf(id: string): Frequency {
  return FREQ_BY_ID[id] ?? FREQ_BY_ID.OD;
}

export function dosageNarrative(drug: Drug, item: RxItem, days: number = item.durationDays): string {
  const f = freqOf(item.frequencyId);
  const parts = [
    `${item.dose} ${drug.unit}`,
    f.label.toLowerCase(),
    ROUTE_LABEL[item.route] ? `by ${ROUTE_LABEL[item.route].toLowerCase()} route` : "",
    item.asNeeded ? "as needed" : "",
    `for ${days} day${days === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.join(", ");
}

export function itemNarrative(drug: Drug, item: RxItem): string {
  const lines = [
    `${drug.generic} ${drug.strengthValue} ${drug.strengthUnit} ${drug.form.toLowerCase()}. ${dosageNarrative(drug, item)}.`,
    `Quantity ${item.quantity} ${drug.unit}. Repeats allowed ${item.refills}. Status ${item.status}.`,
  ];
  if (item.patientInstruction) lines.push(`Instructions: ${item.patientInstruction}`);
  return lines.join(" ");
}

/* ---------- common resources ---------- */

export function buildPatient(p: PatientIn, id: string, raqeeb: boolean): Json {
  return {
    resourceType: "Patient",
    id,
    meta: meta(PROFILE.patient),
    identifier: [ident(SYS.healthId, p.healthId)],
    name: [{ family: p.family, given: [p.given] }],
    gender: p.sex === "M" ? "male" : "female",
    birthDate: p.dob,
    telecom: [{ system: "phone", value: p.phone, ...(raqeeb ? { rank: 1 } : {}) }],
  };
}

export function buildPractitioner(p: PractitionerIn, id: string, raqeeb = false): Json {
  return {
    resourceType: "Practitioner",
    id,
    meta: meta(PROFILE.practitioner),
    identifier: [ident(SYS.provider, p.providerId)],
    name: [{ family: p.family, given: [p.given], ...(p.role === "prescriber" ? { prefix: ["Dr."] } : {}) }],
    telecom: [{ system: "phone", value: p.phone, ...(raqeeb ? { rank: 1 } : {}) }],
  };
}

export function buildPractitionerRole(p: PractitionerIn, id: string, practitionerId: string, orgId: string, org: OrgIn): Json {
  const type = PROVIDER_TYPE[p.role];
  return {
    resourceType: "PractitionerRole",
    id,
    meta: meta(PROFILE.practitionerRole),
    practitioner: { reference: ref("Practitioner", practitionerId), identifier: ident(SYS.provider, p.providerId) },
    organization: { reference: ref("Organization", orgId), identifier: ident(SYS.organization, org.id) },
    code: [cc(SYS.providerType, type.code, type.display)],
    specialty: [cc(SYS.specialty, p.specialtyCode, p.specialtyText)],
  };
}

export function buildOrganization(o: OrgIn, id: string): Json {
  return { resourceType: "Organization", id, meta: meta(PROFILE.organization), identifier: [ident(SYS.organization, o.id)], name: o.name };
}

export function buildEncounter(e: EncounterIn, id: string): Json {
  const iso = (s: string) => `${s.length === 16 ? `${s}:00` : s}+03:00`;
  return {
    resourceType: "Encounter",
    id,
    meta: meta(PROFILE.encounter),
    identifier: [ident(SYS.encounter, e.visitNumber)],
    status: e.endAt ? "finished" : "in-progress",
    class: coding(SYS.encounterClass, e.cls, CLASS_TEXT[e.cls] ?? e.cls),
    period: { start: iso(e.startAt), ...(e.endAt ? { end: iso(e.endAt) } : {}) },
    serviceProvider: { display: e.facilityName },
  };
}

export function buildAdditionalInfo(kind: "height" | "weight" | "age", value: number, id: string): Json {
  const t = {
    height: { code: "50373000", display: "Body Height Measure", unit: "cm" },
    weight: { code: "363808001", display: "Body Weight Measure", unit: "kg" },
    age: { code: "424144002", display: "Current Chronological Age", unit: "a" },
  }[kind];
  return {
    resourceType: "Observation",
    id,
    meta: meta(PROFILE.additionalOrderInfo),
    status: "registered",
    code: cc(SYS.snomed, t.code, t.display),
    valueQuantity: { value, unit: t.unit },
  };
}

/** The SNOMED CT code from the chart is sent. An allergy typed as free text gets a DEMO- code. The real value set is "KSA Drug Allergy". */
export function buildAllergy(a: AllergyIn, id: string, patientId: string): Json {
  return {
    resourceType: "AllergyIntolerance",
    id,
    meta: meta(PROFILE.allergy),
    code: cc(SYS.snomed, a.code || `${DEMO_PREFIX}ALG-${a.text.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8)}`, a.text),
    category: ["medication"],
    criticality: a.severity === "SV" ? "high" : "low",
    patient: { reference: ref("Patient", patientId) },
    ...(a.reaction ? { reaction: [{ manifestation: [{ text: a.reaction }] }] } : {}),
  };
}

export function buildMessageHeader(id: string, org: OrgIn, providerId: string, focusSystem: string, focusValues: string[]): Json {
  return {
    resourceType: "MessageHeader",
    id,
    meta: meta(PROFILE.messageHeader),
    eventCoding: { system: SYS.eventCoding, code: "submit" },
    sender: { identifier: ident(SYS.organization, org.id) },
    author: { identifier: ident(SYS.provider, providerId) },
    focus: focusValues.map((v) => ({ identifier: ident(focusSystem, v) })),
  };
}

/* ---------- medication resources ---------- */

function ingredient(system: string, code: string, display: string, drug: Drug): Json {
  return {
    itemCodeableConcept: { coding: [coding(system, code, display)] },
    strength: { numerator: { value: drug.strengthValue, unit: drug.strengthUnit } },
  };
}

export function buildMedicationPrescribed(drug: Drug): Json {
  return {
    resourceType: "Medication",
    id: "medicationprescribed",
    meta: meta(PROFILE.medicationPrescribed),
    code: { coding: [coding(SYS.drug, drug.code, drug.generic)], text: drug.generic },
    form: cc(SYS.form, drug.formCode, drug.form),
    ingredient: [ingredient(SYS.drug, drug.code, drug.generic, drug)],
  };
}

export function buildMedicationKnowledge(drug: Drug): Json {
  return {
    resourceType: "MedicationKnowledge",
    id: "medicationknowledge",
    meta: meta(PROFILE.medicationKnowledge),
    packaging: { type: cc(SYS.packForm, `${DEMO_PREFIX}PACK-${drug.pack.type.toUpperCase()}`, drug.pack.type), quantity: { value: drug.pack.size, unit: drug.unit } },
  };
}

export function buildMedicationDispensed(drug: Drug, line: DispenseLine): Json {
  const productCode = `${drug.code}-P`;
  return {
    resourceType: "Medication",
    id: "medicationdispensed",
    meta: meta(PROFILE.medicationDispensed),
    extension: [{ url: `${EXT}medicationdefinition`, valueReference: { reference: "#medicationknowledge" } }],
    code: { coding: [coding(SYS.product, productCode, drug.brand)], text: drug.brand },
    form: cc(SYS.form, drug.formCode, drug.form),
    ingredient: [ingredient(SYS.product, productCode, drug.brand, drug)],
    ...(line.lot || line.expiry ? { batch: { ...(line.lot ? { lotNumber: line.lot } : {}), ...(line.expiry ? { expirationDate: line.expiry } : {}) } } : {}),
  };
}

/**
 * Dosage Instructions General plus one structured Normal Dosing instruction (variant 1, page 118129183).
 * Raqeeb items carry the frequency as a code in timing.code, and frequency, period and periodUnit are not allowed.
 * Other items carry frequency, period and periodUnit, and timing.code is not allowed.
 * `days` is the duration to state. On a dispense it is the days supplied, so it equals daysSupply.
 */
export function buildDosage(drug: Drug, item: RxItem, raqeeb: boolean, days: number = item.durationDays): Json[] {
  const f = freqOf(item.frequencyId);
  const general: Json = {
    text: dosageNarrative(drug, item, days),
    ...(item.patientInstruction ? { patientInstruction: item.patientInstruction } : {}),
    timing: { repeat: { boundsDuration: dayDuration(days) } },
    route: routeConcept(item.route),
    asNeededBoolean: item.asNeeded,
  };
  const structured: Json = {
    timing: raqeeb
      ? { code: cc(SYS.snomed, `${DEMO_PREFIX}FREQ-${f.id}`, f.label) }
      : { repeat: { frequency: f.frequency, period: f.period, periodUnit: f.periodUnit } },
    doseAndRate: [{ doseQuantity: { value: item.dose, unit: drug.unit } }],
  };
  return [general, structured];
}

/* ---------- prescription ---------- */

export function buildMedicationRequest(
  it: ItemIn,
  ctx: { id: string; patientId: string; roleId: string; encounterId: string; group: Json; authoredAt: Date; patient: PatientIn; encounter: EncounterIn; usage: UsageSetting; supportIds: string[] },
): Json {
  const { item, drug } = it;
  const type = PRESCRIPTION_TYPE[drug.controlClass];
  const raqeeb = drug.controlClass !== "U" && ctx.usage !== "inpatient";
  const start = ksaDate(ctx.authoredAt);
  const end = addDays(start, Math.max(1, item.durationDays) * (item.refills + 1) + 7);
  return {
    resourceType: "MedicationRequest",
    id: ctx.id,
    meta: meta(PROFILE.medicationRequest),
    contained: [buildMedicationPrescribed(drug)],
    identifier: [ident(SYS.rxItem, item.identifier)],
    status: item.status,
    intent: "order",
    groupIdentifier: ctx.group,
    authoredOn: ksaTimestamp(ctx.authoredAt),
    category: [
      cc(SYS.rxType, type.code, type.display),
      cc(SYS.usage, ctx.usage, USAGE_TEXT[ctx.usage]),
    ],
    text: xhtml(itemNarrative(drug, item)),
    subject: { reference: ref("Patient", ctx.patientId), identifier: ident(SYS.healthId, ctx.patient.healthId) },
    requester: { reference: ref("PractitionerRole", ctx.roleId) },
    encounter: { reference: ref("Encounter", ctx.encounterId), identifier: ident(SYS.encounter, ctx.encounter.visitNumber) },
    medicationReference: { reference: "#medicationprescribed" },
    dosageInstruction: buildDosage(drug, item, raqeeb),
    ...(item.fulfillmentNote ? { note: [{ text: item.fulfillmentNote }] } : {}),
    dispenseRequest: {
      validityPeriod: { start, end },
      numberOfRepeatsAllowed: item.refills,
      quantity: { value: item.quantity, unit: drug.unit },
      expectedSupplyDuration: dayDuration(item.durationDays),
    },
    reasonCode: [cc(SYS.icd, item.reason.code, item.reason.text)],
    supportingInformation: ctx.supportIds.map((s) => ({ reference: s })),
  };
}

export function buildPrescriptionBundle(input: PrescriptionIn, opts: BuildOpts = {}): FhirBundle {
  const gen = opts.uuid ?? uuid;
  const now = opts.now ?? new Date();
  const ids = { bundle: gen(), header: gen(), patient: gen(), practitioner: gen(), role: gen(), org: gen(), enc: gen() };
  const raqeeb = input.controlled && input.usage !== "inpatient";
  const entries: { fullUrl: string; resource: Json }[] = [];
  const add = (r: Json) => entries.push({ fullUrl: `urn:uuid:${r.id as string}`, resource: r });

  const group = ident(input.groupFromNphies ? SYS.nationalRef : SYS.rxGroup, input.groupId);

  // Supporting information: height, weight, age and allergies
  const support: string[] = [];
  const extras: Json[] = [];
  if (input.heightCm) {
    const o = buildAdditionalInfo("height", input.heightCm, gen());
    extras.push(o);
    support.push(ref("Observation", o.id as string));
  }
  if (input.weightKg) {
    const o = buildAdditionalInfo("weight", input.weightKg, gen());
    extras.push(o);
    support.push(ref("Observation", o.id as string));
  }
  const age = buildAdditionalInfo("age", input.ageYears, gen());
  extras.push(age);
  support.push(ref("Observation", age.id as string));
  const allergies = input.allergies.map((a) => buildAllergy(a, gen(), ids.patient));
  allergies.forEach((a) => support.push(ref("AllergyIntolerance", a.id as string)));

  const requests = input.items.map((it) =>
    buildMedicationRequest(it, {
      id: gen(),
      patientId: ids.patient,
      roleId: ids.role,
      encounterId: ids.enc,
      group,
      authoredAt: input.authoredAt,
      patient: input.patient,
      encounter: input.encounter,
      usage: input.usage,
      supportIds: support,
    }),
  );

  add(buildMessageHeader(ids.header, input.org, input.practitioner.providerId, SYS.rxItem, input.items.map((i) => i.item.identifier)));
  add(buildPatient(input.patient, ids.patient, raqeeb));
  add(buildPractitioner(input.practitioner, ids.practitioner, raqeeb));
  add(buildPractitionerRole(input.practitioner, ids.role, ids.practitioner, ids.org, input.org));
  add(buildOrganization(input.org, ids.org));
  add(buildEncounter(input.encounter, ids.enc));
  extras.forEach(add);
  allergies.forEach(add);
  requests.forEach(add);

  return {
    resourceType: "Bundle",
    id: ids.bundle,
    meta: { profile: [PROFILE.bundlePrescription] },
    type: "message",
    timestamp: ksaTimestamp(now),
    entry: entries,
  };
}

/* ---------- dispense ---------- */

export function buildMedicationDispense(
  l: DispenseLineIn,
  ctx: { id: string; patientId: string; roleId: string; encounterId: string; input: DispenseIn },
): Json {
  const { line, item, drug } = l;
  const { input } = ctx;
  const tag: Json[] = [];
  if (input.raqeebScope && input.secure) {
    if (input.secure.mode === "authenticated") {
      tag.push({ ...coding(SYS.secureCode, "Code-Authenticated", "Secure Code Authenticated"), extension: [{ url: `${EXT}SecureCode-verification`, valueString: input.secure.value ?? "" }] });
    } else {
      tag.push({
        ...coding(SYS.secureCode, "Code-Override", "Secure Code Override"),
        extension: [{ url: `${EXT}Override-SecureCode-Justification`, valueCodeableConcept: cc(SYS.override, input.secure.justification ?? "", OVERRIDE_LABEL[input.secure.justification ?? ""] ?? "") }],
      });
    }
  }
  const override = input.secure?.mode === "override" && input.raqeebScope;
  return {
    resourceType: "MedicationDispense",
    id: ctx.id,
    meta: { profile: [PROFILE.medicationDispense], ...(tag.length ? { tag } : {}) },
    contained: [buildMedicationDispensed(drug, line), buildMedicationKnowledge(drug)],
    extension: [{ url: "https://hl7.org/fhir/extensions/StructureDefinition-medicationdispense-refillsRemaining", valueInteger: line.refillsRemaining }],
    identifier: [ident(SYS.dispenseItem, line.identifier)],
    status: line.status,
    category: cc(SYS.usage, input.usage, USAGE_TEXT[input.usage]),
    medicationReference: { reference: "#medicationdispensed" },
    subject: { reference: ref("Patient", ctx.patientId), identifier: ident(SYS.healthId, input.patient.healthId) },
    context: { reference: ref("Encounter", ctx.encounterId), identifier: ident(SYS.encounter, input.encounter.visitNumber) },
    performer: [{ actor: { reference: ref("PractitionerRole", ctx.roleId) } }],
    authorizingPrescription: [{ identifier: ident(SYS.rxItem, item.identifier) }],
    type: cc(SYS.actCode, line.type, fillText(line.type)),
    quantity: { value: line.quantity, unit: drug.unit },
    daysSupply: dayDuration(line.daysSupply),
    whenHandedOver: ksaTimestamp(input.handedOverAt),
    text: xhtml(`${drug.brand} (${drug.generic} ${drug.strengthValue} ${drug.strengthUnit}) quantity ${line.quantity} ${drug.unit}. ${dosageNarrative(drug, item, line.daysSupply)}. Dispense type ${line.type}. Status ${line.status}.`),
    ...(override ? { receiver: [{ identifier: ident(SYS.healthId, input.patient.healthId) }] } : {}),
    dosageInstruction: buildDosage(drug, item, input.raqeebScope && l.controlled, line.daysSupply),
  };
}

export function fillText(t: string): string {
  return { FF: "First Fill", FFP: "First Fill - Part Fill", FFC: "First Fill - Complete", RF: "Refill", RFP: "Refill - Part Fill", RFC: "Refill - Complete" }[t] ?? t;
}

export function buildDispenseBundle(input: DispenseIn, opts: BuildOpts = {}): FhirBundle {
  const gen = opts.uuid ?? uuid;
  const now = opts.now ?? new Date();
  const ids = { bundle: gen(), header: gen(), patient: gen(), practitioner: gen(), role: gen(), org: gen(), enc: gen() };
  const entries: { fullUrl: string; resource: Json }[] = [];
  const add = (r: Json) => entries.push({ fullUrl: `urn:uuid:${r.id as string}`, resource: r });
  const dispenses = input.lines.map((l) => buildMedicationDispense(l, { id: gen(), patientId: ids.patient, roleId: ids.role, encounterId: ids.enc, input }));

  add(buildMessageHeader(ids.header, input.org, input.dispenser.providerId, SYS.dispenseItem, input.lines.map((l) => l.line.identifier)));
  add(buildPatient(input.patient, ids.patient, input.raqeebScope));
  add(buildPractitioner(input.dispenser, ids.practitioner, input.raqeebScope));
  add(buildPractitionerRole(input.dispenser, ids.role, ids.practitioner, ids.org, input.org));
  add(buildOrganization(input.org, ids.org));
  add(buildEncounter(input.encounter, ids.enc));
  dispenses.forEach(add);

  return {
    resourceType: "Bundle",
    id: ids.bundle,
    meta: { profile: [PROFILE.bundleDispense] },
    type: "message",
    timestamp: ksaTimestamp(now),
    entry: entries,
  };
}
