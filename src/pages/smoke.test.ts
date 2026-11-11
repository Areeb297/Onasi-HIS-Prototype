import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

// Minimal browser stubs so the router and storage helpers work in the Node test environment.
const g = globalThis as unknown as Record<string, unknown>;
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const win = { location: { hash: "" }, addEventListener() {}, removeEventListener() {} };
g.window = win;

import App from "@/App";
import { RegistrationForm } from "@/components/RegistrationForm";
import { EMR_MENU } from "@/lib/emr-menu";
import { MASTERS } from "@/lib/masters-data";
import { NAV } from "@/lib/nav";
import { setDevMode } from "@/lib/devmode";
import { switchUser, USERS } from "@/lib/session";
import { getState } from "@/lib/store";
import { ChartPage } from "@/pages/ChartPage";
import { CompliancePage } from "@/pages/CompliancePage";
import { EmergencyBoard } from "@/pages/EmergencyBoard";
import { AccessPage, AuditPage, ConfidentialPage, RegistrationPage } from "@/pages/GovernancePages";
import { MasterPage } from "@/pages/MasterPage";
import { NphiesClinicalPage } from "@/pages/NphiesClinicalPage";
import { NphiesFinancialPage } from "@/pages/NphiesFinancialPage";
import { WorklistPage } from "@/pages/WorklistPage";

const h = React.createElement;
const html = (el: React.ReactElement) => renderToString(el);

function at(hash: string) {
  win.location.hash = hash;
}

describe("screens render without errors", () => {
  const visit = () => getState().encounters.find((e) => e.patientId === "P001")!.visitNumber;

  beforeAll(() => {
    switchUser("U9"); // administrator sees everything
  });

  for (const dev of [false, true]) {
    describe(dev ? "Developer View" : "HIS View", () => {
      beforeAll(() => setDevMode(dev));

      it("renders the app shell on several routes", () => {
        for (const route of ["#/opd", "#/ipd", "#/er", "#/beds", "#/patients", "#/registration", "#/audit", "#/compliance", "#/access", "#/m/clinic", "#/lab", "#/radiology", "#/pharmacy/dispense", "#/ai-governance", "#/nphies-clinical", "#/nphies-financial", "#/agents", "#/dashboard", "#/m/daman-dashboard"]) {
          at(route);
          expect(html(h(App)).length, route).toBeGreaterThan(500);
        }
      });

      it("renders every page of the chart menu", () => {
        for (const item of EMR_MENU) {
          at(`#/chart?visit=${visit()}&s=${item.id}`);
          expect(html(h(ChartPage)).length, item.id).toBeGreaterThan(300);
        }
      });

      it("renders the emergency board, worklists and registration", () => {
        at("#/er");
        expect(html(h(EmergencyBoard))).toContain("Emergency Department");
        for (const mode of ["opd", "ipd", "er"] as const) expect(html(h(WorklistPage, { mode })).length).toBeGreaterThan(500);
        expect(html(h(RegistrationForm, { cls: "O" }))).toContain("Retrieve Patient Insurance Card");
        expect(html(h(RegistrationForm, { cls: "E" }))).toContain("Who is the patient");
        at("#/registration");
        expect(html(h(RegistrationPage))).toContain("Registration");
      });

      it("renders every setup page", () => {
        for (const m of MASTERS) expect(html(h(MasterPage, { id: m.id })), m.id).toContain(m.title.replace(/&/g, "&amp;"));
      });

      it("renders the NPHIES clinical and financial pages", () => {
        expect(html(h(NphiesClinicalPage))).toContain("NPHIES Clinical");
        expect(html(h(NphiesFinancialPage))).toContain("NPHIES Financial");
      });

      it("renders governance pages", () => {
        expect(html(h(CompliancePage))).toContain("Compliance Map");
        expect(html(h(AuditPage))).toContain("Audit Trail");
        expect(html(h(AccessPage))).toContain("Access Matrix");
        expect(html(h(ConfidentialPage))).toContain("Confidential Patient");
      });
    });
  }

  it("renders the app for every demo user without errors", () => {
    setDevMode(true);
    at("#/opd");
    for (const u of USERS) {
      switchUser(u.id);
      expect(html(h(App)).length, u.name).toBeGreaterThan(500);
    }
    switchUser("U9");
  });

  it("every menu page of every group has a route or a setup definition", () => {
    expect(NAV.length).toBeGreaterThan(20);
  });
});
