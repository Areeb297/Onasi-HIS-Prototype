import { describe, expect, it } from "vitest";
import { hijri, isExpired, lookupById, retrieveIdCard, retrieveInsurance, REGISTRY } from "./registry";
import { emptyForm, planMessage, seedState } from "./store";

describe("registry and cards", () => {
  it("finds a person by ID and returns nothing for an unknown ID", () => {
    expect(lookupById("1000000011")?.family).toBe("Almutairi");
    expect(lookupById("0000000000")).toBeUndefined();
  });

  it("returns the insurance card with its status, including an expired one", () => {
    expect(retrieveInsurance("1000000011")?.status).toBe("Active");
    expect(retrieveInsurance("1000000029")?.status).toBe("Expired");
    expect(retrieveInsurance("2000000045")).toBeUndefined();
  });

  it("returns the ID card", () => {
    expect(retrieveIdCard("2000000037")?.idType).toBe("Iqama");
  });

  it("every test person has a Health ID and 10 digit ID", () => {
    for (const p of REGISTRY) {
      expect(p.idNumber).toMatch(/^\d{10}$/);
      expect(p.healthId).toBeTruthy();
    }
  });

  it("shows a Hijri date from the Umm al-Qura calendar", () => {
    expect(hijri("2026-11-09")).toMatch(/1448/);
    expect(hijri("")).toBe("");
  });

  it("flags expired dates", () => {
    expect(isExpired("2000-01-01")).toBe(true);
    expect(isExpired("2999-01-01")).toBe(false);
  });
});

describe("registration in the ADT message", () => {
  it("puts the second and third names after the first name in PID-5", () => {
    let state = seedState();
    state = {
      ...state,
      patients: [
        ...state.patients,
        {
          id: "P950", mrn: "MRN950", nationalId: "1", family: "Almutairi", given: "Saad", dob: "1968-03-14", sex: "M",
          healthId: "1090000001", nationality: "682", maritalStatus: "M", address: "RHAD3100",
          extra: { secondName: "Fahad", thirdName: "Nasser" },
        },
      ],
    };
    const f = emptyForm(state, "A04");
    f.patientId = "P950";
    f.cls = "O";
    const plan = planMessage(state, "A04", f);
    expect(plan.message).toContain("Almutairi^Saad^Fahad Nasser");
  });
});
