import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const g = globalThis as unknown as Record<string, unknown>;
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { location: { hash: "" }, addEventListener() {}, removeEventListener() {} };

import { actionsFor } from "./RowActions";
import { ConvertDialog, DiagnosticsTab, DischargeDialog, DischargeProgress, MoveVisitDialog, OutpatientDialog, TransferDialog } from "./VisitActions";
import { setDevMode } from "@/lib/devmode";
import { switchUser } from "@/lib/session";
import { getState, resetAll, updateEncounter } from "@/lib/store";

const h = React.createElement;
/** Server HTML with the text-joining comments React adds removed. */
const renderToText = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};
const visitOf = (pid: string) => getState().encounters.find((e) => e.patientId === pid)!.visitNumber;
// Text the way React writes it into HTML.
const enc = (s: string) => s.replace(/&/g, "&amp;");

describe("visit action dialogs render", () => {
  beforeAll(() => switchUser("U9"));
  beforeEach(() => resetAll());

  for (const dev of [false, true]) {
    describe(dev ? "Developer View" : "HIS View", () => {
      beforeAll(() => setDevMode(dev));

      it("shows the transfer with the new department, sub-department and reason", () => {
        const html = renderToText(h(TransferDialog, { visit: visitOf("P001"), onClose: noop }));
        for (const s of ["Transfer Patient", "New Department", "New Sub-Department", "New Bed", "Reason For Transfer"]) expect(html).toContain(s);
      });

      it("shows the change to inpatient with free beds by floor and room", () => {
        const html = renderToText(h(ConvertDialog, { visit: visitOf("P007"), onClose: noop }));
        for (const s of ["Admit To Inpatient", "Department", "Admission Type", "Patient Condition", "Date And Time", "Reason", "Activity Level", "Floor 3", "Room 302", "beds free"]) expect(html).toContain(s);
        expect(html).not.toContain("Room 301"); // both beds taken
      });

      it("offers the follow-up when changing to outpatient", () => {
        const html = renderToText(h(OutpatientDialog, { visit: visitOf("P002"), onClose: noop }));
        for (const s of ["Change To Outpatient", "Request Outpatient Follow-Up", "Follow Up In", "Clinic", "Visit Type"]) expect(html).toContain(s);
      });

      it("shows both patients side by side when moving a visit", () => {
        const html = renderToText(h(MoveVisitDialog, { visit: visitOf("P007"), onClose: noop }));
        for (const s of ["Move Visit", "Find The Correct Patient", "Wrong Patient (Now)", "Correct Patient", "Reason For The Move", "Review Move"]) expect(html).toContain(s);
      });

      it("lays an inpatient discharge out in the four tabs, with the clearances", () => {
        const html = renderToText(h(DischargeDialog, { visit: visitOf("P001"), onClose: noop }));
        for (const s of ["Disposition And Attendant", "Clinical Summary", "Diagnostics And Medicines", "Follow-Up And Instructions", "Condition On Discharge", "Discharge Date And Time", "Attendant Name", "ID Type", "Discharge Clearances", "Transfer To Another Hospital", "Died"]) {
          expect(html).toContain(enc(s));
        }
      });

      it("keeps a short discharge for a clinic visit", () => {
        const html = renderToText(h(DischargeDialog, { visit: visitOf("P007"), onClose: noop }));
        expect(html).toContain("Condition On Discharge");
        expect(html).toContain("Discharge Instructions");
        expect(html).not.toContain("Disposition And Attendant");
        expect(html).not.toContain("Discharge Clearances");
      });
    });
  }

  it("lists the visit's lab and imaging orders and prescriptions, read only", () => {
    const html = renderToText(h(DiagnosticsTab, { visit: visitOf("P001") }));
    for (const s of ["Lab Orders", "Imaging And Radiology", "Prescriptions", "Read only"]) expect(html).toContain(s);
    expect(html).toMatch(/LO-\d+/);
    expect(html).toMatch(/RO-\d+/);
    expect(html).not.toContain("<input");
  });

  it("shows the discharge progress of a visit saved before the new discharge details", () => {
    const v = visitOf("P006");
    updateEncounter(v, (e) => { e.discharge = { outcome: "home", orderedAt: "2026-11-10T09:00", orderedBy: "Dr. Khalid Alharbi", bedId: "401-B" }; }, { touch: false });
    const e = getState().encounters.find((x) => x.visitNumber === v)!;
    expect(renderToString(h(DischargeProgress, { enc: e, onClearances: noop, onLeftWard: noop }))).toContain("Waiting to leave");
  });

  it("offers Move Visit on open, pre-admitted and discharged visits", () => {
    const s = getState();
    for (const pid of ["P001", "P005", "P006", "P007"]) {
      expect(actionsFor(s.encounters.find((e) => e.patientId === pid)!).some((a) => a.key === "A45" && a.label === "Move Visit"), pid).toBe(true);
    }
  });
});
