import * as React from "react";
import { cn } from "@/components/ui/primitives";

export interface StatItem {
  id: string;
  label: string;
  value: number;
  icon?: React.ReactNode;
  /** Draws attention when the number is not zero, for example pending requests. */
  alert?: boolean;
}

/**
 * A list's numbers as one compact line of filter chips: each shows a count, and pressing it filters the list to that
 * group. The pressed chip is Dark Green, so it reads as a filter that is on. Press it again to turn it off.
 */
export function StatFilters({ label, items, value, onChange, className }: {
  label: string;
  items: StatItem[];
  /** The id that is on, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {items.map((it) => {
        const on = value === it.id;
        return (
          <button key={it.id} type="button" aria-pressed={on} onClick={() => onChange(on ? "" : it.id)}
            title={on ? `Showing ${it.label.toLowerCase()}. Press again to show all.` : `Show ${it.label.toLowerCase()}`}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[0.8125rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4",
              on
                ? "border-transparent bg-[#032c26] text-white shadow-[0_6px_16px_-8px_rgba(3,44,38,0.55)] dark:bg-[#39edd5] dark:text-[#032c26]"
                : "glass-card border-[color:var(--glass-border)] text-foreground hover:border-[#03c1ac]/50",
            )}>
            {it.icon && <span aria-hidden="true" className={cn("flex", on ? "text-[#39edd5] dark:text-[#032c26]" : it.alert && it.value > 0 ? "text-warn" : "text-[#035d53] dark:text-[#39edd5]")}>{it.icon}</span>}
            <span>{it.label}</span>
            <span className={cn("min-w-6 rounded-md px-1.5 text-center text-sm font-semibold tabular-nums leading-6",
              on ? "bg-white/15" : it.alert && it.value > 0 ? "bg-warn/14 text-warn" : "bg-muted text-foreground")}>
              {it.value.toLocaleString("en-US")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
