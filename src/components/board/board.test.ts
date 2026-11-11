import { describe, expect, it } from "vitest";
import { leafTests, testByCode } from "@/lib/lab";
import type { LabOrder, RadOrder } from "@/lib/fhir/types";
import type { Prescription, RxItem, RxState, Dispense, DispenseLine } from "@/lib/rx-types";
import { cellKey, dropStates, groupByCell, stagesAfter } from "./board-logic";
import { WARN_AT, clockState, elapsedMin, fmtDuration } from "./clock";
import {
  LAB_LANES, LAB_STAGES, LAB_TARGET_MIN, TUBES, labCanMove, labClock, labLaneOf, labStageOf, labStats, resultProgress, tubeKindOf, tubesForOrder,
} from "./lab-board";
import { RAD_LANES, RAD_STAGES, radCanMove, radClock, radLaneOf, radStageOf, radStats, reportStarted } from "./rad-board";
import { RX_LANES, RX_STAGES, itemFills, rxCanMove, rxClock, rxLaneOf, rxStageOf, rxStats } from "./rx-board";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/* ---------- fixtures ---------- */

const lab = (over: Partial<LabOrder> = {}): LabOrder => ({
  id: "LO-1", visitNumber: "V1", patientId: "P001", codes: ["58410-2"], priority: "routine", fasting: null, note: "", orderedAt: ago(30), orderedById: "D1",
  status: "received", specimens: [], results: {}, orderDirty: false, resultDirty: false, sends: [], ...over,
});

function withAllResults(o: LabOrder): LabOrder {
  const results: LabOrder["results"] = {};
  for (const t of leafTests(o)) results[t.code] = { code: t.code, value: "1", interp: "N", status: "final", at: ago(5) };
  return { ...o, results };
}

const rad = (over: Partial<RadOrder> = {}): RadOrder => ({
  id: "RO-1", visitNumber: "V1", patientId: "P001", procCode: "XCHES-PA", priority: "routine", indication: "", clinicalInfo: "", orderedAt: ago(30), orderedById: "D1",
  status: "received", orderDirty: false, reportDirty: false, sends: [], ...over,
});
const report = (over: Partial<NonNullable<RadOrder["report"]>> = {}) => ({
  technique: "", comparison: "", findings: "", impression: "", addendum: "", critical: false, communicated: "", reportedAt: "", reportedById: "", ...over,
});
const study = { studyUid: "1.2", accession: "ACC1", performedStart: ago(40), performedEnd: ago(25), performedBy: "Tech", images: true, series: 1, instances: 2 };

const item = (over: Partial<RxItem> = {}): RxItem => ({
  id: "i1", identifier: "RXI-1", drugId: "DRG001", dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 5, quantity: 10, quantityManual: false, route: "PO",
  patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "R50.9", text: "Fever" }, status: "active", version: 1, ...over,
});
const rx = (over: Partial<Prescription> = {}): Prescription => ({
  id: "rx1", number: "RX-1", visitNumber: "V1", patientId: "P001", prescriberId: "D1", authoredAt: ago(50), usage: "outpatient", groupId: "G1", controlled: false,
  items: [item()], sentAt: ago(40), dirty: false, ...over,
});
const line = (qty: number, over: Partial<DispenseLine> = {}): DispenseLine => ({
  id: "l1", identifier: "D-1", itemId: "i1", drugId: "DRG001", quantity: qty, type: "FFP", status: "completed", refillsRemaining: 0, daysSupply: 1, version: 1, ...over,
});
const disp = (lines: DispenseLine[], over: Partial<Dispense> = {}): Dispense => ({
  id: "d1", number: "DSP-1", rxId: "rx1", visitNumber: "V1", patientId: "P001", dispenser: "Pharm", handedOverAt: ago(10), lines, verification: { patientScan: true, drugScans: [] }, ...over,
} as Dispense);
const rxState = (prescriptions: Prescription[], dispenses: Dispense[] = []): RxState => ({ prescriptions, dispenses, sends: [], heights: {}, counters: { rx: 0, item: 0, disp: 0, ref: 0 } });

/* ---------- clocks ---------- */

describe("clock thresholds", () => {
  it("is green below 75 percent, amber from 75 percent, red from the target", () => {
    expect(WARN_AT).toBe(0.75);
    expect(clockState(0, 20)).toBe("ok");
    expect(clockState(14.9, 20)).toBe("ok");
    expect(clockState(15, 20)).toBe("warn");
    expect(clockState(19.9, 20)).toBe("warn");
    expect(clockState(20, 20)).toBe("late");
    expect(clockState(300, 20)).toBe("late");
  });
  it("never goes red without a target", () => {
    expect(clockState(500, 0)).toBe("ok");
  });
  it("measures minutes from an ISO time and prints them short", () => {
    const now = Date.now();
    expect(Math.round(elapsedMin(new Date(now - 12 * 60_000).toISOString(), now))).toBe(12);
    expect(elapsedMin(new Date(now + 60_000).toISOString(), now)).toBe(0);
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(80)).toBe("1h 20m");
    expect(fmtDuration(120)).toBe("2h");
    expect(fmtDuration(60 * 51)).toBe("2d 3h");
  });
});

/* ---------- tubes ---------- */

describe("tube colours", () => {
  const kind = (code: string) => tubeKindOf(testByCode(code)!);
  it("maps the common tests to the standard cap colours", () => {
    expect(kind("718-7")).toBe("edta"); // hemoglobin
    expect(kind("4548-4")).toBe("edta"); // HbA1c
    expect(kind("2160-0")).toBe("serum-gold"); // creatinine
    expect(kind("10839-9")).toBe("heparin"); // troponin
    expect(kind("6301-6")).toBe("citrate"); // INR
    expect(kind("5811-5")).toBe("urine");
    expect(kind("630-4")).toBe("urine"); // urine culture
    expect(kind("600-7")).toBe("culture"); // blood culture
  });
  it("uses the neutral cap when the combination is unknown", () => {
    expect(kind("94500-6")).toBe("neutral");
    expect(tubeKindOf({ code: "x", specimen: "BLD", dept: "SR", kind: "string" })).toBe("neutral");
  });
  it("gives every kind a cap colour and a label", () => {
    for (const t of Object.values(TUBES)) {
      expect(t.cap).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.label.length).toBeGreaterThan(3);
    }
  });
  it("lists one tube per cap colour for an order", () => {
    expect(tubesForOrder({ codes: ["58410-2"] })).toEqual(["edta"]);
    expect(tubesForOrder({ codes: ["58410-2", "24323-8", "24357-6", "630-4"] })).toEqual(["edta", "serum-gold", "urine"]);
  });
  it("puts glucose alone in a grey fluoride tube but not when it shares a serum tube", () => {
    expect(tubesForOrder({ codes: ["2345-7"] })).toEqual(["fluoride"]);
    expect(tubesForOrder({ codes: ["2345-7", "2160-0"] })).toEqual(["serum-gold"]);
    expect(tubesForOrder({ codes: ["24323-8"] })).toEqual(["serum-gold"]);
  });
});

/* ---------- lab stages, lanes and rules ---------- */

describe("lab board", () => {
  it("has five stages and three lanes", () => {
    expect(LAB_STAGES.map((s) => s.id)).toEqual(["ordered", "collected", "in-progress", "entered", "published"]);
    expect(LAB_LANES.map((l) => l.id)).toEqual(["stat", "urgent", "routine"]);
  });
  it("puts ASAP in the urgent lane", () => {
    expect(labLaneOf({ priority: "stat" })).toBe("stat");
    expect(labLaneOf({ priority: "asap" })).toBe("urgent");
    expect(labLaneOf({ priority: "urgent" })).toBe("urgent");
    expect(labLaneOf({ priority: "routine" })).toBe("routine");
  });
  it("derives the stage from the real status", () => {
    expect(labStageOf(lab({ status: "received" }))).toBe("ordered");
    expect(labStageOf(lab({ status: "collected" }))).toBe("collected");
    expect(labStageOf(lab({ status: "in-progress" }))).toBe("in-progress");
    expect(labStageOf(withAllResults(lab({ status: "in-progress" })))).toBe("entered");
    expect(labStageOf(lab({ status: "resulted" }))).toBe("published");
    expect(labStageOf(lab({ status: "amended" }))).toBe("published");
    expect(labStageOf(lab({ status: "cancelled" }))).toBeNull();
  });
  it("counts typed results", () => {
    const o = lab({ status: "in-progress", codes: ["58410-2"] });
    expect(resultProgress(o)).toEqual({ done: 0, total: 6 });
    expect(resultProgress(withAllResults(o))).toEqual({ done: 6, total: 6 });
  });
  it("allows one step forward", () => {
    expect(labCanMove(lab(), "ordered", "collected")).toEqual({ ok: true });
    expect(labCanMove(lab({ status: "collected" }), "collected", "in-progress")).toEqual({ ok: true });
    expect(labCanMove(lab({ status: "in-progress" }), "in-progress", "entered")).toEqual({ ok: true });
    expect(labCanMove(withAllResults(lab({ status: "in-progress" })), "entered", "published")).toEqual({ ok: true });
  });
  it("refuses to skip a step and says what to do first", () => {
    const skip = labCanMove(lab({ status: "in-progress" }), "in-progress", "published");
    expect(skip).toEqual({ ok: false, reason: "Enter the results before you move this to Resulted." });
    const a = labCanMove(lab(), "ordered", "in-progress");
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toContain("Collect the specimen");
    expect(labCanMove(lab(), "ordered", "published").ok).toBe(false);
    expect(labCanMove(lab({ status: "collected" }), "collected", "entered").ok).toBe(false);
  });
  it("refuses to go back, and says published results are amended instead", () => {
    const back = labCanMove(lab({ status: "resulted" }), "published", "entered");
    expect(back.ok).toBe(false);
    expect(!back.ok && back.reason).toContain("amend");
    expect(labCanMove(lab({ status: "collected" }), "collected", "ordered").ok).toBe(false);
  });
  it("refuses the same stage, cancelled orders and unknown stages", () => {
    expect(labCanMove(lab(), "ordered", "ordered").ok).toBe(false);
    expect(labCanMove(lab({ status: "cancelled" }), "ordered", "collected").ok).toBe(false);
    expect(labCanMove(lab(), "ordered", "nowhere").ok).toBe(false);
  });
  it("sets a tighter target for STAT and none for published", () => {
    for (const s of Object.keys(LAB_TARGET_MIN) as (keyof typeof LAB_TARGET_MIN)[]) {
      expect(LAB_TARGET_MIN[s].stat).toBeLessThan(LAB_TARGET_MIN[s].urgent);
      expect(LAB_TARGET_MIN[s].urgent).toBeLessThan(LAB_TARGET_MIN[s].routine);
    }
    expect(labClock(lab({ priority: "stat" }), "ordered")?.targetMin).toBe(10);
    expect(labClock(lab({ priority: "routine" }), "ordered")?.targetMin).toBe(45);
    expect(labClock(lab({ status: "resulted" }), "published")).toBeNull();
  });
  it("counts the live numbers", () => {
    const now = Date.now();
    const orders = [
      lab({ id: "a", priority: "stat", orderedAt: ago(30) }), // late: stat target 10
      lab({ id: "b", priority: "routine", orderedAt: ago(5) }),
      lab({ id: "c", status: "cancelled" }),
      lab({ id: "d", status: "resulted", orderedAt: ago(100), sends: [{ seq: 1, kind: "lab-result", version: 1, docStatus: "final", at: ago(40), bundle: {}, checks: [], response: { status: "accepted" } } as unknown as LabOrder["sends"][number]] }),
    ];
    const s = labStats(orders, now);
    expect(s.statWaiting).toBe(1);
    expect(s.late).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.ordersToday).toBeGreaterThanOrEqual(0);
    expect(Math.round(s.avgTurnaroundMin ?? 0)).toBe(60);
  });
});

/* ---------- radiology ---------- */

describe("radiology board", () => {
  it("has four stages and five modality lanes", () => {
    expect(RAD_STAGES.map((s) => s.id)).toEqual(["ordered", "performed", "reporting", "reported"]);
    expect(RAD_LANES.map((l) => l.id)).toEqual(["xray", "ct", "mri", "us", "other"]);
  });
  it("puts each exam in the lane of its modality", () => {
    expect(radLaneOf({ procCode: "XCHES-PA" })).toBe("xray");
    expect(radLaneOf({ procCode: "CCHES" })).toBe("ct");
    expect(radLaneOf({ procCode: "MSKUH" })).toBe("mri");
    expect(radLaneOf({ procCode: "UABDO" })).toBe("us");
    expect(radLaneOf({ procCode: "XMAMB" })).toBe("other"); // mammography
    expect(radLaneOf({ procCode: "XBDXW" })).toBe("other"); // bone density
    expect(radLaneOf({ procCode: "NOPE" })).toBe("other");
  });
  it("derives the stage, with Reporting once the radiologist typed something", () => {
    expect(radStageOf(rad())).toBe("ordered");
    expect(radStageOf(rad({ status: "performed", study, report: report() }))).toBe("performed");
    expect(radStageOf(rad({ status: "performed", study, report: report({ findings: "Clear lungs" }) }))).toBe("reporting");
    expect(reportStarted(rad({ status: "performed", report: report({ impression: "Normal" }) }))).toBe(true);
    expect(radStageOf(rad({ status: "resulted" }))).toBe("reported");
    expect(radStageOf(rad({ status: "amended" }))).toBe("reported");
    expect(radStageOf(rad({ status: "cancelled" }))).toBeNull();
  });
  it("allows the forward steps and refuses skipping and going back", () => {
    expect(radCanMove(rad(), "ordered", "performed")).toEqual({ ok: true });
    expect(radCanMove(rad({ status: "performed", report: report() }), "performed", "reporting")).toEqual({ ok: true });
    const full = rad({ status: "performed", study, report: report({ findings: "a", impression: "b" }) });
    expect(radCanMove(full, "reporting", "reported")).toEqual({ ok: true });
    const skip = radCanMove(rad(), "ordered", "reporting");
    expect(!skip.ok && skip.reason).toContain("performed");
    expect(radCanMove(rad({ status: "performed", report: report() }), "performed", "reported").ok).toBe(false);
    expect(radCanMove(rad({ status: "resulted" }), "reported", "reporting").ok).toBe(false);
    expect(radCanMove(rad({ status: "performed" }), "performed", "ordered").ok).toBe(false);
  });
  it("needs the findings and the impression before publishing", () => {
    const half = rad({ status: "performed", study, report: report({ findings: "Clear lungs" }) });
    const res = radCanMove(half, "reporting", "reported");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toContain("impression");
  });
  it("runs the report due clock from the end of the exam", () => {
    const o = rad({ status: "performed", priority: "stat", study });
    const c = radClock(o, "performed");
    expect(c?.targetMin).toBe(30);
    expect(c?.since).toBe(study.performedEnd);
    expect(radClock(o, "reporting")?.targetMin).toBe(30);
    expect(radClock(rad({ priority: "routine" }), "ordered")?.targetMin).toBe(240);
    expect(radClock(rad({ status: "resulted" }), "reported")).toBeNull();
  });
  it("counts the live numbers", () => {
    const s = radStats([rad({ priority: "stat" }), rad({ status: "performed", study, report: report() }), rad({ status: "cancelled" })], Date.now());
    expect(s.statWaiting).toBe(1);
    expect(s.awaitingReport).toBe(1);
    expect(s.cancelled).toBe(1);
  });
});

/* ---------- pharmacy ---------- */

describe("pharmacy board", () => {
  it("has three stages and two lanes", () => {
    expect(RX_STAGES.map((s) => s.id)).toEqual(["pending", "partial", "dispensed"]);
    expect(RX_LANES.map((l) => l.id)).toEqual(["controlled", "standard"]);
    expect(rxLaneOf({ controlled: true })).toBe("controlled");
    expect(rxLaneOf({ controlled: false })).toBe("standard");
  });
  it("derives the stage from the dispense lines", () => {
    const base = rx();
    expect(rxStageOf(rxState([base]), base)).toBe("pending");
    expect(rxStageOf(rxState([base], [disp([line(4)])]), base)).toBe("partial");
    const done = rx({ items: [item({ status: "completed" })] });
    expect(rxStageOf(rxState([done], [disp([line(10, { type: "FF" })])]), done)).toBe("dispensed");
  });
  it("keeps unsent, held, stopped and cancelled prescriptions off the board", () => {
    expect(rxStageOf(rxState([]), rx({ sentAt: undefined }))).toBeNull();
    expect(rxStageOf(rxState([]), rx({ items: [item({ status: "on-hold" })] }))).toBeNull();
    expect(rxStageOf(rxState([]), rx({ items: [item({ status: "stopped" })] }))).toBeNull();
    expect(rxStageOf(rxState([]), rx({ items: [item({ status: "cancelled" })] }))).toBeNull();
  });
  it("only allows forward moves, which open the dispense dialog", () => {
    expect(rxCanMove(rx(), "pending", "partial")).toEqual({ ok: true });
    expect(rxCanMove(rx(), "pending", "dispensed")).toEqual({ ok: true });
    expect(rxCanMove(rx(), "partial", "dispensed")).toEqual({ ok: true });
    expect(rxCanMove(rx(), "dispensed", "partial").ok).toBe(false);
    expect(rxCanMove(rx(), "partial", "pending").ok).toBe(false);
    expect(rxCanMove(rx(), "pending", "pending").ok).toBe(false);
  });
  it("shows the fill progress per item", () => {
    const base = rx();
    const f = itemFills(rxState([base], [disp([line(4)])]), base)[0];
    expect(f).toMatchObject({ quantity: 10, dispensed: 4, remaining: 6, lastType: "FFP", done: false });
  });
  it("has tighter targets for controlled drugs and no clock when dispensed", () => {
    const s = rxState([]);
    expect(rxClock(s, rx({ controlled: true }), "pending")?.targetMin).toBe(15);
    expect(rxClock(s, rx(), "pending")?.targetMin).toBe(30);
    expect(rxClock(s, rx(), "dispensed")).toBeNull();
  });
  it("counts the live numbers", () => {
    const a = rx();
    const b = rx({ id: "rx2", controlled: true });
    const st = rxState([a, b], [disp([line(10, { type: "FF" })], { rxId: "rx1" })]);
    const n = rxStats(st, Date.now());
    expect(n.waiting).toBeGreaterThanOrEqual(1);
    expect(n.controlledWaiting).toBe(1);
  });
});

/* ---------- generic board logic ---------- */

describe("board logic", () => {
  it("groups cards by lane and stage", () => {
    const cards = [lab({ id: "a", priority: "stat" }), lab({ id: "b", priority: "routine" }), lab({ id: "c", priority: "routine", status: "collected" })];
    const g = groupByCell(cards, labLaneOf, (o) => labStageOf(o) ?? "ordered");
    expect(g.get(cellKey("stat", "ordered"))?.map((o) => o.id)).toEqual(["a"]);
    expect(g.get(cellKey("routine", "ordered"))?.map((o) => o.id)).toEqual(["b"]);
    expect(g.get(cellKey("routine", "collected"))?.map((o) => o.id)).toEqual(["c"]);
    expect(g.get(cellKey("stat", "collected"))).toBeUndefined();
  });
  it("marks valid, blocked and origin columns while dragging", () => {
    const o = lab({ status: "collected" });
    const d = dropStates(o, "collected", LAB_STAGES, labCanMove);
    expect(d.collected.state).toBe("origin");
    expect(d["in-progress"].state).toBe("valid");
    expect(d.ordered.state).toBe("blocked");
    expect(d.published.state).toBe("blocked");
    expect(d.published.reason).toBeTruthy();
  });
  it("lists the stages after a given one", () => {
    expect(stagesAfter(LAB_STAGES, "entered").map((s) => s.id)).toEqual(["published"]);
  });
});
