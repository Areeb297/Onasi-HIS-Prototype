import { can } from "../session";
import { isOff, logCall, modeOf, ownCalls, type CallEntry, type IntegrationId } from "./call-log";
import { nphiesClinicalCalls } from "./nphies-clinical";
import { nphiesFinancialCalls } from "./nphies-financial";
import { raqeebCalls } from "./raqeeb";
import { zatcaCalls } from "./zatca";

/** The national integrations of the hospital, and one way to read every call made to each of them. */

export interface Integration {
  id: IntegrationId;
  name: string;
  /** Who runs the service. */
  owner: string;
  /** What the hospital uses it for. */
  services: string[];
  /** Money integrations: a billing officer may see their log. */
  financial: boolean;
}

export const INTEGRATIONS: Integration[] = [
  { id: "nphies-financial", name: "NPHIES Financial", owner: "Council of Health Insurance", services: ["Eligibility", "Prior Authorization", "Claims"], financial: true },
  { id: "nphies-clinical", name: "NPHIES Clinical (UHR)", owner: "National Health Information Center", services: ["ADT", "Lab", "Radiology", "Medication", "CDA Documents"], financial: false },
  { id: "raqeeb", name: "Raqeeb", owner: "Ministry of Health", services: ["Controlled Medicines"], financial: false },
  { id: "yakeen", name: "Yakeen", owner: "Elm", services: ["Identity Check", "National Address"], financial: false },
  { id: "rsd", name: "RSD", owner: "Saudi Food and Drug Authority", services: ["Drug Track And Trace"], financial: false },
  { id: "seha", name: "Seha Sick Leave", owner: "Ministry of Health", services: ["Issue", "Cancel", "Verify"], financial: false },
  { id: "zatca", name: "ZATCA E-Invoicing", owner: "Zakat, Tax and Customs Authority", services: ["Simplified Tax Invoices"], financial: true },
];

/** The System Administrator sees every integration. A billing officer sees the financial ones. Nobody else sees the hub. */
export const visibleIntegrations = (): Integration[] => (can("admin") ? INTEGRATIONS : can("billing") ? INTEGRATIONS.filter((i) => i.financial) : []);

const READERS: Partial<Record<IntegrationId, () => CallEntry[]>> = {
  "nphies-financial": nphiesFinancialCalls, "nphies-clinical": nphiesClinicalCalls, raqeeb: raqeebCalls, zatca: zatcaCalls,
};

/** Every call to one integration, newest first: the records its own store keeps, plus what the shared call log holds. */
export const callsOf = (id: IntegrationId): CallEntry[] =>
  [...(READERS[id]?.() ?? []), ...ownCalls(id)].sort((a, b) => b.at.localeCompare(a.at));

export interface CallStats {
  last?: CallEntry;
  today: number;
  todayOk: number;
  /** Whole percent of today's calls that succeeded. Null when there were none today. */
  rate: number | null;
}

export function statsOf(calls: CallEntry[], now: number = Date.now()): CallStats {
  const day = new Date(now).toDateString();
  const today = calls.filter((c) => new Date(c.at).toDateString() === day);
  const todayOk = today.filter((c) => c.ok).length;
  const last = calls.reduce<CallEntry | undefined>((m, c) => (!m || c.at > m.at ? c : m), undefined);
  return { last, today: today.length, todayOk, rate: today.length ? Math.round((todayOk / today.length) * 100) : null };
}

/** A connection test the System Administrator can run. It is written to the log like any other call. */
export function testConnection(id: IntegrationId, now: number = Date.now()): CallEntry | null {
  if (!can("admin")) return null;
  const off = isOff(id);
  return logCall({
    integration: id, operation: "Connection Test", ok: !off, summary: off ? "Switched off, no connection" : "Service answered",
    request: { ping: true, mode: modeOf(id) }, response: off ? { status: "DOWN", message: "The integration is switched off." } : { status: "UP" },
  }, now);
}

export * from "./call-log";
