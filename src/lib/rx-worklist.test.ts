import { beforeEach, describe, expect, it } from "vitest";
import { getDrug, getRx, resetRx } from "./rx";
import { verifyItem } from "./rx-verify";
import { TABS, STATUS_FILTERS, canChangeLine, dispensedRows, readyPrescriptions, readySummary, statusMatches, tabMatches } from "./rx-worklist";
import { switchUser } from "./session";

const sent = () => getRx().prescriptions.filter((r) => r.sentAt);
const verifyAll = (patientId: string) => {
  for (const rx of getRx().prescriptions.filter((r) => r.patientId === patientId && r.sentAt)) for (const i of rx.items) verifyItem(rx.id, i.id, "ok", false);
};

describe("pharmacy worklist rules", () => {
  beforeEach(() => {
    switchUser("U9");
    resetRx(true);
  });

  it("has the four tabs and the status filters of the HIS worklist", () => {
    expect(TABS.map((t) => t.id)).toEqual(["waiting", "to-verify", "ready", "all"]);
    expect(STATUS_FILTERS.map((f) => f.id)).toEqual(["all", "active", "on-hold", "stopped", "cancelled", "completed"]);
  });

  it("puts an item on the right tab", () => {
    const toVerify = { open: true, verify: "to-verify" as const, itemStatus: "active" as const };
    const queried = { ...toVerify, verify: "queried" as const };
    const rejected = { ...toVerify, verify: "rejected" as const };
    const verified = { ...toVerify, verify: "verified" as const };
    const hold = { open: false, verify: "to-verify" as const, itemStatus: "on-hold" as const };
    const done = { open: false, verify: "verified" as const, itemStatus: "completed" as const };
    expect(tabMatches("to-verify", toVerify)).toBe(true);
    expect(tabMatches("to-verify", queried)).toBe(true);
    expect(tabMatches("to-verify", rejected)).toBe(false);
    expect(tabMatches("to-verify", verified)).toBe(false);
    expect(tabMatches("ready", verified)).toBe(true);
    expect(tabMatches("ready", toVerify)).toBe(false);
    expect(tabMatches("waiting", hold)).toBe(true);
    expect(tabMatches("waiting", rejected)).toBe(true);
    expect(tabMatches("waiting", done)).toBe(false);
    expect(tabMatches("all", done)).toBe(true);
    expect(tabMatches("ready", { ...verified, open: false })).toBe(false);
  });

  it("filters by item status", () => {
    expect(statusMatches("all", "stopped")).toBe(true);
    expect(statusMatches("active", "active")).toBe(true);
    expect(statusMatches("active", "on-hold")).toBe(false);
  });

  it("lists a patient's prescriptions for a multi-drug dispense only once they are verified", () => {
    const p007 = sent().filter((r) => r.patientId === "P007");
    expect(p007.length).toBeGreaterThanOrEqual(2);
    expect(readyPrescriptions(getRx(), "P007")).toHaveLength(0); // nothing verified yet
    verifyAll("P007");
    const ready = readyPrescriptions(getRx(), "P007");
    expect(ready.length).toBe(p007.length);
    expect(ready.map((r) => r.sentAt)).toEqual([...ready.map((r) => r.sentAt)].sort()); // oldest first
    expect(readySummary(getRx(), "P007")).toEqual({ prescriptions: ready.length, items: ready.reduce((n, r) => n + r.items.length, 0) });
    expect(readyPrescriptions(getRx(), "NOBODY")).toEqual([]);
  });

  it("offers update and cancel for every medicine, and refuses only a line already cancelled", () => {
    const plain = getDrug("DRG001");
    expect(plain.controlClass).toBe("U");
    expect(canChangeLine(plain, { status: "completed" })).toEqual({ ok: true, reason: "" });
    const ctrl = { controlClass: "N" as const, generic: "Morphine" };
    expect(canChangeLine(ctrl, { status: "completed" })).toEqual({ ok: true, reason: "" });
    expect(canChangeLine(ctrl, { status: "cancelled" }).reason).toMatch(/already cancelled/);
  });

  it("lists what was dispensed, newest first, with the change rule applied", () => {
    const s = getRx();
    expect(dispensedRows(s)).toEqual([]);
    const withLines = {
      ...s,
      dispenses: [
        { id: "d1", number: "DSP-1", rxId: s.prescriptions[0].id, visitNumber: "V1", patientId: "P001", dispenser: "A", handedOverAt: "2026-11-10T08:00:00.000Z", verification: { patientScan: true, drugScans: [] },
          lines: [{ id: "l1", identifier: "x", itemId: "i", drugId: "DRG001", quantity: 5, type: "FF" as const, status: "completed" as const, refillsRemaining: 0, daysSupply: 1, version: 1 }] },
        { id: "d2", number: "DSP-2", rxId: s.prescriptions[0].id, visitNumber: "V1", patientId: "P001", dispenser: "A", handedOverAt: "2026-11-11T08:00:00.000Z", verification: { patientScan: true, drugScans: [] },
          lines: [{ id: "l2", identifier: "y", itemId: "i", drugId: "DRG001", quantity: 2, type: "FF" as const, status: "cancelled" as const, refillsRemaining: 0, daysSupply: 1, version: 2 }] },
      ],
    };
    const all = dispensedRows(withLines);
    expect(all.map((r) => r.dispense.number)).toEqual(["DSP-2", "DSP-1"]);
    expect(dispensedRows(withLines, "cancelled").map((r) => r.line.id)).toEqual(["l2"]);
    expect(dispensedRows(withLines, "completed").map((r) => r.line.id)).toEqual(["l1"]);
    expect(all[0].change.ok).toBe(false);
  });
});
