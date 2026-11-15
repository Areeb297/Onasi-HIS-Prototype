import { describe, expect, it } from "vitest";
import { bool, mono, more, num, pick, text } from "@/lib/masters/helpers";
import { rowProblems } from "@/lib/masters/helpers";
import type { MasterDef } from "@/lib/schema";
import { fmtDate, fmtDateTime, fmtTime, toDate } from "./format";
import {
  activeFilters, applyFilters, chipText, compareValues, csvField, csvFileName, inRange, joinRange, matchesQuery, nextSort, pageWindow, paginate,
  rangeLabel, setFilter, sortRows, splitRange, toCsv, toggleAll, type FilterDef,
} from "./list-logic";
import { fieldErrors, formSections, isDirty } from "./master-form";

interface P { id: string; name: string; ward: string; age: number | null; day: string }
const rows: P[] = [
  { id: "1", name: "Saad Almutairi", ward: "3A", age: 58, day: "2026-11-10" },
  { id: "2", name: "Layla Alanazi", ward: "3B", age: 42, day: "2026-11-14" },
  { id: "3", name: "Bader Alyami", ward: "3A", age: null, day: "2026-11-15" },
  { id: "4", name: "Noura Alzahrani", ward: "ICU", age: 7, day: "" },
];
const defs: FilterDef<P>[] = [
  { id: "ward", label: "Ward", options: [{ value: "3A", label: "Ward 3A" }, { value: "3B", label: "Ward 3B" }], test: (r, v) => r.ward === v },
  { id: "bed", label: "Bed", dependsOn: "ward", test: () => true },
  { id: "day", label: "Date", kind: "dateRange", test: (r, v) => inRange(r.day, v) },
];

describe("search", () => {
  it("needs every word, in any order, ignoring case", () => {
    expect(matchesQuery("Saad Almutairi MRN0000101", "almutairi saad")).toBe(true);
    expect(matchesQuery("Saad Almutairi", "saad layla")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("filters", () => {
  it("keeps rows that pass every filter that is set", () => {
    expect(applyFilters(rows, { ward: "3A" }, defs).map((r) => r.id)).toEqual(["1", "3"]);
    expect(applyFilters(rows, { ward: "3A", day: "2026-11-12|" }, defs).map((r) => r.id)).toEqual(["3"]);
    expect(applyFilters(rows, {}, defs)).toBe(rows);
  });
  it("treats a date range as inclusive with open sides, and a blank day as outside", () => {
    expect(inRange("2026-11-14T09:00", "2026-11-14|2026-11-14")).toBe(true);
    expect(inRange("2026-11-15", "|2026-11-14")).toBe(false);
    expect(inRange("", "2026-11-01|")).toBe(false);
    expect(inRange("", "")).toBe(true);
    expect(splitRange(joinRange("2026-11-01", ""))).toEqual({ from: "2026-11-01", to: "" });
    expect(joinRange("", "")).toBe("");
  });
  it("clears a filter that depends on one that changed, and drops empty values", () => {
    expect(setFilter({ ward: "3A", bed: "12" }, defs, "ward", "3B")).toEqual({ ward: "3B" });
    expect(setFilter({ ward: "3A" }, defs, "ward", "")).toEqual({});
  });
  it("words each chip with the option label", () => {
    expect(chipText(defs[0], "3B")).toBe("Ward: Ward 3B");
    expect(chipText(defs[2], "2026-11-01|2026-11-15")).toBe("Date: 1 Nov 2026 to 15 Nov 2026");
    expect(chipText(defs[2], "|2026-11-15")).toBe("Date: Until 15 Nov 2026");
    expect(activeFilters({ ward: "3A", other: "x" }, defs).map(([d]) => d.id)).toEqual(["ward"]);
  });
});

describe("sorting", () => {
  const by = (r: P, k: string) => (k === "age" ? r.age : k === "name" ? r.name : r.day);
  it("sorts numbers by size and keeps blanks last in both directions", () => {
    expect(sortRows(rows, { key: "age", dir: "asc" }, by).map((r) => r.id)).toEqual(["4", "2", "1", "3"]);
    expect(sortRows(rows, { key: "age", dir: "desc" }, by).map((r) => r.id)).toEqual(["1", "2", "4", "3"]);
    expect(sortRows(rows, { key: "day", dir: "desc" }, by).map((r) => r.id)).toEqual(["3", "2", "1", "4"]);
  });
  it("sorts text in natural order and is stable", () => {
    expect(["Bed 10", "Bed 2", "bed 1"].sort(compareValues)).toEqual(["bed 1", "Bed 2", "Bed 10"]);
    const same = [{ k: "a", n: 1 }, { k: "a", n: 2 }, { k: "a", n: 3 }];
    expect(sortRows(same, { key: "k", dir: "desc" }, (r) => r.k).map((r) => r.n)).toEqual([1, 2, 3]);
    expect(sortRows(rows, null, by)).toBe(rows);
  });
  it("cycles a heading through ascending, descending and off", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toBeNull();
    expect(nextSort({ key: "name", dir: "desc" }, "age")).toEqual({ key: "age", dir: "asc" });
  });
});

describe("paging", () => {
  const many = Array.from({ length: 214 }, (_, i) => i);
  it("slices a page and says what is shown", () => {
    const p = paginate(many, 1, 25);
    expect(p.rows).toHaveLength(25);
    expect(rangeLabel(p)).toBe("Showing 1 to 25 of 214");
    const last = paginate(many, 9, 25);
    expect([last.from, last.to, last.rows.length]).toEqual([201, 214, 14]);
  });
  it("keeps the page inside the pages that exist", () => {
    expect(paginate(many, 99, 25).page).toBe(9);
    expect(paginate(many, 0, 25).page).toBe(1);
    const none = paginate([], 3, 25);
    expect([none.page, none.pages, none.from, none.to]).toEqual([1, 1, 0, 0]);
    expect(rangeLabel(none, ["patient", "patients"])).toBe("No patients");
    expect(rangeLabel(paginate(Array.from({ length: 1500 }, (_, i) => i), 2, 100))).toBe("Showing 101 to 200 of 1,500");
  });
  it("shows the first, last and nearby page buttons with gaps", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvField('Alharbi, "Khalid"')).toBe('"Alharbi, ""Khalid"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(true)).toBe("Yes");
    expect(csvField(1250.5)).toBe("1250.5");
  });
  it("makes formulas plain text so a spreadsheet does not run them", () => {
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvField("+966 50 000 0000")).toBe("'+966 50 000 0000");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("-1+1")).toBe("'-1+1");
    expect(csvField("\tcmd")).toBe("'\tcmd");
    expect(csvField("\rcmd")).toBe("\"'\rcmd\"");
    // Plain negative figures stay numbers.
    expect(csvField(-120)).toBe("-120");
    expect(csvField("-120.50")).toBe("-120.50");
  });
  it("writes a header row and one line per row", () => {
    const csv = toCsv([{ header: "Name", value: (r: P) => r.name }, { header: "Age", value: (r: P) => r.age }], rows.slice(0, 3));
    expect(csv.split("\r\n")).toEqual(["Name,Age", "Saad Almutairi,58", "Layla Alanazi,42", "Bader Alyami,"]);
  });
  it("names the file after the list and the day", () => {
    expect(csvFileName("OPD Worklist", new Date(2026, 10, 5))).toBe("opd_worklist_2026-11-05.csv");
  });
});

describe("selection", () => {
  it("ticks every id on the page, and clears them when all are ticked", () => {
    const one = toggleAll(new Set(["x"]), ["1", "2"]);
    expect([...one].sort()).toEqual(["1", "2", "x"]);
    expect([...toggleAll(one, ["1", "2"])]).toEqual(["x"]);
  });
});

describe("dates", () => {
  it("writes dates and a 24-hour clock", () => {
    expect(fmtDate("2026-11-05")).toBe("5 Nov 2026");
    expect(fmtTime("2026-11-05T15:08")).toBe("15:08");
    expect(fmtDateTime("2026-11-05T00:30")).toBe("5 Nov 2026, 00:30");
    expect(toDate("")).toBeNull();
    expect(fmtDate("not a date")).toBe("");
  });
});

describe("setup form", () => {
  const def: MasterDef = {
    id: "t", title: "Clinic", module: "Client Setup",
    columns: [
      mono("code", "Code", true), text("name", "Clinic", true), pick("department", "Department", ["Medicine"], true), num("rooms", "Rooms"),
      text("phone", "Phone"), bool("active", "Active"), ...more(text("email", "Email"), text("note", "Note"), pick("gender", "Gender", ["Male", "Female"])),
    ],
    seed: [{ code: "CL-FM", name: "Family Medicine Clinic" }, { code: "CL-IM", name: "Internal Medicine Clinic" }],
  };
  it("groups fields into sections and leaves out empty ones", () => {
    const s = formSections(def);
    expect(s.map((x) => x.title)).toEqual(["Main Details", "Personal Details", "Contact And Address", "More Details", "Status"]);
    expect(s[0].columns.map((c) => c.key)).toEqual(["code", "name", "department", "rooms"]);
    expect(s[2].columns.map((c) => c.key)).toEqual(["phone", "email"]);
    expect(formSections({ columns: def.columns.slice(0, 3) })).toHaveLength(1);
  });
  it("puts each problem under its field, by the same rules as the save check", () => {
    const row = { code: "cl-fm", name: "", rooms: -2 };
    const errs = fieldErrors(def, row, def.seed, null, true);
    expect(Object.keys(errs).sort()).toEqual(["code", "department", "name", "rooms"]);
    expect(Object.values(errs).sort()).toEqual([...rowProblems(def, row, def.seed, null)].sort());
    expect(fieldErrors(def, row, def.seed, null, false).name).toBeUndefined();
    expect(fieldErrors(def, { code: "CL-FM" }, def.seed, 0, false)).toEqual({});
  });
  it("knows when the form has changes", () => {
    expect(isDirty({ code: "A" }, { code: "A", name: "" })).toBe(false);
    expect(isDirty({ active: true }, { active: false })).toBe(true);
    expect(isDirty({}, { active: false })).toBe(false);
    expect(isDirty({ rooms: 0 }, { rooms: 0 })).toBe(false);
  });
});
