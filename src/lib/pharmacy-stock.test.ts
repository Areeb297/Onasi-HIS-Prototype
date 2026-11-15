import { beforeEach, describe, expect, it } from "vitest";
import {
  activeQueue, daysToExpiry, expiryWatch, extraBatchesFor, getStock, lineProblems, knownLots, lowStock, pharmacyOverview, postReceipt,
  deleteDraftReceipt, receiptValue, reorderLevel, resetStock, saveOpeningStock, saveReceipt, stockOnHand, type StockLineInput,
} from "./pharmacy-stock";
import { DRUG_BY_ID } from "./rx-catalogue";
import { batchesFor } from "./rx-stock";
import type { Dispense, DispenseLine, Prescription, RxItem, RxState } from "./rx-types";
import { switchUser } from "./session";

const TODAY = new Date("2026-11-15T09:00:00Z");
const PARA = DRUG_BY_ID.DRG001; // pack 30, first batch is short: 6 + 120 = 126 units

const day = (offset: number) => new Date(TODAY.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const dline = (drugId: string, lot: string, quantity: number, over: Partial<DispenseLine> = {}): DispenseLine => ({
  id: `l-${lot}-${quantity}`, identifier: "D-1", itemId: "i-x", drugId, quantity, type: "FF", status: "completed", lot, refillsRemaining: 0, daysSupply: 1, version: 1, ...over,
});
const disp = (lines: DispenseLine[], at = TODAY.toISOString(), rxId = "rx-other"): Dispense => ({
  id: `d-${Math.random()}`, number: "DSP-1", rxId, visitNumber: "V1", patientId: "P1", dispenser: "U4", handedOverAt: at, lines, verification: { patientScan: true, drugScans: [] },
});
const line = (over: Partial<StockLineInput> = {}): StockLineInput => ({ drugId: "DRG001", lot: "NEW-01", expiry: day(400), quantity: 30, unitCost: 1.5, ...over });
const opening = (lines: StockLineInput[], location = "Main Pharmacy") => saveOpeningStock({ location, date: day(0), lines }, [], TODAY);
const receipt = (lines: StockLineInput[]) => ({ date: day(0), supplier: "Al Wadi Medical Supply", invoiceNo: "INV-5521", location: "Inpatient Pharmacy", lines });

const rowsOf = (drugId: string, dispenses: Dispense[] = []) => stockOnHand(getStock(), dispenses, TODAY).filter((r) => r.drug.id === drugId);

beforeEach(() => {
  resetStock();
  switchUser("U4"); // pharmacist
});

describe("stock on hand", () => {
  it("shows the rx-stock batches in the main pharmacy with the same amounts", () => {
    const base = batchesFor(PARA, [], TODAY);
    const rows = rowsOf("DRG001");
    expect(rows.map((r) => [r.lot, r.available, r.location])).toEqual(base.map((b) => [b.lot, b.onHand, "Main Pharmacy"]));
    expect(rows.reduce((n, r) => n + r.available, 0)).toBe(126);
  });

  it("takes completed dispenses off the batch by lot and ignores cancelled lines", () => {
    const lot = batchesFor(PARA, [], TODAY)[1].lot;
    const rows = rowsOf("DRG001", [disp([dline("DRG001", lot, 20), dline("DRG001", lot, 50, { status: "cancelled" })])]);
    const r = rows.find((x) => x.lot === lot)!;
    expect(r.dispensed).toBe(20);
    expect(r.available).toBe(100);
  });

  it("adds opening stock as a new batch: available is opening less dispensed, never below zero", () => {
    expect(opening([line({ lot: "new-01", quantity: 40 })]).ok).toBe(true);
    let r = rowsOf("DRG001", [disp([dline("DRG001", "NEW-01", 15)])]).find((x) => x.lot === "NEW-01")!;
    expect([r.base, r.received, r.dispensed, r.available, r.source]).toEqual([40, 0, 15, 25, "Opening Stock"]);
    r = rowsOf("DRG001", [disp([dline("DRG001", "new-01", 55)])]).find((x) => x.lot === "NEW-01")!;
    expect(r.available).toBe(0);
    expect(r.dispensed).toBe(40);
  });

  it("a draft goods receipt adds nothing; posting adds the received quantity at its location", () => {
    const res = saveReceipt(receipt([line({ lot: "GR-1", quantity: 60, unitCost: 2 })]), "Draft", [], TODAY);
    expect(res.ok).toBe(true);
    expect(rowsOf("DRG001").some((r) => r.lot === "GR-1")).toBe(false);
    if (!res.ok) return;
    expect(receiptValue(res.value)).toBe(120);
    expect(postReceipt(res.value.id, [], TODAY).ok).toBe(true);
    const r = rowsOf("DRG001").find((x) => x.lot === "GR-1")!;
    expect([r.base, r.received, r.available, r.location]).toEqual([0, 60, 60, "Inpatient Pharmacy"]);
    expect(extraBatchesFor("DRG001")).toEqual([{ lot: "GR-1", expiry: day(400), base: 60 }]);
    expect(postReceipt(res.value.id, [], TODAY).ok).toBe(false);
    expect(deleteDraftReceipt(res.value.id).ok).toBe(false);
  });
});

describe("low stock and expiry watch", () => {
  it("flags a drug under five packs and clears it once stock arrives", () => {
    expect(reorderLevel(PARA)).toBe(150);
    let low = lowStock(stockOnHand(getStock(), [], TODAY)).find((x) => x.drug.id === "DRG001")!;
    expect([low.available, low.short]).toEqual([126, 24]);
    opening([line({ quantity: 30 })]);
    low = lowStock(stockOnHand(getStock(), [], TODAY)).find((x) => x.drug.id === "DRG001")!;
    expect(low).toBeUndefined();
  });

  it("does not count expired batches as usable stock", () => {
    opening([line({ lot: "SHORT", expiry: day(10), quantity: 100 })]);
    expect(lowStock(stockOnHand(getStock(), [], TODAY)).some((x) => x.drug.id === "DRG001")).toBe(false);
    const later = new Date(TODAY.getTime() + 20 * 86_400_000);
    const rows = stockOnHand(getStock(), [], later).filter((r) => r.drug.id === "DRG001");
    expect(rows.find((r) => r.lot === "SHORT")?.expired).toBe(true);
    expect(lowStock(rows)[0].available).toBe(126);
  });

  it("lists batches with stock that expire within 90 days, earliest first, and skips empty ones", () => {
    opening([line({ lot: "SOON", expiry: day(30) }), line({ lot: "SOONER", expiry: day(10) }), line({ lot: "LATE", expiry: day(200) })]);
    const watch = expiryWatch(rowsOf("DRG001")).filter((r) => r.source === "Opening Stock");
    expect(watch.map((r) => [r.lot, r.daysLeft])).toEqual([["SOONER", 10], ["SOON", 30]]);
    const emptied = expiryWatch(rowsOf("DRG001", [disp([dline("DRG001", "SOON", 30)])])).filter((r) => r.source === "Opening Stock");
    expect(emptied.map((r) => r.lot)).toEqual(["SOONER"]);
    expect(daysToExpiry(day(-3), TODAY)).toBe(-3);
  });
});

describe("checks before saving", () => {
  const known = () => knownLots(getStock(), [], TODAY);
  it("needs a positive quantity, a lot, a future expiry and a cost that is not negative", () => {
    const p = lineProblems([line({ quantity: 0, lot: "  ", expiry: day(0), unitCost: -1 })], known(), TODAY);
    expect(p).toEqual([
      "Line 1: Enter the batch (lot) number.",
      "Line 1: The expiry date must be after today. Expired stock cannot be received.",
      "Line 1: Enter a quantity above zero.",
      "Line 1: The unit cost cannot be below zero.",
    ]);
    expect(lineProblems([line({ unitCost: undefined })], known(), TODAY)).toEqual([]);
    expect(lineProblems([], known(), TODAY)).toEqual(["Add at least one item."]);
  });

  it("rejects a lot already in stock for the same drug, or entered twice, but allows it for another drug", () => {
    const existing = batchesFor(PARA, [], TODAY)[0].lot;
    expect(lineProblems([line({ lot: existing.toLowerCase() })], known(), TODAY)[0]).toMatch(/already in stock/);
    expect(lineProblems([line({ lot: "X1" }), line({ lot: "x1" })], known(), TODAY)).toEqual(["Line 2: Batch X1 of Paracetamol is entered twice."]);
    expect(lineProblems([line({ lot: "X1" }), line({ lot: "X1", drugId: "DRG002" })], known(), TODAY)).toEqual([]);
    opening([line({ lot: "X1" })]);
    expect(saveReceipt(receipt([line({ lot: "X1" })]), "Posted", [], TODAY).ok).toBe(false);
  });

  it("needs a supplier, an invoice number and a location on a goods receipt", () => {
    const r = saveReceipt({ ...receipt([line()]), supplier: "", invoiceNo: " ", location: "Somewhere" }, "Posted", [], TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["Choose the supplier.", "Enter the supplier invoice or delivery note number.", "Choose the location that receives the goods."]);
  });

  it("refuses to post a draft whose lot was added in the meantime", () => {
    const d = saveReceipt(receipt([line({ lot: "DUP" })]), "Draft", [], TODAY);
    opening([line({ lot: "DUP" })]);
    if (d.ok) expect(postReceipt(d.value.id, [], TODAY).ok).toBe(false);
  });

  it("only staff who dispense can change stock", () => {
    switchUser("U2"); // nurse
    expect(opening([line()]).ok).toBe(false);
    expect(getStock().openings).toHaveLength(0);
  });
});

describe("pharmacy home overview", () => {
  const item = (id: string, over: Partial<RxItem> = {}): RxItem => ({
    id, identifier: id, drugId: "DRG001", dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 5, quantity: 10, quantityManual: false, route: "PO",
    patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "R52", text: "Pain" }, status: "active", version: 1, ...over,
  });
  const stamp = { version: 1, by: "N", byId: "U4", at: TODAY.toISOString() };
  const rx = (id: string, items: RxItem[], sentAt?: string): Prescription => ({
    id, number: id, visitNumber: "V1", patientId: "P1", prescriberId: "D1", authoredAt: TODAY.toISOString(), usage: "outpatient", groupId: id, controlled: false, items, dirty: false, sentAt,
  });
  const state: RxState = {
    prescriptions: [
      rx("rx-1", [
        item("a"),
        item("b", { verify: { status: "verified", ...stamp } }),
        item("c", { verify: { status: "queried", ...stamp, query: { text: "Dose?" } } }),
        item("d", { verify: { status: "queried", ...stamp, query: { text: "Dose?", answer: "Yes" } } }),
        item("e", { patientProvided: true }),
        item("f", { status: "cancelled" }),
      ], "2026-11-15T07:00:00Z"),
      rx("rx-2", [item("g")]),
    ],
    dispenses: [
      disp([dline("DRG002", "L1", 5), dline("DRG002", "L1", 2), dline("DRG002", "L1", 9, { status: "cancelled" })], TODAY.toISOString()),
      disp([dline("DRG002", "L1", 3)], new Date(TODAY.getTime() - 86_400_000).toISOString()),
    ],
    sends: [], heights: {}, counters: { rx: 2, item: 7, disp: 2, ref: 0 },
  };

  it("counts waiting checks, ready items, today's dispensed lines and stock alerts", () => {
    const o = pharmacyOverview(state, getStock(), TODAY);
    expect(o.waiting).toBe(2); // a (new) and d (answered)
    expect(o.ready).toBe(1); // b
    expect(o.dispensedToday).toBe(2);
    expect(o.lowStock).toBe(lowStock(stockOnHand(getStock(), state.dispenses, TODAY)).length);
    expect(o.expiringSoon).toBe(expiryWatch(stockOnHand(getStock(), state.dispenses, TODAY)).length);
  });

  it("queues only sent, active items the pharmacy handles", () => {
    expect(activeQueue(state).map((q) => [q.item.id, q.status])).toEqual([["a", "to-verify"], ["b", "verified"], ["c", "queried"], ["d", "answered"]]);
  });
});
