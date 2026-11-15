import { beforeEach, describe, expect, it } from "vitest";
import { amendLabOrder, buildLabOrderBundle, getOrder, placeLabOrder, resetLab, sendLabOrder, validateLabOrderBundle } from "./lab";
import {
  amendRadOrder, buildRadOrderBundle, getRad, getRadOrder, groupRadOrders, placeRadOrder, placeRadOrderGroup, resetRad, sendRadOrder, validateRadOrderBundle,
} from "./radiology";
import { byType, type Json } from "./fhir/common";
import { personFromDoctor } from "./fhir/people";
import type { LabOrder, RadOrder } from "./fhir/types";
import type { Check, Dx, Encounter, Patient } from "./model";
import { coverageLabel, defaultOrderCoverage, defaultOrderDiagnosis, orderDiagnosis, visitInsured } from "./order-fields";
import { switchUser } from "./session";
import { getState } from "./store";

const baseEnc = () => getState().encounters.find((e) => e.patientId === "P001")!;
const patient = () => getState().patients.find((p) => p.id === "P001")!;
const errors = (c: Check[]) => c.filter((x) => x.level === "error");

const DX: Dx[] = [
  { code: "R50.9", text: "Fever, unspecified", type: "A" },
  { code: "J18.9", text: "Pneumonia, unspecified", type: "W" },
];
const withDx = (dx: Dx[]): Encounter => ({ ...baseEnc(), dx });

const prelimDx = (b: Json) => byType(b, "Observation").find((o) => o.code.coding[0].code === "148006");
const reasonCodes = (b: Json) => byType(b, "ServiceRequest").map((s) => s.reasonCode);

describe("order fields: diagnosis and coverage helpers", () => {
  it("coverage defaults to plan only for an insured visit", () => {
    const p = (extra: Patient["extra"]) => ({ extra });
    expect(defaultOrderCoverage(p({ visitPayType: "Insurance" }))).toBe("plan");
    expect(defaultOrderCoverage(p({ visitPayType: "Cash" }))).toBe("self-pay");
    expect(defaultOrderCoverage(p(undefined))).toBe("self-pay");
    // Pay type not recorded: an active insurance card counts.
    const card = { payer: "Bupa Arabia", policyNo: "1", memberId: "1", className: "A", network: "N1", startDate: "2026-01-01", expiryDate: "2027-01-01", copayPercent: 10, status: "Active" as const };
    expect(visitInsured(p({ insurance: card }))).toBe(true);
    expect(visitInsured(p({ visitPayType: "Cash", insurance: card }))).toBe(false);
    expect(coverageLabel("plan")).toBe("Plan Coverage");
    expect(coverageLabel("self-pay")).toBe("Additional / Self-Pay");
    expect(coverageLabel(undefined)).toBe("Not Recorded");
  });

  it("the picker starts on the working or admitting diagnosis, and is empty when the visit has none", () => {
    expect(defaultOrderDiagnosis(DX)).toEqual({ code: "R50.9", text: "Fever, unspecified" });
    expect(defaultOrderDiagnosis([{ code: "Z00.0", text: "General examination", type: "F" }])).toEqual({ code: "Z00.0", text: "General examination" });
    expect(defaultOrderDiagnosis([])).toBeNull();
  });

  it("the picked diagnosis wins; an order saved without one falls back to the visit's first diagnosis", () => {
    expect(orderDiagnosis({ diagnosis: { code: "J18.9", text: "Pneumonia" } }, { dx: DX })!.code).toBe("J18.9");
    expect(orderDiagnosis({}, { dx: DX })!.code).toBe("R50.9");
    expect(orderDiagnosis({}, { dx: [] })).toBeNull();
  });
});

describe("laboratory order: diagnosis and coverage", () => {
  beforeEach(() => {
    resetLab();
    switchUser("U9");
  });

  it("stores the picked diagnosis and coverage and sends the diagnosis as Preliminary Diagnosis", () => {
    const o = placeLabOrder(baseEnc(), { codes: ["58410-2"], priority: "routine", fasting: null, note: "", diagnosis: { code: "J18.9", text: "Pneumonia, unspecified" }, coverage: "self-pay" })!;
    expect(o.diagnosis).toEqual({ code: "J18.9", text: "Pneumonia, unspecified" });
    expect(o.coverage).toBe("self-pay");
    const b = buildLabOrderBundle({ patient: patient(), enc: withDx(DX), order: o, orderer: personFromDoctor(o.orderedById), version: 1, docStatus: "final" });
    const dx = prelimDx(b)!;
    expect(dx.valueCodeableConcept.coding[0]).toMatchObject({ system: "urn:oid:2.16.840.1.113883.6.135", code: "J18.9" });
    // The ServiceRequest page lists no reasonCode, so none is sent there.
    expect(reasonCodes(b).every((r) => r === undefined)).toBe(true);
    expect(errors(validateLabOrderBundle(b))).toEqual([]);
    const r = sendLabOrder(o.id)!;
    expect(r.response.status).toBe("accepted");
    expect(prelimDx(r.bundle)!.valueCodeableConcept.coding[0].code).toBe("J18.9");
  });

  it("amending can change or clear the diagnosis and change coverage; leaving them out keeps them", () => {
    const o = placeLabOrder(baseEnc(), { codes: ["4548-4"], priority: "routine", fasting: null, note: "", diagnosis: { code: "J18.9", text: "Pneumonia" }, coverage: "plan" })!;
    expect(amendLabOrder(o.id, { codes: ["4548-4"], priority: "urgent", fasting: null, note: "" })).toBe(true);
    expect(getOrder(o.id)!.diagnosis?.code).toBe("J18.9");
    expect(getOrder(o.id)!.coverage).toBe("plan");
    expect(amendLabOrder(o.id, { codes: ["4548-4"], priority: "urgent", fasting: null, note: "", diagnosis: null, coverage: "self-pay" })).toBe(true);
    expect(getOrder(o.id)!.diagnosis).toBeUndefined();
    expect(getOrder(o.id)!.coverage).toBe("self-pay");
  });

  it("an order saved before these fields existed still builds a valid bundle with the visit's first diagnosis", () => {
    const e = withDx(DX);
    const old: LabOrder = {
      id: "LO-900777", visitNumber: e.visitNumber, patientId: e.patientId, codes: ["4548-4"], priority: "routine", fasting: null, note: "",
      orderedAt: new Date().toISOString(), orderedById: e.attending, status: "received", specimens: [], results: {}, orderDirty: false, resultDirty: false, sends: [],
    };
    const restored = JSON.parse(JSON.stringify(old)) as LabOrder; // as read back from localStorage
    expect(restored.diagnosis).toBeUndefined();
    expect(coverageLabel(restored.coverage)).toBe("Not Recorded");
    const b = buildLabOrderBundle({ patient: patient(), enc: e, order: restored, orderer: personFromDoctor(e.attending), version: 1, docStatus: "final" });
    expect(prelimDx(b)!.valueCodeableConcept.coding[0].code).toBe("R50.9");
    expect(errors(validateLabOrderBundle(b))).toEqual([]);
    // No diagnosis on the visit and none on the order: no Preliminary Diagnosis, still valid.
    const none = buildLabOrderBundle({ patient: patient(), enc: withDx([]), order: restored, orderer: personFromDoctor(e.attending), version: 1, docStatus: "final" });
    expect(prelimDx(none)).toBeUndefined();
    expect(errors(validateLabOrderBundle(none))).toEqual([]);
  });
});

describe("radiology order: several exams, diagnosis and coverage", () => {
  beforeEach(() => {
    resetRad();
    switchUser("U9");
  });

  it("one order holds several exams that share the order number, diagnosis, coverage and reason", () => {
    const { groupId, orders } = placeRadOrderGroup(baseEnc(), {
      procCodes: ["XCHES-PA", "UABDO", "XCHES-PA"], priority: "urgent", indication: "Fever", clinicalInfo: "",
      diagnosis: { code: "R50.9", text: "Fever, unspecified" }, coverage: "plan",
    });
    expect(groupId).toMatch(/^RQ-\d+$/);
    expect(orders.map((o) => o.procCode)).toEqual(["XCHES-PA", "UABDO"]); // a repeated tap does not add the exam twice
    expect(new Set(orders.map((o) => o.id)).size).toBe(2); // each exam keeps its own placer number
    for (const o of orders) {
      expect(o.groupId).toBe(groupId);
      expect(o.diagnosis?.code).toBe("R50.9");
      expect(o.coverage).toBe("plan");
      expect(o.status).toBe("received"); // each exam is its own worklist line
    }
    const groups = groupRadOrders(getRad().orders.filter((o) => o.visitNumber === baseEnc().visitNumber));
    const g = groups.find((x) => x.groupId === groupId)!;
    expect(g.orders.map((o) => o.procCode)).toEqual(["XCHES-PA", "UABDO"]);
    // Seeded orders saved without an order number stand alone.
    for (const x of groups.filter((x) => x.groupId !== groupId)) expect(x.orders).toHaveLength(1);
  });

  it("each exam is sent as its own order document, with the picked diagnosis and its own modality and body site", () => {
    const { orders } = placeRadOrderGroup(baseEnc(), {
      procCodes: ["XCHES-PA", "UABDO"], priority: "routine", indication: "Pain", clinicalInfo: "", diagnosis: { code: "J18.9", text: "Pneumonia, unspecified" }, coverage: "self-pay",
    });
    for (const o of orders) {
      const r = sendRadOrder(o.id)!;
      expect(r.response.status).toBe("accepted");
      expect(errors(r.checks)).toEqual([]);
      expect(byType(r.bundle, "ServiceRequest")).toHaveLength(1);
      expect(prelimDx(r.bundle)!.valueCodeableConcept.coding[0]).toMatchObject({ system: "urn:oid:2.16.840.1.113883.6.135", code: "J18.9" });
      expect(reasonCodes(r.bundle)).toEqual([undefined]);
    }
    const [chest, abdo] = orders.map((o) => byType(getRadOrder(o.id)!.sends[0].bundle, "ServiceRequest")[0]);
    expect(chest.orderDetail[0].coding[0].code).toBe("DX");
    expect(abdo.orderDetail[0].coding[0].code).toBe("US");
    expect(chest.bodySite[0].coding[0].code).not.toBe(abdo.bodySite[0].coding[0].code);
  });

  it("amending one exam can change its diagnosis and coverage", () => {
    const o = placeRadOrder(baseEnc(), { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "", diagnosis: { code: "R50.9", text: "Fever" }, coverage: "plan" })!;
    expect(amendRadOrder(o.id, { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })).toBe(true);
    expect(getRadOrder(o.id)!.diagnosis?.code).toBe("R50.9");
    expect(amendRadOrder(o.id, { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "", diagnosis: { code: "J18.9", text: "Pneumonia" }, coverage: "self-pay" })).toBe(true);
    expect(getRadOrder(o.id)!.diagnosis?.code).toBe("J18.9");
    expect(getRadOrder(o.id)!.coverage).toBe("self-pay");
    expect(amendRadOrder(o.id, { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "", diagnosis: null })).toBe(true);
    expect(getRadOrder(o.id)!.diagnosis).toBeUndefined();
  });

  it("an order saved before these fields existed still opens and builds a valid bundle", () => {
    const e = withDx(DX);
    const old: RadOrder = {
      id: "RO-900777", visitNumber: e.visitNumber, patientId: e.patientId, procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "",
      orderedAt: new Date().toISOString(), orderedById: e.attending, status: "received", orderDirty: false, reportDirty: false, sends: [],
    };
    const restored = JSON.parse(JSON.stringify(old)) as RadOrder;
    expect(groupRadOrders([restored])).toEqual([{ groupId: "RO-900777", orders: [restored] }]);
    const b = buildRadOrderBundle({ patient: patient(), enc: e, order: restored, orderer: personFromDoctor(e.attending), version: 1, docStatus: "final" });
    expect(prelimDx(b)!.valueCodeableConcept.coding[0].code).toBe("R50.9");
    expect(errors(validateRadOrderBundle(b, { visitNumber: e.visitNumber, healthId: patient().healthId }))).toEqual([]);
  });
});
