/**
 * Unsaved changes: is the form different from what it opened with, and should leaving be stopped to ask first.
 * Pure functions, no React, so they are easy to test. The React side is in UnsavedChangesGuard.tsx.
 */

/** Values that mean "nothing entered" all count as the same: undefined, null, "", false and []. */
function normal(v: unknown): unknown {
  if (v === undefined || v === null || v === false) return undefined;
  if (typeof v === "string") return v.trim() === "" ? undefined : v;
  if (Array.isArray(v)) return v.length === 0 ? undefined : v.map(normal);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const n = normal(x);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "string") return String(a) === b;
  if (typeof a === "string" && typeof b === "number") return a === String(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** True when the user changed something. Clearing a field back to empty, or typing 5 where 5 was, is not a change. */
export function isDirty(initial: unknown, current: unknown): boolean {
  return !same(normal(initial), normal(current));
}

/**
 * Decides whether a route change should be stopped. After the user agrees to leave, the next change goes through
 * once without asking.
 */
export function createLeaveGate() {
  let pass = false;
  return {
    /** Stop this route change? */
    shouldBlock(dirty: boolean): boolean {
      if (pass) { pass = false; return false; }
      return dirty;
    },
    /** The user chose to leave: let the next route change through. */
    allowNext() { pass = true; },
  };
}

/** Keeps the forms on screen that have unsaved changes, so one check covers a page with several open forms. */
export function createDirtyRegistry() {
  const dirty = new Map<symbol, () => boolean>();
  return {
    register(check: () => boolean): () => void {
      const id = Symbol("form");
      dirty.set(id, check);
      return () => { dirty.delete(id); };
    },
    anyDirty(): boolean {
      for (const check of dirty.values()) if (check()) return true;
      return false;
    },
    size(): number { return dirty.size; },
  };
}
