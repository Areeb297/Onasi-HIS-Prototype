import { beforeEach, describe, expect, it } from "vitest";
import { consultationShare, patientShareDue } from "./copay";
import { caseOf, requestOrderAuthorization, resetFinancial, serviceBlocked, serviceNeedsApproval, CLASS_FEE } from "./nphies-financial";
import { markPerformed, placeRadOrder, radApproval, resetRad } from "./radiology";
import { switchUser } from "./session";
import { getState, resetAll } from "./store";

const visitOf = (pid: string, cls?: string) =>
  getState().encounters.find((e) => e.patientId === pid && e.status === "active" && (!cls || e.cls === cls))!;
const patient = (pid: string) => getState().patients.find((p) => p.id === pid)!;
const MRI = { kind: "imaging" as const, modality: "MR", label: "MRI Brain" };
const XRAY = { kind: "imaging" as const, modality: "DX", label: "Chest X-Ray" };

beforeEach(() => {
  resetAll();
  resetFinancial();
  resetRad();
  switchUser("U1");
});

describe("prior authorization at the order (CHI)", () => {
  it("knows which services need the payer's approval", () => {
    expect(serviceNeedsApproval(MRI)).toBe(true);
    expect(serviceNeedsApproval({ kind: "imaging", modality: "CT", label: "CT Head" })).toBe(true);
    expect(serviceNeedsApproval(XRAY)).toBe(false);
    expect(serviceNeedsApproval({ kind: "admission" })).toBe(true);
    expect(serviceNeedsApproval({ kind: "surgery", label: "Appendectomy" })).toBe(true);
    expect(serviceNeedsApproval({ kind: "service", label: "Costly drug", price: 5000 })).toBe(true);
    expect(serviceNeedsApproval({ kind: "service", label: "CBC", price: 85 })).toBe(false);
  });

  it("holds an insured outpatient's MRI as Awaiting Approval, and never a cash patient's or an X-ray", () => {
    const insured = visitOf("P004"); // Layla Alanazi, MedGulf, outpatient
    const gate = serviceBlocked({ visitNumber: insured.visitNumber, service: MRI });
    expect(gate).toMatchObject({ blocked: true, label: "Awaiting Approval" });
    expect(serviceBlocked({ visitNumber: insured.visitNumber, service: XRAY }).blocked).toBe(false);
    const cash = visitOf("P007"); // Turki Almalki, cash
    expect(serviceBlocked({ visitNumber: cash.visitNumber, service: MRI }).blocked).toBe(false);
  });

  it("lets an emergency visit go ahead, with approval due within 24 hours", () => {
    const er = getState().encounters.find((e) => e.cls === "E" && e.status === "active" && patient(e.patientId).extra?.insurance)!;
    const gate = serviceBlocked({ visitNumber: er.visitNumber, service: MRI });
    expect(gate.blocked).toBe(false);
    expect(gate.label).toBe("Approval Due In 24 Hours");
  });

  it("queues one request for the approvals officer per service, and none for a cash patient", () => {
    const v = visitOf("P004").visitNumber;
    const req = requestOrderAuthorization(v, MRI);
    expect(req).toMatchObject({ service: "MRI Brain", by: "Dr. Khalid Alharbi" });
    expect(requestOrderAuthorization(v, MRI)).toBeNull();
    expect(caseOf(v).authRequests).toHaveLength(1);
    expect(requestOrderAuthorization(v, XRAY)).toBeNull();
    expect(requestOrderAuthorization(visitOf("P007").visitNumber, MRI)).toBeNull();
  });
});

describe("the gate on the radiology exam", () => {
  it("queues the request at the order and holds a CT until the payer approves; an X-ray goes ahead", () => {
    const enc = visitOf("P004");
    const ct = placeRadOrder(enc, { procCode: "CSKUH", priority: "routine", indication: "Headache", clinicalInfo: "" })!;
    const xr = placeRadOrder(enc, { procCode: "XCHES-PA", priority: "routine", indication: "Cough", clinicalInfo: "" })!;
    expect(caseOf(enc.visitNumber).authRequests?.map((r) => r.service)).toEqual(["CT Head"]);
    expect(radApproval(ct)).toMatchObject({ blocked: true, label: "Awaiting Approval" });
    switchUser("U16"); // radiology technologist, rad.perform
    expect(markPerformed(ct.id)).toBe(false);
    expect(markPerformed(xr.id)).toBe(true);
  });

  it("does not hold a self-pay exam", () => {
    const enc = visitOf("P004");
    const ct = placeRadOrder(enc, { procCode: "CSKUH", priority: "routine", indication: "Headache", clinicalInfo: "", coverage: "self-pay" })!;
    expect(radApproval(ct).blocked).toBe(false);
  });
});

describe("co-payment before the doctor (practice)", () => {
  it("is the whole consultation fee for cash and the co-payment for an insured patient", () => {
    expect(consultationShare(patient("P007"))).toBe(CLASS_FEE.O);
    const insured = consultationShare(patient("P004"));
    expect(insured).toBeGreaterThan(0);
    expect(insured).toBeLessThan(CLASS_FEE.O);
  });

  it("shows the share as due until the cashier takes it", () => {
    const e = visitOf("P007");
    expect(patientShareDue(e, patient("P007"))).toMatchObject({ paid: false });
  });
});
