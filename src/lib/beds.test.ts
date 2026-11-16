import { afterEach, describe, expect, it } from "vitest";
import { bedSetupProblems, blankInput, equipmentOf, inputFromBed, plannedBeds, resetBedSetup, saveBeds, type BedSetupInput } from "./bed-setup";
import { availableBeds, bedCounts, bedInfo, bedInfos, bedProblem, genderFits, reservedBedFor, unavailableLabel } from "./beds";
import { liveCounts } from "./dashboard-data";
import type { HisState } from "./model";
import { BEDS, BED_BY_ID } from "./reference-data";
import { bedLabel, emptyForm, firstFreeBed, formFromEncounter, formProblem, freeBeds, seedState, sendOn } from "./store";

const visitOf = (s: HisState, pid: string) => s.encounters.find((e) => e.patientId === pid)!;

/** P001 discharged the way the discharge dialog does it: the bed stays held. */
function discharged(): HisState {
  const s = seedState();
  const enc = visitOf(s, "P001");
  const bedId = enc.bedId!;
  const next = sendOn(s, "A03", formFromEncounter(s, "A03", enc)).state;
  visitOf(next, "P001").discharge = { outcome: "home", orderedAt: "2026-11-14T10:00", orderedBy: "Dr. Test", bedId };
  return next;
}

describe("bed states", () => {
  it("gives every bed exactly one state and the counts add up", () => {
    const s = seedState();
    const c = bedCounts(s);
    expect(bedInfos(s)).toHaveLength(BEDS.length);
    expect(c.free + c.occupied + c.reserved + c.discharging + c.cleaning + c.out).toBe(c.total);
    expect(c.total).toBe(BEDS.length);
  });

  it("seeds occupied, reserved and out-of-service beds", () => {
    const s = seedState();
    expect(bedInfo(s, "301-A")?.state).toBe("occupied");
    expect(bedInfo(s, "402-B")?.state).toBe("reserved");
    expect(bedInfo(s, "ICU2-B")).toMatchObject({ state: "out", reason: "Maintenance" });
    expect(bedInfo(s, "302-A")?.state).toBe("free");
    expect(bedCounts(s)).toMatchObject({ occupied: 3, reserved: 1, out: 1, free: 7 });
  });

  it("holds the bed after discharge until the patient leaves, then cleans it, then frees it", () => {
    const s = discharged();
    expect(bedInfo(s, "301-A")).toMatchObject({ state: "discharging", since: "2026-11-14T10:00" });
    expect(freeBeds(s).some((b) => b.id === "301-A")).toBe(false);

    const enc = visitOf(s, "P001");
    enc.discharge = { ...enc.discharge!, leftWardAt: "2026-11-14T10:40" };
    s.bedFlags = { ...s.bedFlags, "301-A": { state: "cleaning", since: "2026-11-14T10:40" } };
    expect(bedInfo(s, "301-A")?.state).toBe("cleaning");
    expect(bedProblem(s, "301-A")).toMatch(/cleaned/);

    delete s.bedFlags["301-A"];
    expect(bedInfo(s, "301-A")?.state).toBe("free");
    expect(bedProblem(s, "301-A")).toBeNull();
  });

  it("frees the bed at once for a discharge without a held bed (older saved data, scenario runner)", () => {
    const s = seedState();
    const next = sendOn(s, "A03", formFromEncounter(s, "A03", visitOf(s, "P001"))).state;
    expect(bedInfo(next, "301-A")?.state).toBe("free");
  });

  it("loads state saved before bed flags existed", () => {
    const s = seedState();
    delete s.bedFlags;
    expect(bedInfo(s, "ICU2-B")?.state).toBe("free");
  });
});

describe("picking a bed", () => {
  it("offers only free beds, plus the bed reserved for that patient", () => {
    const s = seedState();
    expect(availableBeds(s).map((b) => b.id)).not.toContain("402-B");
    expect(availableBeds(s, { patientId: "P005" }).map((b) => b.id)).toContain("402-B");
    expect(availableBeds(s, { patientId: "P005" }).map((b) => b.id)).not.toContain("301-A");
    expect(reservedBedFor(s, "P005")).toBe("402-B");
    expect(reservedBedFor(s, "P001")).toBeUndefined();
  });

  it("says why a bed is unavailable", () => {
    const s = discharged();
    expect(bedProblem(s, "301-B")).toBe("That bed is taken.");
    expect(bedProblem(s, "402-B")).toMatch(/reserved/);
    expect(bedProblem(s, "402-B", { patientId: "P005" })).toBeNull();
    expect(bedProblem(s, "ICU2-B")).toMatch(/out of service \(Maintenance\)/);
    expect(bedProblem(s, "301-A")).toMatch(/has not left the ward/);
    expect(bedProblem(s, "301-A", { visit: visitOf(s, "P001").visitNumber })).toBeNull();
    expect(bedProblem(s, "nope")).toMatch(/does not exist/);
    expect(unavailableLabel(bedInfo(s, "ICU2-B")!)).toBe("Out of service: Maintenance");
    expect(unavailableLabel(bedInfo(s, "301-B")!, { visit: visitOf(s, "P002").visitNumber })).toBe("Current bed");
  });

  it("blocks admission and transfer into a bed that is not free", () => {
    const s = seedState();
    const transfer = (bedId: string) => {
      const f = formFromEncounter(s, "A02", visitOf(s, "P001"));
      f.bedId = bedId;
      return formProblem(s, "A02", f);
    };
    expect(transfer("302-A")).toBeNull();
    expect(transfer("301-B")).toBe("That bed is taken.");
    expect(transfer("402-B")).toMatch(/reserved/);
    expect(transfer("ICU2-B")).toMatch(/out of service/);

    const admit = (patientId: string, bedId: string) => {
      const f = emptyForm(s, "A01");
      f.patientId = patientId;
      f.bedId = bedId;
      return formProblem(s, "A01", f);
    };
    expect(admit("P010", "402-B")).toMatch(/reserved/);
    expect(admit("P005", "402-B")).toBeNull();
  });

  it("never hands out a reserved or out-of-service bed as the first free bed", () => {
    const s = seedState();
    const free = freeBeds(s).map((b) => b.id);
    expect(free).not.toContain("402-B");
    expect(free).not.toContain("ICU2-B");
    expect(free).toContain(firstFreeBed(s));
    expect(freeBeds(s, "301-A").map((b) => b.id)).toContain("301-A");
  });
});

describe("bed setup", () => {
  afterEach(() => resetBedSetup());

  const input = (over: Partial<BedSetupInput> = {}): BedSetupInput => ({ ...blankInput("3A"), room: "305", bedNo: "A", ...over });

  it("gives seed beds sensible defaults from their ward", () => {
    const icu = bedInfo(seedState(), "ICU1-A")!.bed;
    expect(icu).toMatchObject({ floor: "2", roomType: "Intensive Care Unit", ventilator: true, monitor: true, oxygen: true, gender: "Any", active: true });
    expect(equipmentOf(icu)).toEqual(["Oxygen", "Ventilator", "Monitor"]);
    expect(bedInfo(seedState(), "301-A")!.bed).toMatchObject({ floor: "3", ventilator: false });
  });

  it("adds one bed, and the new bed is free, named and offered", () => {
    const s = seedState();
    const r = saveBeds(input(), s);
    expect(r.ok).toBe(true);
    expect(BED_BY_ID["305-A"]).toMatchObject({ ward: "3A", room: "305", bed: "A" });
    expect(bedLabel("305-A")).not.toBe("");
    expect(bedInfo(s, "305-A")?.state).toBe("free");
    expect(availableBeds(s).map((b) => b.id)).toContain("305-A");
    expect(bedCounts(s).total).toBe(BEDS.length);
  });

  it("adds several beds from a prefix, start number and count", () => {
    const s = seedState();
    expect(plannedBeds({ mode: "multiple", room: "306", bedNo: "", prefix: "b", start: 3, count: 3 }).map((b) => b.id)).toEqual(["306-B3", "306-B4", "306-B5"]);
    const r = saveBeds(input({ mode: "multiple", room: "306", prefix: "B", start: 3, count: 3, gender: "Female" }), s);
    expect(r.ok && r.value.map((b) => b.id)).toEqual(["306-B3", "306-B4", "306-B5"]);
    expect(bedInfo(s, "306-B4")!.bed.gender).toBe("Female");
  });

  it("refuses a bed number that exists and an incomplete form", () => {
    const s = seedState();
    expect(bedSetupProblems(input({ room: "301", bedNo: "A" }), s).join(" ")).toMatch(/already exists: 301-A/);
    const p = bedSetupProblems(input({ room: "", bedNo: "", roomType: "", bedType: "" }), s);
    expect(p).toEqual(expect.arrayContaining(["Enter the room number.", "Enter the bed number.", "Pick the room type.", "Pick the bed type."]));
    expect(bedSetupProblems(input({ mode: "multiple", prefix: "", start: 0, count: 50 }), s)).toHaveLength(3);
  });

  it("offers a gender-restricted bed only to patients of that sex", () => {
    const s = seedState();
    saveBeds({ ...inputFromBed(BED_BY_ID["302-A"]), gender: "Female" }, s, "302-A");
    const male = s.patients.find((p) => p.sex === "M")!;
    const female = s.patients.find((p) => p.sex === "F")!;
    expect(bedProblem(s, "302-A", { patientId: male.id })).toBe("That bed is for female patients only.");
    expect(bedProblem(s, "302-A", { patientId: female.id })).toBeNull();
    expect(bedProblem(s, "302-A")).toBeNull();
    expect(availableBeds(s, { patientId: male.id }).map((b) => b.id)).not.toContain("302-A");
    expect(availableBeds(s, { patientId: female.id }).map((b) => b.id)).toContain("302-A");
    expect(unavailableLabel(bedInfo(s, "302-A")!, { patientId: male.id })).toBe("Female patients only");
    expect(genderFits({ gender: "Male" }, undefined)).toBe(true);

    const f = emptyForm(s, "A01");
    f.patientId = male.id;
    f.bedId = "302-A";
    expect(formProblem(s, "A01", f)).toMatch(/female patients only/);
  });

  it("takes an inactive bed out of use until it is active again", () => {
    const s = seedState();
    saveBeds({ ...inputFromBed(BED_BY_ID["302-A"]), active: false }, s, "302-A");
    expect(bedInfo(s, "302-A")).toMatchObject({ state: "out", inactive: true, reason: "Inactive" });
    expect(bedProblem(s, "302-A")).toMatch(/inactive/);
    expect(unavailableLabel(bedInfo(s, "302-A")!)).toBe("Inactive");
    expect(availableBeds(s).map((b) => b.id)).not.toContain("302-A");
    expect(freeBeds(s).map((b) => b.id)).not.toContain("302-A");
    saveBeds({ ...inputFromBed(BED_BY_ID["302-A"]), active: true }, s, "302-A");
    expect(bedInfo(s, "302-A")?.state).toBe("free");
  });

  it("will not make an occupied bed inactive or give it the wrong gender", () => {
    const s = seedState();
    const enc = visitOf(s, "P001");
    const sex = s.patients.find((p) => p.id === "P001")!.sex;
    const other = sex === "M" ? "Female" : "Male";
    expect(bedSetupProblems({ ...inputFromBed(BED_BY_ID[enc.bedId!]), active: false }, s, enc.bedId).join(" ")).toMatch(/patient is in this bed/);
    expect(bedSetupProblems({ ...inputFromBed(BED_BY_ID[enc.bedId!]), gender: other }, s, enc.bedId).join(" ")).toMatch(/Keep the gender restriction/);
    // The patient already in the bed keeps it.
    expect(bedInfo(s, enc.bedId!)?.state).toBe("occupied");
  });
});

describe("dashboard bed counts", () => {
  it("still reports total and in-use beds, and counts only ready beds as free", () => {
    const s = seedState();
    const c = liveCounts(s);
    expect(c.bedsTotal).toBe(BEDS.length);
    expect(c.bedsUsed).toBe(3);
    expect(c.bedStates.free).toBe(7);
    for (const w of c.wards) expect(w.used + w.free + w.notReady).toBe(w.total);
    expect(c.wards.find((w) => w.ward === "Intensive Care")).toMatchObject({ used: 1, free: 2, notReady: 1 });
  });
});
