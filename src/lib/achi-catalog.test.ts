import { describe, expect, it } from "vitest";
import { ACHI_BY_CODE, ACHI_CATALOG, ACHI_CODE, PROC_TYPES, newPr, readPr, searchAchi } from "./achi-catalog";
import type { Pr } from "./model";
import { emptyForm, planMessage, seedState } from "./store";

describe("ACHI catalogue", () => {
  it("holds at least 80 procedures with well formed, unique ACHI codes", () => {
    expect(ACHI_CATALOG.length).toBeGreaterThanOrEqual(80);
    for (const x of ACHI_CATALOG) {
      expect(x.code, x.text).toMatch(ACHI_CODE);
      expect(PROC_TYPES).toContain(x.procType);
      expect(["A", "D", "I", "P"]).toContain(x.type);
      expect(x.text.trim()).not.toBe("");
    }
    expect(new Set(ACHI_CATALOG.map((x) => x.code)).size).toBe(ACHI_CATALOG.length);
  });

  it("finds by code, with or without the hyphen, and by words", () => {
    expect(searchAchi("30445-00")[0].code).toBe("30445-00");
    expect(searchAchi("3044500")[0].code).toBe("30445-00");
    expect(searchAchi("laparoscopic cholecystectomy").map((x) => x.code)).toEqual(["30445-00"]);
    expect(searchAchi("caesarean").length).toBe(4);
    expect(searchAchi("zzzz")).toEqual([]);
  });

  it("limits the search to a procedure type", () => {
    const r = searchAchi("", { procType: "Endoscopic", limit: 100 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.procType === "Endoscopic")).toBe(true);
  });

  it("makes a new row with coverage from the visit", () => {
    const item = ACHI_BY_CODE["30572-00"];
    const cash = newPr(item, "2026-11-15T10:00", "Cash", "K35.8");
    expect(cash).toMatchObject({ code: "30572-00", system: "ACHI", type: "P", coverage: "Cash", status: "Completed", dxCode: "K35.8", procType: "Major Surgical" });
    expect(newPr(item, "2026-11-15T10:00", "Insurance").coverage).toBe("Insured");
    expect(newPr(item, "2026-11-15T10:00").dxCode).toBeUndefined();
  });

  it("reads an old procedure row saved before the new fields existed", () => {
    const old: Pr = { code: "44970-00", text: "Laparoscopic appendicectomy", system: "ACHI", type: "P", at: "2026-01-01T10:00" };
    const r = readPr(old, "Insurance");
    expect(r.status).toBe("Completed");
    expect(r.coverage).toBe("Insured");
    expect(r.dxCode).toBeUndefined();
    expect(r.procType).toBeUndefined();
    expect(readPr(old, "Cash").coverage).toBe("Cash");
    expect(readPr({ ...old, status: "Pending", coverage: "Cash" }).status).toBe("Pending");
  });
});

describe("PR1 is not changed by the HIS-only fields", () => {
  it("builds the same PR1 with or without them", () => {
    const state = seedState();
    const f = emptyForm(state, "A04");
    f.patientId = "P008";
    const base: Pr = { code: "30572-00", text: "Laparoscopic appendicectomy", system: "ACHI", type: "P", at: "2026-11-15T10:00" };
    const pr1 = (pr: Pr) => planMessage(state, "A04", { ...f, pr: [pr] }, { PR1: true }).message.split("\r").filter((l) => l.startsWith("PR1|"));
    const plain = pr1(base);
    expect(plain.length).toBe(1);
    expect(pr1({ ...base, procType: "Major Surgical", dxCode: "K35.8", coverage: "Cash", status: "Pending" })).toEqual(plain);
  });
});
