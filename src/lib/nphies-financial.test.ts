import { beforeEach, describe, expect, it } from "vitest";
import { coverageView } from "./chart-entries";
import { ensureInvoice, invoiceView, resetInvoices } from "./invoice";
import {
  caseOf, CASH_REASON, estimateCharge, financialVisits, finActionFor, insuredPayer, payerOf, payerShareOf, resetFinancial, runFinancial, setFinRejectNext, stepViews,
  getFinancial, type FinAction,
} from "./nphies-financial";
import { switchUser } from "./session";
import { getState, replaceState, seedState } from "./store";

const CASH_PATIENT = "P001"; // keeps no insurance card: a cash patient
const CO_PAY_20 = "P007"; // outpatient with a 20 percent co-pay
const card = (copayPercent: number) => ({ payer: "Bupa Arabia", policyNo: "POL-48210", memberId: "MEM-7710021", className: "Class A", network: "Gold Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent, status: "Active" as const });
/** Puts an insurance card on every seed patient but one, as registration does after the coverage check. */
const insure = () => {
  const s = getState();
  replaceState({ ...s, patients: s.patients.map((p) => (p.id === CASH_PATIENT ? p : { ...p, extra: { ...p.extra, visitPayType: "Insurance" as const, insurance: card(p.id === CO_PAY_20 ? 20 : 10) } })) });
};
const patient = (id: string) => getState().patients.find((p) => p.id === id)!;
const visitOf = (cls: string) => financialVisits().find((v) => v.enc.cls === cls && !v.cash)!;
const press = (visit: string, step: "eligibility" | "authorization" | "claim" | "payment", secondary = false): boolean => {
  const v = financialVisits().find((x) => x.enc.visitNumber === visit)!;
  const view = stepViews(v.enc).find((s) => s.step === step)!;
  const a = finActionFor(view, secondary);
  return a ? runFinancial(visit, a as FinAction) : false;
};

describe("NPHIES financial workflow", () => {
  beforeEach(() => {
    switchUser("U9");
    replaceState(seedState());
    insure();
    resetFinancial();
    resetInvoices();
  });

  it("takes the payer from the patient's insurance card, as the chart header does", () => {
    expect(insuredPayer(patient("P004"))).toBe("Bupa Arabia");
    expect(payerOf(patient("P004"))).toBe(coverageView(patient("P004"), "2026-11-15").payer);
    expect(insuredPayer(patient(CASH_PATIENT))).toBeNull();
    expect(payerOf(patient(CASH_PATIENT))).toBe("Cash");
    expect(insuredPayer({ extra: { ...patient("P004").extra!, visitPayType: "Cash" } })).toBeNull();
    for (const v of financialVisits()) expect(v.payer).toBe(coverageView(v.patient, "2026-11-15").payer);
  });

  it("takes the payer share from the co-pay on the card", () => {
    expect(payerShareOf(patient("P004"))).toBeCloseTo(0.9);
    expect(payerShareOf(patient(CO_PAY_20))).toBeCloseTo(0.8);
    expect(payerShareOf(patient(CASH_PATIENT))).toBe(0);
    expect(payerShareOf({ extra: { ...patient("P004").extra!, insurance: card(0) } })).toBe(1);
  });

  it("lists a cash visit but sends nothing for it", () => {
    const v = financialVisits().find((x) => x.patient.id === CASH_PATIENT)!;
    expect(v).toMatchObject({ cash: true, payer: "Cash", authNeeded: false });
    const views = stepViews(v.enc);
    expect(views.every((s) => s.status === "Not Needed" && s.action === null && s.secondary === null)).toBe(true);
    expect(views[0].hint).toBe(CASH_REASON);
    for (const a of ["eligibility", "authorization", "claim", "poll-payment"] as FinAction[]) expect(runFinancial(v.enc.visitNumber, a)).toBe(false);
    expect(caseOf(v.enc.visitNumber).messages).toEqual([]);
  });

  it("approves and pays the same amount as the insurance share on the invoice", () => {
    for (const id of ["P004", CO_PAY_20]) {
      const v = financialVisits().find((x) => x.patient.id === id && x.enc.cls === "O")!;
      const visit = v.enc.visitNumber;
      press(visit, "eligibility");
      if (v.authNeeded) press(visit, "authorization");
      press(visit, "claim");
      const share = payerShareOf(v.patient);
      expect(caseOf(visit).claim?.approved).toBeCloseTo(v.charge.total * share, 2);
      press(visit, "payment");
      const inv = invoiceView(ensureInvoice(visit)!);
      expect(inv.invoice.insurer).toBe(v.payer);
      expect(inv.totals.insurancePayable).toBeCloseTo(v.charge.total * share, 2);
      expect(inv.totals.patientAmount).toBeCloseTo(v.charge.total * (1 - share), 2);
      expect(inv.totals.insuranceBalance).toBe(0);
    }
  });

  it("lists visits with a payer and an estimated charge", () => {
    const vs = financialVisits();
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      expect(v.payer).not.toBe("");
      expect(v.charge.total).toBeGreaterThan(0);
    }
    expect(estimateCharge(vs[0].enc).total).toBe(vs[0].charge.total);
  });

  it("only offers eligibility at the start, then unlocks the next step", () => {
    const v = visitOf("O");
    let views = stepViews(v.enc);
    expect(views[0].action).toBe("Check Eligibility");
    expect(views[2].action).toBeNull(); // claim waits for eligibility
    expect(press(v.enc.visitNumber, "eligibility")).toBe(true);
    views = stepViews(v.enc);
    expect(views[0].status).toBe("Eligible");
    expect(caseOf(v.enc.visitNumber).messages.map((m) => m.kind)).toEqual(["eligibility-request", "eligibility-response"]);
  });

  it("runs a small outpatient visit to a reconciled payment", () => {
    const v = financialVisits().filter((x) => !x.cash && x.enc.cls === "O" && x.charge.total <= 5000)[0];
    const id = v.enc.visitNumber;
    press(id, "eligibility");
    if (v.authNeeded) press(id, "authorization");
    press(id, "claim");
    expect(stepViews(v.enc)[2].status).toBe("Approved");
    press(id, "payment"); // poll for payment advice
    expect(stepViews(v.enc)[3].status).toBe("Payment Advice Received");
    press(id, "payment"); // confirm money received
    expect(stepViews(v.enc)[3].status).toBe("Reconciled");
    expect(caseOf(id).messages.at(-1)?.kind).toBe("payment-notice");
  });

  it("a refusal switch makes the next payer answer a refusal, once", () => {
    const v = visitOf("O");
    setFinRejectNext(true);
    press(v.enc.visitNumber, "eligibility");
    expect(stepViews(v.enc)[0].status).toBe("Not Eligible");
    expect(getFinancial().rejectNext).toBe(false);
    expect(stepViews(v.enc)[0].action).toBe("Check Again");
  });

  it("cancels a claim and allows a new one", () => {
    const v = financialVisits().filter((x) => !x.cash && x.enc.cls === "O" && x.charge.total <= 5000)[0];
    const id = v.enc.visitNumber;
    press(id, "eligibility");
    if (v.authNeeded) press(id, "authorization");
    press(id, "claim");
    expect(press(id, "claim", true)).toBe(true);
    const claim = stepViews(v.enc)[2];
    expect(claim.status).toBe("Cancelled");
    expect(claim.action).toBe("Resubmit Claim");
  });

  it("is blocked without the billing permission", () => {
    switchUser("U1"); // physician
    const v = visitOf("O");
    expect(runFinancial(v.enc.visitNumber, "eligibility")).toBe(false);
    expect(caseOf(v.enc.visitNumber).messages).toEqual([]);
    switchUser("U9");
  });

  it("waits for discharge before an inpatient claim", () => {
    const v = financialVisits().find((x) => !x.cash && x.enc.cls === "I" && x.enc.status === "active");
    if (!v) return;
    press(v.enc.visitNumber, "eligibility");
    press(v.enc.visitNumber, "authorization");
    expect(stepViews(getState().encounters.find((e) => e.visitNumber === v.enc.visitNumber)!)[2].hint).toMatch(/discharge/i);
  });
});
