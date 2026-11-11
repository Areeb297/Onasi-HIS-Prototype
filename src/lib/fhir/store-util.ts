import { useSyncExternalStore } from "react";

/**
 * A tiny persisted store: one localStorage key, subscribe, and a React hook.
 * Same idea as records.ts. Works without localStorage (tests, private windows).
 */
export function createStore<T>(key: string, seed: () => T) {
  let state: T | undefined;
  const listeners = new Set<() => void>();

  const load = (): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* fall through to seed */
    }
    return seed();
  };

  const get = (): T => {
    if (state === undefined) state = load();
    return state;
  };

  const set = (next: T) => {
    state = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage may be full or blocked; the app still works */
    }
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  const use = (): T => useSyncExternalStore(subscribe, get, get);

  const reset = () => set(seed());

  return { get, set, use, reset, subscribe };
}
