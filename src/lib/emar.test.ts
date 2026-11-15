import { beforeEach, describe, expect, it } from "vitest";
import {
  ALL_SITES, addEffectNote, checkAdmin, dosesBetween, dueInHour, getEmar, highAlertOf, hourOf, marOrders, overdueDoses, pendingState, quantityErrors,
  recordDose, recordDoses, recordsOf, regionOf, resetEmar, samePerson, slotTimes, summarizeDay, voidRecord, type AdminInput, type AdminRecord,
} from "./emar";
import { getRx, resetRx, setRx } from "./rx";
import { DRUGS } from "./rx-catalogue";
import type { ItemStatus, Prescription, RxItem } from "./rx-types";
import { switchUser } from "./session";
import { getState, resetAll } from "./store";

const H = 3_600_000;
const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();
const drugId = (generic: string) => DRUGS.find((d) => d.generic === generic)!.id;
const inpatient = () => getState().encounters.find((e) => e.cls === "I" && e.status === "active")!;
const ALL_RIGHTS = { patient: true, drug: true, dose: true, route: true, time: true };

let n = 0;
function prescribe(generic: string, over: Partial<RxItem> = {}, sentAt = at(5, 7), usage: Prescription["usage"] = "inpatient"): RxItem {
  const enc = inpatient();
  n += 1;
  const item: RxItem = {
    id: `t-item-${n}`, identifier: `RXI-T${n}`, drugId: drugId(generic), dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 5,
    quantity: 10, quantityManual: false, route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0,
    reason: { code: "R69", text: "Illness, unspecified" }, status: "active", version: 1, ...over,
  };
  const rx: Prescription = {
    id: `t-rx-${n}`, number: `RX-T${n}`, visitNumber: enc.visitNumber, patientId: enc.patientId, prescriberId: enc.attending,
    authoredAt: new Date(sentAt).toISOString(), usage, groupId: `G${n}`, controlled: false, items: [item],
    sentAt: new Date(sentAt).toISOString(), dirty: false,
  };
  setRx({ ...getRx(), prescriptions: [...getRx().prescriptions, rx] });
  return item;
}
const setStatus = (itemId: string, status: ItemStatus) =>
  setRx({ ...getRx(), prescriptions: getRx().prescriptions.map((p) => ({ ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, status } : i)) })) });
const give = (itemId: string, slot: number | undefined, now: number, extra: Partial<AdminInput> = {}) =>
  recordDose({ visit: inpatient().visitNumber, itemId, slot, outcome: "given", rights: ALL_RIGHTS, at: now, ...extra }, now);
const hours = (ts: number[]) => ts.map((t) => new Date(t).getHours());

beforeEach(() => {
  resetAll(); resetRx(); resetEmar(); switchUser("U2");
});

describe("doses due from the frequency", () => {
  it("builds once daily, twice daily and every 8 hours at the ward times", () => {
    const day = { start: at(5, 0), end: at(9, 0) };
    expect(hours(slotTimes({ kind: "regular", frequencyId: "OD", ...day }, at(6, 0), at(6, 23, 59)))).toEqual([8]);
    expect(hours(slotTimes({ kind: "regular", frequencyId: "BID", ...day }, at(6, 0), at(6, 23, 59)))).toEqual([8, 20]);
    expect(hours(slotTimes({ kind: "regular", frequencyId: "Q8H", ...day }, at(6, 0), at(6, 23, 59)))).toEqual([6, 14, 22]);
  });

  it("starts after the prescription was sent and ends with the duration", () => {
    const item = prescribe("Metformin");
    const order = marOrders(inpatient()).find((o) => o.itemId === item.id)!;
    const all = slotTimes(order, 0, at(30, 0));
    expect(all).toHaveLength(10);
    expect(all[0]).toBe(at(5, 8));
    expect(all[all.length - 1]).toBe(at(9, 20));
  });

  it("gives a stat order one dose, now, and an as-needed order none", () => {
    const stat = prescribe("Ondansetron", { frequencyId: "STAT" });
    const prn = prescribe("Paracetamol", { frequencyId: "Q6H", asNeeded: true });
    const orders = marOrders(inpatient());
    expect(slotTimes(orders.find((o) => o.itemId === stat.id)!, 0, at(30, 0))).toEqual([at(5, 7)]);
    const p = orders.find((o) => o.itemId === prn.id)!;
    expect(p.kind).toBe("prn");
    expect(p.minGapMinutes).toBe(360);
    expect(slotTimes(p, 0, at(30, 0))).toEqual([]);
  });

  it("gives a weekly order one dose every seven days", () => {
    const item = prescribe("Fentanyl Patch", { frequencyId: "WEEKLY", durationDays: 14, route: "TD" });
    const order = marOrders(inpatient()).find((o) => o.itemId === item.id)!;
    expect(slotTimes(order, 0, at(30, 0))).toEqual([at(5, 8), at(12, 8)]);
  });

  it("leaves out drafts and take-home prescriptions", () => {
    prescribe("Metformin", {}, at(5, 7), "discharge");
    expect(marOrders(inpatient())).toHaveLength(0);
  });
});

describe("dose state", () => {
  it("is scheduled, then due inside 60 minutes, then overdue. It is never given by the clock", () => {
    expect(pendingState(at(5, 8), at(5, 6, 30))).toBe("scheduled");
    expect(pendingState(at(5, 8), at(5, 7, 0))).toBe("due");
    expect(pendingState(at(5, 8), at(5, 9, 0))).toBe("due");
    expect(pendingState(at(5, 8), at(5, 9, 1))).toBe("overdue");
    prescribe("Metformin");
    const doses = dosesBetween(inpatient(), at(5, 0), at(5, 23, 59), at(5, 12));
    expect(doses.map((d) => d.state)).toEqual(["overdue", "scheduled"]);
    expect(doses.every((d) => !d.record)).toBe(true);
    expect(getEmar().records).toHaveLength(0);
  });

  it("counts overdue doses for the needs-attention list", () => {
    prescribe("Metformin");
    expect(overdueDoses(inpatient(), at(5, 8, 30))).toHaveLength(0);
    expect(overdueDoses(inpatient(), at(6, 9, 30))).toHaveLength(3);
  });

  it("shows no further doses for a stopped or cancelled prescription, and keeps the recorded ones", () => {
    const item = prescribe("Metformin");
    expect(give(item.id, at(5, 8), at(5, 8, 10)).ok).toBe(true);
    for (const status of ["stopped", "cancelled", "on-hold"] as const) {
      setStatus(item.id, status);
      const doses = dosesBetween(inpatient(), 0, at(30, 0), at(6, 12));
      expect(doses.map((d) => d.state), status).toEqual(["given"]);
      expect(overdueDoses(inpatient(), at(6, 12)), status).toHaveLength(0);
      expect(give(item.id, at(5, 20), at(5, 20)).ok, status).toBe(false);
    }
  });
});

describe("recording a dose", () => {
  it("needs all five rights before a dose is saved as given", () => {
    const item = prescribe("Metformin");
    const partial = recordDose({ visit: inpatient().visitNumber, itemId: item.id, slot: at(5, 8), outcome: "given", rights: { patient: true, drug: true }, at: at(5, 8) }, at(5, 8));
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors[0]).toMatch(/dose, route, time/);
    const done = give(item.id, at(5, 8), at(5, 8, 5));
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.record).toMatchObject({ outcome: "given", by: "Huda Alotaibi, RN", byRole: "Nurse", offMinutes: 5 });
  });

  it("needs a reason for held, refused and missed", () => {
    const item = prescribe("Metformin");
    const visit = inpatient().visitNumber;
    for (const outcome of ["held", "refused", "missed"] as const) {
      expect(recordDose({ visit, itemId: item.id, slot: at(5, 8), outcome }, at(5, 8)).ok, outcome).toBe(false);
    }
    expect(recordDose({ visit, itemId: item.id, slot: at(5, 8), outcome: "held", reason: "Other" }, at(5, 8)).ok).toBe(false);
    const held = recordDose({ visit, itemId: item.id, slot: at(5, 8), outcome: "held", reason: "Nil by mouth" }, at(5, 8));
    expect(held.ok).toBe(true);
    expect(dosesBetween(inpatient(), at(5, 0), at(5, 12), at(5, 12))[0].state).toBe("held");
  });

  it("asks for a reason when a dose is more than 60 minutes early or late", () => {
    const item = prescribe("Metformin");
    expect(give(item.id, at(5, 8), at(5, 9, 0)).ok).toBe(true);
    expect(give(item.id, at(5, 20), at(5, 18, 30)).ok).toBe(false);
    const late = give(item.id, at(6, 8), at(6, 9, 30));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errors.join(" ")).toMatch(/late/);
    expect(give(item.id, at(6, 8), at(6, 9, 30), { timingReason: "Patient asleep" }).ok).toBe(true);
  });

  it("does not record the same dose twice, or a time in the future", () => {
    const item = prescribe("Metformin");
    expect(give(item.id, at(5, 8), at(5, 8)).ok).toBe(true);
    expect(give(item.id, at(5, 8), at(5, 8, 20)).ok).toBe(false);
    expect(recordDose({ visit: inpatient().visitNumber, itemId: item.id, slot: at(5, 20), outcome: "given", rights: ALL_RIGHTS, at: at(5, 20, 30) }, at(5, 20)).ok).toBe(false);
    expect(give(item.id, at(5, 13), at(5, 13)).ok).toBe(false);
  });

  it("needs a second nurse for a high-alert drug, and not the same person", () => {
    expect(highAlertOf(DRUGS.find((d) => d.generic === "Insulin Glargine")!)).toBe("Insulin");
    expect(highAlertOf(DRUGS.find((d) => d.generic === "Enoxaparin")!)).toBe("Heparin");
    expect(highAlertOf(DRUGS.find((d) => d.generic === "Morphine Sulfate")!)).toBe("Opioid");
    expect(highAlertOf({ generic: "Potassium Chloride", therapeuticClass: "Electrolyte" })).toBe("Potassium");
    expect(highAlertOf(DRUGS.find((d) => d.generic === "Metformin")!)).toBeNull();

    const item = prescribe("Insulin Glargine", { frequencyId: "QHS", route: "SC" });
    expect(give(item.id, at(5, 22), at(5, 22)).ok).toBe(false);
    expect(give(item.id, at(5, 22), at(5, 22), { witness: { name: "Huda Alotaibi", staffNo: "N200" } }).ok).toBe(false);
    expect(give(item.id, at(5, 22), at(5, 22), { witness: { name: "Sara Alamri", staffNo: "u2" } }).ok).toBe(false);
    const ok = give(item.id, at(5, 22), at(5, 22), { witness: { name: "Sara Alamri, RN", staffNo: "N200" } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.record.witness).toEqual({ name: "Sara Alamri, RN", staffNo: "N200" });
    expect(samePerson({ name: "huda  alotaibi RN", staffNo: "X" }, { id: "U2", name: "Huda Alotaibi, RN" })).toBe(true);
  });

  it("records an as-needed dose with its reason and a follow-up effect note", () => {
    const item = prescribe("Paracetamol", { frequencyId: "Q6H", asNeeded: true });
    expect(give(item.id, undefined, at(5, 10)).ok).toBe(false);
    const res = give(item.id, undefined, at(5, 10), { prnReason: "Pain" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.slot).toBeUndefined();
    expect(addEffectNote(res.record.id, "")).toBe(false);
    expect(addEffectNote(res.record.id, "Pain 7 to 3 after 45 minutes")).toBe(true);
    expect(recordsOf(inpatient().visitNumber)[0].effect?.text).toMatch(/7 to 3/);
    const shown = dosesBetween(inpatient(), at(5, 0), at(5, 23, 59), at(5, 12));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ dueAt: null, state: "given" });
    expect(recordDose({ visit: inpatient().visitNumber, itemId: item.id, outcome: "missed", reason: "Patient asleep" }, at(5, 12)).ok).toBe(false);
  });

  it("opens the dose again when a record is marked as entered in error", () => {
    const item = prescribe("Metformin");
    const res = give(item.id, at(5, 8), at(5, 8));
    if (!res.ok) throw new Error("expected a record");
    expect(voidRecord(res.record.id, "")).toBe(false);
    expect(voidRecord(res.record.id, "Wrong patient chart")).toBe(true);
    expect(dosesBetween(inpatient(), at(5, 0), at(5, 12), at(5, 8, 30))[0].state).toBe("due");
    expect(recordsOf(inpatient().visitNumber)[0].voided?.reason).toBe("Wrong patient chart");
    expect(give(item.id, at(5, 8), at(5, 8, 40)).ok).toBe(true);
  });

  it("checks without saving", () => {
    const item = prescribe("Metformin");
    const order = marOrders(inpatient())[0];
    const who = { id: "U2", name: "Huda Alotaibi, RN" };
    expect(checkAdmin({ visit: "x", itemId: item.id, slot: at(5, 8), outcome: "given", rights: ALL_RIGHTS, at: at(5, 8) }, order, who, at(5, 8))).toEqual([]);
    expect(checkAdmin({ visit: "x", itemId: "nope", slot: at(5, 8), outcome: "given" }, undefined, who, at(5, 8))).toHaveLength(1);
  });
});

describe("site, quantity and complications", () => {
  it("records the site, the quantity given and wasted, and the complications", () => {
    const item = prescribe("Metformin", { dose: 2 });
    const res = give(item.id, at(5, 8), at(5, 8), { site: "Mouth", qtyGiven: 1.5, qtyWasted: 0.5, complications: ["Nausea or vomiting"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record).toMatchObject({ site: "Mouth", qtyDue: 2, qtyGiven: 1.5, qtyWasted: 0.5, complications: ["Nausea or vomiting"] });
    expect(regionOf("Left deltoid")).toBe("Left Arm");
    expect(ALL_SITES.length).toBeGreaterThan(20);
  });

  it("takes the full dose when no quantity is entered", () => {
    const item = prescribe("Metformin", { dose: 2 });
    const res = give(item.id, at(5, 8), at(5, 8));
    if (!res.ok) throw new Error("expected a record");
    expect(res.record).toMatchObject({ qtyDue: 2, qtyGiven: 2, qtyWasted: 0 });
  });

  it("needs the quantity given and wasted to add up to the dose due", () => {
    const order = { doseQty: 2, unit: "tablet" };
    expect(quantityErrors({}, order)).toEqual([]);
    expect(quantityErrors({ qtyGiven: 1 }, order)).toEqual([]);
    expect(quantityErrors({ qtyGiven: 1, qtyWasted: 0.5 }, order)[0]).toMatch(/add up to the dose due \(2 tablet\)/);
    expect(quantityErrors({ qtyGiven: 0, qtyWasted: 2 }, order)[0]).toMatch(/more than zero/);
    expect(quantityErrors({ qtyGiven: 3 }, order).join(" ")).toMatch(/below zero/);
    const item = prescribe("Metformin", { dose: 2 });
    expect(give(item.id, at(5, 8), at(5, 8), { qtyGiven: 2, qtyWasted: 1 }).ok).toBe(false);
  });

  it("refuses a site that is not on the list, and Other without a note", () => {
    const item = prescribe("Metformin");
    expect(give(item.id, at(5, 8), at(5, 8), { site: "Elbow somewhere" }).ok).toBe(false);
    expect(give(item.id, at(5, 8), at(5, 8), { complications: ["Other"] }).ok).toBe(false);
    expect(give(item.id, at(5, 8), at(5, 8), { complications: ["Other"], note: "Felt faint for a minute" }).ok).toBe(true);
  });

  it("still opens a record saved before these fields existed", () => {
    const item = prescribe("Metformin");
    const old: AdminRecord = {
      id: "MA-OLD", visit: inpatient().visitNumber, patientId: inpatient().patientId, itemId: item.id, rxId: "t-rx", slot: new Date(at(5, 8)).toISOString(),
      drugText: "Metformin", doseText: "1 tablet", routeText: "Oral", outcome: "given", at: new Date(at(5, 8)).toISOString(), by: "Nurse", byRole: "Nurse",
    };
    getEmar().records.push(old);
    const doses = dosesBetween(inpatient(), at(5, 0), at(5, 12), at(5, 12));
    expect(doses[0]).toMatchObject({ state: "given" });
    expect(doses[0].record?.qtyGiven).toBeUndefined();
    expect(summarizeDay(doses).counts.given).toBe(1);
  });
});

describe("recording all doses due at one hour", () => {
  it("lists the doses due in the hour and records them together", () => {
    const a = prescribe("Metformin");
    const b = prescribe("Amlodipine", { frequencyId: "OD" });
    const visit = inpatient().visitNumber;
    const due = dueInHour(inpatient(), hourOf(at(5, 8, 25)), at(5, 8, 25));
    expect(due.map((d) => d.order.itemId).sort()).toEqual([a.id, b.id].sort());
    const res = recordDoses([
      { visit, itemId: a.id, slot: at(5, 8), outcome: "given", rights: ALL_RIGHTS, at: at(5, 8, 20), site: "Mouth" },
      { visit, itemId: b.id, slot: at(5, 8), outcome: "held", reason: "Vital signs out of range" },
    ], at(5, 8, 25));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.records).toHaveLength(2);
    expect(res.records[0].batch).toBeDefined();
    expect(res.records[0].batch).toBe(res.records[1].batch);
    expect(dueInHour(inpatient(), hourOf(at(5, 8)), at(5, 8, 30))).toHaveLength(0);
  });

  it("saves nothing when one dose in the round fails, and keeps the high-alert rule", () => {
    const a = prescribe("Metformin");
    const ins = prescribe("Insulin Glargine", { frequencyId: "OD", route: "SC" });
    const visit = inpatient().visitNumber;
    const round = (witness?: { name: string; staffNo: string }) => recordDoses([
      { visit, itemId: a.id, slot: at(5, 8), outcome: "given", rights: ALL_RIGHTS, at: at(5, 8) },
      { visit, itemId: ins.id, slot: at(5, 8), outcome: "given", rights: ALL_RIGHTS, at: at(5, 8), site: "Abdomen, left lower", witness },
    ], at(5, 8));
    const bad = round();
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toHaveLength(1);
      expect(bad.errors[0].itemId).toBe(ins.id);
      expect(bad.errors[0].errors.join(" ")).toMatch(/second nurse/);
    }
    expect(getEmar().records).toHaveLength(0);
    expect(round({ name: "Huda Alotaibi", staffNo: "N1" }).ok).toBe(false);
    expect(round({ name: "Sara Alamri, RN", staffNo: "N200" }).ok).toBe(true);
    expect(getEmar().records).toHaveLength(2);
  });

  it("refuses the same dose twice in one round and an empty round", () => {
    const a = prescribe("Metformin");
    const visit = inpatient().visitNumber;
    const one = { visit, itemId: a.id, slot: at(5, 8), outcome: "given" as const, rights: ALL_RIGHTS, at: at(5, 8) };
    expect(recordDoses([one, one], at(5, 8)).ok).toBe(false);
    expect(recordDoses([], at(5, 8)).ok).toBe(false);
  });
});

describe("month view summary", () => {
  it("counts each state and picks the one that needs attention first", () => {
    expect(summarizeDay([])).toEqual({ total: 0, counts: {}, worst: null });
    const s = summarizeDay([{ state: "given" }, { state: "given" }, { state: "held" }, { state: "scheduled" }]);
    expect(s).toEqual({ total: 4, counts: { given: 2, held: 1, scheduled: 1 }, worst: "held" });
    expect(summarizeDay([{ state: "missed" }, { state: "overdue" }]).worst).toBe("overdue");
    const item = prescribe("Metformin");
    const doses = dosesBetween(inpatient(), at(5, 0), at(5, 23, 59), at(5, 12));
    expect(summarizeDay(doses.filter((d) => d.order.itemId === item.id)).worst).toBe("overdue");
  });
});
