import { useSyncExternalStore } from "react";
import { audit, setAuditIdentity } from "./audit";

/**
 * Demo session: who is signed in, what their role may do, break-the-glass access and the idle lock.
 * Real systems use single sign-on and server-side checks. This shows how the screens should behave.
 */

export type Permission =
  | "patient.read" | "patient.register" | "adt.send" | "emr.read" | "emr.write"
  | "order.lab" | "order.rad" | "rx.write" | "rx.dispense" | "lab.result" | "rad.report"
  | "docs.publish" | "confidential.read" | "audit.read" | "admin" | "ai.use" | "billing";

export interface Role {
  id: string;
  label: string;
  permissions: Permission[];
}

export interface DemoUser {
  id: string;
  name: string;
  role: string;
  department: string;
  /** Id in the national provider directory, sent as Practitioner.identifier on NPHIES documents. Made-up demo values. */
  providerId?: string;
}

const ALL: Permission[] = [
  "patient.read", "patient.register", "adt.send", "emr.read", "emr.write", "order.lab", "order.rad", "rx.write",
  "rx.dispense", "lab.result", "rad.report", "docs.publish", "confidential.read", "audit.read", "admin", "ai.use", "billing",
];

export const ROLES: Role[] = [
  { id: "physician", label: "Physician", permissions: ["patient.read", "adt.send", "emr.read", "emr.write", "order.lab", "order.rad", "rx.write", "docs.publish", "ai.use"] },
  { id: "nurse", label: "Nurse", permissions: ["patient.read", "adt.send", "emr.read", "emr.write", "ai.use"] },
  { id: "registration", label: "Registration Clerk", permissions: ["patient.read", "patient.register", "adt.send"] },
  { id: "pharmacist", label: "Pharmacist", permissions: ["patient.read", "emr.read", "rx.dispense"] },
  { id: "lab", label: "Lab Technologist", permissions: ["patient.read", "lab.result"] },
  { id: "radiologist", label: "Radiologist", permissions: ["patient.read", "emr.read", "rad.report"] },
  { id: "billing", label: "Billing Officer", permissions: ["patient.read", "billing"] },
  { id: "auditor", label: "Compliance Auditor", permissions: ["audit.read", "patient.read"] },
  { id: "admin", label: "System Administrator", permissions: ALL },
];

export const USERS: DemoUser[] = [
  { id: "U1", name: "Dr. Khalid Alharbi", role: "physician", department: "General Medicine" },
  { id: "U2", name: "Huda Alotaibi, RN", role: "nurse", department: "Ward 3A" },
  { id: "U3", name: "Omar Alshehri", role: "registration", department: "Front Desk" },
  { id: "U4", name: "Noura Alzahrani, PharmD", role: "pharmacist", department: "Pharmacy" },
  { id: "U5", name: "Faisal Alqahtani, MLT", role: "lab", department: "Laboratory", providerId: "T5001" },
  { id: "U6", name: "Dr. Layla Alanazi", role: "radiologist", department: "Radiology", providerId: "R6001" },
  { id: "U7", name: "Majed Aldosari", role: "billing", department: "RCM" },
  { id: "U8", name: "Reem Alghamdi", role: "auditor", department: "Compliance" },
  { id: "U9", name: "System Administrator", role: "admin", department: "IT", providerId: "A9001" },
];

const KEY = "onasi-emr-session-v1";

interface State {
  userId: string;
  /** Patients opened with break-the-glass: patient id to expiry (ms). */
  glass: Record<string, number>;
  locked: boolean;
  /** Idle minutes before the screen locks. 0 turns it off. */
  idleMinutes: number;
}

let state: State = { userId: "U1", glass: {}, locked: false, idleMinutes: 10 };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<State>), locked: false };
} catch {
  /* ignore */
}

const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const currentUser = (): DemoUser => USERS.find((u) => u.id === state.userId) ?? USERS[0];
export const roleOf = (u: DemoUser): Role => ROLES.find((r) => r.id === u.role) ?? ROLES[0];

setAuditIdentity(() => ({ user: currentUser().name, role: roleOf(currentUser()).label }));

export function can(p: Permission): boolean {
  return roleOf(currentUser()).permissions.includes(p);
}

export function switchUser(id: string) {
  set({ userId: id });
  audit("login", "Session", { detail: `Switched to ${currentUser().name}` });
}

export function lockScreen() {
  audit("lock", "Session", { detail: "Idle lock" });
  set({ locked: true });
}
export function unlockScreen() {
  set({ locked: false });
  audit("unlock", "Session");
}
export function setIdleMinutes(m: number) {
  set({ idleMinutes: m });
}

/** Break the glass: open a confidential record with a reason. Access lasts 30 minutes and is audited. */
export function breakGlass(patientId: string, patientName: string, reason: string) {
  set({ glass: { ...state.glass, [patientId]: Date.now() + 30 * 60_000 } });
  audit("break-glass", `Confidential record ${patientName}`, { patient: patientId, detail: reason });
}
export function hasGlass(patientId: string): boolean {
  return (state.glass[patientId] ?? 0) > Date.now();
}

export function useSession(): State & { user: DemoUser; role: Role } {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
  const user = USERS.find((u) => u.id === s.userId) ?? USERS[0];
  return { ...s, user, role: roleOf(user) };
}
