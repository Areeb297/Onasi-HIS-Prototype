import type { Dx, LogEntry, ScenarioForm } from "./model";
import { DISPOSITIONS, DOCTORS, SERVICES, defaultAdmissionMethod } from "./reference-data";
import { EVENT_BY_ID, eventLabel, type EventId } from "./spec";
import { pushToast } from "./toast";
import {
  bedLabel, eligible, emptyForm, firstFreeBed, formFromEncounter, formProblem, getState, nowLocal, send, updateEncounter,
} from "./store";

/** The event that reverses another one. Used by the Undo button. */
const INVERSE: Partial<Record<EventId, EventId>> = {
  A01: "A11", A02: "A12", A03: "A13", A04: "A11", A05: "A38", A06: "A07", A13: "A03",
};

export interface Outcome {
  ok: boolean;
  entry?: LogEntry;
}

function describe(eventId: EventId, bedId?: string): string {
  switch (eventId) {
    case "A01": return `Admitted${bedId ? ` to ${bedLabel(bedId)}` : ""}.`;
    case "A02": return `Moved to ${bedLabel(bedId)}.`;
    case "A03": return "Discharged.";
    case "A04": return "Visit registered.";
    case "A05": return "Pre-admission saved.";
    case "A06": return `Changed to inpatient${bedId ? `, ${bedLabel(bedId)}` : ""}.`;
    case "A07": return "Changed to outpatient.";
    case "A08": return "Visit update sent.";
    case "A11": return "Visit cancelled.";
    case "A12": return `Transfer cancelled. Back in ${bedLabel(bedId)}.`;
    case "A13": return "Discharge undone.";
    case "A38": return "Pre-admission cancelled.";
    default: return "Done.";
  }
}

function finish(eventId: EventId, visit: string, entry: LogEntry, bedId?: string): Outcome {
  const inverse = INVERSE[eventId];
  pushToast({
    tone: entry.errors ? "danger" : entry.warnings ? "warn" : "ok",
    text: `${describe(eventId, bedId)} ${entry.patientName}.`,
    detail: `${eventLabel(eventId)} ${EVENT_BY_ID[eventId].name} saved as ${entry.controlId}.`,
    entry,
    undo: inverse
      ? { label: "Undo", run: () => quickSend(inverse, entry.visitNumber || visit) }
      : undefined,
  });
  return { ok: true, entry };
}

function fail(text: string): Outcome {
  pushToast({ tone: "danger", text });
  return { ok: false };
}

/** Run an ADT event on an existing visit with sensible defaults. One call, one message. */
export function quickSend(eventId: EventId, visit: string, patch?: (f: ScenarioForm) => void): Outcome {
  const state = getState();
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  if (!enc) return fail("That visit was not found.");
  if (!eligible(eventId, enc)) return fail(`${EVENT_BY_ID[eventId].name} cannot be used on this visit now.`);
  const form = formFromEncounter(state, eventId, enc, emptyForm(state, eventId));
  if (eventId === "A13" && (!form.bedId || state.encounters.some((e) => e.status === "active" && e.bedId === form.bedId))) {
    form.bedId = firstFreeBed(state);
  }
  patch?.(form);
  const problem = formProblem(state, eventId, form);
  if (problem) return fail(problem);
  const entry = send(eventId, form, { source: "user" });
  return finish(eventId, visit, entry, form.bedId || undefined);
}

export function dischargeWith(visit: string, dx: Dx[], disposition: string): Outcome {
  // Save the chosen diagnoses on the visit first so the EMR and the message agree.
  updateEncounter(visit, (e) => {
    for (const d of dx) if (!e.dx.some((x) => x.code === d.code)) e.dx.push({ ...d, type: "F", at: nowLocal() });
  });
  return quickSend("A03", visit, (f) => {
    f.dx = getState().encounters.find((e) => e.visitNumber === visit)!.dx.map((d) => ({ ...d }));
    f.disposition = disposition;
    f.dischargeAt = nowLocal();
  });
}

export interface CreateParams {
  patientId: string;
  attending: string;
  service: string;
  reason: string;
  referring?: string;
  cls?: "O" | "E";
  /** A01 and A05: the class of the stay. Inpatient when empty. A01 as outpatient needs no bed. */
  admitClass?: "I" | "O";
  /** PV1-4, from CS-Adm-AdmissionMethod. The default for the class when empty. */
  admissionMethod?: string;
  /** PV1-9. */
  consulting?: string;
  bedId?: string;
  expectedAdmitAt?: string;
}

/** Register (A04), admit (A01) or pre-admit (A05) in one step. */
export function quickCreate(kind: "A04" | "A01" | "A05", p: CreateParams): Outcome {
  const state = getState();
  const doctor = DOCTORS.find((d) => d.id === p.attending);
  let form = emptyForm(state, kind);
  form.patientId = p.patientId;
  form.attending = p.attending;
  form.admitting = p.attending;
  form.service = p.service || doctor?.service || "MED";
  form.reason = p.reason;
  form.referring = p.referring ?? "";
  if (kind === "A01") {
    // Start from the patient's pre-admission when there is one.
    const pre = state.encounters.find((e) => e.patientId === p.patientId && e.status === "preadmit");
    if (pre) {
      form = formFromEncounter(state, "A01", pre, emptyForm(state, "A01"));
      form.attending = p.attending;
      form.admitting = p.attending;
      if (p.reason) form.reason = p.reason;
      form.cls = "I";
      form.expectedAdmitAt = "";
    }
    form.cls = p.admitClass ?? "I";
    form.bedId = form.cls === "I" ? p.bedId ?? "" : "";
    form.admitAt = nowLocal();
  }
  if (kind === "A05") { form.expectedAdmitAt = p.expectedAdmitAt ?? ""; form.cls = p.admitClass ?? "I"; }
  if (kind === "A04") form.cls = p.cls ?? "O";
  form.admissionMethod = p.admissionMethod || defaultAdmissionMethod(form.cls);
  if (p.consulting) form.consulting = p.consulting;
  const problem = formProblem(state, kind, form);
  if (problem) return fail(problem);
  const entry = send(kind, form, { source: "user" });
  return finish(kind, entry.visitNumber, entry, form.bedId || undefined);
}

/** Outpatient check-in. It is a HIS step, not an ADT event, so no message is sent. */
export function checkIn(visit: string) {
  updateEncounter(visit, (e) => { e.checkedIn = true; }, { touch: false });
  pushToast({ tone: "ok", text: "Checked in.", detail: "No ADT message is needed for this step." });
}

export { DISPOSITIONS, SERVICES };
