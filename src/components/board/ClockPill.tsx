import { cn } from "@/lib/utils";
import { CLOCK_TONE, clockState, elapsedMin, fmtDuration } from "./clock";

const R = 7;
const C = 2 * Math.PI * R;

/**
 * Turnaround clock: a small ring that fills as the time in the stage grows against the target.
 * Green, then amber from 75 percent, then red once the target is passed.
 * mode "elapsed" reads "Waiting 12m, target 20m". mode "due" reads "Due in 8m" or "Overdue by 5m".
 */
export function ClockPill({
  since, targetMin, now, mode = "elapsed", dueLabel = "Due", className,
}: {
  since: string;
  targetMin: number;
  now: number;
  mode?: "elapsed" | "due";
  dueLabel?: string;
  className?: string;
}) {
  const el = elapsedMin(since, now);
  const state = clockState(el, targetMin);
  const tone = CLOCK_TONE[state];
  const ratio = targetMin > 0 ? Math.min(1, el / targetMin) : 0;
  const text =
    mode === "elapsed"
      ? `Waiting ${fmtDuration(el)}, target ${fmtDuration(targetMin)}`
      : el <= targetMin
        ? `${dueLabel} in ${fmtDuration(targetMin - el)}`
        : `Overdue by ${fmtDuration(el - targetMin)}`;
  const word = state === "late" ? "past target" : state === "warn" ? "close to target" : "on time";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium leading-none", tone.bg, tone.text, className)}
      title={`${text} (${word})`}
      data-clock={state}
    >
      <svg viewBox="0 0 18 18" className="size-4 shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2" className="stroke-current opacity-25" />
        <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${ratio * C} ${C}`} className={tone.stroke} />
      </svg>
      <span className="tabular-nums">{text}</span>
      <span className="sr-only">{word}</span>
    </span>
  );
}
