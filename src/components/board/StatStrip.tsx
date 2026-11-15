import type * as React from "react";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import type { BoardTone } from "./types";

export interface Stat {
  label: string;
  value: string | number;
  note?: string;
  tone?: BoardTone;
  /** A tabler or lucide icon for the icon tile. */
  icon?: React.ReactNode;
}

/** Red for the urgent numbers, amber for past target, green when the number is a good one; the rest stay quiet. */
function look(tone?: BoardTone): { accent?: "danger" | "warn"; tone?: "ok" | "warn" | "danger" } {
  if (tone === "cancel") return { accent: "danger", tone: "danger" };
  if (tone === "merge") return { accent: "warn", tone: "warn" };
  if (tone === "ok") return { tone: "ok" };
  return {};
}

/** The strip of live numbers above a board: the same glass KPI tiles as the dashboards. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <KpiStrip label="Live numbers" className="mb-4 grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => {
        const l = look(s.tone);
        return (
          <KpiTile key={s.label} icon={s.icon} label={s.label} value={typeof s.value === "number" ? s.value.toLocaleString("en-US") : s.value} note={s.note} tone={l.tone} accent={l.accent} />
        );
      })}
    </KpiStrip>
  );
}
