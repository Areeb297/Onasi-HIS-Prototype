import * as React from "react";
import { GlassPillSwitch } from "@/components/ui/glass";

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

/** Board or Table, as the app's frosted pill switch. */
export function ViewToggle({ value, onChange }: { value: WorklistView; onChange: (v: WorklistView) => void }) {
  return (
    <GlassPillSwitch label="Worklist view" options={["Board", "Table"] as const} value={value === "board" ? "Board" : "Table"} onChange={(v) => onChange(v === "Board" ? "board" : "table")} />
  );
}
