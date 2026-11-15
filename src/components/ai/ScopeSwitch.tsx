import { cn } from "@/components/ui/primitives";

export type AssistantScope = "hospital" | "chart";

/**
 * The small pill that picks what Onasi AI is asked about: The Hospital or This Chart. The side panel and full screen use
 * this same switch, so it looks and works the same in both. This Chart is off until a chart is open, and shows the number
 * of safety checks waiting on it.
 *
 * `panels` is true in the side panel, where each choice owns a tab panel with the matching id.
 */
export function ScopeSwitch({
  scope, onScope, chartOpen, checks = 0, panels = false, className,
}: {
  scope: AssistantScope;
  onScope: (s: AssistantScope) => void;
  chartOpen: boolean;
  checks?: number;
  panels?: boolean;
  className?: string;
}) {
  const tab = (m: AssistantScope, label: string, disabled = false) => (
    <button
      key={m}
      type="button"
      role="tab"
      id={`ai-tab-${m}`}
      aria-selected={scope === m}
      aria-controls={panels ? `ai-panel-${m}` : undefined}
      disabled={disabled}
      title={disabled ? "Open a patient chart first" : undefined}
      onClick={() => onScope(m)}
      className={cn(
        "relative rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-45",
        scope === m ? "bg-[#032C26] text-white shadow-[0_4px_14px_-6px_rgba(3,44,38,0.5)] dark:bg-[#39EDD5] dark:text-[#032C26]" : "text-foreground/75 hover:text-foreground",
      )}
    >
      {label}
      {m === "chart" && checks > 0 && (
        <span className="ms-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white">{checks}<span className="sr-only"> safety checks</span></span>
      )}
    </button>
  );
  return (
    <div role="tablist" aria-label="What to ask about" className={cn("glass-pill inline-flex gap-0.5 p-0.5", className)}>
      {tab("hospital", "The Hospital")}
      {tab("chart", "This Chart", !chartOpen)}
    </div>
  );
}
