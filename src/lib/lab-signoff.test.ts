import { beforeEach, describe, expect, it } from "vitest";
import { LAB_CATALOG, catalogRangeProblems, critTextFor, interpretValue, rangeProblems, testByCode, type LabTest } from "./fhir/lab-catalog";
import type { LabOrder } from "./fhir/types";
import {
  awaitingVerification, cancelLabResult, collectSpecimens, criticalCallProblems, fillSampleResults, getOrder, labResultSendBlock, openLabDuplicates,
  placeLabOrder, previousResult, publishLabResult, releaseLabResult, resetLab, resultDelta, saveLabResult, sendBackLabResult, startProcessing,
  submitForVerification, verifierCheck, verifyAndReleaseLabResult,
} from "./lab";
import { USERS, switchUser } from "./session";
import { getState } from "./store";

const enc = () => getState().encounters.find((e) => e.patientId === "P001")!;
const user = (id: string) => USERS.find((u) => u.id === id)!;
const call = { toldTo: "Dr. Khalid Alharbi", toldBy: "Faisal Alqahtani, MLT", at: new Date().toISOString(), readBack: true };

/** An order in progress with every result typed by the lab technologist (U5). */
function entered(codes = ["2951-2", "2823-3"], values: Record<string, string> = { "2951-2": "140", "2823-3": "4.2" }): string {
  switchUser("U9");
  const o = placeLabOrder(enc(), { codes, priority: "routine", fasting: null, note: "" })!;
  switchUser("U5");
  collectSpecimens(o.id);
  startProcessing(o.id);
  for (const [code, v] of Object.entries(values)) saveLabResult(o.id, code, { value: v });
  return o.id;
}

describe("catalogue range sanity", () => {
  const base: LabTest = { code: "X", display: "X", short: "X", dept: "CH", specimen: "SER", kind: "quantity", low: 10, high: 20 };

  it("accepts critical limits that lie outside the normal range", () => {
    expect(rangeProblems({ ...base, critLow: 5, critHigh: 30 })).toEqual([]);
    expect(rangeProblems(base)).toEqual([]);
    expect(rangeProblems({ ...base, low: undefined, critHigh: 30 })).toEqual([]);
  });

  it("rejects a critical limit inside or on the edge of the normal range", () => {
    expect(rangeProblems({ ...base, critLow: 12 }).join(" ")).toMatch(/Critical low 12 must be below/);
    expect(rangeProblems({ ...base, critLow: 10 })).toHaveLength(1);
    expect(rangeProblems({ ...base, critHigh: 18 }).join(" ")).toMatch(/Critical high 18 must be above/);
    expect(rangeProblems({ ...base, critHigh: 20 })).toHaveLength(1);
  });

  it("checks the female range too, and upside-down ranges", () => {
    expect(rangeProblems({ ...base, lowF: 6, highF: 15, critLow: 7, critHigh: 30 }).join(" ")).toMatch(/female normal range low limit 6/);
    expect(rangeProblems({ ...base, low: 20, high: 10 }).join(" ")).toMatch(/upside down/);
    expect(rangeProblems({ ...base, critLow: 40, critHigh: 30 }).length).toBeGreaterThan(0);
  });

  it("finds no problem in the shipped catalogue, and reports a bad row by name", () => {
    expect(catalogRangeProblems()).toEqual([]);
    const bad = catalogRangeProblems([...LAB_CATALOG, { ...base, code: "BAD", short: "Bad Test", critHigh: 15 }]);
    expect(bad).toHaveLength(1);
    expect(bad[0].short).toBe("Bad Test");
  });

  it("the flag always follows the value: normal, low, high, critical low, critical high", () => {
    const k = testByCode("2823-3")!; // potassium 3.5 to 5.1, critical 2.5 and 6.5
    expect(interpretValue(k, "4.2", "M")).toBe("N");
    expect(interpretValue(k, "3.1", "M")).toBe("L");
    expect(interpretValue(k, "5.6", "M")).toBe("H");
    expect(interpretValue(k, "2.4", "M")).toBe("LL");
    expect(interpretValue(k, "6.9", "M")).toBe("HH");
    expect(critTextFor(k)).toBe("Below 2.5 or above 6.5 mmol/L");
    expect(critTextFor(testByCode("787-2")!)).toBe("");
  });
});

describe("verification sign-off", () => {
  beforeEach(() => {
    resetLab();
    switchUser("U9");
  });

  it("does not go to verification while a result is empty", () => {
    const id = entered(["2951-2", "2823-3"], { "2951-2": "140" });
    expect(submitForVerification(id)).toBe(false);
    expect(awaitingVerification(getOrder(id)!)).toBe(false);
    saveLabResult(id, "2823-3", { value: "4.2" });
    expect(submitForVerification(id)).toBe(true);
    const o = getOrder(id)!;
    expect(awaitingVerification(o)).toBe(true);
    expect(o.enteredBy).toEqual({ userId: "U5", name: user("U5").name });
    expect(o.submittedAt).toBeTruthy();
  });

  it("locks the results while they wait, and blocks sending to NPHIES", () => {
    const id = entered();
    submitForVerification(id);
    expect(saveLabResult(id, "2951-2", { value: "150" })).toBe(false);
    expect(cancelLabResult(id, "2951-2", true)).toBe(false);
    expect(fillSampleResults(id)).toBe(false);
    expect(getOrder(id)!.results["2951-2"].value).toBe("140");
    switchUser("U9");
    expect(publishLabResult(id)).toBeNull();
    expect(labResultSendBlock(getOrder(id)!)).toMatch(/verify/);
  });

  it("the person who entered the result cannot verify it; a second user can", () => {
    const id = entered();
    submitForVerification(id);
    expect(verifierCheck(getOrder(id)!, user("U5"))).toEqual({ sameUser: true, mayOverride: false });
    expect(verifyAndReleaseLabResult(id)).toBe(false);
    expect(getOrder(id)!.status).toBe("in-progress");
    switchUser("U9");
    expect(verifierCheck(getOrder(id)!, user("U9")).sameUser).toBe(false);
    expect(verifyAndReleaseLabResult(id)).toBe(true);
    const o = getOrder(id)!;
    expect(o.status).toBe("resulted");
    expect(o.verifiedBy).toEqual({ userId: "U9", name: user("U9").name });
    expect(o.verifiedAt).toBeTruthy();
    expect(o.verifyOverrideReason).toBeUndefined();
    expect(labResultSendBlock(o)).toBeNull();
    expect(publishLabResult(id)?.response.status).toBe("accepted");
  });

  it("an administrator may verify their own result only with a reason", () => {
    switchUser("U9");
    const o = placeLabOrder(enc(), { codes: ["2951-2"], priority: "routine", fasting: null, note: "" })!;
    collectSpecimens(o.id);
    startProcessing(o.id);
    saveLabResult(o.id, "2951-2", { value: "139" });
    submitForVerification(o.id);
    expect(verifierCheck(getOrder(o.id)!, user("U9"))).toEqual({ sameUser: true, mayOverride: true });
    expect(verifyAndReleaseLabResult(o.id)).toBe(false);
    expect(verifyAndReleaseLabResult(o.id, { overrideReason: "  " })).toBe(false);
    expect(verifyAndReleaseLabResult(o.id, { overrideReason: "Only one technologist on night shift" })).toBe(true);
    expect(getOrder(o.id)!.verifyOverrideReason).toBe("Only one technologist on night shift");
  });

  it("a user who typed a value counts as the same user, even when another user sent it", () => {
    const id = entered(); // U5 typed the values
    switchUser("U9");
    submitForVerification(id); // the administrator sends it
    expect(verifierCheck(getOrder(id)!, user("U5")).sameUser).toBe(true);
    expect(verifierCheck(getOrder(id)!, user("U9")).sameUser).toBe(true);
  });

  it("send back needs a reason and returns the order to entry", () => {
    const id = entered();
    submitForVerification(id);
    switchUser("U9");
    expect(sendBackLabResult(id, " ")).toBe(false);
    expect(sendBackLabResult(id, "Repeat potassium on a new sample")).toBe(true);
    const o = getOrder(id)!;
    expect(awaitingVerification(o)).toBe(false);
    expect(o.status).toBe("in-progress");
    expect(o.sentBack?.reason).toBe("Repeat potassium on a new sample");
    expect(o.sentBack?.by).toBe(user("U9").name);
    switchUser("U5");
    expect(saveLabResult(id, "2823-3", { value: "4.4" })).toBe(true);
    expect(submitForVerification(id)).toBe(true);
    expect(getOrder(id)!.sentBack).toBeUndefined();
  });

  it("nothing is released without verification being asked for", () => {
    const id = entered();
    switchUser("U9");
    expect(releaseLabResult(id)).toBe(false);
    expect(getOrder(id)!.status).toBe("in-progress");
    expect(labResultSendBlock(getOrder(id)!)).toMatch(/verification/);
  });

  it("a critical value cannot be released without the full call record", () => {
    const id = entered(["2951-2", "2823-3"], { "2951-2": "140", "2823-3": "6.9" });
    expect(getOrder(id)!.results["2823-3"].interp).toBe("HH");
    submitForVerification(id);
    switchUser("U9");
    expect(verifyAndReleaseLabResult(id)).toBe(false);
    expect(verifyAndReleaseLabResult(id, { criticalCall: { ...call, readBack: false } })).toBe(false);
    expect(verifyAndReleaseLabResult(id, { criticalCall: { ...call, toldTo: " " } })).toBe(false);
    expect(getOrder(id)!.status).toBe("in-progress");
    expect(verifyAndReleaseLabResult(id, { criticalCall: call })).toBe(true);
    expect(getOrder(id)!.criticalCall).toEqual(call);
  });

  it("lists what a call record is missing", () => {
    expect(criticalCallProblems(undefined)).toHaveLength(4);
    expect(criticalCallProblems({ ...call, at: "not a date" })).toEqual(["Time of the call"]);
    expect(criticalCallProblems(call)).toEqual([]);
  });
});

describe("previous result and change", () => {
  beforeEach(() => {
    resetLab();
    switchUser("U9");
  });

  it("finds the last released result of the same test for the same patient", () => {
    const first = entered(["2823-3"], { "2823-3": "4.0" });
    expect(previousResult([getOrder(first)!], getOrder(first)!, "2823-3")).toBeNull();
    submitForVerification(first);
    switchUser("U9");
    verifyAndReleaseLabResult(first);
    const second = entered(["2823-3"], { "2823-3": "5.5" });
    const all = [getOrder(first)!, getOrder(second)!];
    expect(previousResult(all, getOrder(second)!, "2823-3")?.result.value).toBe("4.0");
    expect(previousResult(all, getOrder(second)!, "2951-2")).toBeNull();
    // An order that is not released yet is not a previous result.
    expect(previousResult(all, getOrder(first)!, "2823-3")).toBeNull();
    const other: LabOrder = { ...getOrder(first)!, id: "LO-999999", patientId: "P002" };
    expect(previousResult([other], getOrder(second)!, "2823-3")).toBeNull();
  });

  it("works out the change for numbers only", () => {
    expect(resultDelta("4.0", "5.5")).toEqual({ diff: 1.5, pct: 37.5 });
    expect(resultDelta("10", "8")).toEqual({ diff: -2, pct: -20 });
    expect(resultDelta("0", "3")).toEqual({ diff: 3, pct: null });
    expect(resultDelta("Negative", "Positive")).toBeNull();
  });
});

describe("duplicate order warning", () => {
  beforeEach(() => {
    resetLab();
    switchUser("U9");
  });

  it("warns for a test that is already open for the same visit, also through a panel", () => {
    const visit = enc().visitNumber;
    const o = placeLabOrder(enc(), { codes: ["2823-3", "58410-2"], priority: "routine", fasting: null, note: "" })!;
    const orders = [getOrder(o.id)!];
    expect(openLabDuplicates(orders, visit, ["2823-3"])).toEqual(["Potassium"]);
    expect(openLabDuplicates(orders, visit, ["58410-2"])).toEqual(["CBC"]);
    expect(openLabDuplicates(orders, visit, ["718-7"])).toEqual(["Hemoglobin"]); // inside the open CBC
    expect(openLabDuplicates(orders, visit, ["24323-8"])[0]).toMatch(/^CMP \(Potassium already ordered\)$/);
    expect(openLabDuplicates(orders, visit, ["3016-3"])).toEqual([]);
    expect(openLabDuplicates(orders, "V-OTHER", ["2823-3"])).toEqual([]);
    expect(openLabDuplicates(orders, visit, ["2823-3"], o.id)).toEqual([]); // amending the same order
  });

  it("does not warn once the earlier order is resulted or cancelled", () => {
    const visit = enc().visitNumber;
    const o = placeLabOrder(enc(), { codes: ["2823-3"], priority: "routine", fasting: null, note: "" })!;
    expect(openLabDuplicates([{ ...getOrder(o.id)!, status: "resulted" }], visit, ["2823-3"])).toEqual([]);
    expect(openLabDuplicates([{ ...getOrder(o.id)!, status: "cancelled" }], visit, ["2823-3"])).toEqual([]);
  });
});
