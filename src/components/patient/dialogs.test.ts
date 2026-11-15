import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

const g = globalThis as unknown as Record<string, unknown>;
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { location: { hash: "" }, addEventListener() {}, removeEventListener() {} };

import { CoverageDialog } from "./CoverageDialog";
import { EligibilityDialog } from "./EligibilityDialog";
import { MergePatientsDialog } from "./MergePatientsDialog";
import { switchUser } from "@/lib/session";

const h = React.createElement;
const noop = () => {};

describe("patient dialogs render", () => {
  beforeAll(() => switchUser("U9"));

  it("shows the patient's coverage started from the registration card", () => {
    const html = renderToString(h(CoverageDialog, { patientId: "P001", onClose: noop }));
    expect(html).toContain("Patient Coverage");
    expect(html).toContain("Bupa Arabia");
    expect(html).toContain("Primary");
  });

  it("shows the eligibility request form", () => {
    const html = renderToString(h(EligibilityDialog, { patientId: "P001", onClose: noop }));
    for (const s of ["Eligibility Request", "Request Type", "Service Start Date", "Transfer", "Newborn"]) expect(html).toContain(s);
  });

  it("shows the merge form", () => {
    const html = renderToString(h(MergePatientsDialog, { open: true, onClose: noop, keepId: "P006" }));
    expect(html).toContain("Merge Patients");
    expect(html).toContain("File To Keep");
    expect(html).toContain("Duplicate File");
  });

  it("renders nothing while closed", () => {
    expect(renderToString(h(CoverageDialog, { patientId: null, onClose: noop }))).toBe("");
    expect(renderToString(h(MergePatientsDialog, { open: false, onClose: noop }))).toBe("");
  });
});
