/**
 * Radiology: own localStorage store, seeds, order and report lifecycle, sending to (simulated) NPHIES, conformance status.
 *
 * Order flow:  chart "Place Order" -> received -> exam performed -> reported -> amended
 * Exam:        the technologist records the machine, the times, contrast and the pregnancy check, then marks it done.
 * Report:      draft -> signed by a radiologist -> released to the chart. After signing the text is fixed; later notes
 *              are addenda that keep the original.
 * NPHIES:      order bundle (6.1, amendment 6.2) and report bundle (3.1, amendment 3.2). Amendments replace the original:
 *              same set identifier, higher version number, status amended / corrected / cancelled.
 */

import { audit } from "./audit";
import { conformanceStep, type ConfStep } from "./fhir/conformance";
import { simulateNphies, type Json, type Person } from "./fhir/common";
import { newDicomUid, buildRadOrderBundle, buildRadReportBundle } from "./fhir/rad-bundles";
import { machinesFor, procByCode, reportTemplatesFor } from "./fhir/rad-catalog";
import { amendmentChecks, validateRadOrderBundle, validateRadReportBundle } from "./fhir/rad-validate";
import { createStore } from "./fhir/store-util";
import {
  lastAccepted, nextVersion, type DocStatus, type PregnancyCheck, type Priority, type RadOrder, type RadReport, type RadStudy, type SendRecord,
} from "./fhir/types";
import type { Encounter, Patient } from "./model";
import { doctorIdForUser, personFromDoctor, personFromUser } from "./fhir/people";
import { can, currentUser, type DemoUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

export * from "./fhir/rad-catalog";
export { buildRadOrderBundle, buildRadReportBundle } from "./fhir/rad-bundles";
export { validateRadOrderBundle, validateRadReportBundle } from "./fhir/rad-validate";
export type { PregnancyCheck, RadOrder, RadReport, RadStatus, RadStudy } from "./fhir/types";

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

/**
 * Exams in `procCodes` that are already open (not yet reported, not cancelled) for the same visit.
 * Returns the catalogue codes, so the caller can name them.
 */
export function openRadDuplicates(orders: RadOrder[], visitNumber: string, procCodes: string[], excludeOrderId?: string): string[] {
  const open = new Set(
    orders.filter((o) => o.visitNumber === visitNumber && o.id !== excludeOrderId && (o.status === "received" || o.status === "performed")).map((o) => o.procCode),
  );
  return [...new Set(procCodes.filter((c) => open.has(c)))];
}

/* ---------- radiology side ---------- */

/** What the technologist records when the exam is done. Times are ISO or datetime-local strings. */
export interface ExamDetails {
  machine: string;
  start: string;
  end: string;
  /** null = not answered yet. */
  contrastGiven: boolean | null;
  contrastAmount: string;
  /** Empty = not answered yet. */
  pregnancy: PregnancyCheck | "";
  pregnancyNote: string;
  images?: boolean;
}

/** The pregnancy question is asked of women aged 12 to 55. */
export function needsPregnancyCheck(p: Pick<Patient, "sex" | "dob">, now: number = Date.now()): boolean {
  if (p.sex !== "F") return false;
  const age = Math.floor((now - new Date(p.dob).getTime()) / (365.25 * 86_400_000));
  return age >= 12 && age <= 55;
}

/** What is still wrong or missing in the technologist record, in plain words. Empty means the exam can be marked done. */
export function examProblems(d: ExamDetails, patient: Pick<Patient, "sex" | "dob">, now: number = Date.now()): string[] {
  const out: string[] = [];
  if (!d.machine.trim()) out.push("Choose the machine.");
  const start = new Date(d.start).getTime();
  const end = new Date(d.end).getTime();
  if (!d.start || Number.isNaN(start)) out.push("Enter the start time.");
  if (!d.end || Number.isNaN(end)) out.push("Enter the end time.");
  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    if (end < start) out.push("The end time is before the start time.");
    if (end > now + 60_000) out.push("The end time is in the future.");
  }
  if (d.contrastGiven === null) out.push("Say if contrast was given.");
  if (d.contrastGiven && !d.contrastAmount.trim()) out.push("Enter the amount of contrast given.");
  if (needsPregnancyCheck(patient, now)) {
    if (!d.pregnancy) out.push("Record the pregnancy check.");
    else if (d.pregnancy !== "not-pregnant" && !d.pregnancyNote.trim()) out.push("Note what was done about the possible pregnancy.");
  }
  return out;
}

/**
 * The technologist step: checks the record, then marks the exam done. This is what the worklist uses.
 * The study cannot be reported before this.
 */
export function completeExam(id: string, details: ExamDetails): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (o.status !== "received") return false;
  const patient = getState().patients.find((p) => p.id === o.patientId);
  if (!patient) return false;
  const problems = examProblems(details, patient);
  if (problems.length) {
    pushToast({ tone: "warn", text: "The exam record is not complete.", detail: problems.join(" ") });
    return false;
  }
  return markPerformed(id, { images: details.images, details });
}

/** The exam is done. Creates the study record (UID, accession). Images are in PACS unless told otherwise. */
export function markPerformed(id: string, opts: { images?: boolean; details?: ExamDetails } = {}): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (o.status !== "received") return false;
  const d = opts.details;
  const end = d ? new Date(d.end) : new Date();
  const study: RadStudy = {
    studyUid: newDicomUid(),
    accession: `ACC${o.id.slice(3)}`,
    performedStart: d ? new Date(d.start).toISOString() : new Date(end.getTime() - 15 * 60_000).toISOString(),
    performedEnd: end.toISOString(),
    performedBy: currentUser().name,
    images: opts.images ?? true,
    series: 1,
    instances: 2,
    machine: d?.machine.trim() || machinesFor(o.procCode)[0],
  };
  if (d) {
    study.contrastGiven = !!d.contrastGiven;
    if (d.contrastGiven) study.contrastAmount = d.contrastAmount.trim();
    if (d.pregnancy) {
      study.pregnancy = d.pregnancy;
      if (d.pregnancyNote.trim()) study.pregnancyNote = d.pregnancyNote.trim();
    }
  }
  mutate(id, (x) => {
    x.study = study;
    x.status = "performed";
    x.report = x.report ?? { technique: procByCode(x.procCode)?.technique ?? "", comparison: "", findings: "", impression: "", addendum: "", critical: false, communicated: "", reportedAt: "", reportedById: "" };
  });
  const extra = d ? `, ${study.machine}, contrast ${study.contrastGiven ? study.contrastAmount : "not given"}${study.pregnancy ? `, pregnancy check: ${PREGNANCY_TEXT[study.pregnancy]}` : ""}` : "";
  audit("update", `Radiology order ${id}`, { patient: nameOf(o), detail: `Exam performed, accession ${study.accession}${extra}` });
  return true;
}

export const PREGNANCY_TEXT: Record<PregnancyCheck, string> = {
  "not-pregnant": "Not pregnant",
  pregnant: "Pregnant",
  unsure: "Not sure",
};

export function setStudyImages(id: string, images: boolean): boolean {
  const o = getRadOrder(id);
  if (!o?.study || !allowed("rad.report", `Radiology order ${id}`)) return false;
  mutate(id, (x) => {
    if (x.study) x.study.images = images;
    if (isRadPublished(x)) x.reportDirty = true;
  });
  return true;
}

/** The parts of a report that are fixed once the radiologist has signed. */
const SIGNED_TEXT: (keyof RadReport)[] = ["technique", "comparison", "findings", "impression", "critical", "communicated"];

/**
 * Save the report text. After publishing, any change marks the report as changed (needs an amendment).
 * The exam must be marked done first, and a signed report only takes addenda.
 */
export function saveRadReport(id: string, patch: Partial<RadReport>): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (!o.study) {
    pushToast({ tone: "warn", text: "The exam is not marked done.", detail: "Mark the exam as done before you write the report." });
    return false;
  }
  if (o.report?.signedAt && SIGNED_TEXT.some((k) => k in patch && patch[k] !== o.report![k])) {
    pushToast({ tone: "warn", text: "This report is signed.", detail: "The signed text cannot change. Add an addendum instead." });
    return false;
  }
  mutate(id, (x) => {
    const base: RadReport = x.report ?? { technique: "", comparison: "", findings: "", impression: "", addendum: "", critical: false, communicated: "", reportedAt: "", reportedById: "" };
    const next = { ...base, ...patch };
    if (isRadPublished(x) && JSON.stringify(base) !== JSON.stringify(next)) x.reportDirty = true;
    x.report = next;
  });
  return true;
}

/** Fill the report from a template of the study type: "normal" gives the normal wording for that exact exam. */
export function applyReportTemplate(id: string, key: string): boolean {
  const o = getRadOrder(id);
  const t = o && reportTemplatesFor(o.procCode).find((x) => x.key === key);
  if (!t) return false;
  return saveRadReport(id, { technique: t.technique ?? o.report?.technique ?? "", findings: t.findings, impression: t.impression, comparison: t.comparison, critical: t.critical });
}

export const reportMissing = (o: RadOrder): string[] => {
  const miss: string[] = [];
  if (!o.report?.findings.trim()) miss.push("Findings");
  if (!o.report?.impression.trim()) miss.push("Impression");
  return miss;
};

/* ---------- sign-off ---------- */

/** Only a radiologist signs a report. */
export const canSignRadReport = (u: DemoUser): boolean => u.role === "radiologist";

export const isRadSigned = (o: RadOrder): boolean => !!o.report?.signedAt;

function mustBeRadiologist(o: RadOrder, what: string): boolean {
  if (canSignRadReport(currentUser())) return true;
  audit("denied", `Radiology report ${o.id}`, { patient: nameOf(o), detail: `Only a radiologist can ${what}` });
  pushToast({ tone: "warn", text: `Only a radiologist can ${what}.` });
  return false;
}

/** Sign the draft. The signer becomes the reporting radiologist and the text is fixed from here on. */
export function signRadReport(id: string): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (!mustBeRadiologist(o, "sign a report")) return false;
  if (!o.study || o.status !== "performed") {
    pushToast({ tone: "warn", text: "This report cannot be signed now.", detail: o.study ? "It is already released." : "Mark the exam as done first." });
    return false;
  }
  if (o.report?.signedAt) return true;
  const miss = reportMissing(o);
  if (miss.length) {
    pushToast({ tone: "warn", text: "The report is not complete.", detail: `Missing: ${miss.join(", ")}.` });
    return false;
  }
  if (o.report?.critical && !o.report.communicated.trim()) {
    pushToast({ tone: "warn", text: "Record who was told about the critical finding." });
    return false;
  }
  const who = personFromUser(currentUser());
  const at = new Date().toISOString();
  mutate(id, (x) => {
    if (!x.report) return;
    x.report.signedAt = at;
    x.report.signedBy = { id: who.id, name: who.name };
    x.report.reportedAt = at;
    x.report.reportedById = who.id;
  });
  audit("update", `Radiology report ${id} signed`, { patient: nameOf(o), detail: `Visit ${o.visitNumber}. Signed by ${who.name}.` });
  pushToast({ tone: "ok", text: "Report signed.", detail: "Release it to make it show in the chart." });
  return true;
}

/** Take a signed report back to draft. Only before it is released. */
export function reopenRadDraft(id: string): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (!mustBeRadiologist(o, "reopen a signed report")) return false;
  if (o.status !== "performed" || !o.report?.signedAt) return false;
  mutate(id, (x) => {
    if (!x.report) return;
    x.report.signedAt = undefined;
    x.report.signedBy = undefined;
  });
  audit("update", `Radiology report ${id} reopened`, { patient: nameOf(o), detail: `Visit ${o.visitNumber}. Signature removed before release.` });
  return true;
}

/** Add a note to a signed report. The signed text stays as it was. */
export function addRadAddendum(id: string, text: string): boolean {
  const o = getRadOrder(id);
  if (!o || !allowed("rad.report", `Radiology order ${id}`)) return false;
  if (!mustBeRadiologist(o, "add an addendum")) return false;
  if (!o.report?.signedAt) {
    pushToast({ tone: "warn", text: "Sign the report before you add an addendum." });
    return false;
  }
  if (!text.trim()) return false;
  const by = currentUser().name;
  const at = new Date().toISOString();
  mutate(id, (x) => {
    if (!x.report) return;
    x.report.addenda = [...(x.report.addenda ?? []), { text: text.trim(), at, by }];
    x.report.addendum = x.report.addenda.map((a) => `${a.text} (Added by ${a.by}, ${a.at.slice(0, 16).replace("T", " ")} UTC)`).join(" ");
    if (isRadPublished(x)) x.reportDirty = true;
  });
  audit("update", `Radiology report ${id} addendum`, { patient: nameOf(o), detail: `Visit ${o.visitNumber}. The signed text was kept.` });
  pushToast({ tone: "ok", text: "Addendum added.", detail: isRadPublished(o) ? "Publish the amendment to send it to NPHIES." : undefined });
  return true;
}

/** Why a report cannot be sent to NPHIES yet, or null when it can. Used by the NPHIES Clinical page. */
export function radReportSendBlock(o: RadOrder): string | null {
  if (!o.study) return "Waiting for the exam to be done.";
  const miss = reportMissing(o);
  if (miss.length) return `The report still needs: ${miss.join(", ")}.`;
  if (!isRadPublished(o)) return isRadSigned(o) ? "Waiting for the signed report to be released." : "Waiting for the radiologist to sign the report.";
  return null;
}

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
  // The author is the radiologist who signed. Without a signature (older data) it is the user who publishes.
  const radiologist = o.report?.signedBy ?? (doctorIdForUser(user) && user.role !== "radiologist" ? personFromDoctor(doctorIdForUser(user)!) : personFromUser(user));
  mutate(id, (x) => {
    if (x.report && !x.report.signedAt) {
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
 * Release the signed report to the chart. This does not send anything to NPHIES: the report then waits on the
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
  if (!isRadSigned(o)) {
    pushToast({ tone: "warn", text: "The report is not signed.", detail: "A radiologist must sign the report before it is released." });
    return false;
  }
  const ctx = radContext(o);
  mutate(id, (x) => {
    x.status = "resulted";
    x.reportDirty = true;
  });
  audit("update", `Radiology report ${id} released`, { patient: ctx ? patientName(ctx.patient) : undefined, detail: `Visit ${o.visitNumber}. Waiting to be sent from NPHIES Clinical.` });
  pushToast({ tone: "ok", text: "Report released to the chart.", detail: "Send it to NPHIES from the NPHIES Clinical page." });
  return true;
}

/** One click for testers: a chest X-ray order, exam done and a normal report typed, ready to publish. */
export function createRadConformanceSample(enc: Encounter): RadOrder | null {
  const o = placeRadOrder(enc, { procCode: "XCHES-PA", priority: "routine", indication: "Sample exam", clinicalInfo: "Made-up test case." });
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
    conformanceStep({ ...base, id: "3.1", title: "Radiology Report: Publish", what: "a radiology report bundle", sends: reports, amendment: false, hint: "Use Create Sample Exam, sign and release the report as a radiologist, then send it from NPHIES Clinical." }),
    conformanceStep({ ...base, id: "3.2", title: "Radiology Report: Amended Report", what: "an amendment that replaces the report", sends: reports, amendment: true, minimums: amendmentChecks, hint: "Edit the report text, then Publish Amendment." }),
  ];
}
