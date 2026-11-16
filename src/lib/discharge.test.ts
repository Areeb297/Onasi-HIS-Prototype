import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  changeToOutpatient, convertToInpatient, dischargePatient, markBedReady, moveVisit, quickCreate, quickSend, recordLeftWard, returnBedToService,
  sendWithReason, setBedOutOfService, setClearance, transferPatient,
} from "./actions";
import { bedInfo } from "./beds";
import { followUpsOf, resetCareRequests } from "./care-requests";
import {
  CLEARANCES, OUTCOMES, canGiveClearance, cleanDetails, clearanceBlock, departureGap, detailProblems, gapText, idNumberProblem, leftWardProblem,
  missingClearances, outcomeOfCode, outcomeProblems, overrideOk, reasonProblem, reasonText,
} from "./discharge";
import { ts } from "./hl7";
import { conversionProblems, extrasProblems, extrasToAdmission, emptyExtras, freeBedsByFloor, moveVisitProblem } from "./visit-forms";
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

  it("still reads a discharge saved before the new details existed", () => {
    const v = visit("P001").visitNumber;
    dischargePatient(v, { outcome: "home", dx: [], overrideReason: "Family is leaving the country tonight" });
    const e = visit("P001");
    expect(e.discharge?.condition).toBeUndefined();
    expect(e.discharge?.approvals).toBeUndefined();
    expect(departureGap(e, nowLocal())).toMatchObject({ left: false });
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

/* ---------- discharge details, transfer, change of class, admit details, move visit ---------- */

const ATTENDANT = { name: "Fahad Alharbi", phone: "0551234567", relation: "Son", idType: "National ID", idNumber: "1012345678" };

describe("discharge details", () => {
  const ctx = { outcome: "home" as const, admitAt: "2026-11-13T08:00", now: "2026-11-14T12:00" };

  it("needs the condition unless the patient died, and a discharge time inside the stay", () => {
    expect(detailProblems({}, ctx)).toEqual(["Choose the condition on discharge.", "Enter the discharge date and time."]);
    expect(detailProblems({ dischargeAt: "2026-11-14T11:00" }, { ...ctx, outcome: "died" })).toEqual([]);
    expect(detailProblems({ condition: "Stable", dischargeAt: "2026-11-14T12:30" }, ctx)[0]).toMatch(/future/);
    expect(detailProblems({ condition: "Stable", dischargeAt: "2026-11-12T12:00" }, ctx)[0]).toMatch(/before the admission/);
    expect(detailProblems({ condition: "Stable", dischargeAt: "2026-11-14T11:00" }, ctx)).toEqual([]);
  });

  it("checks the attendant's phone and ID, and each doctor approval", () => {
    const base = { condition: "Stable", dischargeAt: "2026-11-14T11:00" };
    expect(detailProblems({ ...base, attendant: ATTENDANT }, ctx)).toEqual([]);
    expect(detailProblems({ ...base, attendant: { ...ATTENDANT, phone: "call me" } }, ctx)[0]).toMatch(/contact number/);
    expect(detailProblems({ ...base, attendant: { ...ATTENDANT, idNumber: "2012345678" } }, ctx)[0]).toMatch(/National ID/);
    expect(detailProblems({ ...base, attendant: { ...ATTENDANT, idType: "" } }, ctx)[0]).toMatch(/ID type/);
    expect(idNumberProblem("Iqama", "2123456789")).toBeNull();
    expect(idNumberProblem("Passport", "A1")).toMatch(/passport/);
    expect(idNumberProblem("National ID", "")).toBeNull();
    const approval = { role: "Consultant", doctor: "D1001", at: "2026-11-14T10:00", remarks: "" };
    expect(detailProblems({ ...base, approvals: [approval] }, ctx)).toEqual([]);
    expect(detailProblems({ ...base, approvals: [{ ...approval, doctor: "" }] }, ctx)).toEqual(["Approval 1: choose the approving doctor."]);
    expect(detailProblems({ ...base, approvals: [approval, { ...approval, at: "2026-11-14T13:00" }] }, ctx)).toEqual(["Approval 2: the approval time cannot be in the future."]);
  });

  it("keeps only what was filled in", () => {
    expect(cleanDetails({ condition: " ", attendant: { name: "", phone: "", relation: "", idType: "", idNumber: "" }, ambulance: false, approvals: [] })).toEqual({});
    expect(cleanDetails({ condition: "Stable ", instructions: " Rest ", ambulance: true })).toEqual({ condition: "Stable", instructions: "Rest", ambulance: true });
  });
});

describe("visit dialog rules", () => {
  beforeEach(() => resetAll());

  it("groups the free beds by floor and room, with the department's ward first", () => {
    const groups = freeBedsByFloor(getState(), { patientId: "P010" }, "4B");
    expect(groups.map((g) => g.floor)).toEqual(["Floor 4", "Floor 3", "Floor 2"]);
    const ids = (pid: string) => freeBedsByFloor(getState(), { patientId: pid }).flatMap((g) => g.rooms.flatMap((r) => r.beds.map((b) => b.bed.id)));
    expect(ids("P010")).toEqual(expect.arrayContaining(["302-A", "302-B", "401-A", "401-B", "402-A", "ICU1-B", "ICU2-A"]));
    expect(ids("P010")).not.toContain("301-A"); // occupied
    expect(ids("P010")).not.toContain("402-B"); // reserved for P005
    expect(ids("P010")).not.toContain("ICU2-B"); // out of service
    expect(ids("P005")).toContain("402-B");
    expect(groups[0].rooms.map((r) => r.room)).toEqual(["401", "402"]);
  });

  it("needs the department, type, condition, a time inside the visit, a reason and a bed to change to inpatient", () => {
    const c = { bedId: "302-A", service: "MED", subDepartment: "", admissionType: "03", condition: "Fair", at: "2026-11-14T11:00", reason: "Needs IV antibiotics", activityLevel: "" };
    const ctx = { visitStart: "2026-11-14T10:00", now: "2026-11-14T12:00" };
    expect(conversionProblems(c, ctx)).toEqual([]);
    expect(conversionProblems({ ...c, reason: "IV" }, ctx)[0]).toMatch(/reason/);
    expect(conversionProblems({ ...c, at: "2026-11-14T09:00" }, ctx)[0]).toMatch(/before the visit/);
    expect(conversionProblems({ ...c, at: "2026-11-14T12:30" }, ctx)[0]).toMatch(/future/);
    expect(conversionProblems({ ...c, condition: "", bedId: "" }, ctx)).toEqual(["Choose the patient condition.", "Pick a bed."]);
  });

  it("checks the admit details and keeps only what was filled in", () => {
    expect(extrasProblems({ ...emptyExtras(), expectedDays: "2.5" })[0]).toMatch(/whole number/);
    expect(extrasProblems({ ...emptyExtras(), attendantPhone: "abc" })[0]).toMatch(/digits/);
    expect(extrasToAdmission({ ...emptyExtras(), expectedDays: "3", condition: "Stable", notes: "  " })).toEqual({ expectedStayDays: 3, patientCondition: "Stable" });
  });

  it("will not move an open admission onto a patient who is already admitted", () => {
    const s = getState();
    expect(moveVisitProblem(s, visit("P001").visitNumber, "P002")).toMatch(/already has an open admission/);
    expect(moveVisitProblem(s, visit("P001").visitNumber, "P010")).toBeNull();
    expect(moveVisitProblem(s, visit("P007").visitNumber, "P002")).toBeNull();
    expect(moveVisitProblem(s, visit("P007").visitNumber, "P007")).toMatch(/different/);
    expect(moveVisitProblem(s, visit("P007").visitNumber, "")).toMatch(/Choose/);
  });
});

describe("visit dialogs on the store", () => {
  const mem = new Map<string, string>();
  beforeAll(() => {
    // The audit trail is read back from storage.
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
    };
  });
  beforeEach(() => {
    resetAll();
    resetCareRequests();
    switchUser("U9");
  });
  const auditLog = (): { action: string; target: string; detail?: string }[] => JSON.parse(mem.get("onasi-emr-audit-v1") ?? "[]");
  const pv1 = (message: string | undefined) => (message ?? "").split("\r").find((s) => s.startsWith("PV1|"))!.split("|");

  it("discharges an inpatient with the details and sends the chosen discharge time", () => {
    const v = visit("P001").visitNumber;
    const at = nowLocal(-30);
    const details = {
      condition: "Stable", dischargeAt: at, attendant: ATTENDANT,
      summary: { reasonForAdmission: "Fever and cough", admittingDiagnosis: "J18.9 Pneumonia", procedures: "", findings: "CRP falling", course: "IV antibiotics for three days" },
      instructions: "Finish the antibiotics", educatedBy: "Huda Alotaibi, RN", ambulance: true,
      approvals: [{ role: "Consultant", doctor: "D1001", at: nowLocal(-40), remarks: "Fit to go home" }],
    };
    const base = { outcome: "home" as const, dx: [], overrideReason: "Family is leaving the country tonight" };
    expect(dischargePatient(v, { ...base, details: { ...details, condition: "" } }).ok).toBe(false);
    expect(dischargePatient(v, { ...base, details: { ...details, dischargeAt: nowLocal(30) } }).ok).toBe(false);
    expect(visit("P001").status).toBe("active");
    const out = dischargePatient(v, { ...base, details });
    expect(out.ok).toBe(true);
    expect(out.entry?.trigger).toBe("A03");
    expect(out.entry?.message).toContain("306689006");
    expect(pv1(out.entry?.message)[45]).toBe(ts(at));
    const e = visit("P001");
    expect(e.dischargeAt).toBe(at);
    expect(e.discharge).toMatchObject({ outcome: "home", condition: "Stable", dischargeAt: at, attendant: ATTENDANT, ambulance: true, educatedBy: "Huda Alotaibi, RN", instructions: "Finish the antibiotics" });
    expect(e.discharge?.summary?.course).toBe("IV antibiotics for three days");
    expect(e.discharge?.approvals).toEqual(details.approvals);
    // The four-clearance override is untouched by the new details.
    expect(e.discharge?.override?.missing).toEqual(KEYS);
    expect(auditLog().some((a) => a.target === `Discharge details ${v}` && /Ambulance transport requested/.test(a.detail ?? ""))).toBe(true);
  });

  it("transfers with a reason and a new department, and cancelling the transfer puts both back", () => {
    const v = visit("P001").visitNumber;
    expect(transferPatient(v, { bedId: "401-A", service: "SUR", subDepartment: "General Surgery", reason: "" }).ok).toBe(false);
    expect(visit("P001").bedId).toBe("301-A");
    const out = transferPatient(v, { bedId: "401-A", service: "SUR", subDepartment: "General Surgery", reason: "Moved to the specialty ward" });
    expect(out.entry?.trigger).toBe("A02");
    expect(pv1(out.entry?.message)[10].split("^")[0]).toBe("MS");
    expect(visit("P001")).toMatchObject({ bedId: "401-A", service: "SUR", subDepartment: "General Surgery" });
    expect(visit("P001").transferLog?.[0]).toMatchObject({ fromBed: "301-A", toBed: "401-A", fromService: "MED", toService: "SUR", reason: "Moved to the specialty ward" });
    expect(auditLog().some((a) => a.target === `Transfer ${v}` && /Moved to the specialty ward/.test(a.detail ?? ""))).toBe(true);

    const back = sendWithReason("A12", v, "Moved by mistake");
    expect(back.entry?.trigger).toBe("A12");
    expect(pv1(back.entry?.message)[10].split("^")[0]).toBe("MX");
    expect(visit("P001")).toMatchObject({ bedId: "301-A", service: "MED", subDepartment: undefined });
    expect(visit("P001").transferLog?.[0].cancelledAt).toBeTruthy();
  });

  it("changes an outpatient visit to inpatient with the admission details", () => {
    const v = visit("P007").visitNumber;
    const c = { bedId: "302-A", service: "MED", subDepartment: "Pulmonology", admissionType: "03", condition: "Fair", at: nowLocal(-5), reason: "Needs IV antibiotics", activityLevel: "Bed Rest" };
    expect(convertToInpatient(v, { ...c, condition: "" }).ok).toBe(false);
    expect(convertToInpatient(v, { ...c, at: nowLocal(60) }).ok).toBe(false);
    expect(convertToInpatient(v, { ...c, bedId: "301-A" }).ok).toBe(false); // taken
    expect(visit("P007").cls).toBe("O");
    const out = convertToInpatient(v, c);
    expect(out.entry?.trigger).toBe("A06");
    expect(pv1(out.entry?.message)[4]).toBe("03");
    expect(visit("P007")).toMatchObject({ cls: "I", bedId: "302-A", subDepartment: "Pulmonology", admissionMethod: "03", admitAt: c.at });
    expect(visit("P007").admission).toMatchObject({ patientCondition: "Fair", activityLevel: "Bed Rest", conversionReason: "Needs IV antibiotics", convertedBy: "System Administrator" });
  });

  it("changes to outpatient and requests the follow-up in the same step", () => {
    const v = visit("P002").visitNumber;
    const fu = { amount: 2, unit: "weeks" as const, clinic: "Diabetes And Endocrine Clinic", doctorId: "D1001", visitType: "in-person" as const, instructions: "Bring the sugar diary" };
    expect(changeToOutpatient(v, "Does not need an inpatient bed", "", { ...fu, amount: 0 }).ok).toBe(false);
    expect(visit("P002").cls).toBe("I"); // nothing was sent
    const out = changeToOutpatient(v, "Does not need an inpatient bed", "", fu);
    expect(out.entry?.trigger).toBe("A07");
    expect(visit("P002")).toMatchObject({ cls: "O", status: "active", cancelReason: "Does not need an inpatient bed" });
    expect(followUpsOf(v)).toHaveLength(1);
    expect(followUpsOf(v)[0]).toMatchObject({ clinic: fu.clinic, amount: 2, unit: "weeks", status: "requested", instructions: fu.instructions });
    // Without a follow-up it works as before.
    const v3 = visit("P003").visitNumber;
    expect(changeToOutpatient(v3, "Admitted by mistake").ok).toBe(true);
    expect(followUpsOf(v3)).toHaveLength(0);
  });

  it("moves a visit to the right patient with A45, audited, only for a role that may send ADT", () => {
    const v = visit("P007").visitNumber;
    switchUser("U4"); // pharmacist: no adt.send
    expect(moveVisit(v, "P010", "Registered on the wrong patient").ok).toBe(false);
    expect(auditLog().some((a) => a.action === "denied" && a.target === `Move visit ${v}`)).toBe(true);
    switchUser("U9");
    expect(moveVisit(v, "P010", "").ok).toBe(false);
    expect(moveVisit(v, "P007", "Registered on the wrong patient").ok).toBe(false);
    expect(getState().encounters.find((e) => e.visitNumber === v)!.patientId).toBe("P007");
    const out = moveVisit(v, "P010", "Other", "Same family name at the desk");
    expect(out.ok).toBe(true);
    expect(out.entry?.trigger).toBe("A45");
    expect(out.entry?.segments).toContain("MRG");
    expect(out.entry?.patientId).toBe("P010");
    const e = getState().encounters.find((x) => x.visitNumber === v)!;
    expect(e.patientId).toBe("P010");
    expect(e.moves?.[0]).toMatchObject({ fromPatientId: "P007", toPatientId: "P010", reason: "Other: Same family name at the desk", controlId: out.entry?.controlId });
    expect(auditLog().some((a) => a.action === "update" && a.target === `Move visit ${v}` && /Same family name/.test(a.detail ?? ""))).toBe(true);
    // A discharged visit can be moved too.
    expect(moveVisit(visit("P009").visitNumber, "P010", "Wrong ID card scanned").ok).toBe(true);
  });

  it("admits and pre-admits with the admitting diagnosis in the message and the details saved", () => {
    const appendix = { code: "K35.80", text: "Acute appendicitis, unspecified", type: "A" as const };
    const pre = quickCreate("A05", {
      patientId: "P010", attending: "D1002", service: "SUR", reason: "Planned appendectomy", expectedAdmitAt: nowLocal(600), consulting: "D1001", dx: [appendix],
      admission: { patientCondition: "Stable", expectedStayDays: 2, attendantName: "Sara Alkhaldi", attendantPhone: "0559876543", attendantRelation: "Wife", notes: " " },
    });
    expect(pre.ok).toBe(true);
    expect(pre.entry?.segments).toContain("DG1");
    expect(pre.entry?.message).toContain("K35.80");
    const p = visit("P010");
    expect(p.dx).toHaveLength(1);
    expect(p.dx[0]).toMatchObject({ code: "K35.80", type: "A" });
    expect(p.consulting).toBe("D1001");
    expect(p.admission).toEqual({ patientCondition: "Stable", expectedStayDays: 2, attendantName: "Sara Alkhaldi", attendantPhone: "0559876543", attendantRelation: "Wife" });

    const adm = quickCreate("A01", {
      patientId: "P010", attending: "D1002", service: "SUR", reason: "", bedId: "401-A",
      dx: [appendix, { code: "E11.9", text: "Type 2 diabetes mellitus without complications", type: "W" }], admission: { activityLevel: "Bed Rest" },
    });
    expect(adm.ok).toBe(true);
    expect(adm.entry?.message).toContain("E11.9");
    const a = visit("P010");
    expect(a.status).toBe("active");
    expect(a.dx.map((d) => d.code)).toEqual(["K35.80", "E11.9"]);
    expect(a.admission).toMatchObject({ patientCondition: "Stable", activityLevel: "Bed Rest" });
    // Without a diagnosis nothing changes: no DG1.
    const plain = quickCreate("A04", { patientId: "P006", attending: "D1001", service: "OPD", reason: "Review" });
    expect(plain.entry?.segments).not.toContain("DG1");
  });
});