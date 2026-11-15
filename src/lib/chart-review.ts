import { runCds, type Flag } from "./ai/cds";
import { vitalNums } from "./ai/context";
import { buildContext } from "./ai/live";
import { careAttention } from "./care-attention";
import { EMR_FORM_BY_ID } from "./emr-forms";
import { fmtShort } from "./format";
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
import { CONTEXTS, ROUTINE_INTERVAL_HOURS, VITALS, VITAL_BY_KEY, flagFor, news2, type Consciousness, type VitalKey } from "./vitals-spec";

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

type Nums = Partial<Record<VitalKey, number>>;

const panelNums = (p: VitalPanel): Nums =>
  Object.fromEntries(VITALS.map((d) => [d.key, obsValue(p, d.key)]).filter(([, x]) => x !== undefined)) as Nums;

function vitalsLine(v: Nums): string {
  const parts: string[] = [];
  if (v.sbp !== undefined && v.dbp !== undefined) parts.push(`BP ${v.sbp}/${v.dbp}`);
  if (v.pulse !== undefined) parts.push(`HR ${v.pulse}`);
  if (v.rr !== undefined) parts.push(`RR ${v.rr}`);
  if (v.temp !== undefined) parts.push(`T ${v.temp}`);
  if (v.spo2 !== undefined) parts.push(`SpO2 ${v.spo2}%`);
  return parts.join(", ");
}

function abnormal(v: Nums, age: number): string[] {
  return VITALS.filter((d) => {
    const x = v[d.key];
    return x !== undefined && flagFor(d, x, age) !== "";
  }).map((d) => `${d.label} ${v[d.key]}`);
}

/* ---------- latest vital signs: the one reading every part of the chart uses ---------- */

export interface LatestVitals {
  /** Local time the reading was taken, "YYYY-MM-DDTHH:mm". */
  at: string;
  /** "panel" is a panel in the vital signs store; "chart" is the reading kept on the visit (the chart header). */
  source: "panel" | "chart";
  /** Panel context (admission, routine...), when the reading is a panel. */
  context?: string;
  nums: Nums;
  onOxygen: boolean;
  consciousness: Consciousness;
}

/**
 * The newest vital signs of the visit, from whichever store holds the newer reading. The chart header tiles, the SBAR
 * handoff, Needs Attention and the safety checks all read this, so they always quote the same numbers. On a tie the
 * panel wins, because saving a panel also copies it to the visit.
 */
export function latestVitals(enc: Encounter): LatestVitals | null {
  const panel = panelsOf(enc.visitNumber, getVitals()).find((p) => p.status !== "X");
  const fromPanel: LatestVitals | null = panel
    ? { at: panel.at, source: "panel", context: panel.context, nums: panelNums(panel), onOxygen: panel.onOxygen, consciousness: panel.consciousness }
    : null;
  const chartNums = Object.fromEntries(Object.entries(vitalNums(enc.vitals)).filter(([, x]) => x !== undefined)) as Nums;
  const fromChart: LatestVitals | null = enc.vitals && Object.keys(chartNums).length
    ? { at: enc.vitals.at, source: "chart", nums: chartNums, onOxygen: panel?.onOxygen ?? false, consciousness: panel?.consciousness ?? "Alert" }
    : null;
  if (!fromPanel || !fromChart) return fromPanel ?? fromChart;
  return ms(fromChart.at) > ms(fromPanel.at) ? fromChart : fromPanel;
}

/** "15 Nov, 14:26" (the full date for another year): the time shown next to a vital signs reading. */
export const vitalsTime = (at: string) => fmtShort(at);

/** The latest reading in the visit's header format (bp "120/80", pulse "84"...). The header tiles should show this. */
export const latestChartVitals = (enc: Encounter): Encounter["vitals"] => asChartVitals(enc, latestVitals(enc));

/** The latest reading in the visit's header format, so the safety checks read the same numbers as the tiles. */
function asChartVitals(enc: Encounter, l: LatestVitals | null): Encounter["vitals"] {
  if (!l) return enc.vitals;
  const s = (k: VitalKey) => (l.nums[k] === undefined ? "" : String(l.nums[k]));
  return {
    ...(enc.vitals ?? { weight: "" }),
    bp: l.nums.sbp !== undefined && l.nums.dbp !== undefined ? `${l.nums.sbp}/${l.nums.dbp}` : "",
    pulse: s("pulse"), temp: s("temp"), spo2: s("spo2"), rr: s("rr"), weight: s("weight") || enc.vitals?.weight || "",
    at: l.at,
  };
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
    const nums = panelNums(p);
    const abn = p.status === "X" ? [] : abnormal(nums, age);
    out.push({
      id: `vs-${p.id}`, at: ms(p.at), kind: "vitals", section: "vitals",
      title: `Vital signs, ${ctxLabel(p.context).toLowerCase()}${p.status === "C" ? " (corrected)" : p.status === "X" ? " (cancelled)" : ""}`,
      detail: abn.length ? `${vitalsLine(nums)}. Check: ${abn.join(", ")}` : vitalsLine(nums),
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
  const newest = latestVitals(enc);
  const age = ageOf(patient);

  const critical = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && hasCritical(o));
  if (critical.length) out.push({ id: "crit-lab", level: "high", section: "laboratory", text: `Critical lab value: ${critical.flatMap((o) => leafTests(o).map((t) => t.short)).slice(0, 3).join(", ")}. Review and act.` });

  if (newest) {
    const score = age >= 16 ? news2(newest.nums, newest.onOxygen, newest.consciousness) : null;
    if (score && score.total >= 5) out.push({ id: "news", level: "high", section: "vitals", text: `Early warning score ${score.total} (${score.band}). ${score.note}` });
    const abn = abnormal(newest.nums, age);
    if (abn.length && !(score && score.total >= 5)) out.push({ id: "abn", level: "medium", section: "vitals", text: `Abnormal vital signs: ${abn.join(", ")}.` });
    if (enc.cls === "I" && enc.status === "active") {
      const late = Math.round((Date.now() - new Date(newest.at).getTime() - ROUTINE_INTERVAL_HOURS * 3_600_000) / 60_000);
      if (late > 0) out.push({ id: "vs-due", level: "medium", section: "vitals", text: `Vital signs are ${late} minutes overdue (policy example: every ${ROUTINE_INTERVAL_HOURS} hours).` });
    }
  } else if (enc.status === "active") {
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
  out.push(...careAttention(enc));
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

const RANK = { high: 0, medium: 1, info: 2 } as const;

/** Chart menu section for a safety check, from the chart field it names. */
function sectionOf(f: Flag): string {
  const s = f.source.toLowerCase();
  if (s.startsWith("vitals")) return "vitals";
  if (s.startsWith("allergies")) return "allergies";
  if (s.startsWith("diagnosis")) return "diagnosis";
  if (s.startsWith("chief complaints")) return "complaints";
  if (s.includes("prescription")) return "prescription";
  return "overview";
}

/**
 * Every check on the chart in one list: the chart rules (attentionFor) plus the clinical safety checks (runCds), both
 * reading the same latest vital signs. Needs Attention, the Onasi AI badge and the AI brief should all count this list,
 * so the numbers on the screen agree. Where both raise the same point, the more specific check is kept.
 */
export function chartChecks(enc: Encounter, patient: Patient): Attention[] {
  const latest = latestVitals(enc);
  const flags = runCds(buildContext({ ...enc, vitals: asChartVitals(enc, latest) }, patient));
  const vitalFlag = flags.some((f) => f.level !== "info" && f.source.startsWith("Vitals"));
  const cdsNoDx = flags.some((f) => f.source === "Diagnosis" && f.level !== "info" && /No diagnosis/.test(f.text));
  const cdsNoVitals = flags.some((f) => /No vital signs/.test(f.text));
  const rules = attentionFor(enc, patient).filter((a) =>
    !(a.id === "abn" && vitalFlag) && !(a.id === "no-dx" && cdsNoDx) && !(a.id === "vs-none" && cdsNoVitals));
  const seen = new Set(rules.map((a) => a.text));
  const safety: Attention[] = [];
  flags.forEach((f, i) => {
    if (seen.has(f.text)) return;
    seen.add(f.text);
    safety.push({ id: `cds-${i}`, level: f.level, text: f.text, section: sectionOf(f) });
  });
  return [...rules, ...safety].sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** The numbers every badge shows for a chart: urgent, to do soon, and for information. "toAct" is urgent plus soon. */
export function checkCounts(list: Attention[]): { urgent: number; soon: number; info: number; toAct: number; total: number } {
  const urgent = list.filter((a) => a.level === "high").length;
  const soon = list.filter((a) => a.level === "medium").length;
  return { urgent, soon, info: list.length - urgent - soon, toAct: urgent + soon, total: list.length };
}

/* ---------- SBAR handoff ---------- */

export interface Sbar {
  situation: string; background: string; assessment: string; recommendation: string;
  /** When the vital signs quoted in the handoff were taken, for example "15 Nov, 14:26". Empty when none are recorded. */
  vitalsAt: string;
}

export function sbarFor(enc: Encounter, patient: Patient): Sbar {
  const age = ageOf(patient);
  const newest = latestVitals(enc);
  const where = enc.status === "active" && enc.bedId ? bedLabel(enc.bedId) : enc.cls === "E" ? "the emergency department" : enc.cls === "I" ? "inpatient care" : "outpatient care";
  const nums = newest?.nums ?? {};
  const score = newest && age >= 16 ? news2(nums, newest.onOxygen, newest.consciousness) : null;
  const vitalsAt = newest ? vitalsTime(newest.at) : "";
  const allergies = enc.allergies.length ? enc.allergies.map((a) => a.text).join(", ") : "none recorded";
  const dx = enc.dx.length ? enc.dx.map((d) => `${d.text} (${d.code})`).join("; ") : "none yet";
  const pr = enc.pr.length ? enc.pr.map((p) => p.text).join("; ") : "none";
  const lastNote = enc.notes[enc.notes.length - 1];
  const abn = newest ? abnormal(nums, age) : [];
  const crit = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && hasCritical(o));
  const waiting = getLab().orders.filter((o) => o.visitNumber === enc.visitNumber && !["resulted", "amended", "cancelled"].includes(o.status)).length
    + getRad().orders.filter((o) => o.visitNumber === enc.visitNumber && !["resulted", "amended", "cancelled"].includes(o.status)).length;
  const todo = chartChecks(enc, patient).filter((a) => a.level !== "info" || a.id === "no-dx").slice(0, 4).map((a) => a.text);

  return {
    vitalsAt,
    situation: `${patient.given} ${patient.family}, ${age} years, ${patient.sex === "M" ? "male" : "female"}, in ${where}. Reason for the visit: ${enc.reason || "not recorded"}.${newest ? ` Latest vital signs (${vitalsAt}): ${vitalsLine(nums)}.` : " No vital signs recorded."}${score ? ` Early warning score ${score.total} (${score.band}).` : ""}`,
    background: `Diagnoses: ${dx}. Allergies: ${allergies}. Procedures: ${pr}.${lastNote ? ` Last note: ${lastNote.text.slice(0, 160)}` : ""}`,
    assessment: `${abn.length ? `Abnormal: ${abn.join(", ")}. ` : newest ? "Vital signs are in range. " : "No vital signs recorded. "}${crit.length ? `Critical lab value reported. ` : ""}${waiting ? `${waiting} result${waiting > 1 ? "s" : ""} still pending.` : "No results pending."}`,
    recommendation: todo.length ? todo.map((t) => `- ${t}`).join("\n") : "Continue the current plan. Nothing urgent in the chart.",
  };
}

export const sbarText = (s: Sbar) => `S: ${s.situation}\nB: ${s.background}\nA: ${s.assessment}\nR: ${s.recommendation}`;
