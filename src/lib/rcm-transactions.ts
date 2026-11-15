import type { FinCase, FinKind, FinMessage } from "./nphies-financial";
import { getFinancial } from "./nphies-financial";
import { getState, patientName } from "./store";

/**
 * Submitted Transactions: every request the app sent to NPHIES and the answer that came back, read from the NPHIES
 * Financial message log (nphies-financial.ts). Nothing here sends or stores anything; it pairs each outgoing message with
 * the first incoming message after it for the same visit.
 *
 * The bundle id is not in the shortened message skeletons, so it is made from the visit and the message number. It is
 * stable, and the formatted JSON shows it as the Bundle id.
 */

export type TxType = "eligibility" | "priorauth" | "claim" | "communication" | "poll" | "cancel" | "payment-notice";

export const TX_TYPES: { key: TxType; label: string; short: string }[] = [
  { key: "eligibility", label: "Eligibility", short: "Eligibility" },
  { key: "priorauth", label: "Prior Authorization", short: "PreAuth" },
  { key: "claim", label: "Claim", short: "Claim" },
  { key: "communication", label: "Communication", short: "Communication" },
  { key: "poll", label: "Poll", short: "Poll" },
  { key: "cancel", label: "Cancel", short: "Cancel" },
  { key: "payment-notice", label: "Payment Notice", short: "Payment" },
];
export const TX_TYPE_LABEL = Object.fromEntries(TX_TYPES.map((t) => [t.key, t.label])) as Record<TxType, string>;

const TYPE_OF: Partial<Record<FinKind, TxType>> = {
  "eligibility-request": "eligibility",
  "priorauth-request": "priorauth",
  "claim-request": "claim",
  communication: "communication",
  "poll-request": "poll",
  "cancel-request": "cancel",
  "payment-notice": "payment-notice",
};

export type OutcomeTone = "ok" | "warn" | "danger" | "info" | "neutral";
export interface Outcome { label: string; tone: OutcomeTone }

/** Every outcome label, in the order the filter lists them. */
export const OUTCOMES = ["Covered", "Not Covered", "Approved", "Partially Approved", "Queued", "Denied", "Rejected", "Question From Payer", "Payment Advice", "Cancelled", "Sent"] as const;

export interface RcmTransaction {
  /** `${visit}-${request seq}`: the route id of the detail page. */
  id: string;
  visit: string;
  type: TxType;
  bundleId: string;
  responseBundleId?: string;
  sentAt: string;
  respondedAt?: string;
  /** Milliseconds from sending to the answer. */
  responseMs?: number;
  request: FinMessage;
  response?: FinMessage;
  outcome: Outcome;
  patientId?: string;
  patientName: string;
  mrn: string;
  payer: string;
  /** What the request was about, for a poll or a cancel: Prior Authorization, Claim or Payment. */
  focus?: string;
}

/** A stable id shaped like a UUID, made from the visit and the message number (FNV-1a, four rounds). */
export function bundleIdOf(visit: string, seq: number): string {
  let hex = "";
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round;
    for (const ch of `${visit}:${seq}:${round}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    hex += h.toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const parse = (json: string): Record<string, unknown> | null => {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return null; }
};

type Entry = { resource?: Record<string, unknown> };
const entries = (msg: FinMessage): Entry[] => ((parse(msg.json)?.entry as Entry[] | undefined) ?? []);

/** The payer named in the message (the Organization entry). */
export function payerIn(msg: FinMessage): string {
  const org = entries(msg).find((e) => e.resource?.resourceType === "Organization");
  return typeof org?.resource?.name === "string" ? org.resource.name : "";
}

/** The business resource of the message: the last entry (Claim, ClaimResponse, Task, PaymentNotice and so on). */
export function focalResource(msg: FinMessage): Record<string, unknown> | null {
  const list = entries(msg);
  return list[list.length - 1]?.resource ?? null;
}

function outcomeOf(type: TxType, response: FinMessage | undefined): Outcome {
  if (!response) return type === "cancel" ? { label: "Cancelled", tone: "neutral" } : { label: "Sent", tone: "neutral" };
  const s = response.summary;
  switch (response.kind) {
    case "eligibility-response": return s === "Covered" ? { label: "Covered", tone: "ok" } : { label: "Not Covered", tone: "danger" };
    case "priorauth-response":
    case "claim-response":
      if (s === "Approved") return { label: "Approved", tone: "ok" };
      if (s === "Partially Approved") return { label: "Partially Approved", tone: "warn" };
      if (s === "Denied") return { label: "Denied", tone: "danger" };
      if (s === "Rejected") return { label: "Rejected", tone: "danger" };
      return { label: "Queued", tone: "info" };
    case "communication-request": return { label: "Question From Payer", tone: "warn" };
    case "payment-reconciliation": return { label: "Payment Advice", tone: "ok" };
    default: return { label: "Sent", tone: "neutral" };
  }
}

function focusOf(type: TxType, request: FinMessage, response: FinMessage | undefined): string | undefined {
  if (type === "cancel") {
    const f = focalResource(request)?.focus;
    return f === "priorauth" ? "Prior Authorization" : f === "claim" ? "Claim" : undefined;
  }
  if (type === "poll") {
    if (response?.kind === "priorauth-response") return "Prior Authorization";
    if (response?.kind === "claim-response") return "Claim";
    if (response?.kind === "payment-reconciliation") return "Payment";
  }
  return undefined;
}

export interface PatientRef { id: string; name: string; mrn: string }

/** Pairs every outgoing message with the first incoming message that follows it, visit by visit. Newest first. */
export function buildTransactions(cases: FinCase[], patientOf: (visit: string) => PatientRef | undefined): RcmTransaction[] {
  const out: RcmTransaction[] = [];
  for (const c of cases) {
    const msgs = [...c.messages].sort((a, b) => a.seq - b.seq);
    const who = patientOf(c.visit);
    msgs.forEach((request, i) => {
      if (request.direction !== "out") return;
      const type = TYPE_OF[request.kind];
      if (!type) return;
      const next = msgs[i + 1];
      const response = next && next.direction === "in" ? next : undefined;
      const ms = response ? Math.max(0, new Date(response.at).getTime() - new Date(request.at).getTime()) : undefined;
      out.push({
        id: `${c.visit}-${request.seq}`, visit: c.visit, type,
        bundleId: bundleIdOf(c.visit, request.seq), responseBundleId: response ? bundleIdOf(c.visit, response.seq) : undefined,
        sentAt: request.at, respondedAt: response?.at, responseMs: ms,
        request, response, outcome: outcomeOf(type, response),
        patientId: who?.id, patientName: who?.name ?? "Unknown Patient", mrn: who?.mrn ?? "",
        payer: payerIn(request), focus: focusOf(type, request, response),
      });
    });
  }
  return out.sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.request.seq - a.request.seq);
}

/** Every transaction the app has sent, from the live stores. */
export function allTransactions(): RcmTransaction[] {
  const his = getState();
  return buildTransactions(getFinancial().cases, (visit) => {
    const enc = his.encounters.find((e) => e.visitNumber === visit);
    const p = enc && his.patients.find((x) => x.id === enc.patientId);
    return p ? { id: p.id, name: patientName(p), mrn: p.mrn } : undefined;
  });
}

export const transactionById = (id: string, list: RcmTransaction[] = allTransactions()): RcmTransaction | undefined => list.find((t) => t.id === id);

/** The visit's transactions, oldest first, for the timeline. */
export const visitTimeline = (visit: string, list: RcmTransaction[] = allTransactions()): RcmTransaction[] =>
  list.filter((t) => t.visit === visit).sort((a, b) => a.request.seq - b.request.seq);

export interface TxFilter { patient: string; payer: string; type: "" | TxType; outcome: string; from: string; to: string; visit: string }
export const EMPTY_TX_FILTER: TxFilter = { patient: "", payer: "", type: "", outcome: "", from: "", to: "", visit: "" };

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Patient search matches name, MRN, visit and bundle id. Dates compare the local day the request was sent. */
export function filterTransactions(list: RcmTransaction[], f: TxFilter): RcmTransaction[] {
  const q = f.patient.trim().toLowerCase();
  return list.filter((t) => {
    if (q && !`${t.patientName} ${t.mrn} ${t.visit} ${t.bundleId}`.toLowerCase().includes(q)) return false;
    if (f.visit && t.visit !== f.visit) return false;
    if (f.payer && t.payer !== f.payer) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.outcome && t.outcome.label !== f.outcome) return false;
    const day = localDay(t.sentAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

/** "Under 1 second", "2.4 seconds", "3 minutes". */
export function responseTimeText(ms: number | undefined): string {
  if (ms === undefined) return "No Response";
  if (ms < 1000) return "Under 1 second";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} seconds`;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} minute${min === 1 ? "" : "s"}` : `${Math.round(min / 60)} hour${Math.round(min / 60) === 1 ? "" : "s"}`;
}

/** The message as sent, formatted, with the Bundle id and timestamp in place. */
export function formattedPayload(msg: FinMessage, bundleId: string): string {
  const body = parse(msg.json);
  if (!body) return msg.json;
  const { resourceType, ...rest } = body;
  return JSON.stringify({ resourceType, id: bundleId, timestamp: msg.at, ...rest }, null, 2);
}
