import { audit } from "./audit";
import { bedInfo, bedProblem, heldBedOf } from "./beds";
import {
  canGiveClearance, clearanceBlock, clearanceLabel, departureGap, gapText, leftWardProblem, missingClearances, outcomeCode, outcomeDef,
  outcomeProblems, reasonProblem, reasonText, type OutcomeInput,
} from "./discharge";
import type { ClearanceKey, Dx, Encounter, LogEntry, ScenarioForm } from "./model";
import { currentUser, roleOf } from "./session";
import { DISPOSITIONS, DOCTORS, SERVICES, defaultAdmissionMethod } from "./reference-data";
import { EVENT_BY_ID, eventLabel, type EventId } from "./spec";
import { pushToast } from "./toast";
import {
  bedLabel, eligible, emptyForm, firstFreeBed, formFromEncounter, formProblem, getState, nowLocal, patientName, send, setBedFlag, updateEncounter,
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
  if (eventId === "A13") {
    // Back to the bed the patient still holds. If that bed has gone to someone else or to cleaning, the first free bed.
    form.bedId = heldBedOf(enc) ?? form.bedId;
    if (enc.cls !== "I") form.bedId = "";
    else if (!form.bedId || bedProblem(state, form.bedId, { visit })) form.bedId = firstFreeBed(state);
  }
  patch?.(form);
  const problem = formProblem(state, eventId, form);
  if (problem) return fail(problem);
  const entry = send(eventId, form, { source: "user" });
  // The discharge is reversed, so its outcome and leaving time no longer apply. The clearances stay.
  if (eventId === "A13") updateEncounter(visit, (e) => { e.discharge = undefined; }, { touch: false });
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
  /** A05: a bed to hold for the planned admission. */
  reserveBedId?: string;
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
  if (kind === "A05" && p.reserveBedId) {
    const why = bedProblem(state, p.reserveBedId);
    if (why) return fail(why);
  }
  const entry = send(kind, form, { source: "user" });
  if (kind === "A05" && p.reserveBedId) updateEncounter(entry.visitNumber, (e) => { e.reservedBedId = p.reserveBedId; }, { touch: false });
  return finish(kind, entry.visitNumber, entry, form.bedId || undefined);
}

/** Outpatient check-in. It is a HIS step, not an ADT event, so no message is sent. */
export function checkIn(visit: string) {
  updateEncounter(visit, (e) => { e.checkedIn = true; }, { touch: false });
  pushToast({ tone: "ok", text: "Checked in.", detail: "No ADT message is needed for this step." });
}

/* ---------- discharge clearances, outcome, leaving the ward, bed states ---------- */

const who = () => {
  const u = currentUser();
  return { by: u.name, role: roleOf(u).label, permissions: roleOf(u).permissions };
};
const visitOf = (visit: string): Encounter | undefined => getState().encounters.find((e) => e.visitNumber === visit);
const nameOf = (e: Encounter): string => patientName(getState().patients.find((p) => p.id === e.patientId));

/** Give or withdraw one discharge clearance. Only a role that fits may do it. Audited. */
export function setClearance(visit: string, key: ClearanceKey, given: boolean): boolean {
  const enc = visitOf(visit);
  if (!enc) return fail("That visit was not found.").ok;
  const me = who();
  const label = clearanceLabel(key);
  if (!canGiveClearance(key, me.permissions)) {
    audit("denied", `Discharge clearance ${visit}`, { patient: nameOf(enc), detail: `${label} clearance` });
    return fail(`Your role cannot ${given ? "give" : "withdraw"} the ${label} clearance.`).ok;
  }
  if (enc.status !== "active" || enc.cls !== "I") return fail("Clearances are for admitted inpatients.").ok;
  updateEncounter(visit, (e) => {
    const next = { ...(e.clearances ?? {}) };
    if (given) next[key] = { by: me.by, role: me.role, at: nowLocal() };
    else delete next[key];
    e.clearances = next;
  }, { touch: false });
  audit("update", `Discharge clearance ${visit}`, { patient: nameOf(enc), detail: `${label} clearance ${given ? "given" : "withdrawn"}` });
  pushToast({ tone: "ok", text: `${label} clearance ${given ? "given" : "withdrawn"}.`, detail: "No ADT message is needed for this step." });
  return true;
}

export interface DischargeInput extends OutcomeInput {
  /** Diagnoses to add as final. The diagnoses already on the visit are kept. */
  dx: Dx[];
  /** Typed reason to discharge an inpatient with clearances missing. */
  overrideReason?: string;
}

/** Discharge with an outcome. Inpatients need all four clearances, or an override reason that goes to the audit log. */
export function dischargePatient(visit: string, input: DischargeInput): Outcome {
  const enc = visitOf(visit);
  if (!enc) return fail("That visit was not found.");
  const missing = missingClearances(enc);
  const block = clearanceBlock(enc, input.overrideReason);
  if (block) return fail(block);
  const problems = outcomeProblems(input, { admitAt: enc.admitAt, now: nowLocal() });
  if (problems.length) return fail(problems[0]);
  const me = who();
  const bedId = enc.cls === "I" ? enc.bedId : undefined;
  const out = dischargeWith(visit, input.dx, outcomeCode(input.outcome));
  if (!out.ok) return out;
  const at = nowLocal();
  const patient = nameOf(enc);
  updateEncounter(visit, (e) => {
    e.discharge = {
      outcome: input.outcome, orderedAt: at, orderedBy: me.by, bedId,
      override: missing.length ? { reason: input.overrideReason!.trim(), by: me.by, at, missing } : undefined,
      transfer: input.outcome === "transfer" && input.transfer ? { ...input.transfer } : undefined,
      death: input.outcome === "died" && input.death ? { ...input.death } : undefined,
    };
  }, { touch: false });
  if (missing.length) {
    audit("update", `Discharge override ${visit}`, {
      patient, detail: `Discharged without ${missing.map(clearanceLabel).join(", ")} clearance. Reason: ${input.overrideReason!.trim()}`,
    });
  }
  if (input.outcome === "transfer" && input.transfer) {
    const t = input.transfer;
    audit("create", `Transfer request ${visit}`, {
      patient, detail: `To ${t.hospital}, accepted by ${t.acceptingDoctor}, ${t.transport}. Reason: ${t.reason}. Recorded in the HIS, not sent.`,
    });
  } else {
    audit("update", `Discharge outcome ${visit}`, { patient, detail: outcomeDef(input.outcome).label });
  }
  return out;
}

/** The nurse records that the discharged patient left the ward. The bed goes to cleaning. No ADT message. */
export function recordLeftWard(visit: string, at: string): boolean {
  const enc = visitOf(visit);
  if (!enc) return fail("That visit was not found.").ok;
  const why = leftWardProblem(enc, at, nowLocal());
  if (why) return fail(why).ok;
  const me = who();
  const bedId = enc.discharge!.bedId!;
  updateEncounter(visit, (e) => { e.discharge = { ...e.discharge!, leftWardAt: at, leftBy: me.by }; }, { touch: false });
  setBedFlag(bedId, { state: "cleaning", since: at, by: me.by });
  const gap = departureGap(visitOf(visit)!, nowLocal());
  audit("update", `Patient left the ward ${visit}`, { patient: nameOf(enc), detail: `${bedLabel(bedId)} to cleaning${gap ? `, ${gapText(gap.minutes)} after discharge` : ""}` });
  pushToast({ tone: "ok", text: `${nameOf(enc)} left the ward.`, detail: `Bed ${bedLabel(bedId)} is now waiting for cleaning.` });
  return true;
}

/** Housekeeping is done: the bed is free again. */
export function markBedReady(bedId: string): boolean {
  if (bedInfo(getState(), bedId)?.state !== "cleaning") return fail("That bed is not waiting for cleaning.").ok;
  setBedFlag(bedId, null);
  audit("update", `Bed ${bedLabel(bedId)}`, { detail: "Marked ready. The bed is free." });
  pushToast({ tone: "ok", text: `Bed ${bedLabel(bedId)} is ready.`, detail: "The bed is free for the next patient." });
  return true;
}

/** Take a free or cleaning bed out of service, with a reason. */
export function setBedOutOfService(bedId: string, reason: string, note = ""): boolean {
  const why = reasonProblem(reason, note);
  if (why) return fail(why).ok;
  const st = bedInfo(getState(), bedId)?.state;
  if (st !== "free" && st !== "cleaning") return fail("Only a free bed or a bed being cleaned can be taken out of service.").ok;
  const text = reasonText(reason, note);
  setBedFlag(bedId, { state: "out", since: nowLocal(), reason: text, by: who().by });
  audit("update", `Bed ${bedLabel(bedId)}`, { detail: `Out of service. Reason: ${text}` });
  pushToast({ tone: "warn", text: `Bed ${bedLabel(bedId)} is out of service.`, detail: text });
  return true;
}

export function returnBedToService(bedId: string): boolean {
  if (bedInfo(getState(), bedId)?.state !== "out") return fail("That bed is not out of service.").ok;
  setBedFlag(bedId, null);
  audit("update", `Bed ${bedLabel(bedId)}`, { detail: "Back in service. The bed is free." });
  pushToast({ tone: "ok", text: `Bed ${bedLabel(bedId)} is back in service.` });
  return true;
}

/** Cancel a visit (A11), a pre-admission (A38), a transfer (A12) or an inpatient stay (A07), with the reason kept and audited. */
export function sendWithReason(eventId: "A11" | "A38" | "A12" | "A07", visit: string, reason: string, note = ""): Outcome {
  const why = reasonProblem(reason, note);
  if (why) return fail(why);
  const enc = visitOf(visit);
  if (!enc) return fail("That visit was not found.");
  const out = quickSend(eventId, visit);
  if (!out.ok) return out;
  const text = reasonText(reason, note);
  const v = out.entry?.visitNumber || visit;
  updateEncounter(v, (e) => { e.cancelReason = text; }, { touch: false });
  audit("update", `${EVENT_BY_ID[eventId].name} ${v}`, { patient: nameOf(enc), detail: `Reason: ${text}` });
  return out;
}

export { DISPOSITIONS, SERVICES };
