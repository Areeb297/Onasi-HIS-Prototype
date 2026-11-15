import * as React from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge, Button, Select, cn } from "@/components/ui/primitives";
import { ITEM_CHIPS, type ItemCounts, type StatusTone } from "@/lib/claims";

/**
 * Small parts shared by the Billing Worklist, the claim form and Submitted Transactions.
 * Brand chips use Onasi Cyan (#39EDD5) as a tint with Deep Teal (#035D53) text, so they read at AA contrast; status chips
 * keep the app's status palette.
 */

export const brandChip =
  "inline-flex items-center rounded-md border border-[#39edd5]/50 bg-[#39edd5]/15 px-1.5 py-[3px] text-[0.6875rem] font-semibold leading-none whitespace-nowrap text-[#035d53] dark:border-[#39edd5]/30 dark:bg-[#39edd5]/10 dark:text-[#39edd5]";

export function BrandChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className={brandChip} title={title}>{children}</span>;
}

export function StatusChip({ status }: { status: { label: string; tone: StatusTone | "neutral" } }) {
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

/** Item chips: only the kinds the claim has, each with its count. The full name is in the title and for screen readers. */
export function ItemChips({ items, className }: { items: ItemCounts; className?: string }) {
  const shown = ITEM_CHIPS.filter((c) => items.chips[c.key] > 0);
  if (!shown.length) return <span className="text-xs text-muted-foreground">No Items</span>;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="Items on the claim">
      {shown.map((c) => (
        <li key={c.key} title={c.full} className="relative inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-[3px] text-[0.6875rem] leading-none text-muted-foreground">
          <span aria-hidden="true">{c.short}</span>
          <span className="sr-only">{c.full}:</span>
          <span className="font-semibold tabular-nums text-foreground">{items.chips[c.key]}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * An icon button with a tooltip. When it cannot be used it stays visible but disabled, and the tooltip says why. The
 * wrapper takes focus in that case, so keyboard users hear the reason too.
 */
export function IconAction({ icon, label, reason, disabled, onClick, primary }: {
  icon: React.ReactNode; label: string; reason?: string; disabled?: boolean; onClick: () => void; primary?: boolean;
}) {
  const tip = disabled ? `${label}: ${reason ?? "Not available now."}` : label;
  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-[1.875rem] items-center justify-center rounded-lg border transition-colors [&_svg]:size-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-40",
        primary
          ? "border-[#035d53]/25 bg-[#39edd5]/15 text-[#035d53] hover:bg-[#39edd5]/30 dark:text-[#39edd5]"
          : "border-border bg-card text-foreground/80 hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span tabIndex={0} aria-label={tip} className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Page size and page buttons under a list. */
export function Pagination({ total, page, size, onPage, onSize, sizes = [10, 25, 50, 100], noun = "records" }: {
  total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void; sizes?: number[]; noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {total ? <>Showing <span className="font-semibold tabular-nums text-foreground">{from} to {to}</span> of <span className="tabular-nums">{total}</span> {noun}</> : `No ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-muted-foreground">
          <span className="hidden sm:inline">Page Size</span>
          <Select aria-label="Page size" className="h-8 w-[4.75rem]" value={size} onChange={(e) => onSize(Number(e.target.value))}>
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </label>
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
        <span className="min-w-16 text-center tabular-nums text-muted-foreground">{page} of {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
      </div>
    </nav>
  );
}

/** Keeps the page in range when the list shrinks. */
export function usePaging(total: number, initialSize = 25) {
  const [page, setPage] = React.useState(1);
  const [size, setSize] = React.useState(initialSize);
  const pages = Math.max(1, Math.ceil(total / size));
  React.useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  return { page: Math.min(page, pages), size, setPage, setSize: (s: number) => { setSize(s); setPage(1); }, slice: <T,>(list: T[]) => list.slice((Math.min(page, pages) - 1) * size, Math.min(page, pages) * size) };
}

/** A small label above a filter control, so a one-row filter bar still says what each field is. */
export function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Filters: one row on a desktop, a drawer on a phone. `render(true)` lays the fields out for the drawer.
 */
export function ResponsiveFilters({ render, active, onReset, title = "Filters", className }: {
  render: (inDrawer: boolean) => React.ReactNode; active: number; onReset: () => void; title?: string; className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className={cn("hidden md:block", className)} role="group" aria-label={title}>{render(false)}</div>
      <div className="flex items-center gap-2 md:hidden">
        <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <SlidersHorizontal className="size-4" /> {title}
          {active > 0 && <span className="rounded-full bg-[#032c26] px-1.5 text-[0.6875rem] font-semibold leading-5 text-white dark:bg-[#39edd5] dark:text-[#032c26]">{active}</span>}
        </Button>
        {active > 0 && <Button size="sm" variant="ghost" onClick={onReset}><X className="size-4" /> Reset</Button>}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>The list updates as you change a filter.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4">{render(true)}</div>
          <div className="flex gap-2 border-t border-border p-4">
            <Button className="flex-1" onClick={onReset}>Reset</Button>
            <Button className="flex-1" variant="primary" onClick={() => setOpen(false)}>Show Results</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** True below the md breakpoint, for parts that change shape on a phone (dense KPI tiles). */
export function useIsPhone(): boolean {
  const q = '(max-width: 767px)';
  const [phone, setPhone] = React.useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  React.useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

export const fmtDate = (iso: string | undefined) =>
  iso ? new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not Recorded";
export const fmtTime = (iso: string | undefined) => (iso && iso.length > 10 ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
export const fmtDateTime = (iso: string | undefined) => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "Not Recorded");
