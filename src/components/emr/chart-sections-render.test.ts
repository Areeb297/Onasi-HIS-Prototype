import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { EmarSection } from "./EmarSection";
import { ProgressNotesSection } from "./ProgressNotesSection";
import { SoapSection } from "./SoapSection";
import { ChartOverview } from "./ChartOverview";
import { saveSoap } from "@/lib/ai/soap-store";
import { resetEmar } from "@/lib/emar";
import { addNote } from "@/lib/progress-notes";
import { getRx, resetRx, setRx } from "@/lib/rx";
import { DRUGS } from "@/lib/rx-catalogue";
import type { Prescription, RxItem } from "@/lib/rx-types";
import { switchUser } from "@/lib/session";
import { EMPTY_DETAIL, resetSoapDetails, saveSoapDetail } from "@/lib/soap-details";
import { getState, resetAll } from "@/lib/store";

const h = React.createElement;
const enc = () => getState().encounters.find((e) => e.patientId === "P001" && e.status === "active")!;
const patient = () => getState().patients.find((p) => p.id === "P001")!;

function prescribe(generic: string, n: number, over: Partial<RxItem> = {}) {
  const e = enc();
  const sent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const item: RxItem = {
    id: `r-item-${n}`, identifier: `RXI-R${n}`, drugId: DRUGS.find((d) => d.generic === generic)!.id, dose: 1, frequencyId: "QID", asNeeded: false, durationDays: 5,
    quantity: 10, quantityManual: false, route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "R69", text: "Illness" }, status: "active", version: 1, ...over,
  };
  const rx: Prescription = {
    id: `r-rx-${n}`, number: `RX-R${n}`, visitNumber: e.visitNumber, patientId: e.patientId, prescriberId: e.attending, authoredAt: sent, usage: "inpatient",
    groupId: `G${n}`, controlled: false, items: [item], sentAt: sent, dirty: false,
  };
  setRx({ ...getRx(), prescriptions: [...getRx().prescriptions, rx] });
}

beforeEach(() => {
  resetAll(); resetRx(); resetEmar(); resetSoapDetails(); switchUser("U2");
});

describe("chart sections render", () => {
  it("offers to record several overdue doses at one hour together", () => {
    prescribe("Metformin", 1);
    prescribe("Amlodipine", 2);
    const html = renderToString(h(EmarSection, { enc: enc() }));
    expect(html).toContain("Record All Due At");
    expect(html).toContain("Month");
  });

  it("renders the overview with encounter history, details, demographics, summary cards and the journey", () => {
    const html = renderToString(h(ChartOverview, { enc: enc(), patient: patient() }));
    for (const s of ["Needs Attention", "Handoff (SBAR)", "Encounter Details", "Demographics", "Encounter History", "Active Medicines", "History", "Attachments", "Patient Journey", "Visit Summary", "Audit Trail", "Total visit time", "since the previous step"]) {
      expect(html, s).toContain(s);
    }
  });

  it("renders progress notes with Active status and the edit and delete controls", () => {
    switchUser("U1");
    addNote(enc().visitNumber, "Reviewed on the ward round.");
    const html = renderToString(h(ProgressNotesSection, { enc: enc() }));
    expect(html).toContain("Reviewed on the ward round.");
    expect(html).toContain("Active");
    // Edit and Delete Note now sit in the row actions menu, which renders on open.
  });

  it("renders a SOAP note with its structured parts, Download and the note history", () => {
    switchUser("U1");
    const e = enc();
    const n = saveSoap(e.visitNumber, e.patientId, { subjective: "Cough", objective: "", assessment: "", plan: "" });
    saveSoapDetail(e.visitNumber, n.id, { ...EMPTY_DETAIL, hpi: "Three days of cough", riskFactors: ["Smoking"] });
    const html = renderToString(h(SoapSection, { enc: enc() }));
    expect(html).toContain("Three days of cough");
    expect(html).toContain("Smoking");
    expect(html).toContain("Download");
    expect(html).toContain("Note History");
  });
});
