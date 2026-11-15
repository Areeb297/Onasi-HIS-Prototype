import { beforeEach, describe, expect, it } from "vitest";
import {
  addProcedureLine, claimFor, claimStatusOf, confirmSoftStops, estimateDrg, insuredVisits, resetClaims, reviewClaim, reviewModel, saveDx, saveLine,
  sendFromClaim, sendOptions, unconfirmedSoftStops, type ReviewInput,
} from "./claims";
import { resetInvoices } from "./invoice";
import { caseOf, estimateCharge, resetFinancial, runFinancial } from "./nphies-financial";
import { switchUser } from "./session";
import { getState, replaceState, seedState } from "./store";

const CARD = { payer: "Bupa Arabia", policyNo: "POL-48210", memberId: "MEM-7710021", className: "Class A", network: "Gold Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 10, status: "Active" as const };
/** Puts an insurance card on every patient file except P001, as registration does after the coverage check. */
const insureAllBut = (cash: string[]) => {
  const s = getState();
  replaceState({ ...s, patients: s.patients.map((p) => (cash.includes(p.id) ? p : { ...p, extra: { ...p.extra, visitPayType: "Insurance" as const, insurance: CARD } })) });
};

/** A review input with nothing wrong, to change one thing at a time. */
const clean = (): ReviewInput => ({
  dx: [{ code: "J18.9", type: "principal" }, { code: "E11.9", type: "secondary" }],
  chiefComplaint: true,
  vitalsMissing: [],
  vitalsTotal: 8,
  authNeeded: false,
  authStatus: undefined,
  lines: [{ key: "visit", seq: 1, text: "Outpatient Consultation", unitCost: 350, dxSeqs: [1] }],
});
const rules = (r: ReviewInput, use: "claim" | "priorauth" = "claim") => reviewClaim(r, use).map((f) => `${f.rule}:${f.severity}`);

describe("claim review rules", () => {
  it("a clean claim has no findings", () => {
    expect(reviewClaim(clean(), "claim")).toEqual([]);
  });

  it("no principal diagnosis is a Hard Stop", () => {
    const r = clean();
    r.dx = [{ code: "E11.9", type: "secondary" }];
    expect(rules(r)).toEqual(["no-principal-dx:hard"]);
    expect(rules({ ...r, dx: [] })).toEqual(["no-principal-dx:hard"]);
  });

  it("two principal diagnoses is a Hard Stop", () => {
    const r = clean();
    r.dx = [{ code: "J18.9", type: "principal" }, { code: "E11.9", type: "principal" }];
    expect(rules(r)).toEqual(["many-principal-dx:hard"]);
  });

  it("a missing chief complaint is a Hard Stop", () => {
    expect(rules({ ...clean(), chiefComplaint: false })).toEqual(["no-chief-complaint:hard"]);
  });

  it("no vital signs at all is a Hard Stop, some missing is a Soft Stop", () => {
    const all = ["Systolic", "Diastolic", "Pulse", "Respiratory Rate", "Temperature", "Oxygen Saturation", "Weight", "Height"];
    expect(rules({ ...clean(), vitalsMissing: all })).toEqual(["no-vitals:hard"]);
    const some = reviewClaim({ ...clean(), vitalsMissing: ["Weight", "Height"] }, "claim");
    expect(some.map((f) => `${f.rule}:${f.severity}`)).toEqual(["vitals-missing:soft"]);
    expect(some[0].text).toContain("Weight, Height");
  });

  it("a visit needing prior authorization without an approval is a Hard Stop for the claim only", () => {
    const r = { ...clean(), authNeeded: true };
    expect(rules(r)).toEqual(["auth-not-approved:hard"]);
    expect(rules(r, "priorauth")).toEqual([]);
    expect(reviewClaim({ ...r, authStatus: "pended" }, "claim")[0].text).toContain("waiting for the payer");
    expect(reviewClaim({ ...r, authStatus: "denied" }, "claim")[0].text).toContain("denied");
    expect(rules({ ...r, authStatus: "approved" })).toEqual([]);
    expect(rules({ ...clean(), authNeeded: false, authStatus: undefined })).toEqual([]);
  });

  it("a line without a diagnosis link is a Soft Stop, one per line", () => {
    const r = clean();
    r.lines = [...r.lines, { key: "lab:1", seq: 2, text: "Glucose", unitCost: 85, dxSeqs: [] }, { key: "lab:2", seq: 3, text: "HbA1c", unitCost: 85, dxSeqs: [] }];
    const f = reviewClaim(r, "claim");
    expect(f.map((x) => x.id)).toEqual(["line-no-dx:lab:1", "line-no-dx:lab:2"]);
    expect(f.every((x) => x.severity === "soft")).toBe(true);
  });

  it("a zero-cost line is a Warning", () => {
    const r = clean();
    r.lines = [...r.lines, { key: "proc:1", seq: 2, text: "Appendicectomy", unitCost: 0, dxSeqs: [1] }];
    expect(rules(r)).toEqual(["line-zero-cost:warning"]);
  });

  it("orders findings Hard Stop first, then Soft Stop, then Warning", () => {
    const r = { ...clean(), chiefComplaint: false };
    r.lines = [{ key: "a", seq: 1, text: "A", unitCost: 0, dxSeqs: [] }];
    expect(reviewClaim(r, "claim").map((f) => f.severity)).toEqual(["hard", "soft", "warning"]);
  });

  it("a confirmed soft stop stays confirmed, a new one needs confirming", () => {
    const r = clean();
    r.lines = [{ key: "a", seq: 1, text: "A", unitCost: 10, dxSeqs: [] }];
    const f = reviewClaim(r, "claim");
    const ack = { at: "", by: "", reason: "Checked", ids: f.map((x) => x.id) };
    expect(unconfirmedSoftStops(f, ack)).toEqual([]);
    const f2 = reviewClaim({ ...r, lines: [...r.lines, { key: "b", seq: 2, text: "B", unitCost: 10, dxSeqs: [] }] }, "claim");
    expect(unconfirmedSoftStops(f2, ack).map((x) => x.id)).toEqual(["line-no-dx:b"]);
  });
});

describe("AR-DRG estimate", () => {
  it("groups from the principal diagnosis and splits on secondary diagnoses", () => {
    expect(estimateDrg([{ code: "J18.9", type: "principal" }], "2026-11-01", "2026-11-04")).toMatchObject({ code: "E62B", losDays: 3 });
    expect(estimateDrg([{ code: "E11.9", type: "principal" }, { code: "I10", type: "secondary" }, { code: "N18.3", type: "secondary" }], "2026-11-01", "2026-11-01")).toMatchObject({ code: "K60A", losDays: 1 });
    expect(estimateDrg([{ code: "E11.9", type: "secondary" }], "2026-11-01", "2026-11-02").code).toBe("960Z");
    expect(estimateDrg([{ code: "Z99.9", type: "principal" }], "2026-11-01", "2026-11-02").code).toBe("");
  });
});

describe("claim from the visit", () => {
  beforeEach(() => {
    switchUser("U9");
    replaceState(seedState());
    insureAllBut(["P001"]);
    resetFinancial();
    resetInvoices();
    resetClaims();
  });

  it("lists insured visits only", () => {
    const vs = insuredVisits();
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) expect(v.patient.extra?.visitPayType).not.toBe("Cash");
    expect(vs.some((v) => v.patient.id === "P001")).toBe(false);
  });

  it("service lines add up to the invoice and the NPHIES Financial charge", () => {
    for (const { enc } of insuredVisits()) {
      const m = claimFor(enc.visitNumber)!;
      const lineSum = Math.round(m.lines.reduce((n, l) => n + l.gross, 0) * 100) / 100;
      expect(lineSum).toBe(m.totals.gross);
      expect(m.net).toBe(estimateCharge(enc).total);
      expect(m.lines.every((l) => l.quantity === 1 && l.unitCost > 0)).toBe(true);
    }
  });

  it("uses the visit diagnoses, care team and chart vital signs", () => {
    const { enc } = insuredVisits().find((v) => v.enc.dx.length > 0)!;
    const m = claimFor(enc.visitNumber)!;
    expect(m.dx.length).toBe(enc.dx.length);
    expect(m.careTeam[0]).toMatchObject({ doctorId: enc.attending, role: "primary", seq: 1 });
    expect(m.chart.some((l) => l.key === "complaint")).toBe(true);
    expect(m.lines.find((l) => l.kind === "visit")?.careSeqs).toEqual([1]);
  });

  it("a procedure line from the chart has no cost and is warned about", () => {
    const { enc } = insuredVisits()[0];
    expect(addProcedureLine(enc.visitNumber, { code: "30571-00", text: "Appendicectomy", at: "2026-11-10T09:00" }).ok).toBe(true);
    const m = claimFor(enc.visitNumber)!;
    const proc = m.lines.find((l) => l.kind === "proc")!;
    expect(proc).toMatchObject({ system: "ACHI", code: "30571-00", unitCost: 0 });
    expect(reviewModel(m, "claim").some((f) => f.id === `line-zero-cost:${proc.key}`)).toBe(true);
    // Amounts stay those of the invoice.
    expect(m.net).toBe(estimateCharge(enc).total);
  });

  it("a hard stop blocks sending and nothing reaches NPHIES Financial", () => {
    const { enc } = insuredVisits()[0];
    const v = enc.visitNumber;
    runFinancial(v, "eligibility");
    // Remove the principal diagnosis on the claim.
    for (const d of claimFor(v)!.dx) saveDx(v, d.code, { type: "secondary" });
    const before = caseOf(v).messages.length;
    const r = sendFromClaim(v, "priorauth");
    expect(r.ok).toBe(false);
    expect(caseOf(v).messages.length).toBe(before);
  });

  it("sends through NPHIES Financial once the review is clear and soft stops are confirmed", () => {
    // Give an outpatient visit everything the review needs.
    const s = getState();
    const target = insuredVisits().find((x) => x.enc.cls === "O")!.enc;
    replaceState({
      ...s,
      encounters: s.encounters.map((e) => (e.visitNumber === target.visitNumber
        ? { ...e, dx: [{ code: "J06.9", text: "Acute upper respiratory infection", type: "W" as const, kind: "P" as const }], complaints: [{ code: "49727002", text: "Cough" }], reason: "Cough" }
        : e)),
    });
    const v = target.visitNumber;
    expect(sendOptions(getState().encounters.find((e) => e.visitNumber === v)!).claim.enabled).toBe(false); // eligibility first
    runFinancial(v, "eligibility");
    const m = claimFor(v)!;
    for (const l of m.lines) saveLine(v, l.key, { dxCodes: ["J06.9"] });
    if (m.authNeeded) {
      const pa = sendFromClaim(v, "priorauth");
      if (!pa.ok && pa.needsConfirm) {
        confirmSoftStops(v, unconfirmedSoftStops(reviewModel(claimFor(v)!, "priorauth"), undefined).map((f) => f.id), "Vitals taken on paper");
        expect(sendFromClaim(v, "priorauth").ok).toBe(true);
      }
      if (caseOf(v).authorization?.status === "pended") runFinancial(v, "poll-auth");
    }
    let r = sendFromClaim(v, "claim");
    if (!r.ok && r.needsConfirm) {
      const soft = unconfirmedSoftStops(reviewModel(claimFor(v)!, "claim"), claimFor(v)!.draft?.ack);
      expect(soft.every((f) => f.severity === "soft")).toBe(true);
      expect(confirmSoftStops(v, [...(claimFor(v)!.draft?.ack?.ids ?? []), ...soft.map((f) => f.id)], "Vitals taken on paper").ok).toBe(true);
      r = sendFromClaim(v, "claim");
    }
    expect(r.ok).toBe(true);
    const c = caseOf(v);
    expect(c.claim).toBeDefined();
    expect(c.messages.some((x) => x.kind === "claim-request")).toBe(true);
    expect(claimStatusOf(c).label).not.toBe("Not Started");
    // The claim sent the invoice net, the same figure the invoice holds.
    const after = claimFor(v)!;
    expect(after.draft?.sends?.at(-1)?.amount).toBe(estimateCharge(after.enc).total);
    expect(after.net).toBe(after.totals.taxable);
  });

  it("a user without the billing permission cannot change the claim", () => {
    const { enc } = insuredVisits()[0];
    switchUser("U2");
    const r = saveDx(enc.visitNumber, "X", { type: "secondary" });
    expect(r.ok).toBe(false);
  });
});
