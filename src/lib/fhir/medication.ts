import { OID } from "../reference-data";
import { FREQ_BY_ID, ROUTE_LABEL } from "../rx-catalogue";
import { addDays } from "../rx-logic";
import type { Drug, DispenseLine, Frequency, ItemStatus, RxItem, UsageSetting } from "../rx-types";

/**
 * FHIR R4 builders for the nphies Medication Prescription and Dispense (Raqeeb) messages.
 * Self-contained. Follows the Confluence snapshot in references/pages/medication/.
 * Codes marked TEST are demo values. The real value sets live in IS0200 and are not in the snapshot.
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

/** Demo OID root. Real item, group and Raqeeb OIDs are assigned at onboarding. */
export const TEST_OID = "2.16.840.1.113883.3.3731.9999";
export const SYS = {
  healthId: `urn:oid:${OID.healthId}`,
  provider: `urn:oid:${OID.provider}`,
  organization: `urn:oid:${OID.nphiesApp}`,
  snomed: "urn:oid:2.16.840.1.113883.6.96",
  icd: "urn:oid:2.16.840.1.113883.6.135",
  encounterClass: "urn:oid:2.16.840.1.113883.18.5",
  actCode: "urn:oid:2.16.840.1.113883.5.4",
  eventCoding: "http://nphies.sa/fhir/ksa/nphies-cs/terminology/CodeSystem/EventCoding",
  // TEST systems
  rxItem: `urn:oid:${TEST_OID}.10`,
  rxGroup: `urn:oid:${TEST_OID}.11`,
  dispenseItem: `urn:oid:${TEST_OID}.12`,
  encounter: `urn:oid:${TEST_OID}.13`,
  raqeeb: `urn:oid:${TEST_OID}.90`,
  drug: `urn:oid:${TEST_OID}.20`,
  product: `urn:oid:${TEST_OID}.21`,
  form: `urn:oid:${TEST_OID}.22`,
  route: `urn:oid:${TEST_OID}.23`,
  rxType: `urn:oid:${TEST_OID}.24`,
  usage: `urn:oid:${TEST_OID}.25`,
  duration: `urn:oid:${TEST_OID}.26`,
  packForm: `urn:oid:${TEST_OID}.27`,
  providerType: `urn:oid:${TEST_OID}.28`,
  specialty: `urn:oid:${TEST_OID}.29`,
  secureCode: `urn:oid:${TEST_OID}.30`,
  override: `urn:oid:${TEST_OID}.31`,
  allergyCode: `urn:oid:${TEST_OID}.32`,
} as const;

/** Things the snapshot does not settle. Shown as "Assumption" notes in Developer View. */
export const ASSUMPTIONS: string[] = [
  "Value-set codes (prescription type, usage setting, dose form, route, duration unit, package form, provider type, specialty, SecureCode status) are not in the snapshot. Demo TEST codes are used.",
  "Item, group and Raqeeb identifier OIDs come from onboarding. Demo OIDs are used and the Raqeeb reference id is made up (RQB plus 8 digits).",
  "Bundle type is 'message' as the Raqeeb Bundle page says. The skill summary says 'document'. The Raqeeb page was followed.",
  "Bundle entry fullUrl is written as urn:uuid:<id>. The page says only 'the UUID in the id element'.",
  "The page lists 'extension/definition/reference' for the medication definition link. A valid FHIR extension needs value[x], so valueReference is used.",
  "Dispense type uses the v3 ActCode values FF, FFP, FFC, RF, RFP, RFC. The element row is missing from the snapshot table.",
  "Patient phone is mandatory for Raqeeb items but is not held in the demo patient record. A made-up E.164 number is derived from the national id.",
  "Health ID is checked as 10 digits in the simulator. The real format is not in the integration guide.",
  "Narcotic, controlled and restricted classes in the drug catalogue are for demonstration only.",
  "Validity period end is treatment days times fills plus 7 days. The real rule is not in the snapshot.",
  "Cancel on a completed controlled item (7.2.5) is allowed. The status definitions say cancelled is for items with no dispense, so a dispense should be cancelled first.",
  "Controlled items are issued on their own prescription so one Raqeeb reference id covers them.",
  "Cancel and update of a dispense are offered for controlled items only, as the conformance sheet lists them under 7.4.",
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
  /** Value in the KSA-wide provider directory. Made up for the demo. */
  npi: string;
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
  /** True when the group id is a Raqeeb reference id returned by a first submission. */
  groupIsRaqeeb: boolean;
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
const dayDuration = (n: number): Json => ({ value: n, unit: "day", system: SYS.duration, code: "d" });

export const PRESCRIPTION_TYPE: Record<string, string> = { U: "uncontrolled", N: "narcotic", C: "controlled", R: "restricted" };
const USAGE_TEXT: Record<UsageSetting, string> = { outpatient: "Outpatient", inpatient: "Inpatient", discharge: "Discharge", community: "Community" };

export function freqOf(id: string): Frequency {
  return FREQ_BY_ID[id] ?? FREQ_BY_ID.OD;
}

export function dosageNarrative(drug: Drug, item: RxItem): string {
  const f = freqOf(item.frequencyId);
  const parts = [
    `${item.dose} ${drug.unit}`,
    f.label.toLowerCase(),
    ROUTE_LABEL[item.route] ? `by ${ROUTE_LABEL[item.route].toLowerCase()} route` : "",
    item.asNeeded ? "as needed" : "",
    `for ${item.durationDays} day${item.durationDays === 1 ? "" : "s"}`,
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

export function buildPractitioner(p: PractitionerIn, id: string): Json {
  return {
    resourceType: "Practitioner",
    id,
    meta: meta(PROFILE.practitioner),
    identifier: [ident(SYS.provider, p.npi)],
    name: [{ family: p.family, given: [p.given], prefix: p.role === "prescriber" ? ["Dr."] : [] }],
    telecom: [{ system: "phone", value: p.phone }],
  };
}

export function buildPractitionerRole(p: PractitionerIn, id: string, practitionerId: string, orgId: string, org: OrgIn): Json {
  const prescriber = p.role === "prescriber";
  return {
    resourceType: "PractitionerRole",
    id,
    meta: meta(PROFILE.practitionerRole),
    practitioner: { reference: ref("Practitioner", practitionerId), identifier: ident(SYS.provider, p.npi) },
    organization: { reference: ref("Organization", orgId), identifier: ident(SYS.organization, org.id) },
    code: [cc(SYS.providerType, prescriber ? "medicine-and-surgery" : "pharmacists-and-technicians", prescriber ? "Medicine and Surgery" : "Pharmacists and Pharmacy Technicians")],
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
    class: coding(SYS.encounterClass, e.cls, e.cls),
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

/** Drug allergy code is a TEST code. The real value set is "KSA Drug Allergy". */
export function buildAllergy(a: AllergyIn, id: string, patientId: string): Json {
  return {
    resourceType: "AllergyIntolerance",
    id,
    meta: meta(PROFILE.allergy),
    code: cc(SYS.allergyCode, `TST-ALG-${a.text.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8)}`, a.text),
    category: ["medication"],
    criticality: a.severity === "SV" ? "high" : "low",
    patient: { reference: ref("Patient", patientId) },
    ...(a.reaction ? { reaction: [{ manifestation: [{ text: a.reaction }] }] } : {}),
  };
}

export function buildMessageHeader(id: string, org: OrgIn, practitionerNpi: string, focusSystem: string, focusValues: string[]): Json {
  return {
    resourceType: "MessageHeader",
    id,
    meta: meta(PROFILE.messageHeader),
    eventCoding: { system: SYS.eventCoding, code: "submit" },
    sender: { identifier: ident(SYS.organization, org.id) },
    author: { identifier: ident(SYS.provider, practitionerNpi) },
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
    packaging: { type: cc(SYS.packForm, drug.pack.type, drug.pack.type), quantity: { value: drug.pack.size, unit: drug.unit } },
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

/** Dosage Instructions General plus (always for Raqeeb) Normal Dosing. Only variant 1 is built. */
export function buildDosage(drug: Drug, item: RxItem): Json[] {
  const f = freqOf(item.frequencyId);
  const general: Json = {
    text: dosageNarrative(drug, item),
    ...(item.patientInstruction ? { patientInstruction: item.patientInstruction } : {}),
    timing: { repeat: { boundsDuration: dayDuration(item.durationDays) } },
    route: cc(SYS.route, item.route, ROUTE_LABEL[item.route] ?? item.route),
    asNeededBoolean: item.asNeeded,
  };
  const structured: Json = {
    sequence: 1,
    timing: { repeat: { frequency: f.frequency, period: f.period, periodUnit: f.periodUnit, ...(f.when ? { when: [f.when] } : {}) } },
    asNeededBoolean: item.asNeeded,
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
      cc(SYS.rxType, PRESCRIPTION_TYPE[drug.controlClass], PRESCRIPTION_TYPE[drug.controlClass]),
      cc(SYS.usage, ctx.usage, USAGE_TEXT[ctx.usage]),
    ],
    text: xhtml(itemNarrative(drug, item)),
    subject: { reference: ref("Patient", ctx.patientId), identifier: ident(SYS.healthId, ctx.patient.healthId) },
    requester: { reference: ref("PractitionerRole", ctx.roleId) },
    encounter: { reference: ref("Encounter", ctx.encounterId), identifier: ident(SYS.encounter, ctx.encounter.visitNumber) },
    medicationReference: { reference: "#medicationprescribed" },
    dosageInstruction: buildDosage(drug, item),
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

  const group = ident(input.groupIsRaqeeb ? SYS.raqeeb : SYS.rxGroup, input.groupId);

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

  add(buildMessageHeader(ids.header, input.org, input.practitioner.npi, SYS.rxItem, input.items.map((i) => i.item.identifier)));
  add(buildPatient(input.patient, ids.patient, raqeeb));
  add(buildPractitioner(input.practitioner, ids.practitioner));
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
      tag.push({ ...coding(SYS.secureCode, "Code-Authenticated", "Code Authenticated"), extension: [{ url: `${EXT}SecureCode-verification`, valueString: input.secure.value ?? "" }] });
    } else {
      tag.push({
        ...coding(SYS.secureCode, "Code-Override", "Code Override"),
        extension: [{ url: `${EXT}Override-SecureCode-Justification`, valueCodeableConcept: cc(SYS.override, "override", input.secure.justification ?? "") }],
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
    text: xhtml(`${drug.brand} (${drug.generic} ${drug.strengthValue} ${drug.strengthUnit}) quantity ${line.quantity} ${drug.unit}. ${dosageNarrative(drug, item)}. Dispense type ${line.type}. Status ${line.status}.`),
    ...(override ? { receiver: [{ identifier: ident(SYS.healthId, input.patient.healthId) }] } : {}),
    dosageInstruction: buildDosage(drug, item),
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

  add(buildMessageHeader(ids.header, input.org, input.dispenser.npi, SYS.dispenseItem, input.lines.map((l) => l.line.identifier)));
  add(buildPatient(input.patient, ids.patient, input.raqeebScope));
  add(buildPractitioner(input.dispenser, ids.practitioner));
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
