import { beforeEach, describe, expect, it } from "vitest";
import { RX_BOARD_STAGES, rxBoardCanMove, rxBoardStageOf, rxStats } from "@/components/board/rx-board";
import { DRUG_BY_ID } from "./rx-catalogue";
import { addDraftItem, getRx, resetRx, setHeight, updateItem, type NewItem } from "./rx";
import { planDispense, sendPrescription, type DispenseRequest } from "./rx-send";
import { batchesFor, firstUsableBatch, fmtExpiry, stockProblem, totalOnHand } from "./rx-stock";
import type { Dispense } from "./rx-types";
import {
  answerQuery, buildCheckSheet, dispenseChecked, dispenseGate, kidneyNotes, pharmacyItems, queryPrescriber, rejectItem, secureProblems, sheetNeedsNote,
  verifiedOpenItems, verifyItem, verifyStatusOf, witnessProblems, type SheetInput,
} from "./rx-verify";
import { currentUser, switchUser } from "./session";
import { getState, updateEncounter } from "./store";

const enc = () => getState().encounters.find((e) => e.patientId === "P001") as NonNullable<ReturnType<typeof getState>["encounters"][number]>;
const newItem = (drugId: string, over: Partial<NewItem> = {}): NewItem => {
  const d = DRUG_BY_ID[drugId];
  return {
    drugId, dose: d.defaultDose, frequencyId: d.defaultFrequency, asNeeded: false, durationDays: d.defaultDays, route: d.defaultRoute,
    patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "J18.9", text: "Pneumonia, unspecified organism" }, usage: "outpatient", ...over,
  };
};
const item0 = () => getRx().prescriptions[0].items[0];
const WITNESS = { name: "Huda Alotaibi", staffNo: "U2" };

/** A sent prescription with one item, and a request that passes the scans and takes from a batch with enough stock. */
function sent(drugId: string, over: Partial<NewItem> = {}) {
  const e = enc();
  setHeight(e.visitNumber, e.patientId, 178);
  const { rx, item } = addDraftItem(e, newItem(drugId, over));
  expect(sendPrescription(rx.id, "create")?.ok).toBe(true);
  const batches = batchesFor(DRUG_BY_ID[drugId], getRx().dispenses);
  const big = batches.find((b) => b.onHand >= item.quantity) ?? batches[0];
  const req = (qty = item.quantity, more: Partial<DispenseRequest> = {}): DispenseRequest => ({
    rxId: rx.id,
    lines: [{ itemId: item.id, quantity: qty, lot: big.lot, expiry: big.expiry }],
    verification: { patientScan: true, drugScans: [item.id] },
    ...more,
  });
  return { rx, item, req, big };
}

beforeEach(() => {
  switchUser("U4"); // pharmacist
  resetRx(false);
  updateEncounter(enc().visitNumber, (e) => {
    e.vitals = { ...(e.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), weight: "84" };
  }, { touch: false });
});

describe("pharmacist verification", () => {
  it("a new item arrives as To Verify and cannot be dispensed", () => {
    const { req } = sent("DRG002");
    expect(verifyStatusOf(item0())).toBe("to-verify");
    expect(pharmacyItems(getRx(), getRx().prescriptions[0])[0].status).toBe("to-verify");
    expect(verifiedOpenItems(getRx(), getRx().prescriptions[0])).toHaveLength(0);
    const res = dispenseChecked(req());
    expect(res.outcome).toBeNull();
    expect(res.problems[0]).toContain("not verified");
    expect(getRx().dispenses).toHaveLength(0);
    expect(rxBoardStageOf(getRx(), getRx().prescriptions[0])).toBe("verify");
  });

  it("records who verified and when, sends nothing, and then the item can be dispensed", () => {
    const { rx, item, req } = sent("DRG002");
    const before = getRx().sends.length;
    expect(verifyItem(rx.id, item.id).ok).toBe(true);
    expect(getRx().sends.length).toBe(before); // a hospital step: no message
    const v = item0().verify;
    expect(v).toMatchObject({ status: "verified", by: currentUser().name, byId: "U4", version: 1 });
    expect(new Date(v?.at ?? "").getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(rxBoardStageOf(getRx(), getRx().prescriptions[0])).toBe("pending");
    const res = dispenseChecked(req());
    expect(res.problems).toEqual([]);
    expect(res.outcome?.ok).toBe(true);
  });

  it("a query waits for the prescriber, the answer brings it back, and verify closes it", () => {
    const { rx, item, req } = sent("DRG002");
    expect(queryPrescriber(rx.id, item.id, " ").ok).toBe(false);
    expect(queryPrescriber(rx.id, item.id, "Is 400 mg three times a day intended?").ok).toBe(true);
    expect(verifyStatusOf(item0())).toBe("queried");
    expect(dispenseChecked(req()).problems[0]).toContain("waiting for the prescriber");
    switchUser("U1");
    expect(answerQuery(rx.id, item.id, "").ok).toBe(false);
    expect(answerQuery(rx.id, item.id, "Yes, for 5 days only.").ok).toBe(true);
    expect(item0().verify?.query).toMatchObject({ answer: "Yes, for 5 days only.", answeredBy: "Dr. Khalid Alharbi" });
    expect(verifyStatusOf(item0())).toBe("answered");
    switchUser("U4");
    expect(dispenseChecked(req()).outcome).toBeNull();
    expect(verifyItem(rx.id, item.id).ok).toBe(true);
    expect(item0().verify?.query?.text).toContain("400 mg"); // the trail is kept
    expect(dispenseChecked(req()).outcome?.ok).toBe(true);
  });

  it("a rejected item needs a reason and stays blocked until the prescriber changes it", () => {
    const { rx, item, req } = sent("DRG002");
    expect(rejectItem(rx.id, item.id, "").ok).toBe(false);
    expect(rejectItem(rx.id, item.id, "Dose is too high for this patient.").ok).toBe(true);
    expect(verifyStatusOf(item0())).toBe("rejected");
    expect(item0().status).toBe("active"); // nothing is cancelled or sent by the pharmacy
    expect(dispenseChecked(req()).problems[0]).toContain("rejected");
    updateItem(rx.id, item.id, { durationDays: 3 });
    expect(verifyStatusOf(item0())).toBe("to-verify");
  });

  it("an edit after verification asks for a new check", () => {
    const { rx, item } = sent("DRG002");
    verifyItem(rx.id, item.id);
    updateItem(rx.id, item.id, { dose: 2 });
    expect(item0().version).toBe(2);
    expect(verifyStatusOf(item0())).toBe("to-verify");
  });

  it("treats older saved items that already have a hand over as verified", () => {
    expect(verifyStatusOf({ version: 1 }, 4)).toBe("verified");
    expect(verifyStatusOf({ version: 1 }, 0)).toBe("to-verify");
  });

  it("will not check an item that is on hold", () => {
    const { rx, item } = sent("DRG002");
    sendPrescription(rx.id, "hold", { itemId: item.id, status: "on-hold" });
    expect(verifyItem(rx.id, item.id).problem).toContain("on-hold");
  });
});

describe("check sheet", () => {
  const input = (drugId: string, over: Partial<SheetInput> = {}): SheetInput => {
    const drug = DRUG_BY_ID[drugId];
    return {
      drug, dose: drug.defaultDose, frequencyId: drug.defaultFrequency, durationDays: drug.defaultDays, route: drug.defaultRoute, refills: 0,
      usage: "outpatient", allergies: [], others: [], heightCm: 170, weightKg: 70, ageYears: 40, ...over,
    };
  };
  const sec = (s: ReturnType<typeof buildCheckSheet>, id: string) => s.find((x) => x.id === id)!;

  it("has the six headings and is clear for a normal item", () => {
    const s = buildCheckSheet(input("DRG001"));
    expect(s.map((x) => x.id)).toEqual(["allergy", "duplicate", "interaction", "dose", "weight", "kidney"]);
    expect(sec(s, "allergy").level).toBe("clear");
    expect(sec(s, "duplicate").level).toBe("clear");
    expect(sec(s, "dose").lines.join(" ")).toContain("Usual maximum 4000 mg");
    expect(sec(s, "weight").lines[0]).toContain("70 kg");
    expect(sec(s, "kidney").lines[0]).toContain("No kidney test result");
    expect(sheetNeedsNote(s)).toBe(false);
  });

  it("reuses the prescriber safety rules: allergy, duplicate, interaction and dose", () => {
    const s = buildCheckSheet(input("DRG004", {
      allergies: [{ text: "Penicillin", severity: "SV", reaction: "Rash" }],
      others: [{ drug: DRUG_BY_ID.DRG004, where: "RX-1" }],
      allergyOverride: { reason: "Tolerated before", by: "Dr. A", at: "", allergy: "Penicillin" },
    }));
    expect(sec(s, "allergy").level).toBe("stop");
    expect(sec(s, "allergy").lines.join(" ")).toContain("Tolerated before");
    expect(sec(s, "duplicate").level).toBe("caution");
    expect(sheetNeedsNote(s)).toBe(true);
    const opioid = buildCheckSheet(input("DRG033", { others: [{ drug: DRUG_BY_ID.DRG034, where: "RX-2" }] }));
    expect(sec(opioid, "interaction").level).toBe("caution");
    const high = buildCheckSheet(input("DRG001", { dose: 3, frequencyId: "QID" }));
    expect(sec(high, "dose").level).toBe("caution");
  });

  it("says when weight is missing and shows kidney facts when recorded", () => {
    const s = buildCheckSheet(input("DRG010", { weightKg: undefined, kidney: [{ text: "Creatinine 2.1 mg/dL", concern: true }] }));
    expect(sec(s, "weight").level).toBe("caution");
    expect(sec(s, "kidney").level).toBe("caution");
  });

  it("needs a note to verify when the sheet shows a serious finding", () => {
    const { rx, item } = sent("DRG002");
    expect(verifyItem(rx.id, item.id, "", true).ok).toBe(false);
    expect(verifyItem(rx.id, item.id, "Discussed with the prescriber.", true).ok).toBe(true);
    expect(item0().verify?.note).toBe("Discussed with the prescriber.");
  });

  it("reads kidney notes from the diagnoses and the latest creatinine", () => {
    const notes = kidneyNotes(
      [{ text: "Chronic kidney disease, stage 3" }, { text: "Fever" }],
      [
        { patientId: "P001", results: { "2160-0": { value: "1.1", interp: "N", at: "2026-11-01T08:00:00Z" } } },
        { patientId: "P001", results: { "2160-0": { value: "2.4", interp: "H", at: "2026-11-10T08:00:00Z" } } },
        { patientId: "P002", results: { "2160-0": { value: "9", interp: "HH", at: "2026-11-12T08:00:00Z" } } },
      ],
      "P001",
    );
    expect(notes).toHaveLength(2);
    expect(notes[0].text).toContain("Chronic kidney disease");
    expect(notes[1].text).toContain("Creatinine 2.4");
    expect(notes[1].concern).toBe(true);
    expect(kidneyNotes([], [], "P001")).toEqual([]);
  });
});

describe("controlled drugs", () => {
  const me = { id: "U4", name: "Noura Alzahrani, PharmD" };

  it("needs the witness name and staff number", () => {
    expect(witnessProblems(undefined, me)).toHaveLength(2);
    expect(witnessProblems({ name: "Huda Alotaibi", staffNo: "" }, me)[0]).toContain("staff number");
    expect(witnessProblems({ name: "", staffNo: "U2" }, me)[0]).toContain("name");
    expect(witnessProblems(WITNESS, me)).toEqual([]);
  });

  it("refuses the dispensing pharmacist as the witness, by number or by name", () => {
    expect(witnessProblems({ name: "Someone Else", staffNo: "u4" }, me).join(" ")).toContain("cannot be the pharmacist");
    expect(witnessProblems({ name: "noura  alzahrani", staffNo: "U7" }, me).join(" ")).toContain("cannot be the pharmacist");
  });

  it("has no default for the Raqeeb secure code and needs a reason to go without it", () => {
    expect(secureProblems(false, undefined)).toEqual([]);
    expect(secureProblems(true, undefined)[0]).toContain("Choose how");
    expect(secureProblems(true, { mode: "authenticated", value: "12" })[0]).toContain("secure code");
    expect(secureProblems(true, { mode: "authenticated", value: "482913" })).toEqual([]);
    expect(secureProblems(true, { mode: "override", justification: "" })[0]).toContain("reason");
    expect(secureProblems(true, { mode: "override", justification: "3" })).toEqual([]);
  });

  it("blocks a controlled dispense without a witness or a secure code choice, then lets it through and keeps the witness", () => {
    const { rx, item, req } = sent("DRG033");
    verifyItem(rx.id, item.id);
    const none = dispenseChecked(req());
    expect(none.outcome).toBeNull();
    expect(none.problems.join(" ")).toContain("witness");
    expect(none.problems.join(" ")).toContain("Raqeeb secure code");
    const self = dispenseChecked(req(item.quantity, { witness: { name: "Noura Alzahrani", staffNo: "U4" }, secure: { mode: "authenticated", value: "482913" } }));
    expect(self.problems.join(" ")).toContain("cannot be the pharmacist");
    const noReason = dispenseChecked(req(item.quantity, { witness: WITNESS, secure: { mode: "override", justification: "" } }));
    expect(noReason.problems.join(" ")).toContain("reason");
    const ok = dispenseChecked(req(item.quantity, { witness: WITNESS, secure: { mode: "override", justification: "3" } }));
    expect(ok.outcome?.ok).toBe(true);
    expect(getRx().dispenses[0].witness).toEqual(WITNESS);
  });

  it("needs the witness for discharge (take-home) and inpatient controlled drugs too", () => {
    const d = sent("DRG033", { usage: "discharge" });
    verifyItem(d.rx.id, d.item.id);
    expect(dispenseGate(getRx(), d.req(d.item.quantity, { secure: { mode: "authenticated", value: "482913" } })).join(" ")).toContain("witness");
    expect(dispenseGate(getRx(), d.req(d.item.quantity, { secure: { mode: "authenticated", value: "482913" }, witness: WITNESS }))).toEqual([]);
    resetRx(false);
    const inp = sent("DRG033", { usage: "inpatient" });
    verifyItem(inp.rx.id, inp.item.id);
    expect(dispenseGate(getRx(), inp.req()).join(" ")).toContain("witness");
    expect(dispenseGate(getRx(), inp.req(inp.item.quantity, { witness: WITNESS }))).toEqual([]); // outside Raqeeb: no secure code
  });

  it("does not ask for a witness on an uncontrolled item", () => {
    const { rx, item, req } = sent("DRG002");
    verifyItem(rx.id, item.id);
    expect(dispenseGate(getRx(), req())).toEqual([]);
  });

  it("keeps the witness out of the message to nphies", () => {
    const { rx, item, req } = sent("DRG033");
    verifyItem(rx.id, item.id);
    const secure = { mode: "authenticated" as const, value: "482913" };
    const withW = planDispense(getRx(), req(item.quantity, { witness: WITNESS, secure }));
    const without = planDispense(getRx(), req(item.quantity, { secure }));
    expect(withW?.dispense.witness).toEqual(WITNESS);
    expect(withW?.bundle.entry.length).toBe(without?.bundle.entry.length);
    expect(withW?.bundle.entry.map((e) => e.resource.id)).toEqual(without?.bundle.entry.map((e) => e.resource.id));
    expect(JSON.stringify(withW?.bundle)).not.toContain("Alotaibi");
    expect(withW?.checks.filter((c) => c.level === "error")).toEqual([]);
  });
});

describe("stock and batches", () => {
  const today = new Date("2026-11-14T10:00:00Z");
  const para = DRUG_BY_ID.DRG001;

  it("lists batches earliest expiry first and shows the expiry as a date only", () => {
    const b = batchesFor(para, [], today);
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect([...b].sort((x, y) => x.expiry.localeCompare(y.expiry))).toEqual(b);
    expect(b[0].expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fmtExpiry("2027-01-31")).toBe("31 Jan 2027");
    expect(fmtExpiry("2027-01-31T10:20:00Z")).toBe("31 Jan 2027");
    expect(firstUsableBatch(b)?.lot).toBe(b[0].lot);
  });

  it("takes handed over quantities off the batch and gives them back when cancelled", () => {
    const b0 = batchesFor(para, [], today);
    const line = (status: "completed" | "cancelled") => ({ id: "l", identifier: "D", itemId: "i", drugId: para.id, quantity: 4, type: "FFP" as const, status, lot: b0[1].lot, refillsRemaining: 0, daysSupply: 1, version: 1 });
    const disp = (status: "completed" | "cancelled"): Dispense => ({ id: "d", number: "DSP-1", rxId: "r", visitNumber: "V", patientId: "P", dispenser: "x", handedOverAt: "", lines: [line(status)], verification: { patientScan: true, drugScans: [] } });
    expect(batchesFor(para, [disp("completed")], today)[1].onHand).toBe(b0[1].onHand - 4);
    expect(batchesFor(para, [disp("cancelled")], today)[1].onHand).toBe(b0[1].onHand);
    expect(totalOnHand(batchesFor(para, [disp("completed")], today))).toBe(totalOnHand(b0) - 4);
  });

  it("explains a short batch in words", () => {
    const b = batchesFor(para, [], today);
    const short = b[0]; // the small batch
    expect(short.onHand).toBeLessThan(18);
    const text = stockProblem(para, b, short.lot, 18, 18, today) ?? "";
    expect(text).toContain(`Not enough stock in batch ${short.lot}`);
    expect(text).toContain(`It has ${short.onHand} tablets and you asked for 18 tablets`);
    expect(text).toContain("stay on the worklist");
    expect(text).toContain("choose a batch with more stock");
    expect(stockProblem(para, b, short.lot, short.onHand, 18, today)).toBeNull();
    expect(stockProblem(para, b, undefined, 5, 18, today)).toContain("Choose a batch");
    expect(stockProblem(para, b, "NOPE", 5, 18, today)).toContain("not in stock");
    expect(stockProblem(para, b.map((x) => ({ ...x, onHand: 0 })), short.lot, 5, 18, today)).toContain("out of stock");
    expect(stockProblem(para, [{ ...short, expiry: "2026-01-31" }], short.lot, 1, 18, today)).toContain("expired on 31 Jan 2026");
  });

  it("stops a dispense that asks for more than the batch holds, and a part dispense keeps the item on the worklist", () => {
    const { rx, item, big } = sent("DRG001", { dose: 2, frequencyId: "TID", durationDays: 3 }); // 18 tablets
    verifyItem(rx.id, item.id);
    const small = batchesFor(para, getRx().dispenses)[0];
    const v = { patientScan: true, drugScans: [item.id] };
    const tooMuch = dispenseChecked({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 18, lot: small.lot, expiry: small.expiry }], verification: v });
    expect(tooMuch.outcome).toBeNull();
    expect(tooMuch.problems[0]).toContain("Not enough stock");
    expect(dispenseChecked({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 18 }], verification: v }).problems[0]).toContain("Choose a batch");

    const part = dispenseChecked({ rxId: rx.id, lines: [{ itemId: item.id, quantity: small.onHand, lot: small.lot, expiry: small.expiry }], verification: v });
    expect(part.outcome?.ok).toBe(true);
    expect(getRx().dispenses[0].lines[0]).toMatchObject({ type: "FFP", lot: small.lot, expiry: small.expiry });
    const open = pharmacyItems(getRx(), getRx().prescriptions[0]);
    expect(open).toHaveLength(1); // still on the worklist
    expect(open[0].status).toBe("verified"); // no second check for the rest
    expect(rxBoardStageOf(getRx(), getRx().prescriptions[0])).toBe("partial");
    expect(batchesFor(para, getRx().dispenses).find((b) => b.lot === small.lot)?.onHand).toBe(0);

    const rest = dispenseChecked({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 18 - small.onHand, lot: big.lot, expiry: big.expiry }], verification: v });
    expect(rest.outcome?.ok).toBe(true);
    expect(pharmacyItems(getRx(), getRx().prescriptions[0])).toHaveLength(0);
    expect(rxBoardStageOf(getRx(), getRx().prescriptions[0])).toBe("dispensed");
  });
});

describe("pharmacy board with the To Verify stage", () => {
  it("puts To Verify first and counts the items", () => {
    expect(RX_BOARD_STAGES.map((s) => s.id)).toEqual(["verify", "pending", "partial", "dispensed"]);
    expect(RX_BOARD_STAGES[0].label).toBe("To Verify");
    const a = sent("DRG002");
    const b = sent("DRG033");
    expect(rxStats(getRx(), Date.now())).toMatchObject({ toVerify: 2, withPrescriber: 0, waiting: 2 });
    verifyItem(a.rx.id, a.item.id);
    queryPrescriber(b.rx.id, b.item.id, "Please confirm the dose.");
    expect(rxStats(getRx(), Date.now())).toMatchObject({ toVerify: 0, withPrescriber: 1 });
    expect(rxBoardStageOf(getRx(), getRx().prescriptions[1])).toBe("verify");
  });

  it("opens the check sheet when a card leaves To Verify and never moves a card back into it", () => {
    const { rx } = sent("DRG002");
    expect(rxBoardCanMove(rx, "verify", "pending")).toEqual({ ok: true });
    expect(rxBoardCanMove(rx, "verify", "dispensed")).toEqual({ ok: true });
    expect(rxBoardCanMove(rx, "pending", "verify").ok).toBe(false);
    expect(rxBoardCanMove(rx, "pending", "partial")).toEqual({ ok: true });
    expect(rxBoardCanMove(rx, "partial", "pending").ok).toBe(false);
  });
});
