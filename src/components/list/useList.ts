import * as React from "react";
import { downloadText } from "@/components/ui/code-block";
import { audit } from "@/lib/audit";
import { usePrefs, type Density } from "@/lib/prefs";
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
  density?: Density;
  hidden?: string[];
}

const storeKey = (id: string) => `onasi-list-v1:${id}`;
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
  density: Density;
  setDensity: (d: Density) => void;
  hidden: Set<string>;
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
  const prefs = usePrefs();
  const saved = React.useMemo(() => load(opts.id), [opts.id]);
  const [query, setQueryState] = React.useState("");
  const [filterValues, setFilterValues] = React.useState<FilterValues>(opts.initialFilters ?? {});
  const [sort, setSort] = React.useState<SortState | null>(opts.initialSort ?? null);
  const [pageNo, setPage] = React.useState(1);
  const [pageSize, setPageSizeState] = React.useState<number>(saved.pageSize ?? opts.pageSize ?? 25);
  const [density, setDensityState] = React.useState<Density>(saved.density ?? prefs.density);
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set(saved.hidden ?? opts.columns.filter((c) => c.defaultHidden).map((c) => c.id)));
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
    density,
    setDensity: (d) => { setDensityState(d); save(opts.id, { density: d }); },
    hidden,
    toggleColumn: (id) => setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id); else n.add(id);
      save(opts.id, { hidden: [...n] });
      return n;
    }),
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
