import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ConformancePanel, DocViewer } from "@/components/emr/fhir-ui";
import { LabResultEntry } from "@/components/emr/LabResultEntry";
import { LabResultsTable } from "@/components/emr/LabResultsTable";
import { LabSection } from "@/components/emr/LabSection";
import { RadReportEditor } from "@/components/emr/RadReportEditor";
import { RadiologySection } from "@/components/emr/RadiologySection";
import { LabWorklistPage } from "@/pages/LabWorklistPage";
import { RadiologyWorklistPage } from "@/pages/RadiologyWorklistPage";
import { setDevMode } from "@/lib/devmode";
import { LAB_ASSUMPTIONS } from "./assumptions";
import {
  cancelLabResult, createConformanceSampleOrder, getLab, getOrder, labConformance, publishLabResult, resetLab, saveLabResult, sendLabOrder,
} from "@/lib/lab";
import {
  createRadConformanceSample, getRad, getRadOrder, publishRadReport, radConformance, resetRad, saveRadReport, sendRadOrder,
} from "@/lib/radiology";
import { switchUser } from "@/lib/session";
import { getState } from "@/lib/store";

const h = React.createElement;

/** Render-time smoke test: the screens render in both views, in every state, without throwing. */
describe("lab and radiology screens render", () => {
  let labId = "";
  let radId = "";
  const enc = () => getState().encounters.find((e) => e.patientId === "P001")!;

  beforeAll(() => {
    switchUser("U9");
    resetLab();
    resetRad();
    const lab = createConformanceSampleOrder(enc())!;
    labId = lab.id;
    sendLabOrder(lab.id);
    publishLabResult(lab.id);
    saveLabResult(lab.id, "718-7", { value: "6.1" }); // critical low
    cancelLabResult(lab.id, "630-4", true);
    publishLabResult(lab.id, "corrected");
    const rad = createRadConformanceSample(enc())!;
    radId = rad.id;
    sendRadOrder(rad.id);
    publishRadReport(rad.id);
    saveRadReport(rad.id, { critical: true, communicated: "Dr. Khalid Alharbi", impression: "Critical result" });
    publishRadReport(rad.id, "amended");
  });

  for (const dev of [true, false]) {
    it(`renders every screen in ${dev ? "Developer" : "HIS"} View`, () => {
      setDevMode(dev);
      const order = getOrder(labId)!;
      const patient = getState().patients.find((p) => p.id === "P001")!;
      expect(renderToString(h(LabSection, { enc: enc() }))).toContain("Laboratory Orders");
      expect(renderToString(h(RadiologySection, { enc: enc() }))).toContain("Radiology Orders");
      expect(renderToString(h(LabWorklistPage))).toContain("Laboratory Worklist");
      expect(renderToString(h(RadiologyWorklistPage))).toContain("Radiology Worklist");
      expect(renderToString(h(LabResultEntry, { order, patient }))).toContain("Publish Amendment");
      expect(renderToString(h(LabResultsTable, { order, sex: patient.sex }))).toContain("Hemoglobin");
      expect(renderToString(h(RadReportEditor, { order: getRadOrder(radId)! }))).toContain("Publish Amendment");
    });
  }

  it("renders the conformance panel and the document viewer open", () => {
    setDevMode(true);
    const noop = () => {};
    const labHtml = renderToString(
      h(ConformancePanel, { steps: labConformance(getLab()), onToggleViewed: noop, rejectNext: false, onRejectNext: noop, assumptions: LAB_ASSUMPTIONS, defaultOpen: true }),
    );
    expect(labHtml).toContain("NPHIES Requirements");
    expect(labHtml).toContain("2.1.1.1");
    expect(labHtml).toContain("Done");
    const radHtml = renderToString(
      h(ConformancePanel, { steps: radConformance(getRad()), onToggleViewed: noop, rejectNext: false, onRejectNext: noop, assumptions: [], defaultOpen: true }),
    );
    expect(radHtml).toContain("3.2");
    const doc = renderToString(h(DocViewer, { records: getOrder(labId)!.sends.filter((s) => s.kind === "lab-result"), filenamePrefix: "x", empty: "none" }));
    expect(doc).toContain("x-v2.json");
    setDevMode(false);
    expect(renderToString(h(DocViewer, { records: [], filenamePrefix: "x", empty: "none" }))).toBe("");
    setDevMode(true);
  });

  it("starts with every conformance step not started when nothing was sent", () => {
    resetLab();
    resetRad();
    expect(labConformance(getLab()).map((s) => s.state)).toEqual(["none", "none", "none", "none"]);
    expect(radConformance(getRad()).map((s) => s.state)).toEqual(["none", "none", "none", "none"]);
    const html = renderToString(h(LabWorklistPage));
    expect(html).toContain("Collect Specimen");
  });
});
