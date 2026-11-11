import { beforeEach, describe, expect, it } from "vitest";
import { caseOf, estimateCharge, financialVisits, finActionFor, resetFinancial, runFinancial, setFinRejectNext, stepViews, getFinancial, type FinAction } from "./nphies-financial";
import { switchUser } from "./session";
import { getState } from "./store";

const visitOf = (cls: string) => financialVisits().find((v) => v.enc.cls === cls)!;
const press = (visit: string, step: "eligibility" | "authorization" | "claim" | "payment", secondary = false): boolean => {
  const v = financialVisits().find((x) => x.enc.visitNumber === visit)!;
  const view = stepViews(v.enc).find((s) => s.step === step)!;
  const a = finActionFor(view, secondary);
  return a ? runFinancial(visit, a as FinAction) : false;
};

describe("NPHIES financial workflow", () => {
  beforeEach(() => {
    switchUser("U9");
    resetFinancial();
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
    const v = financialVisits().filter((x) => x.enc.cls === "O" && x.charge.total <= 5000)[0];
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
    const v = financialVisits().filter((x) => x.enc.cls === "O" && x.charge.total <= 5000)[0];
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
    const v = financialVisits().find((x) => x.enc.cls === "I" && x.enc.status === "active");
    if (!v) return;
    press(v.enc.visitNumber, "eligibility");
    press(v.enc.visitNumber, "authorization");
    expect(stepViews(getState().encounters.find((e) => e.visitNumber === v.enc.visitNumber)!)[2].hint).toMatch(/discharge/i);
  });
});
