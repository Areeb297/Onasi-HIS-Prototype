import { describe, expect, it } from "vitest";
import { testByCode, type Interp } from "./fhir/lab-catalog";
import type { LabOrder } from "./fhir/types";
import { CATEGORIES, buildLabGrid, categoryOf, cellTitle, columnForDate, historyOrders, rowsIn, trendOf, visitKind } from "./lab-grid";

const NA = "2951-2", K = "2823-3", CR = "2160-0", HB = "718-7", UCX = "630-4", GLU = "2345-7";

let seq = 0;
function order(at: string, results: Record<string, [string, Interp]>, extra: Partial<LabOrder> = {}): LabOrder {
  const id = `T-${++seq}`;
  return {
    id, visitNumber: "V1", patientId: "P1", codes: Object.keys(results), priority: "routine", fasting: null, note: "", orderedAt: at, orderedById: "D1001",
    status: "resulted", specimens: [{ id: `SP-${id}`, key: "SER", collectedAt: at, collectedBy: "x" }], orderDirty: false, resultDirty: false, sends: [],
    results: Object.fromEntries(Object.entries(results).map(([code, [value, interp]]) => [code, { code, value, interp, status: "final" as const, at }])),
    ...extra,
  };
}

const ORDERS = [
  order("2026-11-10T03:00:00.000Z", { [HB]: ["11.2", "L"], [K]: ["6.7", "HH"], [NA]: ["138", "N"] }),
  order("2026-11-12T03:00:00.000Z", { [K]: ["4.4", "N"], [CR]: ["1.9", "H"] }),
  order("2026-06-01T07:00:00.000Z", { [K]: ["4.1", "N"], [UCX]: ["", "POS"] }, { visitNumber: "V0" }),
  order("2026-11-13T03:00:00.000Z", { [K]: ["9.9", "HH"] }, { status: "in-progress" }), // not released
  order("2026-11-13T03:00:00.000Z", { [K]: ["3.0", "L"] }, { patientId: "P2" }), // another patient
];

describe("lab grid", () => {
  const grid = buildLabGrid(ORDERS, "P1");

  it("pivots released results: collections as columns, newest first, over every visit", () => {
    expect(grid.columns.map((c) => c.at.slice(0, 10))).toEqual(["2026-11-12", "2026-11-10", "2026-06-01"]);
    expect(grid.columns.map((c) => c.visitNumber)).toEqual(["V1", "V1", "V0"]);
    const k = grid.rows.find((r) => r.test.code === K)!;
    expect(grid.columns.map((c) => k.cells[c.key]?.value)).toEqual(["4.4", "6.7", "4.1"]);
    expect(k.latest.value).toBe("4.4");
    const na = grid.rows.find((r) => r.test.code === NA)!;
    expect(grid.columns.map((c) => na.cells[c.key]?.value)).toEqual([undefined, "138", undefined]);
  });

  it("orders the rows by category, then by the catalogue", () => {
    expect(grid.rows.map((r) => r.test.short)).toEqual(["Sodium", "Potassium", "Creatinine", "Hemoglobin", "Urine Culture"]);
    expect(grid.rows.map((r) => r.category)).toEqual(["electrolytes", "electrolytes", "renal", "haematology", "special"]);
    expect(categoryOf(testByCode(GLU)!)).toBe("metabolic");
    expect(categoryOf(testByCode("6301-6")!)).toBe("haematology"); // INR, by its laboratory section
  });

  it("takes the flags from the stored result and leaves cancelled results out", () => {
    const k = grid.rows.find((r) => r.test.code === K)!;
    expect(k.cells[grid.columns[1].key]).toMatchObject({ abnormal: true, critical: true, n: 6.7 });
    expect(k.cells[grid.columns[0].key]).toMatchObject({ abnormal: false, critical: false });
    const culture = grid.rows.find((r) => r.test.code === UCX)!;
    expect(culture.latest).toMatchObject({ value: "No growth", n: null, abnormal: true });
    const cancelled = order("2026-11-14T03:00:00.000Z", { [K]: ["5.9", "H"] });
    cancelled.results[K].status = "cancelled";
    expect(buildLabGrid([...ORDERS, cancelled], "P1").columns).toHaveLength(3);
    expect(cellTitle(k.test, k.cells[grid.columns[1].key], "M")).toMatch(/Potassium 6\.7\. Collected .*Final\. Critical High\. Reference: 3\.5 - 5\.1 mmol\/L/);
  });

  it("counts analytes per category and marks a category whose newest result is abnormal", () => {
    expect(grid.counts.all).toEqual({ rows: 5, abnormal: true });
    expect(grid.counts.electrolytes).toEqual({ rows: 2, abnormal: false }); // the critical potassium is not the newest one
    expect(grid.counts.renal).toEqual({ rows: 1, abnormal: true });
    expect(grid.counts.metabolic).toEqual({ rows: 0, abnormal: false });
    expect(CATEGORIES.reduce((n, c) => n + grid.counts[c.id].rows, 0)).toBe(grid.counts.all.rows);
    expect(rowsIn(grid, "renal").map((r) => r.test.short)).toEqual(["Creatinine"]);
    expect(rowsIn(grid, "all")).toHaveLength(5);
  });

  it("finds the column for a date and builds the trend oldest first", () => {
    expect(columnForDate(grid.columns, "2026-11-11")).toBe(1);
    expect(columnForDate(grid.columns, "2027-01-01")).toBe(0);
    expect(columnForDate(grid.columns, "2020-01-01")).toBe(2);
    expect(columnForDate(grid.columns, "")).toBe(-1);
    const trend = trendOf(grid.rows.find((r) => r.test.code === K)!, grid.columns, "M");
    expect(trend.points.map((p) => p.n)).toEqual([4.1, 6.7, 4.4]);
    expect(trend.points.map((p) => p.visitNumber)).toEqual(["V0", "V1", "V1"]);
    expect(trend).toMatchObject({ low: 3.5, high: 5.1 });
    expect(trendOf(grid.rows.find((r) => r.test.code === UCX)!, grid.columns, "M").points).toHaveLength(0);
    expect(trendOf(grid.rows.find((r) => r.test.code === HB)!, grid.columns, "F")).toMatchObject({ low: 12, high: 15.5 });
  });
});

describe("sample history", () => {
  const now = new Date(2026, 10, 15, 10, 30).getTime();
  const patients = [{ id: "P001", sex: "M" as const }, { id: "P003", sex: "F" as const }];
  const encounters = [{ visitNumber: "V100001", patientId: "P001", status: "active" as const, cls: "I" as const }];
  const orders = historyOrders(patients, encounters, now);

  it("gives a daily inpatient series, earlier clinic visits and the open visit", () => {
    const grid = buildLabGrid(orders, "P001");
    expect(new Set(grid.columns.map((c) => c.visitNumber)).size).toBe(4);
    expect(grid.columns[0].visitNumber).toBe("V100001");
    expect(grid.columns.filter((c) => c.visitNumber === "V090412")).toHaveLength(8);
    expect(grid.rows.map((r) => r.test.short)).toEqual(expect.arrayContaining(["Sodium", "Potassium", "Chloride", "BUN", "Creatinine", "Glucose", "Hemoglobin", "WBC", "Platelets"]));
    const k = trendOf(grid.rows.find((r) => r.test.code === K)!, grid.columns, "M");
    expect(k.points.some((p) => p.critical)).toBe(true);
    expect(visitKind("V090412", encounters)).toBe("Inpatient");
    expect(visitKind("V100001", encounters)).toBe("Inpatient");
    expect(visitKind("V090198", encounters)).toBe("Outpatient");
  });

  it("skips patients it does not know and gives no open-visit results without an open visit", () => {
    expect(orders.some((o) => o.patientId === "P002")).toBe(false);
    expect(orders.filter((o) => o.patientId === "P003").every((o) => o.visitNumber.startsWith("V09"))).toBe(true);
    expect(orders.every((o) => o.status === "resulted" && Object.values(o.results).every((r) => r.status === "final"))).toBe(true);
  });
});
