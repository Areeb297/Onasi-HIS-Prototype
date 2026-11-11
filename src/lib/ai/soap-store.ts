import { useSyncExternalStore } from "react";
import { audit } from "../audit";
import { currentUser } from "../session";

/** SOAP notes. Own small store in the browser. A real HIS keeps them on the server. */

export interface SoapNote {
  id: string;
  visit: string;
  patientId: string;
  /** ISO time the note was started. */
  at: string;
  author: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  status: "draft" | "signed";
  /** True when the first draft came from the AI assistant. The text may have been edited after. */
  aiDrafted: boolean;
  signedBy?: string;
  signedAt?: string;
}

const KEY = "onasi-emr-soap-v1";
let notes: SoapNote[] = [];
try {
  const raw = localStorage.getItem(KEY);
  if (raw) notes = JSON.parse(raw) as SoapNote[];
} catch {
  /* storage may be blocked */
}

const listeners = new Set<() => void>();
function commit(next: SoapNote[]) {
  notes = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSoapNotes(): SoapNote[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => notes,
    () => notes,
  );
}

export const listSoap = (visit: string): SoapNote[] => notes.filter((n) => n.visit === visit);

export type SoapDraft = Pick<SoapNote, "subjective" | "objective" | "assessment" | "plan">;

export function saveSoap(visit: string, patientId: string, draft: SoapDraft, opts: { id?: string; aiDrafted?: boolean } = {}): SoapNote {
  const existing = opts.id ? notes.find((n) => n.id === opts.id) : undefined;
  if (existing) {
    if (existing.status === "signed") return existing;
    const next = { ...existing, ...draft, aiDrafted: existing.aiDrafted || !!opts.aiDrafted };
    commit(notes.map((n) => (n.id === existing.id ? next : n)));
    audit("update", `SOAP note ${existing.id}`, { patient: patientId, detail: `Visit ${visit}` });
    return next;
  }
  const note: SoapNote = {
    id: `SOAP-${Date.now().toString(36)}`,
    visit,
    patientId,
    at: new Date().toISOString(),
    author: currentUser().name,
    ...draft,
    status: "draft",
    aiDrafted: !!opts.aiDrafted,
  };
  commit([...notes, note]);
  audit("create", `SOAP note ${note.id}`, { patient: patientId, detail: `Visit ${visit}${note.aiDrafted ? ", started from an AI draft" : ""}` });
  return note;
}

/** Sign (co-sign) a note. It is then locked. */
export function signSoap(id: string): SoapNote | undefined {
  const n = notes.find((x) => x.id === id);
  if (!n || n.status === "signed") return n;
  const next: SoapNote = { ...n, status: "signed", signedBy: currentUser().name, signedAt: new Date().toISOString() };
  commit(notes.map((x) => (x.id === id ? next : x)));
  audit("update", `SOAP note ${id}`, { patient: n.patientId, detail: `Signed by ${next.signedBy}` });
  return next;
}

export function deleteSoap(id: string) {
  const n = notes.find((x) => x.id === id);
  if (!n || n.status === "signed") return;
  commit(notes.filter((x) => x.id !== id));
  audit("delete", `SOAP note ${id}`, { patient: n.patientId });
}
