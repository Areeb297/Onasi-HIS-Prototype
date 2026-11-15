import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MyPatientsPage } from "@/pages/MyPatientsPage";
import { switchUser } from "@/lib/session";
import type { LabOrder, RadOrder } from "@/lib/fhir/types";
import type { Encounter } from "@/lib/model";
import { doctorIdOf, groupOf, resultsOf } from "./my-patients";
import { DOCTORS } from "./reference-data";

const enc = (p: Partial<Encounter>) => ({ status: "active", cls: "I", ...p }) as Encounter;
const NOW = new Date("2026-11-15T12:00:00").getTime();
const lab = (p: Partial<LabOrder>) => ({ visitNumber: "V1", status: "resulted", results: {}, ...p }) as LabOrder;
const res = (interp: string, at: string, status = "final") => ({ code: "x", value: "1", interp, status, at }) as LabOrder["results"][string];

describe("My Patients", () => {
  it("matches a signed-in doctor by name and nobody else", () => {
    const d = DOCTORS[0];
    expect(doctorIdOf(`Dr. ${d.given} ${d.family}`)).toBe(d.id);
    expect(doctorIdOf("System Administrator")).toBeUndefined();
  });

  it("puts current visits in a list and leaves the rest out", () => {
    expect(groupOf(enc({ cls: "I" }), "2026-11-15")).toBe("inpatient");
    expect(groupOf(enc({ cls: "E" }), "2026-11-15")).toBe("emergency");
    expect(groupOf(enc({ cls: "O", admitAt: "2026-11-15T09:00" }), "2026-11-15")).toBe("clinic");
    expect(groupOf(enc({ cls: "O", admitAt: "2026-11-14T09:00" }), "2026-11-15")).toBeNull();
    expect(groupOf(enc({ cls: "I", status: "discharged" }), "2026-11-15")).toBeNull();
    expect(groupOf(enc({ cls: "I", status: "preadmit" }), "2026-11-15")).toBeNull();
  });

  it("counts new, abnormal, critical and waiting results of the visit only", () => {
    const labs = [
      lab({ results: { a: res("N", "2026-11-15T08:00:00"), b: res("H", "2026-11-15T08:00:00"), c: res("HH", "2026-11-13T08:00:00"), d: res("H", "2026-11-15T09:00:00", "cancelled") } }),
      lab({ status: "collected" }),
      lab({ status: "cancelled" }),
      lab({ visitNumber: "V2", results: { a: res("LL", "2026-11-15T08:00:00") } }),
    ];
    const rads = [
      { visitNumber: "V1", status: "resulted", report: { critical: true, reportedAt: "2026-11-15T10:00:00" } },
      { visitNumber: "V1", status: "received" },
    ] as RadOrder[];
    expect(resultsOf("V1", labs, rads, NOW)).toEqual({ fresh: 3, critical: 2, abnormal: 1, pending: 2, latest: "2026-11-15T10:00:00" });
    expect(resultsOf("V9", labs, rads, NOW)).toEqual({ fresh: 0, critical: 0, abnormal: 0, pending: 0 });
  });

  it("renders for a doctor and for staff who are not doctors", () => {
    switchUser("U1");
    const mine = renderToString(React.createElement(MyPatientsPage));
    expect(mine).toContain("My Patients");
    expect(mine).toContain("Your current patients");
    switchUser("U9");
    expect(renderToString(React.createElement(MyPatientsPage))).toContain("All doctors current patients");
  });
});
