import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Ellipsis, SearchX, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, Td, Th, cn } from "@/components/ui/primitives";
import { PAGE_SIZES, pageWindow, rangeLabel } from "./list-logic";
import { BRAND_BUTTON } from "./ListPage";
import type { Column, ListApi } from "./useList";

/**
 * The shared data table: sticky header, sortable headings, right-aligned numbers, clickable rows, a row action bar
 * (the two most used actions as buttons, the rest under More), bulk selection with a floating selection bar, paging,
 * skeleton rows, an empty state and a no-results state. Below the md breakpoint each row becomes a card.
 */

export interface RowAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Tooltip: why the action is turned off, or what it does. */
  title?: string;
  danger?: boolean;
  /** The step most likely to come next: shown as a labelled Dark Green button instead of an icon. */
  emphasis?: boolean;
  /** A small amber dot, for example when changes are not sent yet. */
  dot?: boolean;
  /** Draws a line above this item in the More menu. */
  separate?: boolean;
}

export interface BulkAction<T> {
  label: string;
  icon?: React.ReactNode;
  onClick: (rows: T[]) => void;
  disabled?: boolean;
  title?: string;
}

export interface EmptySpec {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: { label: string; icon?: React.ReactNode; onClick: () => void; disabled?: boolean };
}

export interface CardSpec {
  title: React.ReactNode;
  /** Top right of the card, usually the status badge. */
  aside?: React.ReactNode;
  /** Up to two short secondary lines. */
  lines?: React.ReactNode[];
}

/** Clicks on buttons, links and fields inside a row do their own job and do not open the row. */
const fromControl = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("button, a, input, select, textarea, label, [role=menuitem], [role=menu], [data-row-ignore]");

export function DataTable<T>({
  list, label, onRowClick, rowLabel, actions, inline = 2, selectable, bulk, loading, empty, card, expanded, rowClassName, maxHeight,
}: {
  list: ListApi<T>;
  /** Names the table for screen readers, for example "OPD visits". */
  label: string;
  onRowClick?: (row: T) => void;
  /** How a row is named in button labels, for example the patient name. */
  rowLabel?: (row: T) => string;
  actions?: (row: T) => RowAction[];
  /** How many actions sit on the row before the More menu. */
  inline?: number;
  selectable?: boolean;
  bulk?: BulkAction<T>[];
  loading?: boolean;
  /** Shown when the list has no rows at all (not when filters hide them). */
  empty: EmptySpec;
  card?: (row: T) => CardSpec;
  /** A full-width panel under the row, for example the message text. */
  expanded?: (row: T) => React.ReactNode | null;
  rowClassName?: (row: T) => string | undefined;
  /** Height of the scrolling table area. Defaults to most of the screen. */
  maxHeight?: string;
}) {
  const { page, visibleColumns: cols } = list;
  const name = (r: T) => rowLabel?.(r) ?? list.getId(r);
  const pageIds = page.rows.map(list.getId);
  const pageSelected = pageIds.filter((id) => list.selected.has(id)).length;
  const head = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (head.current) head.current.indeterminate = pageSelected > 0 && pageSelected < pageIds.length;
  }, [pageSelected, pageIds.length]);

  const noRowsAtAll = list.rows.length === 0;
  const noResults = !noRowsAtAll && list.sorted.length === 0;
  const span = cols.length + (selectable ? 1 : 0) + (actions ? 1 : 0);
  const open = (r: T) => onRowClick?.(r);

  return (
    <div data-density={list.density} className="relative">
      <section aria-label={label} className="glass-panel overflow-hidden rounded-2xl">
        {!loading && (noRowsAtAll || noResults) ? (
          noRowsAtAll ? <EmptyBlock spec={empty} /> : (
            <EmptyBlock spec={{
              icon: <SearchX className="size-6" aria-hidden="true" />,
              title: "No Results For These Filters",
              text: `No ${list.unit[1]} match the search and filters you chose. Change them, or clear them to see all ${list.rows.length.toLocaleString("en-US")}.`,
              action: { label: "Clear Filters", icon: <X className="size-4" aria-hidden="true" />, onClick: list.clearFilters },
            }} />
          )
        ) : (
          <>
            {/* Phone: one card per row. */}
            <ul className="divide-y divide-border/70 md:hidden" aria-label={label}>
              {loading && Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="space-y-2 px-4 py-4" aria-hidden="true"><Bar w="w-2/3" /><Bar w="w-1/2" /><Bar w="w-1/3" /></li>
              ))}
              {!loading && page.rows.map((r) => {
                const id = list.getId(r);
                const spec = card ? card(r) : defaultCard(r, cols);
                const more = expanded?.(r);
                const sel = list.selected.has(id);
                return (
                  <li key={id}
                    className={cn("px-4 py-3.5", onRowClick && "cursor-pointer active:bg-muted/60", sel && "bg-[#39edd5]/10 shadow-[inset_3px_0_0_#032c26] dark:shadow-[inset_3px_0_0_#39edd5]", rowClassName?.(r))}
                    onClick={(e) => { if (onRowClick && !fromControl(e.target)) open(r); }}>
                    <div className="flex items-start gap-3">
                      {selectable && <RowCheck checked={sel} onChange={() => list.toggleRow(id)} label={`Select ${name(r)}`} className="mt-0.5" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 font-semibold text-foreground">{spec.title}</div>
                          {spec.aside && <div className="shrink-0">{spec.aside}</div>}
                        </div>
                        {spec.lines?.filter(Boolean).slice(0, 2).map((l, i) => <div key={i} className="mt-1 min-w-0 text-[0.8125rem] text-muted-foreground">{l}</div>)}
                        {actions && <RowActionBar actions={actions(r)} inline={inline} name={name(r)} labelled className="mt-3" />}
                      </div>
                    </div>
                    {more && <div className="mt-3 min-w-0">{more}</div>}
                  </li>
                );
              })}
            </ul>

            {/* Tablet and desktop: the table. The header stays put while the rows scroll. */}
            <div className="hidden overflow-auto md:block" style={{ maxHeight: maxHeight ?? "max(30rem, calc(100dvh - 12rem))" }}>
              <table className="w-full border-separate border-spacing-0 text-sm" aria-label={label} aria-busy={loading || undefined}>
                <thead>
                  <tr>
                    {selectable && (
                      <Th className={cn(HEAD, "w-10 pe-0")}>
                        <RowCheck ref={head} checked={pageIds.length > 0 && pageSelected === pageIds.length} onChange={list.togglePage} label="Select every row on this page" />
                      </Th>
                    )}
                    {cols.map((c) => <HeadCell key={c.id} col={c} list={list} />)}
                    {actions && <Th className={cn(HEAD, "text-right")}><span className="sr-only">Actions</span></Th>}
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      {Array.from({ length: span }, (_, j) => <Td key={j} className={CELL}><Bar w={j === 0 ? "w-3/4" : j % 2 ? "w-1/2" : "w-2/3"} /></Td>)}
                    </tr>
                  ))}
                  {!loading && page.rows.map((r) => {
                    const id = list.getId(r);
                    const sel = list.selected.has(id);
                    const more = expanded?.(r);
                    return (
                      <React.Fragment key={id}>
                        <tr
                          tabIndex={onRowClick ? 0 : undefined}
                          aria-selected={selectable ? sel : undefined}
                          onClick={(e) => { if (onRowClick && !fromControl(e.target)) open(r); }}
                          onKeyDown={(e) => { if (onRowClick && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(r); } }}
                          className={cn(
                            "group transition-colors hover:bg-[#39edd5]/[0.07] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                            onRowClick && "cursor-pointer",
                            sel && "bg-[#39edd5]/[0.12] hover:bg-[#39edd5]/[0.16] [&>td:first-child]:shadow-[inset_3px_0_0_#032c26] dark:[&>td:first-child]:shadow-[inset_3px_0_0_#39edd5]",
                            rowClassName?.(r),
                          )}
                        >
                          {selectable && <Td className={cn(CELL, "w-10 pe-0")}><RowCheck checked={sel} onChange={() => list.toggleRow(id)} label={`Select ${name(r)}`} /></Td>}
                          {cols.map((c) => <Td key={c.id} numeric={c.numeric} className={cn(CELL, c.className)}>{c.cell(r)}</Td>)}
                          {actions && <Td className={cn(CELL, "w-px whitespace-nowrap text-right")}><RowActionBar actions={actions(r)} inline={inline} name={name(r)} className="justify-end" /></Td>}
                        </tr>
                        {more && <tr><Td colSpan={span} className={cn(CELL, "bg-muted/30")}>{more}</Td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager list={list} />
          </>
        )}
      </section>

      {selectable && list.selectedRows.length > 0 && <SelectionBar list={list} bulk={bulk ?? []} />}
    </div>
  );
}

const HEAD = "sticky top-0 z-10 border-b border-border bg-[color:var(--glass-solid)] py-2.5 text-[0.75rem] font-semibold text-muted-foreground";
const CELL = "border-b border-border/60 group-last:border-b-0";

function HeadCell<T>({ col, list }: { col: Column<T>; list: ListApi<T> }) {
  const sortable = col.sortable !== false && !!col.value;
  const on = list.sort?.key === col.id ? list.sort.dir : null;
  if (!sortable) return <Th numeric={col.numeric} className={cn(HEAD, col.headerClassName)}>{col.header}</Th>;
  const Icon = on === "asc" ? ArrowUp : on === "desc" ? ArrowDown : ArrowUpDown;
  const nextWord = on === "asc" ? "descending" : on === "desc" ? "in the list order" : "ascending";
  // Same look as Th, written out so the heading can carry aria-sort.
  return (
    <th scope="col" aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : "none"}
      className={cn(HEAD, "border-b border-border p-0 whitespace-nowrap", col.numeric ? "text-right" : "text-left", col.headerClassName)}>
      <button type="button" onClick={() => list.toggleSort(col.id)} title={`Sort ${nextWord}`}
        className={cn("group/sort inline-flex w-full items-center gap-1.5 px-3 py-2.5 text-[0.75rem] font-semibold whitespace-nowrap hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          col.numeric && "flex-row-reverse", on && "text-[#032c26] dark:text-foreground")}>
        {col.header}
        <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", on ? "text-[#03c1ac]" : "text-muted-foreground/50 opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100")} strokeWidth={2.25} />
      </button>
    </th>
  );
}

const RowCheck = React.forwardRef<HTMLInputElement, { checked: boolean; onChange: () => void; label: string; className?: string }>(
  ({ checked, onChange, label, className }, ref) => (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label}
      className={cn("size-4 cursor-pointer rounded accent-[#032c26] dark:accent-[#39edd5]", className)} />
  ),
);
RowCheck.displayName = "RowCheck";

function Bar({ w }: { w: string }) {
  return <span className={cn("block h-3 animate-pulse rounded-full bg-muted", w)} />;
}

function defaultCard<T>(r: T, cols: Column<T>[]): CardSpec {
  const [first, ...rest] = cols;
  return {
    title: first?.cell(r),
    lines: rest.slice(0, 2).map((c) => <span key={c.id}><span className="text-muted-foreground">{c.header}: </span><span className="text-foreground">{c.cell(r)}</span></span>),
  };
}

/** The action buttons of one row: the first ones as buttons, the rest in a More menu. */
export function RowActionBar({ actions, inline = 2, name, labelled, className }: { actions: RowAction[]; inline?: number; name: string; labelled?: boolean; className?: string }) {
  if (!actions.length) return null;
  const shown = actions.slice(0, inline);
  const rest = actions.slice(inline);
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((a) =>
        a.emphasis || labelled ? (
          <Button key={a.id} size="sm" variant={a.emphasis ? "primary" : "secondary"} className={cn("relative", a.emphasis && BRAND_BUTTON, a.danger && !a.emphasis && "text-destructive")}
            disabled={a.disabled} title={a.title ?? a.label} aria-label={`${a.label}, ${name}`} onClick={a.onClick}>
            <span className="flex [&_svg]:size-4 [&_svg]:!text-current" aria-hidden="true">{a.icon}</span>
            {a.label}
            {a.dot && <Dot />}
          </Button>
        ) : (
          <button key={a.id} type="button" onClick={a.onClick} disabled={a.disabled} title={a.title ?? a.label} aria-label={`${a.label}, ${name}`}
            className={cn("relative flex size-8 items-center justify-center rounded-lg text-[#035d53] transition-colors hover:bg-[#39edd5]/15 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#39edd5] [&_svg]:size-[1.05rem] [&_svg]:!text-current",
              a.danger && "text-destructive hover:bg-destructive/10 dark:text-destructive")}>
            {a.icon}
            {a.dot && <Dot />}
          </button>
        ),
      )}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`More actions, ${name}`} title="More Actions"
              className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted">
              <Ellipsis className="size-[1.05rem]" aria-hidden="true" />
              {rest.some((a) => a.dot) && <Dot />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {rest.map((a, i) => (
              <React.Fragment key={a.id}>
                {a.separate && i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={a.onClick} disabled={a.disabled} title={a.title} variant={a.danger ? "destructive" : "default"} className="gap-3 py-2">
                  <span className="flex [&_svg]:size-4" aria-hidden="true">{a.icon}</span>
                  <span className="flex-1">{a.label}</span>
                  {a.dot && <span className="size-2 rounded-full bg-warn" aria-label="Changes not sent" />}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Dot() {
  return <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warn ring-2 ring-[color:var(--glass-solid)]" aria-label="Changes not sent" />;
}

export function EmptyBlock({ spec, className }: { spec: EmptySpec; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <span className="glass-icon flex size-12 items-center justify-center rounded-2xl [&_svg]:size-6" aria-hidden="true">{spec.icon}</span>
      <h2 className="mt-4 text-base font-semibold text-[#032c26] dark:text-foreground">{spec.title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{spec.text}</p>
      {spec.action && (
        <Button className={cn("mt-5", BRAND_BUTTON)} variant="primary" onClick={spec.action.onClick} disabled={spec.action.disabled}>
          {spec.action.icon}
          {spec.action.label}
        </Button>
      )}
    </div>
  );
}

function Pager<T>({ list }: { list: ListApi<T> }) {
  const { page } = list;
  const id = React.useId();
  const btn = "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[0.8125rem] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 px-4 py-2.5 text-[0.8125rem]">
      <p className="tabular-nums text-muted-foreground" aria-live="polite">{rangeLabel(page, list.unit)}</p>
      {page.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-0.5">
          <button type="button" className={cn(btn, "hover:bg-muted")} onClick={() => list.setPage(page.page - 1)} disabled={page.page <= 1} aria-label="Previous page">
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <span className="px-2 tabular-nums text-muted-foreground sm:hidden">Page {page.page} of {page.pages}</span>
          {pageWindow(page.page, page.pages).map((n, i) =>
            n === null ? <span key={`g${i}`} className="hidden px-1 text-muted-foreground sm:inline" aria-hidden="true">…</span> : (
              <button key={n} type="button" onClick={() => list.setPage(n)} aria-current={n === page.page ? "page" : undefined} aria-label={`Page ${n}`}
                className={cn(btn, "hidden sm:flex", n === page.page ? "bg-[#032c26] text-white dark:bg-[#39edd5] dark:text-[#032c26]" : "hover:bg-muted")}>
                {n}
              </button>
            ),
          )}
          <button type="button" className={cn(btn, "hover:bg-muted")} onClick={() => list.setPage(page.page + 1)} disabled={page.page >= page.pages} aria-label="Next page">
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </nav>
      )}
      <span className="flex items-center gap-2">
        <label htmlFor={id} className="text-muted-foreground">Rows Per Page</label>
        <select id={id} value={list.pageSize} onChange={(e) => list.setPageSize(Number(e.target.value))}
          className="h-8 rounded-lg border border-border bg-card pl-2 pr-7 text-[0.8125rem] tabular-nums focus-visible:outline-2 focus-visible:outline-ring dark:[color-scheme:dark]">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </span>
    </div>
  );
}

function SelectionBar<T>({ list, bulk }: { list: ListApi<T>; bulk: BulkAction<T>[] }) {
  const n = list.selectedRows.length;
  const pill = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#39edd5] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4";
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-3 flex justify-center px-2">
      <div role="region" aria-label="Selected rows"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl bg-[#032c26] px-3 py-2 text-white shadow-[0_18px_40px_-16px_rgba(3,44,38,0.7)] ring-1 ring-white/10">
        <span className="flex items-center gap-2 pe-2 text-[0.8125rem]">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#39edd5] px-1.5 text-xs font-bold tabular-nums text-[#032c26]">{n}</span>
          Selected
        </span>
        <span className="h-5 w-px bg-white/20" aria-hidden="true" />
        {bulk.map((b) => (
          <button key={b.label} type="button" className={cn(pill, "bg-[#39edd5] text-[#032c26] hover:bg-[#52fce3]")} onClick={() => b.onClick(list.selectedRows)} disabled={b.disabled} title={b.title}>
            {b.icon}{b.label}
          </button>
        ))}
        <button type="button" className={cn(pill, "text-white hover:bg-white/10")} onClick={() => list.exportCsv(list.selectedRows)}>
          <Download aria-hidden="true" />Export Selected
        </button>
        <button type="button" className={cn(pill, "text-white/80 hover:bg-white/10 hover:text-white")} onClick={list.clearSelection} aria-label="Clear selection" title="Clear Selection">
          <X aria-hidden="true" /><span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}
