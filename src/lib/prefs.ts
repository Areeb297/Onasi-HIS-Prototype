import { useSyncExternalStore } from "react";

/**
 * Reading preferences. Text size scales every size in the app (the root font size). Density sets the row height
 * of tables. Both are saved in the browser and applied on load. Clinicians read all day, so these matter.
 */

export type TextSize = "small" | "normal" | "large" | "xlarge";
export type Density = "comfortable" | "compact";

export const TEXT_SIZES: { id: TextSize; label: string; scale: number }[] = [
  { id: "small", label: "Small", scale: 0.9375 },
  { id: "normal", label: "Normal", scale: 1 },
  { id: "large", label: "Large", scale: 1.125 },
  { id: "xlarge", label: "Largest", scale: 1.25 },
];

interface Prefs {
  textSize: TextSize;
  density: Density;
}

const KEY = "onasi-emr-prefs-v1";
let prefs: Prefs = { textSize: "normal", density: "comfortable" };
const listeners = new Set<() => void>();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) prefs = { ...prefs, ...(JSON.parse(raw) as Partial<Prefs>) };
} catch {
  /* storage can be blocked */
}

/** Writes the preferences onto the page. Safe to call when there is no document. */
export function applyPrefs(p: Prefs = prefs) {
  if (typeof document === "undefined") return;
  const scale = TEXT_SIZES.find((s) => s.id === p.textSize)?.scale ?? 1;
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  document.documentElement.dataset.density = p.density;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  applyPrefs();
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => prefs,
    () => prefs,
  );
}
