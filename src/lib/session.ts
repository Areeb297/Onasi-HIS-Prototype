import { useSyncExternalStore } from "react";
import { audit, setAuditIdentity } from "./audit";
import { PERMISSION_LABELS } from "./permission-labels";

/**
 * Demo session: who is signed in, what their role may do, break-the-glass access and the idle lock.
 * Real systems use single sign-on and server-side checks. This shows how the screens should behave.
 */

export type Permission =
  | "patient.read" | "patient.register" | "adt.send" | "emr.read" | "emr.write"
  | "order.lab" | "order.rad" | "rx.write" | "rx.dispense" | "lab.result" | "rad.perform" | "rad.report"
  | "docs.publish" | "confidential.read" | "audit.read" | "admin" | "ai.use" | "billing"
  // Segregation of duties inside finance. Each maps to RoleMenuPermissions rows in the HIS.
  | "cashier" | "approvals" | "coding";

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

/** Every permission, from the label list, so a new permission can never be left off the administrator. */
const ALL = Object.keys(PERMISSION_LABELS) as Permission[];

export const ROLES: Role[] = [
  { id: "physician", label: "Physician", permissions: ["patient.read", "adt.send", "emr.read", "emr.write", "order.lab", "order.rad", "rx.write", "docs.publish", "ai.use"] },
  { id: "nurse", label: "Nurse", permissions: ["patient.read", "patient.register", "adt.send", "emr.read", "emr.write", "ai.use"] },
  { id: "registration", label: "Registration Clerk", permissions: ["patient.read", "patient.register", "adt.send"] },
  { id: "pharmacist", label: "Pharmacist", permissions: ["patient.read", "emr.read", "rx.dispense"] },
  { id: "lab", label: "Lab Technologist", permissions: ["patient.read", "lab.result"] },
  // Radiologists also perform ultrasound and fluoroscopy, so they carry rad.perform as well as rad.report.
  { id: "radiologist", label: "Radiologist", permissions: ["patient.read", "emr.read", "rad.perform", "rad.report"] },
  // Performs the exam; never signs the report. HIS: RadiologyPermissions rows for the perform stages only.
  { id: "rad-tech", label: "Radiology Technician", permissions: ["patient.read", "rad.perform"] },
  { id: "billing", label: "Billing Officer", permissions: ["patient.read", "billing"] },
  // Segregation of duties: each finance role holds only its own duty, never "billing" (claims, rules, ZATCA).
  { id: "cashier", label: "Cashier", permissions: ["patient.read", "cashier"] },
  { id: "approvals", label: "Insurance Approvals Officer", permissions: ["patient.read", "approvals"] },
  { id: "coder", label: "Medical Coder", permissions: ["patient.read", "emr.read", "coding"] },
  // Admission office: assigns beds, transfers and the bed board. No registration, no chart, no billing.
  { id: "bed-manager", label: "Bed Manager", permissions: ["patient.read", "adt.send"] },
  { id: "auditor", label: "Compliance Auditor", permissions: ["audit.read", "patient.read"] },
  { id: "admin", label: "System Administrator", permissions: ALL },
];

export const USERS: DemoUser[] = [
  { id: "U1", name: "Dr. Khalid Alharbi", role: "physician", department: "General Medicine" },
  { id: "U2", name: "Huda Alotaibi, RN", role: "nurse", department: "Ward 3A" },
  { id: "U3", name: "Omar Alshehri", role: "registration", department: "Front Desk" },
  { id: "U4", name: "Noura Alzahrani, PharmD", role: "pharmacist", department: "Pharmacy" },
  { id: "U5", name: "Faisal Alqahtani, MLT", role: "lab", department: "Laboratory", providerId: "T5001" },
  // A second lab user, so a result entered by one technologist can be verified by another.
  { id: "U10", name: "Sara Alshammari, Lab Supervisor", role: "lab", department: "Laboratory", providerId: "T5002" },
  { id: "U6", name: "Dr. Layla Alanazi", role: "radiologist", department: "Radiology", providerId: "R6001" },
  { id: "U7", name: "Majed Aldosari", role: "billing", department: "RCM" },
  { id: "U8", name: "Reem Alghamdi", role: "auditor", department: "Compliance" },
  { id: "U9", name: "System Administrator", role: "admin", department: "IT", providerId: "A9001" },
  // Roles every Saudi hospital has. A triage nurse is an HIS Users row with the Nurse role in the ER department.
  { id: "U11", name: "Amal Alsubaie, RN", role: "nurse", department: "Emergency Triage" },
  { id: "U12", name: "Turki Almutairi", role: "bed-manager", department: "Admission Office" },
  { id: "U13", name: "Nawaf Albaqami", role: "cashier", department: "Cashier" },
  { id: "U14", name: "Hessa Aldossary", role: "approvals", department: "Insurance Approvals" },
  { id: "U15", name: "Rana Alharthi", role: "coder", department: "Medical Coding" },
  { id: "U16", name: "Bandar Alshahrani, RT", role: "rad-tech", department: "Radiology" },
];

const KEY = "onasi-emr-session-v1";

interface State {
  userId: string;
  /** Patients opened with break-the-glass: patient id to expiry (ms). */
  glass: Record<string, number>;
  locked: boolean;
  /** Idle minutes before the screen locks. 0 turns it off. */
  idleMinutes: number;
  /** False shows the sign-in page. A browser that never signed in starts signed out. */
  signedIn: boolean;
}

/** Idle lock range in minutes. It cannot be switched off: an unattended screen must lock. */
export const IDLE_MIN = 1;
export const IDLE_MAX = 30;
export const clampIdle = (m: number) => (Number.isFinite(Number(m)) ? Math.min(IDLE_MAX, Math.max(IDLE_MIN, Math.round(Number(m)))) : 10);

let state: State = { userId: "U1", glass: {}, locked: false, idleMinutes: 10, signedIn: false };
try {
  const raw = localStorage.getItem(KEY);
  // A locked screen stays locked after a reload, so reloading the page is not a way past the lock.
  if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<State>) };
  state.idleMinutes = clampIdle(state.idleMinutes);
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

/** A list means any one of them, as a menu entry several roles share (Invoice Worklist: billing or cashier). */
export type PermissionNeed = Permission | readonly Permission[];
export const hasNeed = (perms: readonly Permission[], need: PermissionNeed): boolean =>
  typeof need === "string" ? perms.includes(need) : need.some((p) => perms.includes(p));

export function can(p: PermissionNeed): boolean {
  return hasNeed(roleOf(currentUser()).permissions, p);
}

export function switchUser(id: string) {
  set({ userId: id });
  audit("login", "Session", { detail: `Switched to ${currentUser().name}` });
}

/** From the lock screen: a different person signs in as themselves instead of carrying on in the locked session. */
export function signInFromLock(id: string) {
  audit("logout", "Session", { detail: `${currentUser().name} signed out at the lock screen` });
  set({ userId: id, glass: {}, locked: false });
  audit("login", "Session", { detail: `${currentUser().name} signed in at the lock screen` });
}

/**
 * The demo account for a sign-in email: a staff first or last name before the @ (khalid@, noura.alzahrani@, admin@).
 * shortcut: no password check, any password signs in; the real HIS checks the password on the server.
 */
export function userForEmail(email: string): DemoUser | undefined {
  const words = email.toLowerCase().split("@")[0].split(/[._-]+/).filter(Boolean);
  if (words.includes("admin")) return USERS.find((u) => u.role === "admin");
  return USERS.find((u) => u.name.toLowerCase().replace(/^dr\. /, "").split(/[ ,]+/).some((n) => words.includes(n)));
}

export function signIn(id: string) {
  set({ userId: id, glass: {}, locked: false, signedIn: true });
  audit("login", "Session", { detail: `${currentUser().name} signed in` });
}

export function signOut() {
  audit("logout", "Session", { detail: `${currentUser().name} signed out` });
  set({ glass: {}, locked: false, signedIn: false });
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
  set({ idleMinutes: clampIdle(m) });
}

/** Break the glass: open a confidential record with a reason. Access lasts 30 minutes and is audited. */
export function breakGlass(patientId: string, patientName: string, reason: string): boolean {
  if (!reason.trim()) return false;
  set({ glass: { ...state.glass, [patientId]: Date.now() + 30 * 60_000 } });
  audit("break-glass", `Confidential record ${patientName}`, { patient: patientId, detail: reason.trim() });
  return true;
}
export function hasGlass(patientId: string): boolean {
  return (state.glass[patientId] ?? 0) > Date.now();
}

/** Calls back whenever the signed-in user or the session changes. Returns the unsubscribe function. */
export function onSessionChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
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

/** A triage level is a clinical judgement: only a nurse or a doctor may set it. A registration clerk leaves it for triage. */
export const canSetTriage = (): boolean => can("emr.write");
