/**
 * Radiology: own localStorage store, seeds, order and report lifecycle, sending to (simulated) NPHIES, conformance status.
 *
 * Order flow:  chart "Place Order" -> received -> exam performed -> reported -> amended
 * NPHIES:      order bundle (6.1, amendment 6.2) and report bundle (3.1, amendment 3.2). Amendments replace the original:
 *              same set identifier, higher version number, status amended / corrected / cancelled.
 */

import { audit } from "./audit";
import { conformanceStep, type ConfStep } from "./fhir/conformance";
import { simulateNphies, type Json, type Person } from "./fhir/common";
import { newDicomUid, buildRadOrderBundle, buildRadReportBundle } from "./fhir/rad-bundles";
import { procByCode, REPORT_TEMPLATES } from "./fhir/rad-catalog";
import { amendmentChecks, validateRadOrderBundle, validateRadReportBundle } from "./fhir/rad-validate";
import { createStore } from "./fhir/store-util";
import {
  lastAccepted, nextVersion, type DocStatus, type Priority, type RadOrder, type RadReport, type RadStudy, type SendRecord,
} from "./fhir/types";
import type { Encounter, Patient } from "./model";
import { doctorIdForUser, personFromDoctor, personFromUser } from "./fhir/people";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

export * from "./fhir/rad-catalog";
export { buildRadOrderBundle, buildRadReportBundle } from "./fhir/rad-bundles";
export { validateRadOrderBundle, validateRadReportBundle } from "./fhir/rad-validate";
export type { RadOrder, RadReport, RadStatus, RadStudy } from "./fhir/types";

/** The consultant radiologist who signs reports (legal authenticator). Made-up. */
export const RAD_CONSULTANT: Person = { id: "R9001", name: "Dr. Rami Alshehri" };

export interface RadState {
  orders: RadOrder[];
  counter: number;
  rejectNext: boolean;
  viewed: Record<string, boolean>;
}

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

function seedRad(): RadState {
  const encs = getState().encounters;
  const find = (pid: string) => encs.find((e) => e.patientId === pid && e.status !== "cancelled");
  const orders: RadOrder[] = [];
  let n = 200000;
  const add = (pid: string, procCode: string, priority: Priority, minsAgo: number, indication: string, clinicalInfo: string) => {
    const e = find(pid);
    if (!e) return;
    n += 1;
    orders.push({
      id: `RO-${n}`, visitNumber: e.visitNumber, patientId: pid, procCode, priority, indication, clinicalInfo, orderedAt: iso(minsAgo),
      orderedById: e.attending, status: "received", orderDirty: false, reportDirty: false, sends: [],
    });
  };
  add("P001", "XCHES-PA", "urgent", 120, "Fever and productive cough, rule out pneumonia", "Admitted yesterday. Oxygen saturation 94 percent.");
  add("P004", "XCHES-PA", "routine", 50, "Chest X-ray requested by clinic", "");
  add("P007", "UABDO", "routine", 30, "Abdominal pain", "Fever for two days.");
  return { orders, counter: n - 200000, rejectNext: false, viewed: {} };
}

/**
 * v2: the catalogue now holds only codes from the national KSA Imaging Procedure value set, so orders saved under v1
 * (which may name removed codes) are left behind and the store starts from fresh seeds.
 */
const store = createStore<RadState>("onasi-emr-radiology-v2", seedRad);
export const useRad = store.use;
export const getRad = store.get;
export const resetRad = store.reset;

function mutate(id: string, fn: (o: RadOrder) => void) {
  const s = store.get();
  store.set({ ...s, orders: s.orders.map((o) => (o.id === id ? (() => { const c = structuredClone(o); fn(c); return c; })() : o)) });
}
export const getRadOrder = (id: string) => store.get().orders.find((o) => o.id === id);

export const radSendsOf = (o: RadOrder, kind: "rad-order" | "rad-report") => o.sends.filter((s) => s.kind === kind);
export const isRadPublished = (o: RadOrder) => o.status === "resulted" || o.status === "amended";

export function radContext(o: RadOrder): { patient: Patient; enc: Encounter } | null {
  const st = getState();
  const enc = st.encounters.find((e) => e.visitNumber === o.visitNumber);
  const patient = st.patients.find((p) => p.id === o.patientId);
  return enc && patient ? { patient, enc } : null;
}

const nameOf = (o: RadOrder): string | undefined => {
  const p = getState().patients.find((x) => x.id === o.patientId);
  return p ? patientName(p) : undefined;
};

export function radOrderNphiesState(o: RadOrder): { label: string; tone: "neutral" | "ok" | "warn" | "danger" } {
  const sent = radSendsOf(o, "rad-order");
  const last = sent[sent.length - 1];
  const acc = lastAccepted(o.sends, "rad-order");
  if (!last) return { label: "Not Sent", tone: "neutral" };
  if (last.response.status === "rejected") return { label: "Rejected", tone: "danger" };
  if (o.orderDirty) return { label: o.status === "cancelled" ? "Cancellation Not Sent" : "Changes Not Sent", tone: "warn" };
  return { label: acc && acc.version > 1 ? `Sent (Version ${acc.version})` : "Sent", tone: "ok" };
}

export function radReportNphiesState(o: RadOrder): { label: string; tone: "neutral" | "ok" | "warn" | "danger" } {
  const sent = radSendsOf(o, "rad-report");
  const last = sent[sent.length - 1];
  const acc = lastAccepted(o.sends, "rad-report");
  if (!last) return { label: "Not Published", tone: "neutral" };
  if (last.response.status === "rejected") return { label: "Rejected", tone: "danger" };
  if (o.reportDirty) return { label: "Changes Not Published", tone: "warn" };
  return { label: acc && acc.version > 1 ? `Published (Version ${acc.version})` : "Published", tone: "ok" };
}

/** NPHIES rejects a radiology order without the Procedure Indications sub-section (Error Handling Guide 1.1.7). */
export const RAD_INDICATION_REQUIRED = "Enter the reason for the exam. NPHIES rejects a radiology order without it.";

/** Encounter.class in a radiology document must be E, I, O or D (page id 414875649). A pre-admission visit (P) cannot be sent. */
const SENDABLE_CLASSES = ["E", "I", "O", "D"];
function classBlocksSend(enc: Encounter, what: string): boolean {
  if (SENDABLE_CLASSES.includes(enc.cls)) return false;
  pushToast({ tone: "warn", text: `${what} cannot be sent for this visit yet.`, detail: "NPHIES accepts emergency, inpatient, outpatient and day case visits only. Admit or register the patient first." });
  return true;
}

function allowed(perm: "order.rad" | "rad.report", target: string, patient?: string): boolean {
  if (can(perm)) return true;
  audit("denied", target, { patient, detail: `Needs ${perm}` });
  pushToast({ tone: "warn", text: "Your role cannot do this.", detail: `This needs the ${perm} permission.` });
  return false;
}

/* ---------- order lifecycle (chart side) ---------- */

export function placeRadOrder(enc: Encounter, input: { procCode: string; priority: Priority; indication: string; clinicalInfo: string }): RadOrder | null {
  const patient = getState().patients.find((p) => p.id === enc.patientId);
  if (!allowed("order.rad", "Radiology order", patient && patientName(patient))) return null;
  if (!procByCode(input.procCode)) return null;
  if (!input.indication.trim()) {
    pushToast({ tone: "warn", text: "The order was not placed.", detail: RAD_INDICATION_REQUIRED });
    return null;
  }
  const s = store.get();
  const counter = s.counter + 1;
  const order: RadOrder = {
    id: `RO-${200000 + counter}`,
    visitNumber: enc.visitNumber, // one visit number everywhere
    patientId: enc.patientId,
    procCode: input.procCode,
    priority: input.priority,
    indication: input.indication.trim(),
    clinicalInfo: input.clinicalInfo.trim(),
    orderedAt: new Date().toISOString(),
    orderedById: doctorIdForUser(currentUser()) ?? enc.attending,
    status: "received",
    orderDirty: false,
    reportDirty: false,
    sends: [],
  };
  store.set({ ...s, counter, orders: [order, ...s.orders] });
  audit("create", `Radiology order ${order.id}`, { patient: patientName(patient), detail: `Visit ${order.visitNumber}: ${procByCode(order.procCode)?.short}` });
  return order;
}

export function amendRadOrder(id: string, input: { procCode: string; priority: Priority; indication: string; clinicalInfo: string }): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("order.rad", `Radiology order ${id}`)) return false;
  if (o.status === "cancelled" || o.status === "resulted" || o.status === "amended") return false;
  if (!input.indication.trim()) {
    pushToast({ tone: "warn", text: "The order was not changed.", detail: RAD_INDICATION_REQUIRED });
    return false;
  }
  const wasSent = !!lastAccepted(o.sends, "rad-order");
  mutate(id, (x) => {
    if (x.status === "received" && procByCode(input.procCode)) x.procCode = input.procCode;
    x.priority = input.priority;
    x.indication = input.indication.trim();
    x.clinicalInfo = input.clinicalInfo.trim();
    if (wasSent) x.orderDirty = true;
  });
  audit("update", `Radiology order ${id}`, { patient: nameOf(o), detail: "Order changed" });
  return true;
}

export function cancelRadOrder(id: string): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("order.rad", `Radiology order ${id}`)) return false;
  if (o.status === "cancelled" || o.status === "resulted" || o.status === "amended") return false;
  const wasSent = !!lastAccepted(o.sends, "rad-order");
  mutate(id, (x) => {
    x.status = "cancelled";
    if (wasSent) x.orderDirty = true;
  });
  audit("update", `Radiology order ${id}`, { patient: nameOf(o), detail: "Order cancelled" });
  return true;
}

/* ---------- radiology side ---------- */

/** The exam is done. Creates the study record (UID, accession). Images are in PACS unless told otherwise. */
export function markPerformed(id: string, opts: { images?: boolean } = {}): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (o.status !== "received") return false;
  const end = new Date();
  const study: RadStudy = {
    studyUid: newDicomUid(),
    accession: `ACC${o.id.slice(3)}`,
    performedStart: new Date(end.getTime() - 15 * 60_000).toISOString(),
    performedEnd: end.toISOString(),
    performedBy: currentUser().name,
    images: opts.images ?? true,
    series: 1,
    instances: 2,
  };
  mutate(id, (x) => {
    x.study = study;
    x.status = "performed";
    x.report = x.report ?? { technique: procByCode(x.procCode)?.technique ?? "", comparison: "", findings: "", impression: "", addendum: "", critical: false, communicated: "", reportedAt: "", reportedById: "" };
  });
  audit("update", `Radiology order ${id}`, { patient: nameOf(o), detail: `Exam performed, accession ${study.accession}` });
  return true;
}

export function setStudyImages(id: string, images: boolean): boolean {
  const o = getRadOrder(id);
  if (!o?.study || !allowed("rad.report", `Radiology order ${id}`)) return false;
  mutate(id, (x) => {
    if (x.study) x.study.images = images;
    if (isRadPublished(x)) x.reportDirty = true;
  });
  return true;
}

/** Save the report text. After publishing, any change marks the report as changed (needs an amendment). */
export function saveRadReport(id: string, patch: Partial<RadReport>): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  mutate(id, (x) => {
    const base: RadReport = x.report ?? { technique: "", comparison: "", findings: "", impression: "", addendum: "", critical: false, communicated: "", reportedAt: "", reportedById: "" };
    const next = { ...base, ...patch };
    if (isRadPublished(x) && JSON.stringify(base) !== JSON.stringify(next)) x.reportDirty = true;
    x.report = next;
  });
  return true;
}

export function applyReportTemplate(id: string, key: keyof typeof REPORT_TEMPLATES): boolean {
  const t = REPORT_TEMPLATES[key];
  return saveRadReport(id, { findings: t.findings, impression: t.impression, comparison: t.comparison, critical: key === "critical" });
}

export const reportMissing = (o: RadOrder): string[] => {
  const miss: string[] = [];
  if (!o.report?.findings.trim()) miss.push("Findings");
  if (!o.report?.impression.trim()) miss.push("Impression");
  return miss;
};

/* ---------- sending ---------- */

function record(o: RadOrder, kind: "rad-order" | "rad-report", version: number, docStatus: DocStatus, bundle: Json, checks: SendRecord["checks"]): SendRecord {
  const s = store.get();
  const dupe = o.sends.some((x) => x.kind === kind && x.response.status === "accepted" && x.bundle?.identifier?.value === bundle.identifier?.value);
  const response = simulateNphies({
    label: kind === "rad-order" ? "Radiology order" : "Radiology report",
    checks,
    version,
    hasAcceptedOriginal: !!lastAccepted(o.sends, kind),
    duplicate: dupe,
    forceReject: s.rejectNext,
  });
  const rec: SendRecord = { seq: o.sends.length + 1, kind, version, docStatus, at: new Date().toISOString(), bundle, checks, response };
  store.set({ ...s, rejectNext: false, orders: s.orders.map((x) => (x.id === o.id ? { ...x, sends: [...x.sends, rec] } : x)) });
  return rec;
}

function toastFor(label: string, rec: SendRecord) {
  const ok = rec.response.status === "accepted";
  pushToast({
    tone: ok ? "ok" : "danger",
    text: ok ? `${label} accepted by NPHIES.` : `${label} rejected by NPHIES.`,
    detail: ok ? `Transaction ${rec.response.transactionId}, version ${rec.version}.` : rec.response.outcome.issue[0]?.details.text,
  });
}

export function sendRadOrder(id: string): SendRecord | null {
  const o = getRadOrder(id);
  if (!o || !allowed("order.rad", `Radiology order ${id}`)) return null;
  const ctx = radContext(o);
  if (!ctx || classBlocksSend(ctx.enc, "The radiology order")) return null;
  const version = nextVersion(radSendsOf(o, "rad-order"), "rad-order");
  const docStatus: DocStatus = o.status === "cancelled" ? "cancelled" : version > 1 ? "amended" : "final";
  const bundle = buildRadOrderBundle({ ...ctx, order: o, orderer: personFromDoctor(o.orderedById), version, docStatus });
  const checks = validateRadOrderBundle(bundle, { visitNumber: o.visitNumber, healthId: ctx.patient.healthId });
  const rec = record(o, "rad-order", version, docStatus, bundle, checks);
  if (rec.response.status === "accepted") mutate(id, (x) => { x.orderDirty = false; });
  audit("send-fhir", `Radiology order ${id}`, { patient: patientName(ctx.patient), detail: `Version ${version} ${docStatus}: ${rec.response.status}. Visit ${o.visitNumber}` });
  toastFor("Radiology order", rec);
  return rec;
}

export function publishRadReport(id: string, amendStatus: "amended" | "corrected" = "amended"): SendRecord | null {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return null;
  const ctx = radContext(o);
  if (!ctx || classBlocksSend(ctx.enc, "The radiology report")) return null;
  if (!o.study || reportMissing(o).length) {
    pushToast({ tone: "warn", text: "The report is not complete.", detail: `Missing: ${o.study ? reportMissing(o).join(", ") : "exam not performed"}.` });
    return null;
  }
  const version = nextVersion(radSendsOf(o, "rad-report"), "rad-report");
  const docStatus: DocStatus = version === 1 ? "final" : amendStatus;
  const user = currentUser();
  const radiologist = doctorIdForUser(user) && user.role !== "radiologist" ? personFromDoctor(doctorIdForUser(user)!) : personFromUser(user);
  mutate(id, (x) => {
    if (x.report) {
      x.report.reportedAt = new Date().toISOString();
      x.report.reportedById = radiologist.id;
    }
  });
  const fresh = getRadOrder(id)!;
  const bundle = buildRadReportBundle({ ...ctx, order: fresh, orderer: personFromDoctor(o.orderedById), radiologist, authenticator: RAD_CONSULTANT, version, docStatus });
  const checks = validateRadReportBundle(bundle, { visitNumber: o.visitNumber, healthId: ctx.patient.healthId });
  const rec = record(fresh, "rad-report", version, docStatus, bundle, checks);
  if (rec.response.status === "accepted") {
    mutate(id, (x) => {
      x.status = version > 1 ? "amended" : "resulted";
      x.reportDirty = false;
    });
  }
  audit("send-fhir", `Radiology report ${id}`, { patient: patientName(ctx.patient), detail: `Version ${version} ${docStatus}: ${rec.response.status}. Visit ${o.visitNumber}` });
  toastFor("Radiology report", rec);
  return rec;
}

/**
 * Release the report to the chart. This does not send anything to NPHIES: the report then waits on the
 * NPHIES Clinical page, where publishRadReport sends it.
 */
export function releaseRadReport(id: string): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (isRadPublished(o)) return true;
  if (!o.study || reportMissing(o).length) {
    pushToast({ tone: "warn", text: "The report is not complete.", detail: `Missing: ${o.study ? reportMissing(o).join(", ") : "exam not performed"}.` });
    return false;
  }
  const ctx = radContext(o);
  mutate(id, (x) => {
    x.status = "resulted";
    x.reportDirty = true;
    if (x.report) x.report.reportedAt = new Date().toISOString();
  });
  audit("update", `Radiology report ${id} released`, { patient: ctx ? patientName(ctx.patient) : undefined, detail: `Visit ${o.visitNumber}. Waiting to be sent from NPHIES Clinical.` });
  pushToast({ tone: "ok", text: "Report released to the chart.", detail: "Send it to NPHIES from the NPHIES Clinical page." });
  return true;
}

/** One click for testers: a chest X-ray order, exam done and a normal report typed, ready to publish. */
export function createRadConformanceSample(enc: Encounter): RadOrder | null {
  const o = placeRadOrder(enc, { procCode: "XCHES-PA", priority: "routine", indication: "Conformance sample", clinicalInfo: "Made-up test case." });
  if (!o) return null;
  markPerformed(o.id);
  applyReportTemplate(o.id, "normal");
  return getRadOrder(o.id) ?? null;
}

export const setRadRejectNext = (on: boolean) => store.set({ ...store.get(), rejectNext: on });
export const toggleRadViewed = (key: string) => store.set({ ...store.get(), viewed: { ...store.get().viewed, [key]: !store.get().viewed[key] } });

export function radConformance(s: RadState): ConfStep[] {
  const all = s.orders.flatMap((o) => o.sends);
  const orders = all.filter((x) => x.kind === "rad-order");
  const reports = all.filter((x) => x.kind === "rad-report");
  const base = { viewed: s.viewed };
  return [
    conformanceStep({ ...base, id: "6.1", title: "Radiology Order: Publish", what: "a radiology order bundle", sends: orders, amendment: false, hint: "Place an order in the chart and press Send Order To NPHIES." }),
    conformanceStep({ ...base, id: "6.2", title: "Radiology Order: Amended Order", what: "an amendment that replaces the order", sends: orders, amendment: true, minimums: amendmentChecks, hint: "Change a sent order in the chart, then send it again." }),
    conformanceStep({ ...base, id: "3.1", title: "Radiology Report: Publish", what: "a radiology report bundle", sends: reports, amendment: false, hint: "Use Create Conformance Sample, then Publish Report." }),
    conformanceStep({ ...base, id: "3.2", title: "Radiology Report: Amended Report", what: "an amendment that replaces the report", sends: reports, amendment: true, minimums: amendmentChecks, hint: "Edit the report text, then Publish Amendment." }),
  ];
}
