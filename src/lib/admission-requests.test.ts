import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { AdmissionRequestForm } from "@/components/admission/AdmissionRequestForm";
import { ApproveDialog } from "@/components/admission/ApproveDialog";
import { DecisionDialog } from "@/components/admission/DecisionDialog";
import { AdmissionRequestsPage } from "@/pages/AdmissionRequestsPage";
import {
  approvalDefaults, approvalProblems, approveRequest, cancelRequest, createRequest, getAdmissionRequests, rejectRequest, resetAdmissionRequests,
  type AdmissionRequest, type ApprovalInput, type RequestInput,
} from "./admission-requests";
import { bedInfo } from "./beds";
import { switchUser } from "./session";
import { getState, nowLocal, resetAll } from "./store";

const req = (pid: string): AdmissionRequest => getAdmissionRequests().requests.find((r) => r.patientId === pid && r.status === "pending")!;
const approval = (r: AdmissionRequest, patch: Partial<ApprovalInput>): ApprovalInput => ({ ...approvalDefaults(r), admitAt: nowLocal(), ...patch });
const lastEvent = () => getState().log[getState().log.length - 1];
const input = (patientId: string): RequestInput => ({
  patientId, admittingDoctor: "D1001", approvingDoctor: "D1003", admitAt: nowLocal(), department: "MED", subDepartment: "General Medicine",
  admissionType: "14", condition: "Stable", activityLevel: "Bed Rest", expectedStayDays: "3", specialty: "Internal Medicine",
  dx: { code: "N39.0", text: "Urinary tract infection, site not specified" }, reason: "Fever and flank pain, needs intravenous antibiotics.",
});

beforeEach(() => {
  resetAll();
  resetAdmissionRequests();
  switchUser("U1");
});

describe("sample requests", () => {
  it("seeds three pending requests for patients who are not admitted", () => {
    const rs = getAdmissionRequests().requests;
    expect(rs).toHaveLength(3);
    expect(rs.every((r) => r.status === "pending")).toBe(true);
    const admitted = getState().encounters.filter((e) => e.status === "active" && e.cls === "I").map((e) => e.patientId);
    expect(rs.some((r) => admitted.includes(r.patientId))).toBe(false);
  });
});

describe("raising a request", () => {
  it("saves it as pending and refuses a second one for the same patient", () => {
    const first = createRequest(input("P010"));
    expect(first.ok && first.value.status).toBe("pending");
    const again = createRequest(input("P010"));
    expect(again.ok).toBe(false);
    expect(!again.ok && again.errors[0]).toMatch(/already has a pending admission request/);
  });

  it("refuses a patient who is already admitted", () => {
    const res = createRequest(input("P001"));
    expect(!res.ok && res.errors[0]).toMatch(/already admitted/);
  });

  it("refuses a patient with a seeded pending request", () => {
    expect(createRequest(input("P012")).ok).toBe(false);
  });

  it("needs chart write access", () => {
    switchUser("U3");
    const res = createRequest(input("P010"));
    expect(!res.ok && res.errors[0]).toMatch(/cannot raise/);
  });

  it("lists what is missing", () => {
    const res = createRequest({ ...input("P010"), approvingDoctor: "", reason: "", expectedStayDays: "0" });
    expect(!res.ok && res.errors).toEqual(expect.arrayContaining([
      "Choose the approving doctor.", "Expected stay is a whole number of days, 1 to 365.", "Write the reason for admission (at least 5 characters).",
    ]));
  });
});

describe("approval", () => {
  beforeEach(() => switchUser("U14")); // Insurance Approvals Officer

  it("holds an insured elective admission until the payer authorizes it; emergency and pre-admit go ahead (CHI)", () => {
    switchUser("U1");
    const made = createRequest(input("P004")); // Layla Alanazi, insured, open outpatient visit
    switchUser("U14");
    if (!made.ok) throw new Error(made.errors.join(" "));
    const r = made.value;
    const auth = /has not approved this elective admission/;
    expect(approvalProblems(r, approval(r, { admissionType: "14", bedId: "302-A" })).some((e) => auth.test(e))).toBe(true);
    expect(approvalProblems(r, approval(r, { admissionType: "15", bedId: "302-A" })).some((e) => auth.test(e))).toBe(false);
    expect(approvalProblems(r, approval(r, { admissionType: "14", preAdmit: true, bedId: "", admitAt: nowLocal(24 * 60) })).some((e) => auth.test(e))).toBe(false);
  });

  it("admits with a bed when there is no open visit (A01)", () => {
    const r = req("P009");
    const visits = getState().encounters.length;
    const res = approveRequest(r.id, approval(r, { bedId: "302-A" }));
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(lastEvent().eventId).toBe("A01");
    expect(getState().encounters).toHaveLength(visits + 1);
    const enc = getState().encounters.find((e) => e.visitNumber === res.value.approval!.visitNumber)!;
    expect(enc).toMatchObject({ patientId: "P009", cls: "I", status: "active", bedId: "302-A", admissionMethod: "14" });
    expect(enc.dx.map((d) => d.code)).toContain("E11.9");
    expect(bedInfo(getState(), "302-A")!.state).toBe("occupied");
    expect(res.value.status).toBe("approved");
    expect(res.value.approval).toMatchObject({ eventId: "A01", controlId: lastEvent().controlId });
  });

  it("changes the open emergency visit to inpatient (A06)", () => {
    const r = req("P012");
    expect(r.fromVisit).toBeTruthy();
    const visits = getState().encounters.length;
    const res = approveRequest(r.id, approval(r, { bedId: "401-A" }));
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(lastEvent()).toMatchObject({ eventId: "A06", visitNumber: r.fromVisit });
    expect(getState().encounters).toHaveLength(visits);
    const enc = getState().encounters.find((e) => e.visitNumber === r.fromVisit)!;
    expect(enc).toMatchObject({ cls: "I", status: "active", bedId: "401-A", service: "SUR", admissionMethod: "02" });
    expect(enc.dx.map((d) => d.code)).toContain("K35.80");
    expect(bedInfo(getState(), "401-A")!.state).toBe("occupied");
  });

  it("changes the open clinic visit to inpatient (A06)", () => {
    const r = req("P007");
    const res = approveRequest(r.id, approval(r, { bedId: "302-B" }));
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(lastEvent()).toMatchObject({ eventId: "A06", visitNumber: r.fromVisit });
    expect(bedInfo(getState(), "302-B")!.state).toBe("occupied");
  });

  it("pre-admits and holds the bed (A05)", () => {
    const r = req("P007");
    const res = approveRequest(r.id, approval(r, { preAdmit: true, bedId: "402-A", admitAt: nowLocal(24 * 60) }));
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(lastEvent().eventId).toBe("A05");
    const pre = getState().encounters.find((e) => e.visitNumber === res.value.approval!.visitNumber)!;
    expect(pre).toMatchObject({ patientId: "P007", status: "preadmit", reservedBedId: "402-A" });
    const info = bedInfo(getState(), "402-A")!;
    expect(info.state).toBe("reserved");
    expect(info.enc?.visitNumber).toBe(pre.visitNumber);
    expect(res.value.status).toBe("preadmitted");
  });

  it("pre-admits without a bed", () => {
    const r = req("P009");
    const res = approveRequest(r.id, approval(r, { preAdmit: true, bedId: "", admitAt: nowLocal(24 * 60) }));
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(lastEvent().eventId).toBe("A05");
    expect(getState().encounters.find((e) => e.visitNumber === res.value.approval!.visitNumber)!.reservedBedId).toBeUndefined();
  });

  it("refuses a bed that is not free with the app's message, and sends nothing", () => {
    const r = req("P009");
    const log = getState().log.length;
    const taken = approveRequest(r.id, approval(r, { bedId: "301-A" }));
    expect(!taken.ok && taken.errors).toContain("That bed is taken.");
    const out = approveRequest(r.id, approval(r, { bedId: "ICU2-B" }));
    expect(!out.ok && out.errors.join(" ")).toMatch(/out of service/);
    const held = approveRequest(r.id, approval(r, { preAdmit: true, bedId: "402-B", admitAt: nowLocal(60) }));
    expect(!held.ok && held.errors).toContain("That bed is reserved for a planned admission.");
    expect(getState().log).toHaveLength(log);
    expect(req("P009").status).toBe("pending");
  });

  it("needs a bed unless Pre-Admit is ticked, and a date that is not in the future", () => {
    const r = req("P009");
    const noBed = approveRequest(r.id, approval(r, { bedId: "" }));
    expect(!noBed.ok && noBed.errors[0]).toMatch(/Pick a free bed/);
    const later = approveRequest(r.id, approval(r, { bedId: "302-A", admitAt: nowLocal(120) }));
    expect(!later.ok && later.errors[0]).toMatch(/in the future/);
  });

  it("needs the approvals permission", () => {
    switchUser("U4");
    const r = req("P009");
    const res = approveRequest(r.id, approval(r, { bedId: "302-A" }));
    expect(!res.ok && res.errors[0]).toMatch(/cannot approve/);
  });

  it("cannot approve a request twice", () => {
    const r = req("P009");
    expect(approveRequest(r.id, approval(r, { bedId: "302-A" })).ok).toBe(true);
    const again = approveRequest(r.id, approval(r, { bedId: "302-B" }));
    expect(!again.ok && again.errors[0]).toMatch(/Only a pending request/);
  });
});

describe("reject and cancel", () => {
  beforeEach(() => switchUser("U14"));

  it("reject needs a reason and leaves no visit and no message", () => {
    const r = req("P009");
    const visits = getState().encounters.length;
    const log = getState().log.length;
    expect(rejectRequest(r.id, "").ok).toBe(false);
    const res = rejectRequest(r.id, "Can be treated as an outpatient");
    expect(res.ok && res.value).toMatchObject({ status: "rejected", decisionReason: "Can be treated as an outpatient", decidedBy: "Hessa Aldossary" });
    expect(getState().encounters).toHaveLength(visits);
    expect(getState().log).toHaveLength(log);
    expect(approveRequest(r.id, approval(r, { bedId: "302-A" })).ok).toBe(false);
  });

  it("cancel needs a reason, leaves the source visit as it was, and lets a new request be raised", () => {
    const r = req("P012");
    const before = getState().encounters.find((e) => e.visitNumber === r.fromVisit)!;
    const log = getState().log.length;
    expect(cancelRequest(r.id, " ").ok).toBe(false);
    const res = cancelRequest(r.id, "Patient refused admission");
    expect(res.ok && res.value.status).toBe("cancelled");
    expect(getState().encounters.find((e) => e.visitNumber === r.fromVisit)).toEqual(before);
    expect(getState().log).toHaveLength(log);
    switchUser("U1");
    expect(createRequest({ ...input("P012"), fromVisit: r.fromVisit }).ok).toBe(true);
  });

  it("needs the approvals permission", () => {
    switchUser("U4");
    expect(cancelRequest(req("P009").id, "Duplicate request").ok).toBe(false);
  });
});

describe("screens", () => {
  it("render without errors", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.window ??= { location: { hash: "#/admission-requests" }, addEventListener() {}, removeEventListener() {} };
    const h = React.createElement;
    const r = req("P012");
    const page = renderToString(h(AdmissionRequestsPage));
    expect(page).toContain("Admission Requests");
    expect(page).toContain("AR-1001");
    expect(renderToString(h(AdmissionRequestForm, { onClose() {}, patientId: "P008" }))).toContain("Admission Diagnosis (ICD-10-AM)");
    const approve = renderToString(h(ApproveDialog, { request: r, onClose() {} }));
    expect(approve).toContain("Approve And Admit");
    expect(approve).toContain("Attendant Name");
    expect(renderToString(h(DecisionDialog, { request: r, kind: "reject", onClose() {} }))).toContain("Reject Request");
  });
});
