import { getFinancial, type FinMessage } from "../nphies-financial";
import type { CallEntry } from "./call-log";

/** NPHIES Financial calls, read from the financial store: each request is paired with the answer that followed it. */

const REFUSED = /^(Not covered|Denied|Rejected)/;
const OPERATION: Partial<Record<FinMessage["kind"], string>> = {
  "eligibility-request": "Eligibility", "priorauth-request": "Prior Authorization", "claim-request": "Claim", "poll-request": "Poll",
  "cancel-request": "Cancel", communication: "Payer Question Answer", "payment-notice": "Payment Notice",
  "payment-reconciliation": "Payment Reconciliation", "communication-request": "Payer Question",
};

export function nphiesFinancialCalls(): CallEntry[] {
  const out: CallEntry[] = [];
  for (const c of getFinancial().cases) {
    let open: CallEntry | null = null;
    for (const m of c.messages) {
      if (m.direction === "in" && open && !open.response) {
        open.response = m.json;
        open.summary = `${open.summary}: ${m.summary}`;
        open.ok = !REFUSED.test(m.summary);
        continue;
      }
      open = {
        id: `FIN-${m.seq}`, integration: "nphies-financial", at: m.at, operation: OPERATION[m.kind] ?? m.kind, summary: `Visit ${c.visit}. ${m.summary}`,
        ok: true, format: "JSON", request: m.direction === "out" ? m.json : "", response: m.direction === "in" ? m.json : "",
      };
      out.push(open);
    }
  }
  return out;
}
