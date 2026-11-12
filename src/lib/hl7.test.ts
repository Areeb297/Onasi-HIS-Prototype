import { describe, expect, it } from "vitest";
import { EVENTS, EVENT_BY_ID } from "./spec";
import { emptyForm, eligible, formFromEncounter, planMessage, seedState, sendOn } from "./store";
import { ED_ARRIVAL_CODE, ED_DISPOSITION_CODE, pretty, ts } from "./hl7";
import { VS } from "./nphies-valuesets";
import { ALLERGY_SAMPLES, DISPOSITIONS, NATIONALITIES, PR_SAMPLES, SERVICES } from "./reference-data";

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
    expect(plan.message.startsWith("MSH|^~\\&|^2.16.840.1.113883.3.3731.5.1.15000000999999.1^ISO|^15000000999999^ISO|^2.16.840.1.113883.3.3731.1.2.2^ISO")).toBe(true);
    expect(plan.message).toContain("ADT^A01^ADT_A01");
    expect(plan.message).toContain("PV1|1|I|");
    // PV1-4 admission method is required: 14 is "Elective, Other".
    expect(plan.message).toMatch(/PV1\|1\|I\|[^|]*\|14\|/);
    // PV1-10 is a published medical unit code, not the HIS service code.
    expect(plan.message.split("\r").find((l) => l.startsWith("PV1|"))!.split("|")[10]).toBe("MX");
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
    expect(plan.message).toMatch(/PV1\|1\|I\|3A\^301\^A\^&15000000999999\|14\|\|3A\^302\^A\^&15000000999999/);
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
    expect(plan.message).toMatch(/\|SAU(\r|$)/); // PID-28: the old numeric code 682 is sent as the published code SAU
    expect(plan.message).toContain("D1002^Alzahrani^Noura^^^Dr^^^&2.16.840.1.113883.3.3731.1.2.1&ISO"); // PV1-8
    expect(plan.message).toContain("^^^&2.16.840.1.113883.3.3731.5.1.15000000999999&ISO^VN"); // PV1-19
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
    // A pre-admission is a status. The class is the one the patient will have (Inpatient), never "P" (primary care).
    expect(enc.status).toBe("preadmit");
    expect(enc.cls).toBe("I");
    expect(r.entry.message).toContain("PV1|1|I|");
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
    expect(f.dx).toEqual([]); // no diagnosis is invented for the discharge
    expect(sendOn(state, "A03", f).entry.errors).toBeGreaterThan(0); // DG1-3 is required
    f.dx = [{ code: "J18.9", text: "Pneumonia, unspecified organism", type: "F" }];
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

const line = (message: string, id: string) => message.split("\r").filter((l) => l.startsWith(`${id}|`));
const errorsOf = (plan: { checks: { level: string; text: string }[] }) => plan.checks.filter((c) => c.level === "error").map((c) => c.text);

describe("coded fields follow the published value sets", () => {
  it("every code list the app offers is inside its NPHIES value set", () => {
    for (const n of NATIONALITIES) expect(VS.country.has(n.code), n.code).toBe(true);
    for (const d of DISPOSITIONS) expect(VS.dischargeDisposition.has(d.code), d.code).toBe(true);
    for (const s of SERVICES) expect(VS.medicalUnit.has(s.unit), s.unit).toBe(true);
    for (const c of Object.values(ED_ARRIVAL_CODE)) expect(VS.edArrivalMode.has(c), c).toBe(true);
    for (const c of Object.values(ED_DISPOSITION_CODE)) if (c) expect(VS.edDisposition.has(c), c).toBe(true);
  });

  it("maps ED arrival and disposition to the published meanings", () => {
    expect(ED_ARRIVAL_CODE["Ground EMS Ambulance"]).toBe("1");
    expect(ED_ARRIVAL_CODE["Police Vehicle"]).toBe("9");
    expect(ED_ARRIVAL_CODE["Personal Vehicle"]).toBe("11");
    expect(ED_ARRIVAL_CODE["Walk-in"]).toBe("88");
    expect(ED_DISPOSITION_CODE.Admitted).toBe("1");
    expect(ED_DISPOSITION_CODE.Discharged).toBe("2");
    expect(ED_DISPOSITION_CODE["Left Without Being Seen"]).toBe("3");
    expect(ED_DISPOSITION_CODE.Transferred).toBe("5");
    expect(ED_DISPOSITION_CODE.Died).toBe("6");
  });

  it("sends DG1, PR1, AL1 and PV2 with the coding systems the guide names", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P001")!;
    const f = formFromEncounter(state, "A08", enc);
    f.consulting = "D1002";
    f.reasonCode = "V89.2";
    f.reason = "Injury after a motor vehicle accident";
    f.dx = [{ code: "E87.2", text: "Acidosis", type: "A", at: f.admitAt }, { code: "J18.9", text: "Pneumonia", type: "W" }];
    f.pr = [{ ...PR_SAMPLES[0], at: f.admitAt, surgeon: "D1002" }, { ...PR_SAMPLES[1], at: f.admitAt }];
    f.allergies = [{ ...ALLERGY_SAMPLES[3] }, { ...ALLERGY_SAMPLES[2] }, { text: "Unknown antibiotic", severity: "SV", reaction: "", type: "DALG" }];
    const plan = planMessage(state, "A08", f);
    expect(errorsOf(plan)).toEqual([]);
    const pv1 = line(plan.message, "PV1")[0].split("|");
    expect(pv1[9]).toBe("D1002^Alzahrani^Noura^^^Dr^^^&2.16.840.1.113883.3.3731.1.2.1&ISO"); // consulting doctor
    expect(line(plan.message, "PV2")[0]).toContain("V89.2^Injury after a motor vehicle accident^2.16.840.1.113883.6.135");
    const dg1 = line(plan.message, "DG1").map((l) => l.split("|"));
    expect(dg1[0][3]).toBe("E87.2^Acidosis^2.16.840.1.113883.6.135");
    expect(dg1[0][5]).toBe(ts(f.admitAt));
    expect(dg1[0][6]).toBe("A^Admitting");
    expect(dg1.map((d) => d[15])).toEqual(["1", "2"]);
    expect(dg1[1][5]).toBe(""); // no diagnosis time recorded, so none is made up
    const pr1 = line(plan.message, "PR1").map((l) => l.split("|"));
    expect(pr1[0][3]).toBe("44970-00^Laparoscopic appendicectomy^2.16.840.1.113883.3.3731.50.2");
    expect(pr1[0][5]).toBe(ts(f.admitAt));
    expect(pr1[0][6]).toBe("P");
    expect(pr1[0][11]).toContain("D1002^Alzahrani^Noura");
    expect(pr1[1][3]).toContain("^2.16.840.1.113883.3.3731.1.204.15"); // imaging
    expect(pr1[1][6]).toBe("D");
    const al1 = line(plan.message, "AL1").map((l) => l.split("|"));
    expect(al1[0][2]).toBe("FALG");
    expect(al1[0][3]).toBe("102263004^Eggs^2.16.840.1.113883.6.96");
    expect(al1[0][4]).toBe("MI^Mild^2.16.840.1.113883.18.55");
    expect(al1[1][2]).toBe("DALG");
    expect(al1[2][3]).toBe("^Unknown antibiotic"); // free text allergy: text component only
  });

  it("puts a reason in words in PV2-12, not in PV2-3", () => {
    const state = seedState();
    const f = emptyForm(state, "A04");
    f.patientId = "P008";
    f.reason = "Cough";
    const pv2 = line(planMessage(state, "A04", f).message, "PV2")[0].split("|");
    expect(pv2[3]).toBe("");
    expect(pv2[12]).toBe("Cough");
  });

  it("the validator rejects codes that are not in the value sets", () => {
    let state = seedState();
    state = { ...state, patients: state.patients.map((p) => (p.id === "P008" ? { ...p, maritalStatus: "X" } : p)) };
    const f = emptyForm(state, "A01");
    f.patientId = "P008";
    f.bedId = "402-A";
    f.admissionMethod = "77";
    f.service = "CARDIO";
    f.pr = [{ code: "38497-00", text: "Coronary angiography" }]; // no start time
    const errs = errorsOf(planMessage(state, "A01", f, { PR1: true })).join(" ");
    expect(errs).toContain("PV1-4");
    expect(errs).toContain("PID-16");
    expect(errs).toContain("PR1-5");
    // an unknown service has no published unit, so PV1-10 is left out instead of sending a local code
    expect(planMessage(state, "A01", f).message.split("\r").find((l) => l.startsWith("PV1|"))!.split("|")[10]).toBe("");
  });

  it("a procedure outside the stay is an error", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P006")!; // discharged
    const f = formFromEncounter(state, "A08-CNHI", enc);
    f.pr = [{ ...PR_SAMPLES[0], at: "2031-01-01T10:00" }];
    expect(errorsOf(planMessage(state, "A08-CNHI", f)).join(" ")).toContain("after the discharge time");
  });
});

describe("A08 discharge update (CNHI)", () => {
  it("sets ZPV1-8 to UPDATE, places Z-segments as in the guide, and limits PV1-4 and PV1-36", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P006")!;
    const f = formFromEncounter(state, "A08-CNHI", { ...enc, admissionMethod: "09", vitals: { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "84", height: "176", at: "" } });
    f.dx = [{ ...f.dx[0], onset: "2" }, { code: "E11.9", text: "Type 2 diabetes mellitus without complications", type: "F" }];
    f.pr = [{ ...f.pr[0], endAt: f.dischargeAt }];
    const state2 = { ...state, encounters: state.encounters.map((e) => (e.visitNumber === enc.visitNumber ? { ...e, vitals: { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "84", height: "176", at: "" } } : e)) };
    const plan = planMessage(state2, "A08-CNHI", f);
    expect(errorsOf(plan)).toEqual([]);
    const ids = pretty(plan.message).split("\n").map((l) => l.split("|")[0]);
    expect(ids).toEqual(["MSH", "EVN", "PID", "PV1", "ZPV1", "PV2", "DG1", "ZDG1", "DG1", "PR1", "ZPR1"]);
    const z = line(plan.message, "ZPV1")[0].split("|");
    expect(z[8]).toBe("UPDATE");
    expect(z[16]).toBe("27.1"); // BMI from 84 kg and 176 cm
    const pv1 = line(plan.message, "PV1")[0].split("|");
    expect(pv1[4]).toBe("14"); // 09 (elective waiting list) is sent as 14 Elective
    expect(pv1[10]).toBe(""); // hospital service is not sent for an inpatient discharge update
    expect(pv1[36]).toBe("306689006");
    expect(line(plan.message, "ZDG1")[0]).toBe("ZDG1|||2");
  });

  it("is an error without ZPV1", () => {
    const state = seedState();
    const enc = state.encounters.find((e) => e.patientId === "P006")!;
    const plan = planMessage(state, "A08-CNHI", formFromEncounter(state, "A08-CNHI", enc), { ZPV1: false });
    expect(errorsOf(plan).join(" ")).toContain("ZPV1 is missing");
  });
});

describe("A01 and A05 class choice", () => {
  it("A01 can activate a visit as outpatient without a bed", () => {
    const state = seedState();
    const f = emptyForm(state, "A01");
    f.patientId = "P010";
    f.cls = "O";
    const r = sendOn(state, "A01", f);
    expect(r.entry.errors).toBe(0);
    const enc = r.state.encounters.find((e) => e.visitNumber === f.visitNumber)!;
    expect(enc.cls).toBe("O");
    expect(eligible("A06", enc)).toBe(true);
  });
});
