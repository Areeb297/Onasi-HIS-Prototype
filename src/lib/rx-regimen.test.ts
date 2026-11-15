import { beforeEach, describe, expect, it } from "vitest";
import { buildDosage, dosageNarrative, type Json } from "./fhir/medication";
import { validatePrescriptionBundle } from "./fhir/medication-validate";
import { DRUG_BY_ID, searchDrugs } from "./rx-catalogue";
import {
  daysBetween, endDateFor, fromDays, isPatientOwn, itemDates, regimenDailyAmount, regimenDays, regimenOf, regimenProblems, regimenQuantity, stepDates,
  stepsOf, toDays,
} from "./rx-logic";
import { checkSafety, type SafetyInput } from "./rx-safety";
import { addDraftItem, getRx, openItems, resetRx, setHeight, updateItem, type NewItem } from "./rx";
import { planDispense, planPrescription, sendPrescription } from "./rx-send";
import { dispenseGate, orderLine, pharmacyItems, verifyItem } from "./rx-verify";
import type { DoseStep, Prescription, RxItem } from "./rx-types";
import { getState, updateEncounter } from "./store";

const PARA = DRUG_BY_ID.DRG001;

/** An item saved before regimens, units, start dates, coverage and the patient's own medicine existed. */
const oldItem = (): RxItem => ({
  id: "old-1",
  identifier: "RXI-100001",
  drugId: "DRG001",
  dose: 2,
  frequencyId: "TID",
  asNeeded: false,
  durationDays: 3,
  quantity: 18,
  quantityManual: false,
  route: "PO",
  patientInstruction: "",
  fulfillmentNote: "",
  refills: 0,
  reason: { code: "R50.9", text: "Fever, unspecified" },
  status: "active",
  version: 1,
});

const SPLIT: DoseStep[] = [
  { dose: 2, frequencyId: "OD", days: 5, time: "MORN" },
  { dose: 1, frequencyId: "OD", days: 5, time: "NIGHT" },
];
const TAPER: DoseStep[] = [
  { dose: 2, frequencyId: "TID", days: 3 },
  { dose: 1, frequencyId: "TID", days: 3 },
  { dose: 1, frequencyId: "BID", days: 2 },
];

describe("start date, end date and duration unit", () => {
  it("counts the start day as day one", () => {
    expect(endDateFor("2026-11-01", 5)).toBe("2026-11-05");
    expect(endDateFor("2026-11-28", 7)).toBe("2026-12-04");
    expect(endDateFor("2026-11-01", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-11-01", "2026-11-05")).toBe(5);
    expect(daysBetween("2026-11-28", "2026-12-04")).toBe(7);
    expect(daysBetween("2026-11-05", "2026-11-01")).toBe(0);
  });
  it("turns weeks and months into days and back", () => {
    expect(toDays(2, "wk")).toBe(14);
    expect(toDays(1, "mo")).toBe(30);
    expect(toDays(5)).toBe(5);
    expect(fromDays(14, "wk")).toEqual({ value: 2, unit: "wk" });
    expect(fromDays(10, "wk")).toEqual({ value: 10, unit: "d" });
    expect(fromDays(60, "mo")).toEqual({ value: 2, unit: "mo" });
  });
  it("an end date typed in keeps start, end and duration in step", () => {
    const n = daysBetween("2026-11-01", "2026-11-14");
    expect(fromDays(n, "wk")).toEqual({ value: 2, unit: "wk" });
    expect(endDateFor("2026-11-01", toDays(2, "wk"))).toBe("2026-11-14");
  });
});

describe("split and taper regimens", () => {
  it("split rows run together, taper phases add up", () => {
    expect(regimenDays("split", SPLIT)).toBe(5);
    expect(regimenDays("taper", TAPER)).toBe(8);
    expect(stepDates("split", SPLIT, "2026-11-01")).toEqual([
      { start: "2026-11-01", end: "2026-11-05" },
      { start: "2026-11-01", end: "2026-11-05" },
    ]);
    expect(stepDates("taper", TAPER, "2026-11-01")).toEqual([
      { start: "2026-11-01", end: "2026-11-03" },
      { start: "2026-11-04", end: "2026-11-06" },
      { start: "2026-11-07", end: "2026-11-08" },
    ]);
  });
  it("adds the quantity of every row", () => {
    expect(regimenQuantity("split", SPLIT, "tablet")).toBe(15);
    expect(regimenQuantity("taper", TAPER, "tablet")).toBe(18 + 9 + 4);
  });
  it("checks the daily dose of the whole split and of the highest taper phase", () => {
    expect(regimenDailyAmount(PARA, "split", SPLIT)).toBe(1500);
    expect(regimenDailyAmount(PARA, "taper", TAPER)).toBe(3000);
  });
  it("needs two or more valid rows", () => {
    expect(regimenProblems("taper", [TAPER[0]])).toContain("A taper regimen needs two or more rows.");
    expect(regimenProblems("split", [SPLIT[0], { ...SPLIT[1], time: "MORN" }]).join(" ")).toContain("same time of day");
    expect(regimenProblems("split", SPLIT)).toEqual([]);
    expect(regimenProblems("normal", [])).toEqual([]);
  });

  it("split dosing becomes one structured dosage per time of day, all on sequence 1", () => {
    const item: RxItem = { ...oldItem(), regimen: "split", schedule: SPLIT, dose: 2, frequencyId: "OD", durationDays: 5, startDate: "2026-11-01" };
    const d = buildDosage(PARA, item, false) as Json[];
    expect(d).toHaveLength(3);
    expect((d[0].timing as Json).repeat).toEqual({ boundsDuration: { value: 5, unit: "day(s)", code: "d" } });
    expect(String(d[0].text)).toContain("Split dosing: 2 tablets once daily in the morning for 5 days; and 1 tablet once daily at night for 5 days");
    expect(d.slice(1).map((x) => x.sequence)).toEqual([1, 1]);
    expect(d.slice(1).map((x) => ((x.timing as Json).repeat as Json).when)).toEqual([["MORN"], ["NIGHT"]]);
    expect(d.slice(1).map((x) => (x.doseAndRate as Json[])[0].doseQuantity)).toEqual([{ value: 2, unit: "tablet" }, { value: 1, unit: "tablet" }]);
  });

  it("tapered dosing becomes one structured dosage per phase, numbered and dated", () => {
    const item: RxItem = { ...oldItem(), regimen: "taper", schedule: TAPER, durationDays: 8, startDate: "2026-11-01" };
    const d = buildDosage(PARA, item, false) as Json[];
    expect(d).toHaveLength(4);
    expect(d.slice(1).map((x) => x.sequence)).toEqual([1, 2, 3]);
    expect(d.slice(1).map((x) => ((x.timing as Json).repeat as Json).boundsPeriod)).toEqual([
      { start: "2026-11-01", end: "2026-11-03" },
      { start: "2026-11-04", end: "2026-11-06" },
      { start: "2026-11-07", end: "2026-11-08" },
    ]);
    expect(dosageNarrative(PARA, item)).toContain("Taper: 2 tablets 3 times daily for 3 days; then 1 tablet 3 times daily for 3 days; then 1 tablet twice daily for 2 days");
    expect(orderLine(PARA, item).frequency).toContain("then");
  });

  it("stops a split or taper for a Raqeeb item and lets an uncontrolled one through", () => {
    const base = (drugId: string, over: Partial<SafetyInput> = {}): SafetyInput => ({
      drug: DRUG_BY_ID[drugId], dose: 1, frequencyId: "OD", durationDays: 6, route: DRUG_BY_ID[drugId].defaultRoute, refills: 0, usage: "outpatient",
      allergies: [], others: [], heightCm: 170, weightKg: 70, ...over,
    });
    const steps: DoseStep[] = [{ dose: 1, frequencyId: "OD", days: 3 }, { dose: 1, frequencyId: "OD", days: 3 }];
    expect(checkSafety(base("DRG033", { regimen: "taper", schedule: steps })).some((f) => f.id === "ctrl-regimen" && f.level === "error")).toBe(true);
    expect(checkSafety(base("DRG033", { regimen: "taper", schedule: steps, usage: "inpatient" })).some((f) => f.id === "ctrl-regimen")).toBe(false);
    expect(checkSafety(base("DRG001", { regimen: "taper", schedule: steps })).filter((f) => f.level === "error")).toEqual([]);
  });
});

describe("prescribing with the new fields", () => {
  const enc = () => getState().encounters.find((e) => e.patientId === "P001") as NonNullable<ReturnType<typeof getState>["encounters"][number]>;
  const newItem = (over: Partial<NewItem> = {}): NewItem => ({
    drugId: "DRG001", dose: 2, frequencyId: "TID", asNeeded: false, durationDays: 3, route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0,
    reason: { code: "J18.9", text: "Pneumonia, unspecified organism" }, usage: "outpatient", ...over,
  });

  beforeEach(() => {
    resetRx(false);
    const e = enc();
    updateEncounter(e.visitNumber, (x) => {
      x.vitals = { ...(x.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" }), weight: "84" };
    }, { touch: false });
    setHeight(e.visitNumber, e.patientId, 176);
  });

  it("stores a taper item with its rows, quantity and dates, and the message passes the checks", () => {
    const { rx, item } = addDraftItem(enc(), newItem({ regimen: "taper", schedule: TAPER, startDate: "2026-11-01", coverage: "Cash" }));
    expect(item.durationDays).toBe(8);
    expect(item.dose).toBe(2);
    expect(item.quantity).toBe(31);
    expect(item.coverage).toBe("Cash");
    expect(itemDates(item, rx.authoredAt)).toEqual({ start: "2026-11-01", end: "2026-11-08" });
    const plan = planPrescription(getRx(), getRx().prescriptions[0]);
    const errors = plan?.checks.filter((c) => c.level === "error") ?? [];
    expect(errors).toEqual([]);
    expect(plan?.checks.some((c) => c.text.includes("taper phases are numbered"))).toBe(true);
    expect(sendPrescription(rx.id, "create")?.ok).toBe(true);
  });

  it("the bundle check catches taper phases that do not add up", () => {
    addDraftItem(enc(), newItem({ regimen: "taper", schedule: TAPER, startDate: "2026-11-01" }));
    const plan = planPrescription(getRx(), getRx().prescriptions[0]);
    const mr = plan!.bundle.entry.map((e) => e.resource).find((r) => r.resourceType === "MedicationRequest") as Json;
    const dosage = mr.dosageInstruction as Json[];
    ((dosage[3].timing as Json).repeat as Json).boundsPeriod = { start: "2026-11-07", end: "2026-11-20" };
    expect(validatePrescriptionBundle(plan!.bundle).some((c) => c.level === "error" && c.text.includes("taper phase"))).toBe(true);
  });

  it("going back to normal drops the rows and recalculates", () => {
    const { rx, item } = addDraftItem(enc(), newItem({ regimen: "split", schedule: SPLIT }));
    expect(item.quantity).toBe(15);
    updateItem(rx.id, item.id, { regimen: "normal", schedule: undefined, dose: 1, frequencyId: "BID", durationDays: 14, durationUnit: "wk" });
    const after = getRx().prescriptions[0].items[0];
    expect(regimenOf(after)).toBe("normal");
    expect(after.schedule).toBeUndefined();
    expect(after.quantity).toBe(28);
    expect(after.durationUnit).toBe("wk");
  });

  it("keeps the patient's own medicine on its own prescription that is never sent or dispensed", () => {
    const e = enc();
    const a = addDraftItem(e, newItem());
    const own = addDraftItem(e, newItem({ drugId: "DRG002", patientProvided: true, refills: 3 }));
    expect(own.rx.id).not.toBe(a.rx.id);
    expect(own.item.refills).toBe(0);
    const rx = getRx().prescriptions.find((p) => p.id === own.rx.id) as Prescription;
    expect(isPatientOwn(rx)).toBe(true);
    expect(isPatientOwn(getRx().prescriptions.find((p) => p.id === a.rx.id) as Prescription)).toBe(false);

    // Not sent to nphies.
    expect(sendPrescription(rx.id, "create")).toBeNull();
    expect(getRx().prescriptions.find((p) => p.id === rx.id)?.sentAt).toBeUndefined();
    expect(planPrescription(getRx(), rx)?.checks[0].text).toContain("not sent to nphies");

    // Even if it were marked sent, the pharmacy would not see it, check it or dispense it.
    const forced: Prescription = { ...rx, sentAt: new Date().toISOString() };
    expect(openItems(getRx(), forced)).toEqual([]);
    expect(pharmacyItems(getRx(), forced)).toEqual([]);
    const gate = dispenseGate({ ...getRx(), prescriptions: [forced] }, { rxId: rx.id, lines: [{ itemId: own.item.id, quantity: 1 }], verification: { patientScan: true, drugScans: [own.item.id] } });
    expect(gate.join(" ")).toContain("provided by the patient");
    const plan = planDispense({ ...getRx(), prescriptions: [forced] }, { rxId: rx.id, lines: [{ itemId: own.item.id, quantity: 1 }], verification: { patientScan: true, drugScans: [own.item.id] } });
    expect(plan?.problems.join(" ")).toContain("provided by the patient");
    expect(verifyItem(rx.id, own.item.id).ok).toBe(false);
  });

  it("does not ask for height and weight for the patient's own medicine", () => {
    const f = checkSafety({ drug: PARA, dose: 1, frequencyId: "OD", durationDays: 3, route: "PO", refills: 0, usage: "outpatient", allergies: [], others: [], patientProvided: true });
    expect(f.find((x) => x.id === "measure")).toBeUndefined();
  });
});

describe("older saved records still read", () => {
  it("an item without the new fields is a normal regimen in days that starts on the day it was written", () => {
    const item = oldItem();
    expect(regimenOf(item)).toBe("normal");
    expect(stepsOf(item)).toEqual([{ dose: 2, frequencyId: "TID", days: 3 }]);
    expect(itemDates(item, "2026-10-10T08:30:00.000Z")).toEqual({ start: "2026-10-10", end: "2026-10-12" });
    expect(isPatientOwn({ items: [item] })).toBe(false);
    expect(dosageNarrative(PARA, item)).toBe("2 tablets, 3 times daily, by oral route, for 3 days");
    const d = buildDosage(PARA, item, false) as Json[];
    expect(d).toHaveLength(2);
    expect(d[1].sequence).toBeUndefined();
    expect(orderLine(PARA, item).duration).toBe("3 days");
  });
  it("a split marked without rows reads as normal", () => {
    expect(regimenOf({ regimen: "split", schedule: [] })).toBe("normal");
  });
});

describe("drug search by generic or brand name", () => {
  it("looks only at the chosen name", () => {
    expect(searchDrugs("paracetamol", 5, "generic")[0].generic).toBe("Paracetamol");
    expect(searchDrugs("paracetamol", 5, "brand")).toEqual([]);
    expect(searchDrugs(PARA.brand.slice(0, 5), 5, "brand")[0].id).toBe(PARA.id);
    expect(searchDrugs(PARA.brand, 5, "generic").some((d) => d.id === PARA.id)).toBe(false);
  });
});
