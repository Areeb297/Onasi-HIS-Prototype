import type { FinCase, FinKind, FinMessage } from "./nphies-financial";
import type { DemoTarget } from "./rcm-demo";

/**
 * The claim history of each demo visit, built as NPHIES Financial records (eligibility, prior authorization, claim,
 * payment) with their request and response messages, dated over the life of the visit. Pure: claims.ts passes in the
 * visit facts and the invoice amounts, and writes the result into the stores.
 *
 * Amounts: the claim total is the invoice net and the full approval is the invoice insurance share, the same figures
 * the invoice and the claim page show. A partial approval denies part of one line; the payment is what the payer sent.
 * Error and denial codes are sample codes in the NPHIES format, the same ones the rejection and denial screens use.
 */

export interface AnswerError { code: string; scope: "Claim" | "Item"; seq?: number; text: string }
export interface AnswerLine { seq: number; key: string; claimed: number; approved: number; denied: number; reason?: string; reasonText?: string }

/** What the payer answered on a demo claim, beyond the status and amount kept by NPHIES Financial. */
export interface PayerAnswer {
  claimNumber: string;
  at: string;
  /** Errors on a rejected claim (or denied prior authorization). */
  errors: AnswerError[];
  /** Insurance amount approved and denied per service line. */
  lines: AnswerLine[];
}

export const REJECTION_TEXT: Record<string, string> = {
  "BV-00027": "There is no principal diagnosis on the claim.",
  "BV-00045": "The service needs prior authorization and no approval number was sent.",
  "BV-00230": "A service line is not linked to a diagnosis.",
  "BV-00318": "The service code is not in the payer price list.",
  "BV-00402": "This claim repeats a claim that was already sent.",
  "BV-00763": "Required vital signs are missing.",
};
export const DENIAL_TEXT: Record<string, string> = {
  "MN-1-1": "The service is not medically justified for the diagnosis given.",
  "CV-4-1": "The service is not covered by the member's policy class.",
  "AD-1-4": "The diagnosis does not match the service.",
  "SE-1-6": "The price is above the agreed contract price.",
};

export interface DemoClaimInput {
  visit: string;
  target: DemoTarget;
  cls: "O" | "E" | "I";
  start: Date;
  /** Discharge or end of visit; for a visit still open, now. */
  end: Date;
  healthId: string;
  payer: string;
  /** Invoice net, what the claim asks for. */
  net: number;
  /** Invoice insurance share: the full approval. */
  insurance: number;
  lines: { seq: number; key: string; net: number; insurance: number }[];
  dxCount: number;
}

export interface DemoClaimResult {
  cases: FinCase[];
  seq: number;
  answers: Record<string, PayerAnswer>;
  /** When each claim was saved, reviewed and sent, for the claim draft. */
  steps: Record<string, { savedAt: string; reviewedAt?: string; sentAt?: string; paSentAt?: string; claimNumber?: string }>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const hex = (n: number) => n.toString(16).padStart(6, "0");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Same envelope as the NPHIES Financial messages: header, patient, payer organization, then the business resource. */
function bundle(kind: FinKind, visit: string, healthId: string, payer: string, body: Record<string, unknown>): string {
  return JSON.stringify({
    resourceType: "Bundle", type: "message",
    entry: [
      { resource: { resourceType: "MessageHeader", eventCoding: { system: "http://nphies.sa/terminology/CodeSystem/ksa-message-events", code: kind }, source: { endpoint: "http://onasi.example/nphies" }, destination: [{ endpoint: "http://nphies.sa" }] } },
      { resource: { resourceType: "Patient", identifier: [{ system: "http://nphies.sa/identifier/nationalid", value: healthId }] } },
      { resource: { resourceType: "Organization", name: payer } },
      { resource: { ...body, extension: [{ url: "visit", valueString: visit }] } },
    ],
  }, null, 2);
}

/** Which errors a rejected demo claim carries, and which reason a partly approved one gives. */
function rejectionFor(c: DemoClaimInput): AnswerError[] {
  if (c.dxCount === 0) return [{ code: "BV-00027", scope: "Claim", text: REJECTION_TEXT["BV-00027"] }];
  if (c.cls === "I") return [
    { code: "BV-00230", scope: "Item", seq: 1, text: REJECTION_TEXT["BV-00230"] },
    { code: "BV-00763", scope: "Claim", text: REJECTION_TEXT["BV-00763"] },
  ];
  return [{ code: "BV-00318", scope: "Item", seq: 1, text: REJECTION_TEXT["BV-00318"] }];
}
const DENIAL_BY_CLASS: Record<DemoClaimInput["cls"], { reason: string; part: number }> = {
  I: { reason: "SE-1-6", part: 0.25 }, E: { reason: "MN-1-1", part: 0.4 }, O: { reason: "AD-1-4", part: 0.5 },
};

/**
 * Builds the NPHIES Financial cases. Messages get their seq in time order across all visits, starting after `startSeq`,
 * and every reference is made from its message number, as NPHIES Financial does.
 */
export function buildDemoClaims(input: DemoClaimInput[], now: Date, startSeq = 0): DemoClaimResult {
  type Ev = { visit: string; at: number; kind: FinKind; direction: "in" | "out"; summary: string; body: (n: number) => Record<string, unknown>; apply?: (c: FinCase, n: number, at: string) => void };
  const events: Ev[] = [];
  const steps: DemoClaimResult["steps"] = {};
  const answers: Record<string, PayerAnswer> = {};
  const claimOrder: { visit: string; at: number }[] = [];
  const cap = (t: number) => Math.min(t, now.getTime() - 20 * MIN);

  for (const c of input) {
    const t0 = c.start.getTime();
    const tEnd = c.end.getTime();
    const add = (e: Omit<Ev, "visit">) => events.push({ ...e, visit: c.visit });
    const reply = (at: number, ms = 1200) => at + ms;
    const step = (steps[c.visit] = { savedAt: new Date(cap(tEnd + 40 * MIN)).toISOString() } as DemoClaimResult["steps"][string]);

    // Eligibility at registration, before the visit opens.
    const tEl = t0 - 12 * MIN;
    add({ at: tEl, kind: "eligibility-request", direction: "out", summary: `Is the patient covered by ${c.payer}?`, body: () => ({ resourceType: "CoverageEligibilityRequest", status: "active", purpose: ["benefits", "validation"], servicedDate: new Date(t0).toISOString().slice(0, 10) }) });
    add({ at: reply(tEl, 900), kind: "eligibility-response", direction: "in", summary: "Covered", body: () => ({ resourceType: "CoverageEligibilityResponse", status: "active", outcome: "complete", insurance: [{ inforce: true }] }),
      apply: (fc, n, at) => { fc.eligibility = { status: "eligible", at, ref: `ELG-${hex(n)}`, note: `${c.payer}: covered. Prior authorization needed for 1,000 SAR and above.` }; } });

    if (c.target === "drafted") continue;
    if (c.target === "reviewed") { step.reviewedAt = new Date(cap(tEnd + 70 * MIN)).toISOString(); continue; }

    // Prior authorization: every inpatient stay, and the visits that test it.
    const needsPa = c.cls === "I" || c.target.startsWith("pa-");
    if (needsPa) {
      const tPa = t0 + 35 * MIN;
      step.reviewedAt = new Date(tPa - 5 * MIN).toISOString();
      step.paSentAt = new Date(tPa).toISOString();
      add({ at: tPa, kind: "priorauth-request", direction: "out", summary: `Approval requested for ${c.net.toLocaleString()} SAR`, body: () => ({ resourceType: "Claim", use: "preauthorization", status: "active", total: { value: c.net, currency: "SAR" } }) });
      if (c.target === "pa-pended") {
        add({ at: reply(tPa), kind: "priorauth-response", direction: "in", summary: "Queued, answer later", body: () => ({ resourceType: "ClaimResponse", use: "preauthorization", outcome: "queued" }),
          apply: (fc, n, at) => { fc.authorization = { status: "pended", at, ref: `PA-${hex(n)}`, note: "The payer will answer later. Check for the answer." }; } });
        continue;
      }
      if (c.target === "pa-rejected") {
        const reason = "CV-4-1";
        answers[c.visit] = { claimNumber: "", at: new Date(reply(tPa, 4 * HOUR)).toISOString(), errors: [{ code: reason, scope: "Claim", text: DENIAL_TEXT[reason] }], lines: [] };
        add({ at: reply(tPa, 4 * HOUR), kind: "priorauth-response", direction: "in", summary: "Denied", body: () => ({ resourceType: "ClaimResponse", use: "preauthorization", outcome: "error", error: [{ code: { coding: [{ system: "http://nphies.sa/terminology/CodeSystem/adjudication-reason", code: reason, display: DENIAL_TEXT[reason] }] } }] }),
          apply: (fc, n, at) => { fc.authorization = { status: "denied", at, ref: `PA-${hex(n)}`, note: `Denied: ${DENIAL_TEXT[reason]} (${reason})` }; } });
        continue;
      }
      add({ at: reply(tPa, 40 * MIN), kind: "priorauth-response", direction: "in", summary: "Approved", body: (n) => ({ resourceType: "ClaimResponse", use: "preauthorization", outcome: "complete", preAuthRef: `AUTH-${hex(n)}` }),
        apply: (fc, n, at) => { fc.authorization = { status: "approved", at, ref: `PA-${hex(n)}`, authNumber: `AUTH-${hex(n)}`, note: `Approved for ${c.net.toLocaleString()} SAR. Authorization AUTH-${hex(n)}.` }; } });
      if (c.target === "pa-approved") continue;
    }

    // The claim, sent the day after the visit ended (the hospital batches its claims).
    const tCl = cap(tEnd + DAY + 2 * HOUR);
    step.reviewedAt = step.reviewedAt ?? new Date(tCl - 30 * MIN).toISOString();
    step.savedAt = new Date(tCl - 45 * MIN).toISOString();
    step.sentAt = new Date(tCl).toISOString();
    claimOrder.push({ visit: c.visit, at: tCl });
    const claimNo = () => step.claimNumber!;
    add({ at: tCl, kind: "claim-request", direction: "out", summary: `Claim for ${c.net.toLocaleString()} SAR`,
      body: () => ({ resourceType: "Claim", use: "claim", status: "active", identifier: claimNo(), total: { value: c.net, currency: "SAR" }, item: c.lines.map((l) => ({ sequence: l.seq, net: { value: l.net, currency: "SAR" } })) }) });

    if (c.target === "submitted") {
      add({ at: reply(tCl), kind: "claim-response", direction: "in", summary: "Queued, answer later", body: () => ({ resourceType: "ClaimResponse", use: "claim", outcome: "queued" }),
        apply: (fc, n, at) => { fc.claim = { status: "pended", at, ref: `CL-${hex(n)}`, claimNumber: claimNo(), note: "The payer will answer later. Check for the answer." }; } });
      continue;
    }
    if (c.target === "pended") {
      const ask = c.cls === "I" ? "the discharge summary" : "the medical report of the visit";
      add({ at: reply(tCl, 3 * HOUR), kind: "communication-request", direction: "in", summary: `Payer asks for ${ask}`, body: () => ({ resourceType: "CommunicationRequest", status: "active", payload: [{ contentString: `Please send ${ask}.` }] }),
        apply: (fc, n, at) => { fc.claim = { status: "needs-info", at, ref: `CL-${hex(n)}`, claimNumber: claimNo(), note: `The payer pended the claim and needs ${ask} before it can decide.` }; } });
      continue;
    }
    if (c.target === "rejected") {
      const errors = rejectionFor(c);
      answers[c.visit] = { claimNumber: "", at: new Date(reply(tCl, 2 * HOUR)).toISOString(), errors, lines: c.lines.map((l) => ({ seq: l.seq, key: l.key, claimed: l.net, approved: 0, denied: 0 })) };
      add({ at: reply(tCl, 2 * HOUR), kind: "claim-response", direction: "in", summary: "Rejected",
        body: () => ({ resourceType: "ClaimResponse", use: "claim", outcome: "error", error: errors.map((e) => ({ ...(e.seq ? { itemSequence: e.seq } : {}), code: { coding: [{ system: "http://nphies.sa/terminology/CodeSystem/adjudication-error", code: e.code, display: e.text }] } })) }),
        apply: (fc, n, at) => { fc.claim = { status: "rejected", at, ref: `CL-${hex(n)}`, claimNumber: claimNo(), note: `Rejected: ${errors.map((e) => `${e.code} ${e.text}`).join(" ")}` }; } });
      continue;
    }

    // Approved, in full or in part.
    const deny = c.target === "partial" ? DENIAL_BY_CLASS[c.cls] : null;
    const lines: AnswerLine[] = c.lines.map((l, i) => {
      const deniedIns = deny && i === 0 ? r2(l.insurance * deny.part) : 0;
      return { seq: l.seq, key: l.key, claimed: l.net, approved: r2(l.insurance - deniedIns), denied: deniedIns, ...(deniedIns ? { reason: deny!.reason, reasonText: DENIAL_TEXT[deny!.reason] } : {}) };
    });
    const approved = r2(lines.reduce((n, l) => n + l.approved, 0));
    answers[c.visit] = { claimNumber: "", at: new Date(reply(tCl, 26 * HOUR)).toISOString(), errors: [], lines };
    const tAns = cap(reply(tCl, deny ? 26 * HOUR : 6 * HOUR));
    add({ at: tAns, kind: "claim-response", direction: "in", summary: deny ? "Partially Approved" : "Approved",
      body: () => ({ resourceType: "ClaimResponse", use: "claim", outcome: "complete", total: [{ category: "benefit", amount: { value: approved, currency: "SAR" } }],
        item: lines.map((l) => ({ itemSequence: l.seq, adjudication: [{ category: "eligible", amount: { value: r2(l.approved + l.denied), currency: "SAR" } }, { category: "benefit", amount: { value: l.approved, currency: "SAR" } }], ...(l.reason ? { reason: { coding: [{ code: l.reason, display: l.reasonText }] } } : {}) })) }),
      apply: (fc, n, at) => { fc.claim = { status: "approved", at, ref: `CL-${hex(n)}`, claimNumber: claimNo(), approved, note: deny ? `Partly approved: ${approved.toLocaleString()} of ${c.insurance.toLocaleString()} SAR. ${DENIAL_TEXT[deny.reason]} (${deny.reason})` : `Approved ${approved.toLocaleString()} of ${c.net.toLocaleString()} SAR. The patient pays the rest.` }; } });

    if (c.target !== "paid" && c.target !== "part-paid") continue;
    const amount = c.target === "paid" ? approved : r2(approved * 0.6);
    const tPoll = cap(tAns + 18 * DAY);
    add({ at: tPoll, kind: "poll-request", direction: "out", summary: "Any payment advice for us?", body: () => ({ resourceType: "Task", status: "requested", code: "poll", input: "payment-reconciliation" }) });
    add({ at: reply(tPoll), kind: "payment-reconciliation", direction: "in", summary: `Payer paid ${amount.toLocaleString()} SAR`,
      body: (n) => ({ resourceType: "PaymentReconciliation", status: "active", outcome: "complete", identifier: `PRC-2026-${String(n).padStart(5, "0")}`, paymentAmount: { value: amount, currency: "SAR" }, detail: [{ request: claimNo(), amount: { value: amount, currency: "SAR" } }] }),
      apply: (fc, n, at) => { fc.payment = { status: "reconciliation-received", at, ref: `PR-${hex(n)}`, amount, batch: `PRC-2026-${String(n).padStart(5, "0")}` }; } });
    const tNotice = cap(tPoll + 2 * DAY);
    add({ at: tNotice, kind: "payment-notice", direction: "out", summary: `Money received: ${amount.toLocaleString()} SAR`,
      body: () => ({ resourceType: "PaymentNotice", status: "active", paymentStatus: "paid", amount: { value: amount, currency: "SAR" } }),
      apply: (fc, _n, at) => { if (fc.payment) fc.payment = { ...fc.payment, status: "notice-sent", at }; } });
  }

  // Claim numbers follow the order the claims were sent, like the HIS (CL00000001 upwards).
  claimOrder.sort((a, b) => a.at - b.at).forEach((x, i) => { steps[x.visit].claimNumber = `CL${String(i + 1).padStart(8, "0")}`; });
  for (const [visit, a] of Object.entries(answers)) a.claimNumber = steps[visit]?.claimNumber ?? "";

  events.sort((a, b) => a.at - b.at || (a.direction === "out" ? -1 : 1));
  const cases = new Map<string, FinCase>();
  let seq = startSeq;
  for (const e of events) {
    seq += 1;
    const fc = cases.get(e.visit) ?? { visit: e.visit, messages: [] };
    const at = new Date(e.at).toISOString();
    const c = input.find((x) => x.visit === e.visit)!;
    const msg: FinMessage = { seq, at, kind: e.kind, direction: e.direction, summary: e.summary, json: bundle(e.kind, e.visit, c.healthId, c.payer, e.body(seq)) };
    fc.messages = [...fc.messages, msg];
    e.apply?.(fc, seq, at);
    cases.set(e.visit, fc);
  }
  return { cases: [...cases.values()], seq, answers, steps };
}
