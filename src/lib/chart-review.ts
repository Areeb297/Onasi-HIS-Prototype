import { EMR_FORM_BY_ID } from "./emr-forms";
import { getDocsState, docsForVisit } from "./docs";
import { RAD_CATALOG } from "./fhir/rad-catalog";
import { getLab, hasCritical, leafTests } from "./lab";
import type { Encounter, HisState, Patient } from "./model";
import { getRad } from "./radiology";
import { getFormRecords } from "./records";
import { getRx } from "./rx";
import { EVENT_BY_ID } from "./spec";
import { bedLabel, getState } from "./store";
import { visitMessages } from "./visitMessages";
import { claimReadiness, getVitals, obsValue, panelsOf, type VitalPanel } from "./vitals";
import { CONTEXTS, ROUTINE_INTERVAL_HOURS, VITALS, VITAL_BY_KEY, flagFor, news2, type VitalKey } from "./vitals-spec";

/**
 * Chart review helpers. Three ideas that proper EMRs ask for and rarely give:
 * 1. One chronological timeline of everything in the visit (messages, vitals, orders, results, notes, documents).
 * 2. A "needs attention" list, so a clinician does not hunt through tabs.
 * 3. An SBAR handoff written from the chart, ready to read aloud or paste.
 * Pure functions over the stores. They never write anything.
 */

export type TimelineKind = "adt" | "vitals" | "lab" | "rad" | "rx" | "doc" | "note" | "form";
export type Tone = "ok" | "warn" | "danger" | "neutral";

export interface TimelineItem {
  id: string;
  at: number;
  kind: TimelineKind;
  title: string;
  detail?: string;
  tone: Tone;
  /** Chart menu id to open. */
  section: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ms = (s: string | undefined): number => (s ? new Date(s).getTime() : 0);
const ctxLabel = (id: string) => CONTEXTS.find((c) => c.id === id)?.label ?? id;
const ageOf = (p: Patient) => Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86_400_000));

function vitalsLine(p: VitalPanel): string {
  const v = (k: VitalKey) => obsValue(p, k);
  const parts: string[] = [];
  if (v("sbp") !== undefined && v("dbp") !== undefined) parts.push(`BP ${v("sbp")}/${v("dbp")}`);
  if (v("pulse") !== undefined) parts.push(`HR ${v("pulse")}`);
  if (v("rr") !== undefined) parts.push(`RR ${v("rr")}`);
  if (v("temp") !== undefined) parts.push(`T ${v("temp")}`);
  if (v("spo2") !== undefined) parts.push(`SpO2 ${v("spo2")}%`);
  return parts.join(", ");
}

function abnormal(p: VitalPanel, age: number): string[] {
  return VITALS.filter((d) => {
    const x = obsValue(p, d.key);
    return x !== undefined && flagFor(d, x, age) !== "";
  }).map((d) => `${d.label} ${obsValue(p, d.key)}`);
}

export function buildTimeline(enc: Encounter, state: HisState = getState()): TimelineItem[] {
  const out: TimelineItem[] = [];
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const age = patient ? ageOf(patient) : 40;

  for (const m of visitMessages(state, enc)) {
    out.push({
      id: `adt-${m.seq}`, at: ms(m.sentAt), kind: "adt", section: "adt",
      title: `${m.trigger} ${EVENT_BY_ID[m.eventId].name}`,
      detail: m.errors ? `${m.errors} error${m.errors > 1 ? "s" : ""} in the message` : "Sent",
      tone: m.errors ? "danger" : m.warnings ? "warn" : "ok",
    });
  }
  for (const p of panelsOf(enc.visitNumber, getVitals())) {
    const abn = p.status === "X" ? [] : abnormal(p, age);
    out.push({
      id: `vs-${p.id}`, at: ms(p.at), kind: "vitals", section: "vitals",
      title: `Vital signs, ${ctxLabel(p.context).toLowerCase()}${p.status === "C" ? " (corrected)" : p.status === "X" ? " (cancelled)" : ""}`,
      detail: abn.length ? `${vitalsLine(p)}. Check: ${abn.join(", ")}` : vitalsLine(p),
      tone: p.status === "X" ? "neutral" : abn.length ? "warn" : "ok",
    });
  }
  for (const o of getLab().orders.filter((x) => x.visitNumber === enc.visitNumber)) {
    const names = leafTests(o).map((t) => t.short).slice(0, 4).join(", ");
    out.push({
      id: `lab-${o.id}`, at: ms(o.orderedAt), kind: "lab", section: "laboratory",
      title: `Lab ${o.status === "resulted" || o.status === "amended" ? "result" : "order"}: ${names || o.id}`,
      detail: hasCritical(o) ? "Critical value" : cap(o.status.replace(/-/g, " ")),
      tone: hasCritical(o) ? "danger" : o.status === "resulted" || o.status === "amended" ? "ok" : o.status === "cancelled" ? "neutral" : "warn",
    });
  }
  for (const o of getRad().orders.filter((x) => x.visitNumber === enc.visitNumber)) {
    const proc = RAD_CATALOG.find((x) => x.code === o.procCode)?.short ?? o.procCode;
    const critical = !!(o.report as { critical?: boolean } | undefined)?.critical;
    out.push({
      id: `rad-${o.id}`, at: ms(o.orderedAt), kind: "rad", section: "radiology",
      title: `Imaging ${o.status === "resulted" || o.status === "amended" ? "report" : "order"}: ${proc}`,
      detail: critical ? "Critical finding" : cap(o.status.replace(/-/g, " ")), tone: critical ? "danger" : o.status === "resulted" || o.status === "amended" ? "ok" : o.status === "cancelled" ? "neutral" : "warn",
    });
  }
  for (const rx of getRx().prescriptions.filter((x) => x.visitNumber === enc.visitNumber)) {
    out.push({
      id: `rx-${rx.id}`, at: ms(rx.authoredAt), kind: "rx", section: "prescription",
      title: `Prescription ${rx.number}${rx.controlled ? " (controlled)" : ""}`,
      detail: `${rx.items.length} item${rx.items.length === 1 ? "" : "s"}`, tone: "neutral",
    });
  }
  for (const d of docsForVisit(enc.visitNumber, getDocsState())) {
    out.push({
      id: `doc-${d.id}`, at: ms(d.createdAt), kind: "doc", section: "documents",
      title: `${d.type[0].toUpperCase()}${d.type.slice(1)} summary v${d.version}`,
      detail: cap(d.status), tone: d.status === "published" ? "ok" : d.status === "deprecated" ? "neutral" : "warn",
    });
  }
  for (const n of enc.notes) {
    out.push({ id: `note-${n.at}-${n.author}`, at: ms(n.at), kind: "note", section: "notes", title: `Progress note by ${n.author}`, detail: n.text.slice(0, 110), tone: "neutral" });
  }
  for (const [formId, def] of Object.entries(EMR_FORM_BY_ID)) {
    for (const r of getFormRecords(enc.visitNumber, formId)) {
      out.push({ id: `form-${r.id}`, at: ms(r.at), kind: "form", section: formId, title: def.title, detail: `By ${r.author}`, tone: "neutral" });
    }
  }
  return out.filter((i) => i.at > 0).sort((a, b) => b.at - a.at);
}

/* ---------- needs attention ---------- */

export interface Attention {
  id: string;
  level: "high" | "medium" | "info";
  text: string;
  section: string;
  /** A one-click fix, if there is one. */
  action?: "send-update";
  actionLabel?: string;
}

export function attentionFor(enc: Encounter, patient: Patient): Attention[] {
  const out: Attention[] = [];
  const panels = panelsOf(enc.visitNumber, getVitals()).filter((p) => p.status !== "X");
  const newest = panels[0];
  const age = ageOf(patient);

  const critical = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && hasCritical(o));
  if (critical.length) out.push({ id: "crit-lab", level: "high", section: "laboratory", text: `Critical lab value: ${critical.flatMap((o) => leafTests(o).map((t) => t.short)).slice(0, 3).join(", ")}. Review and act.` });

  if (newest) {
    const nums = Object.fromEntries(VITALS.map((d) => [d.key, obsValue(newest, d.key)]).filter(([, x]) => x !== undefined)) as Partial<Record<VitalKey, number>>;
    const score = age >= 16 ? news2(nums, newest.onOxygen, newest.consciousness) : null;
    if (score && score.total >= 5) out.push({ id: "news", level: "high", section: "vitals", text: `Early warning score ${score.total} (${score.band}). ${score.note}` });
    const abn = abnormal(newest, age);
    if (abn.length && !(score && score.total >= 5)) out.push({ id: "abn", level: "medium", section: "vitals", text: `Abnormal vital signs: ${abn.join(", ")}.` });
    if (enc.cls === "I" && enc.status === "active") {
      const late = Math.round((Date.now() - new Date(newest.at).getTime() - ROUTINE_INTERVAL_HOURS * 3_600_000) / 60_000);
      if (late > 0) out.push({ id: "vs-due", level: "medium", section: "vitals", text: `Vital signs are ${late} minutes overdue (policy example: every ${ROUTINE_INTERVAL_HOURS} hours).` });
    }
  } else if (enc.status === "active" && enc.cls !== "P") {
    out.push({ id: "vs-none", level: "medium", section: "vitals", text: "No vital signs recorded for this visit." });
  }

  if (enc.dirty) out.push({ id: "dirty", level: "medium", section: "overview", text: "The chart changed after the last update was sent to NPHIES.", action: "send-update", actionLabel: "Send Update" });

  if (enc.status === "active" && enc.dx.length === 0) out.push({ id: "no-dx", level: "info", section: "diagnosis", text: "No diagnosis yet. One is needed to discharge." });

  const claim = claimReadiness(enc.visitNumber);
  const missing = claim.lines.filter((l) => l.state === "missing").map((l) => l.label);
  if (enc.status !== "preadmit" && missing.length) out.push({ id: "claim", level: "info", section: "vitals", text: `Missing for the insurance claim: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.` });

  const unsent = panels.filter((p) => !p.sends.length || !p.sends[p.sends.length - 1].accepted || p.sends[p.sends.length - 1].version < p.version);
  if (unsent.length) out.push({ id: "vs-unsent", level: "info", section: "vitals", text: `${unsent.length} vital sign panel${unsent.length > 1 ? "s" : ""} not sent to NPHIES.` });

  const waiting = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && !["resulted", "amended", "cancelled"].includes(o.status));
  if (waiting.length) out.push({ id: "lab-wait", level: "info", section: "laboratory", text: `${waiting.length} lab order${waiting.length > 1 ? "s" : ""} waiting for results.` });
  const radWait = getRad().orders.filter((o) => o.visitNumber === enc.visitNumber && !["resulted", "amended", "cancelled"].includes(o.status));
  if (radWait.length) out.push({ id: "rad-wait", level: "info", section: "radiology", text: `${radWait.length} imaging order${radWait.length > 1 ? "s" : ""} waiting for a report.` });

  if (enc.status === "discharged" && enc.cls !== "E") {
    const published = docsForVisit(enc.visitNumber, getDocsState()).some((d) => d.status === "published");
    if (!published) out.push({ id: "doc", level: "medium", section: "documents", text: "Discharged, but no clinical summary has been published to NPHIES." });
  }
  const rank = { high: 0, medium: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/* ---------- SBAR handoff ---------- */

export interface Sbar { situation: string; background: string; assessment: string; recommendation: string }

export function sbarFor(enc: Encounter, patient: Patient): Sbar {
  const age = ageOf(patient);
  const panels = panelsOf(enc.visitNumber, getVitals()).filter((p) => p.status !== "X");
  const newest = panels[0];
  const where = enc.status === "active" && enc.bedId ? bedLabel(enc.bedId) : enc.cls === "E" ? "the emergency department" : enc.cls === "I" ? "inpatient care" : "outpatient care";
  const nums = newest ? (Object.fromEntries(VITALS.map((d) => [d.key, obsValue(newest, d.key)]).filter(([, x]) => x !== undefined)) as Partial<Record<VitalKey, number>>) : {};
  const score = newest && age >= 16 ? news2(nums, newest.onOxygen, newest.consciousness) : null;
  const allergies = enc.allergies.length ? enc.allergies.map((a) => a.text).join(", ") : "none recorded";
  const dx = enc.dx.length ? enc.dx.map((d) => `${d.text} (${d.code})`).join("; ") : "none yet";
  const pr = enc.pr.length ? enc.pr.map((p) => p.text).join("; ") : "none";
  const lastNote = enc.notes[enc.notes.length - 1];
  const abn = newest ? abnormal(newest, age) : [];
  const crit = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && hasCritical(o));
  const waiting = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && !["resulted", "amended", "cancelled"].includes(o.status)).length
    + getRad().orders.filter((o) => o.visitNumber === enc.visitNumber && !["resulted", "amended", "cancelled"].includes(o.status)).length;
  const todo = attentionFor(enc, patient).filter((a) => a.level !== "info" || a.id === "no-dx").slice(0, 4).map((a) => a.text);

  return {
    situation: `${patient.given} ${patient.family}, ${age} years, ${patient.sex === "M" ? "male" : "female"}, in ${where}. Reason for the visit: ${enc.reason || "not recorded"}.${newest ? ` Latest vital signs: ${vitalsLine(newest)}.` : " No vital signs recorded."}${score ? ` Early warning score ${score.total} (${score.band}).` : ""}`,
    background: `Diagnoses: ${dx}. Allergies: ${allergies}. Procedures: ${pr}.${lastNote ? ` Last note: ${lastNote.text.slice(0, 160)}` : ""}`,
    assessment: `${abn.length ? `Abnormal: ${abn.join(", ")}. ` : newest ? "Vital signs are in range. " : "No vital signs recorded. "}${crit.length ? `Critical lab value reported. ` : ""}${waiting ? `${waiting} result${waiting > 1 ? "s" : ""} still pending.` : "No results pending."}`,
    recommendation: todo.length ? todo.map((t) => `- ${t}`).join("\n") : "Continue the current plan. Nothing urgent in the chart.",
  };
}

export const sbarText = (s: Sbar) => `S: ${s.situation}\nB: ${s.background}\nA: ${s.assessment}\nR: ${s.recommendation}`;
