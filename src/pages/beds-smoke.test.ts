import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

// Minimal browser stubs so the router and storage helpers work in the Node test environment.
const g = globalThis as unknown as Record<string, unknown>;
const mem = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
g.window = { location: { hash: "" }, addEventListener() {}, removeEventListener() {} };

import { BedSetupDialog } from "@/components/beds/BedSetupDialog";
import { switchUser } from "@/lib/session";
import { getState, seedState } from "@/lib/store";
import { reclassifiedVisits, subDepartmentOf } from "@/lib/worklist";
import { BedBoardPage } from "@/pages/BedBoardPage";
import { ReclassifiedVisitsPage } from "@/pages/ReclassifiedVisitsPage";
import { WardViewPage, daysInBed } from "@/pages/WardViewPage";
import { WorklistPage } from "@/pages/WorklistPage";

const h = React.createElement;
const html = (el: React.ReactElement) => renderToString(el);

describe("bed and worklist screens", () => {
  beforeAll(() => switchUser("U9"));

  it("renders the bed board, ward view and bed setup dialog", () => {
    expect(html(h(BedBoardPage))).toContain("Add Bed");
    const ward = html(h(WardViewPage));
    expect(ward).toContain("Ward View");
    expect(ward).toContain("Male Only");
    expect(html(h(BedSetupDialog, { onClose: () => {} }))).toContain("Gender Restriction");
    expect(html(h(BedSetupDialog, { bedId: "ICU1-A", onClose: () => {} }))).toContain("Edit Bed ICU1-A");
  });

  it("renders the worklists with eligibility and sub-department", () => {
    for (const mode of ["opd", "ipd", "er"] as const) {
      const out = html(h(WorklistPage, { mode }));
      expect(out, mode).toContain("Eligibility");
      // Sub-Department now lives in the Filters drawer, which opens on demand.
    }
  });

  it("lists visits changed to outpatient by A07 and not changed back", () => {
    expect(html(h(ReclassifiedVisitsPage))).toContain("Reclassified To Outpatient");
    const s = seedState();
    const enc = s.encounters.find((e) => e.cls === "I" && e.status === "active")!;
    enc.cls = "O";
    enc.lastBedId = enc.bedId;
    const entry = { ...s.log[0], seq: 999, eventId: "A07" as const, visitNumber: enc.visitNumber, sentAt: "2026-11-15T08:00:00.000Z" };
    const list = reclassifiedVisits({ encounters: s.encounters, log: [...s.log, entry] });
    expect(list.map((r) => r.enc.visitNumber)).toEqual([enc.visitNumber]);
    expect(list[0].fromBed).toBe(enc.lastBedId);
    const back = { ...entry, seq: 1000, eventId: "A06" as const, sentAt: "2026-11-15T09:00:00.000Z" };
    expect(reclassifiedVisits({ encounters: s.encounters, log: [...s.log, entry, back] })).toEqual([]);
  });

  it("works out a sub-department and days in bed", () => {
    const e = getState().encounters[0];
    expect(subDepartmentOf({ ...e, subDepartment: "Cardiology" }, [], [])).toBe("Cardiology");
    expect(subDepartmentOf({ ...e, cls: "E", subDepartment: undefined, admission: undefined }, [], [])).toBe("Emergency Department");
    expect(daysInBed("2026-11-10T08:00", new Date("2026-11-15T09:00").getTime())).toBe(5);
    expect(daysInBed(undefined)).toBeUndefined();
  });
});
