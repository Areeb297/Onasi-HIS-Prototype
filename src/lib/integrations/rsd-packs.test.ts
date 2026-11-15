import { beforeEach, describe, expect, it } from "vitest";
import { DRUGS, DRUG_BY_ID } from "../rx-catalogue";
import { addDraftItem, getRx, resetRx, setHeight, type NewItem } from "../rx";
import { changeDispenseLine, sendPrescription, type DispenseRequest } from "../rx-send";
import { batchesFor, firstUsableBatch } from "../rx-stock";
import { dispenseChecked, verifyItem } from "../rx-verify";
import { switchUser } from "../session";
import { getState, updateEncounter } from "../store";
import { resetStock } from "../pharmacy-stock";
import { ownCalls, resetCallLog, setMode } from "./call-log";
import { validCheckDigit } from "./rsd-gs1";
import {
  acceptDispatch, acceptPack, canDispense, countsByStatus, dispenseProblem, drugByGtin, getRsd, gtinOf, packKey, packsList, packsNeeded, packsOfLine,
  pendingDispatches, rejectDispatch, reportCancel, reportSale, resetRsd, scanProblems, suggestPacks, type Pack,
} from "./rsd-packs";

const NOW = new Date();
const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const pack = (over: Partial<Pack> = {}): Pack => ({ gtin: gtinOf(DRUG_BY_ID.DRG002), serial: "S1", batch: "L1", expiry: iso(300), drugId: "DRG002", status: "accepted", ...over });

function connect(on: boolean) {
  switchUser("U9");
  setMode("rsd", on ? "connected" : "off");
  switchUser("U4");
}

beforeEach(() => {
  switchUser("U4"); // pharmacist
  resetCallLog();
  resetRsd();
  resetStock();
  resetRx(false);
  connect(true);
});

describe("GTINs of the sample drugs", () => {
  it("gives every drug its own valid 14-digit GTIN, and finds the drug from it", () => {
    const all = DRUGS.map(gtinOf);
    expect(new Set(all).size).toBe(DRUGS.length);
    for (const d of DRUGS) {
      expect(gtinOf(d)).toMatch(/^\d{14}$/);
      expect(validCheckDigit(gtinOf(d))).toBe(true);
      expect(drugByGtin(gtinOf(d))?.id).toBe(d.id);
    }
    expect(drugByGtin("00000000000000")).toBeUndefined();
  });
  it("works out whole packs from units", () => {
    const d = { pack: { type: "box", size: 30 } };
    expect([packsNeeded(0, d), packsNeeded(1, d), packsNeeded(30, d), packsNeeded(31, d), packsNeeded(95, d)]).toEqual([0, 1, 1, 2, 4]);
  });
});

describe("the sample data", () => {
  it("has accepted packs for every drug and three dispatches waiting", () => {
    const s = getRsd();
    for (const d of DRUGS) expect(packsList(s).some((p) => p.drugId === d.id && p.status === "accepted")).toBe(true);
    const pending = pendingDispatches(s);
    expect(pending).toHaveLength(3);
    for (const d of pending) {
      expect(d.packKeys.length).toBeGreaterThan(0);
      expect(d.packKeys.every((k) => s.packs[k].status === "received")).toBe(true);
    }
    expect(countsByStatus(s).received).toBe(pending.reduce((n, d) => n + d.packKeys.length, 0));
    expect(new Set(Object.keys(s.packs)).size).toBe(packsList(s).length);
  });
});

describe("which packs may be dispensed", () => {
  it("allows an accepted pack that is in date", () => {
    expect(dispenseProblem(pack(), "DRG002", NOW)).toBe("");
    expect(canDispense(pack(), "DRG002", NOW)).toBe(true);
  });
  it("allows a pack whose sale was cancelled", () => {
    expect(canDispense(pack({ status: "cancelled" }), "DRG002", NOW)).toBe(true);
  });
  it("refuses a pack that is not accepted yet", () => {
    expect(dispenseProblem(pack({ status: "received" }), "DRG002", NOW)).toMatch(/not accepted yet/);
  });
  it("refuses a pack that was rejected", () => {
    expect(dispenseProblem(pack({ status: "rejected" }), "DRG002", NOW)).toMatch(/rejected/);
  });
  it("refuses a pack already dispensed, and says on which dispense", () => {
    const p = pack({ status: "dispensed", sale: { dispenseNumber: "DSP-0042", lineId: "x", service: "Pharmacy Sale", at: NOW.toISOString() } });
    expect(dispenseProblem(p, "DRG002", NOW)).toMatch(/already dispensed on DSP-0042/);
  });
  it("refuses an expired pack, and allows one that expires today", () => {
    expect(dispenseProblem(pack({ expiry: iso(-1) }), "DRG002", NOW)).toMatch(/expired on/);
    expect(dispenseProblem(pack({ expiry: iso(0) }), "DRG002", NOW)).toBe("");
  });
  it("refuses a pack of another medicine, and an unknown pack", () => {
    expect(dispenseProblem(pack({ drugId: "DRG001" }), "DRG002", NOW)).toMatch(/not /);
    expect(dispenseProblem(undefined, "DRG002", NOW)).toMatch(/not known/);
  });
  it("suggests accepted packs, earliest expiry first, skipping packs already taken", () => {
    const first = suggestPacks("DRG002", 3);
    expect(first).toHaveLength(3);
    expect(first.every((p) => p.status === "accepted" && p.drugId === "DRG002")).toBe(true);
    expect([...first].sort((a, b) => a.expiry.localeCompare(b.expiry))).toEqual(first);
    const next = suggestPacks("DRG002", 1, undefined, [packKey(first[0].gtin, first[0].serial)]);
    expect(next[0].serial).not.toBe(first[0].serial);
    const waiting = pendingDispatches()[0];
    const drugId = getRsd().packs[waiting.packKeys[0]].drugId;
    expect(suggestPacks(drugId, 99).some((p) => p.status === "received")).toBe(false);
  });
});

describe("accepting and rejecting a dispatch", () => {
  it("accepts every pack in the dispatch with one call, and logs it", () => {
    const d = pendingDispatches()[0];
    const r = acceptDispatch(d.id);
    expect(r.ok).toBe(true);
    expect(d.packKeys.every((k) => getRsd().packs[k].status === "accepted")).toBe(true);
    expect(getRsd().dispatches.find((x) => x.id === d.id)?.status).toBe("accepted");
    expect(pendingDispatches()).toHaveLength(2);
    expect(ownCalls("rsd").at(-1)).toMatchObject({ operation: "Accept Dispatch", ok: true });
    expect(acceptDispatch(d.id).ok).toBe(false);
  });
  it("rejects a dispatch only with a reason, and the packs stay unusable", () => {
    const d = pendingDispatches()[0];
    expect(rejectDispatch(d.id, " ").ok).toBe(false);
    expect(pendingDispatches()).toHaveLength(3);
    expect(rejectDispatch(d.id, "Wrong batch delivered").ok).toBe(true);
    const p = getRsd().packs[d.packKeys[0]];
    expect(p.status).toBe("rejected");
    expect(canDispense(p, p.drugId)).toBe(false);
    expect(getRsd().dispatches.find((x) => x.id === d.id)).toMatchObject({ status: "rejected", reason: "Wrong batch delivered" });
    expect(acceptDispatch(d.id).ok).toBe(false);
  });
  it("accepts a single scanned pack, checks it against the dispatch, and finishes the dispatch with its last pack", () => {
    const d = pendingDispatches()[0];
    const packs = d.packKeys.map((k) => getRsd().packs[k]);
    const g = (p: Pack) => ({ gtin: p.gtin, serial: p.serial, batch: p.batch, expiry: p.expiry });
    expect(acceptPack({ ...g(packs[0]), batch: "OTHER" }).ok).toBe(false);
    expect(acceptPack({ gtin: packs[0].gtin, serial: "NOPE", batch: packs[0].batch, expiry: packs[0].expiry }).ok).toBe(false);
    for (const p of packs.slice(0, -1)) expect(acceptPack(g(p)).ok).toBe(true);
    expect(getRsd().dispatches.find((x) => x.id === d.id)?.status).toBe("pending");
    expect(acceptPack(g(packs[0])).ok).toBe(false); // already accepted
    expect(acceptPack(g(packs[packs.length - 1])).ok).toBe(true);
    expect(getRsd().dispatches.find((x) => x.id === d.id)?.status).toBe("accepted");
    expect(ownCalls("rsd").filter((c) => !c.ok).length).toBe(3);
  });
  it("needs the dispensing permission", () => {
    switchUser("U3"); // registration
    expect(acceptDispatch(pendingDispatches()[0].id).ok).toBe(false);
    expect(pendingDispatches()).toHaveLength(3);
  });
  it("does nothing and requires nothing when RSD is switched off", () => {
    connect(false);
    expect(acceptDispatch(pendingDispatches()[0].id).ok).toBe(false);
    expect(reportSale({ dispenseNumber: "D1", lines: [{ itemId: "i", lineId: "l", drugId: "DRG002" }], scans: { i: [] }, inpatient: false })).toEqual([]);
    expect(ownCalls("rsd")).toHaveLength(0);
  });
});

describe("what was scanned for a dispense", () => {
  const drug = DRUG_BY_ID.DRG002;
  const line = (lot?: string) => [{ itemId: "i1", drugId: "DRG002", quantity: drug.pack.size + 1, lot }];
  const keys = (n: number, lot?: string) => suggestPacks("DRG002", n, lot).map((p) => packKey(p.gtin, p.serial));

  it("is fine when every pack needed is scanned and usable", () => {
    expect(packsNeeded(drug.pack.size + 1, drug)).toBe(2);
    expect(scanProblems(line(), { i1: keys(2) }, NOW)).toEqual([]);
  });
  it("asks for the missing packs, and for the extra to be removed", () => {
    expect(scanProblems(line(), { i1: keys(1) }, NOW)[0]).toMatch(/1 of 2 scanned/);
    expect(scanProblems(line(), {}, NOW)[0]).toMatch(/0 of 2 scanned/);
    expect(scanProblems(line(), { i1: keys(3) }, NOW).join(" ")).toMatch(/Remove the extra/);
  });
  it("refuses a pack scanned twice, a pack from another batch than the one chosen, and a pack that cannot be dispensed", () => {
    const [a] = keys(1);
    expect(scanProblems(line(), { i1: [a, a] }, NOW).join(" ")).toMatch(/scanned twice/);
    const lot = firstUsableBatch(batchesFor(drug, []))!.lot;
    const other = packsList(getRsd()).find((p) => p.drugId === "DRG002" && p.batch !== lot && p.status === "accepted")!;
    expect(scanProblems(line(lot), { i1: [packKey(other.gtin, other.serial), keys(1, lot)[0]] }, NOW).join(" ")).toMatch(/from batch/);
    const waiting = packsList(getRsd()).find((p) => p.status === "received")!;
    const wrong = scanProblems([{ itemId: "i1", drugId: waiting.drugId, quantity: 1 }], { i1: [packKey(waiting.gtin, waiting.serial)] }, NOW);
    expect(wrong.join(" ")).toMatch(/not accepted yet/);
  });
});

describe("reporting a sale and a cancel", () => {
  const lineOf = (k: string[]) => ({ lines: [{ itemId: "i1", lineId: "L-1", drugId: "DRG002" }], scans: { i1: k } });
  const taken = () => suggestPacks("DRG002", 2).map((p) => packKey(p.gtin, p.serial));

  it("sells each pack once: the pack becomes Dispensed and the call is logged", () => {
    const k = taken();
    const r = reportSale({ dispenseNumber: "DSP-1", ...lineOf(k), inpatient: false });
    expect(r.every((x) => x.ok)).toBe(true);
    for (const key of k) expect(getRsd().packs[key]).toMatchObject({ status: "dispensed", sale: { dispenseNumber: "DSP-1", lineId: "L-1", service: "Pharmacy Sale" } });
    expect(ownCalls("rsd").map((c) => [c.operation, c.ok])).toEqual([["Pharmacy Sale", true], ["Pharmacy Sale", true]]);
    expect(packsOfLine("DSP-1", "L-1")).toHaveLength(2);
    const again = reportSale({ dispenseNumber: "DSP-2", ...lineOf(k), inpatient: false });
    expect(again.every((x) => !x.ok)).toBe(true);
    expect(ownCalls("rsd").at(-1)?.ok).toBe(false);
    expect(getRsd().packs[k[0]].sale?.dispenseNumber).toBe("DSP-1");
  });
  it("reports Consume instead of Pharmacy Sale for an inpatient", () => {
    reportSale({ dispenseNumber: "DSP-3", ...lineOf(taken().slice(0, 1)), inpatient: true });
    expect(ownCalls("rsd").at(-1)).toMatchObject({ operation: "Consume", ok: true });
  });
  it("cancels the sale: the pack is Cancelled, can be dispensed again, and the line still shows it", () => {
    const [k] = taken();
    reportSale({ dispenseNumber: "DSP-4", ...lineOf([k]), inpatient: false });
    expect(reportCancel("DSP-4", "L-1")).toHaveLength(1);
    expect(getRsd().packs[k].status).toBe("cancelled");
    expect(ownCalls("rsd").at(-1)).toMatchObject({ operation: "Pharmacy Sale Cancel", ok: true });
    expect(canDispense(getRsd().packs[k], "DRG002")).toBe(true);
    expect(packsOfLine("DSP-4", "L-1")).toHaveLength(1);
    expect(reportCancel("DSP-4", "L-1")).toEqual([]);
    reportSale({ dispenseNumber: "DSP-5", ...lineOf([k]), inpatient: false });
    expect(getRsd().packs[k]).toMatchObject({ status: "dispensed", sale: { dispenseNumber: "DSP-5" } });
  });
  it("reports Consume Cancel for an inpatient sale", () => {
    const [k] = taken();
    reportSale({ dispenseNumber: "DSP-6", ...lineOf([k]), inpatient: true });
    reportCancel("DSP-6", "L-1");
    expect(ownCalls("rsd").at(-1)?.operation).toBe("Consume Cancel");
  });
});

describe("through the dispense", () => {
  const DRUG = DRUG_BY_ID.DRG002;
  const enc = () => getState().encounters.find((e) => e.patientId === "P001")!;
  const newItem = (): NewItem => ({
    drugId: DRUG.id, dose: DRUG.defaultDose, frequencyId: DRUG.defaultFrequency, asNeeded: false, durationDays: DRUG.defaultDays, route: DRUG.defaultRoute,
    patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "J18.9", text: "Pneumonia, unspecified organism" }, usage: "outpatient",
  });
  function verified() {
    const e = enc();
    updateEncounter(e.visitNumber, (x) => { x.vitals = { ...(x.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), weight: "84" }; }, { touch: false });
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx, item } = addDraftItem(e, newItem());
    expect(sendPrescription(rx.id, "create")?.ok).toBe(true);
    expect(verifyItem(rx.id, item.id, "ok").ok).toBe(true);
    const lot = firstUsableBatch(batchesFor(DRUG, []))!;
    const req = (packs?: Record<string, string[]>): DispenseRequest => ({
      rxId: rx.id, lines: [{ itemId: item.id, quantity: item.quantity, lot: lot.lot, expiry: lot.expiry }], verification: { patientScan: true, drugScans: [item.id] }, packs,
    });
    const keys = suggestPacks(DRUG.id, packsNeeded(item.quantity, DRUG), lot.lot).map((p) => packKey(p.gtin, p.serial));
    return { item, req, keys };
  }

  it("refuses to dispense when no pack is scanned, and sends nothing", () => {
    const { req } = verified();
    const res = dispenseChecked(req());
    expect(res.outcome).toBeNull();
    expect(res.problems.join(" ")).toMatch(/Scan/);
    expect(getRx().dispenses).toHaveLength(0);
    expect(ownCalls("rsd")).toHaveLength(0);
  });
  it("refuses a pack that is not accepted yet", () => {
    const { item, req, keys } = verified();
    const waiting = packsList(getRsd()).find((p) => p.status === "received")!;
    const bad = dispenseChecked(req({ [item.id]: [packKey(waiting.gtin, waiting.serial)] }));
    expect(bad.outcome).toBeNull();
    expect(bad.problems.length).toBeGreaterThan(0);
    expect(getRx().dispenses).toHaveLength(0);
    expect(keys.length).toBeGreaterThan(0);
  });
  it("dispenses with the packs, reports the sale, and cancelling the line cancels the sale", () => {
    const { item, req, keys } = verified();
    const res = dispenseChecked(req({ [item.id]: keys }));
    expect(res.problems).toEqual([]);
    expect(res.outcome?.ok).toBe(true);
    expect(res.rsd?.every((r) => r.ok)).toBe(true);
    for (const k of keys) expect(getRsd().packs[k].status).toBe("dispensed");
    const d = getRx().dispenses[0];
    expect(packsOfLine(d.number, d.lines[0].id)).toHaveLength(keys.length);
    expect(ownCalls("rsd").filter((c) => c.operation === "Pharmacy Sale")).toHaveLength(keys.length);

    const cancel = changeDispenseLine(d.id, d.lines[0].id, "cancel");
    expect(cancel.outcome?.ok).toBe(true);
    expect(cancel.rsd).toHaveLength(keys.length);
    for (const k of keys) expect(getRsd().packs[k].status).toBe("cancelled");
    expect(ownCalls("rsd").filter((c) => c.operation === "Pharmacy Sale Cancel")).toHaveLength(keys.length);
  });
  it("does not ask for packs when RSD is switched off", () => {
    connect(false);
    const { req } = verified();
    const res = dispenseChecked(req());
    expect(res.problems).toEqual([]);
    expect(res.outcome?.ok).toBe(true);
    expect(ownCalls("rsd")).toHaveLength(0);
  });
});
