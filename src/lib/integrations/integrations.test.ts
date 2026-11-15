import { beforeEach, describe, expect, it } from "vitest";
import { printHtml } from "../print-doc";
import { switchUser } from "../session";
import { getState, resetAll } from "../store";
import { INTEGRATIONS, callsOf, modeOf, ownCalls, resetCallLog, setMode, statsOf, testConnection, visibleIntegrations, type CallEntry } from "./index";
import { rsdDispense } from "./rsd";
import { cancelSickLeave, issueSickLeave, leaveEnd, leavesOf, recordPrint, resetSeha, sickLeavePrint, verifySickLeave } from "./seha";
import { YAKEEN_PEOPLE, hijri, idProblem, yakeenLookup } from "./yakeen";

const T0 = new Date(2026, 10, 15, 9, 0).getTime();
const enc = () => getState().encounters.find((e) => e.dx.length > 0)!;
const patient = () => getState().patients.find((p) => p.id === enc().patientId)!;
const asAdmin = (fn: () => void) => { switchUser("U9"); fn(); };
const leave = () => ({ visit: enc().visitNumber, type: "sick" as const, startDate: "2026-11-15", days: 3, dxCode: enc().dx[0].code, employerType: "private" as const });

beforeEach(() => {
  resetAll(); resetCallLog(); resetSeha(); switchUser("U1");
});

describe("Yakeen", () => {
  it("has about 20 made-up people with valid numbers of both kinds", () => {
    expect(YAKEEN_PEOPLE).toHaveLength(20);
    for (const p of YAKEEN_PEOPLE) expect(idProblem(p.idType, p.idNumber)).toBeNull();
    expect(new Set(YAKEEN_PEOPLE.map((p) => p.idNumber)).size).toBe(20);
    expect(YAKEEN_PEOPLE.some((p) => p.idType === "iqama" && p.nationality !== "SAU")).toBe(true);
    expect(hijri("2026-11-15")).toMatch(/1448/);
  });

  it("returns the identity when the number and the date of birth match, and logs the call", () => {
    switchUser("U3");
    const p = YAKEEN_PEOPLE[0];
    const res = yakeenLookup({ idType: p.idType, idNumber: p.idNumber, dob: p.dob }, T0);
    expect(res.ok && res.value).toMatchObject({ nameEn: ["Abdullah", "Saad", "Mohammed", "Alqahtani"], nationality: "SAU", sex: "M" });
    expect(res.ok && res.value.address.shortAddress).toMatch(/^[A-Z]{4}\d{4}$/);
    expect(ownCalls("yakeen")).toHaveLength(1);
    expect(ownCalls("yakeen")[0]).toMatchObject({ ok: true, operation: "Identity Lookup" });
    expect(JSON.parse(ownCalls("yakeen")[0].response).person.idNumber).toBe(p.idNumber);
  });

  it("refuses a wrong date of birth, an unknown number and a mistyped number", () => {
    switchUser("U3");
    const p = YAKEEN_PEOPLE[12];
    expect(yakeenLookup({ idType: "iqama", idNumber: p.idNumber, dob: "1990-01-01" }, T0)).toEqual({ ok: false, errors: ["The date of birth does not match this number."] });
    expect(ownCalls("yakeen")[0].ok).toBe(false);
    const wrongDigit = p.idNumber.slice(0, 9) + ((Number(p.idNumber[9]) + 1) % 10);
    expect(yakeenLookup({ idType: "iqama", idNumber: wrongDigit, dob: p.dob }, T0).ok).toBe(false);
    expect(yakeenLookup({ idType: "national-id", idNumber: p.idNumber, dob: p.dob }, T0).ok).toBe(false);
    expect(ownCalls("yakeen")).toHaveLength(1); // a number that fails the check never reaches Yakeen
  });

  it("is only for staff who register patients, and stops when switched off", () => {
    const p = YAKEEN_PEOPLE[0];
    const q = { idType: p.idType, idNumber: p.idNumber, dob: p.dob };
    expect(yakeenLookup(q, T0).ok).toBe(false); // U1 is a physician
    asAdmin(() => setMode("yakeen", "off"));
    switchUser("U3");
    const res = yakeenLookup(q, T0);
    expect(!res.ok && res.errors[0]).toMatch(/switched off/);
    expect(ownCalls("yakeen")).toHaveLength(0);
  });
});

describe("Seha sick leave", () => {
  it("issues a leave with a number, the last day and the doctor's licence", () => {
    const res = issueSickLeave(leave(), T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(res.value.number).toMatch(/^PSL-\d{6}-00001$/);
    expect(res.value).toMatchObject({ status: "Issued", endDate: "2026-11-17", doctor: "Dr. Khalid Alharbi", licence: "14RM0036512", dxCode: enc().dx[0].code });
    expect(leavesOf(enc().visitNumber)).toHaveLength(1);
    expect(ownCalls("seha")[0]).toMatchObject({ operation: "Issue Sick Leave", ok: true });
    expect(leaveEnd("2026-01-30", 3)).toBe("2026-02-01");
  });

  it("only lets a doctor issue or cancel", () => {
    for (const u of ["U2", "U7", "U9"]) {
      switchUser(u);
      expect(issueSickLeave(leave(), T0).ok).toBe(false);
    }
    switchUser("U1");
    const res = issueSickLeave(leave(), T0);
    switchUser("U2");
    expect(res.ok && cancelSickLeave(res.value.number, "Wrong dates", T0).ok).toBe(false);
  });

  it("checks the days, the diagnosis, the companion and overlapping dates", () => {
    expect(issueSickLeave({ ...leave(), days: 0 }, T0).ok).toBe(false);
    expect(issueSickLeave({ ...leave(), days: 31 }, T0).ok).toBe(false);
    expect(issueSickLeave({ ...leave(), dxCode: "Z99.9" }, T0).ok).toBe(false);
    expect(issueSickLeave({ ...leave(), type: "companion" }, T0).ok).toBe(false);
    expect(issueSickLeave(leave(), T0).ok).toBe(true);
    const again = issueSickLeave({ ...leave(), startDate: "2026-11-17", days: 1 }, T0);
    expect(!again.ok && again.errors[0]).toMatch(/already has a sick leave/);
    const companion = issueSickLeave({ ...leave(), type: "companion", companionName: "Fahad Alqahtani", companionRelation: "Father" }, T0);
    expect(companion.ok && companion.value).toMatchObject({ companionName: "Fahad Alqahtani", companionRelation: "Father" });
  });

  it("verifies, cancels with a reason, and keeps the trail", () => {
    const res = issueSickLeave(leave(), T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    const number = res.value.number;
    const id = patient().nationalId;
    const first = verifySickLeave(number, id, T0);
    expect(first.ok && first.value.valid).toBe(true);
    const wrong = verifySickLeave(number, "1000000000", T0);
    expect(wrong.ok && !wrong.value.valid && wrong.value.leave === undefined).toBe(true);
    expect(cancelSickLeave(number, " ", T0).ok).toBe(false);
    expect(cancelSickLeave(number, "Issued with the wrong dates", T0).ok).toBe(true);
    expect(cancelSickLeave(number, "Again", T0).ok).toBe(false);
    const after = verifySickLeave(number, id, T0);
    expect(after.ok && after.value).toMatchObject({ valid: false, message: "This sick leave was cancelled. It is not valid." });
    recordPrint(number, T0);
    expect(leavesOf(enc().visitNumber)[0].trail.map((t) => t.text.split(":")[0])).toEqual(["Issued on Seha for 3 days", "Checked on Seha", "Cancelled on Seha", "Checked on Seha", "Printed"]);
    expect(issueSickLeave(leave(), T0).ok).toBe(true); // a cancelled leave no longer blocks the dates
  });

  it("prints with every value escaped", () => {
    const res = issueSickLeave({ ...leave(), notes: "<script>alert(1)</script>" }, T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    const html = printHtml(sickLeavePrint(res.value));
    expect(html).toContain(res.value.number);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("integrations hub", () => {
  it("shows every integration to the administrator and the financial ones to billing", () => {
    expect(visibleIntegrations()).toHaveLength(0); // physician
    switchUser("U7");
    expect(visibleIntegrations().map((i) => i.id)).toEqual(["nphies-financial", "zatca"]);
    switchUser("U9");
    expect(visibleIntegrations()).toHaveLength(INTEGRATIONS.length);
    for (const i of INTEGRATIONS) expect(Array.isArray(callsOf(i.id))).toBe(true);
  });

  it("counts today's calls and the success rate", () => {
    const call = (at: number, ok: boolean): CallEntry => ({ id: String(at), integration: "seha", at: new Date(at).toISOString(), operation: "x", summary: "", ok, format: "JSON", request: "", response: "" });
    const stats = statsOf([call(T0, true), call(T0 + 1000, false), call(T0 + 2000, true), call(T0 - 3 * 86_400_000, false)], T0 + 5000);
    expect(stats).toMatchObject({ today: 3, todayOk: 2, rate: 67 });
    expect(stats.last?.id).toBe(String(T0 + 2000));
    expect(statsOf([], T0).rate).toBeNull();
  });

  it("lets only the administrator change a status or test a connection", () => {
    expect(setMode("rsd", "connected")).toBe(false);
    expect(testConnection("rsd")).toBeNull();
    asAdmin(() => setMode("rsd", "off"));
    expect(rsdDispense({ gtin: "06281234567890", serial: "SN1", batch: "B1", expiry: "2027-01-01" }, T0).ok).toBe(false); // switched off
    asAdmin(() => setMode("rsd", "test"));
    expect(modeOf("rsd")).toBe("test");
    expect(testConnection("rsd", T0)?.ok).toBe(true);
    expect(rsdDispense({ gtin: "06281234567890", serial: "SN1", batch: "B1", expiry: "2027-01-01" }, T0 + 1000).ok).toBe(true);
    expect(rsdDispense({ gtin: "6281234567890", serial: "SN1", batch: "B1", expiry: "2027-01-01" }, T0).ok).toBe(false);
    expect(callsOf("rsd").map((c) => c.operation)).toEqual(["Dispense Notification", "Connection Test"]); // newest first
  });
});
