import { useSyncExternalStore } from "react";

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

/** true = Developer View (HL7 messages and field mapping shown). false = HIS View (what staff see). */
export function useDevMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => value,
    () => value,
  );
}
