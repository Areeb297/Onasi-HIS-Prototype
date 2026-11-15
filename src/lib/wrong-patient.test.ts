import { beforeEach, describe, expect, it } from "vitest";
import {
  answerPatientCheck, confirmPatient, getPatientCheck, needsPatientCheck, notePatientActivity, otherRecentPatient, RECENT_MS, resetPatientChecks,
} from "./wrong-patient";

const T = 1_000_000;
beforeEach(() => resetPatientChecks());

describe("wrong-patient rule", () => {
  it("finds the most recent other patient within two minutes, and nothing older", () => {
    const log = new Map([["P1", T - 30_000], ["P2", T - 90_000], ["P3", T - RECENT_MS - 1]]);
    expect(otherRecentPatient(log, "P9", T)).toEqual({ patientId: "P1", at: T - 30_000 });
    expect(otherRecentPatient(log, "P1", T)).toEqual({ patientId: "P2", at: T - 90_000 });
    expect(otherRecentPatient(new Map([["P3", T - RECENT_MS - 1]]), "P1", T)).toBeNull();
    expect(otherRecentPatient(new Map([["P1", T - 5_000]]), "P1", T)).toBeNull();
  });

  it("asks once per pair until the other chart is used again", () => {
    const log = new Map([["P2", T - 10_000]]);
    expect(needsPatientCheck(log, "P1", T, null)?.patientId).toBe("P2");
    const answered = { patientId: "P1", otherId: "P2", at: T };
    expect(needsPatientCheck(log, "P1", T + 1000, answered)).toBeNull();
    log.set("P2", T + 500);
    expect(needsPatientCheck(log, "P1", T + 1000, answered)?.patientId).toBe("P2");
  });
});

describe("confirmPatient", () => {
  it("goes ahead at once when no other patient was used recently", async () => {
    notePatientActivity("P1", Date.now() - 1000);
    await expect(confirmPatient("P1")).resolves.toBe(true);
    expect(getPatientCheck()).toBeNull();
  });

  it("asks when a different chart was used in the last two minutes, and remembers Continue", async () => {
    notePatientActivity("P2", Date.now() - 30_000);
    const first = confirmPatient("P1");
    expect(getPatientCheck()).toMatchObject({ patientId: "P1", otherId: "P2" });
    answerPatientCheck(true);
    await expect(first).resolves.toBe(true);
    await expect(confirmPatient("P1")).resolves.toBe(true);
    expect(getPatientCheck()).toBeNull();
  });

  it("stops when the user cancels", async () => {
    notePatientActivity("P2", Date.now() - 30_000);
    const p = confirmPatient("P1");
    answerPatientCheck(false);
    await expect(p).resolves.toBe(false);
  });
});
