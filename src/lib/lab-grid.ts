import { INTERP_TEXT, LAB_CATALOG, expand, interpretValue, isAbnormal, isCritical, parseNumeric, rangeFor, refTextFor, testByCode, type Interp, type LabTest } from "./fhir/lab-catalog";
import type { LabOrder, ObsStatus } from "./fhir/types";
import { fmtDateTime } from "./format";
import type { Encounter, Patient } from "./model";

/**
 * The lab results grid of the chart, the way doctors read results in Epic: analytes as rows, collections as columns
 * with the newest first, over every visit of the patient. This file is the model only: it turns lab orders into the
 * grid, the category counts and the points of a trend graph. Flags come from the lab store (`interp`), not from here.
 *
 * It also holds the sample history (historyOrders): earlier visits with daily labs, so the grid and the trend have
 * something to show. Those orders are built here on each load and are never written to the lab store, so they do
 * not appear in the lab worklist, the orders list or NPHIES. Their visit numbers (V09xxxx) are not in the visit list.
 */

/* ---------- categories ---------- */

export type CategoryId = "electrolytes" | "metabolic" | "renal" | "haematology" | "special";
export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "electrolytes", label: "Chemistry / Electrolytes" },
  { id: "metabolic", label: "Metabolic Profile" },
  { id: "renal", label: "Renal Profile" },
  { id: "haematology", label: "Haematology" },
  { id: "special", label: "Special Tests" },
];

/** One category per analyte, so the counts add up to All. Our choice, to be confirmed with the laboratory. */
const BY_CODE: Record<string, CategoryId> = {
  "2951-2": "electrolytes", "2823-3": "electrolytes", "2075-0": "electrolytes", "17861-6": "electrolytes",
  "3094-0": "renal", "2160-0": "renal",
  "2345-7": "metabolic", "4548-4": "metabolic", "1751-7": "metabolic", "1742-6": "metabolic", "1920-8": "metabolic", "6768-6": "metabolic",
  "1975-2": "metabolic", "2093-3": "metabolic", "2571-8": "metabolic", "2085-9": "metabolic", "13457-7": "metabolic",
};
export const categoryOf = (t: Pick<LabTest, "code" | "dept">): CategoryId =>
  BY_CODE[t.code] ?? (t.dept === "HM" || t.dept === "CO" || t.dept === "BB" ? "haematology" : "special");

/* ---------- the grid ---------- */

export interface GridCell {
  /** The value as shown in the cell, without the unit. */
  value: string;
  /** The number, when the value is one. Text results have none and cannot be graphed. */
  n: number | null;
  interp: Interp;
  abnormal: boolean;
  critical: boolean;
  status: ObsStatus;
  /** When the specimen was collected. ISO. */
  collectedAt: string;
  /** When the result was reported. ISO. */
  at: string;
  orderId: string;
  visitNumber: string;
}

export interface GridColumn {
  /** The collection time to the minute. */
  key: string;
  at: string;
  visitNumber: string;
}

export interface GridRow {
  test: LabTest;
  category: CategoryId;
  cells: Record<string, GridCell>;
  /** The newest result of this analyte. */
  latest: GridCell;
}

export interface LabGrid {
  /** Newest first: the newest collection sits next to the analyte names. */
  columns: GridColumn[];
  /** In category order, then in catalogue order. */
  rows: GridRow[];
  counts: Record<CategoryId | "all", { rows: number; abnormal: boolean }>;
}

const CATALOG_INDEX = new Map(LAB_CATALOG.map((t, i) => [t.code, i]));
const CATEGORY_INDEX = new Map(CATEGORIES.map((c, i) => [c.id, i]));

/** Only released results are shown: an order that is resulted or amended. Cancelled results are left out. */
export function buildLabGrid(orders: LabOrder[], patientId: string): LabGrid {
  const columns = new Map<string, GridColumn>();
  const rows = new Map<string, GridRow>();
  for (const o of orders) {
    if (o.patientId !== patientId || (o.status !== "resulted" && o.status !== "amended")) continue;
    const collectedAt = o.specimens.map((s) => s.collectedAt).sort()[0] ?? o.orderedAt;
    const key = collectedAt.slice(0, 16);
    for (const t of expand(o.codes)) {
      const r = o.results[t.code];
      if (!r || r.status === "cancelled" || r.status === "entered-in-error") continue;
      const value = t.kind === "organism" ? (r.organism?.display ?? (r.value || "No growth")) : r.value.trim();
      const cell: GridCell = {
        value, n: t.kind === "organism" ? null : (parseNumeric(value)?.n ?? null), interp: r.interp, abnormal: isAbnormal(r.interp), critical: isCritical(r.interp),
        status: r.status, collectedAt, at: r.at, orderId: o.id, visitNumber: o.visitNumber,
      };
      if (!columns.has(key)) columns.set(key, { key, at: collectedAt, visitNumber: o.visitNumber });
      const row = rows.get(t.code) ?? { test: t, category: categoryOf(t), cells: {}, latest: cell };
      // Two results of one analyte from the same collection: the one reported last stands.
      if (!row.cells[key] || row.cells[key].at <= cell.at) row.cells[key] = cell;
      rows.set(t.code, row);
    }
  }
  const cols = [...columns.values()].sort((a, b) => b.at.localeCompare(a.at));
  const list = [...rows.values()].sort((a, b) =>
    (CATEGORY_INDEX.get(a.category)! - CATEGORY_INDEX.get(b.category)!) || (CATALOG_INDEX.get(a.test.code)! - CATALOG_INDEX.get(b.test.code)!));
  for (const row of list) row.latest = row.cells[cols.find((c) => row.cells[c.key])!.key];
  const counts = { all: { rows: list.length, abnormal: list.some((r) => r.latest.abnormal) } } as LabGrid["counts"];
  for (const c of CATEGORIES) {
    const mine = list.filter((r) => r.category === c.id);
    counts[c.id] = { rows: mine.length, abnormal: mine.some((r) => r.latest.abnormal) };
  }
  return { columns: cols, rows: list, counts };
}

export const rowsIn = (grid: LabGrid, category: CategoryId | "all"): GridRow[] => (category === "all" ? grid.rows : grid.rows.filter((r) => r.category === category));

const localYmd = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Date search: the newest collection on or before the day asked for (YYYY-MM-DD), else the oldest one. -1 when there are none. */
export function columnForDate(columns: GridColumn[], ymd: string): number {
  if (!columns.length || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return -1;
  const i = columns.findIndex((c) => localYmd(c.at) <= ymd);
  return i === -1 ? columns.length - 1 : i;
}

/** What hovering a cell says: the exact collection time, the status and the flag. */
export function cellTitle(test: LabTest, cell: GridCell, sex: "M" | "F"): string {
  const status = cell.status[0].toUpperCase() + cell.status.slice(1);
  return `${test.short} ${cell.value}. Collected ${fmtDateTime(cell.collectedAt)}. ${status}. ${INTERP_TEXT[cell.interp]}. Reference: ${refTextFor(test, sex)}`;
}

/* ---------- trend ---------- */

export interface TrendPoint {
  at: string;
  n: number;
  value: string;
  abnormal: boolean;
  critical: boolean;
  visitNumber: string;
}

export interface Trend {
  /** Oldest first. Only results that are numbers. */
  points: TrendPoint[];
  /** The reference range for this patient, when the catalogue has one. */
  low?: number;
  high?: number;
}

export function trendOf(row: GridRow, columns: GridColumn[], sex: "M" | "F"): Trend {
  const points = [...columns].reverse().flatMap((c): TrendPoint[] => {
    const cell = row.cells[c.key];
    return cell && cell.n !== null ? [{ at: cell.collectedAt, n: cell.n, value: cell.value, abnormal: cell.abnormal, critical: cell.critical, visitNumber: cell.visitNumber }] : [];
  });
  return { points, ...rangeFor(row.test, sex) };
}

const CLASS_LABEL: Record<string, string> = { I: "Inpatient", O: "Outpatient", E: "Emergency" };

/** "Inpatient", "Outpatient" or "Emergency" for a visit number, from the visit list or the sample history. */
export const visitKind = (visitNumber: string, encounters: Pick<Encounter, "visitNumber" | "cls">[]): string =>
  CLASS_LABEL[encounters.find((e) => e.visitNumber === visitNumber)?.cls ?? HISTORY_CLASS[visitNumber] ?? ""] ?? "";

/* ---------- sample history ---------- */

const NA = "2951-2", K = "2823-3", CL = "2075-0", BUN = "3094-0", CR = "2160-0", GLU = "2345-7", HB = "718-7", WBC = "6690-2", PLT = "777-3", CRP = "1988-5",
  A1C = "4548-4", TROP = "10839-9", CHOL = "2093-3", LDL = "13457-7", TSH = "3016-3", ALT = "1742-6";

/** Decimal places the laboratory reports for an analyte. Whole numbers when not listed. */
const DECIMALS: Record<string, number> = { [K]: 1, [CR]: 1, [HB]: 1, [WBC]: 1, [A1C]: 1, [TSH]: 1, [TROP]: 2 };

type Values = Record<string, number>;
interface History {
  patientId: string;
  /** An earlier admission: one collection a day at 06:00, oldest first. `endedDaysAgo` is the day of the last one. */
  stay: { visit: string; endedDaysAgo: number; series: Record<string, number[]> };
  /** Earlier clinic visits, one collection each. */
  clinic: { visit: string; daysAgo: number; values: Values }[];
  /** Released results of the visit that is open now, by hours ago. */
  current: { hoursAgo: number; values: Values }[];
}

const HISTORY: History[] = [
  { // Chest infection with a kidney injury that settled.
    patientId: "P001",
    stay: { visit: "V090412", endedDaysAgo: 41, series: {
      [NA]: [131, 132, 134, 135, 137, 138, 139, 139], [K]: [6.6, 5.8, 5.2, 4.8, 4.5, 4.3, 4.1, 4.0], [CL]: [96, 97, 99, 100, 101, 102, 103, 103],
      [BUN]: [38, 35, 30, 26, 22, 19, 17, 16], [CR]: [2.1, 1.9, 1.7, 1.5, 1.3, 1.2, 1.1, 1.0], [GLU]: [148, 132, 121, 110, 104, 98, 95, 92],
      [HB]: [11.8, 11.5, 11.2, 11.4, 11.6, 11.9, 12.1, 12.4], [WBC]: [18.4, 17.1, 15.2, 13.0, 11.6, 10.2, 9.1, 8.4], [PLT]: [462, 455, 430, 410, 385, 360, 342, 330],
      [CRP]: [184, 160, 121, 84, 52, 31, 18, 9],
    } },
    clinic: [
      { visit: "V090198", daysAgo: 96, values: { [NA]: 140, [K]: 4.3, [CL]: 102, [BUN]: 15, [CR]: 0.9, [GLU]: 96, [HB]: 13.6, [WBC]: 7.2, [PLT]: 250, [A1C]: 5.4 } },
      { visit: "V090077", daysAgo: 188, values: { [NA]: 141, [K]: 4.1, [CR]: 0.9, [GLU]: 101, [HB]: 13.9, [WBC]: 6.8, [PLT]: 262, [CHOL]: 214, [LDL]: 138, [TSH]: 2.1, [ALT]: 31 } },
    ],
    current: [
      { hoursAgo: 26, values: { [NA]: 136, [K]: 4.4, [CL]: 101, [BUN]: 18, [CR]: 1.0, [GLU]: 112, [HB]: 13.1, [WBC]: 15.8, [PLT]: 310, [CRP]: 96 } },
      { hoursAgo: 4, values: { [NA]: 137, [K]: 4.1, [CR]: 0.9, [GLU]: 104, [HB]: 12.9, [WBC]: 13.9, [PLT]: 322, [CRP]: 74 } },
    ],
  },
  { // Diabetic ketoacidosis, then poor control in clinic.
    patientId: "P002",
    stay: { visit: "V090365", endedDaysAgo: 63, series: {
      [NA]: [129, 132, 135, 137, 138, 139, 139], [K]: [5.9, 4.8, 3.4, 3.3, 3.8, 4.1, 4.2], [CL]: [94, 98, 101, 103, 104, 104, 103],
      [BUN]: [32, 28, 22, 18, 16, 15, 14], [CR]: [1.6, 1.4, 1.2, 1.0, 0.9, 0.9, 0.8], [GLU]: [486, 340, 262, 214, 188, 162, 148],
      [HB]: [14.8, 14.1, 13.6, 13.4, 13.5, 13.6, 13.8], [WBC]: [14.2, 12.8, 11.4, 10.1, 9.2, 8.6, 8.0], [PLT]: [298, 290, 284, 276, 270, 268, 265],
    } },
    clinic: [
      { visit: "V090301", daysAgo: 30, values: { [GLU]: 212, [A1C]: 9.8, [CR]: 0.8, [K]: 4.4, [CHOL]: 228, [LDL]: 146 } },
      { visit: "V090119", daysAgo: 150, values: { [GLU]: 236, [A1C]: 10.4, [CR]: 0.9, [NA]: 138, [K]: 4.5, [ALT]: 44 } },
    ],
    current: [{ hoursAgo: 12, values: { [NA]: 134, [K]: 4.6, [CL]: 99, [BUN]: 21, [CR]: 1.0, [GLU]: 318, [HB]: 13.9, [WBC]: 9.4, [PLT]: 270 } }],
  },
  { // Heart attack with a dangerous potassium on arrival.
    patientId: "P003",
    stay: { visit: "V090288", endedDaysAgo: 120, series: {
      [NA]: [138, 137, 138, 139, 140, 140], [K]: [6.7, 5.6, 4.9, 4.5, 4.3, 4.2], [CL]: [101, 101, 102, 103, 103, 104],
      [BUN]: [28, 26, 23, 21, 19, 18], [CR]: [1.5, 1.4, 1.3, 1.2, 1.2, 1.1], [GLU]: [164, 142, 128, 118, 110, 106],
      [HB]: [10.4, 10.1, 9.8, 10.0, 10.3, 10.6], [WBC]: [12.6, 11.9, 10.8, 9.6, 8.8, 8.1], [PLT]: [210, 204, 198, 205, 214, 220],
      [TROP]: [0.62, 0.48, 0.21, 0.09, 0.05, 0.03],
    } },
    clinic: [{ visit: "V090154", daysAgo: 210, values: { [NA]: 139, [K]: 4.6, [CR]: 1.2, [GLU]: 118, [HB]: 11.2, [CHOL]: 246, [LDL]: 168, [A1C]: 6.3 } }],
    current: [{ hoursAgo: 8, values: { [NA]: 139, [K]: 4.8, [CR]: 1.3, [GLU]: 134, [HB]: 10.9, [WBC]: 10.4, [PLT]: 232, [TROP]: 0.31 } }],
  },
];

const HISTORY_CLASS: Record<string, string> = Object.fromEntries(HISTORY.flatMap((h) => [[h.stay.visit, "I"], ...h.clinic.map((c) => [c.visit, "O"])]));

const HOUR = 3_600_000;
let memo: { key: string; orders: LabOrder[] } | null = null;

/**
 * The sample history as released lab orders. Times are counted back from the start of the hour, and flags use the
 * same rule as the lab store (interpretValue). The result is kept for the hour, so the columns do not move while a
 * chart is open. A patient with no open visit gets the earlier visits only.
 */
export function historyOrders(patients: Pick<Patient, "id" | "sex">[], encounters: Pick<Encounter, "visitNumber" | "patientId" | "status">[], now: number = Date.now()): LabOrder[] {
  const hour = Math.floor(now / HOUR) * HOUR;
  const key = `${hour}:${patients.length}:${encounters.length}`;
  if (memo?.key === key) return memo.orders;
  const sixAm = new Date(now);
  sixAm.setHours(6, 0, 0, 0); // daily samples are drawn at 06:00
  const orders: LabOrder[] = [];
  let n = 0;
  const add = (patientId: string, sex: "M" | "F", visitNumber: string, at: number, values: Values) => {
    const collectedAt = new Date(at).toISOString();
    const reported = new Date(at + 2 * HOUR).toISOString();
    const codes = Object.keys(values).sort((a, b) => CATALOG_INDEX.get(a)! - CATALOG_INDEX.get(b)!);
    const id = `LH-${String(++n).padStart(4, "0")}`;
    orders.push({
      id, visitNumber, patientId, codes, priority: "routine", fasting: null, note: "", orderedAt: collectedAt, orderedById: "D1001", status: "resulted",
      specimens: [{ id: `SP-${id}`, key: "SER", collectedAt, collectedBy: "Faisal Alqahtani, MLT" }], orderDirty: false, resultDirty: false, sends: [],
      results: Object.fromEntries(codes.map((code) => {
        const value = values[code].toFixed(DECIMALS[code] ?? 0);
        return [code, { code, value, interp: interpretValue(testByCode(code)!, value, sex), status: "final" as const, at: reported }];
      })),
    });
  };
  for (const h of HISTORY) {
    const sex = patients.find((p) => p.id === h.patientId)?.sex;
    if (!sex) continue;
    const days = Object.values(h.stay.series)[0].length;
    for (let d = 0; d < days; d++) {
      const values = Object.fromEntries(Object.entries(h.stay.series).map(([code, s]) => [code, s[d]]));
      add(h.patientId, sex, h.stay.visit, sixAm.getTime() - (h.stay.endedDaysAgo + days - 1 - d) * 24 * HOUR, values);
    }
    for (const c of h.clinic) add(h.patientId, sex, c.visit, sixAm.getTime() - c.daysAgo * 24 * HOUR + 4 * HOUR, c.values);
    const open = encounters.find((e) => e.patientId === h.patientId && e.status === "active");
    if (open) for (const c of h.current) add(h.patientId, sex, open.visitNumber, hour - c.hoursAgo * HOUR, c.values);
  }
  memo = { key, orders };
  return orders;
}
