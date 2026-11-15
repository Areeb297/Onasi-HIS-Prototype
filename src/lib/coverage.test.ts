import { describe, expect, it } from "vitest";
import {
  answerFor, coverageCard, coverageFromCard, coverageProblems, coveragesOf, eligibilityProblems, initialCoverages, latestEligibility,
  markCoverageInactive, primaryCoverage, registrationCard, requestEligibility, resetCoverages, saveCoverage, type Coverage, type CoverageInput,
  type EligibilityRequest,
} from "./coverage";
import { coverageOutcome } from "./registration";
import { retrieveInsurance } from "./registry";
import { seedState } from "./store";

const today = "2026-11-14";
const bupa = retrieveInsurance("1000000011")!;
const base = (over: Partial<Coverage> = {}): Coverage => ({ ...coverageFromCard(bupa, "P001"), ...over });
const input = (over: Partial<CoverageInput> = {}): CoverageInput => ({
  priority: 2, payerType: "Insurance", insurer: "Tawuniya", tpa: "None", plan: "Class B", memberId: "MEM-1", policyNo: "POL-1", network: "Silver Network",
  relationship: "Self", subscriberId: "", copayPercent: 20, coinsurancePercent: 0, startDate: "2026-01-01", endDate: "2026-12-31",
  offlineApproval: false, approvalNo: "", ...over,
});
const req = (over: Partial<EligibilityRequest> = {}): EligibilityRequest => ({
  coverageId: "P001-C1", requestType: "Validation", payer: "", priority: "Normal", serviceStart: today, serviceEnd: today, transfer: false, newborn: false, ...over,
});

describe("coverages", () => {
  it("starts each patient from the insurance card the registration check finds", () => {
    const patients = seedState().patients;
    const saad = initialCoverages(patients.find((p) => p.id === "P001"));
    expect(saad).toHaveLength(1);
    expect(saad[0]).toMatchObject({ priority: 1, insurer: "Bupa Arabia", memberId: bupa.memberId, active: true });
    expect(initialCoverages(patients.find((p) => p.id === "P010"))).toEqual([]);
  });

  it("picks the primary coverage by priority, skipping inactive and out of date ones", () => {
    const one = base({ id: "a", priority: 1 });
    const two = base({ id: "b", priority: 2, insurer: "Tawuniya" });
    expect(primaryCoverage([two, one], today)?.id).toBe("a");
    expect(primaryCoverage([{ ...one, active: false }, two], today)?.id).toBe("b");
    expect(primaryCoverage([{ ...one, endDate: "2026-06-30" }, two], today)?.id).toBe("b");
    // Nothing in date: the lowest priority active one, so the check can say it ended.
    expect(primaryCoverage([{ ...one, endDate: "2026-06-30" }], today)?.id).toBe("a");
    expect(primaryCoverage([{ ...one, active: false }], today)).toBeUndefined();
  });

  it("checks the primary coverage with the same rules as registration", () => {
    expect(coverageOutcome(coverageCard(base(), today), today).kind).toBe("covered");
    expect(coverageOutcome(coverageCard(base({ endDate: "2026-06-30" }), today), today).kind).toBe("not-active");
    expect(coverageOutcome(coverageCard(base({ answer: "Out Of Network" }), today), today).kind).toBe("out-of-network");
  });

  it("does not allow two active coverages with the same priority", () => {
    expect(coverageProblems(input({ priority: 1 }), [base()])).toContain("Another active coverage already has priority 1.");
    expect(coverageProblems(input({ priority: 1 }), [base({ active: false })])).toEqual([]);
    expect(coverageProblems(input({ priority: 0 }), [])).toContain("Coverage priority is a whole number from 1.");
  });

  it("checks the other coverage fields", () => {
    expect(coverageProblems(input(), [])).toEqual([]);
    expect(coverageProblems(input({ memberId: " ", insurer: "" }), [])).toEqual(["Pick the insurance company.", "Enter the member number."]);
    expect(coverageProblems(input({ relationship: "Child", subscriberId: "12" }), [])).toEqual(["Enter the subscriber's 10 digit national ID."]);
    expect(coverageProblems(input({ copayPercent: 120 }), [])).toEqual(["Co-pay is a percent from 0 to 100."]);
    expect(coverageProblems(input({ endDate: "2025-01-01" }), [])).toEqual(["The end date cannot be before the start date."]);
    expect(coverageProblems(input({ offlineApproval: true }), [])).toEqual(["Enter the approval number for the offline approval."]);
  });

  it("uses the primary active coverage of a patient on file for the registration check", () => {
    resetCoverages();
    const patients = seedState().patients;
    // Saad (P001) is on file: the check reads his coverages, which start from his card.
    expect(registrationCard({ idNumber: "1000000011" }, today, patients)?.payer).toBe("Bupa Arabia");
    // A second coverage with priority 1 after the first is marked inactive becomes the primary.
    markCoverageInactive("P001", "P001-C1");
    const added = saveCoverage("P001", input({ priority: 1, insurer: "Tawuniya", memberId: "MEM-T1" }));
    expect(added.ok).toBe(true);
    expect(registrationCard({ idNumber: "1000000011" }, today, patients)?.payer).toBe("Tawuniya");
    // No active coverage left: no insurance.
    markCoverageInactive("P001", added.ok ? added.value.id : "");
    expect(registrationCard({ idNumber: "1000000011" }, today, patients)).toBeNull();
    // Someone new to the hospital: the registry card.
    expect(registrationCard({ idNumber: "1000000201" }, today, patients)?.coverage).toBe("Out Of Network");
    resetCoverages();
  });
});

describe("eligibility request", () => {
  it("needs a coverage, except for a discovery request that names the payer", () => {
    expect(eligibilityProblems(req())).toEqual([]);
    expect(eligibilityProblems(req({ coverageId: "" }))).toEqual(["Pick the coverage to check."]);
    expect(eligibilityProblems(req({ coverageId: "", requestType: "Discovery" }))).toEqual(["Pick the payer to ask."]);
    expect(eligibilityProblems(req({ serviceEnd: "2026-11-01" }))).toEqual(["The service end date cannot be before the start date."]);
  });

  it("answers like the registration check", () => {
    expect(answerFor(bupa, req(), "t", "x")).toMatchObject({ eligible: true, kind: "covered" });
    expect(answerFor(retrieveInsurance("1000000029"), req(), "t", "x")).toMatchObject({ eligible: false, kind: "not-active" });
    expect(answerFor(retrieveInsurance("1000000219"), req(), "t", "x")).toMatchObject({ eligible: true, kind: "limit-exhausted" });
    expect(answerFor(null, req(), "t", "x")).toMatchObject({ eligible: false, kind: "no-insurance" });
  });

  it("saves the answer on the coverage with its date and shows the newest one", () => {
    resetCoverages();
    const now = new Date("2026-11-14T09:30:00.000Z");
    const r = requestEligibility("P001", req(), "Registration Clerk", now);
    expect(r.ok).toBe(true);
    const saved = coveragesOf("P001", undefined, seedState().patients).find((c) => c.id === "P001-C1")!;
    expect(saved.eligibility).toMatchObject({ eligible: true, at: "2026-11-14T09:30:00.000Z", by: "Registration Clerk", requestType: "Validation" });
    expect(latestEligibility(coveragesOf("P001", undefined, seedState().patients))?.at).toBe("2026-11-14T09:30:00.000Z");
    resetCoverages();
  });

  it("adds the coverage a discovery request finds with the named payer", () => {
    resetCoverages();
    const r = requestEligibility("P001", req({ coverageId: "", requestType: "Discovery", payer: "Bupa Arabia" }), "Clerk");
    expect(r.ok && r.value.coverage).toMatchObject({ insurer: "Bupa Arabia", priority: 2 });
    const none = requestEligibility("P001", req({ coverageId: "", requestType: "Discovery", payer: "Walaa" }), "Clerk");
    expect(none.ok && none.value.answer.kind).toBe("no-insurance");
    expect(none.ok && none.value.coverage).toBeUndefined();
    resetCoverages();
  });
});
