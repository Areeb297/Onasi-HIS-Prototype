import { describe, expect, it } from "vitest";
import { dobFromAge, registerEmergency } from "./er-register";
import { getState } from "./store";

const last = () => {
  const s = getState();
  return s.log[s.log.length - 1];
};

describe("quick emergency registration", () => {
  it("registers an unidentified patient with only a sex and an approximate age, and the A04 is clean", () => {
    const before = getState().patients.length;
    const r = registerEmergency({ identity: { kind: "unknown", sex: "M", ageYears: 45 }, arrivalMode: "Ambulance", complaint: "Collapsed at work" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = getState();
    expect(s.patients.length).toBe(before + 1);
    const enc = s.encounters.find((e) => e.visitNumber === r.visit)!;
    const p = s.patients.find((x) => x.id === r.patientId)!;
    expect(enc.cls).toBe("E");
    expect(enc.status).toBe("active");
    expect(enc.ed).toMatchObject({ arrivalMode: "Ambulance", complaint: "Collapsed at work", temporaryId: true });
    expect(enc.ed?.triageAt).toBeUndefined(); // not triaged yet: the board shows Waiting For Triage
    expect(p.given).toBe("Unknown");
    expect(p.family).toMatch(/^Male \d+$/);
    expect(p.extra?.fileStatus).toBe("Temporary File");
    expect(p.healthId).toBeTruthy();
    expect(p.consentAt).toBeUndefined();
    const msg = last();
    expect(msg.trigger).toBe("A04");
    expect(msg.errors).toBe(0);
    expect(msg.message).toContain(p.healthId); // PID-3 carries the Health ID
    expect(msg.message).toContain("PV1|");
  });

  it("numbers unknown patients so two are never the same name", () => {
    const a = registerEmergency({ identity: { kind: "unknown", sex: "F", ageYears: 30 }, arrivalMode: "Police", complaint: "" });
    const b = registerEmergency({ identity: { kind: "unknown", sex: "F", ageYears: 30 }, arrivalMode: "Police", complaint: "" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const names = [a.patientId, b.patientId].map((id) => getState().patients.find((p) => p.id === id)!.family);
    expect(new Set(names).size).toBe(2);
  });

  it("registers a known patient by name and age", () => {
    const r = registerEmergency({ identity: { kind: "known", given: "Omar", family: "Alsaleh", sex: "M", ageYears: 8 }, arrivalMode: "Walk-in", complaint: "Fell from bike" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.temporary).toBe(true);
    expect(last().errors).toBe(0);
  });

  it("finds a patient in the national registry and keeps the real Health ID", () => {
    const r = registerEmergency({ identity: { kind: "registry", idNumber: "1000000011" }, arrivalMode: "Walk-in", complaint: "Chest pain" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = getState().patients.find((x) => x.id === r.patientId)!;
    expect(p.healthId).toBe("1090000001");
    expect(r.temporary).toBe(false);
    expect(getState().encounters.find((e) => e.visitNumber === r.visit)?.ed?.temporaryId).toBeUndefined();
  });

  it("says what is missing instead of failing silently", () => {
    expect(registerEmergency({ identity: { kind: "unknown", sex: "M" }, arrivalMode: "Walk-in", complaint: "" })).toMatchObject({ ok: false });
    expect(registerEmergency({ identity: { kind: "known", given: "", family: "X", sex: "M", ageYears: 5 }, arrivalMode: "Walk-in", complaint: "" })).toMatchObject({ ok: false });
    expect(registerEmergency({ identity: { kind: "registry", idNumber: "0000000000" }, arrivalMode: "Walk-in", complaint: "" })).toMatchObject({ ok: false });
  });

  it("turns an approximate age into a birth date", () => {
    expect(dobFromAge(45, undefined, new Date("2026-11-11"))).toBe("1981-07-01");
    expect(dobFromAge(undefined, 6, new Date("2026-11-11")).slice(0, 7)).toBe("2026-05");
  });
});
