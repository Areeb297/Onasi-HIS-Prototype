import { useSyncExternalStore } from "react";
import type { LogEntry } from "./model";

export interface Toast {
  id: number;
  tone: "ok" | "warn" | "danger";
  text: string;
  detail?: string;
  entry?: LogEntry;
  undo?: { label: string; run: () => void };
  link?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pushToast(t: Omit<Toast, "id">): number {
  const id = nextId++;
  // Keep the list short. The newest toast is on top.
  toasts = [{ ...t, id }, ...toasts].slice(0, 3);
  emit();
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
}
