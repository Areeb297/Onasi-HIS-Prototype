import { beforeEach, describe, expect, it } from "vitest";
import { dischargePatient, markBedReady, quickCreate, quickSend, recordLeftWard, returnBedToService, sendWithReason, setBedOutOfService, setClearance } from "./actions";
import { bedInfo } from "./beds";
import {
  CLEARANCES, OUTCOMES, canGiveClearance, clearanceBlock, departureGap, gapText, leftWardProblem, missingClearances, outcomeOfCode, outcomeProblems,
  overrideOk, reasonProblem, reasonText,
} from "./discharge";
import { DISPOSITION_CODE } from "./ed";
import type { ClearanceKey, Encounter } from "./model";
import { VS } from "./nphies-valuesets";
import { CNHI_DISPOSITIONS } from "./reference-data";
import { ROLES, switchUser } from "./session";
import { getState, nowLocal, resetAll } from "./store";

const perms = (role: string) => ROLES.find((r) => r.id === role)!.permissions;
const visit = (pid: string) => getState().encounters.find((e) => e.patientId === pid)!;
const KEYS: ClearanceKey[] = ["clinical", "pharmacy", "nursing", "finance"];
const TRANSFER = { hospital: "King Fahad Medical City", reason: "No bed available", acceptingDoctor: "Dr. Sami Alomar", transport: "Hospital ambulance", consent: true };

describe("clearances", () => {
  it("has four, and each fits one role, with the administrator able to give all", () => {
    expect(CLEARANCES.map((c) => c.key)).toEqual(KEYS);
    const who = (role: string) => KEYS.filter((k) => canGiveClearance(k, perms(role)));
    expect(who("physician")).toEqual(["clinical"]);
    expect(who("pharmacist")).toEqual(["pharmacy"]);
    expect(who("nurse")).toEqual(["nursing"]);
    expect(who("billing")).toEqual(["finance"]);
    expect(who("registration")).toEqual([]);
    expect(who("auditor")).toEqual([]);
    expect(who("admin")).toEqual(KEYS);
  });

  it("lists what is missing for inpatients only", () => {
    const c = { by: "A", role: "B", at: "2026-11-14T09:00" };
    expect(missingClearances({ cls: "I" })).toEqual(KEYS);
    expect(missingClearances({ cls: "I", clearances: { clinical: c, finance: c } })).toEqual(["pharmacy", "nursing"]);
    expect(missingClearances({ cls: "O" })).toEqual([]);
    expect(missingClearances({ cls: "E" })).toEqual([]);
  });

  it("blocks discharge until all four are done, unless a real reason is typed", () => {
    expect(clearanceBlock({ cls: "I" })).toMatch(/Clinical, Pharmacy, Nursing, Finance/);
    expect(clearanceBlock({ cls: "I" }, "   ok   ")).not.toBeNull();
    expect(clearanceBlock({ cls: "I" }, "Family is waiting, bill approved by phone")).toBeNull();
    expect(clearanceBlock({ cls: "O" })).toBeNull();
    expect(overrideOk("too short")).toBe(false);
  });
});

describe("outcomes", () => {
  it("maps each outcome to a published PV1-36 code the discharge update accepts", () => {
    expect(OUTCOMES.map((o) => o.label)).toEqual(["Home", "Transfer To Another Hospital", "Left Against Medical Advice", "Died"]);
    for (const o of OUTCOMES) {
      expect(VS.dischargeDisposition.has(o.code), o.label).toBe(true);
      expect(CNHI_DISPOSITIONS.has(o.code), o.label).toBe(true);
    }
    expect(new Set(OUTCOMES.map((o) => o.code)).size).toBe(4);
  });

  it("uses the same codes as the emergency dispositions", () => {
    const code = (id: string) => OUTCOMES.find((o) => o.id === id)!.code;
    expect(code("home")).toBe(DISPOSITION_CODE.Discharged);
    expect(code("transfer")).toBe(DISPOSITION_CODE.Transferred);
    expect(code("ama")).toBe(DISPOSITION_CODE["Left Against Advice"]);
    expect(code("died")).toBe(DISPOSITION_CODE.Died);
    expect(outcomeOfCode("306699001")).toBe("transfer");
    expect(outcomeOfCode("306706006")).toBeUndefined();
  });

  it("needs the transfer details", () => {
    const ctx = { now: "2026-11-14T12:00" };
    expect(outcomeProblems({ outcome: "home" }, ctx)).toEqual([]);
    expect(outcomeProblems({ outcome: "ama" }, ctx)).toEqual([]);
    expect(outcomeProblems({ outcome: "transfer" }, ctx)).toHaveLength(5);
    expect(outcomeProblems({ outcome: "transfer", transfer: { ...TRANSFER, consent: false } }, ctx)).toEqual(["Confirm the patient or family consent."]);
    expect(outcomeProblems({ outcome: "transfer", transfer: TRANSFER }, ctx)).toEqual([]);
  });

  it("needs the death details, with a time inside the stay", () => {
    const ctx = { admitAt: "2026-11-13T08:00", now: "2026-11-14T12:00" };
    const death = { at: "2026-11-14T11:30", cause: "Cardiac arrest", certifiedBy: "D1001" };
    expect(outcomeProblems({ outcome: "died" }, ctx)).toHaveLength(3);
    expect(outcomeProblems({ outcome: "died", death }, ctx)).toEqual([]);
    expect(outcomeProblems({ outcome: "died", death: { ...death, at: "2026-11-14T12:01" } }, ctx)[0]).toMatch(/future/);
    expect(outcomeProblems({ outcome: "died", death: { ...death, at: "2026-11-12T12:00" } }, ctx)[0]).toMatch(/before the admission/);
  });
});

describe("leaving the ward", () => {
  const enc = (leftWardAt?: string): Pick<Encounter, "status" | "discharge"> => ({
    status: "discharged", discharge: { outcome: "home", orderedAt: "2026-11-14T10:00", orderedBy: "Dr. A", bedId: "301-A", leftWardAt },
  });

  it("counts the minutes from the discharge to leaving, or to now while still on the ward", () => {
    expect(departureGap(enc(), "2026-11-14T10:25")).toEqual({ minutes: 25, left: false });
    expect(departureGap(enc("2026-11-14T12:05"), "2026-11-14T18:00")).toEqual({ minutes: 125, left: true });
    expect(departureGap({ status: "discharged" }, "2026-11-14T10:25")).toBeUndefined();
    expect(departureGap({ status: "discharged", discharge: { outcome: "home", orderedAt: "2026-11-14T10:00", orderedBy: "A" } }, "2026-11-14T10:25")).toBeUndefined();
    expect(gapText(45)).toBe("45 min");
    expect(gapText(120)).toBe("2 h");
    expect(gapText(125)).toBe("2 h 5 min");
  });

  it("checks the leaving time", () => {
    const now = "2026-11-14T11:00";
    expect(leftWardProblem(enc(), "2026-11-14T10:30", now)).toBeNull();
    expect(leftWardProblem(enc(), "", now)).toMatch(/Enter/);
    expect(leftWardProblem(enc(), "2026-11-14T09:59", now)).toMatch(/before the discharge/);
    expect(leftWardProblem(enc(), "2026-11-14T11:01", now)).toMatch(/future/);
    expect(leftWardProblem(enc("2026-11-14T10:30"), "2026-11-14T10:40", now)).toMatch(/already/);
  });
});

describe("reasons", () => {
  it("needs a reason from the list, and words for Other", () => {
    expect(reasonProblem("", "")).toMatch(/Choose/);
    expect(reasonProblem("Other", " ")).toMatch(/Say/);
    expect(reasonProblem("Other", "Fire drill")).toBeNull();
    expect(reasonProblem("Wrong patient", "")).toBeNull();
    expect(reasonText("Wrong patient", " same name ")).toBe("Wrong patient: same name");
    expect(reasonText("Wrong patient", "")).toBe("Wrong patient");
  });
});

describe("discharge flow on the store", () => {
  beforeEach(() => {
    resetAll();
    switchUser("U9"); // administrator
  });

  it("only lets a fitting role give a clearance, and it can be withdrawn", () => {
    const v = visit("P001").visitNumber;
    switchUser("U4"); // pharmacist
    expect(setClearance(v, "clinical", true)).toBe(false);
    expect(setClearance(v, "pharmacy", true)).toBe(true);
    expect(visit("P001").clearances?.pharmacy).toMatchObject({ by: "Noura Alzahrani, PharmD", role: "Pharmacist" });
    expect(visit("P001").clearances?.pharmacy?.at).toBeTruthy();
    expect(setClearance(v, "pharmacy", false)).toBe(true);
    expect(visit("P001").clearances?.pharmacy).toBeUndefined();
    // Clearances do not mark the chart as changed.
    expect(visit("P001").dirty).toBeFalsy();
  });

  it("blocks an inpatient discharge with clearances missing", () => {
    const v = visit("P001").visitNumber;
    setClearance(v, "clinical", true);
    expect(dischargePatient(v, { outcome: "home", dx: [] }).ok).toBe(false);
    expect(visit("P001").status).toBe("active");
    expect(dischargePatient(v, { outcome: "home", dx: [], overrideReason: "short" }).ok).toBe(false);
  });

  it("discharges with an override, keeps the bed held, then cleaning, then free", () => {
    const v = visit("P001").visitNumber;
    const out = dischargePatient(v, { outcome: "home", dx: [], overrideReason: "Family is leaving the country tonight" });
    expect(out.ok).toBe(true);
    expect(out.entry?.trigger).toBe("A03");
    expect(out.entry?.message).toContain("306689006");
    const e = visit("P001");
    expect(e.status).toBe("discharged");
    expect(e.disposition).toBe("306689006");
    expect(e.discharge).toMatchObject({ outcome: "home", bedId: "301-A", orderedBy: "System Administrator" });
    expect(e.discharge?.override).toMatchObject({ reason: "Family is leaving the country tonight", missing: KEYS });
    expect(bedInfo(getState(), "301-A")?.state).toBe("discharging");

    expect(markBedReady("301-A")).toBe(false);
    expect(recordLeftWard(v, nowLocal(-5))).toBe(false); // before the discharge
    expect(recordLeftWard(v, nowLocal())).toBe(true);
    expect(visit("P001").discharge?.leftWardAt).toBeTruthy();
    expect(bedInfo(getState(), "301-A")?.state).toBe("cleaning");
    expect(departureGap(visit("P001"), nowLocal())).toMatchObject({ left: true });

    expect(markBedReady("301-A")).toBe(true);
    expect(bedInfo(getState(), "301-A")?.state).toBe("free");
  });

  it("discharges with all four clearances and no override", () => {
    const v = visit("P002").visitNumber;
    for (const k of KEYS) setClearance(v, k, true);
    expect(dischargePatient(v, { outcome: "ama", dx: [] }).ok).toBe(true);
    expect(visit("P002").discharge?.override).toBeUndefined();
    expect(visit("P002").disposition).toBe("225928004");
  });

  it("records transfer and death details and sends the matching PV1-36 code", () => {
    const v1 = visit("P001").visitNumber;
    expect(dischargePatient(v1, { outcome: "transfer", dx: [], overrideReason: "Urgent transfer for cardiac surgery" }).ok).toBe(false);
    const t = dischargePatient(v1, { outcome: "transfer", dx: [], transfer: TRANSFER, overrideReason: "Urgent transfer for cardiac surgery" });
    expect(t.entry?.message).toContain("306699001");
    expect(visit("P001").discharge?.transfer).toEqual(TRANSFER);

    const v2 = visit("P002").visitNumber;
    const death = { at: nowLocal(-10), cause: "Septic shock", certifiedBy: "D1001" };
    const d = dischargePatient(v2, { outcome: "died", dx: [], death, overrideReason: "Patient died, clearances not applicable" });
    expect(d.entry?.message).toContain("79779006");
    expect(d.entry?.errors).toBe(0);
    expect(visit("P002").discharge?.death).toEqual(death);
  });

  it("discharges an outpatient without clearances and without holding a bed", () => {
    const v = visit("P007").visitNumber;
    const out = dischargePatient(v, { outcome: "home", dx: [{ code: "J06.9", text: "Acute upper respiratory infection", type: "F" }] });
    expect(out.ok).toBe(true);
    expect(visit("P007").discharge).toMatchObject({ outcome: "home" });
    expect(visit("P007").discharge?.bedId).toBeUndefined();
    expect(departureGap(visit("P007"), nowLocal())).toBeUndefined();
  });

  it("undoing the discharge puts the patient back in the held bed and clears the outcome", () => {
    const v = visit("P001").visitNumber;
    dischargePatient(v, { outcome: "home", dx: [], overrideReason: "Discharged on the wrong patient by mistake" });
    expect(quickSend("A13", v).ok).toBe(true);
    expect(visit("P001")).toMatchObject({ status: "active", bedId: "301-A" });
    expect(visit("P001").discharge).toBeUndefined();
    expect(bedInfo(getState(), "301-A")?.state).toBe("occupied");
  });

  it("undoing after the bed went to cleaning uses the first free bed", () => {
    const v = visit("P001").visitNumber;
    dischargePatient(v, { outcome: "home", dx: [], overrideReason: "Discharged on the wrong patient by mistake" });
    recordLeftWard(v, nowLocal());
    expect(quickSend("A13", v).ok).toBe(true);
    expect(visit("P001").bedId).toBe("302-A");
    expect(bedInfo(getState(), "301-A")?.state).toBe("cleaning");
  });

  it("takes a bed out of service with a reason and returns it", () => {
    expect(setBedOutOfService("302-A", "", "")).toBe(false);
    expect(setBedOutOfService("301-A", "Maintenance")).toBe(false); // occupied
    expect(setBedOutOfService("302-A", "Other", "Water leak")).toBe(true);
    expect(bedInfo(getState(), "302-A")).toMatchObject({ state: "out", reason: "Other: Water leak" });
    expect(returnBedToService("302-A")).toBe(true);
    expect(bedInfo(getState(), "302-A")?.state).toBe("free");
  });

  it("reserves a bed for a pre-admission and admits into it", () => {
    expect(quickCreate("A05", { patientId: "P010", attending: "D1001", service: "MED", reason: "Planned", expectedAdmitAt: nowLocal(600), reserveBedId: "301-A" }).ok).toBe(false);
    const pre = quickCreate("A05", { patientId: "P010", attending: "D1001", service: "MED", reason: "Planned", expectedAdmitAt: nowLocal(600), reserveBedId: "302-B" });
    expect(pre.ok).toBe(true);
    expect(bedInfo(getState(), "302-B")).toMatchObject({ state: "reserved" });
    expect(quickCreate("A01", { patientId: "P009", attending: "D1001", service: "MED", reason: "", bedId: "302-B" }).ok).toBe(false);
    expect(quickCreate("A01", { patientId: "P010", attending: "D1001", service: "MED", reason: "", bedId: "302-B" }).ok).toBe(true);
    expect(bedInfo(getState(), "302-B")?.state).toBe("occupied");
  });

  it("cancelling needs a reason, keeps it on the visit, and frees the reserved bed", () => {
    const v = visit("P005").visitNumber;
    expect(sendWithReason("A38", v, "", "").ok).toBe(false);
    expect(visit("P005").status).toBe("preadmit");
    const out = sendWithReason("A38", v, "Patient declined", "Called the ward");
    expect(out.entry?.trigger).toBe("A38");
    expect(visit("P005")).toMatchObject({ status: "cancelled", cancelReason: "Patient declined: Called the ward" });
    expect(bedInfo(getState(), "402-B")?.state).toBe("free");
  });
});
