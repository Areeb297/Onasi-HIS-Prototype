import { useSyncExternalStore } from "react";

/**
 * Audit trail. Every view, change, send and AI action is recorded with who, what, when and which patient.
 * Supports HIPAA audit controls (45 CFR 164.312(b)), PDPL accountability, and CBAHI information management themes.
 * Stored in the browser only. A real HIS writes this to tamper-evident storage on the server.
 */

export type AuditAction =
  | "login" | "logout" | "lock" | "unlock"
  | "view" | "create" | "update" | "delete"
  | "send-adt" | "send-fhir" | "send-document"
  | "break-glass" | "denied"
  | "ai-suggest" | "ai-accept" | "ai-reject"
  | "export";

export interface AuditEntry {
  id: number;
  at: string; // ISO
  user: string;
  role: string;
  action: AuditAction;
  /** What was touched, for example "Chart V100003" or "Lab order LO-12". */
  target: string;
  patient?: string;
  detail?: string;
}

const KEY = "onasi-emr-audit-v1";
let entries: AuditEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    entries = JSON.parse(raw) as AuditEntry[];
    nextId = entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  }
} catch {
  /* storage may be blocked */
}

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-2000)));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** The session module sets this so audit entries carry the current user. */
let whoami: () => { user: string; role: string } = () => ({ user: "Unknown", role: "None" });
export function setAuditIdentity(fn: () => { user: string; role: string }) {
  whoami = fn;
}

export function audit(action: AuditAction, target: string, extra: { patient?: string; detail?: string } = {}) {
  const who = whoami();
  entries = [...entries, { id: nextId++, at: new Date().toISOString(), ...who, action, target, ...extra }];
  emit();
}

export function clearAudit() {
  entries = [];
  emit();
}

export function useAudit(): AuditEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => entries,
    () => entries,
  );
}
