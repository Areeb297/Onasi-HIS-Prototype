import * as React from "react";
import { downloadText } from "@/components/ui/code-block";
import { audit } from "@/lib/audit";
import type { Density } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import {
  activeFilters, applyFilters, csvFileName, matchesQuery, nextSort, paginate, setFilter as setFilterValue, sortRows, toCsv, toggleAll,
  type CellValue, type FilterDef, type FilterValues, type PageInfo, type SortState,
} from "./list-logic";

/** One column of a list. `value` makes it sortable and is what the CSV export writes. */
export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  value?: (row: T) => CellValue;
  /** Set false to keep a column with a value from being sorted. */
  sortable?: boolean;
  /** What the CSV writes, when it differs from `value`. Return undefined for an empty field. */
  csv?: (row: T) => CellValue;
  /** Right-aligned with tabular figures, heading included. */
  numeric?: boolean;
  /** False keeps the column out of the column chooser (always shown). */
  hideable?: boolean;
  defaultHidden?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface ListOptions<T> {
  /** Saves page size, density and hidden columns under this name. */
  id: string;
  /** Used for the CSV file name and the audit entry. */
  title: string;
  rows: T[];
  columns: Column<T>[];
  getId: (row: T) => string;
  /** The text the search box looks in. */
  search?: (row: T) => string;
  filters?: FilterDef<T>[];
  initialFilters?: FilterValues;
  initialSort?: SortState | null;
  pageSize?: number;
  /** What one row is, for counts: ["patient", "patients"]. */
  unit?: [string, string];
}

interface Saved {
  pageSize?: number;
  hidden?: string[];
  widths?: Record<string, number>;
}

const storeKey = (id: string) => `onasi-list-v1:${id}`;
/** Row density is one choice per user, for every list. Compact is the default. */
const densityKey = (user: string) => `onasi-list-density-v1:${user}`;
function loadDensity(user: string): Density {
  try {
    return localStorage.getItem(densityKey(user)) === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}
const densityListeners = new Set<() => void>();
function saveDensity(user: string, d: Density) {
  try {
    localStorage.setItem(densityKey(user), d);
  } catch {
    /* storage can be blocked */
  }
  densityListeners.forEach((l) => l());
}
function load(id: string): Saved {
  try {
    const raw = localStorage.getItem(storeKey(id));
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}
function save(id: string, patch: Saved) {
  try {
    localStorage.setItem(storeKey(id), JSON.stringify({ ...load(id), ...patch }));
  } catch {
    /* storage can be blocked */
  }
}

export interface ListApi<T> extends ListOptions<T> {
  query: string;
  setQuery: (q: string) => void;
  filterValues: FilterValues;
  setFilter: (id: string, value: string) => void;
  clearFilters: () => void;
  /** Filters set plus the search box. */
  activeCount: number;
  /** Rows after search and filters, sorted. */
  sorted: T[];
  page: PageInfo<T>;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  sort: SortState | null;
  toggleSort: (key: string) => void;
  setSort: (s: SortState | null) => void;
  density: Density;
  setDensity: (d: Density) => void;
  hidden: Set<string>;
  /** Column widths the user dragged, in pixels. */
  widths: Record<string, number>;
  setWidth: (id: string, px: number) => void;
  toggleColumn: (id: string) => void;
  visibleColumns: Column<T>[];
  selected: Set<string>;
  toggleRow: (id: string) => void;
  togglePage: () => void;
  clearSelection: () => void;
  /** Selected rows that are still in the filtered list. */
  selectedRows: T[];
  exportCsv: (rows?: T[]) => void;
  unit: [string, string];
}

/** State and derived rows for a list: search, filters, sort, paging, density, columns, selection and export. */
export function useList<T>(opts: ListOptions<T>): ListApi<T> {
  const user = useSession().user.id;
  const saved = React.useMemo(() => load(opts.id), [opts.id]);
  const density = React.useSyncExternalStore(
    (cb) => { densityListeners.add(cb); return () => { densityListeners.delete(cb); }; },
    () => loadDensity(user),
    () => "compact" as Density,
  );
  const [query, setQueryState] = React.useState("");
  const [filterValues, setFilterValues] = React.useState<FilterValues>(opts.initialFilters ?? {});
  const [sort, setSort] = React.useState<SortState | null>(opts.initialSort ?? null);
  const [pageNo, setPage] = React.useState(1);
  const [pageSize, setPageSizeState] = React.useState<number>(saved.pageSize ?? opts.pageSize ?? 25);
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set(saved.hidden ?? opts.columns.filter((c) => c.defaultHidden).map((c) => c.id)));
  const [widths, setWidths] = React.useState<Record<string, number>>(saved.widths ?? {});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const defs = opts.filters ?? [];
  const searched = opts.search && query.trim() ? opts.rows.filter((r) => matchesQuery(opts.search!(r), query)) : opts.rows;
  const filtered = applyFilters(searched, filterValues, defs);
  const colValue = (r: T, key: string) => opts.columns.find((c) => c.id === key)?.value?.(r);
  const sorted = sortRows(filtered, sort, colValue);
  const page = paginate(sorted, pageNo, pageSize);
  const ids = new Set(sorted.map(opts.getId));
  const selectedRows = sorted.filter((r) => selected.has(opts.getId(r)));
  const visibleColumns = opts.columns.filter((c) => c.hideable === false || !hidden.has(c.id));

  return {
    ...opts,
    unit: opts.unit ?? ["row", "rows"],
    query,
    setQuery: (q) => { setQueryState(q); setPage(1); },
    filterValues,
    setFilter: (id, value) => { setFilterValues((v) => setFilterValue(v, defs, id, value)); setPage(1); },
    clearFilters: () => { setFilterValues({}); setQueryState(""); setPage(1); },
    activeCount: activeFilters(filterValues, defs).length + (query.trim() ? 1 : 0),
    sorted,
    page,
    setPage,
    pageSize,
    setPageSize: (n) => { setPageSizeState(n); setPage(1); save(opts.id, { pageSize: n }); },
    sort,
    toggleSort: (key) => { setSort((s) => nextSort(s, key)); setPage(1); },
    setSort: (next) => { setSort(next); setPage(1); },
    density,
    setDensity: (d) => saveDensity(user, d),
    hidden,
    toggleColumn: (id) => setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id); else n.add(id);
      save(opts.id, { hidden: [...n] });
      return n;
    }),
    widths,
    setWidth: (id, px) => setWidths((w) => { const n = { ...w, [id]: Math.round(Math.min(640, Math.max(64, px))) }; if (!px) delete n[id]; save(opts.id, { widths: n }); return n; }),
    visibleColumns,
    selected: new Set([...selected].filter((id) => ids.has(id))),
    toggleRow: (id) => setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    }),
    togglePage: () => setSelected((s) => toggleAll(s, page.rows.map(opts.getId))),
    clearSelection: () => setSelected(new Set()),
    selectedRows,
    exportCsv: (rows) => {
      const list = rows ?? sorted;
      const cols = visibleColumns.filter((c) => c.csv || c.value).map((c) => ({ header: c.header, value: (r: T) => (c.csv ?? c.value)!(r) }));
      downloadText(csvFileName(opts.title), toCsv(cols, list));
      audit("export", opts.title, { detail: `${list.length} ${list.length === 1 ? (opts.unit ?? ["row"])[0] : (opts.unit ?? ["row", "rows"])[1]} to CSV` });
    },
  };
}
