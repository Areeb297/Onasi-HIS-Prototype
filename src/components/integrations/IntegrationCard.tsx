import * as React from "react";
import { Badge, cn } from "@/components/ui/primitives";
import { INTEGRATION_USE_CASES, UseCaseIcons } from "@/components/NphiesUseCaseIcon";
import { fmtRelative } from "@/lib/format";
import { MODE_LABEL, MODE_TONE, environmentOf, modeOf, type CallStats, type Integration } from "@/lib/integrations";

/** One integration on the hub: status, environment, last call and how today's calls went. Press it to open its log. */
export function IntegrationCard({ item, stats, icon, selected, onSelect }: {
  item: Integration; stats: CallStats; icon: React.ReactNode; selected: boolean; onSelect: () => void;
}) {
  const mode = modeOf(item.id);
  return (
    <button
      type="button" aria-pressed={selected} onClick={onSelect}
      // Inline, because .glass-card sets its own border and shadow outside the utility layer.
      style={selected ? { borderColor: "var(--primary)", boxShadow: "0 0 0 1px var(--primary), var(--glass-shadow-hover)" } : undefined}
      className={cn(
        "glass-card glass-hover flex min-w-0 flex-col rounded-2xl p-4 text-left transition-transform hover:-translate-y-0.5 motion-reduce:transform-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span className="flex items-start gap-3">
        <span aria-hidden="true" className="glass-icon flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[1.15rem]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold">{item.name}</span>
          <span className="block text-xs text-muted-foreground">{item.owner}</span>
        </span>
        <Badge tone={MODE_TONE[mode]}>{MODE_LABEL[mode]}</Badge>
      </span>
      {INTEGRATION_USE_CASES[item.id] && <UseCaseIcons ids={INTEGRATION_USE_CASES[item.id]} className="mt-3" />}
      <span className={cn("block text-xs text-muted-foreground", INTEGRATION_USE_CASES[item.id] ? "mt-1.5" : "mt-3")}>{item.services.join(", ")}</span>
      <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/70 pt-3 text-xs">
        <Fact label="Environment">{environmentOf(item.id)}</Fact>
        <Fact label="Last Call">{stats.last ? fmtRelative(stats.last.at) : "None Yet"}</Fact>
        <span className="col-span-2">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">Success Today</span>
            <span className="font-semibold tabular-nums text-foreground">
              {stats.rate === null ? "No Calls Today" : `${stats.rate}% (${stats.todayOk} of ${stats.today})`}
            </span>
          </span>
          <span aria-hidden="true" className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-[linear-gradient(90deg,#0ce69f,#39edd5)]" style={{ width: `${stats.rate ?? 0}%` }} />
          </span>
        </span>
      </span>
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="min-w-0">
      <span className="block text-muted-foreground">{label}</span>
      <span className="block truncate font-medium text-foreground">{children}</span>
    </span>
  );
}
