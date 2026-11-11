import { describe, expect, it } from "vitest";
import { EVENTS, EVENT_BY_ID } from "./spec";
import { emptyForm, eligible, formFromEncounter, planMessage, seedState, sendOn } from "./store";
import { pretty } from "./hl7";

describe("segment table", () => {
  it("has the 15 events plus the CNHI variant", () => {
    expect(EVENTS.length).toBe(16);
  });
  it("A45 and A50 need MRG and no PV2", () => {
    for (const id of ["A45", "A50"] as const) {
      expect(EVENT_BY_ID[id].segments.MRG).toBe("R");
      expect(EVENT_BY_ID[id].segments.PV2).toBe("-");
    }
  });
  it("A03 needs DG1", () => {
    expect(EVENT_BY_ID.A03.segments.DG1).toBe("R");
  });
});

describe("message builder", () => {
  it("builds a valid A01 from a fresh form", () => {
    const state = seedState();
    const f = emptyForm(state, "A01");
    f.patientId = "P007";
    f.bedId = "402-A";
    const plan = planMessage(state, "A01", f);
    expect(plan.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(plan.message.startsWith("MSH|^~\\&|^2.16.840.1.113883.3.3731.9999.1^ISO|^DEMO-HOSP-01^ISO|^2.16.840.1.113883.3.3731.1.2.2^ISO")).toBe(true);
    expect(plan.message).toContain("ADT^A01^ADT_A01");
    expect(plan.message).toContain("PV1|1|I|");
  });

  it("flags a missing DG1 on A03", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const f = formFromEncounter(state, "A03", enc);
    const plan = planMessage(state, "A03", f, { DG1: false });
    expect(plan.checks.some((c) => c.level === "error" && c.text.includes("DG1 is required"))).toBe(true);
  });

  it("treats AL1 on A03 as ignored, not an error", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const f = formFromEncounter(state, "A03", enc);
    const plan = planMessage(state, "A03", f, { AL1: true });
    expect(plan.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(plan.checks.some((c) => c.text.includes("AL1 is ignored by nphies"))).toBe(true);
  });

  it("flags AL1 on A02", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const f = formFromEncounter(state, "A02", enc);
    f.bedId = "302-A";
    const plan = planMessage(state, "A02", f, { AL1: true });
    expect(plan.checks.some((c) => c.level === "error" && c.text.includes("AL1 must not be present"))).toBe(true);
  });

  it("puts MRG before PV1 for A45", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P004")!;
    const f = formFromEncounter(state, "A45", enc);
    f.correctPatientId = "P008";
    const plan = planMessage(state, "A45", f);
    const lines = pretty(plan.message).split("\n").map((l) => l.slice(0, 3));
    expect(lines).toEqual(["MSH", "EVN", "PID", "MRG", "PV1"]);
    expect(plan.checks.filter((c) => c.level === "error")).toEqual([]);
  });

  it("A12 carries the prior location in PV1-6", () => {
    let state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const f2 = formFromEncounter(state, "A02", enc);
    f2.bedId = "302-A";
    state = sendOn(state, "A02", f2).state;
    const enc2 = state.encounters.find((e) => e.patientId === "P001")!;
    expect(eligible("A12", enc2)).toBe(true);
    const f12 = formFromEncounter(state, "A12", enc2);
    const plan = planMessage(state, "A12", f12);
    expect(plan.message).toMatch(/PV1\|1\|I\|3A\^301\^A\^DEMO-HOSP-01\|\|\|3A\^302\^A/);
  });
});

describe("A04 patient registration", () => {
  it("sends the Health ID with its OID, demographics, and the referring doctor", () => {
    let state = seedState();
    state = {
      ...state,
      patients: [
        ...state.patients,
        {
          id: "P900", mrn: "MRN900", nationalId: "1", family: "Testfam", given: "Testgiven", dob: "1990-05-05", sex: "F",
          healthId: "1090009999", nationality: "682", maritalStatus: "M", address: "RHAD3100",
        },
      ],
    };
    const f = emptyForm(state, "A04");
    f.patientId = "P900";
    f.cls = "O";
    f.referring = "D1002";
    const plan = planMessage(state, "A04", f);
    expect(plan.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(plan.checks.filter((c) => c.level === "warn")).toEqual([]);
    expect(plan.message).toContain("PID|1||1090009999^^^&2.16.840.1.113883.3.3731.1.1.100.1&ISO||Testfam^Testgiven||19900505|F|||RHAD3100");
    expect(plan.message).toContain("|M|"); // PID-16
    expect(plan.message).toMatch(/\|682(\r|$)/); // PID-28
    expect(plan.message).toContain("D1002^Alzahrani^Noura^^^Dr^^^&2.16.840.1.113883.3.3731.1.2.1&ISO"); // PV1-8
    expect(plan.message).toContain("^^^&2.16.840.1.113883.3.3731.9999.1&ISO^VN"); // PV1-19
  });

  it("rejects a message with no Health ID and warns about a bad address", () => {
    let state = seedState();
    state = {
      ...state,
      patients: [
        ...state.patients,
        {
          id: "P901", mrn: "MRN901", nationalId: "1", family: "A", given: "B", dob: "1990-05-05", sex: "M",
          healthId: "", nationality: "", maritalStatus: "", address: "bad",
        },
      ],
    };
    const f = emptyForm(state, "A04");
    f.patientId = "P901";
    f.cls = "O";
    const plan = planMessage(state, "A04", f);
    expect(plan.checks.some((c) => c.level === "error" && c.text.includes("Health ID is required"))).toBe(true);
    expect(plan.checks.some((c) => c.level === "warn" && c.text.includes("PID-11"))).toBe(true);
    expect(plan.checks.some((c) => c.level === "warn" && c.text.includes("PV1-8"))).toBe(true);
  });
});

describe("state transitions", () => {
  it("runs A05, A01, A02, A03, A13 with no errors", () => {
    let state = seedState();
    const pid = "P009";
    let f = emptyForm(state, "A05");
    f.patientId = pid;
    f.expectedAdmitAt = "2026-12-01T08:00";
    const visit = f.visitNumber;
    let r = sendOn(state, "A05", f);
    expect(r.entry.errors).toBe(0);
    state = r.state;

    let enc = state.encounters.find((e) => e.visitNumber === visit)!;
    f = formFromEncounter(state, "A01", enc);
    f.bedId = "402-A";
    r = sendOn(state, "A01", f);
    expect(r.entry.errors).toBe(0);
    state = r.state;
    enc = state.encounters.find((e) => e.visitNumber === visit)!;
    expect(enc.status).toBe("active");

    f = formFromEncounter(state, "A02", enc);
    f.bedId = "402-B";
    r = sendOn(state, "A02", f);
    expect(r.entry.errors).toBe(0);
    state = r.state;
    enc = state.encounters.find((e) => e.visitNumber === visit)!;

    f = formFromEncounter(state, "A03", enc);
    r = sendOn(state, "A03", f);
    expect(r.entry.errors).toBe(0);
    state = r.state;
    enc = state.encounters.find((e) => e.visitNumber === visit)!;
    expect(enc.status).toBe("discharged");

    f = formFromEncounter(state, "A13", enc);
    r = sendOn(state, "A13", f);
    expect(r.entry.errors).toBe(0);
    state = r.state;
    expect(state.encounters.find((e) => e.visitNumber === visit)!.status).toBe("active");
  });

  it("A50 changes the visit number", () => {
    let state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const old = enc.visitNumber;
    const f = formFromEncounter(state, "A50", enc);
    const r = sendOn(state, "A50", f);
    expect(r.entry.errors).toBe(0);
    state = r.state;
    expect(state.encounters.some((e) => e.visitNumber === old)).toBe(false);
    expect(r.entry.message).toContain(`MRG|`);
  });
});

describe("every event", () => {
  it("builds a message with no errors from the seed data", () => {
    const state = seedState();
    for (const e of EVENTS) {
      const id = e.id;
      if (id === "A12") continue; // needs a prior transfer, covered above
      let f;
      if (["A01", "A04", "A05"].includes(id)) {
        f = emptyForm(state, id);
        f.patientId = "P008";
        if (id === "A01") f.bedId = "402-A";
        if (id === "A05") f.expectedAdmitAt = "2026-12-01T08:00";
      } else {
        const enc = state.encounters.find((x) => eligible(id, x));
        expect(enc, `no visit for ${id}`).toBeTruthy();
        f = formFromEncounter(state, id, enc!);
        if (id === "A02") f.bedId = "302-A";
        if (id === "A06") f.bedId = "402-A";
        if (id === "A45") f.correctPatientId = enc!.patientId === "P009" ? "P010" : "P009";
      }
      const r = sendOn(state, id, f);
      expect(r.entry.errors, `${id}: ${r.entry.checks.filter((c) => c.level === "error").map((c) => c.text).join("; ")}`).toBe(0);
    }
  });
});
