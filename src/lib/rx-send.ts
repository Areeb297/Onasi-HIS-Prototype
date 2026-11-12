import { audit } from "./audit";
import {
  buildDispenseBundle, buildPrescriptionBundle, uuid, type DispenseIn, type FhirBundle, type ItemIn, type PatientIn, type PractitionerIn,
  type PrescriptionIn,
} from "./fhir/medication";
import {
  makeNationalRef, simulateResponse, validateDispenseBundle, validateDispenseInput, validatePrescriptionBundle, validatePrescriptionInput,
} from "./fhir/medication-validate";
import type { Encounter, Patient } from "./model";
import { DOCTORS, FACILITY_NAME, ORG_ID } from "./reference-data";
import { addSendRecord, dispenseNumber, getDrug, getRx, linesFor, newId, refreshStatuses, setRx } from "./rx";
import {
  classifyDispense, dispenseSteps, fillState, isControlled, isRaqeebScope, prescriptionSteps, refillsRemainingAfter, validateDispenseQty,
  type PrescriptionAction,
} from "./rx-logic";
import type { Dispense, DispenseLine, ItemStatus, Prescription, RxCheck, RxItem, RxState, SendRecord } from "./rx-types";
import { currentUser } from "./session";
import { getState } from "./store";

/** Assembles FHIR input from the chart, sends through the simulator and records the result. */

export interface SendOutcome {
  ok: boolean;
  record: SendRecord;
  refId?: string;
}

/* ---------- people and visit ---------- */

/**
 * Doctor specialties. Demo codes: the real "Healthcare Specialty Identifier" codes are in IS0200 (page 118063485).
 * Pharmacy below is the real code from the official sample messages.
 */
const SPECIALTY: Record<string, [string, string]> = {
  MED: ["DEMO-SPEC-INTERNAL-MEDICINE", "Internal Medicine"],
  SUR: ["DEMO-SPEC-GENERAL-SURGERY", "General Surgery"],
  ICU: ["DEMO-SPEC-CRITICAL-CARE", "Critical Care"],
  RAD: ["DEMO-SPEC-RADIOLOGY", "Radiology"],
  ORT: ["DEMO-SPEC-ORTHOPEDICS", "Orthopedics"],
};
const PHARMACY_SPECIALTY = "FB9D7C6B-62F9-E811-B80F-005056AD2FD8";

function digits(s: string, n: number): string {
  return s.replace(/\D/g, "").padStart(n, "0").slice(-n);
}

export function patientIn(p: Patient): PatientIn {
  return {
    id: p.id,
    healthId: p.healthId,
    family: p.family,
    given: p.given,
    dob: p.dob,
    sex: p.sex,
    // Made-up E.164 number. The demo patient record has no phone.
    phone: `+9665${digits(p.nationalId, 8)}`,
  };
}

export function prescriberIn(doctorId: string): PractitionerIn {
  const d = DOCTORS.find((x) => x.id === doctorId) ?? DOCTORS[0];
  const [code, text] = SPECIALTY[d.service] ?? ["DEMO-SPEC-GENERAL-PRACTICE", "General Practice"];
  // The provider id is the doctor id, the same value ADT sends in PV1-7 and the lab, radiology and document messages send.
  return { providerId: d.id, family: d.family, given: d.given, phone: `+96655${digits(d.id, 7)}`, specialtyCode: code, specialtyText: text, role: "prescriber" };
}

export function pharmacistIn(): PractitionerIn {
  const u = currentUser();
  const words = u.name.split(",")[0].replace(/^Dr\.\s*/, "").split(" ");
  return {
    providerId: u.id,
    given: words[0] ?? u.name,
    family: words.slice(1).join(" ") || words[0] || u.name,
    phone: `+96654${digits(u.id, 7)}`,
    specialtyCode: PHARMACY_SPECIALTY,
    specialtyText: "Pharmacy",
    role: "pharmacist",
  };
}

export function encounterIn(e: Encounter) {
  const start = e.admitAt ?? e.expectedAdmitAt ?? new Date(Date.now() - 3600_000).toISOString().slice(0, 16);
  return { visitNumber: e.visitNumber, cls: e.cls, startAt: start, endAt: e.dischargeAt, facilityName: FACILITY_NAME };
}

/** The organisation id is ORG_ID, the same value the ADT messages send in MSH-4 and the clinical documents send as custodian. */
export const orgIn = () => ({ id: ORG_ID, name: FACILITY_NAME });

export function ageOf(dob: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000)));
}

/** Weight in kg from the chart vitals. Height lives in the prescription store. */
export function measuresFor(s: RxState, e: Encounter): { heightCm?: number; weightKg?: number } {
  const w = parseFloat(e.vitals?.weight ?? "");
  return { heightCm: s.heights[e.visitNumber], weightKg: w > 0 ? w : undefined };
}

function find(rx: { visitNumber: string; patientId: string }) {
  const hs = getState();
  const enc = hs.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const patient = hs.patients.find((p) => p.id === rx.patientId);
  return { enc, patient };
}

/* ---------- deterministic ids for previews ---------- */

export function seededUuid(seed: string): () => string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let n = 0;
  return () => {
    n += 1;
    let x = (h ^ Math.imul(n, 2654435761)) >>> 0;
    let out = "";
    for (let i = 0; i < 32; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out += (x >>> 28).toString(16);
    }
    return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-8${out.slice(17, 20)}-${out.slice(20, 32)}`;
  };
}

/* ---------- prescription ---------- */

export interface PrescriptionPlan {
  input: PrescriptionIn;
  bundle: FhirBundle;
  checks: RxCheck[];
}

export function planPrescription(s: RxState, rx: Prescription, change?: { itemId: string; status: ItemStatus }, stable = true): PrescriptionPlan | null {
  const { enc, patient } = find(rx);
  if (!enc || !patient) return null;
  const m = measuresFor(s, enc);
  const lines = linesFor(s, rx.id);
  const items: ItemIn[] = rx.items.map((item) => {
    const drug = getDrug(item.drugId);
    const dispensed = fillState(item, lines).dispensedTotal;
    const moved = change && change.itemId === item.id;
    return { item: moved ? { ...item, status: change.status } : item, drug, dispensed, statusBefore: item.status };
  });
  const input: PrescriptionIn = {
    groupId: rx.groupId,
    groupFromNphies: !!(rx.nationalRef ?? rx.raqeebRef),
    controlled: rx.controlled,
    usage: rx.usage,
    authoredAt: new Date(rx.authoredAt),
    patient: patientIn(patient),
    practitioner: prescriberIn(rx.prescriberId),
    org: orgIn(),
    encounter: encounterIn(enc),
    heightCm: m.heightCm,
    weightKg: m.weightKg,
    ageYears: ageOf(patient.dob),
    allergies: enc.allergies.map((a) => ({ code: a.code, text: a.text, severity: a.severity, reaction: a.reaction })),
    items,
  };
  const bundle = buildPrescriptionBundle(input, { uuid: stable ? seededUuid(`${rx.id}:${rx.items.map((i) => i.version + i.status).join()}:${change?.status ?? ""}`) : uuid });
  const checks = [...validatePrescriptionInput(input, { previouslySent: !!rx.sentAt }), ...validatePrescriptionBundle(bundle)];
  return { input, bundle, checks };
}

function record(p: Omit<SendRecord, "id" | "at">): SendRecord {
  return { id: newId("snd"), at: new Date().toISOString(), ...p };
}

/**
 * Send a prescription to the simulated Raqeeb endpoint.
 * For cancel, hold, resume and stop, pass the item and the new status. The change is kept only if the response is accepted.
 */
export function sendPrescription(rxId: string, action: PrescriptionAction, change?: { itemId: string; status: ItemStatus; reason?: string }): SendOutcome | null {
  const s = getRx();
  const rx = s.prescriptions.find((p) => p.id === rxId);
  if (!rx) return null;
  const plan = planPrescription(s, rx, change, false);
  if (!plan) return null;
  const raqeeb = isRaqeebScope(rx.controlled, rx.usage);
  const sim = simulateResponse({ checks: plan.checks, kind: "prescription", raqeebScope: raqeeb, groupId: rx.groupId, existingRef: rx.nationalRef ?? rx.raqeebRef, newRef: makeNationalRef(s.counters.ref + 1, raqeeb) });
  const ok = sim.http === 201;
  const before = change ? rx.items.find((i) => i.id === change.itemId)?.status ?? "active" : "active";
  const rec = record({
    kind: "prescription",
    steps: prescriptionSteps(action, rx.controlled, before),
    action,
    targetId: rx.id,
    http: sim.http,
    ok,
    refId: sim.refId,
    summary: `${rx.number} ${action}: HTTP ${sim.http}`,
    checks: plan.checks,
    bundle: plan.bundle,
    outcome: sim.outcome,
  });
  let next = addSendRecord(s, rec);
  const now = new Date().toISOString();
  if (ok) {
    const known = rx.nationalRef ?? rx.raqeebRef;
    const isNewRef = !!sim.refId && !known;
    const updated: Prescription = {
      ...rx,
      items: rx.items.map((i) => (change && i.id === change.itemId ? { ...i, status: change.status, statusReason: change.reason } : i)),
      sentAt: rx.sentAt ?? now,
      dirty: false,
      nationalRef: sim.refId ?? known,
      raqeebRef: raqeeb ? sim.refId ?? rx.raqeebRef : rx.raqeebRef,
      groupId: isNewRef ? (sim.refId as string) : rx.groupId,
      lastSend: { at: now, http: sim.http, ok: true },
    };
    next = { ...next, prescriptions: next.prescriptions.map((p) => (p.id === rx.id ? updated : p)), counters: { ...next.counters, ref: isNewRef ? next.counters.ref + 1 : next.counters.ref } };
  } else {
    next = { ...next, prescriptions: next.prescriptions.map((p) => (p.id === rx.id ? { ...p, lastSend: { at: now, http: sim.http, ok: false } } : p)) };
  }
  setRx(next);
  audit("send-fhir", `Prescription ${rx.number}`, {
    patient: rx.patientId,
    detail: `Visit ${rx.visitNumber}. ${action}. HTTP ${sim.http}${sim.refId ? `. ${raqeeb ? "Raqeeb ref" : "Reference"} ${sim.refId}` : ""}`,
  });
  return { ok, record: rec, refId: sim.refId };
}

/* ---------- dispense ---------- */

export interface DispenseRequest {
  rxId: string;
  lines: { itemId: string; quantity: number; lot?: string; expiry?: string }[];
  secure?: Dispense["secure"];
  verification: Dispense["verification"];
}

export interface DispensePlan {
  dispense: Dispense;
  input: DispenseIn;
  bundle: FhirBundle;
  checks: RxCheck[];
  /** Problems found before any message. These stop the dispense and are not sent. */
  problems: string[];
  raqeeb: boolean;
}

function dispenseInput(s: RxState, rx: Prescription, d: Dispense, lines: DispenseLine[]): DispenseIn | null {
  const { enc, patient } = find(rx);
  if (!enc || !patient) return null;
  return {
    usage: rx.usage,
    raqeebScope: isRaqeebScope(rx.controlled, rx.usage),
    handedOverAt: new Date(d.handedOverAt),
    patient: patientIn(patient),
    dispenser: pharmacistIn(),
    org: orgIn(),
    encounter: encounterIn(enc),
    secure: d.secure,
    lines: lines.map((line) => {
      const item = rx.items.find((i) => i.id === line.itemId) ?? rx.items[0];
      return { line, item, drug: getDrug(line.drugId), controlled: isControlled(getDrug(line.drugId).controlClass) };
    }),
  };
}

export function planDispense(s: RxState, req: DispenseRequest, stable = true): DispensePlan | null {
  const rx = s.prescriptions.find((p) => p.id === req.rxId);
  if (!rx) return null;
  const problems: string[] = [];
  const prior = linesFor(s, rx.id);
  const num = s.counters.disp + 1;
  const dispenseId = `dsp-${num}`;
  const lines: DispenseLine[] = [];
  req.lines.forEach((l, idx) => {
    const item = rx.items.find((i) => i.id === l.itemId);
    if (!item) return;
    const drug = getDrug(item.drugId);
    if (item.status !== "active") problems.push(`${drug.generic} is ${item.status}. It cannot be dispensed.`);
    const st = fillState(item, prior);
    const err = validateDispenseQty(st, l.quantity);
    if (err) problems.push(`${drug.generic}: ${err}`);
    lines.push({
      id: `dl-${num}-${idx + 1}`,
      identifier: `${dispenseNumber(num)}-${idx + 1}`,
      itemId: item.id,
      drugId: drug.id,
      quantity: l.quantity,
      type: classifyDispense(st, l.quantity),
      status: "completed",
      lot: l.lot,
      expiry: l.expiry,
      refillsRemaining: rx.controlled ? 0 : refillsRemainingAfter(item, st),
      daysSupply: Math.max(1, Math.round((item.durationDays * l.quantity) / Math.max(1, item.quantity))),
      version: 1,
    });
  });
  if (!req.lines.length) problems.push("Pick at least one item.");
  const v = req.verification;
  if (!v.skippedReason) {
    if (!v.patientScan) problems.push("Scan the patient wristband first.");
    const missing = lines.filter((l) => !v.drugScans.includes(l.itemId));
    if (missing.length) problems.push(`Scan the drug for: ${missing.map((l) => getDrug(l.drugId).generic).join(", ")}.`);
  }
  const dispense: Dispense = {
    id: dispenseId,
    number: dispenseNumber(num),
    rxId: rx.id,
    visitNumber: rx.visitNumber,
    patientId: rx.patientId,
    dispenser: currentUser().name,
    handedOverAt: new Date(Date.now() - 1000).toISOString(),
    lines,
    secure: req.secure,
    verification: req.verification,
  };
  const input = dispenseInput(s, rx, dispense, lines);
  if (!input) return null;
  const bundle = buildDispenseBundle(input, { uuid: stable ? seededUuid(`${dispenseId}:${lines.map((l) => l.quantity + l.type).join()}`) : uuid });
  const checks = [...validateDispenseInput(input), ...validateDispenseBundle(bundle)];
  return { dispense, input, bundle, checks, problems, raqeeb: input.raqeebScope };
}

function sendDispenseBundle(
  s: RxState, rx: Prescription, input: DispenseIn, bundle: FhirBundle, checks: RxCheck[], action: "dispense" | "cancel" | "update", steps: string[], label: string,
): { ok: boolean; rec: SendRecord; state: RxState } {
  const sim = simulateResponse({ checks, kind: "dispense", raqeebScope: input.raqeebScope, groupId: rx.groupId, existingRef: rx.nationalRef ?? rx.raqeebRef, newRef: "" });
  const rec = record({
    kind: "dispense",
    steps,
    action,
    targetId: label,
    http: sim.http,
    ok: sim.http === 201,
    refId: sim.refId,
    summary: `${label} ${action}: HTTP ${sim.http}`,
    checks,
    bundle,
    outcome: sim.outcome,
  });
  return { ok: rec.ok, rec, state: addSendRecord(s, rec) };
}

/** Dispense one or more items of a prescription. Nothing is kept if the response is an error. */
export function sendDispense(req: DispenseRequest): { outcome: SendOutcome | null; problems: string[] } {
  const s = getRx();
  const plan = planDispense(s, req, false);
  if (!plan) return { outcome: null, problems: ["Prescription not found."] };
  if (plan.problems.length) return { outcome: null, problems: plan.problems };
  const rx = s.prescriptions.find((p) => p.id === req.rxId) as Prescription;
  const types = plan.dispense.lines.map((l) => l.type);
  const controlled = plan.dispense.lines.every((l) => isControlled(getDrug(l.drugId).controlClass));
  const steps = dispenseSteps("dispense", controlled, types);
  const sent = sendDispenseBundle(s, rx, plan.input, plan.bundle, plan.checks, "dispense", steps, plan.dispense.number);
  let next = sent.state;
  if (sent.ok) {
    const n = s.counters.disp + 1;
    next = refreshStatuses({ ...next, dispenses: [...next.dispenses, plan.dispense], counters: { ...next.counters, disp: n } }, rx.id);
    const lowRem = plan.dispense.lines.map((l) => `${getDrug(l.drugId).generic} ${l.quantity} (${l.type})`).join("; ");
    audit("create", `Dispense ${plan.dispense.number}`, {
      patient: rx.patientId,
      detail: `Visit ${rx.visitNumber}. ${lowRem}.${req.verification.skippedReason ? ` Scan skipped: ${req.verification.skippedReason}` : " Wristband and drug scans matched."}`,
    });
  }
  setRx(next);
  audit("send-fhir", `Dispense ${plan.dispense.number}`, { patient: rx.patientId, detail: `Visit ${rx.visitNumber}. HTTP ${sent.rec.http}${sent.rec.refId ? `. Reference ${sent.rec.refId}` : ""}` });
  return { outcome: { ok: sent.ok, record: sent.rec, refId: sent.rec.refId }, problems: [] };
}

/**
 * Cancel or update a completed dispense line. The new version replaces the old one (Workflows page 117964923, Exception 1),
 * for every medication type. Only the controlled ones count toward a Seha conformance step (7.4).
 */
export function changeDispenseLine(
  dispenseId: string, lineId: string, action: "cancel" | "update", patch: { quantity?: number; lot?: string; expiry?: string } = {},
): { outcome: SendOutcome | null; problems: string[] } {
  const s = getRx();
  const d = s.dispenses.find((x) => x.id === dispenseId);
  const rx = d && s.prescriptions.find((p) => p.id === d.rxId);
  const line = d?.lines.find((l) => l.id === lineId);
  if (!d || !rx || !line) return { outcome: null, problems: ["Dispense not found."] };
  const item = rx.items.find((i) => i.id === line.itemId) as RxItem;
  const controlled = isControlled(getDrug(line.drugId).controlClass);
  if (line.status === "cancelled") return { outcome: null, problems: ["This dispense is already cancelled."] };
  const others = linesFor(s, rx.id).filter((l) => l.id !== line.id);
  const st = fillState(item, others);
  const qty = patch.quantity ?? line.quantity;
  if (action === "update") {
    const err = validateDispenseQty(st, qty);
    if (err) return { outcome: null, problems: [err] };
  }
  const changed: DispenseLine = {
    ...line,
    version: line.version + 1,
    status: action === "cancel" ? "cancelled" : "completed",
    quantity: action === "update" ? qty : line.quantity,
    type: action === "update" ? classifyDispense(st, qty) : line.type,
    lot: action === "update" ? patch.lot ?? line.lot : line.lot,
    expiry: action === "update" ? patch.expiry ?? line.expiry : line.expiry,
  };
  const draft: Dispense = { ...d, handedOverAt: new Date(Date.now() - 1000).toISOString(), lines: [changed] };
  const input = dispenseInput(s, rx, draft, [changed]);
  if (!input) return { outcome: null, problems: ["Visit not found."] };
  const bundle = buildDispenseBundle(input, { uuid });
  const checks = [...validateDispenseInput(input), ...validateDispenseBundle(bundle)];
  const sent = sendDispenseBundle(s, rx, input, bundle, checks, action, dispenseSteps(action, controlled, [changed.type]), d.number);
  let next = sent.state;
  if (sent.ok) {
    next = refreshStatuses({ ...next, dispenses: next.dispenses.map((x) => (x.id === d.id ? { ...x, lines: x.lines.map((l) => (l.id === line.id ? changed : l)) } : x)) }, rx.id);
    audit(action === "cancel" ? "delete" : "update", `Dispense ${d.number}`, {
      patient: rx.patientId,
      detail: `Visit ${rx.visitNumber}. ${action === "cancel" ? "Cancelled" : `Updated to ${qty}`} ${getDrug(line.drugId).generic} (${line.identifier})`,
    });
  }
  setRx(next);
  audit("send-fhir", `Dispense ${d.number}`, { patient: rx.patientId, detail: `Visit ${rx.visitNumber}. ${action}. HTTP ${sent.rec.http}` });
  return { outcome: { ok: sent.ok, record: sent.rec, refId: sent.rec.refId }, problems: [] };
}

