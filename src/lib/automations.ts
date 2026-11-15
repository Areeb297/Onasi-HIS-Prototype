import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { currentUser, roleOf, USERS } from "./session";

/**
 * Automations: flows a hospital builds on a canvas. A flow starts from one HIS event (a trigger), checks fields
 * (conditions), waits, asks a named role to approve, and then acts: it notifies people, puts tasks on worklists or,
 * after a person approves, asks for a consult, a follow-up or a prior authorization.
 *
 * The rule from the rest of the app holds here: an automation never changes a patient or billing record silently.
 * An action that would change a record runs only after an Approval step on the same path. Notifications, reminders,
 * worklist tasks and audit notes change no record and run straight away.
 *
 * This file holds the catalogues, the pure flow helpers (validation, conditions, layout), the seven templates and the
 * store. The engine that runs flows against live events is in automation-engine.ts. Browser storage only.
 */

/* ---------- geometry ---------- */

export const NODE_W = 232;
export const NODE_H = 76;
export const GRID = 20;
export const snap = (n: number) => Math.round(n / GRID) * GRID;

/* ---------- node kinds ---------- */

export type NodeKind = "trigger" | "condition" | "action" | "wait" | "approval" | "branch" | "end";
export const NODE_KINDS: NodeKind[] = ["trigger", "condition", "action", "wait", "approval", "branch", "end"];

export interface KindDef {
  kind: NodeKind;
  label: string;
  /** One line for the palette. */
  hint: string;
  /** Exits at the bottom of the node. */
  ports: Port[];
}

export type Port = "out" | "yes" | "no";
export const PORT_LABEL: Record<Port, string> = { out: "Next", yes: "Yes", no: "No" };

export const KINDS: Record<NodeKind, KindDef> = {
  trigger: { kind: "trigger", label: "Trigger", hint: "The HIS event that starts the flow.", ports: ["out"] },
  condition: { kind: "condition", label: "Condition", hint: "Checks a field. Goes Yes or No.", ports: ["yes", "no"] },
  action: { kind: "action", label: "Action", hint: "Notifies, adds a task or asks for something.", ports: ["out"] },
  wait: { kind: "wait", label: "Wait", hint: "Pauses for a set time.", ports: ["out"] },
  approval: { kind: "approval", label: "Approval", hint: "Waits for a named role to approve.", ports: ["out"] },
  branch: { kind: "branch", label: "Branch", hint: "Runs every path that leaves it.", ports: ["out"] },
  end: { kind: "end", label: "End", hint: "The flow stops here.", ports: [] },
};

/* ---------- hospital roles ---------- */

export type RoleId =
  | "ed-doctor" | "charge-nurse" | "ward-nurse" | "attending" | "consultant" | "approvals" | "biller"
  | "bed-manager" | "appointments" | "pharmacist" | "lab";

export interface HospitalRole {
  id: RoleId;
  label: string;
  /** The app role (session.ts) whose users act for this role. An administrator can act for every role. */
  appRole: string;
}

export const HOSPITAL_ROLES: HospitalRole[] = [
  { id: "ed-doctor", label: "Emergency Doctor", appRole: "physician" },
  { id: "charge-nurse", label: "Charge Nurse", appRole: "nurse" },
  { id: "ward-nurse", label: "Ward Nurse", appRole: "nurse" },
  { id: "attending", label: "Attending Doctor", appRole: "physician" },
  { id: "consultant", label: "Consultant", appRole: "physician" },
  { id: "approvals", label: "Insurance Approvals Officer", appRole: "billing" },
  { id: "biller", label: "Billing Officer", appRole: "billing" },
  { id: "bed-manager", label: "Bed Manager", appRole: "registration" },
  { id: "appointments", label: "Appointments Desk", appRole: "registration" },
  { id: "pharmacist", label: "Pharmacist", appRole: "pharmacist" },
  { id: "lab", label: "Lab Technologist", appRole: "lab" },
];
export const ROLE_BY_ID = Object.fromEntries(HOSPITAL_ROLES.map((r) => [r.id, r])) as Record<RoleId, HospitalRole>;
export const roleLabel = (id?: string) => (id && ROLE_BY_ID[id as RoleId]?.label) || "No role chosen";

/** Whether the signed-in user may act for a hospital role (approve, acknowledge). */
export function actsFor(role: RoleId | undefined, user = currentUser()): boolean {
  if (!role) return false;
  const app = roleOf(user).id;
  return app === "admin" || ROLE_BY_ID[role]?.appRole === app;
}

export const PEOPLE = USERS.filter((u) => u.role !== "admin" && u.role !== "auditor").map((u) => u.name);

/* ---------- worklists ---------- */

export const WORKLISTS = [
  "Emergency Department", "Ward Nursing", "Bed Management", "Insurance Approvals", "Billing Worklist", "Pharmacy", "Appointments Desk", "Laboratory",
] as const;
export type Worklist = (typeof WORKLISTS)[number];

/* ---------- fields ---------- */

export type FieldType = "number" | "choice" | "text" | "yes-no";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string;
  /** Read again from the record when the condition runs (for a check after a wait). */
  live?: boolean;
}

export const FIELDS: Record<string, FieldDef> = {
  ctas: { key: "ctas", label: "CTAS Level", type: "number", options: ["1", "2", "3", "4", "5"] },
  area: { key: "area", label: "Emergency Area", type: "choice", options: ["Resus", "Acute", "Fast Track", "Waiting Room"] },
  complaint: { key: "complaint", label: "Chief Complaint", type: "text" },
  payer: { key: "payer", label: "Payer", type: "choice", options: ["Cash", "Bupa Arabia", "Tawuniya", "MedGulf", "Daman", "NextCare", "Malath Insurance"] },
  ward: { key: "ward", label: "Ward", type: "choice", options: ["3A", "4B", "ICU"] },
  age: { key: "age", label: "Age", type: "number", unit: "years" },
  sex: { key: "sex", label: "Sex", type: "choice", options: ["Male", "Female"] },
  patientClass: { key: "patientClass", label: "Patient Class", type: "choice", options: ["Inpatient", "Outpatient", "Emergency"] },
  test: { key: "test", label: "Test", type: "text" },
  resultFlag: { key: "resultFlag", label: "Result Flag", type: "choice", options: ["Critical High", "Critical Low"] },
  acknowledged: { key: "acknowledged", label: "Alert Acknowledged", type: "yes-no", live: true },
  admissionType: { key: "admissionType", label: "Admission Type", type: "choice", options: ["Elective", "Emergency"] },
  department: { key: "department", label: "Department", type: "choice", options: ["Medicine", "Surgery", "Orthopedics", "Intensive Care"] },
  amount: { key: "amount", label: "Amount", type: "number", unit: "SAR" },
  stillPended: { key: "stillPended", label: "Still Pended", type: "yes-no", live: true },
  hoursPended: { key: "hoursPended", label: "Hours Pended", type: "number", unit: "hours", live: true },
  daysOverdue: { key: "daysOverdue", label: "Days Overdue", type: "number", unit: "days" },
  hoursSinceVitals: { key: "hoursSinceVitals", label: "Hours Since Vital Signs", type: "number", unit: "hours", live: true },
  clearancesMissing: { key: "clearancesMissing", label: "Clearances Missing", type: "number", live: true },
  clinic: { key: "clinic", label: "Clinic", type: "text" },
};

/* ---------- triggers ---------- */

export type TriggerId =
  | "patient-registered" | "appointment-checked-in" | "triage-set" | "critical-lab" | "admission-requested" | "patient-admitted"
  | "discharge-ordered" | "claim-rejected" | "prior-auth-pended" | "invoice-overdue" | "vitals-overdue";

export interface TriggerDef {
  id: TriggerId;
  label: string;
  /** Where the event comes from, in plain words. */
  from: string;
  fields: string[];
}

export const TRIGGERS: TriggerDef[] = [
  { id: "patient-registered", label: "Patient Registered", from: "A new patient file is saved at registration.", fields: ["age", "sex", "payer"] },
  { id: "appointment-checked-in", label: "Appointment Checked In", from: "Reception checks a booked patient in and the visit opens.", fields: ["clinic", "payer", "age", "sex"] },
  { id: "triage-set", label: "Triage Level Set", from: "A nurse or doctor saves the CTAS level on the emergency board.", fields: ["ctas", "area", "complaint", "age", "payer"] },
  { id: "critical-lab", label: "Critical Lab Result Released", from: "The lab verifies and releases a result flagged critical.", fields: ["test", "resultFlag", "ward", "patientClass", "acknowledged", "age"] },
  { id: "admission-requested", label: "Admission Requested", from: "A doctor sends an admission request.", fields: ["admissionType", "department", "payer", "age"] },
  { id: "patient-admitted", label: "Patient Admitted", from: "An admission is sent (A01, or A06 from the emergency or clinic).", fields: ["ward", "department", "payer", "age"] },
  { id: "discharge-ordered", label: "Discharge Ordered", from: "The doctor gives the Clinical clearance: the patient is fit to leave.", fields: ["ward", "payer", "clearancesMissing", "age"] },
  { id: "claim-rejected", label: "Claim Rejected", from: "NPHIES returns a rejected claim.", fields: ["payer", "amount", "patientClass"] },
  { id: "prior-auth-pended", label: "Prior Authorization Pended", from: "The payer pends a prior authorization request.", fields: ["payer", "amount", "stillPended", "hoursPended"] },
  { id: "invoice-overdue", label: "Invoice Overdue", from: "A finished visit still has a patient balance after a day.", fields: ["amount", "daysOverdue", "payer"] },
  { id: "vitals-overdue", label: "Vital Signs Overdue", from: "An inpatient has no vital signs recorded for 4 hours or more.", fields: ["ward", "hoursSinceVitals", "age"] },
];
export const TRIGGER_BY_ID = Object.fromEntries(TRIGGERS.map((t) => [t.id, t])) as Record<TriggerId, TriggerDef>;

/* ---------- actions ---------- */

export type ActionKind =
  | "notify" | "reminder" | "create-task" | "audit-note" | "start-clearances" | "request-consult" | "request-follow-up" | "ask-prior-auth" | "claim-review";

export interface ActionDef {
  id: ActionKind;
  label: string;
  /** True when the action changes a patient or billing record. It then needs an Approval step before it. */
  changesRecord: boolean;
  /** Settings the action must have. */
  needs: (keyof NodeSettings)[];
  hint: string;
}

export const ACTIONS: ActionDef[] = [
  { id: "notify", label: "Notify A Role Or Person", changesRecord: false, needs: ["message"], hint: "An in-app message. Changes no record." },
  { id: "reminder", label: "Send A Reminder", changesRecord: false, needs: ["role", "message"], hint: "An in-app reminder to a role. Changes no record." },
  { id: "create-task", label: "Create A Worklist Task", changesRecord: false, needs: ["worklist", "message"], hint: "Puts a task on a worklist. Changes no record." },
  { id: "audit-note", label: "Add An Audit Note", changesRecord: false, needs: ["message"], hint: "Writes a note to the audit log." },
  { id: "start-clearances", label: "Start The Discharge Clearances", changesRecord: false, needs: [], hint: "Asks the doctor, pharmacy, nursing and finance for each clearance still missing." },
  { id: "request-consult", label: "Request A Consult", changesRecord: true, needs: ["specialty", "urgency", "message"], hint: "Creates a consult request on the visit. Needs approval first." },
  { id: "request-follow-up", label: "Request A Follow-Up", changesRecord: true, needs: ["clinic", "days"], hint: "Creates a follow-up booking request. Needs approval first." },
  { id: "ask-prior-auth", label: "Ask For Prior Authorization", changesRecord: true, needs: [], hint: "Sends the prior authorization request to NPHIES. Needs approval first." },
  { id: "claim-review", label: "Put The Claim In Review", changesRecord: true, needs: ["message"], hint: "Holds the claim for review before it is sent again. Needs approval first." },
];
export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionKind, ActionDef>;
export const changesRecord = (n: Pick<FlowNode, "kind" | "settings">): boolean => n.kind === "action" && !!n.settings.action && ACTION_BY_ID[n.settings.action]?.changesRecord;

export const CONSULT_SPECIALTIES = ["Cardiology", "General Surgery", "Orthopedics", "Intensive Care", "Neurology", "Nephrology", "Pulmonology", "Infectious Diseases", "Endocrinology"];
export const FOLLOW_UP_CLINICS = ["General Medicine Clinic", "Family Medicine Clinic", "Surgery Clinic", "Orthopedics Clinic", "Cardiology Clinic", "Diabetes And Endocrine Clinic"];

/* ---------- flow ---------- */

export type CondOp = "is" | "is-not" | "at-least" | "at-most" | "contains";
export const OP_LABEL: Record<CondOp, string> = { is: "Is", "is-not": "Is Not", "at-least": "Is At Least", "at-most": "Is At Most", contains: "Contains" };
export const opsFor = (t: FieldType): CondOp[] =>
  t === "number" ? ["is", "is-not", "at-least", "at-most"] : t === "text" ? ["contains", "is", "is-not"] : ["is", "is-not"];

export interface NodeSettings {
  trigger?: TriggerId;
  field?: string;
  op?: CondOp;
  value?: string;
  action?: ActionKind;
  role?: RoleId;
  person?: string;
  worklist?: Worklist;
  message?: string;
  specialty?: string;
  urgency?: "routine" | "urgent" | "emergency";
  clinic?: string;
  days?: number;
  minutes?: number;
  note?: string;
}

export interface FlowNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** A name the builder gives. Empty: the node is named from its settings. */
  label?: string;
  settings: NodeSettings;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  port: Port;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type AutomationStatus = "draft" | "active" | "paused";
export const STATUS_LABEL: Record<AutomationStatus, string> = { draft: "Draft", active: "Active", paused: "Paused" };

export interface Automation {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  flow: Flow;
  templateId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export const triggerOf = (flow: Flow): TriggerId | undefined => flow.nodes.find((n) => n.kind === "trigger")?.settings.trigger;

/* ---------- node text ---------- */

const minutesWords = (m: number): string => {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"}`;
};
export { minutesWords };

/** The main line on a node: its own name, or one made from its settings. */
export function nodeTitle(n: FlowNode): string {
  if (n.label?.trim()) return n.label.trim();
  const s = n.settings;
  switch (n.kind) {
    case "trigger": return s.trigger ? TRIGGER_BY_ID[s.trigger].label : "Choose A Trigger";
    case "condition": return s.field ? `${FIELDS[s.field]?.label ?? s.field} ${OP_LABEL[s.op ?? "is"]} ${valueText(s)}` : "Choose A Field";
    case "action": return s.action ? ACTION_BY_ID[s.action].label : "Choose An Action";
    case "wait": return s.minutes ? `Wait ${minutesWords(s.minutes)}` : "Set The Wait";
    case "approval": return s.role ? `${roleLabel(s.role)} Approves` : "Choose Who Approves";
    case "branch": return "Run Every Path";
    case "end": return "End";
  }
}

/** The quiet second line on a node. */
export function nodeDetail(n: FlowNode): string {
  const s = n.settings;
  switch (n.kind) {
    case "trigger": return s.trigger ? TRIGGER_BY_ID[s.trigger].from : "Pick the HIS event that starts this flow.";
    case "condition": return "Yes goes left, No goes right.";
    case "action": {
      if (!s.action) return "Pick what happens.";
      if (s.action === "notify") return `To ${s.person || roleLabel(s.role)}`;
      if (s.action === "reminder") return `To ${roleLabel(s.role)}`;
      if (s.action === "create-task") return s.worklist ? `On ${s.worklist}` : "Choose the worklist";
      if (s.action === "request-consult") return `${s.specialty ?? "No specialty"}, ${s.urgency ?? "routine"}`;
      if (s.action === "request-follow-up") return `${s.clinic ?? "No clinic"} in ${s.days ?? "?"} days`;
      return ACTION_BY_ID[s.action].hint;
    }
    case "wait": return "The flow pauses, then goes on.";
    case "approval": return s.note || "Nothing after this runs until approved.";
    case "branch": return "Each path runs on its own.";
    case "end": return s.note || "Nothing more happens.";
  }
}

function valueText(s: NodeSettings): string {
  const f = s.field ? FIELDS[s.field] : undefined;
  if (f?.type === "yes-no") return s.value === "no" ? "No" : "Yes";
  if (!s.value) return "(no value)";
  return f?.unit === "SAR" ? `${Number(s.value).toLocaleString("en-US")} SAR` : `${s.value}${f?.unit && f.unit !== "SAR" ? ` ${f.unit}` : ""}`;
}

/* ---------- conditions ---------- */

export type FieldValue = string | number | boolean;

export interface CondResult {
  pass: boolean;
  /** "CTAS Level is 2, needed at most 2." */
  text: string;
  /** The field was not in the event. */
  missing: boolean;
}

const asText = (v: FieldValue | undefined) => (v === true ? "Yes" : v === false ? "No" : v === undefined || v === "" ? "not recorded" : String(v));

/** Checks one condition against the event fields. A missing field never passes. */
export function evaluateCondition(s: NodeSettings, fields: Record<string, FieldValue | undefined>): CondResult {
  const f = s.field ? FIELDS[s.field] : undefined;
  if (!f) return { pass: false, text: "No field chosen.", missing: true };
  const actual = fields[f.key];
  const op = s.op ?? "is";
  const wanted = f.type === "yes-no" ? (s.value === "no" ? "No" : "Yes") : (s.value ?? "");
  const head = `${f.label} is ${asText(actual)}`;
  if (actual === undefined || actual === "") return { pass: false, text: `${f.label} is not recorded, so the answer is No.`, missing: true };
  let pass: boolean;
  if (f.type === "number") {
    const a = Number(actual), w = Number(wanted);
    pass = op === "at-least" ? a >= w : op === "at-most" ? a <= w : op === "is-not" ? a !== w : a === w;
  } else if (f.type === "yes-no") {
    const a = actual === true || String(actual).toLowerCase() === "yes";
    const w = wanted === "Yes";
    pass = op === "is-not" ? a !== w : a === w;
  } else {
    const a = String(actual).toLowerCase(), w = wanted.toLowerCase().trim();
    pass = op === "contains" ? a.includes(w) : op === "is-not" ? a !== w : a === w;
  }
  return { pass, text: `${head}. Rule: ${OP_LABEL[op].toLowerCase()} ${f.type === "yes-no" ? wanted : valueText(s)}. ${pass ? "Yes" : "No"}.`, missing: false };
}

/* ---------- validation ---------- */

export interface Issue {
  level: "error" | "warning";
  nodeId?: string;
  text: string;
}

const outEdges = (flow: Flow, id: string) => flow.edges.filter((e) => e.from === id);

/** Node ids that can be reached from a start without passing through any node in `avoid`. */
function reachable(flow: Flow, start: string, avoid: Set<string> = new Set()): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (id !== start && avoid.has(id)) continue;
    for (const e of outEdges(flow, id)) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  }
  return seen;
}

/** Cycles in the flow, each as its list of node ids. Found with Tarjan's strongly connected components. */
export function findCycles(flow: Flow): string[][] {
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const e of outEdges(flow, v)) {
      if (!idx.has(e.to)) { visit(e.to); low.set(v, Math.min(low.get(v)!, low.get(e.to)!)); }
      else if (on.has(e.to)) low.set(v, Math.min(low.get(v)!, idx.get(e.to)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== v);
      const self = flow.edges.some((e) => e.from === v && e.to === v);
      if (comp.length > 1 || self) out.push(comp);
    }
  };
  for (const n of flow.nodes) if (!idx.has(n.id)) visit(n.id);
  return out;
}

/** What a node still needs before the flow can run. Empty when its settings are complete. */
export function missingSettings(n: FlowNode): string[] {
  const s = n.settings;
  const miss: string[] = [];
  switch (n.kind) {
    case "trigger": if (!s.trigger) miss.push("the trigger"); break;
    case "condition":
      if (!s.field) miss.push("the field");
      else if (FIELDS[s.field]?.type !== "yes-no" && !(s.value ?? "").toString().trim()) miss.push("the value");
      else if (FIELDS[s.field]?.type === "number" && Number.isNaN(Number(s.value))) miss.push("a number for the value");
      break;
    case "wait": if (!s.minutes || s.minutes < 1) miss.push("how long to wait"); break;
    case "approval": if (!s.role) miss.push("who approves"); break;
    case "action": {
      if (!s.action) { miss.push("the action"); break; }
      if (s.action === "notify" && !s.role && !s.person) miss.push("who to notify");
      for (const k of ACTION_BY_ID[s.action].needs) {
        const v = s[k];
        if (v === undefined || v === "" || (typeof v === "number" && v < 1)) miss.push(SETTING_WORD[k] ?? String(k));
      }
      break;
    }
  }
  return miss;
}

const SETTING_WORD: Partial<Record<keyof NodeSettings, string>> = {
  message: "the message", role: "the role", worklist: "the worklist", specialty: "the specialty", urgency: "the urgency", clinic: "the clinic", days: "the number of days",
};

/**
 * Checks a flow before it can be activated: one trigger, no loose ends, nothing out of reach, no loop without a wait,
 * every setting filled in, and an Approval step before every action that changes a record.
 */
export function validateFlow(flow: Flow): Issue[] {
  const issues: Issue[] = [];
  const triggers = flow.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length === 0) issues.push({ level: "error", text: "Add a Trigger: every flow starts from one HIS event." });
  if (triggers.length > 1) for (const t of triggers.slice(1)) issues.push({ level: "error", nodeId: t.id, text: "A flow has one Trigger. Remove this one or make it a separate automation." });
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  for (const e of flow.edges) if (!byId.has(e.from) || !byId.has(e.to)) issues.push({ level: "error", text: "A connection points at a step that no longer exists." });

  for (const n of flow.nodes) {
    const outs = outEdges(flow, n.id);
    const ins = flow.edges.filter((e) => e.to === n.id);
    if (n.kind === "trigger" && ins.length) issues.push({ level: "error", nodeId: n.id, text: "Nothing can lead into the Trigger. It only starts the flow." });
    if (n.kind === "end" && outs.length) issues.push({ level: "error", nodeId: n.id, text: "An End step cannot lead anywhere." });
    if (n.kind !== "end") {
      for (const port of KINDS[n.kind].ports) {
        if (!outs.some((e) => e.port === port)) {
          issues.push({ level: "error", nodeId: n.id, text: n.kind === "condition" ? `Loose end: connect the ${PORT_LABEL[port]} path of "${nodeTitle(n)}".` : `Loose end: "${nodeTitle(n)}" leads nowhere. Connect it or add an End.` });
        }
      }
    }
    if (n.kind === "branch" && outs.length === 1) issues.push({ level: "warning", nodeId: n.id, text: "A Branch with one path does nothing. Add a second path or remove it." });
    const miss = missingSettings(n);
    if (miss.length) issues.push({ level: "error", nodeId: n.id, text: `Missing settings on "${nodeTitle(n)}": ${miss.join(", ")}.` });
  }

  const trig = triggers[0];
  if (trig) {
    const fromTrigger = reachable(flow, trig.id);
    for (const n of flow.nodes) if (!fromTrigger.has(n.id) && n.kind !== "trigger") issues.push({ level: "error", nodeId: n.id, text: `"${nodeTitle(n)}" cannot be reached from the Trigger.` });
    // A condition on a field the trigger does not give.
    const given = trig.settings.trigger ? TRIGGER_BY_ID[trig.settings.trigger].fields : [];
    for (const n of flow.nodes) {
      if (n.kind === "condition" && n.settings.field && trig.settings.trigger && !given.includes(n.settings.field)) {
        issues.push({ level: "warning", nodeId: n.id, text: `${TRIGGER_BY_ID[trig.settings.trigger].label} does not give ${FIELDS[n.settings.field]?.label ?? n.settings.field}. This check will always be No.` });
      }
    }
    // An action that changes a record must have an approval on every path from the trigger.
    const approvals = new Set(flow.nodes.filter((n) => n.kind === "approval").map((n) => n.id));
    const withoutApproval = reachable(flow, trig.id, approvals);
    for (const n of flow.nodes) {
      if (changesRecord(n) && withoutApproval.has(n.id)) {
        issues.push({ level: "error", nodeId: n.id, text: `"${nodeTitle(n)}" changes the record. Put an Approval step before it on every path.` });
      }
    }
  }

  for (const cycle of findCycles(flow)) {
    if (!cycle.some((id) => byId.get(id)?.kind === "wait")) {
      issues.push({ level: "error", nodeId: cycle[0], text: `A loop with no Wait would run without stopping: ${cycle.map((id) => nodeTitle(byId.get(id)!)).join(", ")}. Add a Wait inside it.` });
    }
  }
  return issues;
}

export const flowReady = (flow: Flow): boolean => !validateFlow(flow).some((i) => i.level === "error");

/* ---------- auto layout ---------- */

/**
 * Lays the flow out top to bottom. Each step goes one row below the furthest step that leads into it (loops are
 * ignored for this), steps in a row are ordered under their parents, Yes before No. Positions snap to the grid.
 */
export function autoLayout(flow: Flow, gapX = 48, gapY = 64): Flow {
  const ids = flow.nodes.map((n) => n.id);
  if (!ids.length) return flow;
  const root = flow.nodes.find((n) => n.kind === "trigger")?.id ?? ids[0];
  // Back edges found by depth-first search from the root, then from any node left over.
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const dfs = (v: string) => {
    state.set(v, 1);
    for (const e of outEdges(flow, v)) {
      const s = state.get(e.to);
      if (s === 1) back.add(e.id);
      else if (!s) dfs(e.to);
    }
    state.set(v, 2);
  };
  dfs(root);
  for (const id of ids) if (!state.has(id)) dfs(id);
  const forward = flow.edges.filter((e) => !back.has(e.id));
  // Longest path depth.
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    for (const e of forward) {
      const d = depth.get(e.from)! + 1;
      if (d > depth.get(e.to)!) { depth.set(e.to, d); changed = true; }
    }
    if (!changed) break;
  }
  const rows: string[][] = [];
  for (const id of ids) {
    const d = depth.get(id)!;
    (rows[d] ??= []).push(id);
  }
  const order = new Map<string, number>();
  const portRank: Record<Port, number> = { yes: 0, out: 1, no: 2 };
  rows.forEach((row, d) => {
    if (d === 0) { row.forEach((id, i) => order.set(id, i)); return; }
    const score = (id: string) => {
      const ins = forward.filter((e) => e.to === id && order.has(e.from));
      if (!ins.length) return 1e6;
      return ins.reduce((s, e) => s + order.get(e.from)! * 3 + portRank[e.port], 0) / ins.length;
    };
    row.sort((a, b) => score(a) - score(b));
    row.forEach((id, i) => order.set(id, i));
  });
  const pos = new Map<string, { x: number; y: number }>();
  rows.forEach((row, d) => {
    if (!row) return;
    const width = row.length * NODE_W + (row.length - 1) * gapX;
    row.forEach((id, i) => pos.set(id, { x: snap(-width / 2 + i * (NODE_W + gapX)), y: snap(d * (NODE_H + gapY)) }));
  });
  return { ...flow, nodes: flow.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })) };
}

/** The box around every node, in canvas units. */
export function flowBounds(flow: Flow): { x: number; y: number; w: number; h: number } {
  if (!flow.nodes.length) return { x: -NODE_W / 2, y: 0, w: NODE_W, h: NODE_H };
  const xs = flow.nodes.map((n) => n.x), ys = flow.nodes.map((n) => n.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) + NODE_W - x, h: Math.max(...ys) + NODE_H - y };
}

/* ---------- editing helpers (pure) ---------- */

export const newId = (prefix: string, flow: Flow) => {
  let i = flow.nodes.length + flow.edges.length + 1;
  const used = new Set([...flow.nodes.map((n) => n.id), ...flow.edges.map((e) => e.id)]);
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
};

export function defaultSettings(kind: NodeKind): NodeSettings {
  switch (kind) {
    case "wait": return { minutes: 30 };
    case "condition": return { op: "is" };
    case "action": return { action: "notify" };
    default: return {};
  }
}

export function addNode(flow: Flow, kind: NodeKind, x: number, y: number): { flow: Flow; id: string } {
  const id = newId("n", flow);
  return { id, flow: { ...flow, nodes: [...flow.nodes, { id, kind, x: snap(x), y: snap(y), settings: defaultSettings(kind) }] } };
}

export function removeNode(flow: Flow, id: string): Flow {
  return { nodes: flow.nodes.filter((n) => n.id !== id), edges: flow.edges.filter((e) => e.from !== id && e.to !== id) };
}

/** Connects a port to a node. A port that is not a Branch exit keeps one connection: the new one replaces the old. */
export function connect(flow: Flow, from: string, port: Port, to: string): Flow {
  if (from === to) return flow;
  const src = flow.nodes.find((n) => n.id === from);
  const dst = flow.nodes.find((n) => n.id === to);
  if (!src || !dst || src.kind === "end" || dst.kind === "trigger") return flow;
  if (flow.edges.some((e) => e.from === from && e.port === port && e.to === to)) return flow;
  const keep = src.kind === "branch" ? flow.edges : flow.edges.filter((e) => !(e.from === from && e.port === port));
  return { ...flow, edges: [...keep, { id: newId("e", flow), from, to, port }] };
}

export const removeEdge = (flow: Flow, id: string): Flow => ({ ...flow, edges: flow.edges.filter((e) => e.id !== id) });

export const updateNode = (flow: Flow, id: string, patch: Partial<Omit<FlowNode, "id">>): Flow =>
  ({ ...flow, nodes: flow.nodes.map((n) => (n.id === id ? { ...n, ...patch, settings: patch.settings ? { ...n.settings, ...patch.settings } : n.settings } : n)) });

/** The first free exit of a node, for joining a new step under it. */
export function freePort(flow: Flow, n: FlowNode): Port | null {
  if (n.kind === "branch") return "out";
  return KINDS[n.kind].ports.find((p) => !flow.edges.some((e) => e.from === n.id && e.port === p)) ?? null;
}

/* ---------- templates ---------- */

export interface Template {
  id: string;
  name: string;
  description: string;
  flow: Flow;
}

type Spec = [id: string, kind: NodeKind, settings: NodeSettings, label?: string];
type Link = [from: string, to: string, port?: Port];

function build(nodes: Spec[], links: Link[]): Flow {
  const flow: Flow = {
    nodes: nodes.map(([id, kind, settings, label]) => ({ id, kind, x: 0, y: 0, settings, ...(label ? { label } : {}) })),
    edges: links.map(([from, to, port], i) => ({ id: `e${i + 1}`, from, to, port: port ?? "out" })),
  };
  return autoLayout(flow);
}

export const TEMPLATES: Template[] = [
  {
    id: "tpl-ctas",
    name: "CTAS 1 And 2 Arrival Alert",
    description: "When triage sets CTAS 1 or 2, the emergency doctor and the charge nurse are alerted at once.",
    flow: build(
      [
        ["t", "trigger", { trigger: "triage-set" }],
        ["c", "condition", { field: "ctas", op: "at-most", value: "2" }],
        ["b", "branch", {}],
        ["a1", "action", { action: "notify", role: "ed-doctor", message: "CTAS {ctas} in {area}: {patient}, {complaint}. Please see now." }, "Alert The Emergency Doctor"],
        ["a2", "action", { action: "notify", role: "charge-nurse", message: "CTAS {ctas} arrival: {patient}. Please assign a nurse and a bed in {area}." }, "Alert The Charge Nurse"],
        ["end", "end", {}],
        ["skip", "end", { note: "CTAS 3 to 5 follow the normal queue." }],
      ],
      [["t", "c"], ["c", "b", "yes"], ["c", "skip", "no"], ["b", "a1"], ["b", "a2"], ["a1", "end"], ["a2", "end"]],
    ),
  },
  {
    id: "tpl-critical-lab",
    name: "Critical Lab Result Escalation",
    description: "A critical result goes to the attending doctor. Not acknowledged in 30 minutes, it goes to the consultant.",
    flow: build(
      [
        ["t", "trigger", { trigger: "critical-lab" }],
        ["a1", "action", { action: "notify", role: "attending", message: "Critical result: {test} ({resultFlag}) for {patient}, visit {visit}. Please acknowledge." }, "Tell The Attending Doctor"],
        ["w", "wait", { minutes: 30 }],
        ["c", "condition", { field: "acknowledged", op: "is", value: "no" }, "Not Acknowledged Yet"],
        ["a2", "action", { action: "notify", role: "consultant", message: "Not acknowledged after 30 minutes: {test} ({resultFlag}) for {patient}, visit {visit}." }, "Escalate To The Consultant"],
        ["a3", "action", { action: "audit-note", message: "Critical result {test} escalated to the consultant after 30 minutes without acknowledgement." }],
        ["end", "end", {}],
        ["ok", "end", { note: "Acknowledged in time." }],
      ],
      [["t", "a1"], ["a1", "w"], ["w", "c"], ["c", "a2", "yes"], ["c", "ok", "no"], ["a2", "a3"], ["a3", "end"]],
    ),
  },
  {
    id: "tpl-discharge",
    name: "Discharge Clearances And Follow-Up",
    description: "When the doctor clears an inpatient to leave, the other clearances are asked for and a follow-up is requested after the doctor approves.",
    flow: build(
      [
        ["t", "trigger", { trigger: "discharge-ordered" }],
        ["a1", "action", { action: "start-clearances" }],
        ["ap", "approval", { role: "attending", note: "Confirm the follow-up clinic and timing." }],
        ["a2", "action", { action: "request-follow-up", clinic: "General Medicine Clinic", days: 14, message: "Review after discharge. Bring your discharge summary." }],
        ["a3", "action", { action: "notify", role: "appointments", message: "Follow-up requested for {patient}. Please book it before the patient leaves." }, "Tell The Appointments Desk"],
        ["end", "end", {}],
      ],
      [["t", "a1"], ["a1", "ap"], ["ap", "a2"], ["a2", "a3"], ["a3", "end"]],
    ),
  },
  {
    id: "tpl-claim",
    name: "Rejected Claim Correction",
    description: "A rejected claim puts a correction task on the billing worklist. A large claim is held for review after approval.",
    flow: build(
      [
        ["t", "trigger", { trigger: "claim-rejected" }],
        ["a1", "action", { action: "create-task", worklist: "Billing Worklist", role: "biller", message: "Correct and resend the rejected claim for {patient}, visit {visit} ({payer})." }],
        ["c", "condition", { field: "amount", op: "at-least", value: "5000" }],
        ["ap", "approval", { role: "biller", note: "Approve holding the claim for review." }],
        ["a2", "action", { action: "claim-review", message: "Rejected by {payer}. Check codes and supporting documents before sending again." }],
        ["end", "end", {}],
        ["small", "end", { note: "Smaller claims are corrected from the task." }],
      ],
      [["t", "a1"], ["a1", "c"], ["c", "ap", "yes"], ["c", "small", "no"], ["ap", "a2"], ["a2", "end"]],
    ),
  },
  {
    id: "tpl-prior-auth",
    name: "Prior Authorization Pended 24 Hours",
    description: "A prior authorization still pended after 24 hours alerts the insurance approvals office.",
    flow: build(
      [
        ["t", "trigger", { trigger: "prior-auth-pended" }],
        ["w", "wait", { minutes: 1440 }],
        ["c", "condition", { field: "stillPended", op: "is", value: "yes" }],
        ["a1", "action", { action: "notify", role: "approvals", message: "Prior authorization for {patient} ({payer}) is still pended after 24 hours. Please follow up with the payer." }, "Alert The Approvals Office"],
        ["a2", "action", { action: "create-task", worklist: "Insurance Approvals", role: "approvals", message: "Call {payer} about the pended authorization for {patient}, visit {visit}." }],
        ["end", "end", {}],
        ["done", "end", { note: "The payer answered in time." }],
      ],
      [["t", "w"], ["w", "c"], ["c", "a1", "yes"], ["c", "done", "no"], ["a1", "a2"], ["a2", "end"]],
    ),
  },
  {
    id: "tpl-vitals",
    name: "Inpatient Vital Signs Reminder",
    description: "An inpatient with no vital signs for 4 hours reminds the ward nurse.",
    flow: build(
      [
        ["t", "trigger", { trigger: "vitals-overdue" }],
        ["c", "condition", { field: "hoursSinceVitals", op: "at-least", value: "4" }],
        ["a1", "action", { action: "reminder", role: "ward-nurse", message: "No vital signs for {patient} in {ward} for {hoursSinceVitals} hours. Please record them." }],
        ["end", "end", {}],
        ["ok", "end", { note: "Recorded in time." }],
      ],
      [["t", "c"], ["c", "a1", "yes"], ["c", "ok", "no"], ["a1", "end"]],
    ),
  },
  {
    id: "tpl-elective",
    name: "Elective Admission To Bed Management",
    description: "An elective admission request goes to bed management after the insurance approvals office approves it.",
    flow: build(
      [
        ["t", "trigger", { trigger: "admission-requested" }],
        ["c", "condition", { field: "admissionType", op: "is", value: "Elective" }],
        ["ap", "approval", { role: "approvals", note: "Approve when the payer has approved the admission, or the patient pays a deposit." }],
        ["a1", "action", { action: "create-task", worklist: "Bed Management", role: "bed-manager", message: "Assign a {department} bed for {patient}. Approved elective admission." }],
        ["a2", "action", { action: "notify", role: "bed-manager", message: "Elective admission approved for {patient}. A bed is needed in {department}." }, "Tell The Bed Manager"],
        ["end", "end", {}],
        ["er", "end", { note: "Emergency admissions go straight to a bed. Approval is asked within 24 hours." }],
      ],
      [["t", "c"], ["c", "ap", "yes"], ["c", "er", "no"], ["ap", "a1"], ["a1", "a2"], ["a2", "end"]],
    ),
  },
];
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t])) as Record<string, Template>;

/* ---------- runs ---------- */

export type StepStatus = "done" | "yes" | "no" | "waiting" | "approval" | "approved" | "declined" | "blocked" | "failed" | "simulated" | "end";

export interface RunStep {
  nodeId: string;
  kind: NodeKind;
  at: string;
  status: StepStatus;
  text: string;
}

export interface Token {
  node: string;
  /** This path went through an Approval step. */
  approved: boolean;
  /** ISO time a Wait ends. */
  until?: string;
  /** Waiting at an Approval step for this role. */
  awaiting?: RoleId;
}

export interface HisEvent {
  /** Stable key, so one event starts each flow once. */
  key: string;
  trigger: TriggerId;
  at: string;
  patientId?: string;
  patient: string;
  visit?: string;
  summary: string;
  fields: Record<string, FieldValue>;
  source: "audit" | "record" | "sample";
}

export type RunStatus = "running" | "waiting" | "approval" | "done" | "stopped";
export const RUN_STATUS_LABEL: Record<RunStatus, string> = { running: "Running", waiting: "Waiting", approval: "Waiting For Approval", done: "Finished", stopped: "Stopped" };

export interface Run {
  id: string;
  automationId: string;
  automationName: string;
  event: HisEvent;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  steps: RunStep[];
  tokens: Token[];
  /** A test run: nothing was done, the steps say what would have happened. */
  test?: boolean;
}

export interface Notice {
  id: string;
  runId: string;
  automationName: string;
  at: string;
  to: string;
  role?: RoleId;
  text: string;
  patient: string;
  visit?: string;
  kind: "notify" | "reminder";
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export interface AutoTask {
  id: string;
  runId: string;
  automationName: string;
  at: string;
  worklist: Worklist | string;
  role?: RoleId;
  text: string;
  patient: string;
  visit?: string;
  doneAt?: string;
  doneBy?: string;
}

export interface ClaimHold {
  visit: string;
  at: string;
  by: string;
  reason: string;
  runId: string;
}

/* ---------- store ---------- */

export interface AutomationState {
  automations: Automation[];
  runs: Run[];
  notices: Notice[];
  tasks: AutoTask[];
  holds: ClaimHold[];
  /** The last audit entry the engine has read, and the record events it has already started flows for. */
  checkpoint: { auditId: number; seen: Record<string, string>; started: boolean };
  seq: number;
  lastCheck?: string;
}

const KEY = "onasi-emr-automations-v1";
const RUN_MAX = 300;
const listeners = new Set<() => void>();
let state: AutomationState | null = null;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const isoAgo = (now: number, mins: number) => new Date(now - mins * 60_000).toISOString();

function fromTemplate(t: Template, id: string, status: AutomationStatus, at: string, by: string): Automation {
  return { id, name: t.name, description: t.description, status, flow: clone(t.flow), templateId: t.id, createdAt: at, createdBy: by, updatedAt: at };
}

/** Seven automations from the templates, some on and some not, with a little history so the list has something to show. */
export function seedAutomations(now: number = Date.now()): AutomationState {
  const by = "System Administrator";
  const statuses: Record<string, AutomationStatus> = {
    "tpl-ctas": "active", "tpl-critical-lab": "active", "tpl-discharge": "active", "tpl-claim": "active",
    "tpl-prior-auth": "paused", "tpl-vitals": "active", "tpl-elective": "draft",
  };
  const automations = TEMPLATES.map((t, i) => fromTemplate(t, `AUT-${i + 1}`, statuses[t.id], isoAgo(now, 60 * 24 * (12 - i)), by));
  const ev = (trigger: TriggerId, mins: number, patient: string, visit: string, fields: Record<string, FieldValue>, summary: string): HisEvent => ({
    key: `seed:${trigger}:${visit}`, trigger, at: isoAgo(now, mins), patient, visit, fields, summary, source: "audit",
  });
  const st = (nodeId: string, kind: NodeKind, mins: number, status: StepStatus, text: string): RunStep => ({ nodeId, kind, at: isoAgo(now, mins), status, text });
  const runs: Run[] = [
    {
      id: "RUN-3", automationId: "AUT-1", automationName: TEMPLATES[0].name, startedAt: isoAgo(now, 8), finishedAt: isoAgo(now, 8), status: "done", tokens: [],
      event: ev("triage-set", 8, "Faisal Almansour", "V100012", { ctas: 1, area: "Resus", complaint: "Chest pain and sweating", age: 64, payer: "Tawuniya" }, "Triage set CTAS 1"),
      steps: [
        st("t", "trigger", 8, "done", "Triage Level Set: CTAS 1 for Faisal Almansour, visit V100012."),
        st("c", "condition", 8, "yes", "CTAS Level is 1. Rule: is at most 2. Yes."),
        st("b", "branch", 8, "done", "Runs 2 paths."),
        st("a1", "action", 8, "done", "Notified Emergency Doctor: CTAS 1 in Resus: Faisal Almansour, Chest pain and sweating. Please see now."),
        st("a2", "action", 8, "done", "Notified Charge Nurse: CTAS 1 arrival: Faisal Almansour. Please assign a nurse and a bed in Resus."),
        st("end", "end", 8, "end", "Finished."),
      ],
    },
    {
      id: "RUN-2", automationId: "AUT-1", automationName: TEMPLATES[0].name, startedAt: isoAgo(now, 16), finishedAt: isoAgo(now, 16), status: "done", tokens: [],
      event: ev("triage-set", 16, "Hanan Alshammari", "V100008", { ctas: 2, area: "Acute", complaint: "Chest pain", age: 30, payer: "Bupa Arabia" }, "Triage set CTAS 2"),
      steps: [
        st("t", "trigger", 16, "done", "Triage Level Set: CTAS 2 for Hanan Alshammari, visit V100008."),
        st("c", "condition", 16, "yes", "CTAS Level is 2. Rule: is at most 2. Yes."),
        st("b", "branch", 16, "done", "Runs 2 paths."),
        st("a1", "action", 16, "done", "Notified Emergency Doctor: CTAS 2 in Acute: Hanan Alshammari, Chest pain. Please see now."),
        st("a2", "action", 16, "done", "Notified Charge Nurse: CTAS 2 arrival: Hanan Alshammari. Please assign a nurse and a bed in Acute."),
        st("end", "end", 16, "end", "Finished."),
      ],
    },
    {
      id: "RUN-1", automationId: "AUT-2", automationName: TEMPLATES[1].name, startedAt: isoAgo(now, 1500), finishedAt: isoAgo(now, 1470), status: "done", tokens: [],
      event: ev("critical-lab", 1500, "Saad Almutairi", "V100001", { test: "Potassium", resultFlag: "Critical High", ward: "3A", patientClass: "Inpatient", age: 58 }, "Critical potassium released"),
      steps: [
        st("t", "trigger", 1500, "done", "Critical Lab Result Released: Potassium (Critical High) for Saad Almutairi."),
        st("a1", "action", 1500, "done", "Notified Attending Doctor: Critical result: Potassium (Critical High) for Saad Almutairi, visit V100001. Please acknowledge."),
        st("w", "wait", 1500, "waiting", "Waiting 30 minutes."),
        st("c", "condition", 1470, "no", "Alert Acknowledged is Yes. Rule: is No. No."),
        st("ok", "end", 1470, "end", "Finished. Acknowledged in time."),
      ],
    },
  ];
  return { automations, runs, notices: [], tasks: [], holds: [], checkpoint: { auditId: 0, seen: {}, started: false }, seq: 3 };
}

function load(): AutomationState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return JSON.parse(raw) as AutomationState;
  } catch {
    /* storage may be blocked */
  }
  return seedAutomations();
}

export function getAutomations(): AutomationState {
  if (!state) state = load();
  return state;
}

export function commitAutomations(next: AutomationState) {
  state = { ...next, runs: next.runs.slice(0, RUN_MAX) };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useAutomations(): AutomationState {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), getAutomations, getAutomations);
}

/** Back to the seven seeded automations. Used by tests. */
export const resetAutomations = (now: number = Date.now()) => commitAutomations(seedAutomations(now));
/** No automations at all. Used by tests. */
export const clearAutomations = () => commitAutomations({ ...seedAutomations(), automations: [], runs: [] });

const who = (): string => {
  try { return currentUser().name; } catch { return "Unknown"; }
};

export const automationById = (id: string, s: AutomationState = getAutomations()) => s.automations.find((a) => a.id === id);

export function nextSeq(s: AutomationState = getAutomations()): number {
  return s.seq + 1;
}

/* ---------- list actions ---------- */

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function createAutomation(input: { name?: string; templateId?: string }, now: number = Date.now()): Automation {
  const s = getAutomations();
  const n = s.automations.reduce((m, a) => Math.max(m, Number(a.id.replace(/\D/g, "")) || 0), 0) + 1;
  const at = new Date(now).toISOString();
  const t = input.templateId ? TEMPLATE_BY_ID[input.templateId] : undefined;
  const a: Automation = t
    ? { ...fromTemplate(t, `AUT-${n}`, "draft", at, who()), name: input.name?.trim() || t.name }
    : {
      id: `AUT-${n}`, name: input.name?.trim() || "New Automation", description: "", status: "draft",
      flow: { nodes: [{ id: "n1", kind: "trigger", x: snap(-NODE_W / 2), y: 0, settings: {} }], edges: [] }, createdAt: at, createdBy: who(), updatedAt: at,
    };
  commitAutomations({ ...s, automations: [...s.automations, a] });
  audit("create", `Automation ${a.id}`, { detail: `${a.name}${t ? `, from the template ${t.name}` : ""}. Draft.` });
  return a;
}

export function saveAutomation(id: string, patch: Partial<Pick<Automation, "name" | "description" | "flow">>, now: number = Date.now()): Result<Automation> {
  const s = getAutomations();
  const a = automationById(id, s);
  if (!a) return { ok: false, errors: ["This automation was not found."] };
  const next: Automation = { ...a, ...patch, name: (patch.name ?? a.name).trim() || a.name, updatedAt: new Date(now).toISOString() };
  // An active flow that is changed into something that cannot run is paused, never left half-working.
  let note = "";
  if (patch.flow && next.status === "active" && !flowReady(next.flow)) { next.status = "paused"; note = " Paused: the flow has problems to fix."; }
  commitAutomations({ ...s, automations: s.automations.map((x) => (x.id === id ? next : x)) });
  audit("update", `Automation ${id}`, { detail: `${next.name} saved.${note}` });
  return { ok: true, value: next };
}

/** Activate or pause. A flow with problems cannot be activated. */
export function setAutomationStatus(id: string, status: AutomationStatus, now: number = Date.now()): Result<Automation> {
  const s = getAutomations();
  const a = automationById(id, s);
  if (!a) return { ok: false, errors: ["This automation was not found."] };
  if (status === "active") {
    const errors = validateFlow(a.flow).filter((i) => i.level === "error").map((i) => i.text);
    if (errors.length) return { ok: false, errors };
  }
  const next = { ...a, status, updatedAt: new Date(now).toISOString() };
  commitAutomations({ ...s, automations: s.automations.map((x) => (x.id === id ? next : x)) });
  audit("update", `Automation ${id}`, { detail: `${a.name}: ${STATUS_LABEL[status]}.` });
  return { ok: true, value: next };
}

export function duplicateAutomation(id: string, now: number = Date.now()): Result<Automation> {
  const a = automationById(id);
  if (!a) return { ok: false, errors: ["This automation was not found."] };
  const copy = createAutomation({ name: `${a.name} (Copy)` }, now);
  const s = getAutomations();
  const next: Automation = { ...copy, description: a.description, flow: clone(a.flow), templateId: a.templateId };
  commitAutomations({ ...s, automations: s.automations.map((x) => (x.id === copy.id ? next : x)) });
  return { ok: true, value: next };
}

/** Deletes the automation. Its run history stays, so what it did can still be read. Open runs stop. */
export function deleteAutomation(id: string, now: number = Date.now()): Result<string> {
  const s = getAutomations();
  const a = automationById(id, s);
  if (!a) return { ok: false, errors: ["This automation was not found."] };
  const at = new Date(now).toISOString();
  const runs = s.runs.map((r) => (r.automationId === id && r.tokens.length
    ? { ...r, tokens: [], status: "stopped" as const, finishedAt: at, steps: [...r.steps, { nodeId: "", kind: "end" as const, at, status: "end" as const, text: "Stopped: the automation was deleted." }] }
    : r));
  commitAutomations({ ...s, automations: s.automations.filter((x) => x.id !== id), runs });
  audit("delete", `Automation ${id}`, { detail: a.name });
  return { ok: true, value: id };
}

/* ---------- reading runs ---------- */

const sameDay = (iso: string, now: Date) => new Date(iso).toDateString() === now.toDateString();

export function runsOf(id: string, s: AutomationState = getAutomations()): Run[] {
  return s.runs.filter((r) => r.automationId === id && !r.test).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export const runsToday = (id: string, now: Date = new Date(), s: AutomationState = getAutomations()) => runsOf(id, s).filter((r) => sameDay(r.startedAt, now)).length;
export const lastRun = (id: string, s: AutomationState = getAutomations()): Run | undefined => runsOf(id, s)[0];

/** Runs waiting at an Approval step, each with the role it waits for. */
export function waitingApprovals(s: AutomationState = getAutomations()): { run: Run; token: Token; index: number }[] {
  return s.runs.flatMap((run) => run.tokens.map((token, index) => ({ run, token, index })).filter((x) => !!x.token.awaiting));
}

/** Put a message's {placeholders} in from the event. */
export function fill(text: string, ev: Pick<HisEvent, "patient" | "visit" | "fields">): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k === "patient") return ev.patient;
    if (k === "visit") return ev.visit ?? "no visit";
    const v = ev.fields[k];
    if (v === undefined || v === "") return "not recorded";
    if (k === "amount") return `${Number(v).toLocaleString("en-US")} SAR`;
    return typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  });
}

export const PLACEHOLDERS = ["patient", "visit", ...Object.keys(FIELDS)];
