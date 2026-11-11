import type { Patient } from "@/lib/model";

export const PRIORITY_RANK: Record<string, number> = { stat: 0, asap: 1, urgent: 2, routine: 3 };

export function ageYears(dob: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(dob).getTime()) / (365.25 * 86_400_000)));
}

/** "34 y, Male" */
export const ageSex = (p: Pick<Patient, "dob" | "sex">, now?: number) => `${ageYears(p.dob, now)} y, ${p.sex === "M" ? "Male" : "Female"}`;

export const sameLocalDay = (iso: string, now: number) => new Date(iso).toDateString() === new Date(now).toDateString();

/** Sort: priority first, then the oldest order. */
export function byPriorityThenAge<T>(priority: (x: T) => string, at: (x: T) => string) {
  return (a: T, b: T) => (PRIORITY_RANK[priority(a)] - PRIORITY_RANK[priority(b)]) || at(a).localeCompare(at(b));
}

export const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
