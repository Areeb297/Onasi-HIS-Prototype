import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { assemble, buildSegments, countChecks, messageToString, segmentStatuses, validate, type BuiltMessage } from "./hl7";
import type { Encounter, HisState, LogEntry, LogSource, Patient, ScenarioForm } from "./model";
import {
  ALLERGY_SAMPLES, BEDS, BED_BY_ID, DEFAULT_DISPOSITION, DISPOSITIONS, DOCTORS, DX_SAMPLES, PR_SAMPLES, SEED_PATIENTS, countryCode, defaultAdmissionMethod,
} from "./reference-data";
import { EVENT_BY_ID, STANDARD_SEGMENTS, Z_SEGMENTS, type EventId, type SegId } from "./spec";

/** v3: nationality, discharge disposition, arrival mode and patient class moved to the published NPHIES value sets. Older saved data is not read. */
const KEY = "onasi-his-adt-v3";

/* ---------- time helpers ---------- */

export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowLocal(offsetMinutes = 0): string {
  return toLocalInput(new Date(Date.now() + offsetMinutes * 60_000));
}

/* ---------- selectors ---------- */

export function patientName(p: Patient | undefined): string {
  return p ? `${p.given} ${p.family}` : "Unknown";
}

export function bedLabel(bedId?: string): string {
  const b = bedId ? BED_BY_ID[bedId] : undefined;
  return b ? `${b.ward} ${b.room}-${b.bed}` : "No bed";
}

export function occupiedBeds(state: HisState): Record<string, Encounter> {
  const out: Record<string, Encounter> = {};
  for (const e of state.encounters) if (e.status === "active" && e.bedId) out[e.bedId] = e;
  return out;
}

export function freeBeds(state: HisState, includeBedId?: string) {
  const occ = occupiedBeds(state);
  return BEDS.filter((b) => !occ[b.id] || b.id === includeBedId);
}

/** Which visits each event can act on. "new" events do not need one. */
export function eligible(eventId: EventId, e: Encounter): boolean {
  switch (eventId) {
    case "A02": return e.status === "active" && e.cls === "I";
    case "A03": return e.status === "active";
    case "A06": return e.status === "active" && (e.cls === "O" || e.cls === "E");
    case "A07": return e.status === "active" && e.cls === "I";
    case "A08": return e.status === "active" || e.status === "discharged";
    case "A08-CNHI": return e.status === "discharged";
    case "A11": return e.status === "active";
    case "A12": return e.status === "active" && e.transfers.length > 0;
    case "A13": return e.status === "discharged";
    case "A31": return e.status !== "cancelled";
    case "A38": return e.status === "preadmit";
    case "A45": return e.status !== "cancelled";
    case "A50": return e.status !== "cancelled";
    default: return false;
  }
}

export const NEW_VISIT_EVENTS: EventId[] = ["A01", "A04", "A05"];

export function needsExistingVisit(eventId: EventId): boolean {
  return !NEW_VISIT_EVENTS.includes(eventId);
}

/* ---------- state transitions ---------- */

function nextVisitNumber(state: HisState): string {
  return `V${100001 + state.counters.visit}`;
}

export function emptyForm(state: HisState, eventId: EventId): ScenarioForm {
  const now = nowLocal();
  return {
    patientId: "",
    encounterId: "",
    visitNumber: nextVisitNumber(state),
    // A pre-admission (A05) is for a planned inpatient stay. "Pre-admit" is the visit status, not a class.
    cls: eventId === "A04" ? "O" : "I",
    bedId: "",
    attending: DOCTORS[0].id,
    admitting: DOCTORS[0].id,
    referring: "",
    consulting: "",
    // Empty means "the usual method for the class": 15 (Emergency) for an emergency visit, 14 (Elective) otherwise.
    admissionMethod: "",
    service: "MED",
    reason: "",
    reasonCode: "",
    eventAt: now,
    admitAt: now,
    dischargeAt: "",
    expectedAdmitAt: "",
    expectedDischargeAt: "",
    disposition: DEFAULT_DISPOSITION,
    dx: [],
    pr: [],
    allergies: [],
    family: "",
    given: "",
    dob: "",
    sex: "M",
    correctPatientId: "",
    newVisitNumber: "",
    oldPatientId: "",
  };
}

/** Fill the form from an existing visit, with sensible values for the event. */
export function formFromEncounter(state: HisState, eventId: EventId, enc: Encounter, base?: ScenarioForm): ScenarioForm {
  const f = { ...(base ?? emptyForm(state, eventId)) };
  const patient = state.patients.find((p) => p.id === enc.patientId);
  f.patientId = enc.patientId;
  f.encounterId = enc.visitNumber;
  f.cls = enc.cls;
  f.bedId = enc.bedId ?? "";
  f.attending = enc.attending;
  f.admitting = enc.admitting;
  f.consulting = enc.consulting ?? "";
  f.admissionMethod = enc.admissionMethod ?? defaultAdmissionMethod(enc.cls);
  f.service = enc.service;
  f.reason = enc.reason;
  f.reasonCode = enc.reasonCode ?? "";
  f.admitAt = enc.admitAt ?? "";
  f.dischargeAt = enc.dischargeAt ?? "";
  f.expectedAdmitAt = enc.expectedAdmitAt ?? "";
  f.expectedDischargeAt = enc.expectedDischargeAt ?? "";
  f.disposition = DISPOSITIONS.some((d) => d.code === enc.disposition) ? enc.disposition! : DEFAULT_DISPOSITION;
  f.dx = enc.dx.map((d) => ({ ...d }));
  f.pr = enc.pr.map((p) => ({ ...p }));
  f.allergies = enc.allergies.map((a) => ({ ...a }));
  if (patient) {
    f.family = patient.family;
    f.given = patient.given;
    f.dob = patient.dob;
    f.sex = patient.sex;
  }
  switch (eventId) {
    case "A03":
      // The discharge diagnosis comes from the chart. Nothing is filled in for the user: A03 cannot be sent without one.
      f.dischargeAt = nowLocal();
      break;
    case "A06":
      // 02: emergency admission from the hospital ER. 03: emergency admission from hospital outpatient.
      f.admissionMethod = enc.cls === "E" ? "02" : "03";
      f.cls = "I";
      f.bedId = "";
      f.admitAt = nowLocal();
      break;
    case "A07":
      f.cls = "O";
      break;
    case "A12": {
      const back = enc.transfers[enc.transfers.length - 1];
      f.bedId = back ?? "";
      break;
    }
    case "A13":
      f.bedId = enc.lastBedId ?? "";
      f.dischargeAt = "";
      break;
    case "A08-CNHI":
      if (!f.dischargeAt) f.dischargeAt = nowLocal();
      break;
    case "A45":
      f.correctPatientId = "";
      break;
    case "A50":
      f.newVisitNumber = nextVisitNumber(state);
      f.oldPatientId = enc.patientId;
      break;
    default:
      break;
  }
  f.eventAt = nowLocal();
  return f;
}

function cloneState(s: HisState): HisState {
  return {
    patients: s.patients.map((p) => ({ ...p })),
    encounters: s.encounters.map((e) => ({ ...e, transfers: [...e.transfers], dx: [...e.dx], pr: [...e.pr], allergies: [...e.allergies], complaints: [...e.complaints], notes: [...e.notes], ed: e.ed ? { ...e.ed } : undefined })),
    log: s.log,
    counters: { ...s.counters },
  };
}

/** Apply the effect of an event on the HIS data. Returns a new state. */
export function applyEvent(state: HisState, eventId: EventId, form: ScenarioForm): HisState {
  const next = cloneState(state);
  const findEnc = (v: string) => next.encounters.find((e) => e.visitNumber === v);
  const copyClinical = (e: Encounter) => {
    e.attending = form.attending;
    e.admitting = form.admitting;
    e.consulting = form.consulting || undefined;
    e.admissionMethod = form.admissionMethod || undefined;
    e.service = form.service;
    e.reason = form.reason;
    e.reasonCode = form.reasonCode || undefined;
    e.dx = form.dx.map((d) => ({ ...d }));
    e.pr = form.pr.map((p) => ({ ...p }));
    e.allergies = form.allergies.map((a) => ({ ...a }));
  };

  switch (eventId) {
    case "A01": {
      let e = form.encounterId ? findEnc(form.encounterId) : undefined;
      if (!e) {
        e = {
          visitNumber: form.visitNumber, patientId: form.patientId, cls: "I", status: "active", transfers: [],
          attending: form.attending, admitting: form.admitting, service: form.service, reason: form.reason,
          dx: [], pr: [], allergies: [], complaints: form.reason ? [{ code: "", text: form.reason }] : [], notes: [],
        };
        next.encounters.push(e);
        next.counters.visit += 1;
      }
      // A01 normally starts an inpatient stay. It can also activate a visit as outpatient (the class picked on the form).
      e.cls = form.cls === "O" ? "O" : "I";
      e.status = "active";
      e.bedId = e.cls === "I" ? form.bedId || undefined : undefined;
      e.admitAt = form.admitAt || form.eventAt;
      e.expectedAdmitAt = undefined;
      copyClinical(e);
      break;
    }
    case "A04": {
      next.encounters.push({
        visitNumber: form.visitNumber, patientId: form.patientId, cls: form.cls === "E" ? "E" : "O", status: "active",
        transfers: [], attending: form.attending, admitting: form.admitting, service: form.service, reason: form.reason,
        reasonCode: form.reasonCode || undefined, consulting: form.consulting || undefined, admissionMethod: form.admissionMethod || undefined,
        admitAt: form.admitAt || form.eventAt, dx: form.dx.map((d) => ({ ...d })), pr: form.pr.map((p) => ({ ...p })),
        allergies: form.allergies.map((a) => ({ ...a })), complaints: form.reason ? [{ code: "", text: form.reason }] : [], notes: [],
      });
      next.counters.visit += 1;
      break;
    }
    case "A05": {
      next.encounters.push({
        visitNumber: form.visitNumber, patientId: form.patientId, cls: "I", status: "preadmit", transfers: [],
        attending: form.attending, admitting: form.admitting, service: form.service, reason: form.reason,
        reasonCode: form.reasonCode || undefined, consulting: form.consulting || undefined, admissionMethod: form.admissionMethod || undefined,
        expectedAdmitAt: form.expectedAdmitAt, expectedDischargeAt: form.expectedDischargeAt,
        dx: form.dx.map((d) => ({ ...d })), pr: form.pr.map((p) => ({ ...p })), allergies: form.allergies.map((a) => ({ ...a })),
        complaints: form.reason ? [{ code: "", text: form.reason }] : [], notes: [],
      });
      next.counters.visit += 1;
      break;
    }
    case "A02": {
      const e = findEnc(form.encounterId);
      if (e) {
        if (e.bedId) e.transfers.push(e.bedId);
        e.bedId = form.bedId || undefined;
      }
      break;
    }
    case "A03": {
      const e = findEnc(form.encounterId);
      if (e) {
        e.lastBedId = e.bedId;
        e.bedId = undefined;
        e.status = "discharged";
        e.dischargeAt = form.dischargeAt || form.eventAt;
        e.disposition = form.disposition;
        e.dirty = false;
        e.dx = form.dx.map((d) => ({ ...d }));
        e.pr = form.pr.map((p) => ({ ...p }));
        e.allergies = form.allergies.map((a) => ({ ...a }));
      }
      break;
    }
    case "A06": {
      const e = findEnc(form.encounterId);
      if (e) {
        e.cls = "I";
        e.bedId = form.bedId || undefined;
        e.admitAt = form.admitAt || form.eventAt;
        copyClinical(e);
      }
      break;
    }
    case "A07": {
      const e = findEnc(form.encounterId);
      if (e) {
        e.cls = "O";
        e.lastBedId = e.bedId;
        e.bedId = undefined;
        e.transfers = [];
        copyClinical(e);
      }
      break;
    }
    case "A08":
    case "A08-CNHI": {
      const e = findEnc(form.encounterId);
      if (e) {
        copyClinical(e);
        e.dirty = false;
        if (eventId === "A08-CNHI") e.dischargeAt = form.dischargeAt || e.dischargeAt;
      }
      break;
    }
    case "A11": {
      const e = findEnc(form.encounterId);
      if (e) {
        e.status = "cancelled";
        e.lastBedId = e.bedId;
        e.bedId = undefined;
        e.transfers = [];
      }
      break;
    }
    case "A12": {
      const e = findEnc(form.encounterId);
      if (e && e.transfers.length) {
        e.bedId = e.transfers.pop();
      }
      break;
    }
    case "A13": {
      const e = findEnc(form.encounterId);
      if (e) {
        e.status = "active";
        e.dischargeAt = undefined;
        e.bedId = form.bedId || undefined;
      }
      break;
    }
    case "A31": {
      const p = next.patients.find((x) => x.id === form.patientId);
      if (p) {
        p.family = form.family;
        p.given = form.given;
        p.dob = form.dob;
        p.sex = form.sex;
      }
      break;
    }
    case "A38": {
      const e = findEnc(form.encounterId);
      if (e) e.status = "cancelled";
      break;
    }
    case "A45": {
      const e = findEnc(form.encounterId);
      if (e && form.correctPatientId) e.patientId = form.correctPatientId;
      break;
    }
    case "A50": {
      const e = findEnc(form.encounterId);
      if (e && form.newVisitNumber) e.visitNumber = form.newVisitNumber;
      break;
    }
  }
  return next;
}

/* ---------- building and validating from a form ---------- */

export type Include = Record<SegId, boolean>;

export function planMessage(state: HisState, eventId: EventId, form: ScenarioForm, overrides: Partial<Include> = {}, messageAt?: string) {
  const event = EVENT_BY_ID[eventId];
  const controlId = `HIS${String(state.counters.seq + 1).padStart(6, "0")}`;
  const built: BuiltMessage = buildSegments({ state, event, form, controlId, messageAt });
  const include = { ...built.defaults, ...overrides } as Include;
  const segs = assemble(built, include);
  const checks = validate(event, segs);
  return { event, controlId, built, include, segs, checks, message: messageToString(segs), statuses: segmentStatuses(event, segs) };
}

/** Whether the form has what the event needs to run. Returns a reason when it does not. */
export function formProblem(state: HisState, eventId: EventId, form: ScenarioForm): string | null {
  if (!form.patientId) return "Pick a patient first.";
  if (needsExistingVisit(eventId) && !form.encounterId) return "Pick a visit first.";
  if (eventId === "A45" && !form.correctPatientId) return "Pick the patient who should own the visit.";
  if (eventId === "A45" && form.correctPatientId === form.patientId) return "The correct patient must be a different person.";
  if (eventId === "A50") {
    if (!form.newVisitNumber) return "Enter the new visit number.";
    if (form.newVisitNumber === form.encounterId) return "The new visit number must be different.";
    if (state.encounters.some((e) => e.visitNumber === form.newVisitNumber)) return "That visit number is already in use.";
  }
  if ((eventId === "A01" && form.cls === "I" && !form.bedId) || (eventId === "A06" && !form.bedId) || (eventId === "A02" && !form.bedId)) {
    return "Pick a bed.";
  }
  if (eventId === "A03" && !form.dx.some((d) => d.code)) return "Add a discharge diagnosis first.";
  if (form.pr.some((p) => p.code && !p.at)) return "Enter when each procedure started.";
  if (eventId === "A02") {
    const enc = state.encounters.find((e) => e.visitNumber === form.encounterId);
    if (enc && enc.bedId === form.bedId) return "Pick a different bed from the current one.";
  }
  if (eventId === "A05" && !form.expectedAdmitAt) return "Enter the expected admit date.";
  if (eventId === "A31" && (!form.family || !form.given || !form.dob)) return "Enter a name and date of birth.";
  if (form.bedId) {
    const occ = occupiedBeds(state)[form.bedId];
    const inUseByOther = occ && occ.visitNumber !== form.encounterId;
    if (inUseByOther && (["A01", "A02", "A06", "A13"] as EventId[]).includes(eventId)) return "That bed is taken.";
  }
  return null;
}

/* ---------- store ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();
let current: HisState;

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage may be full or blocked; the app still works */
  }
  listeners.forEach((l) => l());
}

export function getState(): HisState {
  if (!current) current = load();
  return current;
}

function load(): HisState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as HisState;
  } catch {
    /* fall through to seed */
  }
  return seedState();
}

export interface SendOptions {
  source?: LogSource;
  /** Override the sent time (used for seed data). */
  sentAt?: string;
  overrides?: Partial<Include>;
}

/** Pure version of send. Returns the new state and the log entry. */
export function sendOn(state: HisState, eventId: EventId, form: ScenarioForm, opts: SendOptions = {}): { state: HisState; entry: LogEntry } {
  const plan = planMessage(state, eventId, form, opts.overrides, opts.sentAt ? toLocalInput(new Date(opts.sentAt)) : undefined);
  const patient = state.patients.find((p) => p.id === (eventId === "A45" ? form.correctPatientId : form.patientId));
  const { errors, warnings } = countChecks(plan.checks);
  const visit = eventId === "A50" ? form.newVisitNumber : form.encounterId || form.visitNumber;
  const entry: LogEntry = {
    seq: state.counters.seq + 1,
    controlId: plan.controlId,
    eventId,
    trigger: plan.event.trigger,
    sentAt: opts.sentAt ?? new Date().toISOString(),
    patientId: patient?.id ?? form.patientId,
    patientName: patientName(patient),
    visitNumber: visit,
    message: plan.message,
    segments: plan.segs.map((s) => s.id),
    errors,
    warnings,
    checks: plan.checks,
    source: opts.source ?? "user",
  };
  const next = applyEvent(state, eventId, form);
  next.counters.seq += 1;
  next.log = [...state.log, entry];
  return { state: next, entry };
}

export function send(eventId: EventId, form: ScenarioForm, opts: SendOptions = {}): LogEntry {
  const { state, entry } = sendOn(getState(), eventId, form, opts);
  current = state;
  emit();
  if (entry.source !== "seed") {
    audit("send-adt", `${entry.trigger} ${entry.controlId}`, {
      patient: entry.patientName,
      detail: `Visit ${entry.visitNumber}${entry.errors ? `, ${entry.errors} errors` : ""}`,
    });
  }
  return entry;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useHis(): HisState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Change EMR data on a visit (diagnoses, notes, vitals). No ADT message is sent. */
export function updateEncounter(visit: string, fn: (e: Encounter) => void, opts: { touch?: boolean } = {}) {
  const next = cloneState(getState());
  const e = next.encounters.find((x) => x.visitNumber === visit);
  if (!e) return;
  fn(e);
  if (opts.touch !== false && e.status !== "cancelled" && e.status !== "preadmit") e.dirty = true;
  current = next;
  emit();
}

const EXTRA_GIVEN = ["Ziad", "Lama", "Rakan", "Sara", "Nawaf", "Joud", "Fahad", "Abeer"];
const EXTRA_FAMILY = ["Alkhaldi", "Alfaisal", "Albishi", "Alsaif", "Alharthi", "Almansour", "Alkhalifa", "Alduwaish"];

/** A made-up Health ID for testing. Assumed format: 10 digits (the guide does not state the length). */
export function nextHealthId(): string {
  return String(1090000000 + (getState().counters.patient + 1) * 17);
}

export interface NewPatient {
  extra?: Patient["extra"];
  consentAt?: string;
  healthId: string;
  given: string;
  family: string;
  dob: string;
  sex: "M" | "F";
  nationality: string;
  maritalStatus: string;
  address: string;
}

/** Register a patient (demographics). nphies has no message for this alone: the data goes out inside A04. */
export function registerPatient(input: NewPatient): Patient {
  const s = getState();
  const n = s.counters.patient + 1;
  const p: Patient = {
    id: `P${String(n).padStart(3, "0")}`,
    mrn: `MRN${String(100 + n).padStart(7, "0")}`,
    nationalId: String(1000000000 + n * 7),
    ...input,
    // Stored as a CS-Adm-Country code. Older numeric codes (for example from the registry lookup) are converted here.
    nationality: countryCode(input.nationality),
  };
  current = { ...s, patients: [...s.patients, p], counters: { ...s.counters, patient: n } };
  emit();
  return p;
}

/** Add a made-up patient. Used by the scenario runner so each flow starts clean. */
export function addPatient(): Patient {
  const n = getState().counters.patient + 1;
  const i = n % EXTRA_GIVEN.length;
  return registerPatient({
    healthId: nextHealthId(),
    family: EXTRA_FAMILY[(i + 3) % EXTRA_FAMILY.length],
    given: EXTRA_GIVEN[i],
    dob: `${1960 + (n % 40)}-0${1 + (n % 9)}-1${n % 9}`,
    sex: n % 2 ? "M" : "F",
    nationality: "SAU",
    maritalStatus: "SMDW"[n % 4],
    address: `RHAD${String(4000 + n)}`,
  });
}

export function firstFreeBed(state: HisState, not?: string): string {
  const b = freeBeds(state).find((x) => x.id !== not);
  return b ? b.id : "";
}

export function resetAll() {
  current = seedState();
  emit();
}

export function clearLog() {
  current = { ...getState(), log: [] };
  emit();
}

/* ---------- seed data ---------- */

function minutesAgo(m: number): Date {
  return new Date(Date.now() - m * 60_000);
}

export function seedState(): HisState {
  let state: HisState = {
    patients: SEED_PATIENTS.map((p) => ({ ...p })),
    encounters: [],
    log: [],
    counters: { visit: 0, seq: 0, patient: SEED_PATIENTS.length },
  };
  const step = (id: EventId, patch: (f: ScenarioForm) => void, minsAgo: number, encFrom?: (s: HisState) => Encounter | undefined) => {
    let form = emptyForm(state, id);
    const enc = encFrom?.(state);
    if (enc) form = formFromEncounter(state, id, enc, form);
    patch(form);
    form.eventAt = toLocalInput(minutesAgo(minsAgo));
    if (!form.admitAt || id === "A01" || id === "A04") form.admitAt = form.eventAt;
    state = sendOn(state, id, form, { source: "seed", sentAt: minutesAgo(minsAgo).toISOString() }).state;
  };
  const byPatient = (pid: string) => (s: HisState) => s.encounters.find((e) => e.patientId === pid);

  // P001: inpatient in 3A, admitted yesterday
  step("A01", (f) => { f.patientId = "P001"; f.bedId = "301-A"; f.dx = [{ ...DX_SAMPLES[0] }]; f.reason = "Fever and cough"; f.allergies = [{ ...ALLERGY_SAMPLES[0] }]; }, 1700);
  // P002: inpatient in 3A
  step("A01", (f) => { f.patientId = "P002"; f.bedId = "301-B"; f.service = "MED"; f.dx = [{ ...DX_SAMPLES[4] }]; f.reason = "High blood sugar"; }, 900);
  // P003: ICU
  step("A01", (f) => { f.patientId = "P003"; f.bedId = "ICU1-A"; f.attending = "D1003"; f.admitting = "D1003"; f.service = "ICU"; f.dx = [{ ...DX_SAMPLES[1] }]; f.reason = "Chest pain"; }, 600);
  // P004: outpatient radiology
  step("A04", (f) => { f.patientId = "P004"; f.cls = "O"; f.attending = "D1004"; f.admitting = "D1004"; f.service = "RAD"; f.reason = "Chest X-ray"; }, 120);
  // P005: pre-admit for tomorrow
  step("A05", (f) => {
    f.patientId = "P005"; f.cls = "I"; f.attending = "D1002"; f.admitting = "D1002"; f.service = "SUR";
    f.reason = "Planned appendectomy"; f.dx = [{ ...DX_SAMPLES[2], type: "W" }];
    f.expectedAdmitAt = toLocalInput(new Date(Date.now() + 20 * 3600_000));
  }, 300);
  // P006: admitted, moved, discharged
  step("A01", (f) => { f.patientId = "P006"; f.bedId = "401-A"; f.attending = "D1005"; f.admitting = "D1005"; f.service = "ORT"; f.dx = [{ ...DX_SAMPLES[3] }]; f.reason = "Hip pain after fall"; }, 4300);
  step("A02", (f) => { f.bedId = "401-B"; }, 3000, byPatient("P006"));
  step("A03", (f) => { f.dischargeAt = toLocalInput(minutesAgo(1500)); f.dx = [{ ...DX_SAMPLES[3], type: "F" }]; f.pr = [{ ...PR_SAMPLES[3], at: toLocalInput(minutesAgo(3600)), surgeon: "D1005" }]; }, 1500, byPatient("P006"));
  // More outpatients for the OPD worklist
  step("A04", (f) => { f.patientId = "P007"; f.cls = "O"; f.attending = "D1001"; f.admitting = "D1001"; f.service = "MED"; f.reason = "Fever"; }, 45);
  step("A04", (f) => { f.patientId = "P008"; f.cls = "E"; f.attending = "D1003"; f.admitting = "D1003"; f.service = "ER"; f.reason = "Chest pain"; }, 20);
  const er = (pid: string, mins: number, reason: string, doc: string) =>
    step("A04", (f) => { f.patientId = pid; f.cls = "E"; f.attending = doc; f.admitting = doc; f.service = "ER"; f.reason = reason; }, mins);
  er("P011", 5, "Sore throat", "D1001");
  er("P012", 55, "Abdominal pain", "D1002");
  er("P013", 75, "Cut on the hand", "D1001");
  er("P014", 9, "Chest pain and sweating", "D1003");
  step("A04", (f) => { f.patientId = "P009"; f.cls = "O"; f.attending = "D1001"; f.admitting = "D1001"; f.service = "MED"; f.reason = "Cough"; }, 1900);
  step("A03", (f) => { f.dischargeAt = toLocalInput(minutesAgo(1800)); f.dx = [{ code: "J06.9", text: "Acute upper respiratory infection", type: "F" }]; }, 1800, byPatient("P009"));

  // EMR data. This does not send ADT messages.
  const emr = (pid: string, fn: (e: Encounter) => void) => {
    const e = state.encounters.find((x) => x.patientId === pid && x.status !== "cancelled");
    if (e) fn(e);
  };
  const vit = (bp: string, pulse: string, temp: string, spo2: string, rr: string, weight: string) => ({ bp, pulse, temp, spo2, rr, weight, at: toLocalInput(minutesAgo(30)) });
  emr("P001", (e) => { e.vitals = vit("128/82", "92", "38.4", "94", "22", "84"); e.complaints = [{ code: "386661006", text: "Fever" }, { code: "49727002", text: "Cough" }]; e.notes = [{ at: toLocalInput(minutesAgo(1600)), author: "Dr. Khalid Alharbi", text: "Admitted with fever and productive cough. Chest X-ray ordered." }]; });
  emr("P002", (e) => { e.vitals = vit("118/76", "78", "36.8", "98", "16", "62"); e.complaints = [{ code: "", text: "High blood sugar" }]; });
  emr("P003", (e) => { e.vitals = vit("142/90", "104", "37.0", "96", "20", "91"); e.complaints = [{ code: "29857009", text: "Chest pain" }]; });
  emr("P004", (e) => { e.checkedIn = true; e.complaints = [{ code: "", text: "Chest X-ray" }]; });
  emr("P007", (e) => { e.complaints = [{ code: "386661006", text: "Fever" }]; });
  // Emergency data. Times are minutes ago.
  const at = (m: number) => toLocalInput(minutesAgo(m));
  emr("P011", (e) => { e.ed = { arrivalAt: at(5), arrivalMode: "Walk-in", complaint: "Sore throat" }; });
  emr("P008", (e) => {
    e.ed = { arrivalAt: at(20), arrivalMode: "Walk-in", triageAt: at(16), ctas: 2, complaint: "Chest pain", area: "Acute", triageNurse: "Huda Alotaibi, RN", pain: 7 };
    e.vitals = vit("138/88", "112", "37.1", "95", "20", "70");
  });
  emr("P012", (e) => {
    e.ed = { arrivalAt: at(55), arrivalMode: "Walk-in", triageAt: at(50), ctas: 3, complaint: "Abdominal pain", area: "Acute", seenAt: at(38), stage: "results", triageNurse: "Huda Alotaibi, RN", pain: 6 };
    e.vitals = vit("118/74", "96", "38.2", "98", "18", "64");
  });
  emr("P013", (e) => {
    e.ed = { arrivalAt: at(75), arrivalMode: "Walk-in", triageAt: at(70), ctas: 4, complaint: "Cut on the hand", area: "Fast Track", triageNurse: "Huda Alotaibi, RN", pain: 3 };
    e.vitals = vit("100/64", "88", "36.7", "99", "18", "38");
  });
  emr("P014", (e) => {
    e.ed = { arrivalAt: at(9), arrivalMode: "Ground EMS Ambulance", triageAt: at(8), ctas: 1, complaint: "Chest pain and sweating", area: "Resus", seenAt: at(7), stage: "treatment", triageNurse: "Huda Alotaibi, RN", gcs: 15, pain: 9 };
    e.vitals = vit("84/50", "128", "36.9", "89", "28", "88");
  });
  return state;
}
