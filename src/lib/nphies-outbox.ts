import { quickSend } from "./actions";
import { publishDoc, getDocsState } from "./docs";
import { getLab, orderNphiesState, resultNphiesState, publishLabResult, sendLabOrder, missingResults, leafTests, testByCode } from "./lab";
import { getRad, radOrderNphiesState, radReportNphiesState, publishRadReport, reportMissing, sendRadOrder, procByCode } from "./radiology";
import { getRx, getDrug } from "./rx";
import { planPrescription, sendPrescription } from "./rx-send";
import { can, type Permission } from "./session";
import { getState, patientName } from "./store";
import { getVitals, needsSend, sendPanel } from "./vitals";

/**
 * Everything the clinical side can send to NPHIES, as one flat list built from the existing stores.
 * Nothing is stored here. The list is rebuilt from the lab, radiology, prescription, vital signs, document and visit data.
 *
 * Assumptions (not stated in the NPHIES guide, chosen to match how the rest of the app works):
 * - A lab order is offered once the specimen is collected (the user's rule). A radiology order is offered once the exam is done.
 * - A result or report is offered once it is complete. Results that are still being typed show why they cannot be sent.
 * - A dispense is sent at the moment of dispensing, so it appears here as Sent and has no send button.
 * - Visit updates (ADT A08) are offered when the chart changed after the last update.
 */

export type OutboxType = "visit" | "lab-order" | "lab-result" | "rad-order" | "rad-report" | "rx" | "dispense" | "vitals" | "document";
export type OutboxGroup = "visit" | "lab" | "radiology" | "medication" | "vitals" | "documents";
export type SendState = "not-sent" | "sent" | "changes" | "rejected";

export const TYPE_LABEL: Record<OutboxType, string> = {
  visit: "Visit Update", "lab-order": "Lab Order", "lab-result": "Lab Result", "rad-order": "Radiology Order", "rad-report": "Radiology Report",
  rx: "Prescription", dispense: "Dispense", vitals: "Vital Signs", document: "Clinical Document",
};

export const GROUP_OF: Record<OutboxType, OutboxGroup> = {
  visit: "visit", "lab-order": "lab", "lab-result": "lab", "rad-order": "radiology", "rad-report": "radiology", rx: "medication", dispense: "medication",
  vitals: "vitals", document: "documents",
};

export const GROUP_LABEL: Record<OutboxGroup, string> = {
  visit: "Visit Updates", lab: "Laboratory", radiology: "Radiology", medication: "Medication", vitals: "Vital Signs", documents: "Clinical Documents",
};

export const STATE_LABEL: Record<SendState, string> = { "not-sent": "Not Sent", sent: "Sent", changes: "Changes Not Sent", rejected: "Rejected" };
export const STATE_TONE: Record<SendState, "neutral" | "ok" | "warn" | "danger"> = { "not-sent": "neutral", sent: "ok", changes: "warn", rejected: "danger" };

export interface OutboxRow {
  /** Stable key, for example lab-order:LO-100001. */
  key: string;
  type: OutboxType;
  group: OutboxGroup;
  /** Id of the thing in its own store (order id, prescription id, panel id, document id, visit number). */
  ref: string;
  patientId: string;
  patient: string;
  mrn: string;
  visit: string;
  /** What is being sent, in plain words. */
  item: string;
  state: SendState;
  /** More exact wording, for example "Sent (Version 2)". */
  stateDetail: string;
  /** True when the item is complete enough to send now. */
  ready: boolean;
  /** Why it cannot be sent yet. Empty when ready. */
  blocked: string;
  /** Verb of the send button. Null when there is nothing to send. */
  action: "Send" | "Resend" | null;
  /** Permission the underlying send needs. */
  perm: Permission;
  /** Time of the latest attempt, if any. ISO. */
  lastAt?: string;
}

const ACTION_PERM: Record<OutboxType, Permission> = {
  visit: "adt.send", "lab-order": "order.lab", "lab-result": "lab.result", "rad-order": "order.rad", "rad-report": "rad.report",
  rx: "rx.write", dispense: "rx.dispense", vitals: "adt.send", document: "docs.publish",
};

const fromTone = (tone: "neutral" | "ok" | "warn" | "danger"): SendState => (tone === "danger" ? "rejected" : tone === "warn" ? "changes" : tone === "ok" ? "sent" : "not-sent");

function actionFor(state: SendState, ready: boolean): OutboxRow["action"] {
  if (state === "sent" || !ready) return null;
  return state === "rejected" ? "Resend" : "Send";
}

/** Builds the full list. Reads the stores each time, so call it inside a component that subscribes to them. */
export function buildOutbox(): OutboxRow[] {
  const his = getState();
  const rows: OutboxRow[] = [];
  const who = (patientId: string) => {
    const p = his.patients.find((x) => x.id === patientId);
    return { patient: patientName(p), mrn: p?.mrn ?? "" };
  };
  const add = (r: Omit<OutboxRow, "group" | "perm" | "action" | "patient" | "mrn" | "blocked"> & { blocked?: string }) => {
    // Never sent and complete: say so plainly. This is also how a lab or radiology card moved to Resulted or Reported shows up.
    const stateDetail = r.state === "not-sent" && r.ready ? "Ready To Send" : r.stateDetail;
    rows.push({ ...r, stateDetail, ...who(r.patientId), group: GROUP_OF[r.type], perm: ACTION_PERM[r.type], blocked: r.ready ? "" : (r.blocked ?? ""), action: actionFor(r.state, r.ready) });
  };

  /* ---- visit updates (ADT A08) ---- */
  for (const e of his.encounters) {
    if (e.status !== "active" && e.status !== "discharged") continue;
    const last = [...his.log].reverse().find((l) => l.visitNumber === e.visitNumber);
    const rejected = !!last && last.errors > 0;
    const state: SendState = rejected ? "rejected" : e.dirty ? "changes" : "sent";
    add({
      key: `visit:${e.visitNumber}`, type: "visit", ref: e.visitNumber, patientId: e.patientId, visit: e.visitNumber,
      item: e.status === "discharged" ? "Visit details after discharge" : "Visit details (diagnoses, allergies, procedures)",
      state, stateDetail: STATE_LABEL[state], ready: true, lastAt: last?.sentAt,
    });
  }

  /* ---- laboratory ---- */
  for (const o of getLab().orders) {
    const tests = o.codes.map((c) => testByCode(c)?.short ?? c).join(", ");
    const order = orderNphiesState(o);
    const collected = o.specimens.length > 0;
    const everSent = o.sends.some((s) => s.kind === "lab-order");
    if (!(o.status === "cancelled" && !everSent)) {
      const st = fromTone(order.tone);
      const ready = collected || everSent;
      add({
        key: `lab-order:${o.id}`, type: "lab-order", ref: o.id, patientId: o.patientId, visit: o.visitNumber, item: `Order: ${tests}`,
        state: st, stateDetail: order.label, ready, blocked: "Waiting for the specimen to be collected.",
        lastAt: o.sends.filter((s) => s.kind === "lab-order").at(-1)?.at,
      });
    }
    const resultSent = o.sends.some((s) => s.kind === "lab-result");
    if (o.status === "in-progress" || o.status === "resulted" || o.status === "amended" || resultSent) {
      const res = resultNphiesState(o);
      const missing = missingResults(o).length;
      const total = leafTests(o).length;
      add({
        key: `lab-result:${o.id}`, type: "lab-result", ref: o.id, patientId: o.patientId, visit: o.visitNumber, item: `Result: ${tests}`,
        state: fromTone(res.tone), stateDetail: res.label, ready: missing === 0, blocked: `${missing} of ${total} results are still empty.`,
        lastAt: o.sends.filter((s) => s.kind === "lab-result").at(-1)?.at,
      });
    }
  }

  /* ---- radiology ---- */
  for (const o of getRad().orders) {
    const proc = procByCode(o.procCode)?.short ?? o.procCode;
    const everSent = o.sends.some((s) => s.kind === "rad-order");
    if (!(o.status === "cancelled" && !everSent)) {
      const st = radOrderNphiesState(o);
      add({
        key: `rad-order:${o.id}`, type: "rad-order", ref: o.id, patientId: o.patientId, visit: o.visitNumber, item: `Order: ${proc}`,
        state: fromTone(st.tone), stateDetail: st.label, ready: !!o.study || everSent, blocked: "Waiting for the exam to be done.",
        lastAt: o.sends.filter((s) => s.kind === "rad-order").at(-1)?.at,
      });
    }
    const reportSent = o.sends.some((s) => s.kind === "rad-report");
    if (o.study || reportSent) {
      const st = radReportNphiesState(o);
      const miss = reportMissing(o);
      add({
        key: `rad-report:${o.id}`, type: "rad-report", ref: o.id, patientId: o.patientId, visit: o.visitNumber, item: `Report: ${proc}`,
        state: fromTone(st.tone), stateDetail: st.label, ready: miss.length === 0 && !!o.study, blocked: `The report still needs: ${miss.join(", ")}.`,
        lastAt: o.sends.filter((s) => s.kind === "rad-report").at(-1)?.at,
      });
    }
  }

  /* ---- prescriptions and dispenses ---- */
  const rx = getRx();
  for (const p of rx.prescriptions) {
    const live = p.items.filter((i) => i.status !== "cancelled");
    if (!p.sentAt && live.length === 0) continue;
    const drugs = p.items.map((i) => getDrug(i.drugId).generic).join(", ") || "No items";
    const state: SendState = p.lastSend && !p.lastSend.ok ? "rejected" : !p.sentAt ? "not-sent" : p.dirty ? "changes" : "sent";
    let blocked = "";
    if (state !== "sent") {
      const plan = planPrescription(rx, p);
      const err = plan?.checks.find((c) => c.level === "error");
      blocked = !plan ? "The visit was not found." : err ? err.text : "";
    }
    add({
      key: `rx:${p.id}`, type: "rx", ref: p.id, patientId: p.patientId, visit: p.visitNumber, item: `${p.number}: ${drugs}`,
      state, stateDetail: STATE_LABEL[state], ready: blocked === "", blocked, lastAt: p.lastSend?.at,
    });
  }
  for (const d of rx.dispenses) {
    const send = [...rx.sends].reverse().find((s) => s.kind === "dispense" && s.targetId === d.number);
    const drugs = d.lines.map((l) => getDrug(l.drugId).generic).join(", ");
    add({
      key: `dispense:${d.id}`, type: "dispense", ref: d.id, patientId: d.patientId, visit: d.visitNumber, item: `${d.number}: ${drugs}`,
      state: "sent", stateDetail: "Sent at dispensing", ready: true, lastAt: send?.at ?? d.handedOverAt,
    });
  }

  /* ---- vital signs ---- */
  for (const p of getVitals().panels) {
    const last = p.sends[p.sends.length - 1];
    if (!last && p.status === "X") continue;
    const state: SendState = !last ? "not-sent" : !last.accepted ? "rejected" : needsSend(p) ? "changes" : "sent";
    const when = p.at.slice(0, 16).replace("T", " ");
    add({
      key: `vitals:${p.id}`, type: "vitals", ref: p.id, patientId: p.patientId, visit: p.visit,
      item: `Vital signs taken ${when}${p.status === "X" ? " (cancelled)" : ""}`, state, stateDetail: STATE_LABEL[state], ready: true, lastAt: last?.at,
    });
  }

  /* ---- clinical documents ---- */
  for (const d of getDocsState().docs) {
    if (d.status === "deprecated") continue;
    const state: SendState = d.status === "published" ? "sent" : d.response && !d.response.ok ? "rejected" : d.replaces ? "changes" : "not-sent";
    const errors = d.checks.filter((c) => c.level === "error").length;
    add({
      key: `document:${d.id}`, type: "document", ref: d.id, patientId: d.patientId, visit: d.visit,
      item: `${d.built.title}${d.version > 1 ? ` (Version ${d.version})` : ""}`, state, stateDetail: STATE_LABEL[state],
      ready: errors === 0, blocked: `${errors} problem${errors === 1 ? "" : "s"} found by the checks. Open the document in the chart to fix them.`,
      lastAt: d.publishedAt,
    });
  }

  const order: Record<SendState, number> = { rejected: 0, changes: 1, "not-sent": 2, sent: 3 };
  return rows.sort((a, b) => order[a.state] - order[b.state] || a.patient.localeCompare(b.patient) || a.visit.localeCompare(b.visit) || a.key.localeCompare(b.key));
}

/* ---------- filtering and counting ---------- */

export interface OutboxFilter {
  group?: OutboxGroup | "all";
  state?: SendState | "all" | "needs-action";
  query?: string;
}

export function filterOutbox(rows: OutboxRow[], f: OutboxFilter): OutboxRow[] {
  const q = f.query?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.group && f.group !== "all" && r.group !== f.group) return false;
    if (f.state === "needs-action" ? r.state === "sent" : f.state && f.state !== "all" && r.state !== f.state) return false;
    if (q && !`${r.patient} ${r.mrn} ${r.visit} ${r.item} ${TYPE_LABEL[r.type]}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function countByGroup(rows: OutboxRow[]): Record<OutboxGroup | "all", number> {
  const out = { all: rows.length, visit: 0, lab: 0, radiology: 0, medication: 0, vitals: 0, documents: 0 } as Record<OutboxGroup | "all", number>;
  for (const r of rows) out[r.group] += 1;
  return out;
}

/** Whether this user may press the button on this row. */
export const mayAct = (r: OutboxRow): boolean => r.action !== null && can(r.perm);

/** Rows that "Send all ready" would send for this user. */
export const readyRows = (rows: OutboxRow[]): OutboxRow[] => rows.filter(mayAct);

/* ---------- sending ---------- */

export type SendResult = "accepted" | "rejected" | "skipped";

/** Sends one row through the same function the chart uses. Responses are simulated. */
export function sendRow(r: OutboxRow): SendResult {
  if (!mayAct(r)) return "skipped";
  switch (r.type) {
    case "visit": {
      const out = quickSend("A08", r.ref);
      return out.ok && !(out.entry?.errors) ? "accepted" : out.ok ? "rejected" : "skipped";
    }
    case "lab-order": {
      const rec = sendLabOrder(r.ref);
      return !rec ? "skipped" : rec.response.status === "accepted" ? "accepted" : "rejected";
    }
    case "lab-result": {
      const rec = publishLabResult(r.ref);
      return !rec ? "skipped" : rec.response.status === "accepted" ? "accepted" : "rejected";
    }
    case "rad-order": {
      const rec = sendRadOrder(r.ref);
      return !rec ? "skipped" : rec.response.status === "accepted" ? "accepted" : "rejected";
    }
    case "rad-report": {
      const rec = publishRadReport(r.ref);
      return !rec ? "skipped" : rec.response.status === "accepted" ? "accepted" : "rejected";
    }
    case "rx": {
      const rx = getRx().prescriptions.find((p) => p.id === r.ref);
      if (!rx) return "skipped";
      const out = sendPrescription(rx.id, rx.sentAt ? "update" : "create");
      return !out ? "skipped" : out.ok ? "accepted" : "rejected";
    }
    case "vitals": {
      const rec = sendPanel(r.ref);
      return !rec ? "skipped" : rec.accepted ? "accepted" : "rejected";
    }
    case "document": {
      const res = publishDoc(r.ref);
      return res.ok ? "accepted" : "rejected";
    }
    default:
      return "skipped";
  }
}

/** Sends every ready row in order. Returns the counts. */
export function sendAllReady(rows: OutboxRow[]): { accepted: number; rejected: number; skipped: number } {
  const total = { accepted: 0, rejected: 0, skipped: 0 };
  for (const r of readyRows(rows)) total[sendRow(r)] += 1;
  return total;
}

/* ---------- the message, for Developer View ---------- */

export interface OutboxMessage {
  format: "HL7 v2" | "FHIR JSON" | "CDA XML";
  filename: string;
  text: string;
  at?: string;
}

/** The newest message sent for this row, or null if nothing was sent yet. */
export function lastMessage(r: OutboxRow): OutboxMessage | null {
  switch (r.type) {
    case "visit": {
      const l = [...getState().log].reverse().find((x) => x.visitNumber === r.ref);
      return l ? { format: "HL7 v2", filename: `${l.controlId}.hl7`, text: l.message.replace(/\r/g, "\n"), at: l.sentAt } : null;
    }
    case "lab-order": case "lab-result": {
      const kind = r.type;
      const rec = [...(getLab().orders.find((o) => o.id === r.ref)?.sends ?? [])].reverse().find((s) => s.kind === kind);
      return rec ? { format: "FHIR JSON", filename: `${r.ref}-${kind}-v${rec.version}.json`, text: JSON.stringify(rec.bundle, null, 2), at: rec.at } : null;
    }
    case "rad-order": case "rad-report": {
      const kind = r.type;
      const rec = [...(getRad().orders.find((o) => o.id === r.ref)?.sends ?? [])].reverse().find((s) => s.kind === kind);
      return rec ? { format: "FHIR JSON", filename: `${r.ref}-${kind}-v${rec.version}.json`, text: JSON.stringify(rec.bundle, null, 2), at: rec.at } : null;
    }
    case "rx": {
      const rec = [...getRx().sends].reverse().find((s) => s.kind === "prescription" && s.targetId === r.ref);
      return rec ? { format: "FHIR JSON", filename: `${r.ref}.json`, text: JSON.stringify(rec.bundle, null, 2), at: rec.at } : null;
    }
    case "dispense": {
      const d = getRx().dispenses.find((x) => x.id === r.ref);
      const rec = d && [...getRx().sends].reverse().find((s) => s.kind === "dispense" && s.targetId === d.number);
      return rec ? { format: "FHIR JSON", filename: `${d.number}.json`, text: JSON.stringify(rec.bundle, null, 2), at: rec.at } : null;
    }
    case "vitals": {
      const p = getVitals().panels.find((x) => x.id === r.ref);
      const rec = p?.sends[p.sends.length - 1];
      return rec ? { format: "HL7 v2", filename: `${rec.controlId}.hl7`, text: rec.message.replace(/\r/g, "\n"), at: rec.at } : null;
    }
    case "document": {
      const d = getDocsState().docs.find((x) => x.id === r.ref);
      return d ? { format: "CDA XML", filename: `${d.id}.xml`, text: d.built.xml, at: d.publishedAt } : null;
    }
  }
}
