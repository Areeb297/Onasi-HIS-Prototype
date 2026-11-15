/**
 * The rules every list in the app shares: search, filters, sorting, paging and CSV export. Pure functions, so the
 * same rules can be tested without a browser and every list behaves the same way.
 */

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export type CellValue = string | number | boolean | null | undefined;

/** One filter a list offers. `value` is always a string; a date range is stored as "from|to" (either side may be blank). */
export interface FilterDef<T> {
  id: string;
  label: string;
  kind?: "select" | "dateRange";
  /** Choices for a select filter. */
  options?: { value: string; label: string }[];
  /** True when the row passes the filter with this value. Not called for an empty value. */
  test: (row: T, value: string) => boolean;
  /** Shown in the toolbar as a quick select, not only in the Filters drawer. */
  quick?: boolean;
  /** Turned off until another filter has a value (for example Sub-Department needs a Department). */
  dependsOn?: string;
  /** Placeholder for an empty select, for example "All Departments". */
  allLabel?: string;
}

export type FilterValues = Record<string, string>;

/* ---------- search ---------- */

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Every word of the query must appear somewhere in the text. An empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(text);
  return words.every((w) => hay.includes(w));
}

/* ---------- filters ---------- */

export function splitRange(value: string): { from: string; to: string } {
  const [from = "", to = ""] = value.split("|");
  return { from, to };
}
export const joinRange = (from: string, to: string): string => (from || to ? `${from}|${to}` : "");

/** True when the day (YYYY-MM-DD or a full ISO time) falls inside the range. Blank sides are open. */
export function inRange(day: string | undefined, value: string): boolean {
  const { from, to } = splitRange(value);
  if (!from && !to) return true;
  if (!day) return false;
  const d = day.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
}

/** Only the filters that are set and known. */
export function activeFilters<T>(values: FilterValues, defs: FilterDef<T>[]): [FilterDef<T>, string][] {
  return defs.flatMap((d) => (values[d.id] ? [[d, values[d.id]] as [FilterDef<T>, string]] : []));
}

export function applyFilters<T>(rows: T[], values: FilterValues, defs: FilterDef<T>[]): T[] {
  const on = activeFilters(values, defs);
  if (!on.length) return rows;
  return rows.filter((r) => on.every(([d, v]) => d.test(r, v)));
}

const shortDay = (d: string) => {
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** The words on a filter chip, for example "Status: Pending" or "Date: 1 Nov 2026 to 15 Nov 2026". */
export function chipText<T>(def: FilterDef<T>, value: string): string {
  if (def.kind === "dateRange") {
    const { from, to } = splitRange(value);
    const words = from && to ? `${shortDay(from)} to ${shortDay(to)}` : from ? `From ${shortDay(from)}` : `Until ${shortDay(to)}`;
    return `${def.label}: ${words}`;
  }
  const opt = def.options?.find((o) => o.value === value);
  return `${def.label}: ${opt?.label ?? value}`;
}

/** Values to keep when one filter changes: a filter that depends on it is cleared. */
export function setFilter<T>(values: FilterValues, defs: FilterDef<T>[], id: string, value: string): FilterValues {
  const next: FilterValues = { ...values, [id]: value };
  if (!value) delete next[id];
  for (const d of defs) if (d.dependsOn === id && next[d.id]) delete next[d.id];
  return next;
}

/* ---------- sorting ---------- */

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const blank = (v: CellValue) => v === null || v === undefined || v === "";

/** Numbers by size, text in natural order (A2 before A10), true before false. Blanks always go last. */
export function compareValues(a: CellValue, b: CellValue): number {
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
  return collator.compare(String(a), String(b));
}

/** A stable sort. Blank values stay at the end in both directions, so a descending sort does not lead with empty rows. */
export function sortRows<T>(rows: T[], sort: SortState | null, value: (row: T, key: string) => CellValue): T[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: value(r, sort.key) }))
    .sort((x, y) => {
      if (blank(x.v) !== blank(y.v)) return blank(x.v) ? 1 : -1;
      return sign * compareValues(x.v, y.v) || x.i - y.i;
    })
    .map((x) => x.r);
}

/** Clicking a heading: ascending first, then descending, then back to the list's own order. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/* ---------- paging ---------- */

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface PageInfo<T> {
  rows: T[];
  /** One-based page, kept inside the pages that exist. */
  page: number;
  pages: number;
  /** One-based position of the first and last row shown; 0 when there are none. */
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(rows: T[], page: number, size: number): PageInfo<T> {
  const total = rows.length;
  const per = Math.max(1, Math.floor(size) || 25);
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * per;
  const slice = rows.slice(start, start + per);
  return { rows: slice, page: p, pages, from: total ? start + 1 : 0, to: start + slice.length, total };
}

export function rangeLabel(info: Pick<PageInfo<unknown>, "from" | "to" | "total">, unit: [string, string] = ["row", "rows"]): string {
  if (!info.total) return `No ${unit[1]}`;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return `Showing ${fmt(info.from)} to ${fmt(info.to)} of ${fmt(info.total)}`;
}

/** Page buttons to show: the first, the last, the current one and its neighbours, with null for a gap. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => keep.add(n));
  const list = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/* ---------- CSV ---------- */

/**
 * One CSV field. Quotes when needed, and a leading = + - @ (which a spreadsheet would run as a formula) is made plain
 * text with an apostrophe. Plain negative numbers stay numbers.
 */
export function csvField(v: CellValue): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: { header: string; value: (row: T) => CellValue }[], rows: T[]): string {
  const head = columns.map((c) => csvField(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvField(c.value(r))).join(","));
  return [head, ...body].join("\r\n");
}

/** A file name from a list title and today's date, for example "opd_worklist_2026-11-15.csv". */
export function csvFileName(title: string, today = new Date()): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "list";
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `${slug}_${d}.csv`;
}

/* ---------- selection ---------- */

/** Ticks or clears every id given, and leaves the others as they were. */
export function toggleAll(selected: ReadonlySet<string>, ids: string[]): Set<string> {
  const next = new Set(selected);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
  return next;
}
