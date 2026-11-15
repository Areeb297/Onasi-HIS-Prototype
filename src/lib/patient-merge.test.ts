import { describe, expect, it } from "vitest";
import type { HisState } from "./model";
import { mergeOn, mergeProblem, openVisits } from "./patient-merge";
import { seedState } from "./store";

const visitsOf = (s: HisState, pid: string) => s.encounters.filter((e) => e.patientId === pid).map((e) => e.visitNumber);

describe("merge patients", () => {
  it("moves the duplicate's visits to the kept file and marks the duplicate merged", () => {
    const s = seedState();
    // P006 has only a discharged stay, P009 only a discharged outpatient visit: no open visit on either side.
    const keepBefore = visitsOf(s, "P006");
    const dupBefore = visitsOf(s, "P009");
    expect(dupBefore.length).toBeGreaterThan(0);
    const out = mergeOn(s, "P006", "P009", "2026-11-15T08:00:00.000Z");
    expect(visitsOf(out.state, "P009")).toEqual([]);
    expect(visitsOf(out.state, "P006")).toEqual([...keepBefore, ...dupBefore]);
    expect(out.moved).toEqual(dupBefore);
    const dup = out.state.patients.find((p) => p.id === "P009")!;
    expect(dup).toMatchObject({ mergedInto: "P006", mergedAt: "2026-11-15T08:00:00.000Z" });
    // The original state is untouched.
    expect(visitsOf(s, "P009")).toEqual(dupBefore);
  });

  it("sends one A50 per moved visit with the kept patient in PID and the duplicate's Health ID in MRG-1", () => {
    const s = seedState();
    const dup = s.patients.find((p) => p.id === "P009")!;
    const keep = s.patients.find((p) => p.id === "P006")!;
    const out = mergeOn(s, "P006", "P009");
    expect(out.entries).toHaveLength(visitsOf(s, "P009").length);
    const e = out.entries[0];
    expect(e.eventId).toBe("A50");
    expect(e.patientId).toBe("P006");
    expect(e.errors).toBe(0);
    const lines = e.message.split("\r");
    expect(lines.find((l) => l.startsWith("PID|"))).toContain(keep.healthId);
    const mrg = lines.find((l) => l.startsWith("MRG|"))!;
    expect(mrg).toContain(dup.healthId);
    expect(mrg).toContain(out.moved[0]);
    expect(out.state.log.length).toBe(s.log.length + out.entries.length);
  });

  it("allows a merge when only one file has an open visit", () => {
    const s = seedState();
    expect(openVisits(s, "P001").length).toBe(1);
    expect(openVisits(s, "P006").length).toBe(0);
    expect(mergeProblem(s, "P001", "P006")).toBeNull();
    const out = mergeOn(s, "P001", "P006");
    expect(openVisits(out.state, "P001").length).toBe(1);
  });

  it("refuses a merge when both files have an open visit", () => {
    const s = seedState();
    expect(openVisits(s, "P001").length).toBeGreaterThan(0);
    expect(openVisits(s, "P002").length).toBeGreaterThan(0);
    expect(mergeProblem(s, "P001", "P002")).toMatch(/Both files have an open visit/);
    expect(() => mergeOn(s, "P001", "P002")).toThrow();
    // A pre-admission counts as open.
    expect(mergeProblem(s, "P001", "P005")).toMatch(/open visit/);
  });

  it("refuses the same file, a missing file and a file already merged", () => {
    const s = seedState();
    expect(mergeProblem(s, "P006", "P006")).toMatch(/different/);
    expect(mergeProblem(s, "P006", "P999")).toMatch(/not found/);
    expect(mergeProblem(s, "", "P006")).toMatch(/Pick/);
    const merged = mergeOn(s, "P006", "P009").state;
    expect(mergeProblem(merged, "P006", "P009")).toMatch(/already been merged/);
  });
});
