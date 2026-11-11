import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { setDevMode } from "@/lib/devmode";
import {
  collectSpecimens, createConformanceSampleOrder, fillSampleResults, getLab, placeLabOrder, publishLabResult, resetLab, sendLabOrder, startProcessing,
} from "@/lib/lab";
import { createRadConformanceSample, markPerformed, publishRadReport, resetRad, saveRadReport, sendRadOrder, placeRadOrder, getRad } from "@/lib/radiology";
import { resetRx } from "@/lib/rx";
import { switchUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { LabWorklistPage } from "@/pages/LabWorklistPage";
import { PharmacyDispensePage } from "@/pages/PharmacyDispensePage";
import { RadiologyWorklistPage } from "@/pages/RadiologyWorklistPage";
import { RAD_LANES, RAD_STAGES } from "./rad-board";
import { LAB_LANES, LAB_STAGES } from "./lab-board";
import { RX_LANES, RX_STAGES } from "./rx-board";
import { SwimBoard } from "./SwimBoard";

const h = React.createElement;

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const setView = (page: "lab" | "rad" | "rx", v: "board" | "table") => mem.set(`onasi-view-${page}`, v);

describe("swim lane boards render", () => {
  beforeAll(() => {
    switchUser("U9");
    resetLab();
    resetRad();
    resetRx(true);
    const enc = getState().encounters.find((e) => e.patientId === "P001")!;
    // lab: one order in every stage
    const done = createConformanceSampleOrder(enc)!; // in progress with all results
    sendLabOrder(done.id);
    publishLabResult(done.id); // resulted
    const early = getLab().orders.find((o) => o.status === "received")!;
    collectSpecimens(early.id);
    const coll = getLab().orders.filter((o) => o.status === "received")[0];
    collectSpecimens(coll.id);
    startProcessing(coll.id);
    const full = getLab().orders.filter((o) => o.status === "received")[0];
    collectSpecimens(full.id);
    startProcessing(full.id);
    fillSampleResults(full.id); // results entered
    placeLabOrder(enc, { codes: ["58410-2", "2345-7"], priority: "stat", fasting: null, note: "" }); // a fresh order waits in Ordered
    // radiology: performed, reporting, reported
    const r1 = createRadConformanceSample(enc)!; // performed + normal report typed = reporting
    sendRadOrder(r1.id);
    publishRadReport(r1.id);
    const r2 = placeRadOrder(enc, { procCode: "CCHES", priority: "stat", indication: "Test", clinicalInfo: "" })!;
    markPerformed(r2.id);
    saveRadReport(r2.id, { critical: true });
    expect(getRad().orders.length).toBeGreaterThan(3);
  });

  for (const dev of [true, false]) {
    for (const view of ["board", "table"] as const) {
      it(`renders lab, radiology and pharmacy in ${dev ? "Developer" : "HIS"} View, ${view} view`, () => {
        setDevMode(dev);
        setView("lab", view);
        setView("rad", view);
        setView("rx", view);
        const lab = renderToString(h(LabWorklistPage));
        const rad = renderToString(h(RadiologyWorklistPage));
        const rx = renderToString(h(PharmacyDispensePage));
        expect(lab).toContain("Laboratory Worklist");
        // The requirements checklist is for testers: Developer View only.
        for (const html of [lab, rad]) {
          if (dev) expect(html).toContain("NPHIES Requirements");
          else expect(html).not.toContain("NPHIES Requirements");
        }
        expect(rx).toContain("Dispense Worklist");
        if (view === "board") {
          for (const s of LAB_STAGES) expect(lab).toContain(s.label);
          for (const l of LAB_LANES) expect(lab).toContain(l.label);
          for (const s of RAD_STAGES) expect(rad).toContain(s.label);
          for (const l of RAD_LANES) expect(rad).toContain(l.label);
          for (const s of RX_STAGES) expect(rx).toContain(s.label);
          for (const l of RX_LANES) expect(rx).toContain(l.label);
          expect(lab).toContain("Orders Today");
          expect(lab).not.toMatch(/call-?back/i);
          expect(lab).toContain("Collect Specimen");
          expect(lab).toContain("Release Result");
          expect(rad).toContain("Exams Today");
          expect(rad).toContain("Report due");
          expect(rx).toContain("Waiting For Pharmacy");
          expect(rx).toContain("Dispense");
          expect(lab).toContain("Move");
          // tubes and glyphs are drawn as SVG
          expect(lab).toContain("Lavender cap");
          expect(rad).toContain("scanner");
          expect(rx).toContain("progressbar");
          expect(lab).toContain('role="status"'); // live region
          const visible = lab.replace(/<[^>]*>/g, " "); // the text people can read
          if (dev) expect(visible).toMatch(/LO-1[0-9]{5}/);
          else expect(visible).not.toMatch(/LO-1[0-9]{5}/);
        } else {
          expect(lab).toContain("Status filter");
          expect(rad).toContain("Status filter");
          expect(rx).toContain("Prescriptions");
        }
        expect(lab).not.toContain("—");
      });
    }
  }

  it("locks the cards for a role without permission", () => {
    setDevMode(false);
    setView("lab", "board");
    setView("rad", "board");
    setView("rx", "board");
    switchUser("U1"); // physician: no lab.result, rad.report or rx.dispense
    expect(renderToString(h(LabWorklistPage))).toContain("Your role cannot move laboratory orders");
    expect(renderToString(h(RadiologyWorklistPage))).toContain("Your role cannot move radiology orders");
    expect(renderToString(h(PharmacyDispensePage))).toContain("Your role cannot dispense");
    switchUser("U9");
  });

  it("renders the generic board with its own data and an empty lane", () => {
    interface T { id: string; lane: string; stage: string }
    const cards: T[] = [{ id: "1", lane: "a", stage: "s1" }, { id: "2", lane: "a", stage: "s2" }];
    const html = renderToString(
      h(SwimBoard<T>, {
        lanes: [{ id: "a", label: "Lane A", tone: "admit" }, { id: "b", label: "Lane B", tone: "move" }],
        stages: [{ id: "s1", label: "First", tone: "move", target: "Target 5 min" }, { id: "s2", label: "Second", tone: "ok" }],
        cards,
        getId: (c) => c.id,
        label: (c) => `Card ${c.id}`,
        laneOf: (c) => c.lane,
        stageOf: (c) => c.stage,
        renderCard: (c) => h("span", null, `Body ${c.id}`),
        canMove: (_c, from, to) => (from === "s1" && to === "s2" ? { ok: true } : { ok: false, reason: "Not allowed." }),
        onMove: () => true,
        clockOf: (c) => (c.stage === "s1" ? { since: new Date(Date.now() - 600_000).toISOString(), targetMin: 5 } : null),
        dev: false,
      }),
    );
    expect(html).toContain("Lane A");
    expect(html).toContain("Lane B");
    expect(html).toContain("Body 1");
    expect(html).toContain("Target 5 min");
    expect(html).toMatch(/1(<!-- -->)? late/);
  });
});
