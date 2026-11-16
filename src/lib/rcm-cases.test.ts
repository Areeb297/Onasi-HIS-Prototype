import { beforeEach, describe, expect, it } from "vitest";
import { claimFor } from "./claims";
import { invoiceOf, invoiceView, payerPaid, resetInvoices, ensureInvoice } from "./invoice";
import { caseOf, resetFinancial, runFinancial, setFinRejectNext } from "./nphies-financial";
import {
  AR_FLOW, DENIAL_FLOW, REJECTION_FLOW, addManualPayment, addNote, adjustToClaims, ageDays, ageingOf, allClaims, allNotices, appealDenial, arAction, arCases,
  assignFwa, bucketOf, canMove, correctRejection, daysAgo, decideWriteOff, denialCases, fillInOrder, fwaCases, generatePaymentNotice, getRcm, moveFwa,
  moveRejection, moveToPatient, noticeView, recordResponse, rejectionCases, requestWriteOff, resetRcm, resubmitRejection, saveImported, validateAllocation,
  validateArAction,
} from "./rcm-cases";
import { switchUser } from "./session";
import { getState, replaceState, seedState } from "./store";

const TODAY = new Date(2026, 10, 15);
const CARD = { payer: "Bupa Arabia", policyNo: "POL-48210", memberId: "MEM-7710021", className: "Class A", network: "Gold Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 10, status: "Active" as const };
const insure = (id: string) => {
  const s = getState();
  replaceState({ ...s, patients: s.patients.map((p) => (p.id === id ? { ...p, extra: { ...p.extra!, visitPayType: "Insurance" as const, insurance: CARD } } : p)) });
};
const LIVE = "V100004"; // outpatient visit of P004, 670 SAR

describe("rcm cases", () => {
  beforeEach(() => {
    switchUser("U9");
    replaceState(seedState());
    resetFinancial();
    resetInvoices();
    resetRcm(TODAY);
  });

  it("puts every seeded case in the right list with amounts from its own lines", () => {
    const rj = rejectionCases(getRcm(), allClaims(), TODAY);
    expect(rj.map((c) => c.claim.claimNumber).sort()).toEqual(["CL00004322", "CL00004341", "CL00004359", "CL00004377", "CL00004403"]);
    const c4403 = rj.find((c) => c.id === "RJ-CL00004403")!;
    expect(c4403.status).toBe("In Review");
    expect(c4403.claim.claimed).toBe(3200 + 320 + 85);
    expect(c4403.errors[0]).toMatchObject({ code: "BV-00045", field: "review" });
    expect(c4403.ageDays).toBe(9);

    const dn = denialCases(getRcm(), allClaims(), TODAY);
    const d4260 = dn.find((d) => d.id === "DN-CL00004260")!;
    expect(d4260.denied).toBe(720);
    expect(d4260.deniedLines.map((l) => l.reason)).toEqual(["CV-4-1"]);
    // The patient share is not a denial: 350 claimed, 315 approved, 35 co-pay.
    expect(d4260.claim.lines[0].denied).toBe(0);
    expect(dn.find((d) => d.id === "DN-CL00004210")!.claim.state).toBe("Denied");
  });

  it("derives a rejection case from a live claim the payer rejected, at the invoice amount", () => {
    insure("P004");
    runFinancial(LIVE, "eligibility");
    setFinRejectNext(true);
    runFinancial(LIVE, "claim");
    const c = rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === `RJ-${LIVE}`)!;
    expect(c.claim.live).toBe(true);
    expect(c.claim.claimed).toBe(claimFor(LIVE)!.net);
    expect(c.claim.claimed).toBe(670);
    expect(c.errors.length).toBeGreaterThan(0);
    expect(c.status).toBe("Open");
    // Sent again and approved through NPHIES Financial: the case shows as Resolved (HIS RESOLVED).
    runFinancial(LIVE, "claim");
    expect(rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === `RJ-${LIVE}`)).toBeUndefined();
    moveRejection({ ...c, status: "Open" }, "In Review", "Looking at it");
    expect(rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === `RJ-${LIVE}`)!.status).toBe("Resolved");
  });

  it("allows only the status moves in the flow", () => {
    expect(canMove(REJECTION_FLOW, "Open", "Resolved")).toBe(false);
    expect(canMove(REJECTION_FLOW, "In Review", "Resolved")).toBe(true);
    expect(canMove(DENIAL_FLOW, "Closed", "In Review")).toBe(false);
    expect(canMove(AR_FLOW, "Closed", "Open")).toBe(true);
    const c = rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "RJ-CL00004341")!;
    expect(resubmitRejection(c, "send").ok).toBe(false);
    expect(correctRejection(c, {}, "fixed").ok).toBe(false);
    expect(correctRejection(c, { "0": "Policy renewed; member number corrected" }, "Member number corrected").ok).toBe(true);
    const corrected = rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === c.id)!;
    expect(corrected.status).toBe("In Review");
    expect(corrected.errors[0].fixed).toMatch(/member number/);
    expect(resubmitRejection(corrected, "Sent again", TODAY).ok).toBe(true);
    expect(getRcm().claims.find((x) => x.claimNumber === "CL00004341")!.state).toBe("Submitted");
    expect(rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === c.id)!.status).toBe("Resolved");
    // The payer rejects it again: the case reopens.
    expect(recordResponse("CL00004341", { outcome: "Rejected", date: "2026-11-15", errors: [{ code: "BV-00112" }] }, TODAY).ok).toBe(true);
    expect(rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === c.id)!.status).toBe("Open");
  });

  it("needs the billing permission and writes the audit trail", () => {
    switchUser("U1");
    const c = rejectionCases(getRcm(), allClaims(), TODAY)[0];
    const r = addNote("rejections", c.id, { text: "Called the payer" });
    expect(r.ok).toBe(false);
    switchUser("U9");
    expect(addNote("rejections", c.id, { text: "Called", medium: "Phone" }).ok).toBe(false);
    expect(addNote("rejections", c.id, { text: "Called the payer desk", medium: "Phone", outcome: "No Response" }).ok).toBe(true);
    const after = rejectionCases(getRcm(), allClaims(), TODAY).find((x) => x.id === c.id)!;
    expect(after.notes.at(-1)).toMatchObject({ by: "System Administrator", medium: "Phone", outcome: "No Response" });
  });

  it("appeals denied lines as a linked claim and resolves the case on the payer's answer", () => {
    const d = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "DN-CL00004231")!;
    expect(appealDenial(d, { seqs: [], reason: "short", attachments: [] }).ok).toBe(false);
    const r = appealDenial(d, { seqs: [2], reason: "Authorization AUTH-2210 was approved before the scan.", attachments: ["Approval letter.pdf", " "] }, TODAY);
    expect(r).toMatchObject({ ok: true, id: "CL00004231-AP1" });
    const ap = getRcm().claims.find((x) => x.claimNumber === "CL00004231-AP1")!;
    expect(ap).toMatchObject({ appealOf: "CL00004231", state: "Submitted" });
    expect(ap.lines[0].claimed).toBe(1250);
    let now = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === d.id)!;
    expect(now.status).toBe("In Review");
    expect(now.appeal!.attachments).toEqual(["Approval letter.pdf"]);
    expect(appealDenial(now, { seqs: [2], reason: "Again with the same reason", attachments: [] }).ok).toBe(false);
    expect(recordResponse("CL00004231-AP1", { outcome: "Partly Approved", date: "2026-11-15", lines: [{ seq: 1, approved: 1000, reason: "SE-1-6" }] }, TODAY).ok).toBe(true);
    now = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === d.id)!;
    expect(now.status).toBe("Resolved");
    expect(now.recovered).toBe(1000);
    expect(now.open).toBe(250);
    // The appeal money is now owed by the payer.
    expect(arCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "AR-CL00004231-AP1")!.outstanding).toBe(1000);
  });

  it("writes off only after a second person approves", () => {
    switchUser("U7");
    const d = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "DN-CL00004260")!;
    expect(requestWriteOff(d, "Policy class does not cover it").ok).toBe(true);
    let now = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === d.id)!;
    expect(now.writeOff).toMatchObject({ status: "Pending", amount: 720 });
    expect(decideWriteOff(now, true, "ok").ok).toBe(false);
    switchUser("U9");
    expect(decideWriteOff(now, true, "Approved by the RCM manager").ok).toBe(true);
    now = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === d.id)!;
    expect(now.status).toBe("Closed");
    expect(now.open).toBe(0);
  });

  it("moves denied money to the patient as patient AR", () => {
    const d = denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "DN-CL00004210")!;
    expect(moveToPatient(d, "Patient agreed to pay").ok).toBe(true);
    expect(denialCases(getRcm(), allClaims(), TODAY).find((x) => x.id === d.id)!.status).toBe("Resolved");
    const ar = arCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "AR-PR-CL00004210")!;
    expect(ar).toMatchObject({ kind: "Patient", outstanding: 1070, payer: "Self Pay" });
  });

  it("puts AR cases into ageing buckets", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 120, 121, 400].map(bucketOf)).toEqual(["0-30", "0-30", "31-60", "31-60", "61-90", "61-90", "91-120", "91-120", "121+", "121+"]);
    expect(ageDays("2026-11-15", TODAY)).toBe(0);
    expect(ageDays("2026-10-16", TODAY)).toBe(30);
    expect(ageDays("2026-12-01", TODAY)).toBe(0);
    const ar = arCases(getRcm(), allClaims(), TODAY);
    const c3610 = ar.find((x) => x.id === "AR-CL00003610")!;
    expect(c3610).toMatchObject({ bucket: "121+", days: 136, priority: "High", level: 3, followUpOverdue: true });
    const rows = ageingOf(ar);
    expect(rows.map((r) => r.bucket)).toEqual(["0-30", "31-60", "61-90", "91-120", "121+"]);
    const total = ar.filter((c) => c.status !== "Closed").reduce((n, c) => n + c.outstanding, 0);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBeCloseTo(total, 2);
    expect(rows.find((r) => r.bucket === "121+")!.insurance).toBe(3100);
  });

  it("checks AR actions the way the HIS dialog does", () => {
    const c = arCases(getRcm(), allClaims(), TODAY).find((x) => x.id === "AR-CL00003975")!;
    expect(validateArAction(c, "follow-up", { notes: "x", date: "2026-11-01" }, TODAY)).toContain("Next follow-up date cannot be in the past.");
    expect(validateArAction(c, "promise", { notes: "x", date: "2026-11-20", amount: 99999 }, TODAY)[0]).toMatch(/cannot be more than/);
    expect(validateArAction(c, "in-review", { notes: " " }, TODAY)).toContain("Action notes are required.");
    expect(validateArAction(c, "reopen", { notes: "x" }, TODAY)[0]).toMatch(/cannot move to Open/);
    expect(arAction(c, "escalate", { notes: "Two calls unanswered", level: 2 }, TODAY).ok).toBe(true);
    expect(arAction(c, "follow-up", { notes: "Called the payer", date: "2026-11-20", stage: "Follow Up" }, TODAY).ok).toBe(true);
    const now = arCases(getRcm(), allClaims(), TODAY).find((x) => x.id === c.id)!;
    expect(now).toMatchObject({ status: "Follow Up", level: 2, nextFollowUp: "2026-11-20", stage: "Follow Up" });
    expect(now.history.at(-1)).toMatchObject({ action: "Record Follow-Up", from: "Open", to: "Follow Up" });
    expect(arAction(now, "close", { notes: "Paid" }, TODAY).ok).toBe(true);
    expect(arAction({ ...now, status: "Closed" }, "assign", { notes: "x", collector: "Amal Alharbi" }, TODAY).ok).toBe(false);
  });

  it("adjusts a payment across ledger claims with the remaining amount shown", () => {
    const claims = allClaims();
    const n = allNotices().find((x) => x.id === "RCN-2611-0101")!;
    const a4401 = claims.find((c) => c.key === "CL00004401")!;
    const a3975 = claims.find((c) => c.key === "CL00003975")!;
    expect(a4401.approved).toBe(468);
    expect(n.remaining).toBe(468 + 864);
    expect(n.status).toBe("Partly Adjusted");
    expect(validateAllocation(n, claims, { "CL00004401": 500 }).errors[0]).toMatch(/more than the 468.00 SAR/);
    expect(validateAllocation(n, claims, { "CL00004402": 100 }).errors[0]).toMatch(/belongs to Tawuniya/);
    expect(validateAllocation(n, claims, {}).errors).toEqual(["Enter an amount for at least one claim."]);
    const v = validateAllocation(n, claims, { "CL00004401": 468, "CL00003975": 400 });
    expect(v).toEqual({ errors: [], total: 868, remaining: 464 });
    expect(fillInOrder(n, claims)).toEqual({ "CL00003975": 864, "CL00004231": 315, "CL00004401": 153 });
    expect(generatePaymentNotice(n.id, "Paid").ok).toBe(false);
    expect(adjustToClaims(n.id, { "CL00004401": 468, "CL00003975": 400 }).ok).toBe(true);
    const after = allClaims();
    expect(after.find((c) => c.key === "CL00004401")).toMatchObject({ pay: "Paid", outstanding: 0 });
    expect(after.find((c) => c.key === "CL00003975")).toMatchObject({ pay: "Partly Paid", outstanding: 464, paid: 400 });
    expect(a3975.pay).toBe("Not Paid");
    expect(noticeView(getRcm().notices.find((x) => x.id === n.id)!).remaining).toBe(464);
    expect(adjustToClaims(n.id, { "CL00003975": 464 }).ok).toBe(true);
    expect(generatePaymentNotice(n.id, "Cleared").ok).toBe(true);
    expect(allNotices().find((x) => x.id === n.id)!.status).toBe("Notice Sent");
    expect(adjustToClaims(n.id, { "CL00004380": 1 }).ok).toBe(false);
  });

  it("pays a live claim through NPHIES Financial so the invoice insurance balance drops", () => {
    insure("P004");
    ensureInvoice(LIVE);
    runFinancial(LIVE, "eligibility");
    runFinancial(LIVE, "claim");
    const live = allClaims().find((c) => c.key === LIVE)!;
    expect(live).toMatchObject({ live: true, state: "Approved", approved: 603, outstanding: 603, pay: "Not Paid" });
    expect(arCases(getRcm(), allClaims(), TODAY).find((x) => x.id === `AR-${LIVE}`)!.outstanding).toBe(603);
    expect(invoiceView(invoiceOf(LIVE)!).totals.insuranceBalance).toBe(603);
    expect(addManualPayment({ method: "Bank Transfer", reference: "", date: "2026-11-15", payer: "Bupa Arabia", amount: 1000 }, TODAY).ok).toBe(false);
    const mp = addManualPayment({ method: "Bank Transfer", reference: "TRF-1", date: "2026-11-15", payer: "Bupa Arabia", amount: 1000 }, TODAY);
    expect(mp.ok).toBe(true);
    const id = (mp as { id: string }).id;
    expect(adjustToClaims(id, { [LIVE]: 300 }).ok).toBe(false);
    expect(adjustToClaims(id, { [LIVE]: 603 }).ok).toBe(true);
    expect(payerPaid(LIVE)).toBe(603);
    expect(invoiceView(invoiceOf(LIVE)!).totals.insuranceBalance).toBe(0);
    expect(allClaims().find((c) => c.key === LIVE)!.pay).toBe("Paid");
    expect(allNotices().find((x) => x.id === id)).toMatchObject({ remaining: 397, status: "Partly Adjusted" });
    expect(adjustToClaims(id, { "CL00004401": 397 }).ok).toBe(true);
    expect(generatePaymentNotice(id, "Paid").ok).toBe(true);
    expect(caseOf(LIVE).payment!.status).toBe("notice-sent");
  });

  it("assigns, reviews and closes an FWA flag with an outcome", () => {
    const f = fwaCases(getRcm(), allClaims(), TODAY, []).find((x) => x.id === "FWA-503")!;
    expect(f).toMatchObject({ status: "Open", claimNumber: "CL00004431", patientName: "Ibrahim Alghamdi" });
    expect(moveFwa(f, "In Review", "Start").ok).toBe(false);
    expect(assignFwa(f, "Hind Alotaibi", "Please check the operative note").ok).toBe(true);
    let now = fwaCases(getRcm(), allClaims(), TODAY, []).find((x) => x.id === f.id)!;
    expect(moveFwa(now, "In Review", "Starting the review").ok).toBe(true);
    now = fwaCases(getRcm(), allClaims(), TODAY, []).find((x) => x.id === f.id)!;
    expect(moveFwa(now, "Closed", "Done").ok).toBe(false);
    expect(moveFwa(now, "Closed", "Wound infection kept the patient in", "Cleared").ok).toBe(true);
    expect(fwaCases(getRcm(), allClaims(), TODAY, []).find((x) => x.id === f.id)).toMatchObject({ status: "Closed", outcome: "Cleared", reviewer: "Hind Alotaibi" });
  });

  it("records a manual payer answer and checks it adds up", () => {
    expect(recordResponse("CL00004436", { outcome: "Approved", date: "2026-11-16", lines: [] }, TODAY).ok).toBe(false);
    expect(recordResponse("CL00004436", { outcome: "Approved", date: "2026-11-15", lines: [{ seq: 1, approved: 300 }] }, TODAY)).toMatchObject({ ok: false });
    expect(recordResponse("CL00004436", { outcome: "Partly Approved", date: "2026-11-15", lines: [{ seq: 4, approved: 0, reason: "AD-1-4" }] }, TODAY).ok).toBe(true);
    const c = allClaims().find((x) => x.key === "CL00004436")!;
    expect(c).toMatchObject({ state: "Partly Approved", claimed: 740, approved: 540, denied: 200 });
    expect(denialCases(getRcm(), allClaims(), TODAY).some((d) => d.id === "DN-CL00004436")).toBe(true);
  });

  it("saves imported claims as new or updated ledger claims", () => {
    const base = { patientName: "Test Patient", mrn: "MRN-1", payer: "Bupa Arabia", type: "Professional", serviceDate: daysAgo(5, TODAY), diagnosis: "J06.9", serviceCode: "SBS-1", serviceText: "Consult", claimed: 350 };
    const r = saveImported("file.csv", [
      { claim: { ...base, claimNumber: "CLM-NEW-1", approved: 315, state: "Approved" }, update: false },
      { claim: { ...base, claimNumber: "CL00004436", state: "Submitted" }, update: true },
    ], 2, 4);
    expect(r.ok).toBe(true);
    const s = getRcm();
    expect(s.imports[0]).toMatchObject({ created: 1, updated: 1, invalid: 2, total: 4 });
    expect(allClaims().find((c) => c.key === "CLM-NEW-1")).toMatchObject({ approved: 315, outstanding: 315 });
    expect(s.claims.find((c) => c.claimNumber === "CL00004436")!.source).toBe("earlier");
  });
});
