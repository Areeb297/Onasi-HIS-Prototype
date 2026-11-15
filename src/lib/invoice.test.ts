import { beforeEach, describe, expect, it } from "vitest";
import {
  allocatePayment, ensureInvoice, getInvoices, invoiceOf, invoiceView, linesFromCharge, refundOverpayment, resetInvoices, sendToZatca,
  setZatcaFailNext, statusOf, syncInvoices, takePayment, vatAppliesToPatientShare, worklist, zatcaClock, type Invoice,
} from "./invoice";
import { cancelLabOrder, placeLabOrder, resetLab } from "./lab";
import { AUTH_FROM, estimateCharge, resetFinancial, runFinancial } from "./nphies-financial";
import { switchUser } from "./session";
import { getState } from "./store";

const encOf = (pid: string) => getState().encounters.find((e) => e.patientId === pid && e.status !== "cancelled")!;
const SAUDI = "P004"; // outpatient, Saudi
const NON_SAUDI = "P007"; // outpatient, Egyptian
const view = (visit: string) => invoiceView(invoiceOf(visit)!);
const H = 3600_000;

describe("invoice", () => {
  beforeEach(() => {
    switchUser("U9");
    resetInvoices();
    resetFinancial();
    resetLab();
  });

  it("builds one invoice per visit from the NPHIES Financial charge, with a 10 percent patient share", () => {
    const e = encOf(SAUDI);
    const inv = ensureInvoice(e.visitNumber)!;
    const v = invoiceView(inv);
    const charge = estimateCharge(e);
    expect(v.totals.gross).toBe(charge.total);
    expect(v.lines.map((l) => l.gross)).toEqual(charge.lines.map((l) => l.amount));
    expect(v.lines[0]).toMatchObject({ key: "visit", units: 1, unitCost: 350 });
    expect(v.totals.patientAmount).toBeCloseTo(charge.total * 0.1, 2);
    expect(v.totals.insuranceAmount).toBeCloseTo(charge.total * 0.9, 2);
    expect(v.totals.tax).toBe(0);
    expect(v.totals.total).toBe(charge.total);
    expect(v.totals.patientBalance).toBe(v.totals.patientPayable);
    expect(v.status).toBe("Draft");
    expect(ensureInvoice(e.visitNumber)!.number).toBe(inv.number);
    expect(getInvoices().invoices.filter((i) => i.visit === e.visitNumber)).toHaveLength(1);
  });

  it("turns the charge into unit cost times units", () => {
    const lines = linesFromCharge({ total: 605, lines: [{ label: "Consultation", amount: 350 }, { label: "Laboratory (3 tests)", amount: 255 }] });
    expect(lines[1]).toMatchObject({ key: "lab", service: "Laboratory Test", unitCost: 85, units: 3 });
  });

  it("charges VAT on the patient share only for non-Saudi patients", () => {
    expect(vatAppliesToPatientShare({ nationality: "SAU" })).toBe(false);
    expect(vatAppliesToPatientShare({ nationality: "EGY" })).toBe(true);
    expect(vatAppliesToPatientShare({ nationality: "999" })).toBe(true);
    const e = encOf(NON_SAUDI);
    const v = invoiceView(ensureInvoice(e.visitNumber)!);
    expect(v.invoice.vat).toBe(true);
    for (const l of v.lines) {
      expect(l.patientTax).toBeCloseTo(l.patientAmount * 0.15, 2);
      expect(l.insuranceTax).toBe(0);
    }
    expect(v.totals.tax).toBe(v.totals.patientTax);
    expect(v.totals.total).toBeCloseTo(v.totals.gross + v.totals.patientTax, 2);
  });

  it("puts the whole amount on the patient for a cash visit", () => {
    const inv = ensureInvoice(encOf(SAUDI).visitNumber)!;
    const v = invoiceView({ ...inv, insurer: null }, 0);
    expect(v.totals.patientAmount).toBe(v.totals.gross);
    expect(v.totals.insurancePayable).toBe(0);
  });

  it("refuses an amount of zero or more than the balance", () => {
    const visit = encOf(SAUDI).visitNumber;
    ensureInvoice(visit);
    const bal = view(visit).totals.patientBalance;
    const over = takePayment(visit, { amount: bal + 1, method: "Cash" });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.join(" ")).toMatch(/more than the balance/);
    expect(takePayment(visit, { amount: 0, method: "Cash" }).ok).toBe(false);
    expect(takePayment(visit, { amount: -5, method: "Card" }).ok).toBe(false);
    expect(view(visit).invoice.transactions).toHaveLength(0);
    expect(takePayment(visit, { amount: bal, method: "Card", reference: "POS-1182" }).ok).toBe(true);
    expect(view(visit).totals.patientBalance).toBe(0);
    expect(takePayment(visit, { amount: 1, method: "Cash" }).ok).toBe(false);
  });

  it("drops the reference and proof for cash", () => {
    const visit = encOf(SAUDI).visitNumber;
    ensureInvoice(visit);
    const r = takePayment(visit, { amount: 10, method: "Cash", reference: "X", proofName: "slip.png" });
    expect(r.ok && r.value.reference === undefined && r.value.proofName === undefined).toBe(true);
  });

  it("a payment waiver writes off the patient balance without taking money", () => {
    const visit = encOf(NON_SAUDI).visitNumber;
    ensureInvoice(visit);
    const due = view(visit).totals.patientBalance;
    expect(takePayment(visit, { amount: 0, method: "Cash", waiverType: "Not A Type" }).ok).toBe(false);
    const r = takePayment(visit, { amount: 0, method: "Cash", waiverType: "Charity Case" });
    expect(r.ok).toBe(true);
    const v = view(visit);
    expect(v.invoice.transactions[0]).toMatchObject({ kind: "waiver", amount: due, waiverType: "Charity Case" });
    expect(v.totals.patientBalance).toBe(0);
    expect(v.totals.waived).toBe(due);
    expect(v.totals.patientPaid).toBe(0);
    expect(v.lines.every((l) => l.patientBalance === 0)).toBe(true);
  });

  it("needs the billing permission", () => {
    const visit = encOf(SAUDI).visitNumber;
    ensureInvoice(visit);
    switchUser("U1"); // physician
    expect(takePayment(visit, { amount: 10, method: "Cash" }).ok).toBe(false);
    expect(sendToZatca([visit]).ok).toBe(false);
    switchUser("U9");
    expect(view(visit).invoice.transactions).toHaveLength(0);
  });

  it("frees money when a paid order is cancelled, then lets it be allocated to another line or refunded", () => {
    const e = encOf(NON_SAUDI);
    const visit = e.visitNumber;
    const a = placeLabOrder(e, { codes: ["2345-7"], priority: "routine", fasting: null, note: "" })!;
    placeLabOrder(e, { codes: ["4548-4"], priority: "routine", fasting: null, note: "" });
    ensureInvoice(visit);
    const labBefore = view(visit).lines.find((l) => l.key === "lab")!;
    expect(takePayment(visit, { amount: view(visit).totals.patientBalance, method: "Card" }).ok).toBe(true);
    const txId = view(visit).invoice.transactions[0].id;

    cancelLabOrder(a.id);
    ensureInvoice(visit); // Draft: the lines follow the visit
    let v = view(visit);
    const labAfter = v.lines.find((l) => l.key === "lab")!;
    expect(labAfter.units).toBe(labBefore.units - 1);
    const freed = +(labBefore.patientPayable - labAfter.patientPayable).toFixed(2);
    expect(v.unallocated[txId]).toBeCloseTo(freed, 2);
    expect(v.overpaid).toBeCloseTo(freed, 2);

    // A new order: the lab line has a balance again, and the free money can go on it.
    placeLabOrder(e, { codes: ["58410-2"], priority: "routine", fasting: null, note: "" });
    ensureInvoice(visit);
    v = view(visit);
    const lab = v.lines.find((l) => l.key === "lab")!;
    expect(lab.patientBalance).toBeCloseTo(freed, 2);
    expect(allocatePayment(visit, txId, { lab: lab.patientBalance + 5 }).ok).toBe(false);
    expect(allocatePayment(visit, txId, { visit: 1 }).ok).toBe(false); // paid line
    expect(allocatePayment(visit, txId, { lab: lab.patientBalance }).ok).toBe(true);
    v = view(visit);
    expect(v.unallocated[txId]).toBeUndefined();
    expect(v.lines.find((l) => l.key === "lab")!.patientBalance).toBe(0);
  });

  it("refunds an overpayment and brings the balance to zero", () => {
    const e = encOf(NON_SAUDI);
    const visit = e.visitNumber;
    const a = placeLabOrder(e, { codes: ["2345-7"], priority: "routine", fasting: null, note: "" })!;
    ensureInvoice(visit);
    expect(refundOverpayment(visit, { method: "Cash" }).ok).toBe(false); // nothing overpaid
    takePayment(visit, { amount: view(visit).totals.patientBalance, method: "Cash" });
    cancelLabOrder(a.id);
    ensureInvoice(visit);
    const over = view(visit).overpaid;
    expect(over).toBeGreaterThan(0);
    const r = refundOverpayment(visit, { method: "Bank Transfer", reference: "IBAN SA03 8000" });
    expect(r.ok).toBe(true);
    const v = view(visit);
    expect(v.totals.patientBalance).toBe(0);
    expect(v.totals.refunded).toBe(over);
    expect(Object.keys(v.unallocated)).toHaveLength(0);
  });

  it("closes only when both the patient and the insurance balance are zero", () => {
    expect(statusOf({ lines: [{} as never] }, 0, 0)).toBe("Closed");
    expect(statusOf({ lines: [{} as never] }, 0, 120)).toBe("Draft");
    expect(statusOf({ lines: [{} as never], finalizedAt: "2026-11-15T10:00:00Z" }, 15, 0)).toBe("Submitted");

    const e = encOf(SAUDI);
    const visit = e.visitNumber;
    ensureInvoice(visit);
    takePayment(visit, { amount: view(visit).totals.patientBalance, method: "Cash" });
    expect(view(visit).status).toBe("Draft"); // the payer has not paid yet
    expect(view(visit).totals.insuranceBalance).toBeGreaterThan(0);

    // The payer pays through NPHIES Financial.
    runFinancial(visit, "eligibility");
    if (estimateCharge(e).total >= AUTH_FROM) runFinancial(visit, "authorization");
    runFinancial(visit, "claim");
    runFinancial(visit, "poll-payment");
    const v = view(visit);
    expect(v.totals.insuranceBalance).toBe(0);
    expect(v.status).toBe("Closed");
  });

  it("is Submitted once the visit is finished", () => {
    const visit = encOf("P009").visitNumber; // discharged outpatient
    ensureInvoice(visit);
    expect(view(visit).invoice.finalizedAt).toBeTruthy();
    expect(view(visit).status).toBe("Submitted");
  });

  it("reports to ZATCA with the first payment, and counts down 24 hours otherwise", () => {
    const t0 = Date.parse("2026-11-15T08:00:00Z");
    const visit = encOf(SAUDI).visitNumber;
    const inv = ensureInvoice(visit, t0)!;
    expect(zatcaClock(inv, t0 + 2 * H).text).toBe("22 hours left to report");
    expect(zatcaClock(inv, t0 + 25 * H)).toMatchObject({ overdue: true, text: "Overdue by 1 hour" });
    takePayment(visit, { amount: 5, method: "Cash" }, t0 + H);
    expect(invoiceOf(visit)!.zatca).toMatchObject({ status: "Reported", auto: true });
    takePayment(visit, { amount: 5, method: "Cash" }, t0 + 2 * H);
    expect(invoiceOf(visit)!.zatca.attempts).toBe(1);
  });

  it("sends to ZATCA by hand and in bulk, with a failure that can be sent again", () => {
    const a = encOf(SAUDI).visitNumber;
    const b = encOf(NON_SAUDI).visitNumber;
    ensureInvoice(a);
    ensureInvoice(b);
    setZatcaFailNext(true);
    const first = sendToZatca([a]);
    expect(first.ok && first.value.failed).toBe(1);
    expect(invoiceOf(a)!.zatca.status).toBe("Failed");
    const bulk = sendToZatca([a, b]);
    expect(bulk.ok && bulk.value.reported).toBe(2);
    expect(invoiceOf(a)!.zatca.uuid).toBeTruthy();
  });

  it("goes back to Pending when a reported draft changes", () => {
    const e = encOf(NON_SAUDI);
    ensureInvoice(e.visitNumber);
    sendToZatca([e.visitNumber]);
    placeLabOrder(e, { codes: ["2345-7"], priority: "routine", fasting: null, note: "" });
    ensureInvoice(e.visitNumber);
    expect(invoiceOf(e.visitNumber)!.zatca.status).toBe("Pending");
  });

  it("filters the worklist by patient, number and date", () => {
    syncInvoices();
    const all = worklist();
    expect(all.length).toBeGreaterThan(3);
    const inv: Invoice = invoiceOf(encOf(NON_SAUDI).visitNumber)!;
    expect(worklist({ number: String(inv.number) }).map((r) => r.view.invoice.number)).toContain(inv.number);
    expect(worklist({ patient: "almalki" }).every((r) => r.patient?.family === "Almalki")).toBe(true);
    expect(worklist({ from: "2999-01-01" })).toHaveLength(0);
  });
});
