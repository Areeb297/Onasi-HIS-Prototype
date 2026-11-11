import * as React from "react";
import { IconLayoutKanban, IconTable } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type WorklistView = "board" | "table";

/** Remembers the chosen view in the browser. Falls back to the board. */
export function useWorklistView(key: string): [WorklistView, (v: WorklistView) => void] {
  const [view, setView] = React.useState<WorklistView>(() => {
    try {
      return localStorage.getItem(`onasi-view-${key}`) === "table" ? "table" : "board";
    } catch {
      return "board";
    }
  });
  const set = (v: WorklistView) => {
    setView(v);
    try {
      localStorage.setItem(`onasi-view-${key}`, v);
    } catch {
      /* ignore */
    }
  };
  return [view, set];
}

/** Board or Table. */
export function ViewToggle({ value, onChange }: { value: WorklistView; onChange: (v: WorklistView) => void }) {
  const opts: { id: WorklistView; label: string; icon: React.ReactNode }[] = [
    { id: "board", label: "Board", icon: <IconLayoutKanban className="size-4" stroke={1.75} /> },
    { id: "table", label: "Table", icon: <IconTable className="size-4" stroke={1.75} /> },
  ];
  return (
    <div role="radiogroup" aria-label="Worklist view" className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            value === o.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
