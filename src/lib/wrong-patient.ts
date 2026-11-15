import { useSyncExternalStore } from "react";
import { getState } from "./store";

/**
 * Wrong-patient check. Before something is signed or sent for a patient (an order, a prescription, a note, a
 * discharge), call `await confirmPatient(patientId)`. If in the last two minutes the user was working in a DIFFERENT
 * patient's chart, a dialog asks once: "You are about to sign for <patient>, MRN <mrn>. You were just working on
 * <other patient>. Continue?". It resolves true to go ahead, false to stop. With no other recent patient it resolves
 * true at once, so wrapping an action costs nothing in the usual case.
 *
 * "Working in a chart" is recorded by the shell: opening a chart tab, and every click or key press inside it.
 * "Ask once": after Continue, the same pair is not asked again until the other patient's chart is used again.
 */

export const RECENT_MS = 2 * 60_000;

export interface Recent { patientId: string; at: number }

let activity = new Map<string, number>();
let confirmed: { patientId: string; otherId: string; at: number } | null = null;

export function notePatientActivity(patientId: string, now: number = Date.now()) {
  if (patientId) activity.set(patientId, now);
}

/** The most recent OTHER patient worked on within the window, or null. Pure. */
export function otherRecentPatient(log: ReadonlyMap<string, number>, patientId: string, now: number, windowMs: number = RECENT_MS): Recent | null {
  let best: Recent | null = null;
  for (const [id, at] of log) {
    if (id === patientId || now - at > windowMs || at > now) continue;
    if (!best || at > best.at) best = { patientId: id, at };
  }
  return best;
}

/** Whether to ask, given the activity log and the last answer. Pure. */
export function needsPatientCheck(
  log: ReadonlyMap<string, number>, patientId: string, now: number,
  last: { patientId: string; otherId: string; at: number } | null = null, windowMs: number = RECENT_MS,
): Recent | null {
  const other = otherRecentPatient(log, patientId, now, windowMs);
  if (!other) return null;
  if (last && last.patientId === patientId && last.otherId === other.patientId && other.at <= last.at) return null;
  return other;
}

/* ---------- the question, answered by the dialog in the shell ---------- */

export interface PatientCheck { patientId: string; otherId: string; resolve: (ok: boolean) => void }

let pending: PatientCheck | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmPatient(patientId: string, now: number = Date.now()): Promise<boolean> {
  const other = needsPatientCheck(activity, patientId, now, confirmed);
  if (!other) return Promise.resolve(true);
  // A second question while one is open replaces it; the first is treated as Cancel.
  pending?.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = {
      patientId, otherId: other.patientId,
      resolve: (ok) => {
        if (ok) {
          confirmed = { patientId, otherId: other.patientId, at: Date.now() };
          // Continuing means the user is now working on this patient.
          notePatientActivity(patientId);
        }
        pending = null;
        emit();
        resolve(ok);
      },
    };
    emit();
  });
}

/** The same check when only the visit number is at hand. */
export function confirmForVisit(visit: string, now: number = Date.now()): Promise<boolean> {
  const id = getState().encounters.find((e) => e.visitNumber === visit)?.patientId;
  return id ? confirmPatient(id, now) : Promise.resolve(true);
}

export const answerPatientCheck = (ok: boolean) => pending?.resolve(ok);
export const getPatientCheck = () => pending;

export function usePatientCheck(): PatientCheck | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, getPatientCheck, getPatientCheck);
}

/** For tests. */
export function resetPatientChecks() {
  activity = new Map();
  confirmed = null;
  pending = null;
}
