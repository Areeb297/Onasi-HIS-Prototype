import { audit } from "./audit";
import { coverageView } from "./chart-entries";
import { createStore } from "./fhir/store-util";
import { getLab } from "./lab";
import type { Encounter, Patient } from "./model";
import { getRad } from "./radiology";
import { getRx } from "./rx";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

/**
 * NPHIES financial workflow per visit: eligibility, prior authorization, claim, payer questions, payment.
 * Everything is simulated. Nothing leaves the browser.
 *
 * Sources: Healthcare Financial Services IG (portal.nphies.sa/ig): message exchange, prior authorization, claim submission,
 * payment notification. Only the flow and the message names come from the guide. The rules below are ASSUMPTIONS made for the demo:
 *  - The payer is the insurance card on the patient's file, read the same way as the chart header (coverageView). A patient with
 *    no card, or a visit registered as cash, is a cash visit: nothing is sent to NPHIES for it.
 *  - The charge is estimated from the visit class and the lab, radiology and prescription items (made-up prices, SAR).
 *  - Prior authorization is needed for inpatient visits and for charges of 1,000 SAR or more.
 *  - A charge above 5,000 SAR gets a deferred answer (pended) that is fetched by polling; above 8,000 SAR the payer asks a question first.
 *  - The simulated payer pays the approved amount less the co-pay on the card (90 percent when the card has no co-pay figure).
 *  - Message payloads are shortened skeletons, not validated against the IG profiles.
 */

export const PAYERS = ["Bupa Arabia", "Tawuniya", "MedGulf", "Daman", "NextCare", "Malath Insurance"];
export const AUTH_FROM = 1000;
export const DEFERRED_FROM = 5000;
export const QUESTION_FROM = 8000;
/** The payer's share when the card does not say what the co-pay is. Use payerShareOf for a patient. */
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
  /** Services ordered on this visit that need the payer's approval, waiting for the approvals officer to send the request. */
  authRequests?: AuthRequest[];
  messages: FinMessage[];
}

export interface AuthRequest { id: string; service: string; at: string; by: string }

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

/** What the payer column shows for a patient with no insurance. Same word as the chart header. */
export const CASH = "Cash";
export const CASH_REASON = "This is a cash visit: the patient has no insurance on file. Nothing is sent to NPHIES and the patient pays the whole amount.";

const todayText = () => new Date().toISOString().slice(0, 10);

/**
 * The payer of the patient's visit, or null for a cash patient. Same rule as the chart header: the insurance card on the
 * patient's file, unless there is none or the visit was registered as cash.
 */
export function insuredPayer(p: Pick<Patient, "extra">): string | null {
  const payer = coverageView(p, todayText()).payer;
  return payer === CASH ? null : payer;
}

/** The payer name for lists: the card's payer, or "Cash". */
export function payerOf(p: Pick<Patient, "extra">): string {
  return insuredPayer(p) ?? CASH;
}

export const isCashPatient = (p: Pick<Patient, "extra">): boolean => insuredPayer(p) === null;

/** The part of the net amount the payer pays, 0 to 1: one less the co-pay on the card. Zero for a cash patient. */
export function payerShareOf(p: Pick<Patient, "extra">): number {
  if (isCashPatient(p)) return 0;
  const copay = Number(p.extra?.insurance?.copayPercent);
  if (!Number.isFinite(copay)) return PAYER_SHARE;
  return Math.min(1, Math.max(0, 1 - copay / 100));
}

/** Rounds to halalas, so the payer amount here is the same figure as the insurance share on the invoice. */
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const percent = (share: number) => `${Math.round(share * 1000) / 10} percent`;

export const CLASS_FEE: Record<string, number> = { O: 350, E: 900, I: 3200 };
/** Estimated price of one lab test, used for the charge estimate and the approval threshold. */
export const LAB_TEST_FEE = 85;

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
  const rxItems = rx.reduce((n, p) => n + p.items.filter((i) => i.status !== "cancelled" && !i.patientProvided).length, 0);
  if (labTests) lines.push({ label: `Laboratory (${labTests} test${labTests === 1 ? "" : "s"})`, amount: labTests * LAB_TEST_FEE });
  if (rad.length) lines.push({ label: `Radiology (${rad.length} exam${rad.length === 1 ? "" : "s"})`, amount: rad.length * 320 });
  if (rxItems) lines.push({ label: `Medication (${rxItems} item${rxItems === 1 ? "" : "s"})`, amount: rxItems * 40 });
  return { total: lines.reduce((n, l) => n + l.amount, 0), lines };
}

export const needsAuthorization = (e: Encounter, c: Charge): boolean => e.cls === "I" || c.total >= AUTH_FROM;

/* ---------- prior authorization at the order (CHI) ---------- */

/** What is being ordered, for the approval rule. */
export type ApprovalService =
  | { kind: "imaging"; modality: string; label: string }
  | { kind: "admission"; label?: string }
  | { kind: "surgery"; label: string }
  | { kind: "service"; label: string; price: number };

/** Imaging that payers approve first: CT, MRI, nuclear medicine and PET. */
export const APPROVAL_MODALITIES = ["CT", "MR", "NM", "PT"];

/**
 * CHI: these need the payer's approval before they are done: CT, MRI, nuclear and PET imaging, admission, surgery, and
 * any other single service (for example a costly medicine) at or above AUTH_FROM SAR.
 */
export function serviceNeedsApproval(s: ApprovalService): boolean {
  if (s.kind === "imaging") return APPROVAL_MODALITIES.includes(s.modality);
  if (s.kind === "service") return s.price >= AUTH_FROM;
  return true;
}

const isEmergency = (e: Encounter | undefined) => !!e && (e.cls === "E" || !!e.ed);

/**
 * The order asks for approval: for an insured patient a request is queued on NPHIES Financial for the approvals officer
 * to send. Anyone who may place the order may queue it; sending stays with the officer. Returns null when no request is
 * needed (cash patient, or the service needs no approval) or one already covers it.
 */
export function requestOrderAuthorization(visit: string, service: ApprovalService, now: number = Date.now()): AuthRequest | null {
  if (!serviceNeedsApproval(service)) return null;
  const enc = getState().encounters.find((e) => e.visitNumber === visit);
  const patient = enc && getState().patients.find((p) => p.id === enc.patientId);
  if (!enc || !patient || !insuredPayer(patient)) return null;
  const c = caseOf(visit);
  if (c.authorization?.status === "approved" || c.authorization?.status === "pended") return null;
  const label = "label" in service && service.label ? service.label : service.kind === "admission" ? "Admission" : "Service";
  if (c.authRequests?.some((r) => r.service === label)) return null;
  const req: AuthRequest = { id: `AR-${visit}-${(c.authRequests?.length ?? 0) + 1}`, service: label, at: new Date(now).toISOString(), by: currentUser().name };
  store.set(patch(store.get(), visit, (x) => ({ ...x, authRequests: [...(x.authRequests ?? []), req] })));
  audit("create", `Prior authorization request ${req.id}`, { patient: patientName(patient), detail: `${label}, for the approvals officer` });
  return req;
}

export interface ServiceGate {
  /** True while the service must wait. The order is placed; only performing it waits. */
  blocked: boolean;
  /** Short status for the order: "Awaiting Approval", "Approval Due In 24 Hours", "Approval Denied", or "". */
  label: string;
  reason: string;
}

/**
 * The gate a lab, imaging or theatre step asks before the service is done. Cash patients and services that need no
 * approval are never blocked. Emergency visits are never blocked either (treat first; approval within 24 hours).
 */
export function serviceBlocked(o: { visitNumber: string; service: ApprovalService }): ServiceGate {
  const open: ServiceGate = { blocked: false, label: "", reason: "" };
  if (!serviceNeedsApproval(o.service)) return open;
  const enc = getState().encounters.find((e) => e.visitNumber === o.visitNumber);
  const patient = enc && getState().patients.find((p) => p.id === enc.patientId);
  const payer = patient ? insuredPayer(patient) : null;
  if (!payer) return open;
  const au = caseOf(o.visitNumber).authorization;
  if (au?.status === "approved") return open;
  if (isEmergency(enc)) return { blocked: false, label: "Approval Due In 24 Hours", reason: `Emergency: treat first. Ask ${payer} for approval within 24 hours.` };
  if (au?.status === "denied") return { blocked: true, label: "Approval Denied", reason: `${payer} refused the prior authorization. Ask again with more detail, or the patient pays cash.` };
  return { blocked: true, label: "Awaiting Approval", reason: `${payer} must approve this before it is done. The approvals officer sends the request on NPHIES Financial.` };
}

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
  const patient = getState().patients.find((x) => x.id === e.patientId);
  if (patient && isCashPatient(patient)) {
    const labels: [FinStep, string][] = [["eligibility", "Eligibility Check"], ["authorization", "Prior Authorization"], ["claim", "Claim"], ["payment", "Payment"]];
    return labels.map(([step, label], i) => ({
      step, label, status: "Not Needed", tone: "neutral" as const, action: null,
      hint: i === 0 ? CASH_REASON : "Cash visit. The patient pays at the cashier.", secondary: null,
    }));
  }
  const c = caseOf(e.visitNumber, s);
  const charge = estimateCharge(e);
  // A service ordered on this visit that needs approval (CT, MRI, surgery...) makes the authorization required too.
  const asked = c.authRequests ?? [];
  const authNeeded = needsAuthorization(e, charge) || asked.length > 0;
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
    auStatus = au ? (au.status === "denied" ? "Denied" : "Cancelled") : asked.length ? "Requested At Order" : "Required";
    auTone = au?.status === "denied" ? "danger" : "warn";
    auAction = au ? "Request Again" : "Request Authorization";
    // CHI emergency exception: treat first, ask for approval within 24 hours of the emergency admission.
    const orderedNote = asked.length ? `Ordered: ${asked.map((r) => `${r.service} by ${r.by}`).join("; ")}. ` : "";
    auHint = au?.note ?? orderedNote + (e.cls === "E" || e.ed ? "Emergency: treat first. Request approval within 24 hours of admission." : "Request approval before the service. The service waits for the answer.");
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
  const right = action === "eligibility" || action === "authorization" || action === "poll-auth" || action === "cancel-auth" ? "approvals" : "billing";
  if (!can(right)) {
    pushToast({ tone: "warn", text: "Your role cannot do this.", detail: `This needs the ${right} permission.` });
    return false;
  }
  const hs = getState();
  const e = hs.encounters.find((x) => x.visitNumber === visit);
  const p = e && hs.patients.find((x) => x.id === e.patientId);
  if (!e || !p) return false;
  if (isCashPatient(p)) {
    pushToast({ tone: "warn", text: "Nothing was sent to NPHIES.", detail: CASH_REASON });
    return false;
  }
  const payer = payerOf(p);
  const share = payerShareOf(p);
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
      const note = ok ? `${payer}: covered. Patient pays ${percent(1 - share)}. Prior authorization needed for ${AUTH_FROM.toLocaleString()} SAR and above.` : `${payer}: no active policy found for this patient.`;
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
      const claimNumber = `CL${String(n).padStart(8, "0")}`; // HIS: CL{sequence:D8}
      const approved = status === "approved" ? money(charge.total * share) : undefined;
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
      const approved = money(charge.total * share);
      const note = `Approved ${approved.toLocaleString()} of ${charge.total.toLocaleString()} SAR after your answer.`;
      s = push(s, visit, { kind: "communication", direction: "out", summary: "Discharge summary sent to the payer", json: skeleton("communication", e, p, payer, { resourceType: "Communication", status: "completed", payload: [{ contentString: "Discharge summary attached." }] }) });
      s = push(s, visit, { kind: "claim-response", direction: "in", summary: "Approved", json: skeleton("claim-response", e, p, payer, { resourceType: "ClaimResponse", use: "claim", outcome: "complete" }) });
      s = patch(s, visit, (c) => ({ ...c, claim: c.claim && { ...c.claim, status: "approved", approved, note, at } }));
      toast(true, "Claim approved.", note);
      log("communication");
      break;
    }
    case "poll-claim": {
      const approved = money(charge.total * share);
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
      const amount = cl?.approved ?? money(charge.total * share);
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
  /** The card's payer, or "Cash". */
  payer: string;
  /** True for a cash visit: listed so the cashier sees it, but nothing can be sent to NPHIES. */
  cash: boolean;
  charge: Charge;
  authNeeded: boolean;
}

/** Every billable visit. Cash visits are in the list (the invoice worklist needs them) with `cash` set and no steps to run. */
export function financialVisits(): FinVisit[] {
  const hs = getState();
  const out: FinVisit[] = [];
  for (const enc of hs.encounters) {
    if (enc.status === "cancelled" || enc.status === "preadmit") continue;
    const patient = hs.patients.find((p) => p.id === enc.patientId);
    if (!patient) continue;
    const charge = estimateCharge(enc);
    const cash = isCashPatient(patient);
    out.push({ enc, patient, payer: payerOf(patient), cash, charge, authNeeded: !cash && needsAuthorization(enc, charge) });
  }
  return out;
}
