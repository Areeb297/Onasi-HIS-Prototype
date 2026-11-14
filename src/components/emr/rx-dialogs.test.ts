import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setDevMode } from "@/lib/devmode";
import { getRx, resetRx } from "@/lib/rx";
import { queryPrescriber, verifyItem } from "@/lib/rx-verify";
import { switchUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { PharmacyDispensePage } from "@/pages/PharmacyDispensePage";
import { DispenseDialog } from "./DispenseDialog";
import { PrescriptionSection } from "./PrescriptionSection";
import { VerifyDialog } from "./VerifyDialog";

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

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const controlled = () => getRx().prescriptions.find((p) => p.controlled)!;

describe("pharmacy screens render", () => {
  beforeEach(() => {
    setDevMode(false);
    switchUser("U4");
    resetRx(true);
  });

  it("shows the check sheet with the patient and the three choices", () => {
    const rx = controlled();
    const patient = getState().patients.find((p) => p.id === rx.patientId)!;
    const out = text(renderToString(h(VerifyDialog, { rx, itemId: rx.items[0].id, onClose: () => undefined })));
    for (const word of ["Pharmacist Check", "Check Sheet", "Allergies", "Duplicate Drugs", "Interactions", "Dose Range", "Weight", "Kidney", "Verify", "Query The Prescriber", "Reject", "Prescriber"]) {
      expect(out).toContain(word);
    }
    expect(out).toContain(patient.mrn);
    expect(out).toContain(`${patient.given} ${patient.family}`);
    expect(out).toMatch(/\d+ years, (Male|Female)/);
  });

  it("holds an unverified item back in the dispense dialog", () => {
    const out = text(renderToString(h(DispenseDialog, { rx: controlled(), onClose: () => undefined })));
    expect(out).toContain("Not Ready To Dispense");
    expect(out).toContain("Only a verified item can be dispensed.");
    expect(out).not.toContain("Quantity To Dispense");
  });

  it("asks for the batch, the witness and the Raqeeb choice on a verified controlled item", () => {
    const rx0 = controlled();
    verifyItem(rx0.id, rx0.items[0].id);
    const rx = controlled();
    const patient = getState().patients.find((p) => p.id === rx.patientId)!;
    const html = renderToString(h(DispenseDialog, { rx, onClose: () => undefined }));
    const out = text(html);
    for (const word of ["Dose", "Route", "Frequency", "Prescriber", "Allergies", "Weight", "Batch", "Earliest expiry first", "Controlled Drug Witness", "Witness Name", "Witness Staff Number", "Raqeeb Secure Code", "Choose one", "Still Needed Before You Can Dispense"]) {
      expect(out).toContain(word);
    }
    expect(out).toMatch(/Remaining \d+ of \d+ capsule/);
    expect(out).toMatch(/expires \d{1,2} [A-Z][a-z]{2} \d{4}, \d+ capsule in stock/);
    expect(out).not.toMatch(/expires [^,]*\d{2}:\d{2}/); // a date only, no time
    expect(out).toContain(patient.mrn);
    expect(out).toContain("Verified By Noura Alzahrani, PharmD (U4)");
    // No secure code mode is preselected.
    expect(html).not.toMatch(/<option[^>]*selected[^>]*value="(authenticated|override)"/);
    expect(html).not.toMatch(/<option[^>]*value="(authenticated|override)"[^>]*selected/);
  });

  it("groups the table by patient and can list by item", () => {
    mem.set("onasi-view-rx", "table");
    const out = text(renderToString(h(PharmacyDispensePage)));
    expect(out).toContain("By Patient");
    expect(out).toContain("By Item");
    expect(out).toMatch(/\d+ To Verify/);
    expect(out).toMatch(/\d+ items?/);
    expect(out).toContain("Show Items");
  });

  it("shows the pharmacy question to the prescriber on the chart", () => {
    const rx = controlled();
    queryPrescriber(rx.id, rx.items[0].id, "Is this dose right for the weight?");
    switchUser("U1");
    const enc = getState().encounters.find((e) => e.visitNumber === rx.visitNumber)!;
    const out = text(renderToString(h(PrescriptionSection, { enc })));
    expect(out).toContain("Query Sent");
    expect(out).toContain("Is this dose right for the weight?");
    expect(out).toContain("Answer The Pharmacist");
    expect(out).toContain("The pharmacy asked a question about 1 item");
  });
});
