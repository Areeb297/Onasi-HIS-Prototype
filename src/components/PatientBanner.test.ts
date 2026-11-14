import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PatientBanner, PatientFlagBadges } from "./PatientBanner";
import type { Patient } from "@/lib/model";

const patient: Patient = {
  id: "P900", mrn: "MRN900", nationalId: "1000009999", family: "Almutairi", given: "Saad", dob: "1968-03-14", sex: "M",
  healthId: "1099999999", nationality: "SAU", maritalStatus: "M", address: "",
  extra: {
    nameAr: { first: "سعد", second: "فهد", third: "ناصر", family: "المطيري" },
    flags: { dnr: { doctor: "Dr. Khalid Alharbi", date: "2026-11-01" }, interpreter: { language: "Urdu" }, fallRisk: true, isolation: true },
  },
};

describe("patient banner", () => {
  it("shows the Arabic name under the English name, and every flag as a labelled badge", () => {
    const html = renderToString(React.createElement(PatientBanner, { patient, allergies: [] }));
    expect(html).toContain("Saad Almutairi");
    expect(html).toContain("سعد فهد ناصر المطيري");
    for (const label of ["Do Not Resuscitate", "Dr. Khalid Alharbi, 2026-11-01", "Isolation", "Fall Risk", "Needs Interpreter: Urdu"]) expect(html, label).toContain(label);
  });

  it("shows no flag row and no Arabic line for a patient without them", () => {
    const plain = { ...patient, extra: undefined };
    const html = renderToString(React.createElement(PatientBanner, { patient: plain, allergies: [] }));
    expect(html).not.toContain("Flags");
    expect(html).not.toContain('lang="ar"');
    expect(renderToString(React.createElement(PatientFlagBadges, { patient: plain }))).toBe("");
  });
});
