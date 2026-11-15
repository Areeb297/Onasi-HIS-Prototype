import { useSyncExternalStore } from "react";
import { can, onSessionChange } from "./session";

const KEY = "nphies-adt-devmode";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

let value = read();

export function setDevMode(on: boolean) {
  value = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Only the System Administrator may use Developer View. Every other role always sees HIS View. */
export const canUseDevMode = (): boolean => can("admin");

/** The view in force now: the saved choice, but only for a user who may use Developer View. */
export const isDevMode = (): boolean => value && canUseDevMode();

/** true = Developer View (HL7 messages and field mapping shown). false = HIS View (what staff see). */
export function useDevMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const off = onSessionChange(cb);
      return () => { listeners.delete(cb); off(); };
    },
    isDevMode,
    isDevMode,
  );
}
