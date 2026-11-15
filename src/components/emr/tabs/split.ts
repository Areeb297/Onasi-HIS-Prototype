import { EMR_MENU, tabFor, type TabId } from "@/lib/emr-menu";

/**
 * Two chart sections side by side, like two tabs of a browser next to each other. The state lives in the address:
 * `?s=<left>&s2=<right>` (with `t` and `t2` only when a section sits in two tabs and the other one is meant), so a
 * split can be linked to and the Back button undoes it. Everything here is plain data, no screen code.
 * What the user chose last (the width of the split and the second section) is remembered per user in the browser.
 */

export interface Pane {
  /** A section id of EMR_MENU. */
  section: string;
  tab: TabId;
}

export interface Split {
  left: Pane;
  right: Pane | null;
}

export type Side = "left" | "right";
export const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** A pane for a section, in the tab asked for when that tab holds it. Null for a section that does not exist. */
export function paneOf(section: string | null | undefined, wantedTab?: string | null): Pane | null {
  if (!section || !EMR_MENU.some((i) => i.id === section)) return null;
  return { section, tab: tabFor(section, wantedTab).id };
}

export const samePane = (a: Pane | null, b: Pane | null): boolean => !!a && !!b && a.section === b.section && a.tab === b.tab;

/** Reads the split from the address. An unknown `s` opens Overview; an unknown `s2`, or the same pane twice, is no split. */
export function readSplit(params: URLSearchParams): Split {
  const left = paneOf(params.get("s"), params.get("t")) ?? { section: "overview", tab: "overview" };
  const right = paneOf(params.get("s2"), params.get("t2"));
  return { left, right: samePane(left, right) ? null : right };
}

/** The address of a split. A tab is written only when it is not the section's usual one, as before. */
export function splitParams(s: Split): Record<"s" | "t" | "s2" | "t2", string | undefined> {
  const t = (p: Pane | null) => (p && tabFor(p.section).id !== p.tab ? p.tab : undefined);
  return { s: s.left.section, t: t(s.left), s2: s.right?.section, t2: t(s.right) };
}

/** Opens a section beside the first one. A third section takes the place of the second. */
export const openBeside = (s: Split, p: Pane): Split => (samePane(s.left, p) ? s : { left: s.left, right: p });

export const swap = (s: Split): Split => (s.right ? { left: s.right, right: s.left } : s);

/** Shows a section in one pane. Picking the section that is already in the other pane swaps the two, so nothing is lost. */
export function setPane(s: Split, side: Side, p: Pane): Split {
  if (!s.right) return { left: p, right: null };
  if (samePane(side === "left" ? s.right : s.left, p)) return swap(s);
  return side === "left" ? { left: p, right: s.right } : { left: s.left, right: p };
}

/** Closes one pane. The one that stays becomes the whole chart. "Make Full Width" on a pane is closing the other one. */
export const closePane = (s: Split, side: Side): Split => ({ left: side === "left" && s.right ? s.right : s.left, right: null });

/** Ctrl+\\: closes the split, or opens it again with the section that was second last time (Vitals, or Overview beside Vitals). */
export function toggleSplit(s: Split, last?: Pane | null): Split {
  if (s.right) return closePane(s, "right");
  const fallback = paneOf(s.left.section === "vitals" ? "overview" : "vitals")!;
  return openBeside(s, last && !samePane(last, s.left) ? last : fallback);
}

/* ---------- remembered per user ---------- */

export const MIN_RATIO = 0.3;
export const clampRatio = (r: number): number => (Number.isFinite(r) ? Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r)) : 0.5);

export interface SplitPrefs {
  /** Share of the width the left pane takes, 0.3 to 0.7. */
  ratio: number;
  /** The section that was in the second pane last time. */
  last?: Pane | null;
}

const key = (userId: string) => `onasi-emr-chart-split-v1:${userId}`;

export function loadSplitPrefs(userId: string): SplitPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(key(userId)) ?? "{}") as Partial<SplitPrefs>;
    return { ratio: clampRatio(raw.ratio ?? 0.5), last: paneOf(raw.last?.section, raw.last?.tab) };
  } catch {
    return { ratio: 0.5, last: null }; // storage may be blocked
  }
}

export function saveSplitPrefs(userId: string, prefs: SplitPrefs): void {
  try { localStorage.setItem(key(userId), JSON.stringify(prefs)); } catch { /* the split still works, it is just not remembered */ }
}
