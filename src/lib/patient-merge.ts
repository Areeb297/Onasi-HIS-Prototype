import { audit } from "./audit";
import { moveCoverages } from "./coverage";
import type { Encounter, HisState, LogEntry } from "./model";
import { can } from "./session";
import { emptyForm, formFromEncounter, getState, patientName, replaceState, sendOn } from "./store";

/**
 * Merge two files of the same person: the duplicate's visits move to the file that is kept, the duplicate is marked merged
 * and leaves the patient lists.
 *
 * The national message: one A50 (ADT_A50, the MERGE_INFO group) for each visit that moves. PID carries the kept patient,
 * MRG-1 the duplicate's Health ID and MRG-5 the visit number. The visit number itself does not change, so PV1-19 is the same
 * number. A duplicate with no visits sends nothing: NPHIES has no message for a patient file alone.
 *
 * Assumptions (the NPHIES ADT pages do not cover them):
 *  - A merge is refused while both files have an open visit (active or pre-admission). One of them must be closed first,
 *    because one person cannot be in two open visits at once and the merged file would show both.
 *  - Cancelled visits move with the file but send no message.
 */

const OPEN: Encounter["status"][] = ["active", "preadmit"];

export const openVisits = (s: HisState, patientId: string) => s.encounters.filter((e) => e.patientId === patientId && OPEN.includes(e.status));

/** Why these two files cannot be merged, or null when they can. */
export function mergeProblem(s: HisState, keepId: string, dupId: string): string | null {
  if (!keepId || !dupId) return "Pick the file to keep and the duplicate file.";
  if (keepId === dupId) return "The two files must be different.";
  const keep = s.patients.find((p) => p.id === keepId);
  const dup = s.patients.find((p) => p.id === dupId);
  if (!keep || !dup) return "One of the files was not found.";
  if (keep.mergedInto || dup.mergedInto) return "One of the files has already been merged.";
  if (openVisits(s, keepId).length && openVisits(s, dupId).length) {
    return "Both files have an open visit. Discharge or cancel one of the visits first, then merge.";
  }
  return null;
}

export interface MergeOutcome {
  state: HisState;
  /** One A50 per visit that moved and was not cancelled. */
  entries: LogEntry[];
  /** Visit numbers that moved to the kept file. */
  moved: string[];
}

/** Pure merge. Throws when `mergeProblem` gives a reason. */
export function mergeOn(s: HisState, keepId: string, dupId: string, at: string = new Date().toISOString()): MergeOutcome {
  const why = mergeProblem(s, keepId, dupId);
  if (why) throw new Error(why);
  let state = s;
  const entries: LogEntry[] = [];
  const visits = s.encounters.filter((e) => e.patientId === dupId);
  for (const enc of visits) {
    if (enc.status === "cancelled") continue;
    const form = formFromEncounter(state, "A50", enc, emptyForm(state, "A50"));
    form.patientId = keepId;
    form.oldPatientId = dupId;
    form.newVisitNumber = enc.visitNumber;
    const out = sendOn(state, "A50", form, { source: "user", sentAt: at });
    state = out.state;
    entries.push(out.entry);
  }
  const moved = new Set(visits.map((e) => e.visitNumber));
  state = {
    ...state,
    patients: state.patients.map((p) => (p.id === dupId ? { ...p, mergedInto: keepId, mergedAt: at } : p)),
    encounters: state.encounters.map((e) => (e.patientId === dupId && moved.has(e.visitNumber) ? { ...e, patientId: keepId } : e)),
  };
  return { state, entries, moved: [...moved] };
}

export type MergeResult = { ok: true; outcome: MergeOutcome } | { ok: false; message: string };

/** Merge in the app: checks the permission, writes the audit trail and moves the coverages. */
export function mergePatients(keepId: string, dupId: string, reason: string): MergeResult {
  const s = getState();
  const keep = s.patients.find((p) => p.id === keepId);
  const dup = s.patients.find((p) => p.id === dupId);
  if (!can("patient.register")) {
    audit("denied", "Merge patients", { patient: patientName(dup), detail: "Needs the patient registration permission." });
    return { ok: false, message: "Your role cannot merge patient files." };
  }
  if (reason.trim().length < 5) return { ok: false, message: "Write why these files are the same person (at least 5 characters)." };
  const why = mergeProblem(s, keepId, dupId);
  if (why) return { ok: false, message: why };
  const outcome = mergeOn(s, keepId, dupId);
  replaceState(outcome.state);
  moveCoverages(dupId, keepId, outcome.state.patients);
  for (const e of outcome.entries) {
    audit("send-adt", `${e.trigger} ${e.controlId}`, { patient: e.patientName, detail: `Visit ${e.visitNumber} moved from ${dup?.mrn}${e.errors ? `, ${e.errors} errors` : ""}` });
  }
  audit("update", `Merge patients ${dup?.mrn} into ${keep?.mrn}`, {
    patient: patientName(keep),
    detail: `Kept ${keep?.mrn}. Merged ${dup?.mrn} (${patientName(dup)}). Visits moved: ${outcome.moved.join(", ") || "none"}. Reason: ${reason.trim()}`,
  });
  return { ok: true, outcome };
}
