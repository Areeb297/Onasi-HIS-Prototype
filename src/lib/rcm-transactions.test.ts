import { beforeEach, describe, expect, it } from "vitest";
import { caseOf, resetFinancial, runFinancial, setFinRejectNext, type FinCase } from "./nphies-financial";
import {
  allTransactions, buildTransactions, bundleIdOf, EMPTY_TX_FILTER, filterTransactions, formattedPayload, responseTimeText, transactionById, visitTimeline,
} from "./rcm-transactions";
import { switchUser } from "./session";
import { getState, replaceState, seedState } from "./store";

const CARD = { payer: "Tawuniya", policyNo: "POL-1", memberId: "MEM-1", className: "Class B", network: "Silver", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 20, status: "Active" as const };

const msg = (seq: number, kind: FinCase["messages"][number]["kind"], direction: "in" | "out", summary: string, at: string, extra: Record<string, unknown> = {}) => ({
  seq, kind, direction, summary, at,
  json: JSON.stringify({ resourceType: "Bundle", type: "message", entry: [{ resource: { resourceType: "MessageHeader" } }, { resource: { resourceType: "Organization", name: "Bupa Arabia" } }, { resource: { resourceType: "Task", ...extra } }] }),
});

const who = () => ({ id: "P9", name: "Salma Alghamdi", mrn: "MRN-9" });

describe("pairing requests with answers", () => {
  it("pairs each request with the answer after it, newest first", () => {
    const c: FinCase = {
      visit: "V9",
      messages: [
        msg(1, "eligibility-request", "out", "Is the patient covered?", "2026-11-10T08:00:00.000Z"),
        msg(2, "eligibility-response", "in", "Covered", "2026-11-10T08:00:01.500Z"),
        msg(3, "claim-request", "out", "Claim for 900 SAR", "2026-11-10T09:00:00.000Z"),
        msg(4, "communication-request", "in", "Payer asks", "2026-11-10T09:00:00.200Z"),
        msg(5, "communication", "out", "Answer sent", "2026-11-10T10:00:00.000Z"),
        msg(6, "claim-response", "in", "Approved", "2026-11-10T10:00:00.100Z"),
        msg(7, "cancel-request", "out", "Cancel the claim", "2026-11-10T11:00:00.000Z", { focus: "claim" }),
      ],
    };
    const list = buildTransactions([c], who);
    expect(list.map((t) => `${t.type}:${t.outcome.label}`)).toEqual(["cancel:Cancelled", "communication:Approved", "claim:Question From Payer", "eligibility:Covered"]);
    const el = list.at(-1)!;
    expect(el.responseMs).toBe(1500);
    expect(el.payer).toBe("Bupa Arabia");
    expect(el.patientName).toBe("Salma Alghamdi");
    expect(list[0].response).toBeUndefined();
    expect(list[0].focus).toBe("Claim");
    expect(list[0].id).toBe("V9-7");
  });

  it("makes a stable bundle id shaped like a UUID", () => {
    expect(bundleIdOf("V1", 3)).toBe(bundleIdOf("V1", 3));
    expect(bundleIdOf("V1", 3)).not.toBe(bundleIdOf("V1", 4));
    expect(bundleIdOf("V1", 3)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("shows the bundle id and timestamp in the formatted JSON", () => {
    const m = msg(1, "eligibility-request", "out", "x", "2026-11-10T08:00:00.000Z");
    const out = JSON.parse(formattedPayload(m, "abc"));
    expect(out).toMatchObject({ resourceType: "Bundle", id: "abc", timestamp: "2026-11-10T08:00:00.000Z", type: "message" });
  });

  it("words the response time", () => {
    expect(responseTimeText(undefined)).toBe("No Response");
    expect(responseTimeText(300)).toBe("Under 1 second");
    expect(responseTimeText(2400)).toBe("2.4 seconds");
    expect(responseTimeText(180_000)).toBe("3 minutes");
  });
});

describe("transaction log from NPHIES Financial", () => {
  let insured: string[] = [];
  beforeEach(() => {
    switchUser("U9");
    replaceState(seedState());
    const s = getState();
    replaceState({ ...s, patients: s.patients.map((p) => (p.id === "P001" ? p : { ...p, extra: { ...p.extra, visitPayType: "Insurance" as const, insurance: CARD } })) });
    resetFinancial();
    insured = getState().encounters.filter((e) => e.patientId !== "P001" && e.status !== "cancelled" && e.status !== "preadmit").map((e) => e.visitNumber);
  });

  it("lists every request sent, with its answer", () => {
    const [a, b] = insured;
    runFinancial(a, "eligibility");
    runFinancial(a, "authorization");
    setFinRejectNext(true);
    runFinancial(b, "eligibility");
    const list = allTransactions();
    expect(list).toHaveLength(3);
    expect(list.filter((t) => t.visit === a).map((t) => t.type).sort()).toEqual(["eligibility", "priorauth"]);
    expect(list.find((t) => t.visit === b)!.outcome.label).toBe("Not Covered");
    expect(list.every((t) => t.payer === "Tawuniya")).toBe(true);
    // Every request in the log is in the list once.
    const out = [a, b].flatMap((v) => caseOf(v).messages.filter((m) => m.direction === "out"));
    expect(out).toHaveLength(list.length);
  });

  it("filters by patient, type, outcome, payer, visit and date", () => {
    const [a, b] = insured;
    runFinancial(a, "eligibility");
    runFinancial(b, "eligibility");
    runFinancial(b, "authorization");
    const list = allTransactions();
    const f = EMPTY_TX_FILTER;
    expect(filterTransactions(list, f)).toHaveLength(3);
    expect(filterTransactions(list, { ...f, type: "priorauth" })).toHaveLength(1);
    expect(filterTransactions(list, { ...f, visit: a })).toHaveLength(1);
    expect(filterTransactions(list, { ...f, outcome: "Covered" })).toHaveLength(2);
    expect(filterTransactions(list, { ...f, payer: "Bupa Arabia" })).toHaveLength(0);
    const p = list.find((t) => t.visit === b)!;
    const byMrn = filterTransactions(list, { ...f, patient: p.mrn.toLowerCase() });
    expect(byMrn.length).toBeGreaterThan(0);
    expect(byMrn.every((t) => t.mrn === p.mrn)).toBe(true);
    expect(filterTransactions(list, { ...f, patient: p.bundleId })).toHaveLength(1);
    expect(filterTransactions(list, { ...f, from: "2999-01-01" })).toHaveLength(0);
    expect(filterTransactions(list, { ...f, to: "2000-01-01" })).toHaveLength(0);
  });

  it("gives the visit timeline oldest first and finds a transaction by id", () => {
    const [a] = insured;
    runFinancial(a, "eligibility");
    runFinancial(a, "authorization");
    const t = visitTimeline(a);
    expect(t.map((x) => x.type)).toEqual(["eligibility", "priorauth"]);
    expect(transactionById(t[1].id)?.type).toBe("priorauth");
    expect(transactionById("nope")).toBeUndefined();
  });
});
