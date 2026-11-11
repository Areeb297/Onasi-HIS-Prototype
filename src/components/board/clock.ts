/** Turnaround clocks. Pure, so they are easy to test. */

export type ClockState = "ok" | "warn" | "late";

/** Amber from this share of the target, red from 100 percent. */
export const WARN_AT = 0.75;

export function clockState(elapsedMin: number, targetMin: number): ClockState {
  if (!(targetMin > 0)) return "ok";
  const ratio = elapsedMin / targetMin;
  if (ratio >= 1) return "late";
  if (ratio >= WARN_AT) return "warn";
  return "ok";
}

export const elapsedMin = (sinceIso: string, now: number): number => Math.max(0, (now - new Date(sinceIso).getTime()) / 60_000);

/** 45m, 1h 20m, 2d 3h. */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export const CLOCK_TONE: Record<ClockState, { text: string; bg: string; stroke: string }> = {
  ok: { text: "text-ok", bg: "bg-ok/12", stroke: "stroke-ok" },
  warn: { text: "text-merge", bg: "bg-merge/18", stroke: "stroke-merge" },
  late: { text: "text-cancel", bg: "bg-cancel/14", stroke: "stroke-cancel" },
};
