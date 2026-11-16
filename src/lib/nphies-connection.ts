import type { FinCase } from "./nphies-financial";
import type { OutboxGroup, OutboxRow, OutboxType } from "./nphies-outbox";

/**
 * The NHIC "nphies facility connection indicator" use cases (https://nhic.gov.sa/nuc/), and which of them this
 * hospital has used: a use case counts as connected once at least one message for it was accepted.
 */

export type UseCaseId =
  | "visit-history" | "sso" | "clinical-notes" | "e-prescribe" | "e-dispense" | "lab-result" | "lab-order"
  | "rad-order" | "rad-view" | "rad-report" | "prior-auth" | "claims" | "payment" | "eligibility";

/** Each send-list item type and the use case it belongs to. Vital signs are sent too but are not an NHIC use case. */
export const OUTBOX_USE_CASE: Record<OutboxType, UseCaseId | "vitals"> = {
  visit: "visit-history", "lab-order": "lab-order", "lab-result": "lab-result", "rad-order": "rad-order", "rad-report": "rad-report",
  rx: "e-prescribe", dispense: "e-dispense", vitals: "vitals", document: "clinical-notes",
};

/** The icon for a group filter on the send list. */
export const GROUP_USE_CASE: Record<OutboxGroup, UseCaseId | "vitals"> = {
  visit: "visit-history", lab: "lab-result", radiology: "rad-report", medication: "e-prescribe", vitals: "vitals", documents: "clinical-notes",
};

/** Use cases this system does not send at all (sign-on is the national portal's, image viewing is a PACS link). */
export const NOT_BUILT: readonly UseCaseId[] = ["sso", "rad-view"];

export type Connection = "connected" | "not-yet" | "not-built";

export function connectionStatus(rows: readonly Pick<OutboxRow, "type" | "state" | "lastAt">[], cases: readonly FinCase[]): Record<UseCaseId, Connection> {
  const used = new Set<string>();
  // "sent" and "changes" both mean a version was accepted before; a rejected or never-sent item proves nothing.
  for (const r of rows) if (r.state === "sent" || r.state === "changes") used.add(OUTBOX_USE_CASE[r.type]);
  for (const c of cases) {
    if (c.eligibility) used.add("eligibility");
    if (c.authorization) used.add("prior-auth");
    if (c.claim && c.claim.status !== "rejected") used.add("claims"); // an error outcome is not an accepted exchange
    if (c.payment) used.add("payment");
  }
  const ids: UseCaseId[] = ["visit-history", "sso", "clinical-notes", "e-prescribe", "e-dispense", "lab-result", "lab-order", "rad-order", "rad-view", "rad-report", "prior-auth", "claims", "payment", "eligibility"];
  return Object.fromEntries(ids.map((id) => [id, NOT_BUILT.includes(id) ? "not-built" : used.has(id) ? "connected" : "not-yet"])) as Record<UseCaseId, Connection>;
}
