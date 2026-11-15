import { beforeEach, describe, expect, it } from "vitest";
import { billingRows, claimFor, getClaims, resetClaims, seedDemoClaims } from "./claims";
import { resetInvoices } from "./invoice";
import { getFinancial, resetFinancial } from "./nphies-financial";
import { allTransactions } from "./rcm-transactions";
import { DEMO_PATIENTS, DEMO_VISITS } from "./rcm-demo";
import { switchUser } from "./session";
import { getState, replaceState, seedState } from "./store";

const NOW = new Date();

describe("demo claims for the RCM screens", () => {
  beforeEach(() => {
    switchUser("U9");
    replaceState(seedState());
    resetFinancial();
    resetInvoices();
    resetClaims();
  });

  it("adds insured sample patients and past visits from June to November", () => {
    const his = getState();
    for (const p of DEMO_PATIENTS) expect(his.patients.find((x) => x.id === p.id)?.extra?.insurance?.payer).toBeTruthy();
    const payers = new Set(billingRows().map((r) => r.payer));
    for (const p of ["Bupa Arabia", "Tawuniya", "MedGulf", "Al Rajhi Takaful", "Malath"]) expect(payers.has(p)).toBe(true);
    const days = his.encounters.filter((e) => DEMO_VISITS.some((v) => v.pid === e.patientId && v.reason === e.reason)).map((e) => e.admitAt!.slice(0, 10));
    expect(days.length).toBe(DEMO_VISITS.length);
    const oldest = new Date(NOW.getTime() - 170 * 86_400_000).toISOString().slice(0, 10);
    expect(days.every((d) => d >= oldest)).toBe(true);
  });

  it("gives every demo visit a claim history once, in every HIS status", () => {
    const n = seedDemoClaims(NOW);
    expect(n).toBeGreaterThanOrEqual(25);
    expect(seedDemoClaims(NOW)).toBe(0);
    const labels = new Set(billingRows(getFinancial(), NOW).map((r) => r.status.label));
    for (const l of ["Drafted", "Reviewed", "PreAuth Pended", "PreAuth Approved", "PreAuth Rejected", "Claim Submitted", "Claim Pended", "Claim Approved",
      "Claim Partially Approved", "Claim Rejected", "Paid", "Partially Paid"]) expect(labels, l).toContain(l);
  });

  it("keeps amounts consistent with the invoice and NPHIES Financial", () => {
    seedDemoClaims(NOW);
    for (const c of getFinancial().cases) {
      const m = claimFor(c.visit, NOW)!;
      const sent = c.messages.find((x) => x.kind === "claim-request");
      if (sent) expect(JSON.parse(sent.json).entry[3].resource.total.value).toBe(m.net);
      if (c.claim?.approved !== undefined) {
        expect(c.claim.approved).toBeLessThanOrEqual(m.totals.insuranceAmount + 0.001);
        const lines = m.answer?.lines ?? [];
        expect(Math.round(lines.reduce((s, l) => s + l.approved, 0) * 100) / 100).toBe(c.claim.approved);
      }
      if (c.payment) {
        expect(c.payment.amount).toBeLessThanOrEqual(c.claim!.approved! + 0.001);
        expect(c.payment.batch).toMatch(/^PRC-2026-\d{5}$/);
        expect(m.totals.insurancePaid).toBe(c.payment.amount);
      }
    }
  });

  it("rejections carry NPHIES error codes and partial approvals carry denied lines with reasons", () => {
    seedDemoClaims(NOW);
    const rows = billingRows(getFinancial(), NOW);
    const rejected = rows.filter((r) => r.status.label === "Claim Rejected");
    expect(rejected.length).toBeGreaterThan(0);
    for (const r of rejected) expect(r.m.answer?.errors.every((e) => /^BV-\d{5}$/.test(e.code))).toBe(true);
    const partial = rows.filter((r) => r.status.label === "Claim Partially Approved");
    expect(partial.length).toBeGreaterThan(0);
    for (const r of partial) {
      const denied = r.m.answer!.lines.filter((l) => l.denied > 0);
      expect(denied.length).toBeGreaterThan(0);
      expect(denied.every((l) => !!l.reason && !!l.reasonText)).toBe(true);
    }
    // A claim with no diagnosis is rejected for it.
    expect(rejected.some((r) => r.m.dx.length === 0 && r.m.answer?.errors.some((e) => e.code === "BV-00027"))).toBe(true);
  });

  it("claim numbers follow the HIS shape and the drafts record who saved, reviewed and sent", () => {
    seedDemoClaims(NOW);
    const numbers = getFinancial().cases.flatMap((c) => (c.claim ? [c.claim.claimNumber] : []));
    expect(numbers.every((x) => /^CL\d{8}$/.test(x))).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
    const sentDrafts = getClaims().drafts.filter((d) => d.sends?.some((s) => s.use === "claim"));
    expect(sentDrafts.length).toBe(numbers.length);
    expect(sentDrafts.every((d) => d.reviewedAt && d.savedAt)).toBe(true);
  });

  it("every request shows on Submitted Transactions, in time order per visit", () => {
    seedDemoClaims(NOW);
    const tx = allTransactions();
    const out = getFinancial().cases.flatMap((c) => c.messages.filter((m) => m.direction === "out"));
    expect(tx.length).toBe(out.length);
    expect(tx.some((t) => t.type === "payment-notice")).toBe(true);
    for (const c of getFinancial().cases) {
      const at = c.messages.map((m) => m.at);
      expect(at).toEqual([...at].sort());
      expect(c.messages.every((m) => m.at <= NOW.toISOString())).toBe(true);
    }
  });
  it("rows carry real tests, exams and medicines: several with 5 to 7 items, one Pharmacy claim, some with no diagnosis", () => {
    seedDemoClaims(NOW);
    const rows = billingRows(getFinancial(), NOW);
    const big = rows.filter((r) => r.items.total >= 5 && r.items.total <= 7);
    expect(big.length).toBeGreaterThanOrEqual(4);
    expect(rows.some((r) => r.items.chips.lab > 0 && r.items.chips.rad > 0 && r.items.chips.rx > 0)).toBe(true);
    expect(rows.some((r) => r.m.type === "pharmacy" && r.items.chips.rx >= 3)).toBe(true);
    const noDx = rows.filter((r) => r.m.dx.length === 0);
    expect(noDx.length).toBeGreaterThan(0);
    expect(noDx.every((r) => r.findings.some((f) => f.rule === "no-principal-dx" && f.severity === "hard"))).toBe(true);
    // A claim already with the payer had its prior authorization approved when it needed one.
    for (const r of rows.filter((x) => x.m.fin.claim)) expect(r.findings.some((f) => f.rule === "auth-not-approved"), r.visit).toBe(false);
    // Lines from orders link to the visit's principal diagnosis.
    const paid = rows.find((r) => r.status.label === "Paid" && r.items.total >= 5)!;
    expect(paid.m.lines.filter((l) => l.kind !== "visit").every((l) => l.dxSeqs.length > 0)).toBe(true);
  });
});
