import { setRsdMode } from "./integrations/rsd-test-util";
import { beforeEach, describe, expect, it } from "vitest";
import { DRUG_BY_ID } from "./rx-catalogue";
import { addDraftItem, getRx, resetRx, setHeight, type NewItem } from "./rx";
import { sendPrescription, type DispenseRequest } from "./rx-send";
import { batchesFor, firstUsableBatch, stockProblem } from "./rx-stock";
import { dispenseChecked, dispenseGate, verifyItem } from "./rx-verify";
import { switchUser } from "./session";
import { getState, updateEncounter } from "./store";
import { getStock, resetStock, saveOpeningStock, saveReceipt, setStock, stockOnHand } from "./pharmacy-stock";

const DRUG = DRUG_BY_ID.DRG002;
const enc = () => getState().encounters.find((e) => e.patientId === "P001")!;
const newItem = (): NewItem => ({
  drugId: DRUG.id, dose: DRUG.defaultDose, frequencyId: DRUG.defaultFrequency, asNeeded: false, durationDays: DRUG.defaultDays, route: DRUG.defaultRoute,
  patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "J18.9", text: "Pneumonia, unspecified organism" }, usage: "outpatient",
});
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** A sent and verified prescription for the drug, and a request to dispense `qty` from `lot`. */
function verified() {
  const e = enc();
  setHeight(e.visitNumber, e.patientId, 178);
  const { rx, item } = addDraftItem(e, newItem());
  expect(sendPrescription(rx.id, "create")?.ok).toBe(true);
  expect(verifyItem(rx.id, item.id, "ok").ok).toBe(true);
  const req = (qty: number, lot: string, expiry?: string): DispenseRequest => ({
    rxId: rx.id, lines: [{ itemId: item.id, quantity: qty, lot, expiry }], verification: { patientScan: true, drugScans: [item.id] },
  });
  return { rx, item, req };
}

const rows = () => stockOnHand(getStock(), getRx().dispenses).filter((r) => r.drug.id === DRUG.id);
const available = () => Math.round(rows().reduce((n, r) => n + r.available, 0) * 1e4) / 1e4;

describe("stock added on the Pharmacy Stock screens can be dispensed", () => {
  beforeEach(() => {
    switchUser("U4"); // pharmacist
    resetStock();
    setRsdMode("off"); // these tests dispense without RSD packs
    resetRx(false);
    updateEncounter(enc().visitNumber, (e) => {
      e.vitals = { ...(e.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), weight: "84" };
    }, { touch: false });
  });

  it("offers opening stock as a batch, and not a draft receipt", () => {
    expect(batchesFor(DRUG, []).some((b) => b.lot === "NEW-01")).toBe(false);
    expect(saveOpeningStock({ location: "Main Pharmacy", date: day(0), lines: [{ drugId: DRUG.id, lot: "new-01", expiry: day(400), quantity: 500, unitCost: 1 }] }, []).ok).toBe(true);
    const b = batchesFor(DRUG, []).find((x) => x.lot === "NEW-01");
    expect(b).toMatchObject({ expiry: day(400), base: 500, onHand: 500 });
    saveReceipt({ date: day(0), supplier: "Al Wadi Medical Supply", invoiceNo: "INV-1", location: "Main Pharmacy", lines: [{ drugId: DRUG.id, lot: "DRAFT-1", expiry: day(300), quantity: 50 }] }, "Draft", []);
    expect(batchesFor(DRUG, []).some((x) => x.lot === "DRAFT-1")).toBe(false);
  });

  it("passes the dispense gate and dispenses from the added batch", () => {
    saveOpeningStock({ location: "Main Pharmacy", date: day(0), lines: [{ drugId: DRUG.id, lot: "NEW-01", expiry: day(400), quantity: 500 }] }, []);
    const { req, item } = verified();
    const request = req(item.quantity, "NEW-01", day(400));
    expect(dispenseGate(getRx(), request)).toEqual([]);
    const before = available();
    const res = dispenseChecked(request);
    expect(res.problems).toEqual([]);
    expect(res.outcome?.ok).toBe(true);
    expect(getRx().dispenses[0].lines[0].lot).toBe("NEW-01");
    // The units come off the added batch, once.
    const row = rows().find((r) => r.lot === "NEW-01")!;
    expect(row.dispensed).toBe(item.quantity);
    expect(row.available).toBe(500 - item.quantity);
    expect(available()).toBe(Math.round((before - item.quantity) * 1e4) / 1e4);
    expect(batchesFor(DRUG, getRx().dispenses).find((b) => b.lot === "NEW-01")!.onHand).toBe(500 - item.quantity);
  });

  it("refuses a lot that was never added, as before", () => {
    const { req, item } = verified();
    expect(dispenseGate(getRx(), req(item.quantity, "NEW-01", day(400))).join(" ")).toContain("not in stock");
  });

  it("the screens refuse a lot that already exists, so the same lot is never entered twice", () => {
    const base = batchesFor(DRUG, [])[0];
    const r = saveReceipt({ date: day(0), supplier: "Al Wadi Medical Supply", invoiceNo: "INV-2", location: "Main Pharmacy", lines: [{ drugId: DRUG.id, lot: base.lot, expiry: base.expiry, quantity: 100 }] }, "Draft", []);
    expect(r.ok).toBe(false);
  });

  /** Only for saved data from outside the screens: the same lot twice must still count once. */
  const inject = (lot: string, expiry: string, quantity: number) => {
    const s = getStock();
    setStock({ ...s, openings: [...s.openings, { id: "o-x", number: "OPN-X", location: "Main Pharmacy", date: day(0), by: "t", at: new Date().toISOString(), lines: [{ drugId: DRUG.id, lot, expiry, quantity }] }] });
  };

  it("a lot that exists twice adds up to one batch, and the stock screen counts a unit handed over only once", () => {
    const base = batchesFor(DRUG, [])[0];
    inject(base.lot, base.expiry, 100);
    const merged = batchesFor(DRUG, []).find((b) => b.lot === base.lot)!;
    expect(merged.base).toBe(base.base + 100);
    expect(batchesFor(DRUG, []).filter((b) => b.lot === base.lot)).toHaveLength(1);
    const { req, item } = verified();
    const before = available();
    expect(dispenseChecked(req(item.quantity, base.lot, base.expiry)).outcome?.ok).toBe(true);
    expect(available()).toBe(Math.round((before - item.quantity) * 1e4) / 1e4);
  });

  it("the Dispense dialog's first usable batch can be an added one when it expires first", () => {
    saveOpeningStock({ location: "Main Pharmacy", date: day(0), lines: [{ drugId: DRUG.id, lot: "EARLY-1", expiry: day(5), quantity: 200 }] }, []);
    const first = firstUsableBatch(batchesFor(DRUG, []));
    expect(first?.lot).toBe("EARLY-1");
    expect(stockProblem(DRUG, batchesFor(DRUG, []), "EARLY-1", 10, 10)).toBeNull();
  });
});
