import { buildTimeline, type TimelineItem, type TimelineKind } from "./chart-review";
import type { AuditEntry } from "./audit";
import { docsForVisit, getDocsState } from "./docs";
import { getEmar, OUTCOME_LABEL } from "./emar";
import { getLab } from "./lab";
import type { Encounter, HisState, Patient } from "./model";
import { getRad } from "./radiology";
import { DOCTORS, SERVICES } from "./reference-data";
import { getFormRecords } from "./records";
import { getRx } from "./rx";
import { ROLES, USERS } from "./session";
import { getState } from "./store";
import { getVitals, panelsOf } from "./vitals";
import { listSoap } from "./ai/soap-store";

/**
 * The patient journey: every step of a visit in order, with who did it, their role, and the time since the step before.
 * Builds on the chart timeline (chart-review.ts) and adds the visit start and end, doses, SOAP notes, diagnoses and
 * procedures. Also a summary of each of the patient's visits and this chart's audit trail. Pure reads, no writes.
 */

export type JourneyKind = TimelineKind | "visit" | "dose" | "soap" | "dx" | "pr";

export interface JourneyEvent extends Omit<TimelineItem, "kind"> {
  kind: JourneyKind;
  /** Who did the step, and their role. "Not recorded" when the app does not know. */
  staff: string;
  role: string;
  /** Minutes since the step before it, in time order. Empty for the first step. */
  sincePrevMin?: number;
}

const MIN = 60_000;
const ms = (s: string | undefined): number => (s ? new Date(s).getTime() : 0);
const NOT_RECORDED = "Not recorded";

const doctorById = (id: string | undefined) => DOCTORS.find((d) => d.id === id);
const doctorName = (id: string | undefined) => { const d = doctorById(id); return d ? `Dr. ${d.given} ${d.family}` : ""; };
const roleLabel = (roleId: string) => ROLES.find((r) => r.id === roleId)?.label ?? "";
const userByName = (name: string) => {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  return USERS.find((u) => u.name.toLowerCase().replace(/[^a-z]/g, "") === key);
};
/** Role of a person known only by name: from the user list, else guessed from the title. */
export function roleForName(name: string, fallback = ""): string {
  const u = userByName(name);
  if (u) return roleLabel(u.role);
  if (/^dr\.?\s/i.test(name)) return "Physician";
  if (/\bRN\b/.test(name)) return "Nurse";
  return fallback;
}
/** A provider id from vitals or orders: a doctor id, a user id or a national provider id. */
function person(id: string | undefined): { staff: string; role: string } | null {
  if (!id) return null;
  const doc = doctorName(id);
  if (doc) return { staff: doc, role: "Physician" };
  const u = USERS.find((x) => x.id === id || x.providerId === id);
  return u ? { staff: u.name, role: roleLabel(u.role) } : null;
}
const byName = (name: string | undefined, fallbackRole = "") => (name ? { staff: name, role: roleForName(name, fallbackRole) } : { staff: NOT_RECORDED, role: "" });

/** Who sent an ADT message: from the audit trail when it holds the send, else the admissions office. */
function adtSender(trigger: string, controlId: string, audit: AuditEntry[]) {
  const a = audit.find((e) => e.action === "send-adt" && e.target === `${trigger} ${controlId}`);
  return a ? { staff: a.user, role: a.role } : { staff: "Admissions Office", role: "Registration" };
}

export function journeyEvents(enc: Encounter, state: HisState = getState(), audit: AuditEntry[] = [], now: number = Date.now()): JourneyEvent[] {
  const base = buildTimeline(enc, state);
  const log = state.log.filter((m) => m.visitNumber === enc.visitNumber);
  const panels = panelsOf(enc.visitNumber, getVitals());
  const labs = getLab().orders;
  const rads = getRad().orders;
  const rxs = getRx().prescriptions;
  const docs = docsForVisit(enc.visitNumber, getDocsState());

  const out: JourneyEvent[] = base.map((i) => {
    const key = i.id.slice(i.id.indexOf("-") + 1);
    let who: { staff: string; role: string } | null = null;
    if (i.kind === "adt") {
      const m = log.find((x) => String(x.seq) === key);
      who = m ? adtSender(m.trigger, m.controlId, audit) : null;
    } else if (i.kind === "vitals") {
      who = person(panels.find((p) => p.id === key)?.recordedBy) ?? { staff: "Ward nursing staff", role: "Nurse" };
    } else if (i.kind === "lab") {
      who = person(labs.find((o) => o.id === key)?.orderedById);
    } else if (i.kind === "rad") {
      who = person(rads.find((o) => o.id === key)?.orderedById);
    } else if (i.kind === "rx") {
      who = person(rxs.find((p) => p.id === key)?.prescriberId);
    } else if (i.kind === "doc") {
      who = byName(docs.find((d) => d.id === key)?.createdBy);
    } else if (i.kind === "note") {
      const n = enc.notes.find((x) => `${x.at}-${x.author}` === key);
      who = n ? { staff: n.author, role: n.role ?? roleForName(n.author) } : null;
    } else if (i.kind === "form") {
      const r = getFormRecords(enc.visitNumber, i.section).find((x) => x.id === key);
      who = byName(r?.author);
    }
    return { ...i, staff: who?.staff ?? NOT_RECORDED, role: who?.role ?? "" };
  });

  const start = ms(enc.admitAt ?? enc.expectedAdmitAt);
  if (start && enc.status !== "preadmit") {
    out.push({
      id: `visit-start-${enc.visitNumber}`, at: start, kind: "visit", section: "overview", tone: "neutral",
      title: enc.cls === "I" ? "Admitted" : enc.cls === "E" ? "Arrived at the emergency department" : "Visit started",
      detail: [SERVICES.find((s) => s.code === enc.service)?.label, enc.reason].filter(Boolean).join(". ") || undefined,
      staff: "Admissions Office", role: "Registration",
    });
  }
  if (enc.ed?.triageAt && enc.ed.ctas) {
    const nurse = enc.ed.triageNurse;
    out.push({
      id: `visit-triage-${enc.visitNumber}`, at: ms(enc.ed.triageAt), kind: "visit", section: "overview", tone: enc.ed.ctas <= 2 ? "danger" : "neutral",
      title: `Triaged, CTAS level ${enc.ed.ctas}`, detail: enc.ed.complaint, ...byName(nurse, "Nurse"),
    });
  }
  if (enc.dischargeAt && enc.status === "discharged") {
    out.push({
      id: `visit-end-${enc.visitNumber}`, at: ms(enc.dischargeAt), kind: "visit", section: "overview", tone: "ok",
      title: "Discharged", detail: enc.discharge ? `Outcome: ${enc.discharge.outcome}` : undefined,
      ...(enc.discharge?.orderedBy ? byName(enc.discharge.orderedBy, "Physician") : { staff: doctorName(enc.attending) || NOT_RECORDED, role: "Physician" }),
    });
  }
  for (const d of enc.dx) {
    if (!d.at) continue;
    out.push({ id: `dx-${d.code}-${d.at}`, at: ms(d.at), kind: "dx", section: "diagnosis", tone: "neutral", title: `Diagnosis ${d.code}`, detail: d.text, ...(d.by ? byName(d.by, "Physician") : { staff: doctorName(enc.attending) || NOT_RECORDED, role: "Physician" }) });
  }
  for (const p of enc.pr) {
    if (!p.at) continue;
    const who = person(p.surgeon);
    out.push({ id: `pr-${p.code}-${p.at}`, at: ms(p.at), kind: "pr", section: "procedures", tone: "neutral", title: `Procedure ${p.code}`, detail: p.text, staff: who?.staff ?? NOT_RECORDED, role: who?.role ?? "" });
  }
  for (const r of getEmar().records.filter((x) => x.visit === enc.visitNumber)) {
    out.push({
      id: `dose-${r.id}`, at: ms(r.at), kind: "dose", section: "emar",
      tone: r.voided ? "neutral" : r.outcome === "given" ? "ok" : r.outcome === "missed" ? "danger" : "warn",
      title: `${r.drugText}: ${r.voided ? "entered in error" : OUTCOME_LABEL[r.outcome].toLowerCase()}`,
      detail: [r.doseText, r.routeText, r.site, r.reason].filter(Boolean).join(", "), staff: r.by, role: r.byRole,
    });
  }
  for (const n of listSoap(enc.visitNumber)) {
    out.push({
      id: `soap-${n.id}`, at: ms(n.at), kind: "soap", section: "soap", tone: n.status === "signed" ? "ok" : "warn",
      title: `SOAP note${n.status === "signed" ? ", signed" : ", draft"}`, detail: n.assessment.slice(0, 110) || undefined, ...byName(n.author),
    });
  }

  // Time since the step before, in time order. Steps in the future (planned) are left as they are.
  const sorted = out.filter((e) => e.at > 0 && e.at <= now + MIN).sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++) sorted[i].sincePrevMin = Math.round((sorted[i].at - sorted[i - 1].at) / MIN);
  return sorted.reverse();
}

/** Minutes from the start of the visit to its end, or to now while it is still open. Null when it has not started. */
export function visitMinutes(enc: Encounter, now: number = Date.now()): number | null {
  const start = ms(enc.admitAt ?? (enc.status === "preadmit" ? undefined : enc.expectedAdmitAt));
  if (!start || enc.status === "preadmit" || enc.status === "cancelled") return null;
  const end = enc.status === "discharged" ? ms(enc.dischargeAt) || now : now;
  return Math.max(0, Math.round((end - start) / MIN));
}

/** 45 minutes, 3 hours 20 minutes, 2 days 4 hours. */
export function humanDuration(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "Not known";
  if (min < 1) return "Less than a minute";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d) return h ? `${part(d, "day")} ${part(h, "hour")}` : part(d, "day");
  if (h) return m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour");
  return part(m, "minute");
}

/* ---------- visit summary across the patient's visits ---------- */

export interface VisitSummary {
  visitNumber: string;
  cls: Encounter["cls"];
  status: Encounter["status"];
  service: string;
  doctor: string;
  start: number;
  end: number | null;
  minutes: number | null;
  events: number;
  orders: number;
  meds: number;
  notes: number;
  primaryDx?: string;
  current: boolean;
}

export function visitSummaries(patientId: string, currentVisit: string, state: HisState = getState(), now: number = Date.now()): VisitSummary[] {
  const rx = getRx().prescriptions;
  return state.encounters
    .filter((e) => e.patientId === patientId)
    .map((e) => {
      const start = ms(e.admitAt ?? e.expectedAdmitAt);
      const meds = rx.filter((p) => p.visitNumber === e.visitNumber).reduce((n, p) => n + p.items.length, 0);
      return {
        visitNumber: e.visitNumber, cls: e.cls, status: e.status,
        service: SERVICES.find((s) => s.code === e.service)?.label ?? e.service,
        doctor: doctorName(e.attending) || NOT_RECORDED,
        start, end: e.status === "discharged" ? ms(e.dischargeAt) || null : null,
        minutes: visitMinutes(e, now),
        events: journeyEvents(e, state, [], now).length,
        orders: getLab().orders.filter((o) => o.visitNumber === e.visitNumber).length + getRad().orders.filter((o) => o.visitNumber === e.visitNumber).length,
        meds,
        notes: e.notes.length + listSoap(e.visitNumber).length,
        primaryDx: e.dx[0] ? `${e.dx[0].code} ${e.dx[0].text}` : undefined,
        current: e.visitNumber === currentVisit,
      };
    })
    .sort((a, b) => b.start - a.start);
}

/* ---------- audit trail of this chart ---------- */

/**
 * Audit entries about this visit: ones that name the visit number, plus entries about the patient that do not name
 * another of the patient's visits. Newest first.
 */
export function chartAudit(entries: AuditEntry[], enc: Encounter, patient: Patient, state: HisState = getState()): AuditEntry[] {
  const others = state.encounters.filter((e) => e.patientId === patient.id && e.visitNumber !== enc.visitNumber).map((e) => e.visitNumber);
  const names = new Set([patient.id, `${patient.given} ${patient.family}`, `${patient.family}, ${patient.given}`]);
  return entries
    .filter((e) => {
      const text = `${e.target} ${e.detail ?? ""}`;
      if (text.includes(enc.visitNumber)) return true;
      return !!e.patient && (names.has(e.patient) || e.patient.includes(patient.family) && e.patient.includes(patient.given)) && !others.some((v) => text.includes(v));
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
}

export function auditCounts(entries: AuditEntry[]): { total: number; creations: number; edits: number; views: number; other: number } {
  const creations = entries.filter((e) => e.action === "create").length;
  const edits = entries.filter((e) => e.action === "update" || e.action === "delete").length;
  const views = entries.filter((e) => e.action === "view").length;
  return { total: entries.length, creations, edits, views, other: entries.length - creations - edits - views };
}

/* ---------- print ---------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stamp = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** A plain page with the journey, ready for the browser's print dialog. */
export function journeyPrintHtml(opts: { patient: Patient; enc: Encounter; events: JourneyEvent[]; visits: VisitSummary[]; total: number | null; hospital: string; printedBy: string; now?: number }): string {
  const { patient, enc, events, visits, total, hospital, printedBy } = opts;
  const now = opts.now ?? Date.now();
  const rows = events.map((e) => `<tr><td>${esc(stamp(e.at))}</td><td>${esc(e.title)}${e.detail ? `<div class="d">${esc(e.detail)}</div>` : ""}</td><td>${esc(e.staff)}${e.role ? `<div class="d">${esc(e.role)}</div>` : ""}</td><td>${e.sincePrevMin !== undefined ? esc(humanDuration(e.sincePrevMin)) : ""}</td></tr>`).join("");
  const vrows = visits.map((v) => `<tr><td>${esc(v.visitNumber)}${v.current ? " (this visit)" : ""}</td><td>${esc(v.service)}</td><td>${esc(v.doctor)}</td><td>${v.start ? esc(stamp(v.start)) : ""}</td><td>${esc(humanDuration(v.minutes))}</td><td>${v.events}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Patient Journey ${esc(enc.visitNumber)}</title>
<style>body{font:13px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:14px;margin:20px 0 6px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f2f2f2}.d{color:#555;font-size:12px}.m{color:#555}</style></head><body>
<h1>Patient Journey</h1><div class="m">${esc(hospital)}. Printed ${esc(stamp(now))} by ${esc(printedBy)}.</div>
<p><strong>${esc(`${patient.given} ${patient.family}`)}</strong>, MRN ${esc(patient.mrn)}, Health ID ${esc(patient.healthId)}. Visit ${esc(enc.visitNumber)}. Total visit time: ${esc(humanDuration(total))}.</p>
<h2>Timeline</h2><table><thead><tr><th>When</th><th>Step</th><th>Staff</th><th>Since Previous Step</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No events.</td></tr>`}</tbody></table>
<h2>Visit Summary</h2><table><thead><tr><th>Visit</th><th>Service</th><th>Doctor</th><th>Started</th><th>Length</th><th>Events</th></tr></thead><tbody>${vrows}</tbody></table>
</body></html>`;
}
