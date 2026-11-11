import { isControlled } from "../rx-logic";
import type { IssueCode, RxCheck } from "../rx-types";
import type { DispenseIn, FhirBundle, Json, PrescriptionIn } from "./medication";
import { PROFILE, SYS } from "./medication";

/**
 * Validators for the Raqeeb medication messages and a simulated nphies/Raqeeb endpoint.
 * Each check carries the spec section, so Developer View can show where the rule comes from.
 * No network calls.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{6,14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const RX_STATUS = ["active", "on-hold", "completed", "cancelled", "stopped"];
const FILL_TYPES = ["FF", "FFP", "FFC", "RF", "RFP", "RFC"];

type R = Record<string, unknown>;
function at(o: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as R)[k] : undefined), o);
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

class Collector {
  out: RxCheck[] = [];
  rule(ok: boolean, okText: string, badText: string, spec: string, code: IssueCode = "invalid", level: "error" | "warn" = "error") {
    this.out.push(ok ? { level: "ok", text: okText, spec } : { level, text: badText, spec, code });
  }
}

function resources(b: FhirBundle, type: string): Json[] {
  return b.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
}

function checkBundleShell(c: Collector, b: FhirBundle, profile: string, name: string) {
  c.rule(b.resourceType === "Bundle", "Resource type is Bundle.", "Resource type must be Bundle.", "Bundle 1.1", "structure");
  c.rule(GUID.test(b.id), "Bundle id is a GUID.", "Bundle id must be a GUID.", "Bundle 1.2");
  c.rule(at(b, "meta.profile.0") === profile, `Bundle profile is ${name}.`, `Bundle profile must be ${profile}.`, "Bundle 1.3", "code-invalid");
  c.rule(b.type === "message", "Bundle type is message.", "Bundle type must be message.", "Bundle 1.4", "code-invalid");
  c.rule(DATETIME.test(b.timestamp), "Bundle timestamp has seconds and a time zone.", "Bundle timestamp must be YYYY-MM-DDThh:mm:ss+zz:zz.", "Bundle 1.5");
  const first = b.entry[0]?.resource;
  c.rule(first?.resourceType === "MessageHeader", "First entry is the MessageHeader.", "First entry must be the MessageHeader.", "Bundle 1.6", "structure");
  const badUrl = b.entry.filter((e) => e.fullUrl !== `urn:uuid:${str(e.resource.id)}` || !GUID.test(str(e.resource.id)));
  c.rule(badUrl.length === 0, "Every entry has a GUID id and a matching fullUrl.", `${badUrl.length} entries have a bad id or fullUrl.`, "Bundle 1.7, 1.10");
  const ids = new Set(b.entry.map((e) => str(e.resource.id)));
  const refs = new Set<string>();
  JSON.stringify(b, (k, v) => {
    if (k === "reference" && typeof v === "string" && !v.startsWith("#")) refs.add(v);
    return v;
  });
  const missing = [...refs].filter((r) => !ids.has(r.split("/")[1]));
  c.rule(missing.length === 0, "Every reference points to a resource in the bundle.", `Missing in bundle: ${missing.join(", ")}.`, "Bundle 1.9", "not-found");
}

function checkHeader(c: Collector, b: FhirBundle) {
  const h = resources(b, "MessageHeader")[0];
  if (!h) return;
  c.rule(at(h, "meta.profile.0") === PROFILE.messageHeader, "MessageHeader profile is set.", "MessageHeader profile is wrong.", "MessageHeader 2.3", "code-invalid");
  c.rule(at(h, "eventCoding.code") === "submit" && !!at(h, "eventCoding.system"), "Event coding is submit.", "Event coding must be submit with the EventCoding system.", "MessageHeader 2.4", "code-invalid");
  c.rule(!!at(h, "sender.identifier.value"), "Sender is the organization.", "Sender identifier is missing.", "MessageHeader 2.5", "required");
  c.rule(!!at(h, "author.identifier.value"), "Author is the practitioner.", "Author identifier is missing.", "MessageHeader 2.6", "required");
  c.rule(arr(h.focus).length >= 1, "Focus lists the item identifiers.", "At least one focus identifier is needed.", "MessageHeader 2.7", "required");
}

function checkCommon(c: Collector, b: FhirBundle, raqeeb: boolean, role: "prescriber" | "pharmacist") {
  for (const [type, spec] of [["Patient", "Bundle 1.2"], ["Practitioner", "Bundle 1.3"], ["PractitionerRole", "Bundle 1.4"], ["Organization", "Bundle 1.5"]] as const) {
    const n = resources(b, type).length;
    c.rule(n === 1, `One ${type} entry.`, `Exactly one ${type} entry is needed, found ${n}.`, `Bundle ${spec}`, "required");
  }
  const p = resources(b, "Patient")[0];
  if (p) {
    const hid = str(at(p, "identifier.0.value"));
    c.rule(at(p, "identifier.0.system") === SYS.healthId && !!hid, "Patient has a Health ID with the NHIC OID.", "Patient needs a Health ID with the NHIC OID.", "Patient 1.4", "required");
    c.rule(/^\d{10}$/.test(hid), "Health ID is found in the registry (demo rule: 10 digits).", "Patient not found in the registry (demo rule: Health ID must be 10 digits).", "Patient 1.4", "not-found");
    c.rule(!!at(p, "name.0.family") && !!at(p, "name.0.given.0"), "Patient name has given and family.", "Patient name needs given and family.", "Patient 1.5 and HumanName", "required");
    c.rule(["male", "female", "other", "unknown"].includes(str(p.gender)), "Patient gender is valid.", "Patient gender is missing or not valid.", "Patient 1.6", "code-invalid");
    c.rule(DATE.test(str(p.birthDate)), "Birth date is YYYY-MM-DD.", "Birth date must be YYYY-MM-DD.", "Patient 1.7");
    if (raqeeb) {
      const t = arr(p.telecom)[0] as R | undefined;
      c.rule(!!t && E164.test(str(t.value)) && t.rank === 1, "Patient phone is E.164 with rank 1 (Raqeeb).", "Raqeeb needs a patient phone in E.164 format (+ and digits) with rank 1.", "Patient 1.9, ContactPoint 9.3", "required");
    }
  }
  const pr = resources(b, "Practitioner")[0];
  if (pr) {
    c.rule(at(pr, "identifier.0.system") === SYS.provider && !!at(pr, "identifier.0.value"), "Practitioner has a provider directory id.", "Practitioner needs an id with the provider OID.", "Practitioner 2.4", "required");
    c.rule(!!at(pr, "name.0.family") && !!at(pr, "name.0.given.0"), "Practitioner name is present.", "Practitioner name is missing.", "Practitioner 2.5", "required");
    c.rule(arr(pr.telecom).length >= 1, "Practitioner phone is present.", "Practitioner needs a phone.", "Practitioner 2.7", "required");
  }
  const rl = resources(b, "PractitionerRole")[0];
  if (rl) {
    const code = str(at(rl, "code.0.coding.0.display"));
    const allowed = role === "prescriber" ? ["Medicine and Surgery", "Dentistry and Related Specialties", "Podiatric Medicine and Therapy", "Pharmacists and Pharmacy Technicians"] : ["Pharmacists and Pharmacy Technicians"];
    c.rule(!raqeeb || allowed.includes(code), "Functional role is allowed for Raqeeb.", `Raqeeb ${role} role must be one of: ${allowed.join(", ")}.`, "PractitionerRole 3.6", "code-invalid");
    c.rule(arr(rl.specialty).length >= 1, "Specialty is present.", "Specialty code is missing.", "PractitionerRole 3.7", "required");
  }
  const org = resources(b, "Organization")[0];
  if (org) {
    c.rule(at(org, "identifier.0.system") === SYS.organization && !!str(org.name), "Organization has an id and name.", "Organization needs an id with the organization OID and a name.", "Organization 4.4, 4.5", "required");
  }
  const enc = resources(b, "Encounter")[0];
  if (enc) {
    c.rule(!!at(enc, "identifier.0.value") && !!at(enc, "period.start") && !!at(enc, "serviceProvider.display"), "Encounter has visit number, start and facility.", "Encounter needs identifier, start time and facility name.", "Encounter 5.4 to 5.9", "required");
  }
}

/* ---------- prescription ---------- */

export function validatePrescriptionBundle(b: FhirBundle): RxCheck[] {
  const c = new Collector();
  checkBundleShell(c, b, PROFILE.bundlePrescription, "bundlePrescription");
  checkHeader(c, b);
  const reqs = resources(b, "MedicationRequest");
  const raqeeb = reqs.some((r) => ["narcotic", "controlled", "restricted"].includes(str(at(r, "category.0.coding.0.code"))) && str(at(r, "category.1.coding.0.code")) !== "inpatient");
  checkCommon(c, b, raqeeb, "prescriber");
  const obs = resources(b, "Observation");
  const hasObs = (code: string) => obs.some((o) => at(o, "code.coding.0.code") === code && Number(at(o, "valueQuantity.value")) > 0);
  c.rule(hasObs("50373000"), "Body height observation is present.", "Body height is required in every prescription bundle.", "Prescription Bundle 1.7", "required");
  c.rule(hasObs("363808001"), "Body weight observation is present.", "Body weight is required in every prescription bundle.", "Prescription Bundle 1.7", "required");
  c.rule(obs.every((o) => o.status === "registered"), "Observations have status registered.", "Observation status must be registered.", "Additional Order Info 6.4", "code-invalid");
  c.rule(reqs.length >= 1, `${reqs.length} prescription item(s).`, "At least one MedicationRequest is needed.", "Prescription Bundle 1.8", "required");

  const ids = new Set(b.entry.map((e) => str(e.resource.id)));
  const group = new Set(reqs.map((r) => str(at(r, "groupIdentifier.value"))));
  c.rule(group.size === 1 && !group.has(""), "All items share one groupIdentifier.", "All items of a prescription must share one groupIdentifier.", "MedicationRequest 2.9", "required");

  reqs.forEach((r, n) => {
    const tag = `Item ${n + 1}`;
    const med = arr(r.contained).find((x) => (x as R).resourceType === "Medication") as R | undefined;
    const controlled = ["narcotic", "controlled", "restricted"].includes(str(at(r, "category.0.coding.0.code")));
    const itemRaqeeb = controlled && str(at(r, "category.1.coding.0.code")) !== "inpatient";
    c.rule(at(r, "meta.profile.0") === PROFILE.medicationRequest, `${tag}: profile set.`, `${tag}: profile must be medicationrequest|1.0.`, "MedicationRequest 2.3", "code-invalid");
    c.rule(med?.id === "medicationprescribed" && !!at(med, "code.coding.0.code") && !!at(med, "code.text") && !!at(med, "form.coding.0.code"), `${tag}: contained Medication has code, name and dose form.`, `${tag}: contained Medication #medicationprescribed needs code, name and dose form.`, "Medication Prescribed 1.2 to 1.7", "required");
    c.rule(at(r, "medicationReference.reference") === "#medicationprescribed", `${tag}: medicationReference is #medicationprescribed.`, `${tag}: medicationReference must be #medicationprescribed.`, "MedicationRequest 2.16", "invalid");
    c.rule(!!at(r, "identifier.0.value") && !!at(r, "identifier.0.system"), `${tag}: item identifier present.`, `${tag}: item identifier is missing.`, "MedicationRequest 2.6", "required");
    c.rule(RX_STATUS.includes(str(r.status)), `${tag}: status ${str(r.status)}.`, `${tag}: status must be one of ${RX_STATUS.join(", ")}.`, "MedicationRequest 2.7", "code-invalid");
    c.rule(r.intent === "order", `${tag}: intent is order.`, `${tag}: intent must be order.`, "MedicationRequest 2.8", "code-invalid");
    const authored = str(r.authoredOn);
    c.rule(DATETIME.test(authored) && new Date(authored).getTime() <= Date.now() + 60_000, `${tag}: authoredOn is precise and not in the future.`, `${tag}: authoredOn must be YYYY-MM-DDThh:mm:ss+zz:zz and not in the future.`, "MedicationRequest 2.10");
    c.rule(arr(r.category).length === 2, `${tag}: two categories (type and usage).`, `${tag}: exactly two categories are needed (prescription type, usage setting).`, "MedicationRequest 2.11", "required");
    c.rule(at(r, "text.status") === "generated" && str(at(r, "text.div")).includes("xhtml"), `${tag}: XHTML narrative present.`, `${tag}: narrative must be XHTML with status generated.`, "MedicationRequest 2.12", "required");
    c.rule(str(at(r, "subject.reference")).startsWith("Patient/") && !!at(r, "subject.identifier.value"), `${tag}: subject has reference and Health ID.`, `${tag}: subject needs a Patient reference and identifier.`, "MedicationRequest 2.13", "required");
    c.rule(str(at(r, "requester.reference")).startsWith("PractitionerRole/"), `${tag}: requester is a PractitionerRole.`, `${tag}: requester must reference the PractitionerRole.`, "MedicationRequest 2.14", "required");
    const dosage = arr(r.dosageInstruction) as R[];
    const gen = dosage[0];
    c.rule(!!gen && !!str(gen.text) && !!at(gen, "route.coding.0.code") && typeof gen.asNeededBoolean === "boolean" && !!at(gen, "timing.repeat.boundsDuration.value"), `${tag}: general dosage has text, duration, route and as-needed.`, `${tag}: general dosage needs text, duration of treatment, route and the as-needed flag.`, "Dosage General 5.1, 5.3, 5.4, 5.7", "required");
    const structured = dosage.length > 1 ? dosage[1] : undefined;
    c.rule(!itemRaqeeb || (dosage.length === 2 && !!at(structured, "timing.repeat.frequency") && !!at(structured, "doseAndRate.0.doseQuantity.value")), itemRaqeeb ? `${tag}: normal dosing is structured.` : `${tag}: structured dosing not required.`, `${tag}: Raqeeb items need exactly one structured Normal Dosing instruction.`, "MedicationRequest 2.18", "required");
    c.rule(DATE.test(str(at(r, "dispenseRequest.validityPeriod.start"))), `${tag}: validity start present.`, `${tag}: validity start must be YYYY-MM-DD.`, "MedicationRequest 2.21");
    c.rule(!itemRaqeeb || DATE.test(str(at(r, "dispenseRequest.validityPeriod.end"))), `${tag}: validity end is set.`, `${tag}: Raqeeb items need a validity end date.`, "MedicationRequest 2.22", "required");
    const repeats = at(r, "dispenseRequest.numberOfRepeatsAllowed");
    c.rule(typeof repeats === "number" && repeats >= 0 && (!controlled || repeats === 0), `${tag}: repeats allowed ${String(repeats)}.`, controlled ? `${tag}: controlled items must have 0 repeats.` : `${tag}: number of repeats is missing.`, "MedicationRequest 2.23", "invalid");
    c.rule(Number(at(r, "dispenseRequest.quantity.value")) > 0 && !!at(r, "dispenseRequest.quantity.unit"), `${tag}: quantity and unit present.`, `${tag}: quantity must be above zero with a unit.`, "MedicationRequest 2.24", "required");
    c.rule(Number(at(r, "dispenseRequest.expectedSupplyDuration.value")) > 0 && !!at(r, "dispenseRequest.expectedSupplyDuration.code"), `${tag}: overall duration present.`, `${tag}: overall duration of treatment is needed.`, "MedicationRequest 2.25", "required");
    c.rule(Number(at(gen, "timing.repeat.boundsDuration.value")) === Number(at(r, "dispenseRequest.expectedSupplyDuration.value")), `${tag}: dosage duration matches overall duration.`, `${tag}: duration in the dosage must equal the overall duration.`, "Dosage General 5.3");
    c.rule(arr(r.reasonCode).length >= 1 && !!at(r, "reasonCode.0.coding.0.code"), `${tag}: reason (diagnosis) present.`, `${tag}: at least one reason (diagnosis code) is needed.`, "MedicationRequest 2.26", "required");
    const support = arr(r.supportingInformation) as R[];
    c.rule(support.length >= 2 && support.every((s) => ids.has(str(s.reference).split("/")[1])), `${tag}: supporting information references resolve.`, `${tag}: supporting information needs height and weight references that exist in the bundle.`, "MedicationRequest 2.27", "required");
    const start = str(at(r, "dispenseRequest.validityPeriod.start"));
    const end = str(at(r, "dispenseRequest.validityPeriod.end"));
    if (end) c.rule(end >= start, `${tag}: validity end is on or after start.`, `${tag}: validity end is before start.`, "MedicationRequest 2.22");
    if (controlled) c.rule(!!at(r, "groupIdentifier.value"), `${tag}: controlled item has a group identifier.`, `${tag}: group identifier is missing.`, "MedicationRequest 2.9", "required");
  });
  return c.out;
}

/** Clinical and workflow rules on the source data, before the bundle is checked. */
export function validatePrescriptionInput(i: PrescriptionIn, opts: { previouslySent: boolean }): RxCheck[] {
  const c = new Collector();
  const raqeeb = i.controlled && i.usage !== "inpatient";
  c.rule(!!i.heightCm && i.heightCm >= 30 && i.heightCm <= 250, "Height is recorded.", "Height is missing or not between 30 and 250 cm.", "Prescription Bundle 1.7", "required");
  c.rule(!!i.weightKg && i.weightKg >= 0.5 && i.weightKg <= 400, "Weight is recorded.", "Weight is missing or not between 0.5 and 400 kg.", "Prescription Bundle 1.7", "required");
  c.rule(i.items.length > 0, "Prescription has items.", "Add at least one item.", "Prescription Bundle 1.8", "required");
  if (raqeeb && opts.previouslySent) {
    c.rule(i.groupIsRaqeeb, "Raqeeb reference id is used as groupIdentifier.", "This Raqeeb prescription was sent before. Use the Raqeeb reference id returned by nphies.", "Success Response (Raqeeb)", "not-found");
  }
  for (const { item, drug, dispensed, statusBefore } of i.items) {
    const t = drug.generic;
    if (isControlled(drug.controlClass)) c.rule(item.refills === 0, `${t}: no repeats.`, `${t}: controlled items cannot have repeats.`, "MedicationRequest 2.23");
    if (item.status === "cancelled") {
      const ok = dispensed === 0 || (isControlled(drug.controlClass) && statusBefore === "completed");
      c.rule(ok, `${t}: cancel is allowed.`, `${t}: cancelled is only for items with no dispense. Use stopped after dispensing started.`, "MedicationRequest 2.7 status table", "invalid");
    }
    if (item.status === "stopped") {
      c.rule(dispensed > 0, `${t}: stopped after a dispense.`, `${t}: stopped means dispensing already started. Nothing is dispensed yet, so use cancel.`, "MedicationRequest 2.7 status table", "invalid", "warn");
    }
    if (item.status === "completed") {
      c.rule(dispensed >= item.quantity, `${t}: fully dispensed.`, `${t}: completed needs the full quantity dispensed.`, "MedicationRequest 2.7 status table", "invalid");
    }
  }
  return c.out;
}

/* ---------- dispense ---------- */

export function validateDispenseBundle(b: FhirBundle): RxCheck[] {
  const c = new Collector();
  checkBundleShell(c, b, PROFILE.bundleDispense, "bundleDispense");
  checkHeader(c, b);
  const ds = resources(b, "MedicationDispense");
  const raqeeb = ds.some((d) => at(d, "meta.tag.0.system") === SYS.secureCode);
  checkCommon(c, b, raqeeb, "pharmacist");
  c.rule(ds.length >= 1, `${ds.length} dispense item(s).`, "At least one MedicationDispense is needed.", "Dispense Bundle 1.7", "required");
  ds.forEach((d, n) => {
    const tag = `Item ${n + 1}`;
    const contained = arr(d.contained) as R[];
    const med = contained.find((x) => x.resourceType === "Medication");
    const mk = contained.find((x) => x.resourceType === "MedicationKnowledge");
    c.rule(at(d, "meta.profile.0") === PROFILE.medicationDispense, `${tag}: profile set.`, `${tag}: profile must be medicationdispense|1.0.`, "MedicationDispense 2.3", "code-invalid");
    c.rule(med?.id === "medicationdispensed" && !!at(med, "code.coding.0.code") && !!at(med, "form.coding.0.code"), `${tag}: dispensed Medication has product code and dose form.`, `${tag}: contained Medication #medicationdispensed needs product code and dose form.`, "Medication Dispensed 2.2 to 2.7", "required");
    c.rule(mk?.id === "medicationknowledge" && !!at(mk, "packaging.type.coding.0.code"), `${tag}: packaging information present.`, `${tag}: contained MedicationKnowledge needs the package form.`, "Medication Knowledge 3.6", "required");
    c.rule(!!at(d, "identifier.0.value"), `${tag}: dispense identifier present.`, `${tag}: dispense identifier is missing.`, "MedicationDispense 2.9", "required");
    c.rule(["completed", "cancelled"].includes(str(d.status)), `${tag}: status ${str(d.status)}.`, `${tag}: status must be completed or cancelled.`, "MedicationDispense 2.10", "code-invalid");
    const when = str(d.whenHandedOver);
    c.rule(DATETIME.test(when) && new Date(when).getTime() <= Date.now() + 60_000, `${tag}: handed-over time is precise and not in the future.`, `${tag}: whenHandedOver must be YYYY-MM-DDThh:mm:ss+zz:zz and not in the future.`, "MedicationDispense 2.11");
    c.rule(!!at(d, "authorizingPrescription.0.identifier.value"), `${tag}: linked to the prescription item.`, `${tag}: authorizingPrescription identifier is missing.`, "MedicationDispense 2.12", "required");
    c.rule(FILL_TYPES.includes(str(at(d, "type.coding.0.code"))), `${tag}: dispense type ${str(at(d, "type.coding.0.code"))}.`, `${tag}: dispense type must be one of ${FILL_TYPES.join(", ")}.`, "MedicationDispense 2.13", "code-invalid");
    c.rule(at(d, "text.status") === "generated", `${tag}: XHTML narrative present.`, `${tag}: narrative must be XHTML with status generated.`, "MedicationDispense 2.14", "required");
    c.rule(str(at(d, "performer.0.actor.reference")).startsWith("PractitionerRole/"), `${tag}: dispenser is a PractitionerRole.`, `${tag}: performer.actor must reference the PractitionerRole.`, "MedicationDispense 2.16", "required");
    c.rule(at(d, "medicationReference.reference") === "#medicationdispensed", `${tag}: medicationReference is #medicationdispensed.`, `${tag}: medicationReference must be #medicationdispensed.`, "MedicationDispense 2.18");
    c.rule(Number(at(d, "quantity.value")) > 0 && !!at(d, "quantity.unit"), `${tag}: quantity dispensed present.`, `${tag}: quantity must be above zero with a unit.`, "MedicationDispense 2.19", "required");
    c.rule(arr(d.dosageInstruction).length >= 1 && !!at(d, "dosageInstruction.0.text"), `${tag}: dosage instructions present.`, `${tag}: dosage instructions are needed.`, "MedicationDispense 2.20", "required");
    c.rule(Number(at(d, "daysSupply.value")) > 0, `${tag}: days supply present.`, `${tag}: days supply (overall duration) is needed.`, "MedicationDispense 2.22", "required");
    c.rule(typeof at(d, "extension.0.valueInteger") === "number", `${tag}: refills remaining present.`, `${tag}: refills remaining extension is needed when a prescription exists.`, "MedicationDispense 2.23", "required");
    c.rule(!!at(d, "category.coding.0.code"), `${tag}: usage category present.`, `${tag}: usage category is needed.`, "MedicationDispense 2.24", "required");
    const tagCode = str(at(d, "meta.tag.0.code"));
    if (tagCode === "Code-Authenticated") c.rule(!!at(d, "meta.tag.0.extension.0.valueString"), `${tag}: SecureCode value present.`, `${tag}: Code-Authenticated needs the SecureCode value.`, "MedicationDispense 2.6", "required");
    if (tagCode === "Code-Override") {
      c.rule(!!at(d, "meta.tag.0.extension.0.valueCodeableConcept.coding.0.display"), `${tag}: override justification present.`, `${tag}: Code-Override needs a justification.`, "MedicationDispense 2.5", "required");
      c.rule(!!at(d, "receiver.0.identifier.value"), `${tag}: receiver Health ID present.`, `${tag}: Code-Override needs the receiver Health ID.`, "MedicationDispense 2.25", "required");
    }
  });
  return c.out;
}

/** Workflow rules for a dispense, on the source data. Quantity limits are checked earlier by the fill logic. */
export function validateDispenseInput(i: DispenseIn): RxCheck[] {
  const c = new Collector();
  for (const l of i.lines) {
    const t = l.drug.generic;
    c.rule(l.item.status === "active" || l.line.status === "cancelled" || l.item.status === "completed", `${t}: prescription item is open.`, `${t}: the prescription item is ${l.item.status}. It cannot be dispensed.`, "MedicationRequest 2.7 status table", "invalid");
    c.rule(l.line.quantity > 0, `${t}: quantity above zero.`, `${t}: quantity must be above zero.`, "MedicationDispense 2.19", "required");
    if (i.raqeebScope) {
      c.rule(l.line.refillsRemaining === 0, `${t}: remaining refills are 0 (Raqeeb).`, `${t}: Raqeeb controlled items must have 0 refills remaining.`, "MedicationDispense 2.23", "invalid");
      c.rule(!!i.secure, `${t}: SecureCode tag present.`, `${t}: SecureCode (OTP) or an override reason is expected for Raqeeb items.`, "MedicationDispense 2.4", "required", "warn");
    }
  }
  return c.out;
}

/* ---------- simulated endpoint ---------- */

export interface SimResponse {
  http: 201 | 400;
  outcome: Json;
  refId?: string;
}

/** Stable demo reference id from a seed. Format is made up. */
export function makeRaqeebRef(seed: number): string {
  return `RQB${String(10000000 + ((seed * 7919) % 90000000))}`;
}

/**
 * Pretends to be the nphies/Raqeeb endpoint. Any error check gives HTTP 400 and an OperationOutcome.
 * Otherwise 201 and an informational OperationOutcome that carries the Raqeeb reference id when in scope.
 */
export function simulateResponse(opts: {
  checks: RxCheck[];
  kind: "prescription" | "dispense";
  raqeebScope: boolean;
  groupId: string;
  /** Reference id already issued for this prescription. */
  existingRef?: string;
  /** Reference id to issue if this is the first accepted submission. */
  newRef: string;
}): SimResponse {
  const errors = opts.checks.filter((c) => c.level === "error");
  if (errors.length) {
    return {
      http: 400,
      outcome: {
        resourceType: "OperationOutcome",
        issue: errors.map((e) => ({
          severity: "error",
          code: e.code ?? "invalid",
          details: { text: e.text },
          ...(e.spec ? { diagnostics: `Rule: ${e.spec}` } : {}),
        })),
      },
    };
  }
  const refId = opts.raqeebScope ? opts.existingRef ?? opts.newRef : undefined;
  const text =
    opts.kind === "prescription"
      ? opts.raqeebScope
        ? `Raqeeb Prescription Reference ID = ${refId}`
        : `Prescription accepted. Reference ID = ${opts.groupId}`
      : opts.raqeebScope
        ? `Dispense accepted. Raqeeb Prescription Reference ID = ${refId}`
        : "Dispense accepted";
  return {
    http: 201,
    refId,
    outcome: {
      resourceType: "OperationOutcome",
      issue: [{ severity: "information", code: "informational", details: { text }, diagnostics: refId ?? opts.groupId }],
    },
  };
}
