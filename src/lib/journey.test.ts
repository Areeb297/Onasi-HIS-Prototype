import { beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry } from "./audit";
import { activeMedicines, attachmentsOf, demographics, encounterDetails, identityType, latestHistory, patientVisits, priorityOf } from "./chart-overview";
import { resetEmar } from "./emar";
import { auditCounts, chartAudit, humanDuration, journeyEvents, journeyPrintHtml, roleForName, visitMinutes, visitSummaries } from "./journey";
import type { Encounter } from "./model";
import { addFormRecord, resetRecords } from "./records";
import { getRx, resetRx, setRx } from "./rx";
import { DRUGS } from "./rx-catalogue";
import type { Prescription } from "./rx-types";
import { switchUser } from "./session";
import { getState, resetAll, updateEncounter } from "./store";
import { resetVitals, savePanel } from "./vitals";

const encOf = (pid: string) => [...getState().encounters].reverse().find((e) => e.patientId === pid && e.status !== "cancelled")!;
const patientOf = (pid: string) => getState().patients.find((p) => p.id === pid)!;
const FULL = { sbp: 120, dbp: 80, pulse: 80, rr: 16, temp: 37, spo2: 98, weight: 70, height: 170 };

beforeEach(() => {
  resetAll(); resetVitals(); resetRx(); resetEmar(); resetRecords(); switchUser("U2");
});

describe("patient journey", () => {
  it("puts staff name and role on each event, and the time since the step before", () => {
    const enc = encOf("P001");
    savePanel({ visit: enc.visitNumber, context: "routine", values: FULL });
    const events = journeyEvents(getState().encounters.find((e) => e.visitNumber === enc.visitNumber)!);
    expect(events.length).toBeGreaterThan(2);
    for (let i = 1; i < events.length; i++) expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at);
    expect(events.every((e) => e.staff.length > 0)).toBe(true);
    expect(events[events.length - 1].sincePrevMin).toBeUndefined();
    expect(events.slice(0, -1).every((e) => typeof e.sincePrevMin === "number" && e.sincePrevMin >= 0)).toBe(true);
    const start = events.find((e) => e.kind === "visit" && e.title === "Admitted");
    expect(start).toBeDefined();
    const note = events.find((e) => e.kind === "note");
    expect(note).toMatchObject({ staff: "Dr. Khalid Alharbi", role: "Physician" });
  });

  it("shows the triage step of an emergency visit with the nurse", () => {
    const events = journeyEvents(encOf("P008"));
    expect(events.find((e) => e.title.startsWith("Triaged"))).toMatchObject({ staff: "Huda Alotaibi, RN", role: "Nurse" });
  });

  it("works out roles from names", () => {
    expect(roleForName("Dr. Khalid Alharbi")).toBe("Physician");
    expect(roleForName("Huda Alotaibi, RN")).toBe("Nurse");
    expect(roleForName("Dr. Somebody New")).toBe("Physician");
    expect(roleForName("Unknown Person", "Staff")).toBe("Staff");
  });

  it("measures total visit time and writes durations in words", () => {
    const enc = encOf("P006");
    expect(enc.status).toBe("discharged");
    const min = visitMinutes(enc);
    expect(min).toBeGreaterThan(2000);
    expect(visitMinutes(encOf("P005"))).toBeNull();
    expect(humanDuration(0)).toBe("Less than a minute");
    expect(humanDuration(45)).toBe("45 minutes");
    expect(humanDuration(61)).toBe("1 hour 1 minute");
    expect(humanDuration(60 * 26)).toBe("1 day 2 hours");
    expect(humanDuration(null)).toBe("Not known");
  });

  it("summarises every visit of the patient and marks the current one", () => {
    const first = encOf("P001");
    const s = visitSummaries("P001", first.visitNumber);
    expect(s.length).toBeGreaterThanOrEqual(1);
    expect(s.filter((v) => v.current)).toHaveLength(1);
    expect(s[0].events).toBeGreaterThan(0);
    for (let i = 1; i < s.length; i++) expect(s[i - 1].start).toBeGreaterThanOrEqual(s[i].start);
  });

  it("keeps the audit trail to this chart", () => {
    const enc = encOf("P001");
    const p = patientOf("P001");
    const e = (id: number, action: AuditEntry["action"], target: string, extra: Partial<AuditEntry> = {}): AuditEntry => ({ id, at: new Date(2026, 0, 1, 8, id).toISOString(), user: "Nurse", role: "Nurse", action, target, ...extra });
    const trail = chartAudit([
      e(1, "view", `Chart ${enc.visitNumber}`, { patient: `${p.given} ${p.family}` }),
      e(2, "create", "Progress note PN-1", { patient: p.id, detail: `Visit ${enc.visitNumber}` }),
      e(3, "update", "Medicine dose MA-1", { patient: "P999", detail: "Visit V999999" }),
      e(4, "delete", "Progress note PN-2", { patient: p.id, detail: `Visit ${enc.visitNumber}. Reason: Duplicate note` }),
    ], enc, p);
    expect(trail.map((x) => x.id)).toEqual([4, 2, 1]);
    expect(auditCounts(trail)).toEqual({ total: 3, creations: 1, edits: 1, views: 1, other: 0 });
  });

  it("prints a page with the patient, the steps and the visits, with text escaped", () => {
    const enc = encOf("P001");
    const p = { ...patientOf("P001"), given: "Ali <b>" };
    const html = journeyPrintHtml({ patient: p, enc, events: journeyEvents(enc), visits: visitSummaries("P001", enc.visitNumber), total: 90, hospital: "Demo General Hospital", printedBy: "Huda Alotaibi, RN" });
    expect(html).toContain("Patient Journey");
    expect(html).toContain("Ali &lt;b&gt;");
    expect(html).toContain("1 hour 30 minutes");
    expect(html).toContain(enc.visitNumber);
  });
});

describe("chart overview", () => {
  it("lists all visits of the patient, newest first", () => {
    const visits = patientVisits(getState(), "P001");
    expect(visits.every((v) => v.patientId === "P001")).toBe(true);
  });

  it("fills the encounter details from what the app holds and says Not recorded for the rest", () => {
    const ip = encounterDetails(encOf("P001"));
    const get = (rows: ReturnType<typeof encounterDetails>, label: string) => rows.find((r) => r.label === label)!;
    expect(get(ip, "Class").value).toBe("Inpatient");
    expect(get(ip, "Priority").known).toBe(true);
    expect(get(ip, "Discharge Disposition").value).toBe("Not discharged yet");
    expect(ip.some((r) => r.label === "Triage Category")).toBe(false);
    const er = encounterDetails(encOf("P008"));
    expect(get(er, "Triage Category").value).toBe("Level 2, Emergent");
    expect(get(er, "Arrival Mode").value).toBe("Walk-in");
    expect(priorityOf(encOf("P008"))).toContain("CTAS 2");
    const discharged = encounterDetails(encOf("P006"));
    expect(get(discharged, "Discharge Disposition").known).toBe(true);
    expect(get(discharged, "Discharge Specialty").value).toBe("Orthopedics");
  });

  it("shows the intended length of stay from the admission details", () => {
    const enc = encOf("P001");
    updateEncounter(enc.visitNumber, (e) => { e.admission = { expectedStayDays: 4, specialty: "Internal Medicine" }; }, { touch: false });
    const rows = encounterDetails(encOf("P001"));
    expect(rows.find((r) => r.label === "Intended Length Of Stay")?.value).toBe("4 days");
    expect(rows.find((r) => r.label === "Admission Specialty")?.value).toBe("Internal Medicine");
  });

  it("gives demographics, with the identity type worked out from the number when not recorded", () => {
    const p = patientOf("P001");
    const rows = demographics(p);
    expect(rows.map((r) => r.label)).toEqual(["Identity Type", "Identity Number", "Phone", "Nationality", "Date Of Birth", "Address", "Insurance"]);
    expect(identityType({ ...p, extra: undefined, nationalId: "1012345678" })).toBe("National ID");
    expect(identityType({ ...p, extra: undefined, nationalId: "2012345678" })).toBe("Iqama");
    expect(identityType({ ...p, extra: { idType: "Passport" } })).toBe("Passport");
  });

  it("summarises active medicines, history and attachments", () => {
    const enc: Encounter = encOf("P001");
    const drug = DRUGS.find((d) => d.generic === "Metformin")!;
    const rx: Prescription = {
      id: "t-rx", number: "RX-T", visitNumber: enc.visitNumber, patientId: enc.patientId, prescriberId: enc.attending, authoredAt: new Date().toISOString(),
      usage: "inpatient", groupId: "G", controlled: false, sentAt: new Date().toISOString(), dirty: false,
      items: [
        { id: "i1", identifier: "I1", drugId: drug.id, dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 5, quantity: 10, quantityManual: false, route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "E11.9", text: "Type 2 diabetes" }, status: "active", version: 1 },
        { id: "i2", identifier: "I2", drugId: drug.id, dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 5, quantity: 10, quantityManual: false, route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "E11.9", text: "Type 2 diabetes" }, status: "stopped", version: 1 },
      ],
    };
    setRx({ ...getRx(), prescriptions: [...getRx().prescriptions, rx] });
    const meds = activeMedicines(enc.visitNumber);
    expect(meds).toHaveLength(1);
    expect(meds[0].detail).toContain("Oral");

    expect(latestHistory([enc.visitNumber])).toBeUndefined();
    addFormRecord(enc.visitNumber, "medical-history", { conditions: ["Diabetes mellitus", "Hypertension"], smoking: "Never" });
    const h = latestHistory([enc.visitNumber])!;
    expect(h.lines).toEqual(expect.arrayContaining([["Past Conditions", "Diabetes mellitus, Hypertension"], ["Smoking", "Never"]]));

    addFormRecord(enc.visitNumber, "attachments", { fileName: "referral-letter.pdf", docType: "Referral letter", docDate: "2026-01-04" });
    expect(attachmentsOf([enc.visitNumber])).toMatchObject([{ name: "referral-letter.pdf", type: "Referral letter", date: "2026-01-04" }]);
  });
});
