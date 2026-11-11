import { attentionFor, sbarFor, sbarText } from "../chart-review";
import { clockOf, ctasInfo, stageOf } from "../ed";
import { getLab, hasCritical, leafTests } from "../lab";
import type { Encounter, HisState, Patient } from "../model";
import { estimateCharge, needsAuthorization, stepViews } from "../nphies-financial";
import { buildOutbox, mayAct, type OutboxRow } from "../nphies-outbox";
import { getRad } from "../radiology";
import { hasGlass } from "../session";
import { getState, patientName } from "../store";
import { claimReadiness } from "../vitals";

/**
 * Onasi AI agents. A chat assistant answers about one chart. An agent works across the whole hospital:
 * it reads the live stores, shows each step it took, and ends with proposals. It never acts by itself.
 * A person approves each proposal, and every run, approval and dismissal is written to the audit trail.
 * The agents are simulated with fixed rules, like the rest of Onasi AI. A real model could sit behind `runAgent`.
 */

export type AgentId = "clearance" | "discharge" | "ed-flow" | "claim-guard" | "critical" | "handoff";

export interface AgentDef {
  id: AgentId;
  name: string;
  /** One line: the job it does. */
  job: string;
  /** Who would ask for it. */
  forWhom: string;
  /** What it may do once a person approves. */
  canDo: string;
}

export const AGENTS: AgentDef[] = [
  { id: "discharge", name: "Discharge Readiness", job: "Finds what still blocks each inpatient from going home.", forWhom: "Ward doctors and bed managers", canDo: "Send the visit update. Open the right chart section." },
  { id: "critical", name: "Critical Result Chaser", job: "Finds critical lab and imaging results and makes sure the doctor knows.", forWhom: "Lab, radiology and the attending doctor", canDo: "Notify the attending doctor. Open the result." },
  { id: "ed-flow", name: "Emergency Flow", job: "Watches triage clocks and names who has waited past the CTAS target.", forWhom: "The ED charge nurse", canDo: "Open the emergency board at the patient." },
  { id: "clearance", name: "NPHIES Clearance", job: "Goes through everything waiting to be sent to NPHIES and prepares one batch.", forWhom: "Health information and integration staff", canDo: "Send each ready item. Open a rejected item." },
  { id: "claim-guard", name: "Claim Guardian", job: "Checks each visit before the claim goes out, so the payer has no reason to refuse it.", forWhom: "Revenue cycle staff", canDo: "Open the missing data. Open the claim." },
  { id: "handoff", name: "Shift Handoff", job: "Writes an SBAR handoff for every inpatient, sickest first.", forWhom: "Nurses and doctors at shift change", canDo: "Copy the handoff sheet." },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, AgentDef>;

export type ProposalAction =
  | { kind: "send-row"; label: string; rowKey: string }
  | { kind: "send-update"; label: string; visit: string }
  | { kind: "open"; label: string; path: string; params?: Record<string, string> }
  | { kind: "notify"; label: string; to: string; message: string }
  | { kind: "copy"; label: string; text: string };

export interface Proposal {
  id: string;
  level: "high" | "medium" | "info";
  patient: string;
  visit: string;
  /** What the agent wants to do or wants you to know. */
  text: string;
  /** The evidence it found. */
  why: string;
  action?: ProposalAction;
}

export interface AgentStep { did: string; found: string }

export interface AgentRun {
  agent: AgentId;
  at: string;
  steps: AgentStep[];
  proposals: Proposal[];
  /** One sentence the user can read without opening anything. */
  headline: string;
}

const RANK = { high: 0, medium: 1, info: 2 } as const;
const byLevel = (a: Proposal, b: Proposal) => RANK[a.level] - RANK[b.level];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Visits the agent may read. Confidential charts stay closed unless the glass was broken. */
function readable(s: HisState): { rows: { enc: Encounter; patient: Patient }[]; skipped: number } {
  const rows: { enc: Encounter; patient: Patient }[] = [];
  let skipped = 0;
  for (const enc of s.encounters) {
    const patient = s.patients.find((p) => p.id === enc.patientId);
    if (!patient || enc.status === "cancelled") continue;
    if (patient.confidential && !hasGlass(patient.id)) { skipped++; continue; }
    rows.push({ enc, patient });
  }
  return { rows, skipped };
}

const skippedStep = (n: number): AgentStep[] => (n ? [{ did: "Left confidential charts closed", found: `${plural(n, "visit")} not read` }] : []);

function discharge(s: HisState): Omit<AgentRun, "agent" | "at"> {
  const { rows, skipped } = readable(s);
  const inpatients = rows.filter((r) => r.enc.cls === "I" && r.enc.status === "active");
  const proposals: Proposal[] = [];
  let clear = 0;
  for (const { enc, patient } of inpatients) {
    const blockers = attentionFor(enc, patient).filter((a) => a.level !== "info" || a.id === "no-dx" || a.id === "lab-wait" || a.id === "rad-wait");
    if (!blockers.length) {
      clear++;
      proposals.push({ id: `dc-ok-${enc.visitNumber}`, level: "info", patient: patientName(patient), visit: enc.visitNumber, text: "Nothing in the chart blocks discharge.", why: "Diagnosis recorded, no results pending, vital signs in range, updates sent.", action: { kind: "open", label: "Open Chart", path: "/chart", params: { visit: enc.visitNumber } } });
      continue;
    }
    for (const b of blockers) {
      proposals.push({
        id: `dc-${enc.visitNumber}-${b.id}`, level: b.level, patient: patientName(patient), visit: enc.visitNumber, text: b.text, why: "Found in this patient's chart.",
        action: b.action === "send-update" ? { kind: "send-update", label: "Send Update", visit: enc.visitNumber } : { kind: "open", label: "Open In Chart", path: "/chart", params: { visit: enc.visitNumber, s: b.section } },
      });
    }
  }
  return {
    steps: [
      { did: "Read the inpatient list", found: plural(inpatients.length, "active inpatient") },
      ...skippedStep(skipped),
      { did: "Checked each chart: diagnosis, results, vital signs, unsent updates", found: `${plural(proposals.filter((p) => p.level !== "info").length, "blocker")}` },
      { did: "Sorted by urgency", found: `${clear} ready to go home` },
    ],
    proposals: proposals.sort(byLevel),
    headline: inpatients.length ? `${clear} of ${plural(inpatients.length, "inpatient")} can go home now.` : "No inpatients right now.",
  };
}

function critical(s: HisState): Omit<AgentRun, "agent" | "at"> {
  const { rows, skipped } = readable(s);
  const byVisit = new Map(rows.map((r) => [r.enc.visitNumber, r]));
  const proposals: Proposal[] = [];
  const labs = getLab().orders.filter((o) => hasCritical(o));
  const rads = getRad().orders.filter((o) => o.report?.critical);
  for (const o of labs) {
    const r = byVisit.get(o.visitNumber);
    if (!r) continue;
    const tests = leafTests(o).map((t) => t.short).slice(0, 3).join(", ");
    proposals.push({ id: `crit-lab-${o.id}`, level: "high", patient: patientName(r.patient), visit: o.visitNumber, text: `Critical lab value on ${tests}. Tell the attending doctor now.`, why: `Order ${o.id} has a result flagged critical.`, action: { kind: "notify", label: "Notify Doctor", to: r.enc.attending, message: `Critical lab value for ${patientName(r.patient)} (${tests}), visit ${o.visitNumber}. Please review.` } });
  }
  for (const o of rads) {
    const r = byVisit.get(o.visitNumber);
    if (!r) continue;
    proposals.push({ id: `crit-rad-${o.id}`, level: "high", patient: patientName(r.patient), visit: o.visitNumber, text: "Critical imaging finding. Tell the attending doctor now.", why: `Radiology order ${o.id} is marked as a critical finding.`, action: { kind: "notify", label: "Notify Doctor", to: r.enc.attending, message: `Critical imaging finding for ${patientName(r.patient)}, visit ${o.visitNumber}. Please review.` } });
  }
  return {
    steps: [
      { did: "Read every lab result", found: plural(labs.length, "critical value") },
      { did: "Read every imaging report", found: plural(rads.length, "critical finding") },
      ...skippedStep(skipped),
      { did: "Matched each one to the attending doctor", found: plural(proposals.length, "doctor to notify", "doctors to notify") },
    ],
    proposals,
    headline: proposals.length ? `${plural(proposals.length, "critical result")} need a doctor's eyes.` : "No critical results waiting.",
  };
}

function edFlow(s: HisState, now: number): Omit<AgentRun, "agent" | "at"> {
  const { rows, skipped } = readable(s);
  const ed = rows.filter((r) => r.enc.cls === "E" && r.enc.status === "active" && r.enc.ed);
  const proposals: Proposal[] = [];
  for (const { enc, patient } of ed) {
    const c = clockOf(enc.ed!, now);
    const stage = stageOf(enc.ed!);
    if (stage === "waiting-triage" && c.overdue) {
      proposals.push({ id: `ed-triage-${enc.visitNumber}`, level: "medium", patient: patientName(patient), visit: enc.visitNumber, text: `Not triaged after ${c.waited} minutes. Triage is due within 10.`, why: `Arrived by ${enc.ed!.arrivalMode.toLowerCase()}. No CTAS level yet.`, action: { kind: "open", label: "Open Emergency Board", path: "/er" } });
    } else if (stage === "waiting-doctor" && c.overdue && enc.ed!.ctas) {
      const info = ctasInfo(enc.ed!.ctas);
      proposals.push({ id: `ed-doc-${enc.visitNumber}`, level: enc.ed!.ctas <= 2 ? "high" : "medium", patient: patientName(patient), visit: enc.visitNumber, text: `CTAS ${enc.ed!.ctas} (${info.label}) has waited ${c.waited} minutes for a doctor. The target is ${info.targetMin}.`, why: enc.ed!.complaint ? `Complaint: ${enc.ed!.complaint}.` : "Waiting for a doctor.", action: { kind: "open", label: "Open Emergency Board", path: "/er" } });
    }
  }
  return {
    steps: [
      { did: "Read the emergency board", found: plural(ed.length, "patient") },
      ...skippedStep(skipped),
      { did: "Compared each wait with its CTAS target", found: `${plural(proposals.length, "patient")} past target` },
    ],
    proposals: proposals.sort(byLevel),
    headline: proposals.length ? `${plural(proposals.length, "emergency patient")} waited past the target.` : "Every emergency patient is inside the target.",
  };
}

const rowText = (r: OutboxRow) => `${r.item}`;

function clearance(): Omit<AgentRun, "agent" | "at"> {
  const rows = buildOutbox();
  const ready = rows.filter((r) => r.ready && r.action && r.state !== "rejected");
  const rejected = rows.filter((r) => r.state === "rejected");
  const blocked = rows.filter((r) => !r.ready && r.state === "not-sent");
  const proposals: Proposal[] = [
    ...rejected.map((r): Proposal => ({ id: `nx-rej-${r.key}`, level: "high", patient: r.patient, visit: r.visit, text: `NPHIES refused: ${rowText(r)}. Fix it and send again.`, why: r.stateDetail, action: { kind: "open", label: "Open NPHIES Clinical", path: "/nphies-clinical" } })),
    ...ready.map((r): Proposal => ({ id: `nx-${r.key}`, level: "medium", patient: r.patient, visit: r.visit, text: `${r.action}: ${rowText(r)}.`, why: r.state === "changes" ? "It changed after the last send." : "Complete and never sent.", action: mayAct(r) ? { kind: "send-row", label: r.action ?? "Send", rowKey: r.key } : undefined })),
    ...blocked.slice(0, 6).map((r): Proposal => ({ id: `nx-wait-${r.key}`, level: "info", patient: r.patient, visit: r.visit, text: `Not ready yet: ${rowText(r)}.`, why: r.blocked || "Waiting for clinical work to finish." })),
  ];
  return {
    steps: [
      { did: "Read the NPHIES send list", found: plural(rows.length, "item") },
      { did: "Checked which items are complete", found: `${ready.length} ready, ${blocked.length} waiting` },
      { did: "Looked for refusals", found: plural(rejected.length, "refused item") },
      { did: "Prepared one batch for approval", found: plural(ready.length, "message") },
    ],
    proposals,
    headline: ready.length || rejected.length ? `${plural(ready.length, "item")} ready to send, ${rejected.length} refused.` : "Nothing is waiting to be sent.",
  };
}

function claimGuard(s: HisState): Omit<AgentRun, "agent" | "at"> {
  const { rows, skipped } = readable(s);
  const visits = rows.filter((r) => r.enc.status === "active" || r.enc.status === "discharged");
  const proposals: Proposal[] = [];
  let clean = 0;
  for (const { enc, patient } of visits) {
    const name = patientName(patient);
    const before = proposals.length;
    if (!enc.dx.length) proposals.push({ id: `cg-dx-${enc.visitNumber}`, level: "high", patient: name, visit: enc.visitNumber, text: "No diagnosis. A claim without a diagnosis is refused.", why: "The diagnosis list is empty.", action: { kind: "open", label: "Add Diagnosis", path: "/chart", params: { visit: enc.visitNumber, s: "diagnosis" } } });
    const claim = claimReadiness(enc.visitNumber);
    const missing = claim.lines.filter((l) => l.state === "missing").map((l) => l.label);
    if (missing.length) proposals.push({ id: `cg-vs-${enc.visitNumber}`, level: "medium", patient: name, visit: enc.visitNumber, text: `Claim data missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.`, why: "The payer rules ask for vital signs and the chief complaint on the claim.", action: { kind: "open", label: "Open Vital Signs", path: "/chart", params: { visit: enc.visitNumber, s: "vitals" } } });
    const charge = estimateCharge(enc);
    const auth = stepViews(enc).find((v) => v.step === "authorization");
    if (needsAuthorization(enc, charge) && auth && auth.tone !== "ok") proposals.push({ id: `cg-auth-${enc.visitNumber}`, level: "medium", patient: name, visit: enc.visitNumber, text: `Prior authorization is needed and not approved yet (estimated ${charge.total.toLocaleString("en-US")} SAR).`, why: `Authorization status: ${auth.status}.`, action: { kind: "open", label: "Open NPHIES Financial", path: "/nphies-financial" } });
    if (proposals.length === before) clean++;
  }
  return {
    steps: [
      { did: "Read active and discharged visits", found: plural(visits.length, "visit") },
      ...skippedStep(skipped),
      { did: "Checked diagnosis, claim vital signs and chief complaint", found: `${plural(proposals.filter((p) => p.id.startsWith("cg-dx") || p.id.startsWith("cg-vs")).length, "gap")}` },
      { did: "Checked prior authorization against the estimated charge", found: `${plural(proposals.filter((p) => p.id.startsWith("cg-auth")).length, "visit")} without approval` },
    ],
    proposals: proposals.sort(byLevel),
    headline: `${clean} of ${plural(visits.length, "visit")} would pass the claim checks.`,
  };
}

function handoff(s: HisState): Omit<AgentRun, "agent" | "at"> {
  const { rows, skipped } = readable(s);
  const inpatients = rows.filter((r) => r.enc.cls === "I" && r.enc.status === "active");
  const scored = inpatients.map(({ enc, patient }) => {
    const att = attentionFor(enc, patient);
    const urgent = att.filter((a) => a.level === "high").length;
    return { enc, patient, urgent, soon: att.filter((a) => a.level === "medium").length, text: sbarText(sbarFor(enc, patient)) };
  }).sort((a, b) => b.urgent - a.urgent || b.soon - a.soon);
  const sheet = scored.map((x) => `${patientName(x.patient)} (${x.enc.visitNumber})\n${x.text}`).join("\n\n");
  const proposals: Proposal[] = scored.map((x) => ({
    id: `ho-${x.enc.visitNumber}`, level: x.urgent ? "high" : x.soon ? "medium" : "info", patient: patientName(x.patient), visit: x.enc.visitNumber,
    text: sbarFor(x.enc, x.patient).situation, why: x.urgent ? `${plural(x.urgent, "urgent item")} in the chart.` : x.soon ? `${plural(x.soon, "item")} to do soon.` : "Stable. Nothing urgent.",
    action: { kind: "copy", label: "Copy SBAR", text: x.text },
  }));
  if (scored.length > 1) proposals.unshift({ id: "ho-all", level: "info", patient: "Whole ward", visit: "", text: `One handoff sheet for all ${scored.length} inpatients, sickest first.`, why: "Built from each chart's situation, background, assessment and recommendation.", action: { kind: "copy", label: "Copy The Whole Sheet", text: sheet } });
  return {
    steps: [
      { did: "Read the inpatient list", found: plural(inpatients.length, "active inpatient") },
      ...skippedStep(skipped),
      { did: "Wrote an SBAR handoff from each chart", found: plural(scored.length, "handoff") },
      { did: "Put the sickest patients first", found: `${scored.filter((x) => x.urgent).length} with urgent items` },
    ],
    proposals,
    headline: scored.length ? `Handoff ready for ${plural(scored.length, "inpatient")}.` : "No inpatients to hand off.",
  };
}

export function runAgent(id: AgentId, now: Date = new Date(), s: HisState = getState()): AgentRun {
  const body =
    id === "discharge" ? discharge(s)
    : id === "critical" ? critical(s)
    : id === "ed-flow" ? edFlow(s, now.getTime())
    : id === "clearance" ? clearance()
    : id === "claim-guard" ? claimGuard(s)
    : handoff(s);
  return { agent: id, at: now.toISOString(), ...body };
}

/** What a run asks of people: used for the counts on each agent card. */
export const needsDecision = (run: AgentRun) => run.proposals.filter((p) => p.action && p.level !== "info").length;
