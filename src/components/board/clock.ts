import { fmtDuration as formatDuration } from "@/lib/format";

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

/** 45 min, 1 h 20 min, 2 d 3 h: the one duration style of the app (lib/format.ts). */
export const fmtDuration = formatDuration;

export const CLOCK_TONE: Record<ClockState, { text: string; bg: string; stroke: string }> = {
  ok: { text: "text-ok", bg: "bg-ok/12", stroke: "stroke-ok" },
  warn: { text: "text-merge", bg: "bg-merge/18", stroke: "stroke-merge" },
  late: { text: "text-cancel", bg: "bg-cancel/14", stroke: "stroke-cancel" },
};
