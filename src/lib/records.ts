import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { MASTERS } from "./masters-data";
import type { FormRecord, Row } from "./schema";
import { currentUser } from "./session";

/**
 * Store for generic EMR form records (per visit) and setup tables (masters).
 * Separate from the ADT store so the two can evolve on their own.
 */

interface State {
  /** visit number -> form id -> records */
  forms: Record<string, Record<string, FormRecord[]>>;
  /** master id -> rows. Missing means "use the seed". */
  masters: Record<string, Row[]>;
}

const KEY = "onasi-emr-records-v1";
let state: State = { forms: {}, masters: {} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = JSON.parse(raw) as State;
} catch {
  /* ignore */
}

const listeners = new Set<() => void>();
function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useRecords(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export function getFormRecords(visit: string, formId: string): FormRecord[] {
  return state.forms[visit]?.[formId] ?? [];
}

export function addFormRecord(visit: string, formId: string, values: FormRecord["values"], patientId?: string): FormRecord {
  const rec: FormRecord = {
    id: `${formId}-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    author: currentUser().name,
    values,
  };
  const forVisit = { ...(state.forms[visit] ?? {}) };
  forVisit[formId] = [...(forVisit[formId] ?? []), rec];
  commit({ ...state, forms: { ...state.forms, [visit]: forVisit } });
  audit("create", `${formId} record`, { patient: patientId, detail: `Visit ${visit}` });
  return rec;
}

export function updateFormRecord(visit: string, formId: string, id: string, values: FormRecord["values"], patientId?: string) {
  const forVisit = { ...(state.forms[visit] ?? {}) };
  forVisit[formId] = (forVisit[formId] ?? []).map((r) => (r.id === id ? { ...r, values } : r));
  commit({ ...state, forms: { ...state.forms, [visit]: forVisit } });
  audit("update", `${formId} record`, { patient: patientId, detail: `Visit ${visit}` });
}

export function deleteFormRecord(visit: string, formId: string, id: string, patientId?: string) {
  const forVisit = { ...(state.forms[visit] ?? {}) };
  forVisit[formId] = (forVisit[formId] ?? []).filter((r) => r.id !== id);
  commit({ ...state, forms: { ...state.forms, [visit]: forVisit } });
  audit("delete", `${formId} record`, { patient: patientId, detail: `Visit ${visit}` });
}

export function getMasterRows(id: string): Row[] {
  return state.masters[id] ?? MASTERS.find((m) => m.id === id)?.seed ?? [];
}

export function saveMasterRows(id: string, rows: Row[]) {
  commit({ ...state, masters: { ...state.masters, [id]: rows } });
  audit("update", `Setup ${id}`, { detail: `${rows.length} rows` });
}

export function resetRecords() {
  commit({ forms: {}, masters: {} });
}
