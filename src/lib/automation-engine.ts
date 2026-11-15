import * as React from "react";
import { getAdmissionRequests } from "./admission-requests";
import { getAppointments, specialityOf } from "./appointments";
import { audit, useAudit, type AuditEntry } from "./audit";
import {
  ACTION_BY_ID, KINDS, ROLE_BY_ID, TRIGGER_BY_ID, actsFor, changesRecord, commitAutomations, evaluateCondition, fill, getAutomations, minutesWords,
  nodeTitle, roleLabel, triggerOf,
  type Automation, type AutomationState, type FieldValue, type Flow, type FlowNode, type HisEvent, type Port, type Result, type RoleId, type Run, type RunStatus,
  type RunStep, type StepStatus, type Token, type TriggerId,
} from "./automations";
import { chartFindings, orderFollowUp, requestConsult } from "./care-requests";
import { clearanceLabel, missingClearances } from "./discharge";
import { getInvoices, invoiceView } from "./invoice";
import { criticalResults, getOrder, hasCritical } from "./lab";
import { testByCode } from "./fhir/lab-catalog";
import type { ClearanceKey, Encounter, Patient } from "./model";
import { caseOf, getFinancial, payerOf, runFinancial } from "./nphies-financial";
import { BED_BY_ID, SERVICES, cnhiAdmissionMethod } from "./reference-data";
import { currentUser, useSession } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";
import { fmtTime } from "./format";

/**
 * The automation engine. It reads two kinds of HIS events:
 *  - audit events: the audit log the whole app writes (triage saved, lab result released, admission requested, ADT sent);
 *  - record events: what a scan of the stores finds (a rejected claim, a pended authorization, an overdue invoice,
 *    an inpatient without vital signs).
 * Each new event starts every active automation whose trigger matches. A run walks the flow: it checks conditions,
 * waits, stops at approvals until the named role approves, and does the actions. An action that changes a record is
 * done only on a path that passed an Approval step; otherwise the run stops there and says why.
 * A test run walks the same flow and does nothing: every step says what would have happened.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
/** How often the engine looks at waits and record events, like the agents. */
export const AUTOMATION_CHECK_MS = 60_000;
/** Inpatient vital signs are due at least this often. */
export const VITALS_DUE_HOURS = 4;
const STEP_LIMIT = 200;

/* ---------- reading the HIS ---------- */

const ageOf = (dob?: string, now: number = Date.now()): number | undefined => {
  if (!dob) return undefined;
  const d = new Date(dob), n = new Date(now);
  if (Number.isNaN(d.getTime())) return undefined;
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
};

const CLASS_LABEL: Record<string, string> = { I: "Inpatient", O: "Outpatient", E: "Emergency" };
const serviceLabel = (code?: string) => SERVICES.find((s) => s.code === code)?.label ?? code ?? "";

function findPatient(ref?: string): Patient | undefined {
  if (!ref) return undefined;
  const ps = getState().patients;
  return ps.find((p) => p.id === ref || p.mrn === ref) ?? ps.find((p) => patientName(p) === ref || `${p.family}, ${p.given}` === ref);
}
const visitIn = (text?: string) => text?.match(/\bV\d{6}\b/)?.[0];
const encOf = (visit?: string): Encounter | undefined => (visit ? getState().encounters.find((e) => e.visitNumber === visit) : undefined);
const patientOfEnc = (e?: Encounter) => (e ? getState().patients.find((p) => p.id === e.patientId) : undefined);

/** Fields every event carries when the patient or visit is known. */
function baseFields(p?: Patient, e?: Encounter, now: number = Date.now()): Record<string, FieldValue> {
  const f: Record<string, FieldValue> = {};
  if (p) {
    const age = ageOf(p.dob, now);
    if (age !== undefined) f.age = age;
    f.sex = p.sex === "F" ? "Female" : "Male";
    f.payer = payerOf(p);
  }
  if (e) {
    f.patientClass = CLASS_LABEL[e.cls] ?? e.cls;
    if (e.bedId && BED_BY_ID[e.bedId]) f.ward = BED_BY_ID[e.bedId].ward;
    f.department = serviceLabel(e.service);
  }
  return f;
}

function makeEvent(trigger: TriggerId, key: string, at: string, p: Patient | undefined, e: Encounter | undefined, extra: Record<string, FieldValue>, summary: string, source: HisEvent["source"]): HisEvent {
  return {
    key, trigger, at, source, summary,
    patientId: p?.id, patient: p ? patientName(p) : "Unknown patient", visit: e?.visitNumber,
    fields: { ...baseFields(p, e, new Date(at).getTime()), ...extra },
  };
}

/** Turns one audit entry into an HIS event, or null when no trigger listens for it. Entries the automations wrote are skipped. */
export function eventFromAudit(a: AuditEntry): HisEvent | null {
  if (a.target.startsWith("Automation")) return null;
  const key = `audit:${a.id}:${a.at}`;
  let m: RegExpMatchArray | null;

  if (a.action === "create" && (m = a.target.match(/^Patient file (\S+)/))) {
    const p = findPatient(m[1]) ?? findPatient(a.patient);
    return makeEvent("patient-registered", key, a.at, p, undefined, {}, `New patient file ${m[1]}`, "audit");
  }
  if (a.action === "update" && (m = a.target.match(/^Appointment (\S+)/)) && /Checked in\./.test(a.detail ?? "")) {
    const ap = getAppointments().appointments.find((x) => x.id === m![1]);
    const e = encOf(visitIn(a.detail));
    const p = findPatient(ap?.patientId) ?? patientOfEnc(e) ?? findPatient(a.patient);
    return makeEvent("appointment-checked-in", key, a.at, p, e, ap ? { clinic: specialityOf(ap.doctorId) } : {}, `Checked in for appointment ${m[1]}`, "audit");
  }
  if (a.action === "update" && (m = a.target.match(/^Triage CTAS (\d)/))) {
    const e = encOf(visitIn(a.detail));
    const p = patientOfEnc(e) ?? findPatient(a.patient);
    const extra: Record<string, FieldValue> = { ctas: Number(m[1]) };
    if (e?.ed?.area) extra.area = e.ed.area;
    if (e?.ed?.complaint) extra.complaint = e.ed.complaint;
    return makeEvent("triage-set", key, a.at, p, e, extra, `Triage set CTAS ${m[1]}`, "audit");
  }
  if ((m = a.target.match(/^Lab result (\S+) verified and released/))) {
    const o = getOrder(m[1]);
    if (!o || !hasCritical(o)) return null;
    const crit = criticalResults(o);
    const e = encOf(o.visitNumber);
    const test = crit.map((r) => testByCode(r.code)?.short ?? r.code).join(", ");
    const flag = crit.some((r) => r.interp === "HH") ? "Critical High" : "Critical Low";
    return makeEvent("critical-lab", key, a.at, patientOfEnc(e), e, { test, resultFlag: flag }, `Critical result released: ${test}`, "audit");
  }
  if (a.action === "create" && (m = a.target.match(/^Admission request (\S+)/))) {
    const r = getAdmissionRequests().requests.find((x) => x.id === m![1]);
    const p = findPatient(r?.patientId) ?? findPatient(a.patient);
    const extra: Record<string, FieldValue> = {};
    if (r) {
      extra.admissionType = cnhiAdmissionMethod(r.admissionType) === "14" ? "Elective" : "Emergency";
      extra.department = serviceLabel(r.department);
    }
    return makeEvent("admission-requested", key, a.at, p, encOf(r?.fromVisit), extra, `Admission request ${m[1]}`, "audit");
  }
  if (a.action === "send-adt" && /^(ADT\^)?(A01|A06)\b/.test(a.target)) {
    const e = encOf(visitIn(a.detail));
    if (!e || e.cls !== "I") return null;
    return makeEvent("patient-admitted", key, a.at, patientOfEnc(e), e, {}, `Admitted, ${a.target.split(" ")[0]}`, "audit");
  }
  if (a.action === "update" && (m = a.target.match(/^Discharge clearance (V\d+)/)) && /^Clinical clearance given/.test(a.detail ?? "")) {
    const e = encOf(m[1]);
    return makeEvent("discharge-ordered", key, a.at, patientOfEnc(e), e, { clearancesMissing: e ? missingClearances(e).length : 0 }, "Doctor cleared the patient to leave", "audit");
  }
  return null;
}

const hoursSince = (iso: string | undefined, now: number) => (iso ? Math.floor((now - new Date(iso).getTime()) / HOUR) : 0);

/** Record events found by looking at the stores now. Each has a key that stays the same while the problem lasts. */
export function scanEvents(now: number = Date.now()): HisEvent[] {
  const out: HisEvent[] = [];
  const at = new Date(now).toISOString();
  for (const c of getFinancial().cases) {
    const e = encOf(c.visit);
    const p = patientOfEnc(e);
    if (c.claim?.status === "rejected") {
      out.push(makeEvent("claim-rejected", `claim-rejected:${c.visit}:${c.claim.ref}`, c.claim.at, p, e, { amount: c.claim.approved ?? estimateAmount(c.visit) }, `Claim ${c.claim.claimNumber} rejected`, "record"));
    }
    if (c.authorization?.status === "pended") {
      out.push(makeEvent("prior-auth-pended", `auth-pended:${c.visit}:${c.authorization.ref}`, c.authorization.at, p, e,
        { amount: estimateAmount(c.visit), stillPended: true, hoursPended: hoursSince(c.authorization.at, now) }, "Prior authorization pended", "record"));
    }
  }
  for (const inv of getInvoices().invoices) {
    if (!inv.finalizedAt) continue;
    const days = Math.floor((now - new Date(inv.finalizedAt).getTime()) / (24 * HOUR));
    if (days < 1) continue;
    const v = invoiceView(inv);
    if (v.totals.patientBalance <= 0.005) continue;
    const e = encOf(inv.visit);
    out.push(makeEvent("invoice-overdue", `invoice-overdue:${inv.visit}:${inv.finalizedAt}`, at, patientOfEnc(e), e,
      { amount: Math.round(v.totals.patientBalance * 100) / 100, daysOverdue: days }, `Invoice #${inv.number} unpaid for ${days} days`, "record"));
  }
  for (const e of getState().encounters) {
    if (e.status !== "active" || e.cls !== "I") continue;
    const last = vitalsTime(e);
    const h = hoursSince(last, now);
    if (!last || h < VITALS_DUE_HOURS) continue;
    out.push(makeEvent("vitals-overdue", `vitals-overdue:${e.visitNumber}:${last}`, at, patientOfEnc(e), e, { hoursSinceVitals: h }, `No vital signs for ${h} hours`, "record"));
  }
  return out;
}

function vitalsTime(e: Encounter): string | undefined {
  const t = e.vitals?.at ?? e.admitAt;
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function estimateAmount(visit: string): number {
  const inv = getInvoices().invoices.find((i) => i.visit === visit);
  if (!inv) return 0;
  return Math.round(invoiceView(inv).totals.total * 100) / 100;
}

/** Fields read again from the record when a condition runs, so a check after a wait sees the record as it is now. */
export function liveFields(ev: HisEvent, run: Pick<Run, "id">, s: AutomationState, now: number): Record<string, FieldValue> {
  const f: Record<string, FieldValue> = {};
  f.acknowledged = s.notices.some((n) => n.runId === run.id && !!n.acknowledgedAt);
  const e = encOf(ev.visit);
  if (ev.visit && (ev.trigger === "prior-auth-pended" || ev.fields.stillPended !== undefined)) {
    const a = caseOf(ev.visit).authorization;
    if (a) { f.stillPended = a.status === "pended"; f.hoursPended = hoursSince(a.at, now); }
  }
  if (e && ev.trigger === "vitals-overdue") {
    const last = vitalsTime(e);
    if (last) f.hoursSinceVitals = hoursSince(last, now);
  }
  if (e && ev.trigger === "discharge-ordered") f.clearancesMissing = missingClearances(e).length;
  return f;
}

/* ---------- running a flow ---------- */

interface Ctx {
  now: number;
  /** Test run: nothing is done. */
  dry: boolean;
  /** The draft store: notices, tasks and holds are added here. */
  s: AutomationState;
}

const iso = (t: number) => new Date(t).toISOString();
const timeText = (t: number) => fmtTime(t);

const CLEARANCE_WORK: Record<ClearanceKey, { worklist: string; role: RoleId }> = {
  clinical: { worklist: "Doctor Tasks", role: "attending" },
  pharmacy: { worklist: "Pharmacy", role: "pharmacist" },
  nursing: { worklist: "Ward Nursing", role: "ward-nurse" },
  finance: { worklist: "Billing Worklist", role: "biller" },
};

/** What an action did, or in a test run would do. `ok` false means it was tried and did not go through. */
function act(node: FlowNode, run: Run, ctx: Ctx): { ok: boolean; text: string } {
  const st = node.settings;
  const ev = run.event;
  const msg = fill(st.message ?? "", ev);
  const kind = st.action!;
  const seq = () => (ctx.s.seq = ctx.s.seq + 1);
  switch (kind) {
    case "notify":
    case "reminder": {
      const to = st.person || roleLabel(st.role);
      const verb = kind === "notify" ? "Notified" : "Reminded";
      if (ctx.dry) return { ok: true, text: `Would ${kind === "notify" ? "notify" : "remind"} ${to}: ${msg}` };
      ctx.s.notices = [{ id: `NT-${seq()}`, runId: run.id, automationName: run.automationName, at: iso(ctx.now), to, role: st.person ? undefined : st.role, text: msg, patient: ev.patient, visit: ev.visit, kind }, ...ctx.s.notices].slice(0, 400);
      const me = currentUser();
      if ((st.person && st.person === me.name) || (!st.person && st.role && actsFor(st.role, me) && me.role !== "admin")) pushToast({ tone: "warn", text: `${run.automationName}`, detail: msg });
      return { ok: true, text: `${verb} ${to}: ${msg}` };
    }
    case "create-task": {
      if (ctx.dry) return { ok: true, text: `Would add a task on ${st.worklist}: ${msg}` };
      ctx.s.tasks = [{ id: `TK-${seq()}`, runId: run.id, automationName: run.automationName, at: iso(ctx.now), worklist: st.worklist!, role: st.role, text: msg, patient: ev.patient, visit: ev.visit }, ...ctx.s.tasks].slice(0, 400);
      return { ok: true, text: `Added a task on ${st.worklist}: ${msg}` };
    }
    case "audit-note": {
      if (ctx.dry) return { ok: true, text: `Would write to the audit log: ${msg}` };
      audit("update", `Automation note ${run.id}`, { patient: ev.patient, detail: `${run.automationName}. ${msg}` });
      return { ok: true, text: `Wrote to the audit log: ${msg}` };
    }
    case "start-clearances": {
      const e = encOf(ev.visit);
      const missing = e ? missingClearances(e) : (["pharmacy", "nursing", "finance"] as ClearanceKey[]);
      if (!missing.length) return { ok: true, text: "All four clearances are already given. Nothing to ask for." };
      const names = missing.map(clearanceLabel).join(", ");
      if (ctx.dry) return { ok: true, text: `Would ask for the ${names} clearance${missing.length > 1 ? "s" : ""}, one task on each worklist.` };
      for (const k of missing) {
        const w = CLEARANCE_WORK[k];
        ctx.s.tasks = [{ id: `TK-${seq()}`, runId: run.id, automationName: run.automationName, at: iso(ctx.now), worklist: w.worklist, role: w.role, text: `Give the ${clearanceLabel(k)} clearance for ${ev.patient}, visit ${ev.visit ?? "unknown"}. Discharge is blocked until it is given.`, patient: ev.patient, visit: ev.visit }, ...ctx.s.tasks];
      }
      return { ok: true, text: `Asked for the ${names} clearance${missing.length > 1 ? "s" : ""}: one task on each worklist.` };
    }
    case "request-consult": {
      if (ctx.dry) return { ok: true, text: `Would request a ${st.urgency} ${st.specialty} consult: ${msg}` };
      const e = encOf(ev.visit);
      if (!e) return { ok: false, text: "No visit on this event, so the consult was not requested." };
      const r = requestConsult({ visit: e.visitNumber, specialty: st.specialty!, urgency: st.urgency ?? "routine", question: msg, findings: chartFindings(e) }, ctx.now);
      return r.ok ? { ok: true, text: `Consult request ${r.value.id} created: ${st.specialty}, ${st.urgency}.` } : { ok: false, text: `Consult not requested: ${r.errors.join(" ")}` };
    }
    case "request-follow-up": {
      if (ctx.dry) return { ok: true, text: `Would request a follow-up in ${st.clinic} in ${st.days} days.` };
      if (!ev.visit) return { ok: false, text: "No visit on this event, so the follow-up was not requested." };
      const r = orderFollowUp({ visit: ev.visit, amount: st.days ?? 14, unit: "days", clinic: st.clinic!, doctorId: "", visitType: "in-person", instructions: msg }, ctx.now);
      return r.ok ? { ok: true, text: `Follow-up request ${r.value.id} created: ${st.clinic} by ${r.value.targetDate}.` } : { ok: false, text: `Follow-up not requested: ${r.errors.join(" ")}` };
    }
    case "ask-prior-auth": {
      if (ctx.dry) return { ok: true, text: "Would send the prior authorization request to NPHIES." };
      if (!ev.visit) return { ok: false, text: "No visit on this event, so nothing was sent." };
      const ok = runFinancial(ev.visit, "authorization");
      return ok ? { ok: true, text: "Prior authorization request sent to NPHIES." } : { ok: false, text: "Not sent. The approver needs the billing permission, and a cash visit sends nothing." };
    }
    case "claim-review": {
      if (ctx.dry) return { ok: true, text: `Would hold the claim for review: ${msg}` };
      if (!ev.visit) return { ok: false, text: "No visit on this event, so no claim was held." };
      ctx.s.holds = [{ visit: ev.visit, at: iso(ctx.now), by: currentUser().name, reason: msg, runId: run.id }, ...ctx.s.holds.filter((h) => h.visit !== ev.visit)];
      audit("update", `Automation claim review ${ev.visit}`, { patient: ev.patient, detail: `${run.automationName}. Held for review: ${msg}` });
      return { ok: true, text: `Claim for visit ${ev.visit} held for review: ${msg}` };
    }
  }
}

function nextTokens(flow: Flow, node: FlowNode, port: Port | "all", t: Token): Token[] {
  const outs = flow.edges.filter((e) => e.from === node.id && (port === "all" || e.port === port));
  return outs.map((e) => ({ node: e.to, approved: t.approved }));
}

/**
 * Moves a run on as far as it can go now: until every path has ended, is waiting, or is at an Approval.
 * Returns the run with its new steps and status. Notices, tasks and holds go into ctx.s.
 */
export function advanceRun(run: Run, flow: Flow, ctx: Ctx): Run {
  const r: Run = { ...run, steps: [...run.steps], tokens: [] };
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const queue: Token[] = [];
  const parked: Token[] = [];
  for (const t of run.tokens) {
    if (t.awaiting) parked.push(t);
    else if (t.until && new Date(t.until).getTime() > ctx.now) parked.push(t);
    else queue.push(t);
  }
  const step = (n: FlowNode, status: StepStatus, text: string) => r.steps.push({ nodeId: n.id, kind: n.kind, at: iso(ctx.now), status, text });
  let guard = 0;
  while (queue.length) {
    if (++guard > STEP_LIMIT) {
      r.steps.push({ nodeId: "", kind: "end", at: iso(ctx.now), status: "blocked", text: `Stopped after ${STEP_LIMIT} steps. The flow loops without a Wait.` });
      queue.length = 0;
      break;
    }
    const t = queue.shift()!;
    const n = byId.get(t.node);
    if (!n) continue;
    const go = (port: Port | "all", tok: Token = t) => {
      const next = nextTokens(flow, n, port, tok);
      if (!next.length && n.kind !== "end") step(n, "end", "This path has no next step, so it ends here.");
      queue.push(...next);
    };
    switch (n.kind) {
      case "trigger":
        step(n, "done", `${TRIGGER_BY_ID[n.settings.trigger!]?.label ?? "Trigger"}: ${r.event.summary} for ${r.event.patient}${r.event.visit ? `, visit ${r.event.visit}` : ""}.`);
        go("out");
        break;
      case "condition": {
        // A sample event keeps its own values; a real one is read again from the record (after a wait it may have changed).
        const fields = { ...r.event.fields, ...(r.event.source === "sample" ? { acknowledged: false } : liveFields(r.event, r, ctx.s, ctx.now)) };
        const res = evaluateCondition(n.settings, fields);
        step(n, res.pass ? "yes" : "no", res.text);
        go(res.pass ? "yes" : "no");
        break;
      }
      case "wait": {
        const mins = n.settings.minutes ?? 0;
        if (ctx.dry) { step(n, "simulated", `Would wait ${minutesWords(mins)}. A test run goes straight on.`); go("out"); break; }
        if (!t.until) {
          const until = ctx.now + mins * MIN;
          step(n, "waiting", `Waiting ${minutesWords(mins)}, until ${timeText(until)}.`);
          parked.push({ ...t, until: iso(until) });
        } else {
          step(n, "done", `Waited ${minutesWords(mins)}.`);
          go("out", { node: t.node, approved: t.approved });
        }
        break;
      }
      case "approval": {
        const role = n.settings.role;
        if (ctx.dry) { step(n, "simulated", `Would wait for the ${roleLabel(role)} to approve. A test run counts it as approved.`); go("out", { ...t, approved: true }); break; }
        step(n, "approval", `Waiting for the ${roleLabel(role)} to approve.${n.settings.note ? ` ${n.settings.note}` : ""}`);
        parked.push({ ...t, awaiting: role });
        break;
      }
      case "action": {
        const def = n.settings.action ? ACTION_BY_ID[n.settings.action] : undefined;
        if (!def) { step(n, "failed", "No action chosen."); go("out"); break; }
        if (changesRecord(n) && !t.approved) {
          step(n, "blocked", `Stopped: "${nodeTitle(n)}" changes the record and no person approved it. Add an Approval step before it.`);
          break;
        }
        const out = act(n, r, ctx);
        step(n, ctx.dry ? "simulated" : out.ok ? "done" : "failed", out.text);
        go("out");
        break;
      }
      case "branch": {
        const outs = flow.edges.filter((e) => e.from === n.id).length;
        step(n, "done", `Runs ${outs} path${outs === 1 ? "" : "s"}.`);
        go("all");
        break;
      }
      case "end":
        step(n, "end", n.settings.note ? `Finished. ${n.settings.note}` : "Finished.");
        break;
    }
  }
  r.tokens = parked;
  r.status = statusOf(r);
  if (!r.tokens.length && !r.finishedAt) r.finishedAt = iso(ctx.now);
  return r;
}

function statusOf(r: Run): RunStatus {
  if (r.tokens.some((t) => t.awaiting)) return "approval";
  if (r.tokens.length) return "waiting";
  return r.steps.some((s) => s.status === "blocked" || s.status === "failed") ? "stopped" : "done";
}

function newRun(a: Pick<Automation, "id" | "name" | "flow">, ev: HisEvent, id: string, now: number, test = false): Run {
  const trig = a.flow.nodes.find((n) => n.kind === "trigger");
  return {
    id, automationId: a.id, automationName: a.name, event: ev, startedAt: iso(now), status: "running", steps: [],
    tokens: trig ? [{ node: trig.id, approved: false }] : [], ...(test ? { test: true } : {}),
  };
}

/* ---------- the background check ---------- */

export interface TickResult {
  started: number;
  resumed: number;
}

/**
 * One round. Reads audit entries newer than the last round and scans the stores for record events; starts the active
 * automations each new event matches; moves on runs whose wait is over. The first round only remembers where the audit
 * log is, so old history does not start anything.
 */
export function tick(entries: AuditEntry[] | null, now: number = Date.now()): TickResult {
  const base = getAutomations();
  const ctx: Ctx = { now, dry: false, s: { ...base, checkpoint: { ...base.checkpoint, seen: { ...base.checkpoint.seen } } } };
  const s = ctx.s;
  const events: HisEvent[] = [];
  if (entries) {
    const maxId = entries.reduce((m, e) => Math.max(m, e.id), 0);
    if (!s.checkpoint.started) s.checkpoint = { ...s.checkpoint, started: true, auditId: maxId };
    else {
      // The audit log was cleared: every entry in it is new.
      const from = maxId < s.checkpoint.auditId ? 0 : s.checkpoint.auditId;
      for (const a of entries) if (a.id > from) { const ev = eventFromAudit(a); if (ev) events.push(ev); }
      s.checkpoint.auditId = maxId;
    }
  }
  const live = scanEvents(now);
  for (const ev of live) {
    if (s.checkpoint.seen[ev.key]) continue;
    s.checkpoint.seen[ev.key] = iso(now);
    events.push(ev);
  }
  // Forget record events that are over, so the list does not grow for ever.
  const liveKeys = new Set(live.map((e) => e.key));
  for (const k of Object.keys(s.checkpoint.seen)) if (!liveKeys.has(k) && now - new Date(s.checkpoint.seen[k]).getTime() > 7 * 24 * HOUR) delete s.checkpoint.seen[k];

  let started = 0;
  const fresh: Run[] = [];
  for (const ev of events) {
    for (const a of s.automations) {
      if (a.status !== "active" || triggerOf(a.flow) !== ev.trigger) continue;
      s.seq += 1;
      fresh.push(advanceRun(newRun(a, ev, `RUN-${s.seq}`, now), a.flow, ctx));
      started++;
    }
  }
  let resumed = 0;
  const runs = s.runs.map((r) => {
    if (!r.tokens.some((t) => !t.awaiting && t.until && new Date(t.until).getTime() <= now)) return r;
    const a = s.automations.find((x) => x.id === r.automationId);
    if (!a) return r;
    resumed++;
    return advanceRun(r, a.flow, ctx);
  });
  commitAutomations({ ...s, runs: [...fresh.reverse(), ...runs], lastCheck: iso(now) });
  return { started, resumed };
}

/* ---------- people acting on runs ---------- */

/** The named role approves. The path goes on, and actions after it may now change the record. */
export function approveStep(runId: string, tokenIndex: number, now: number = Date.now()): Result<Run> {
  return decide(runId, tokenIndex, true, "", now);
}

export function declineStep(runId: string, tokenIndex: number, reason: string, now: number = Date.now()): Result<Run> {
  if (!reason.trim()) return { ok: false, errors: ["Write why it is declined."] };
  return decide(runId, tokenIndex, false, reason.trim(), now);
}

function decide(runId: string, tokenIndex: number, approve: boolean, reason: string, now: number): Result<Run> {
  const base = getAutomations();
  const run = base.runs.find((r) => r.id === runId);
  const t = run?.tokens[tokenIndex];
  if (!run || !t?.awaiting) return { ok: false, errors: ["This approval is no longer waiting."] };
  const me = currentUser();
  if (!actsFor(t.awaiting, me)) {
    audit("denied", `Automation approval ${runId}`, { patient: run.event.patient, detail: `Needs the ${roleLabel(t.awaiting)}.` });
    return { ok: false, errors: [`Only the ${roleLabel(t.awaiting)} can decide this.`] };
  }
  const a = base.automations.find((x) => x.id === run.automationId);
  const ctx: Ctx = { now, dry: false, s: { ...base } };
  const node = a?.flow.nodes.find((n) => n.id === t.node);
  const steps: RunStep[] = [...run.steps, {
    nodeId: t.node, kind: "approval", at: iso(now), status: approve ? "approved" : "declined",
    text: approve ? `Approved by ${me.name} for the ${roleLabel(t.awaiting)}.` : `Declined by ${me.name}: ${reason}`,
  }];
  const others = run.tokens.filter((_, i) => i !== tokenIndex);
  let next: Run = { ...run, steps, tokens: others };
  if (approve && a && node) {
    const after = nextTokens(a.flow, node, "out", { node: t.node, approved: true });
    next = advanceRun({ ...next, tokens: [...others, ...after] }, a.flow, ctx);
  } else {
    next = { ...next, status: statusOf(next), finishedAt: others.length ? undefined : iso(now) };
  }
  audit("update", `Automation approval ${runId}`, { patient: run.event.patient, detail: `${run.automationName}. ${approve ? "Approved" : `Declined: ${reason}`}.` });
  commitAutomations({ ...ctx.s, runs: ctx.s.runs.map((r) => (r.id === runId ? next : r)) });
  return { ok: true, value: next };
}

export function acknowledgeNotice(id: string, now: number = Date.now()): Result<string> {
  const s = getAutomations();
  const n = s.notices.find((x) => x.id === id);
  if (!n) return { ok: false, errors: ["This message was not found."] };
  if (n.acknowledgedAt) return { ok: true, value: id };
  const me = currentUser();
  if (n.role && !actsFor(n.role, me)) return { ok: false, errors: [`This message is for the ${roleLabel(n.role)}.`] };
  if (!n.role && n.to !== me.name && me.role !== "admin") return { ok: false, errors: [`This message is for ${n.to}.`] };
  commitAutomations({ ...s, notices: s.notices.map((x) => (x.id === id ? { ...x, acknowledgedAt: iso(now), acknowledgedBy: me.name } : x)) });
  audit("update", `Automation message ${id}`, { patient: n.patient, detail: `Acknowledged. ${n.text}` });
  return { ok: true, value: id };
}

export function completeTask(id: string, now: number = Date.now()): Result<string> {
  const s = getAutomations();
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return { ok: false, errors: ["This task was not found."] };
  if (t.role && !actsFor(t.role, currentUser())) return { ok: false, errors: [`This task is for the ${roleLabel(t.role)}.`] };
  commitAutomations({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, doneAt: iso(now), doneBy: currentUser().name } : x)) });
  audit("update", `Automation task ${id}`, { patient: t.patient, detail: `Done. ${t.text}` });
  return { ok: true, value: id };
}

/* ---------- test runs ---------- */

/** A made-up event for a trigger, from the patients in the HIS now, used when no real event happened recently. */
export function sampleEvent(trigger: TriggerId, now: number = Date.now()): HisEvent {
  const st = getState();
  const active = st.encounters.filter((e) => e.status === "active");
  const pick = (f: (e: Encounter) => boolean) => active.find(f) ?? active[0];
  const at = iso(now);
  const key = `sample:${trigger}`;
  const ev = (e: Encounter | undefined, extra: Record<string, FieldValue>, summary: string) => makeEvent(trigger, key, at, patientOfEnc(e), e, extra, summary, "sample");
  switch (trigger) {
    case "triage-set": {
      const e = active.filter((x) => x.ed?.ctas).sort((a, b) => (a.ed!.ctas ?? 9) - (b.ed!.ctas ?? 9))[0] ?? pick((x) => x.cls === "E");
      return ev(e, { ctas: e?.ed?.ctas ?? 2, area: e?.ed?.area ?? "Acute", complaint: e?.ed?.complaint ?? e?.reason ?? "Chest pain" }, `Triage set CTAS ${e?.ed?.ctas ?? 2}`);
    }
    case "critical-lab": return ev(pick((x) => x.cls === "I"), { test: "Potassium", resultFlag: "Critical High" }, "Critical result released: Potassium");
    case "admission-requested": return ev(pick((x) => x.cls === "O"), { admissionType: "Elective", department: "Surgery" }, "Admission request");
    case "patient-admitted": return ev(pick((x) => x.cls === "I"), {}, "Admitted, A01");
    case "discharge-ordered": { const e = pick((x) => x.cls === "I"); return ev(e, { clearancesMissing: e ? missingClearances(e).length : 3 }, "Doctor cleared the patient to leave"); }
    case "claim-rejected": return ev(pick((x) => x.cls === "I"), { amount: 7850 }, "Claim rejected");
    case "prior-auth-pended": return ev(pick((x) => x.cls === "I"), { amount: 12400, stillPended: true, hoursPended: 26 }, "Prior authorization pended");
    case "invoice-overdue": return ev(pick((x) => x.cls === "O"), { amount: 460, daysOverdue: 3 }, "Invoice unpaid for 3 days");
    case "vitals-overdue": return ev(pick((x) => x.cls === "I"), { hoursSinceVitals: 5 }, "No vital signs for 5 hours");
    case "appointment-checked-in": return ev(pick((x) => x.cls === "O"), { clinic: "General Medicine" }, "Checked in for an appointment");
    case "patient-registered": return ev(undefined, {}, "New patient file");
  }
}

/** Recent events for a trigger: from the audit log and the stores, newest first. A sample event when there are none. */
export function recentEvents(trigger: TriggerId, entries: AuditEntry[], now: number = Date.now(), limit = 3): HisEvent[] {
  const fromAudit = entries.slice(-400).map(eventFromAudit).filter((e): e is HisEvent => !!e && e.trigger === trigger);
  const fromRecords = scanEvents(now).filter((e) => e.trigger === trigger);
  const all = [...fromAudit, ...fromRecords].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return all.length ? all : [sampleEvent(trigger, now)];
}

/**
 * A test run: replays events through the flow and does nothing. Waits go straight on, approvals count as given,
 * actions say what they would do. Nothing is written to any store.
 */
export function testRun(a: Pick<Automation, "id" | "name" | "flow">, events: HisEvent[], now: number = Date.now()): Run[] {
  const draft = getAutomations();
  return events.map((ev, i) => {
    const ctx: Ctx = { now, dry: true, s: { ...draft, notices: [], tasks: [], holds: [] } };
    return advanceRun(newRun(a, ev, `TEST-${i + 1}`, now, true), a.flow, ctx);
  });
}

/* ---------- monitor ---------- */

/**
 * Keeps the automations running while the app is open, on any page: right away when the audit log changes, and once
 * a minute for waits and record events. Renders nothing. Put <AutomationMonitor /> once in the app shell.
 * Like the agents, it starts again when the signed-in user changes.
 */
export function AutomationMonitor(): null {
  const entries = useAudit();
  const { user } = useSession();
  const ref = React.useRef(entries);
  ref.current = entries;
  React.useEffect(() => {
    const first = window.setTimeout(() => tick(ref.current), 1500);
    const timer = window.setInterval(() => tick(ref.current), AUTOMATION_CHECK_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [user.id]);
  React.useEffect(() => {
    if (!getAutomations().checkpoint.started) return;
    tick(entries);
  }, [entries]);
  return null;
}

/** For screens: the label of what an approval waits for. */
export const awaitingText = (t: Token) => (t.awaiting ? `${ROLE_BY_ID[t.awaiting]?.label ?? t.awaiting} to approve` : t.until ? `Wait until ${timeText(new Date(t.until).getTime())}` : "");
export { KINDS };
