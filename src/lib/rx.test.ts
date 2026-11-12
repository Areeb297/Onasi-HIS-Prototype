import { beforeEach, describe, expect, it } from "vitest";
import { DRUGS, DRUG_BY_ID, searchDrugs } from "./rx-catalogue";
import { calcQuantity, classifyDispense, fillState, GROUPS, recomputeStatus, refillsRemainingAfter, STEPS, stepStatus, validateDispenseQty } from "./rx-logic";
import { checkSafety, type SafetyInput } from "./rx-safety";
import { addDraftItem, getRx, quantityFor, removeDraftItem, resetRx, setHeight, updateItem, type NewItem } from "./rx";
import { changeDispenseLine, planPrescription, sendDispense, sendPrescription } from "./rx-send";
import type { DispenseLine, RxItem } from "./rx-types";
import { getState, updateEncounter } from "./store";

const line = (itemId: string, qty: number, over: Partial<DispenseLine> = {}): DispenseLine => ({
  id: `l-${Math.random()}`,
  identifier: "D-1",
  itemId,
  drugId: "DRG001",
  quantity: qty,
  type: "FF",
  status: "completed",
  refillsRemaining: 0,
  daysSupply: 1,
  version: 1,
  ...over,
});
const mkItem = (over: Partial<RxItem> = {}): RxItem => ({
  id: "x",
  identifier: "RXI-1",
  drugId: "DRG001",
  dose: 1,
  frequencyId: "BID",
  asNeeded: false,
  durationDays: 5,
  quantity: 10,
  quantityManual: false,
  route: "PO",
  patientInstruction: "",
  fulfillmentNote: "",
  refills: 0,
  reason: { code: "J18.9", text: "x" },
  status: "active",
  version: 1,
  ...over,
});

describe("catalogue", () => {
  it("has about 30 drugs with demo codes and all four classes", () => {
    expect(DRUGS.length).toBeGreaterThanOrEqual(30);
    expect(DRUGS.every((d) => d.code.startsWith("DEMO-"))).toBe(true);
    expect(DRUGS.every((d) => d.formCode === "6401" || d.formCode.startsWith("DEMO-"))).toBe(true);
    expect(new Set(DRUGS.map((d) => d.controlClass))).toEqual(new Set(["U", "N", "C", "R"]));
    expect(searchDrugs("tramad")[0].generic).toBe("Tramadol");
  });
});

describe("quantity", () => {
  it("multiplies dose by times per day by days", () => {
    expect(calcQuantity(2, "TID", 3, "tablet")).toBe(18);
    expect(calcQuantity(1, "BID", 7, "tablet")).toBe(14);
    expect(calcQuantity(1, "WEEKLY", 14, "patch")).toBe(2);
    expect(calcQuantity(0.2, "QHS", 30, "mL")).toBe(6);
    expect(calcQuantity(0, "BID", 5, "tablet")).toBe(0);
  });
});

describe("fills: FF, FFP, FFC", () => {
  const item = mkItem();
  it("a full dispense is FF", () => {
    const st = fillState(item, []);
    expect(classifyDispense(st, 10)).toBe("FF");
    expect(st.remaining).toBe(10);
  });
  it("a partial dispense is FFP and then FFC completes it", () => {
    const first = classifyDispense(fillState(item, []), 4);
    expect(first).toBe("FFP");
    const after = fillState(item, [line("x", 4)]);
    expect(after.remaining).toBe(6);
    expect(classifyDispense(after, 3)).toBe("FFP");
    expect(classifyDispense(after, 6)).toBe("FFC");
    expect(fillState(item, [line("x", 4), line("x", 6)]).done).toBe(true);
  });
  it("blocks more than the remaining quantity", () => {
    const st = fillState(item, [line("x", 8)]);
    expect(validateDispenseQty(st, 3)).toContain("Only 2");
    expect(validateDispenseQty(st, 2)).toBeNull();
    expect(validateDispenseQty(st, 0)).not.toBeNull();
  });
  it("a cancelled line gives its quantity back", () => {
    const st = fillState(item, [line("x", 10, { status: "cancelled" })]);
    expect(st.remaining).toBe(10);
    expect(st.done).toBe(false);
  });
  it("moves between active and completed", () => {
    expect(recomputeStatus(item, [line("x", 10)])).toBe("completed");
    expect(recomputeStatus({ ...item, status: "completed" }, [])).toBe("active");
    expect(recomputeStatus({ ...item, status: "stopped" }, [line("x", 10)])).toBe("stopped");
  });
  it("uses refill types and counts refills remaining", () => {
    const r = mkItem({ refills: 2 });
    const done1 = [line("x", 10)];
    const st = fillState(r, done1);
    expect(st.completedFills).toBe(1);
    expect(classifyDispense(st, 10)).toBe("RF");
    expect(classifyDispense(st, 4)).toBe("RFP");
    expect(refillsRemainingAfter(r, fillState(r, []))).toBe(2);
    expect(refillsRemainingAfter(r, st)).toBe(1);
    expect(classifyDispense(fillState(r, [...done1, line("x", 5)]), 5)).toBe("RFC");
  });
});

describe("safety checks", () => {
  const base = (drugId: string, over: Partial<SafetyInput> = {}): SafetyInput => {
    const drug = DRUG_BY_ID[drugId];
    return {
      drug,
      dose: drug.defaultDose,
      frequencyId: drug.defaultFrequency,
      durationDays: drug.defaultDays,
      route: drug.defaultRoute,
      refills: 0,
      usage: "outpatient",
      allergies: [],
      others: [],
      heightCm: 170,
      weightKg: 70,
      ...over,
    };
  };
  const levels = (f: ReturnType<typeof checkSafety>) => f.map((x) => `${x.kind}:${x.level}`);

  it("is quiet for a normal prescription", () => {
    expect(checkSafety(base("DRG001"))).toEqual([]);
  });
  it("blocks a direct drug allergy and warns about cross-reactivity", () => {
    const allergies = [{ text: "Penicillin", severity: "SV" as const, reaction: "Rash" }];
    expect(levels(checkSafety(base("DRG004", { allergies })))).toContain("allergy:block");
    expect(levels(checkSafety(base("DRG008", { allergies })))).toContain("cross-allergy:warn");
    expect(checkSafety(base("DRG001", { allergies }))).toEqual([]);
  });
  it("does not match the latex allergy to a drug", () => {
    expect(checkSafety(base("DRG001", { allergies: [{ text: "Latex", severity: "MO", reaction: "Hives" }] }))).toEqual([]);
  });
  it("finds duplicate therapy by drug and by class", () => {
    expect(levels(checkSafety(base("DRG002", { others: [{ drug: DRUG_BY_ID.DRG002, where: "RX-1" }] })))).toContain("duplicate:warn");
    const sameClass = checkSafety(base("DRG002", { others: [{ drug: DRUG_BY_ID.DRG003, where: "RX-1" }] }));
    expect(sameClass[0].text).toContain("Same class");
  });
  it("warns when the daily dose is above the usual maximum", () => {
    expect(levels(checkSafety(base("DRG001", { dose: 3, frequencyId: "QID" })))).toContain("dose:warn");
    expect(levels(checkSafety(base("DRG001", { dose: 0 })))).toContain("dose:error");
  });
  it("rejects an impossible route and warns about an unusual one", () => {
    expect(levels(checkSafety(base("DRG001", { route: "IV" })))).toContain("route:error");
    expect(levels(checkSafety(base("DRG001", { route: "TOP" })))).toContain("route:warn");
  });
  it("asks for missing height and weight", () => {
    const f = checkSafety(base("DRG001", { heightCm: undefined, weightKg: undefined }));
    expect(f[0].kind).toBe("measure");
    expect(f[0].text).toContain("height and weight");
  });
  it("applies controlled drug rules", () => {
    const f = checkSafety(base("DRG033", { refills: 1, durationDays: 45 }));
    expect(levels(f)).toEqual(expect.arrayContaining(["controlled:error", "controlled:warn", "controlled:info"]));
    expect(checkSafety(base("DRG033", { usage: "inpatient" })).find((x) => x.id === "ctrl-scope")?.text).toContain("outside the Raqeeb scope");
  });
  it("flags opioid with benzodiazepine", () => {
    expect(levels(checkSafety(base("DRG033", { others: [{ drug: DRUG_BY_ID.DRG034, where: "RX-2" }] })))).toContain("interaction:warn");
  });
});

describe("prescription store and send", () => {
  const enc = () => getState().encounters.find((e) => e.patientId === "P001") as NonNullable<ReturnType<typeof getState>["encounters"][number]>;
  const newItem = (drugId: string, over: Partial<NewItem> = {}): NewItem => {
    const d = DRUG_BY_ID[drugId];
    return {
      drugId,
      dose: d.defaultDose,
      frequencyId: d.defaultFrequency,
      asNeeded: false,
      durationDays: d.defaultDays,
      route: d.defaultRoute,
      patientInstruction: "",
      fulfillmentNote: "",
      refills: 0,
      reason: { code: "J18.9", text: "Pneumonia, unspecified organism" },
      usage: "outpatient",
      ...over,
    };
  };

  beforeEach(() => {
    resetRx(false);
    updateEncounter(enc().visitNumber, (e) => {
      e.vitals = { ...(e.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), weight: "84" };
    }, { touch: false });
  });

  it("carries the visit number and keeps controlled items on their own prescription", () => {
    const e = enc();
    const a = addDraftItem(e, newItem("DRG001"));
    const b = addDraftItem(e, newItem("DRG002"));
    const c = addDraftItem(e, newItem("DRG033"));
    expect(a.rx.id).toBe(b.rx.id);
    expect(c.rx.id).not.toBe(a.rx.id);
    expect(c.rx.controlled).toBe(true);
    expect(getRx().prescriptions.every((p) => p.visitNumber === e.visitNumber)).toBe(true);
    expect(getRx().prescriptions.find((p) => p.id === a.rx.id)?.items).toHaveLength(2);
  });

  it("calculates quantity and keeps a manual quantity", () => {
    const e = enc();
    const { rx, item } = addDraftItem(e, newItem("DRG001", { dose: 2, frequencyId: "TID", durationDays: 3 }));
    expect(item.quantity).toBe(18);
    updateItem(rx.id, item.id, { durationDays: 5 });
    expect(getRx().prescriptions[0].items[0].quantity).toBe(30);
    updateItem(rx.id, item.id, { quantity: 25 });
    updateItem(rx.id, item.id, { durationDays: 7 });
    expect(getRx().prescriptions[0].items[0].quantity).toBe(25);
    expect(quantityFor(DRUG_BY_ID.DRG001, 1, "OD", 4)).toBe(4);
  });

  it("removes a draft item and the empty prescription", () => {
    const { rx, item } = addDraftItem(enc(), newItem("DRG001"));
    removeDraftItem(rx.id, item.id);
    expect(getRx().prescriptions).toHaveLength(0);
  });

  it("rejects a prescription without height, then accepts it (7.1 create, hold, cancel)", () => {
    const e = enc();
    const { rx } = addDraftItem(e, newItem("DRG001"));
    const failed = sendPrescription(rx.id, "create");
    expect(failed?.ok).toBe(false);
    expect(failed?.record.http).toBe(400);
    expect(getRx().prescriptions[0].sentAt).toBeUndefined();
    expect(stepStatus(getRx().sends, "7.1.create")).toBe("failed");

    setHeight(e.visitNumber, e.patientId, 178);
    const ok = sendPrescription(rx.id, "create");
    expect(ok?.ok).toBe(true);
    // nphies returns a reference id for every medication type. It replaces the local group id.
    expect(ok?.refId).toMatch(/^NRX\d{8}$/);
    expect(getRx().prescriptions[0].groupId).toBe(ok?.refId);
    expect(getRx().prescriptions[0].nationalRef).toBe(ok?.refId);
    expect(getRx().prescriptions[0].raqeebRef).toBeUndefined();
    expect(getRx().prescriptions[0].sentAt).toBeDefined();
    expect(stepStatus(getRx().sends, "7.1.create")).toBe("done");

    const itemId = getRx().prescriptions[0].items[0].id;
    expect(sendPrescription(rx.id, "hold", { itemId, status: "on-hold" })?.ok).toBe(true);
    expect(getRx().prescriptions[0].items[0].status).toBe("on-hold");
    expect(sendPrescription(rx.id, "resume", { itemId, status: "active" })?.ok).toBe(true);
    expect(sendPrescription(rx.id, "cancel", { itemId, status: "cancelled" })?.ok).toBe(true);
    expect(getRx().prescriptions[0].items[0].status).toBe("cancelled");
    expect(stepStatus(getRx().sends, "7.1.hold")).toBe("done");
    expect(stepStatus(getRx().sends, "7.1.cancel")).toBe("done");
  });

  it("gives a Raqeeb reference id to a controlled prescription and uses it afterwards (7.2)", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx } = addDraftItem(e, newItem("DRG033"));
    const sent = sendPrescription(rx.id, "create");
    expect(sent?.ok).toBe(true);
    const ref = sent?.refId as string;
    expect(ref).toMatch(/^RQB\d{8}$/);
    const saved = getRx().prescriptions[0];
    expect(saved.raqeebRef).toBe(ref);
    expect(saved.groupId).toBe(ref);
    expect(stepStatus(getRx().sends, "7.2.create")).toBe("done");

    updateItem(rx.id, saved.items[0].id, { durationDays: 3 });
    expect(getRx().prescriptions[0].dirty).toBe(true);
    expect(getRx().prescriptions[0].items[0].version).toBe(2);
    const upd = sendPrescription(rx.id, "update");
    expect(upd?.ok).toBe(true);
    expect(upd?.refId).toBe(ref);
    expect(stepStatus(getRx().sends, "7.2.update")).toBe("done");
    expect(sendPrescription(rx.id, "cancel", { itemId: saved.items[0].id, status: "cancelled" })?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.2.cancel-active")).toBe("done");
  });

  it("gives an inpatient controlled item a reference id, but not a Raqeeb one", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx } = addDraftItem(e, newItem("DRG033", { usage: "inpatient" }));
    const sent = sendPrescription(rx.id, "create");
    expect(sent?.ok).toBe(true);
    expect(sent?.refId).toMatch(/^NRX/);
    expect(getRx().prescriptions[0].raqeebRef).toBeUndefined();
  });

  it("previews a stable bundle for the Developer View", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx } = addDraftItem(e, newItem("DRG001"));
    const p1 = planPrescription(getRx(), getRx().prescriptions[0]);
    const p2 = planPrescription(getRx(), getRx().prescriptions[0]);
    expect(p1?.bundle.entry[0].resource.id).toBe(p2?.bundle.entry[0].resource.id);
    expect(p1?.checks.some((c) => c.level === "error")).toBe(false);
    expect(rx.visitNumber).toBe(e.visitNumber);
  });

  it("dispenses FF, FFP and FFC and finishes the item (7.3)", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const full = addDraftItem(e, newItem("DRG001", { dose: 1, frequencyId: "BID", durationDays: 5 }));
    sendPrescription(full.rx.id, "create");
    const scans = { patientScan: true, drugScans: [full.item.id] };

    const none = sendDispense({ rxId: full.rx.id, lines: [{ itemId: full.item.id, quantity: 4 }], verification: { patientScan: false, drugScans: [] } });
    expect(none.problems[0]).toContain("wristband");

    const p1 = sendDispense({ rxId: full.rx.id, lines: [{ itemId: full.item.id, quantity: 4 }], verification: scans });
    expect(p1.outcome?.ok).toBe(true);
    expect(getRx().dispenses[0].lines[0].type).toBe("FFP");
    expect(stepStatus(getRx().sends, "7.3.ffp")).toBe("done");

    const tooMany = sendDispense({ rxId: full.rx.id, lines: [{ itemId: full.item.id, quantity: 7 }], verification: scans });
    expect(tooMany.problems[0]).toContain("Only 6");

    const p2 = sendDispense({ rxId: full.rx.id, lines: [{ itemId: full.item.id, quantity: 6 }], verification: scans });
    expect(p2.outcome?.ok).toBe(true);
    expect(getRx().dispenses[1].lines[0].type).toBe("FFC");
    expect(stepStatus(getRx().sends, "7.3.ffc")).toBe("done");
    expect(getRx().prescriptions[0].items[0].status).toBe("completed");

    const second = addDraftItem(e, newItem("DRG002", { dose: 1, frequencyId: "BID", durationDays: 5 }));
    sendPrescription(second.rx.id, "create");
    const ff = sendDispense({ rxId: second.rx.id, lines: [{ itemId: second.item.id, quantity: 10 }], verification: { patientScan: true, drugScans: [second.item.id] } });
    expect(ff.outcome?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.3.ff")).toBe("done");
  });

  it("dispenses several items in one bundle (7.5)", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const a = addDraftItem(e, newItem("DRG001"));
    const b = addDraftItem(e, newItem("DRG002"));
    sendPrescription(a.rx.id, "create");
    const r = sendDispense({
      rxId: a.rx.id,
      lines: [{ itemId: a.item.id, quantity: a.item.quantity }, { itemId: b.item.id, quantity: b.item.quantity }],
      verification: { patientScan: true, drugScans: [a.item.id, b.item.id] },
    });
    expect(r.outcome?.ok).toBe(true);
    expect(getRx().dispenses[0].lines).toHaveLength(2);
    expect(stepStatus(getRx().sends, "7.5.multi")).toBe("done");
  });

  it("cancels and updates a controlled dispense (7.4)", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx, item } = addDraftItem(e, newItem("DRG033", { dose: 1, frequencyId: "BID", durationDays: 5 }));
    sendPrescription(rx.id, "create");
    const v = { patientScan: true, drugScans: [item.id] };
    const part = sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 4 }], secure: { mode: "authenticated", value: "482913" }, verification: v });
    expect(part.outcome?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.4.ffp")).toBe("done");
    const rest = sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 6 }], secure: { mode: "authenticated", value: "482913" }, verification: v });
    expect(rest.outcome?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.4.ffc")).toBe("done");
    expect(getRx().prescriptions[0].items[0].status).toBe("completed");

    const d = getRx().dispenses[1];
    const upd = changeDispenseLine(d.id, d.lines[0].id, "update", { quantity: 5, lot: "LOT-77" });
    expect(upd.outcome?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.4.update")).toBe("done");
    expect(getRx().prescriptions[0].items[0].status).toBe("active");

    const can = changeDispenseLine(d.id, d.lines[0].id, "cancel");
    expect(can.outcome?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.4.cancel")).toBe("done");
    expect(getRx().dispenses[1].lines[0].status).toBe("cancelled");
  });

  it("stops an item after a partial dispense (7.1.8)", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx, item } = addDraftItem(e, newItem("DRG001"));
    sendPrescription(rx.id, "create");
    sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 4 }], verification: { patientScan: true, drugScans: [item.id] } });
    expect(sendPrescription(rx.id, "stop", { itemId: item.id, status: "stopped" })?.ok).toBe(true);
    expect(getRx().prescriptions[0].items[0].status).toBe("stopped");
    expect(stepStatus(getRx().sends, "7.1.stop")).toBe("done");
    const again = sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 6 }], verification: { patientScan: true, drugScans: [item.id] } });
    expect(again.problems[0]).toContain("stopped");
  });

  it("cancels a completed controlled item (7.2.5 to 7.2.6) and stops a controlled one (7.2.7)", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const a = addDraftItem(e, newItem("DRG033"));
    sendPrescription(a.rx.id, "create");
    const secure = { mode: "authenticated" as const, value: "123456" };
    sendDispense({ rxId: a.rx.id, lines: [{ itemId: a.item.id, quantity: a.item.quantity }], secure, verification: { patientScan: true, drugScans: [a.item.id] } });
    expect(getRx().prescriptions[0].items[0].status).toBe("completed");
    expect(sendPrescription(a.rx.id, "cancel", { itemId: a.item.id, status: "cancelled" })?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.2.cancel-completed")).toBe("done");

    const b = addDraftItem(e, newItem("DRG034"));
    sendPrescription(b.rx.id, "create");
    sendDispense({ rxId: b.rx.id, lines: [{ itemId: b.item.id, quantity: 2 }], secure, verification: { patientScan: true, drugScans: [b.item.id] } });
    expect(sendPrescription(b.rx.id, "stop", { itemId: b.item.id, status: "stopped" })?.ok).toBe(true);
    expect(stepStatus(getRx().sends, "7.2.stop")).toBe("done");
  });

  it("rejects cancel after a dispense on an uncontrolled item", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx, item } = addDraftItem(e, newItem("DRG001"));
    sendPrescription(rx.id, "create");
    sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: 4 }], verification: { patientScan: true, drugScans: [item.id] } });
    const r = sendPrescription(rx.id, "cancel", { itemId: item.id, status: "cancelled" });
    expect(r?.ok).toBe(false);
    expect(getRx().prescriptions[0].items[0].status).toBe("active");
  });

  it("seed prescriptions can be dispensed", () => {
    resetRx(true);
    const seeded = getRx().prescriptions;
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    const ctrl = seeded.find((p) => p.controlled);
    expect(ctrl?.raqeebRef).toMatch(/^RQB/);
    const rx = seeded.find((p) => !p.controlled) as (typeof seeded)[number];
    const item = rx.items[0];
    const r = sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: item.quantity }], verification: { patientScan: true, drugScans: [item.id] } });
    expect(r.outcome?.ok).toBe(true);
  });

  it("cancels an uncontrolled dispense by sending a new version, without a conformance step", () => {
    const e = enc();
    setHeight(e.visitNumber, e.patientId, 178);
    const { rx, item } = addDraftItem(e, newItem("DRG001"));
    sendPrescription(rx.id, "create");
    sendDispense({ rxId: rx.id, lines: [{ itemId: item.id, quantity: item.quantity }], verification: { patientScan: true, drugScans: [item.id] } });
    const d = getRx().dispenses[0];
    const res = changeDispenseLine(d.id, d.lines[0].id, "cancel");
    expect(res.outcome?.ok).toBe(true);
    expect(res.outcome?.record.steps).toEqual([]);
    expect(getRx().dispenses[0].lines[0].status).toBe("cancelled");
    expect(getRx().prescriptions[0].items[0].status).toBe("active");
  });
});

describe("conformance checklist", () => {
  it("covers steps 7.1 to 7.5", () => {
    expect(GROUPS.map((g) => g.id)).toEqual(["7.1", "7.2", "7.3", "7.4", "7.5"]);
    expect(STEPS.every((s) => GROUPS.some((g) => g.id === s.group))).toBe(true);
    expect(stepStatus([], "7.1.create")).toBe("not-started");
  });
});
