/**
 * Drafts of forms that are not finished yet. Kept in this browser only (localStorage), one per form and record.
 * The storage is passed in so the logic can be tested without a browser.
 */
import { fmtShort, fmtTime } from "@/lib/format";

export interface Draft<V = Record<string, unknown>> {
  values: V;
  /** When the draft was saved, as an ISO string. */
  savedAt: string;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const KEY = "onasi-form-drafts";

function storage(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readAll(s: Store | null): Record<string, Draft> {
  if (!s) return {};
  try { return JSON.parse(s.getItem(KEY) ?? "{}") as Record<string, Draft>; } catch { return {}; }
}

function writeAll(s: Store | null, all: Record<string, Draft>) {
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or blocked: the draft is not kept */ }
}

export function saveDraft<V>(key: string, values: V, s: Store | null = storage(), now = new Date()): Draft<V> {
  const all = readAll(s);
  const d = { values, savedAt: now.toISOString() };
  all[key] = d as Draft;
  writeAll(s, all);
  return d;
}

export function loadDraft<V = Record<string, unknown>>(key: string, s: Store | null = storage()): Draft<V> | undefined {
  return readAll(s)[key] as Draft<V> | undefined;
}

export function clearDraft(key: string, s: Store | null = storage()) {
  const all = readAll(s);
  if (!(key in all)) return;
  delete all[key];
  writeAll(s, all);
}

/** "14:05" for a draft saved today, otherwise "12 Nov, 14:05". */
export function draftTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? fmtTime(d) : fmtShort(d, now);
}
