import { audit } from "./audit";
import { createStore } from "./fhir/store-util";
import { getLab } from "./lab";
import type { Encounter, Patient } from "./model";
import { getRad } from "./radiology";
import { getRx } from "./rx";
import { can } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

/**
 * NPHIES financial workflow per visit: eligibility, prior authorization, claim, payer questions, payment.
 * Everything is simulated. Nothing leaves the browser.
 *
 * Sources: Healthcare Financial Services IG (portal.nphies.sa/ig): message exchange, prior authorization, claim submission,
 * payment notification. Only the flow and the message names come from the guide. The rules below are ASSUMPTIONS made for the demo:
 *  - Payer per patient is picked from the RCM payer list by a fixed rule, because the patient record has no insurance details.
 *  - The charge is estimated from the visit class and the lab, radiology and prescription items (made-up prices, SAR).
 *  - Prior authorization is needed for inpatient visits and for charges of 1,000 SAR or more.
 *  - A charge above 5,000 SAR gets a deferred answer (pended) that is fetched by polling; above 8,000 SAR the payer asks a question first.
 *  - The simulated payer pays 90 percent of the approved amount (the rest is the patient share).
 *  - Message payloads are shortened skeletons, not validated against the IG profiles.
 */

export const PAYERS = ["Bupa Arabia", "Tawuniya", "MedGulf", "Daman", "NextCare", "Malath Insurance"];
export const AUTH_FROM = 1000;
export const DEFERRED_FROM = 5000;
export const QUESTION_FROM = 8000;
export const PAYER_SHARE = 0.9;

export type FinStep = "eligibility" | "authorization" | "claim" | "payment";
export type FinKind =
  | "eligibility-request" | "eligibility-response" | "priorauth-request" | "priorauth-response" | "poll-request" | "cancel-request"
  | "claim-request" | "claim-response" | "communication-request" | "communication" | "payment-reconciliation" | "payment-notice";

export interface FinMessage {
  seq: number;
  at: string;
  kind: FinKind;
  /** out = provider to NPHIES, in = NPHIES to provider. */
  direction: "out" | "in";
  summary: string;
  json: string;
}

export type EligibilityStatus = "eligible" | "not-eligible";
export type AuthStatus = "approved" | "pended" | "denied" | "cancelled";
export type ClaimStatus = "approved" | "pended" | "needs-info" | "rejected" | "cancelled";
export type PaymentStatus = "reconciliation-received" | "notice-sent";

export interface FinCase {
  visit: string;
  eligibility?: { status: EligibilityStatus; at: string; ref: string; note: string };
  authorization?: { status: AuthStatus; at: string; ref: string; authNumber?: string; note: string };
  claim?: { status: ClaimStatus; at: string; ref: string; claimNumber: string; approved?: number; note: string };
  payment?: { status: PaymentStatus; at: string; ref: string; amount: number; batch: string };
  messages: FinMessage[];
}

interface FinState {
  cases: FinCase[];
  seq: number;
  /** Developer switch: the next payer answer is a refusal. */
  rejectNext: boolean;
}

const store = createStore<FinState>("onasi-emr-nphies-financial-v1", () => ({ cases: [], seq: 0, rejectNext: false }));
export const useFinancial = store.use;
export const getFinancial = store.get;
export const resetFinancial = store.reset;
export const setFinRejectNext = (on: boolean) => store.set({ ...store.get(), rejectNext: on });

/* ---------- visit facts ---------- */

export function payerOf(p: Patient): string {
  let h = 0;
  for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PAYERS[h % PAYERS.length];
}

const CLASS_FEE: Record<string, number> = { O: 350, E: 900, I: 3200 };

export interface Charge {
  total: number;
  lines: { label: string; amount: number }[];
}

/** Made-up charge for a visit, from what was ordered. */
export function estimateCharge(e: Encounter): Charge {
  const lines: Charge["lines"] = [{ label: e.cls === "I" ? "Inpatient stay (per visit)" : e.cls === "E" ? "Emergency visit" : "Consultation", amount: CLASS_FEE[e.cls] ?? 350 }];
  const lab = getLab().orders.filter((o) => o.visitNumber === e.visitNumber && o.status !== "cancelled");
  const rad = getRad().orders.filter((o) => o.visitNumber === e.visitNumber && o.status !== "cancelled");
  const rx = getRx().prescriptions.filter((p) => p.visitNumber === e.visitNumber);
  const labTests = lab.reduce((n, o) => n + o.codes.length, 0);
  const rxItems = rx.reduce((n, p) => n + p.items.filter((i) => i.status !== "cancelled").length, 0);
  if (labTests) lines.push({ label: `Laboratory (${labTests} test${labTests === 1 ? "" : "s"})`, amount: labTests * 85 });
  if (rad.length) lines.push({ label: `Radiology (${rad.length} exam${rad.length === 1 ? "" : "s"})`, amount: rad.length * 320 });
  if (rxItems) lines.push({ label: `Medication (${rxItems} item${rxItems === 1 ? "" : "s"})`, amount: rxItems * 40 });
  return { total: lines.reduce((n, l) => n + l.amount, 0), lines };
}

export const needsAuthorization = (e: Encounter, c: Charge): boolean => e.cls === "I" || c.total >= AUTH_FROM;

export const caseOf = (visit: string, s: FinState = store.get()): FinCase => s.cases.find((c) => c.visit === visit) ?? { visit, messages: [] };

/* ---------- step readiness ---------- */

export interface StepView {
  step: FinStep;
  label: string;
  /** Plain-English status shown on the step. */
  status: string;
  tone: "neutral" | "ok" | "warn" | "danger";
  /** Button label, or null when there is nothing to press. */
  action: string | null;
  /** Why the button is off, or a hint. */
  hint: string;
  /** A second button, for example Cancel or Poll. */
  secondary: { id: string; label: string } | null;
}

export function stepViews(e: Encounter, s: FinState = store.get()): StepView[] {
  const c = caseOf(e.visitNumber, s);
  const charge = estimateCharge(e);
  const authNeeded = needsAuthorization(e, charge);
  const out: StepView[] = [];

  // 1 Eligibility
  const el = c.eligibility;
  out.push({
    step: "eligibility", label: "Eligibility Check",
    status: !el ? "Not Started" : el.status === "eligible" ? "Eligible" : "Not Eligible",
    tone: !el ? "neutral" : el.status === "eligible" ? "ok" : "danger",
    action: !el ? "Check Eligibility" : el.status === "not-eligible" ? "Check Again" : null,
    hint: el ? el.note : "Asks the payer if the patient is covered for this visit. The answer comes back at once.",
    secondary: null,
  });

  // 2 Prior authorization
  const au = c.authorization;
  const elOk = el?.status === "eligible";
  let auStatus = "Not Started", auTone: StepView["tone"] = "neutral", auAction: string | null = null, auHint = "", auSecond: StepView["secondary"] = null;
  if (!elOk) auHint = "Check eligibility first.";
  else if (!authNeeded && !au) { auStatus = "Not Needed"; auHint = `The charge is under ${AUTH_FROM.toLocaleString()} SAR and this is not an inpatient visit. You may still ask.`; auAction = "Request Authorization"; }
  else if (!au || au.status === "denied" || au.status === "cancelled") {
    auStatus = au ? (au.status === "denied" ? "Denied" : "Cancelled") : "Required";
    auTone = au?.status === "denied" ? "danger" : "warn";
    auAction = au ? "Request Again" : "Request Authorization";
    auHint = au?.note ?? "This visit needs approval before the claim.";
  } else if (au.status === "pended") {
    auStatus = "Waiting For Payer"; auTone = "warn"; auHint = au.note; auAction = "Check For Answer";
    auSecond = { id: "cancel-auth", label: "Cancel Request" };
  } else { auStatus = "Approved"; auTone = "ok"; auHint = au.note; auSecond = c.claim && c.claim.status !== "cancelled" ? null : { id: "cancel-auth", label: "Cancel Authorization" }; }
  out.push({ step: "authorization", label: "Prior Authorization", status: auStatus, tone: auTone, action: auAction, hint: auHint, secondary: auSecond });

  // 3 Claim
  const cl = c.claim;
  const authOk = !authNeeded || au?.status === "approved";
  const doneEnough = e.cls !== "I" || e.status === "discharged";
  let clStatus = "Not Started", clTone: StepView["tone"] = "neutral", clAction: string | null = null, clHint = "", clSecond: StepView["secondary"] = null;
  if (!elOk) clHint = "Check eligibility first.";
  else if (!authOk) clHint = "Prior authorization must be approved first.";
  else if (!doneEnough) clHint = "An inpatient claim is sent after discharge.";
  if (!cl || cl.status === "rejected" || cl.status === "cancelled") {
    clStatus = cl ? (cl.status === "rejected" ? "Rejected" : "Cancelled") : "Ready To Submit";
    clTone = cl?.status === "rejected" ? "danger" : cl ? "neutral" : "neutral";
    if (cl) clHint = cl.note;
    if (elOk && authOk && doneEnough) { clAction = cl ? "Resubmit Claim" : "Submit Claim"; if (!cl) clHint = `Charge ${charge.total.toLocaleString()} SAR.`; }
    else if (!cl) clStatus = "Not Started";
  } else if (cl.status === "needs-info") {
    clStatus = "Payer Asked A Question"; clTone = "warn"; clHint = cl.note; clAction = "Send Answer";
  } else if (cl.status === "pended") {
    clStatus = "Waiting For Payer"; clTone = "warn"; clHint = cl.note; clAction = "Check For Answer"; clSecond = { id: "cancel-claim", label: "Cancel Claim" };
  } else {
    clStatus = "Approved"; clTone = "ok"; clHint = cl.note; clSecond = c.payment ? null : { id: "cancel-claim", label: "Cancel Claim" };
  }
  out.push({ step: "claim", label: "Claim", status: clStatus, tone: clTone, action: clAction, hint: clHint, secondary: clSecond });

  // 4 Payment
  const pay = c.payment;
  const claimOk = cl?.status === "approved";
  out.push({
    step: "payment", label: "Payment",
    status: !claimOk ? "Not Started" : !pay ? "Waiting For Payment Advice" : pay.status === "reconciliation-received" ? "Payment Advice Received" : "Reconciled",
    tone: !claimOk ? "neutral" : !pay ? "warn" : pay.status === "reconciliation-received" ? "warn" : "ok",
    action: !claimOk ? null : !pay ? "Check For Payment Advice" : pay.status === "reconciliation-received" ? "Confirm Money Received" : null,
    hint: !claimOk ? "Comes after the claim is approved."
      : !pay ? "The payer sends a payment reconciliation when it pays. Asking for it is called polling."
      : pay.status === "reconciliation-received" ? `Payer paid ${pay.amount.toLocaleString()} SAR in batch ${pay.batch}. Send the payment notice only after the money is in the bank.`
      : `${pay.amount.toLocaleString()} SAR received and confirmed to NPHIES.`,
    secondary: null,
  });
  return out;
}

/* ---------- messages (shortened skeletons) ---------- */

const hex = (n: number) => n.toString(16).padStart(6, "0");

function skeleton(kind: FinKind, e: Encounter, p: Patient, payer: string, body: Record<string, unknown>): string {
  return JSON.stringify({
    resourceType: "Bundle", type: "message",
    entry: [
      { resource: { resourceType: "MessageHeader", eventCoding: { system: "http://nphies.sa/terminology/CodeSystem/ksa-message-events", code: kind }, source: { endpoint: "http://onasi.example/nphies" }, destination: [{ endpoint: "http://nphies.sa" }] } },
      { resource: { resourceType: "Patient", identifier: [{ system: "http://nphies.sa/identifier/nationalid", value: p.healthId }] } },
      { resource: { resourceType: "Organization", name: payer } },
      { resource: { ...body, extension: [{ url: "visit", valueString: e.visitNumber }] } },
    ],
  }, null, 2);
}

function push(s: FinState, visit: string, m: Omit<FinMessage, "seq" | "at">): FinState {
  const seq = s.seq + 1;
  const msg: FinMessage = { ...m, seq, at: new Date().toISOString() };
  const existing = caseOf(visit, s);
  const next: FinCase = { ...existing, messages: [...existing.messages, msg] };
  return { ...s, seq, cases: s.cases.some((c) => c.visit === visit) ? s.cases.map((c) => (c.visit === visit ? next : c)) : [...s.cases, next] };
}

function patch(s: FinState, visit: string, fn: (c: FinCase) => FinCase): FinState {
  const c = caseOf(visit, s);
  const next = fn(c);
  return { ...s, cases: s.cases.some((x) => x.visit === visit) ? s.cases.map((x) => (x.visit === visit ? next : x)) : [...s.cases, next] };
}

/* ---------- actions ---------- */

export type FinAction = "eligibility" | "authorization" | "poll-auth" | "cancel-auth" | "claim" | "poll-claim" | "answer" | "cancel-claim" | "poll-payment" | "confirm-payment";

export const finActionFor = (view: StepView, secondary = false): FinAction | null => {
  const key = secondary ? view.secondary?.id : view.action;
  if (!key) return null;
  switch (view.step) {
    case "eligibility": return "eligibility";
    case "authorization": return secondary ? "cancel-auth" : view.status === "Waiting For Payer" ? "poll-auth" : "authorization";
    case "claim": return secondary ? "cancel-claim" : view.status === "Waiting For Payer" ? "poll-claim" : view.status === "Payer Asked A Question" ? "answer" : "claim";
    case "payment": return view.status === "Waiting For Payment Advice" ? "poll-payment" : "confirm-payment";
  }
};

/** Runs one step for a visit. Returns false if it was not allowed. */
export function runFinancial(visit: string, action: FinAction): boolean {
  if (!can("billing")) {
    pushToast({ tone: "warn", text: "Your role cannot do this.", detail: "This needs the billing permission." });
    return false;
  }
  const hs = getState();
  const e = hs.encounters.find((x) => x.visitNumber === visit);
  const p = e && hs.patients.find((x) => x.id === e.patientId);
  if (!e || !p) return false;
  const payer = payerOf(p);
  const charge = estimateCharge(e);
  let s = store.get();
  const refuse = s.rejectNext;
  const at = new Date().toISOString();
  const n = s.seq + 1;
  const name = patientName(p);
  const toast = (ok: boolean, text: string, detail?: string) => pushToast({ tone: ok ? "ok" : "warn", text, detail });
  const log = (what: string) => audit("send-fhir", `NPHIES financial ${what}`, { patient: name, detail: `Visit ${visit}, payer ${payer}` });

  switch (action) {
    case "eligibility": {
      const ok = !refuse;
      const note = ok ? `${payer}: covered. Patient pays 10 percent. Prior authorization needed for ${AUTH_FROM.toLocaleString()} SAR and above.` : `${payer}: no active policy found for this patient.`;
      s = push(s, visit, { kind: "eligibility-request", direction: "out", summary: `Is the patient covered by ${payer}?`, json: skeleton("eligibility-request", e, p, payer, { resourceType: "CoverageEligibilityRequest", status: "active", purpose: ["benefits", "validation"], servicedDate: at.slice(0, 10) }) });
      s = push(s, visit, { kind: "eligibility-response", direction: "in", summary: ok ? "Covered" : "Not covered", json: skeleton("eligibility-response", e, p, payer, { resourceType: "CoverageEligibilityResponse", status: "active", outcome: "complete", insurance: [{ inforce: ok }] }) });
      s = patch(s, visit, (c) => ({ ...c, eligibility: { status: ok ? "eligible" : "not-eligible", at, ref: `ELG-${hex(n)}`, note } }));
      toast(ok, ok ? "Patient is covered." : "Patient is not covered.", note);
      log("eligibility");
      break;
    }
    case "authorization": {
      const deferred = charge.total > DEFERRED_FROM && !refuse;
      const status: AuthStatus = refuse ? "denied" : deferred ? "pended" : "approved";
      const authNumber = status === "approved" ? `AUTH-${hex(n)}` : undefined;
      const note = status === "denied" ? "Denied: the service is not covered under this plan." : status === "pended" ? "The payer will answer later. Check for the answer." : `Approved for ${charge.total.toLocaleString()} SAR. Authorization ${authNumber}.`;
      s = push(s, visit, { kind: "priorauth-request", direction: "out", summary: `Approval requested for ${charge.total.toLocaleString()} SAR`, json: skeleton("priorauth-request", e, p, payer, { resourceType: "Claim", use: "preauthorization", status: "active", total: { value: charge.total, currency: "SAR" } }) });
      s = push(s, visit, { kind: "priorauth-response", direction: "in", summary: status === "pended" ? "Queued, answer later" : status === "denied" ? "Denied" : "Approved", json: skeleton("priorauth-response", e, p, payer, { resourceType: "ClaimResponse", use: "preauthorization", outcome: status === "pended" ? "queued" : status === "denied" ? "error" : "complete", preAuthRef: authNumber }) });
      s = patch(s, visit, (c) => ({ ...c, authorization: { status, at, ref: `PA-${hex(n)}`, authNumber, note } }));
      toast(status === "approved", status === "approved" ? "Authorization approved." : status === "denied" ? "Authorization denied." : "Payer will answer later.", note);
      log("prior authorization");
      break;
    }
    case "poll-auth": {
      const authNumber = `AUTH-${hex(n)}`;
      const note = `Approved after review for ${charge.total.toLocaleString()} SAR. Authorization ${authNumber}.`;
      s = push(s, visit, { kind: "poll-request", direction: "out", summary: "Any answers waiting for us?", json: skeleton("poll-request", e, p, payer, { resourceType: "Task", status: "requested", code: "poll" }) });
      s = push(s, visit, { kind: "priorauth-response", direction: "in", summary: "Approved", json: skeleton("priorauth-response", e, p, payer, { resourceType: "ClaimResponse", use: "preauthorization", outcome: "complete", preAuthRef: authNumber }) });
      s = patch(s, visit, (c) => ({ ...c, authorization: c.authorization && { ...c.authorization, status: "approved", authNumber, note, at } }));
      toast(true, "Authorization approved.", note);
      log("poll prior authorization");
      break;
    }
    case "cancel-auth": {
      s = push(s, visit, { kind: "cancel-request", direction: "out", summary: "Cancel the authorization request", json: skeleton("cancel-request", e, p, payer, { resourceType: "Task", status: "requested", code: "cancel", focus: "priorauth" }) });
      s = patch(s, visit, (c) => ({ ...c, authorization: c.authorization && { ...c.authorization, status: "cancelled", note: "You cancelled this request.", at } }));
      toast(true, "Authorization cancelled.");
      log("cancel authorization");
      break;
    }
    case "claim": {
      const status: ClaimStatus = refuse ? "rejected" : charge.total > QUESTION_FROM ? "needs-info" : charge.total > DEFERRED_FROM ? "pended" : "approved";
      const claimNumber = `CLM-${hex(n)}`;
      const approved = status === "approved" ? Math.round(charge.total * PAYER_SHARE) : undefined;
      const note = status === "rejected" ? "Rejected: a required item is missing or not covered." : status === "needs-info" ? "The payer needs the discharge summary before it can decide." : status === "pended" ? "The payer will answer later. Check for the answer." : `Approved ${approved!.toLocaleString()} of ${charge.total.toLocaleString()} SAR. The patient pays the rest.`;
      s = push(s, visit, { kind: "claim-request", direction: "out", summary: `Claim for ${charge.total.toLocaleString()} SAR`, json: skeleton("claim-request", e, p, payer, { resourceType: "Claim", use: "claim", status: "active", identifier: claimNumber, total: { value: charge.total, currency: "SAR" } }) });
      if (status === "needs-info") s = push(s, visit, { kind: "communication-request", direction: "in", summary: "Payer asks for the discharge summary", json: skeleton("communication-request", e, p, payer, { resourceType: "CommunicationRequest", status: "active", payload: [{ contentString: "Please send the discharge summary." }] }) });
      else s = push(s, visit, { kind: "claim-response", direction: "in", summary: status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Queued, answer later", json: skeleton("claim-response", e, p, payer, { resourceType: "ClaimResponse", use: "claim", outcome: status === "approved" ? "complete" : status === "rejected" ? "error" : "queued" }) });
      s = patch(s, visit, (c) => ({ ...c, claim: { status, at, ref: `CL-${hex(n)}`, claimNumber, approved, note } }));
      toast(status === "approved", status === "approved" ? "Claim approved." : status === "rejected" ? "Claim rejected." : "Claim sent. The payer has not decided.", note);
      log("claim");
      break;
    }
    case "answer": {
      const approved = Math.round(charge.total * PAYER_SHARE);
      const note = `Approved ${approved.toLocaleString()} of ${charge.total.toLocaleString()} SAR after your answer.`;
      s = push(s, visit, { kind: "communication", direction: "out", summary: "Discharge summary sent to the payer", json: skeleton("communication", e, p, payer, { resourceType: "Communication", status: "completed", payload: [{ contentString: "Discharge summary attached." }] }) });
      s = push(s, visit, { kind: "claim-response", direction: "in", summary: "Approved", json: skeleton("claim-response", e, p, payer, { resourceType: "ClaimResponse", use: "claim", outcome: "complete" }) });
      s = patch(s, visit, (c) => ({ ...c, claim: c.claim && { ...c.claim, status: "approved", approved, note, at } }));
      toast(true, "Claim approved.", note);
      log("communication");
      break;
    }
    case "poll-claim": {
      const approved = Math.round(charge.total * PAYER_SHARE);
      const note = `Approved ${approved.toLocaleString()} of ${charge.total.toLocaleString()} SAR after review.`;
      s = push(s, visit, { kind: "poll-request", direction: "out", summary: "Any answers waiting for us?", json: skeleton("poll-request", e, p, payer, { resourceType: "Task", status: "requested", code: "poll" }) });
      s = push(s, visit, { kind: "claim-response", direction: "in", summary: "Approved", json: skeleton("claim-response", e, p, payer, { resourceType: "ClaimResponse", use: "claim", outcome: "complete" }) });
      s = patch(s, visit, (c) => ({ ...c, claim: c.claim && { ...c.claim, status: "approved", approved, note, at } }));
      toast(true, "Claim approved.", note);
      log("poll claim");
      break;
    }
    case "cancel-claim": {
      s = push(s, visit, { kind: "cancel-request", direction: "out", summary: "Cancel the claim", json: skeleton("cancel-request", e, p, payer, { resourceType: "Task", status: "requested", code: "cancel", focus: "claim" }) });
      s = patch(s, visit, (c) => ({ ...c, claim: c.claim && { ...c.claim, status: "cancelled", note: "You cancelled this claim. It can be sent again.", at } }));
      toast(true, "Claim cancelled.");
      log("cancel claim");
      break;
    }
    case "poll-payment": {
      const cl = caseOf(visit, s).claim;
      const amount = cl?.approved ?? Math.round(charge.total * PAYER_SHARE);
      const batch = `PB-${hex(n)}`;
      s = push(s, visit, { kind: "poll-request", direction: "out", summary: "Any payment advice for us?", json: skeleton("poll-request", e, p, payer, { resourceType: "Task", status: "requested", code: "poll", input: "payment-reconciliation" }) });
      s = push(s, visit, { kind: "payment-reconciliation", direction: "in", summary: `Payer paid ${amount.toLocaleString()} SAR`, json: skeleton("payment-reconciliation", e, p, payer, { resourceType: "PaymentReconciliation", status: "active", outcome: "complete", paymentAmount: { value: amount, currency: "SAR" }, identifier: batch }) });
      s = patch(s, visit, (c) => ({ ...c, payment: { status: "reconciliation-received", at, ref: `PR-${hex(n)}`, amount, batch } }));
      toast(true, "Payment advice received.", `${amount.toLocaleString()} SAR in batch ${batch}.`);
      log("poll payment");
      break;
    }
    case "confirm-payment": {
      const pay = caseOf(visit, s).payment;
      if (!pay) return false;
      s = push(s, visit, { kind: "payment-notice", direction: "out", summary: `Money received: ${pay.amount.toLocaleString()} SAR`, json: skeleton("payment-notice", e, p, payer, { resourceType: "PaymentNotice", status: "active", paymentStatus: "paid", amount: { value: pay.amount, currency: "SAR" }, request: pay.batch }) });
      s = patch(s, visit, (c) => ({ ...c, payment: c.payment && { ...c.payment, status: "notice-sent", at } }));
      toast(true, "Payment notice sent.", "NPHIES acknowledged it.");
      log("payment notice");
      break;
    }
  }
  store.set({ ...s, rejectNext: refuse && (action === "eligibility" || action === "authorization" || action === "claim") ? false : s.rejectNext });
  return true;
}

/* ---------- list of visits for the page ---------- */

export interface FinVisit {
  enc: Encounter;
  patient: Patient;
  payer: string;
  charge: Charge;
  authNeeded: boolean;
}

export function financialVisits(): FinVisit[] {
  const hs = getState();
  const out: FinVisit[] = [];
  for (const enc of hs.encounters) {
    if (enc.status === "cancelled" || enc.status === "preadmit") continue;
    const patient = hs.patients.find((p) => p.id === enc.patientId);
    if (!patient) continue;
    const charge = estimateCharge(enc);
    out.push({ enc, patient, payer: payerOf(patient), charge, authNeeded: needsAuthorization(enc, charge) });
  }
  return out;
}
