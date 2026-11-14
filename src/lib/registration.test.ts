import { describe, expect, it } from "vitest";
import type { Patient } from "./model";
import {
  ageLabel, arabicName, buildFlags, coverageOutcome, findDuplicates, flagViews, phoneKey, validateRegistration, type RegistrationInput,
} from "./registration";
import { REGISTRY, lookupById, registryNameAr, retrieveInsurance } from "./registry";
import { seedState } from "./store";

const patient = (over: Partial<Patient>): Patient => ({
  id: "P900", mrn: "MRN900", nationalId: "1000009999", family: "Alomari", given: "Sami", dob: "1980-02-03", sex: "M",
  healthId: "1099999999", nationality: "SAU", maritalStatus: "S", address: "", ...over,
});

describe("duplicate patient check", () => {
  const onFile = [
    patient({}),
    patient({ id: "P901", mrn: "MRN901", nationalId: "1000008888", healthId: "1098888888", given: "Huda", family: "Alnajjar", dob: "1995-06-07", extra: { idNumber: "2000001234", mobile: "0501234567", nameAr: { first: "هدى", second: "", third: "", family: "النجار" } } }),
  ];

  it("finds nobody for a new person", () => {
    expect(findDuplicates({ idNumber: "1000000001", healthId: "1090000999", given: "New", family: "Person", dob: "2000-01-01", mobile: "0509999999" }, onFile)).toEqual([]);
  });

  it("matches the same ID number, from the entered ID or the file ID", () => {
    expect(findDuplicates({ idNumber: "2000001234" }, onFile)[0]).toMatchObject({ patient: { id: "P901" }, reasons: ["id"] });
    expect(findDuplicates({ idNumber: "1000009999" }, onFile)[0].patient.id).toBe("P900");
  });

  it("matches the same Health ID", () => {
    expect(findDuplicates({ healthId: " 1099999999 " }, onFile)[0]).toMatchObject({ patient: { id: "P900" }, reasons: ["healthId"] });
  });

  it("matches the same name and date of birth, whatever the letter case or spacing", () => {
    expect(findDuplicates({ given: "  sami", family: "ALOMARI ", dob: "1980-02-03" }, onFile)[0].reasons).toEqual(["name-dob"]);
    expect(findDuplicates({ given: "Sami", family: "Alomari", dob: "1980-02-04" }, onFile)).toEqual([]);
    expect(findDuplicates({ given: "Sami", family: "Alomari" }, onFile)).toEqual([]);
  });

  it("matches the Arabic name and date of birth", () => {
    expect(findDuplicates({ givenAr: "هدى", familyAr: "النجار", dob: "1995-06-07" }, onFile)[0].patient.id).toBe("P901");
  });

  it("matches the same mobile and date of birth, however the number is written", () => {
    expect(findDuplicates({ mobile: "+966 50 123 4567", dob: "1995-06-07" }, onFile)[0].reasons).toEqual(["phone-dob"]);
    expect(findDuplicates({ mobile: "0501234567", dob: "1990-01-01" }, onFile)).toEqual([]);
    expect(phoneKey("00966501234567")).toBe(phoneKey("501234567"));
    expect(phoneKey("12")).toBe("");
  });

  it("puts ID matches before name matches and lists every reason", () => {
    const list = [patient({ id: "P1", healthId: "1", nationalId: "1" }), patient({ id: "P2" })];
    const m = findDuplicates({ healthId: "1099999999", given: "Sami", family: "Alomari", dob: "1980-02-03" }, list);
    expect(m.map((x) => x.patient.id)).toEqual(["P2", "P1"]);
    expect(m[0].reasons).toEqual(["healthId", "name-dob"]);
  });

  it("treats a registry person who is already a patient as a duplicate, and a new registry person as new", () => {
    const patients = seedState().patients;
    const saad = lookupById("1000000011")!;
    expect(findDuplicates({ idNumber: saad.idNumber, healthId: saad.healthId, given: saad.first, family: saad.family, dob: saad.dob, mobile: saad.mobile }, patients)[0].patient.id).toBe("P001");
    for (const id of ["2000000037", "2000000045", "1000000201", "1000000219", "2000000227"]) {
      const r = lookupById(id)!;
      expect(findDuplicates({ idNumber: r.idNumber, healthId: r.healthId, given: r.first, family: r.family, dob: r.dob, mobile: r.mobile }, patients), id).toEqual([]);
    }
  });
});

describe("coverage answer", () => {
  const today = "2026-11-14";

  it("says covered for an active policy", () => {
    const o = coverageOutcome(retrieveInsurance("1000000011"), today);
    expect(o).toMatchObject({ kind: "covered", blocking: false, warning: false });
  });

  it("stops the visit for a policy that ended or has not started", () => {
    expect(coverageOutcome(retrieveInsurance("1000000029"), today)).toMatchObject({ kind: "not-active", blocking: true });
    expect(coverageOutcome(retrieveInsurance("2000000037"), "2026-01-01")).toMatchObject({ kind: "not-active", blocking: true });
    expect(coverageOutcome({ ...retrieveInsurance("1000000011")!, expiryDate: "2026-06-30" }, today).kind).toBe("not-active");
  });

  it("stops the visit when not covered, out of network or no insurance was found", () => {
    expect(coverageOutcome(retrieveInsurance("2000000227"), today)).toMatchObject({ kind: "not-covered", blocking: true });
    expect(coverageOutcome(retrieveInsurance("1000000201"), today)).toMatchObject({ kind: "out-of-network", blocking: true });
    expect(coverageOutcome(retrieveInsurance("2000000045"), today)).toMatchObject({ kind: "no-insurance", blocking: true });
  });

  it("only warns when the limit is used up", () => {
    expect(coverageOutcome(retrieveInsurance("1000000219"), today)).toMatchObject({ kind: "limit-exhausted", blocking: false, warning: true });
  });

  it("explains every answer in English and Arabic", () => {
    for (const p of REGISTRY) {
      const o = coverageOutcome(p.insurance, today);
      expect(o.text.length).toBeGreaterThan(10);
      expect(o.textAr.length).toBeGreaterThan(10);
    }
  });
});

describe("names, age and flags", () => {
  it("joins the Arabic name and skips empty parts", () => {
    expect(arabicName(patient({ extra: { nameAr: { first: "سعد", second: "", third: "ناصر", family: "المطيري" } } }))).toBe("سعد ناصر المطيري");
    expect(arabicName(patient({}))).toBe("");
    expect(registryNameAr(lookupById("1000000011")!)).toBe("سعد فهد ناصر المطيري");
  });

  it("every registry person has an English and an Arabic four-part name", () => {
    for (const p of REGISTRY) {
      for (const part of [p.first, p.second, p.third, p.family, p.firstAr, p.secondAr, p.thirdAr, p.familyAr]) expect(part, p.idNumber).toBeTruthy();
    }
  });

  it("works out the age from the date of birth", () => {
    const now = new Date("2026-11-14T10:00:00");
    expect(ageLabel("1968-03-14", now)).toBe("58 years");
    expect(ageLabel("2026-04-10", now)).toBe("7 months");
    expect(ageLabel("", now)).toBe("");
    expect(ageLabel("2030-01-01", now)).toBe("");
  });

  it("stores only the flags that are on", () => {
    expect(buildFlags({ dnr: false, dnrDoctor: "", dnrDate: "", interpreter: false, language: "", fallRisk: false, isolation: false })).toBeUndefined();
    const f = buildFlags({ dnr: true, dnrDoctor: "Dr. Khalid Alharbi", dnrDate: "2026-11-01", interpreter: true, language: "Urdu", fallRisk: true, isolation: false });
    expect(f).toEqual({ dnr: { doctor: "Dr. Khalid Alharbi", date: "2026-11-01" }, interpreter: { language: "Urdu" }, fallRisk: true });
  });

  it("lists flags as labelled badges, the most serious first", () => {
    const v = flagViews({ fallRisk: true, interpreter: { language: "Urdu" }, isolation: true, dnr: { doctor: "Dr. Khalid Alharbi", date: "2026-11-01" } });
    expect(v.map((x) => x.label)).toEqual(["Do Not Resuscitate", "Isolation", "Fall Risk", "Needs Interpreter: Urdu"]);
    expect(v[0].detail).toBe("Dr. Khalid Alharbi, 2026-11-01");
    expect(flagViews(undefined)).toEqual([]);
  });
});

describe("registration form checks", () => {
  const ok: RegistrationInput = {
    idNumber: "1000000011", healthId: "1090000001", first: "Saad", family: "Almutairi", dob: "1968-03-14", mobile: "0500000011", email: "",
    shortCode: "RHAD3100", consent: true, visit: "O", bedId: "", dnr: false, dnrDoctor: "", dnrDate: "", interpreter: false, language: "", today: "2026-11-14",
  };
  const fields = (i: Partial<RegistrationInput>) => validateRegistration({ ...ok, ...i }).map((p) => p.field);

  it("passes a complete form", () => {
    expect(validateRegistration(ok)).toEqual([]);
    expect(fields({ visit: "none" })).toEqual([]);
  });

  it("names each missing required field", () => {
    expect(fields({ idNumber: "", healthId: "", first: " ", family: "", dob: "", mobile: "", consent: false }))
      .toEqual(["idNumber", "first", "family", "dob", "mobile", "healthId", "consent"]);
  });

  it("checks the date of birth, short address, mobile and email", () => {
    expect(fields({ dob: "2027-01-01" })).toEqual(["dob"]);
    expect(fields({ shortCode: "abc" })).toEqual(["shortCode"]);
    expect(fields({ shortCode: "" })).toEqual([]);
    expect(fields({ mobile: "123" })).toEqual(["mobile"]);
    expect(fields({ email: "not-an-email" })).toEqual(["email"]);
    expect(fields({ email: "a@b.sa" })).toEqual([]);
  });

  it("needs a bed only for an inpatient visit", () => {
    expect(fields({ visit: "I" })).toEqual(["bedId"]);
    expect(fields({ visit: "I", bedId: "301-A" })).toEqual([]);
    expect(fields({ visit: "E" })).toEqual([]);
  });

  it("needs the doctor and date for Do Not Resuscitate, and the language for an interpreter", () => {
    expect(fields({ dnr: true })).toEqual(["dnrDoctor", "dnrDate"]);
    expect(fields({ dnr: true, dnrDoctor: "D1001", dnrDate: "2027-01-01" })).toEqual(["dnrDate"]);
    expect(fields({ dnr: true, dnrDoctor: "D1001", dnrDate: "2026-11-10" })).toEqual([]);
    expect(fields({ interpreter: true })).toEqual(["language"]);
  });

  it("has an Arabic line for every problem", () => {
    for (const p of validateRegistration({ ...ok, idNumber: "", first: "", family: "", dob: "", mobile: "", email: "x", shortCode: "x", healthId: "", consent: false, visit: "I", dnr: true, interpreter: true })) {
      expect(p.messageAr.length, p.field).toBeGreaterThan(3);
    }
  });
});
