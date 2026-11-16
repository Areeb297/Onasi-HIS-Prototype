import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Download, Ellipsis, EyeOff, MoveHorizontal, SearchX, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, Td, Th, cn } from "@/components/ui/primitives";
import { PAGE_SIZES, pageWindow, rangeLabel } from "./list-logic";
import { BRAND_BUTTON } from "./ListPage";
import { ActionIcon, deleteQuestion, useConfirm, type ConfirmSpec } from "@/components/ui/action-icons";
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
  /** A destructive action asks first with this question (rowAction("delete") sets it). False: the caller asks itself. */
  confirm?: false | Partial<Omit<ConfirmSpec, "run">>;
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
  list, label, onRowClick, rowLabel, actions, inline = 1, selectable, bulk, loading, empty, card, expanded, rowClassName, maxHeight,
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
  const gridId = React.useId();

  /** Arrow keys move between cells like a spreadsheet; Home and End go to the first and last cell of the row. */
  const onGridKey = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const cell = e.target instanceof HTMLElement && e.target.matches("td[data-cell]") ? e.target : null;
    if (!cell) return;
    const row = cell.parentElement as HTMLTableRowElement;
    const ci = Number(cell.dataset.cell);
    const rows = [...e.currentTarget.querySelectorAll<HTMLTableRowElement>("tr[data-row]")];
    const ri = rows.indexOf(row);
    const cellsOf = (tr: HTMLTableRowElement | undefined) => (tr ? [...tr.querySelectorAll<HTMLElement>("td[data-cell]")] : []);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = cellsOf(rows[ri + 1])[ci];
    else if (e.key === "ArrowUp") next = cellsOf(rows[ri - 1])[ci];
    else if (e.key === "ArrowRight") next = cellsOf(row)[ci + 1];
    else if (e.key === "ArrowLeft") next = cellsOf(row)[ci - 1];
    else if (e.key === "Home") next = cellsOf(row)[0];
    else if (e.key === "End") next = cellsOf(row).at(-1);
    else return;
    e.preventDefault();
    if (next) { cell.tabIndex = -1; next.tabIndex = 0; next.focus(); }
  };

  return (
    // Compact rows are about 34px (6px padding around 14px text), comfortable about 46px.
    <div data-list-density={list.density} className="relative" style={{ ["--row-py" as string]: list.density === "compact" ? "0.375rem" : "0.75rem" }}>
      <section aria-label={label} className={cn(GRID_VARS, "overflow-hidden rounded-xl border border-[color:var(--grid-line)] bg-[color:var(--grid-bg)] shadow-[0_1px_2px_rgba(16,24,22,0.04),0_8px_24px_-16px_rgba(16,24,22,0.18)]")}>
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

            {/* Tablet and desktop: a spreadsheet-style grid. Sticky header row and first column, fine cell lines,
                zebra rows, arrow keys move between cells and Enter opens the row. */}
            <div className="hidden overflow-auto md:block" style={{ maxHeight: maxHeight ?? "max(30rem, calc(100dvh - 12rem))" }}>
              <table className="w-full border-separate border-spacing-0 text-sm" aria-label={label} aria-busy={loading || undefined}
                aria-describedby={onRowClick ? `${gridId}-keys` : undefined}>
                <thead>
                  <tr>
                    {selectable && (
                      <Th className={cn(HEAD, "left-0 z-30 w-10 min-w-10 px-0 text-center")}>
                        <RowCheck ref={head} checked={pageIds.length > 0 && pageSelected === pageIds.length} onChange={list.togglePage} label="Select every row on this page" />
                      </Th>
                    )}
                    {cols.map((c, i) => <HeadCell key={c.id} col={c} list={list} pinned={i === 0} left={selectable ? 40 : 0} />)}
                    {actions && <Th className={cn(HEAD, "w-px text-right")}><span className="sr-only">Actions</span></Th>}
                  </tr>
                </thead>
                <tbody onKeyDown={onGridKey}>
                  {loading && Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      {Array.from({ length: span }, (_, j) => <Td key={j} className={CELL}><Bar w={j === 0 ? "w-3/4" : j % 2 ? "w-1/2" : "w-2/3"} /></Td>)}
                    </tr>
                  ))}
                  {!loading && page.rows.map((r, ri) => {
                    const id = list.getId(r);
                    const sel = list.selected.has(id);
                    const more = expanded?.(r);
                    const bg = sel ? SELECTED_BG : ROW_BG;
                    return (
                      <React.Fragment key={id}>
                        <tr
                          data-row={ri}
                          aria-selected={selectable ? sel : undefined}
                          onClick={(e) => { if (onRowClick && !fromControl(e.target)) open(r); }}
                          className={cn("group", onRowClick && "cursor-pointer", rowClassName?.(r))}
                        >
                          {selectable && (
                            <Td className={cn(CELL, bg, "sticky left-0 z-[5] w-10 min-w-10 px-0 text-center", sel && "shadow-[inset_3px_0_0_#032c26] dark:shadow-[inset_3px_0_0_#39edd5]")}>
                              <RowCheck checked={sel} onChange={() => list.toggleRow(id)} label={`Select ${name(r)}`} />
                            </Td>
                          )}
                          {cols.map((c, ci) => (
                            <td key={c.id} tabIndex={ri === 0 && ci === 0 ? 0 : -1} data-cell={ci} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget && onRowClick) { e.preventDefault(); open(r); } }}
                              className={cn(CELL, bg, "px-3 py-[var(--row-py)] align-middle text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                                c.numeric && "text-right tabular-nums",
                                ci === 0 && "sticky z-[5] shadow-[1px_0_0_var(--grid-line)]",
                                ci === 0 && !selectable && sel && "shadow-[inset_3px_0_0_#032c26,1px_0_0_var(--grid-line)]",
                                c.className)}
                              style={ci === 0 ? { left: selectable ? 40 : 0 } : undefined}>
                              {c.cell(r)}
                            </td>
                          ))}
                          {actions && <Td className={cn(CELL, bg, "w-px whitespace-nowrap py-0 text-right")}><RowActionBar actions={actions(r)} inline={inline} name={name(r)} reveal className="justify-end" /></Td>}
                        </tr>
                        {more && <tr><Td colSpan={span} className={cn(CELL, "bg-muted/40")}>{more}</Td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {onRowClick && <p id={`${gridId}-keys`} className="sr-only">Use the arrow keys to move between cells. Press Enter to open the row.</p>}
            </div>
            <Pager list={list} />
          </>
        )}
      </section>

      {selectable && list.selectedRows.length > 0 && <SelectionBar list={list} bulk={bulk ?? []} />}
    </div>
  );
}

/* Grid look: crisp white with fine neutral lines, no blur inside the grid. Backgrounds sit on the cells, not the row,
   so the sticky first column stays opaque while the grid scrolls sideways. */
const HEAD = "sticky top-0 z-20 h-8 border-b border-r border-[color:var(--grid-line)] bg-[color:var(--grid-head)] px-3 py-0 text-[0.75rem] font-semibold text-muted-foreground last:border-r-0";
const CELL = "border-b border-r border-[color:var(--grid-line)] last:border-r-0 group-last:border-b-0";
const ROW_BG = "bg-[color:var(--grid-bg)] group-even:bg-[color:var(--grid-zebra)] group-hover:bg-[color:var(--grid-hover)]";
const SELECTED_BG = "bg-[color:var(--grid-selected)] group-hover:bg-[color:var(--grid-selected)]";
/** Grid colours for light and dark. Neutral greys, no green tint; cyan only for hover and selection. */
const GRID_VARS = "[--grid-bg:#ffffff] [--grid-zebra:#f8f9f9] [--grid-hover:#eefbf9] [--grid-selected:#e2f8f5] [--grid-head:#f3f5f4] [--grid-line:#e3e8e6] dark:[--grid-bg:#0b1c18] dark:[--grid-zebra:#0e211c] dark:[--grid-hover:#11302a] dark:[--grid-selected:#123a33] dark:[--grid-head:#0f241f] dark:[--grid-line:#1f3a33]";

function HeadCell<T>({ col, list, pinned, left }: { col: Column<T>; list: ListApi<T>; pinned: boolean; left: number }) {
  const sortable = col.sortable !== false && !!col.value;
  const on = list.sort?.key === col.id ? list.sort.dir : null;
  const width = list.widths[col.id];
  const Icon = on === "asc" ? ArrowUp : on === "desc" ? ArrowDown : ArrowUpDown;
  const nextWord = on === "asc" ? "descending" : on === "desc" ? "in the list order" : "ascending";
  const hideable = col.hideable !== false;
  const thRef = React.useRef<HTMLTableCellElement>(null);

  // Drag the right edge of a heading to make the column wider or narrower. The width is remembered for this list.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = thRef.current?.getBoundingClientRect().width ?? 120;
    const move = (ev: PointerEvent) => list.setWidth(col.id, startW + ev.clientX - startX);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    // Written out rather than Th so the heading can carry aria-sort, a width and the sticky left offset.
    <th ref={thRef} scope="col" aria-sort={sortable ? (on === "asc" ? "ascending" : on === "desc" ? "descending" : "none") : undefined}
      className={cn(HEAD, "group/head whitespace-nowrap", col.numeric ? "text-right" : "text-left", pinned && "z-30", col.headerClassName)}
      style={{ ...(width ? { width, minWidth: width, maxWidth: width } : {}), ...(pinned ? { left } : {}) }}>
      <div className={cn("flex h-8 items-center gap-1", col.numeric && "flex-row-reverse")}>
        {sortable ? (
          <button type="button" onClick={() => list.toggleSort(col.id)} title={`Sort ${nextWord}`}
            className={cn("inline-flex min-w-0 items-center gap-1.5 truncate rounded-sm font-semibold hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              col.numeric && "flex-row-reverse", on && "text-[#032c26] dark:text-foreground")}>
            <span className="truncate">{col.header}</span>
            <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", on ? "text-[#03c1ac]" : "text-muted-foreground/50 opacity-0 group-hover/head:opacity-100")} strokeWidth={2.25} />
          </button>
        ) : <span className="truncate">{col.header}</span>}
        {(sortable || hideable) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Column menu, ${col.header}`} title="Column Options"
                className={cn("ms-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-black/5 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/head:opacity-100 data-[state=open]:opacity-100 dark:hover:bg-white/10",
                  col.numeric && "ms-0 me-auto")}>
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={col.numeric ? "end" : "start"} className="min-w-44">
              {sortable && <>
                <DropdownMenuItem onClick={() => list.setSort({ key: col.id, dir: "asc" })} className="gap-2.5"><ArrowUp />Sort Ascending</DropdownMenuItem>
                <DropdownMenuItem onClick={() => list.setSort({ key: col.id, dir: "desc" })} className="gap-2.5"><ArrowDown />Sort Descending</DropdownMenuItem>
                {on && <DropdownMenuItem onClick={() => list.setSort(null)} className="gap-2.5"><X />Clear Sort</DropdownMenuItem>}
              </>}
              {width && <DropdownMenuItem onClick={() => list.setWidth(col.id, 0)} className="gap-2.5"><MoveHorizontal />Reset Width</DropdownMenuItem>}
              {hideable && <>
                {sortable && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => list.toggleColumn(col.id)} className="gap-2.5"><EyeOff />Hide Column</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <span role="separator" aria-orientation="vertical" aria-hidden="true" onPointerDown={startResize} onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-[#03c1ac]" />
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

/**
 * The action buttons of one row, always on one line: the first ones as buttons, the rest in a More menu (the 21st.dev
 * data table pattern). With `reveal`, the quiet icon buttons appear on row hover or focus on a desktop with a mouse; on a
 * touch screen they always show. A labelled next-step button always shows.
 */
export function RowActionBar({ actions, inline = 1, name, labelled, reveal, className }: { actions: RowAction[]; inline?: number; name: string; labelled?: boolean; reveal?: boolean; className?: string }) {
  const [ask, dialog] = useConfirm();
  if (!actions.length) return null;
  const shown = actions.slice(0, inline);
  const rest = actions.slice(inline);
  const quiet = reveal && "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 transition-opacity";
  // Destructive actions with a question ask first, from the row button and from the More menu alike.
  const run = (a: RowAction) => () => {
    if (a.danger && a.confirm) ask({ ...deleteQuestion(a.label, name), ...a.confirm, run: a.onClick });
    else a.onClick();
  };
  return (
    <div className={cn("flex flex-nowrap items-center gap-0.5", labelled && "flex-wrap gap-1.5", className)}>
      {shown.map((a) =>
        a.emphasis || labelled ? (
          <Button key={a.id} size="sm" variant={a.emphasis ? "primary" : a.danger ? "danger" : "secondary"} className={cn("relative", !labelled && "h-7 px-2.5 text-[0.8125rem]", a.emphasis && BRAND_BUTTON)}
            disabled={a.disabled} title={a.title ?? a.label} aria-label={`${a.label}, ${name}`} onClick={run(a)}>
            <span className="flex [&_svg]:size-3.5 [&_svg]:!text-current" aria-hidden="true">{a.icon}</span>
            {a.label}
            {a.dot && <Dot />}
          </Button>
        ) : (
          <ActionIcon key={a.id} label={a.label} icon={a.icon} name={name} hint={a.title && a.title !== a.label ? a.title : undefined}
            danger={a.danger} confirm={false} dot={a.dot} disabled={a.disabled} onClick={run(a)} className={cn(quiet || undefined)} />
        ),
      )}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`More actions, ${name}`} title="More Actions"
              className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted", labelled && "size-8 border border-border", quiet)}>
              <Ellipsis className="size-4" aria-hidden="true" />
              {rest.some((a) => a.dot) && <Dot />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {rest.map((a, i) => (
              <React.Fragment key={a.id}>
                {a.separate && i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={run(a)} disabled={a.disabled} title={a.title} variant={a.danger ? "destructive" : "default"} className="gap-3 py-2">
                  <span className="flex [&_svg]:size-4" aria-hidden="true">{a.icon}</span>
                  <span className="flex-1">{a.label}</span>
                  {a.dot && <span className="size-2 rounded-full bg-warn" aria-label="Changes not sent" />}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {dialog}
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

/**
 * A second line in a cell (a sub-department, a condition). Shown in the comfortable density and hidden in compact, so a
 * compact row stays one line high. Keep anything a user needs to tell rows apart on the first line.
 */
export function CellSub({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-xs text-muted-foreground in-data-[list-density=compact]:hidden", className)}>{children}</div>;
}
