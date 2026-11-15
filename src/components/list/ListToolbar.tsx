import * as React from "react";
import { Columns3, Download, ListFilter, Rows2, Rows3, Search, X } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { activeFilters, chipText, joinRange, splitRange, type FilterDef } from "./list-logic";
import { BRAND_BUTTON } from "./ListPage";
import type { ListApi } from "./useList";

/**
 * The bar above a list: search with a clear button, quick filters, a Filters drawer for the rest, and on the right the
 * column chooser, the density switch and CSV export. Active filters show underneath as chips with a remove button.
 */
export function ListToolbar<T>({ list, placeholder = "Search", children, exportable = true, chooser = true }: {
  list: ListApi<T>;
  placeholder?: string;
  /** Extra controls after the filters. */
  children?: React.ReactNode;
  exportable?: boolean;
  chooser?: boolean;
}) {
  const [drawer, setDrawer] = React.useState(false);
  const defs = list.filters ?? [];
  const on = activeFilters(list.filterValues, defs);
  const quick = defs.filter((d) => d.quick && d.kind !== "dateRange");
  const hideable = list.columns.filter((c) => c.hideable !== false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="glass-card mb-3 rounded-2xl px-3 py-2.5 sm:px-3.5" role="search" aria-label={`Search and filter ${list.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-full sm:basis-60 sm:max-w-sm">
          <span className="sr-only">Search {list.title}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={list.query}
            onChange={(e) => list.setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && list.query) { e.preventDefault(); list.setQuery(""); } }}
            placeholder={placeholder}
            className="h-9 rounded-full border-[color:var(--glass-border)] bg-white/80 pl-9 pr-9 shadow-none dark:bg-background"
          />
          {list.query && (
            <button type="button" onClick={() => { list.setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </label>

        {quick.map((d) => (
          <QuickSelect key={d.id} def={d} value={list.filterValues[d.id] ?? ""} disabled={!!d.dependsOn && !list.filterValues[d.dependsOn]} onChange={(v) => list.setFilter(d.id, v)} />
        ))}

        {defs.length > 0 && (
          <Button size="sm" className="h-9 rounded-full" onClick={() => setDrawer(true)} aria-haspopup="dialog">
            <ListFilter className="size-4" aria-hidden="true" />
            Filters
            {on.length > 0 && <span className="ms-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-[#032c26] px-1.5 text-xs font-semibold leading-5 text-white dark:bg-[#39edd5] dark:text-[#032c26]">{on.length}</span>}
          </Button>
        )}
        {children}

        <div className="ms-auto flex items-center gap-1.5">
          <span className="me-1 hidden text-xs tabular-nums text-muted-foreground sm:inline" aria-live="polite">
            {list.sorted.length.toLocaleString("en-US")} {list.sorted.length === 1 ? list.unit[0] : list.unit[1]}
          </span>
          <DensitySwitch value={list.density} onChange={list.setDensity} />
          {chooser && hideable.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="hidden h-9 md:inline-flex" aria-label="Choose columns" title="Choose Columns">
                  <Columns3 className="size-4" aria-hidden="true" /><span className="hidden xl:inline">Columns</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Show Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideable.map((c) => {
                  const shown = !list.hidden.has(c.id);
                  const last = shown && hideable.filter((x) => !list.hidden.has(x.id)).length === 1;
                  return (
                    <DropdownMenuCheckboxItem key={c.id} checked={shown} disabled={last} onSelect={(e) => e.preventDefault()} onCheckedChange={() => list.toggleColumn(c.id)}>
                      {c.header}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {exportable && (
            <Button size="sm" variant="ghost" className="h-9" onClick={() => list.exportCsv()} disabled={list.sorted.length === 0} title="Export the rows shown to a CSV file">
              <Download className="size-4" aria-hidden="true" /><span className="hidden lg:inline">Export CSV</span><span className="sr-only lg:hidden">Export CSV</span>
            </Button>
          )}
        </div>
      </div>

      {(on.length > 0 || list.query.trim()) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[color:var(--glass-border)] pt-2.5" aria-label="Active filters">
          {list.query.trim() && <Chip text={`Search: ${list.query.trim()}`} onRemove={() => list.setQuery("")} />}
          {on.map(([d, v]) => <Chip key={d.id} text={chipText(d, v)} onRemove={() => list.setFilter(d.id, "")} />)}
          <button type="button" onClick={list.clearFilters}
            className="ms-1 rounded-full px-2.5 py-1 text-[0.8125rem] font-medium text-[#035d53] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring dark:text-[#39edd5]">
            Clear All
          </button>
        </div>
      )}

      <FilterDrawer list={list} open={drawer} onOpenChange={setDrawer} />
    </div>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#03c1ac]/45 bg-[#39edd5]/12 py-0.5 pl-2.5 pr-0.5 text-[0.8125rem] font-medium text-[#032c26] dark:text-foreground">
      <span className="truncate">{text}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${text}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-[#035d53] hover:bg-[#03c1ac]/20 focus-visible:outline-2 focus-visible:outline-ring dark:text-[#39edd5]">
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

function QuickSelect<T>({ def, value, onChange, disabled }: { def: FilterDef<T>; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = React.useId();
  return (
    <span className="hidden items-center md:flex">
      <label htmlFor={id} className="sr-only">{def.label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className={cn(
          "glass-pill h-9 max-w-52 truncate rounded-full pl-3 pr-8 text-[0.8125rem] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 dark:[color-scheme:dark]",
          value && "border-[#03c1ac]/60 bg-[#39edd5]/10",
        )}>
        <option value="">{def.allLabel ?? `All ${def.label}`}</option>
        {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

function DensitySwitch({ value, onChange }: { value: "comfortable" | "compact"; onChange: (v: "comfortable" | "compact") => void }) {
  const opts = [
    { id: "comfortable" as const, label: "Comfortable", Icon: Rows2 },
    { id: "compact" as const, label: "Compact", Icon: Rows3 },
  ];
  return (
    <div role="group" aria-label="Row density" className="hidden h-9 items-center rounded-full border border-[color:var(--glass-border)] bg-white/70 p-0.5 md:flex dark:bg-background">
      {opts.map(({ id, label, Icon }) => (
        <button key={id} type="button" aria-pressed={value === id} title={label} onClick={() => onChange(id)}
          className={cn("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            value === id ? "bg-[#032c26] text-white dark:bg-[#39edd5] dark:text-[#032c26]" : "text-muted-foreground hover:text-foreground")}>
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="hidden 2xl:inline">{label}</span>
          <span className="sr-only 2xl:hidden">{label}</span>
        </button>
      ))}
    </div>
  );
}

function FilterDrawer<T>({ list, open, onOpenChange }: { list: ListApi<T>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const defs = list.filters ?? [];
  const count = list.sorted.length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 bg-[color:var(--glass-solid)] p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base text-[#032c26] dark:text-foreground">Filters</SheetTitle>
          <SheetDescription>The list updates as you choose.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {defs.map((d) => {
            const value = list.filterValues[d.id] ?? "";
            const blocked = !!d.dependsOn && !list.filterValues[d.dependsOn];
            if (d.kind === "dateRange") {
              const { from, to } = splitRange(value);
              return (
                <fieldset key={d.id} className="space-y-2">
                  <legend className="mb-1.5 text-sm font-medium">{d.label}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From"><Input type="date" value={from} max={to || undefined} onChange={(e) => list.setFilter(d.id, joinRange(e.target.value, to))} /></Field>
                    <Field label="To"><Input type="date" value={to} min={from || undefined} onChange={(e) => list.setFilter(d.id, joinRange(from, e.target.value))} /></Field>
                  </div>
                </fieldset>
              );
            }
            const dependsLabel = defs.find((x) => x.id === d.dependsOn)?.label.toLowerCase();
            return (
              <Field key={d.id} label={d.label} hint={blocked && dependsLabel ? `Choose the ${dependsLabel} first.` : undefined}>
                <Select value={value} disabled={blocked} onChange={(e) => list.setFilter(d.id, e.target.value)}>
                  <option value="">{d.allLabel ?? `All ${d.label}`}</option>
                  {d.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={list.clearFilters} disabled={list.activeCount === 0}>Clear All</Button>
          <Button variant="primary" className={BRAND_BUTTON} onClick={() => onOpenChange(false)}>
            Show {count.toLocaleString("en-US")} {(count === 1 ? list.unit[0] : list.unit[1]).replace(/\b\w/g, (c) => c.toUpperCase())}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
