import { cn } from "@/components/ui/primitives";
import type { Run, RunStep } from "@/lib/automations";
import { KindIcon, STEP_TONE } from "./node-style";

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const when = (iso: string, now: Date = new Date()) => {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return `Today ${clock(iso)}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${clock(iso)}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clock(iso)}`;
};

/**
 * The steps of a run in order, one line each: the kind of step, what happened and when. In a test run the lines say
 * what would have happened. `shown` limits the list while a test run plays, so steps appear one by one.
 */
export function RunLog({ run, shown, onPick, activeIndex, className }: {
  run: Run;
  shown?: number;
  onPick?: (s: RunStep) => void;
  activeIndex?: number;
  className?: string;
}) {
  const steps = run.steps.slice(0, shown ?? run.steps.length);
  return (
    <ol className={cn("space-y-1.5", className)} aria-label={`Steps of ${run.test ? "the test run" : `run ${run.id}`}`}>
      {steps.map((s, i) => {
        const tone = STEP_TONE[s.status];
        const body = (
          <>
            <span className="w-5 shrink-0 pt-1.5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <KindIcon kind={s.kind} className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={cn("rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold leading-none", tone.cls)}>{tone.label}</span>
                {!run.test && <span className="text-xs tabular-nums text-muted-foreground">{clock(s.at)}</span>}
              </span>
              <span className="mt-0.5 block text-[0.8125rem] leading-snug text-foreground">{s.text}</span>
            </span>
          </>
        );
        return (
          <li key={i}>
            {onPick && s.nodeId ? (
              <button type="button" onClick={() => onPick(s)} className={cn("flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-[#032C26]/[0.04] focus-visible:outline-2 focus-visible:outline-ring", activeIndex === i && "bg-[#39EDD5]/12")}>{body}</button>
            ) : (
              <div className={cn("flex items-start gap-2.5 px-1.5 py-1", activeIndex === i && "rounded-lg bg-[#39EDD5]/12")}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
