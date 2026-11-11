/**
 * Laboratory: own localStorage store, seeds, order and result lifecycle, sending to (simulated) NPHIES, conformance status.
 *
 * Order flow:   chart "Place Order" -> received -> specimen collected -> in progress -> resulted -> amended
 * NPHIES:       order bundle (5.1, amendment 5.2) and result bundle (2.1, amendment 2.2). Amendments replace the original:
 *               same set identifier, higher version number, status amended / corrected / cancelled.
 * Everything is stored in the browser. No network calls.
 */

import { audit } from "./audit";
import { conformanceStep, type ConfStep } from "./fhir/conformance";
import { simulateNphies, type Json } from "./fhir/common";
import { buildLabOrderBundle, buildLabReportBundle } from "./fhir/lab-bundles";
import {
  CONFORMANCE_SAMPLE_CODES, ORGANISMS, expand, interpretValue, normalizeCodes, sampleValue, testByCode, type LabTest,
} from "./fhir/lab-catalog";
import { labAmendmentMinimums, labResultMinimums, validateLabOrderBundle, validateLabReportBundle } from "./fhir/lab-validate";
import { LAB_DIRECTOR, doctorIdForUser, personFromDoctor, personFromUser, providerIdForUser } from "./fhir/people";
import { createStore } from "./fhir/store-util";
import {
  lastAccepted, nextVersion, type DocStatus, type LabOrder, type LabResult, type LabSpecimen, type Priority, type SendRecord,
} from "./fhir/types";
import type { Encounter, Patient } from "./model";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

export * from "./fhir/lab-catalog";
export { buildLabOrderBundle, buildLabReportBundle, formatResult, placerNumber } from "./fhir/lab-bundles";
export { labAmendmentMinimums, labResultMinimums, validateLabOrderBundle, validateLabReportBundle } from "./fhir/lab-validate";
export type { LabOrder, LabResult, LabSpecimen, LabStatus, Priority } from "./fhir/types";

export { LAB_DIRECTOR, doctorIdForUser, personFromDoctor, personFromUser, providerIdForUser };

/* ---------- store ---------- */

export interface LabState {
  orders: LabOrder[];
  counter: number;
  /** Developer switch: the next send gets a simulated rejection. */
  rejectNext: boolean;
  /** Manual conformance ticks, for example "5.1.3". */
  viewed: Record<string, boolean>;
}

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

function seedLab(): LabState {
  const encs = getState().encounters;
  const find = (pid: string) => encs.find((e) => e.patientId === pid && e.status !== "cancelled");
  const orders: LabOrder[] = [];
  let n = 100000;
  const add = (pid: string, codes: string[], priority: Priority, status: LabOrder["status"], minsAgo: number, note: string) => {
    const e = find(pid);
    if (!e) return;
    n += 1;
    const order: LabOrder = {
      id: `LO-${n}`, visitNumber: e.visitNumber, patientId: pid, codes, placers: withPlacers(`LO-${n}`, codes), priority, fasting: null, note, orderedAt: iso(minsAgo),
      orderedById: e.attending, status, specimens: [], results: {}, orderDirty: false, resultDirty: false, sends: [],
    };
    if (status === "collected") order.specimens = specimensFor(order, iso(minsAgo - 20), "Faisal Alqahtani, MLT");
    orders.push(order);
  };
  add("P001", ["58410-2", "1988-5"], "urgent", "collected", 90, "Fever and cough");
  add("P002", ["4548-4", "2345-7"], "routine", "received", 40, "Diabetes review");
  add("P003", ["10839-9", "58410-2"], "stat", "received", 15, "Chest pain");
  add("P007", ["24357-6", "630-4"], "routine", "received", 25, "Fever, check for urine infection");
  return { orders, counter: n - 100000, rejectNext: false, viewed: {} };
}

/**
 * Give every ordered test a placer order number that it keeps for life. Numbers already given are never reused,
 * also not for a test that was removed, so an amendment cannot move a number onto another test.
 */
function withPlacers(orderId: string, codes: string[], existing: Record<string, string> = {}): Record<string, string> {
  const out = { ...existing };
  let n = Object.keys(out).length;
  for (const c of codes) if (!out[c]) out[c] = `${orderId}-${++n}`;
  return out;
}

/** The signed-in user as the performer of a result, when the account has a provider-directory id. */
function resultPerformer(): { id: string; name: string } | undefined {
  const u = currentUser();
  const id = providerIdForUser(u);
  return id ? { id, name: u.name } : undefined;
}

// v2: section codes, placer numbers per test and the performer per result changed. Saved v1 data is not read.
const store = createStore<LabState>("onasi-emr-lab-v2", seedLab);
export const useLab = store.use;
export const getLab = store.get;
export const resetLab = store.reset;

function mutate(id: string, fn: (o: LabOrder) => void) {
  const s = store.get();
  store.set({ ...s, orders: s.orders.map((o) => (o.id === id ? (() => { const c = structuredClone(o); fn(c); return c; })() : o)) });
}

export const getOrder = (id: string) => store.get().orders.find((o) => o.id === id);

function specimensFor(order: LabOrder, collectedAt: string, by: string): LabSpecimen[] {
  const keys = [...new Set(expand(order.codes).map((t) => t.specimen))];
  return keys.map((key) => ({ id: `SP-${order.id.slice(3)}-${key}`, key, collectedAt, collectedBy: by }));
}

/* ---------- selectors ---------- */

export const leafTests = (order: Pick<LabOrder, "codes">): LabTest[] => expand(order.codes);
export const isPublished = (o: LabOrder) => o.status === "resulted" || o.status === "amended";
export const labSendsOf = (o: LabOrder, kind: "lab-order" | "lab-result") => o.sends.filter((s) => s.kind === kind);

/** Leaf tests that still have no result typed in. */
export function missingResults(o: LabOrder): LabTest[] {
  return leafTests(o).filter((t) => {
    const r = o.results[t.code];
    return !r || (t.kind === "organism" ? !r.organism && !r.value.trim() : !r.value.trim());
  });
}

export const hasCritical = (o: LabOrder) => Object.values(o.results).some((r) => (r.interp === "HH" || r.interp === "LL") && r.status !== "cancelled");

export function orderContext(o: LabOrder): { patient: Patient; enc: Encounter } | null {
  const st = getState();
  const enc = st.encounters.find((e) => e.visitNumber === o.visitNumber);
  const patient = st.patients.find((p) => p.id === o.patientId);
  return enc && patient ? { patient, enc } : null;
}

/** Where the order stands with NPHIES, in plain words. */
export function orderNphiesState(o: LabOrder): { label: string; tone: "neutral" | "ok" | "warn" | "danger" } {
  const sent = labSendsOf(o, "lab-order");
  const last = sent[sent.length - 1];
  const acc = lastAccepted(o.sends, "lab-order");
  if (!last) return { label: "Not Sent", tone: "neutral" };
  if (last.response.status === "rejected") return { label: "Rejected", tone: "danger" };
  if (o.orderDirty) return { label: o.status === "cancelled" ? "Cancellation Not Sent" : "Changes Not Sent", tone: "warn" };
  return { label: acc && acc.version > 1 ? `Sent (Version ${acc.version})` : "Sent", tone: "ok" };
}

export function resultNphiesState(o: LabOrder): { label: string; tone: "neutral" | "ok" | "warn" | "danger" } {
  const sent = labSendsOf(o, "lab-result");
  const last = sent[sent.length - 1];
  const acc = lastAccepted(o.sends, "lab-result");
  if (!last) return { label: "Not Published", tone: "neutral" };
  if (last.response.status === "rejected") return { label: "Rejected", tone: "danger" };
  if (o.resultDirty) return { label: "Changes Not Published", tone: "warn" };
  return { label: acc && acc.version > 1 ? `Published (Version ${acc.version})` : "Published", tone: "ok" };
}

/* ---------- permissions ---------- */

function allowed(perm: "order.lab" | "lab.result", target: string, patient?: string): boolean {
  if (can(perm)) return true;
  audit("denied", target, { patient, detail: `Needs ${perm}` });
  pushToast({ tone: "warn", text: "Your role cannot do this.", detail: `This needs the ${perm} permission.` });
  return false;
}

/* ---------- order lifecycle (chart side) ---------- */

export function placeLabOrder(
  enc: Encounter,
  input: { codes: string[]; priority: Priority; fasting: boolean | null; note: string },
): LabOrder | null {
  const patient = getState().patients.find((p) => p.id === enc.patientId);
  if (!allowed("order.lab", "Lab order", patient && patientName(patient))) return null;
  const codes = normalizeCodes(input.codes).filter((c) => testByCode(c));
  if (!codes.length) return null;
  const s = store.get();
  const counter = s.counter + 1;
  const order: LabOrder = {
    id: `LO-${100000 + counter}`,
    visitNumber: enc.visitNumber, // one visit number everywhere
    patientId: enc.patientId,
    codes,
    placers: withPlacers(`LO-${100000 + counter}`, codes),
    priority: input.priority,
    fasting: input.fasting,
    note: input.note.trim(),
    orderedAt: new Date().toISOString(),
    orderedById: doctorIdForUser(currentUser()) ?? enc.attending,
    status: "received",
    specimens: [],
    results: {},
    orderDirty: false,
    resultDirty: false,
    sends: [],
  };
  store.set({ ...s, counter, orders: [order, ...s.orders] });
  audit("create", `Lab order ${order.id}`, { patient: patientName(patient), detail: `Visit ${order.visitNumber}: ${codes.map((c) => testByCode(c)?.short).join(", ")}` });
  return order;
}

/** Change an order before the specimen is collected (tests) or before it is resulted (priority, notes). */
export function amendLabOrder(id: string, input: { codes: string[]; priority: Priority; fasting: boolean | null; note: string }): boolean {
  const o = getOrder(id);
  if (!o || !allowed("order.lab", `Lab order ${id}`)) return false;
  if (o.status === "cancelled" || o.status === "resulted" || o.status === "amended") return false;
  const wasSent = !!lastAccepted(o.sends, "lab-order");
  mutate(id, (x) => {
    if (x.status === "received") {
      x.codes = normalizeCodes(input.codes).filter((c) => testByCode(c));
      x.placers = withPlacers(x.id, x.codes, x.placers ?? withPlacers(x.id, o.codes));
    }
    x.priority = input.priority;
    x.fasting = input.fasting;
    x.note = input.note.trim();
    if (wasSent) x.orderDirty = true;
  });
  audit("update", `Lab order ${id}`, { patient: nameOf(o), detail: "Order changed" });
  return true;
}

export function cancelLabOrder(id: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("order.lab", `Lab order ${id}`)) return false;
  if (o.status === "cancelled" || o.status === "resulted" || o.status === "amended") return false;
  const wasSent = !!lastAccepted(o.sends, "lab-order");
  mutate(id, (x) => {
    x.status = "cancelled";
    if (wasSent) x.orderDirty = true;
  });
  audit("update", `Lab order ${id}`, { patient: nameOf(o), detail: "Order cancelled" });
  return true;
}

function nameOf(o: LabOrder): string | undefined {
  const p = getState().patients.find((x) => x.id === o.patientId);
  return p ? patientName(p) : undefined;
}

/* ---------- laboratory side ---------- */

export function collectSpecimens(id: string, collectedAt: string = new Date().toISOString()): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (o.status !== "received") return false;
  mutate(id, (x) => {
    x.specimens = specimensFor(x, collectedAt, currentUser().name);
    x.status = "collected";
  });
  audit("update", `Lab order ${id}`, { patient: nameOf(o), detail: "Specimen collected" });
  return true;
}

export function startProcessing(id: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (o.status !== "collected") return false;
  mutate(id, (x) => {
    x.specimens = x.specimens.map((s) => ({ ...s, receivedAt: s.receivedAt ?? new Date().toISOString() }));
    x.status = "in-progress";
  });
  audit("update", `Lab order ${id}`, { patient: nameOf(o), detail: "Specimen received, work in progress" });
  return true;
}

export interface ResultPatch {
  value?: string;
  interp?: LabResult["interp"];
  organism?: LabResult["organism"];
  sens?: LabResult["sens"];
  note?: string;
}

/** Save one result. After publishing, a changed value or flag marks the observation as corrected. */
export function saveLabResult(id: string, code: string, patch: ResultPatch): boolean {
  const o = getOrder(id);
  const t = testByCode(code);
  if (!o || !t || !allowed("lab.result", `Lab order ${id}`)) return false;
  const sex = getState().patients.find((p) => p.id === o.patientId)?.sex ?? "M";
  const published = isPublished(o);
  mutate(id, (x) => {
    const old = x.results[code];
    const next: LabResult = {
      code,
      value: patch.value ?? old?.value ?? "",
      interp: old?.interp ?? "N",
      status: old?.status ?? "final",
      at: old?.at ?? new Date().toISOString(),
      organism: patch.organism !== undefined ? patch.organism : old?.organism,
      sens: patch.sens ?? old?.sens,
      note: patch.note ?? old?.note,
    };
    if (patch.interp) next.interp = patch.interp;
    else if (patch.value !== undefined || patch.organism !== undefined) {
      next.interp = t.kind === "organism" ? (next.organism ? "POS" : "NEG") : interpretValue(t, next.value, sex);
    }
    const changed = !old || old.value !== next.value || old.interp !== next.interp || old.organism?.code !== next.organism?.code || JSON.stringify(old.sens) !== JSON.stringify(next.sens);
    // Whoever sets or changes the value is the performer of this result.
    next.performedBy = (changed ? resultPerformer() : undefined) ?? old?.performedBy;
    if (published && old && changed && next.status !== "cancelled") next.status = "corrected";
    if (published && changed) x.resultDirty = true;
    x.results[code] = next;
  });
  return true;
}

export function cancelLabResult(id: string, code: string, cancel: boolean): boolean {
  const o = getOrder(id);
  if (!o || !o.results[code] || !allowed("lab.result", `Lab order ${id}`)) return false;
  mutate(id, (x) => {
    x.results[code] = { ...x.results[code], status: cancel ? "cancelled" : "corrected" };
    if (isPublished(x)) x.resultDirty = true;
  });
  audit("update", `Lab order ${id}`, { patient: nameOf(o), detail: `${cancel ? "Cancelled" : "Restored"} result ${testByCode(code)?.short}` });
  return true;
}

/** The technologist pressed Save Results. Typing is not audited key by key, so this records it. */
export function noteResultsSaved(id: string): void {
  const o = getOrder(id);
  if (!o) return;
  const n = Object.values(o.results).filter((r) => r.value.trim() || r.organism).length;
  audit("update", `Lab results ${id}`, { patient: nameOf(o), detail: `${n} result(s) saved, visit ${o.visitNumber}` });
  pushToast({ tone: "ok", text: "Results saved.", detail: "They are not published until you press Publish Result." });
}

/** Fill every test with a believable value, so the document meets the Seha minimum content. */
export function fillSampleResults(id: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  const sex = getState().patients.find((p) => p.id === o.patientId)?.sex ?? "M";
  const performedBy = resultPerformer();
  mutate(id, (x) => {
    for (const t of leafTests(x)) {
      if (x.results[t.code]) continue;
      const at = new Date().toISOString();
      if (t.kind === "organism") {
        x.results[t.code] = {
          code: t.code, value: ">100,000 CFU/mL", interp: "POS", status: "final", at, organism: ORGANISMS[0],
          sens: [{ key: "AMP", result: "R" }, { key: "CRO", result: "S" }, { key: "CIP", result: "S" }, { key: "NIT", result: "S" }],
          performedBy,
        };
      } else {
        const value = sampleValue(t, sex);
        x.results[t.code] = { code: t.code, value, interp: interpretValue(t, value, sex), status: "final", at, performedBy };
      }
    }
  });
  return true;
}

/** One click for testers: an order that, once resulted, meets the Seha lab result minimum content (2.1.1). */
export function createConformanceSampleOrder(enc: Encounter): LabOrder | null {
  const o = placeLabOrder(enc, { codes: CONFORMANCE_SAMPLE_CODES, priority: "routine", fasting: null, note: "Conformance sample" });
  if (!o) return null;
  collectSpecimens(o.id);
  startProcessing(o.id);
  fillSampleResults(o.id);
  return getOrder(o.id) ?? null;
}

/* ---------- sending ---------- */

function record(o: LabOrder, kind: "lab-order" | "lab-result", version: number, docStatus: DocStatus, bundle: Json, checks: SendRecord["checks"]): SendRecord {
  const s = store.get();
  const accepted = lastAccepted(o.sends, kind);
  const dupe = o.sends.some((x) => x.kind === kind && x.response.status === "accepted" && x.bundle?.identifier?.value === bundle.identifier?.value);
  const response = simulateNphies({
    label: kind === "lab-order" ? "Laboratory order" : "Laboratory result",
    checks,
    version,
    hasAcceptedOriginal: !!accepted,
    duplicate: dupe,
    forceReject: s.rejectNext,
  });
  const rec: SendRecord = {
    seq: o.sends.length + 1, kind, version, docStatus, at: new Date().toISOString(), bundle, checks, response,
  };
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

export function sendLabOrder(id: string): SendRecord | null {
  const o = getOrder(id);
  if (!o || !allowed("order.lab", `Lab order ${id}`)) return null;
  const ctx = orderContext(o);
  if (!ctx) return null;
  const version = nextVersion(o.sends.filter((s) => s.kind === "lab-order"), "lab-order");
  const docStatus: DocStatus = o.status === "cancelled" ? "cancelled" : version > 1 ? "amended" : "final";
  const bundle = buildLabOrderBundle({ ...ctx, order: o, orderer: personFromDoctor(o.orderedById), version, docStatus });
  const checks = validateLabOrderBundle(bundle, { visitNumber: o.visitNumber, healthId: ctx.patient.healthId });
  const rec = record(o, "lab-order", version, docStatus, bundle, checks);
  if (rec.response.status === "accepted") mutate(id, (x) => { x.orderDirty = false; });
  audit("send-fhir", `Lab order ${id}`, { patient: patientName(ctx.patient), detail: `Version ${version} ${docStatus}: ${rec.response.status}. Visit ${o.visitNumber}` });
  toastFor("Lab order", rec);
  return rec;
}

/**
 * Publish the result document. First time it is version 1 (final). After that it is an amendment that replaces
 * the earlier version: same set identifier, next version number, status amended or corrected.
 */
export function publishLabResult(id: string, amendStatus: "amended" | "corrected" = "amended"): SendRecord | null {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return null;
  const ctx = orderContext(o);
  if (!ctx) return null;
  if (missingResults(o).length) {
    pushToast({ tone: "warn", text: "Some results are still empty.", detail: "Enter every result before publishing." });
    return null;
  }
  // Practitioner.identifier must be a provider-directory id, never the app user id (Practitioner page id 68026521).
  if (!providerIdForUser(currentUser())) {
    pushToast({ tone: "warn", text: "Your account has no provider ID.", detail: "A result can only be published by a user who is in the national provider directory." });
    return null;
  }
  const version = nextVersion(o.sends.filter((s) => s.kind === "lab-result"), "lab-result");
  const docStatus: DocStatus = version === 1 ? "final" : amendStatus;
  const performer = personFromUser(currentUser());
  const bundle = buildLabReportBundle({
    ...ctx, order: o, orderer: personFromDoctor(o.orderedById), performer, authenticator: LAB_DIRECTOR, version, docStatus,
  });
  const checks = validateLabReportBundle(bundle, { visitNumber: o.visitNumber, healthId: ctx.patient.healthId });
  const rec = record(o, "lab-result", version, docStatus, bundle, checks);
  if (rec.response.status === "accepted") {
    mutate(id, (x) => {
      x.status = version > 1 ? "amended" : "resulted";
      x.resultDirty = false;
    });
  }
  audit("send-fhir", `Lab result ${id}`, { patient: patientName(ctx.patient), detail: `Version ${version} ${docStatus}: ${rec.response.status}. Visit ${o.visitNumber}` });
  toastFor("Lab result", rec);
  return rec;
}

/**
 * Release the result to the chart: the lab has finished and checked it. This does not send anything to NPHIES.
 * The result then waits on the NPHIES Clinical page, where it is sent (publishLabResult does the sending).
 */
export function releaseLabResult(id: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (isPublished(o)) return true;
  if (missingResults(o).length) {
    pushToast({ tone: "warn", text: "Some results are still empty.", detail: "Enter every result before you release them." });
    return false;
  }
  const ctx = orderContext(o);
  mutate(id, (x) => { x.status = "resulted"; x.resultDirty = true; });
  audit("update", `Lab result ${id} released`, { patient: ctx ? patientName(ctx.patient) : undefined, detail: `Visit ${o.visitNumber}. Waiting to be sent from NPHIES Clinical.` });
  pushToast({ tone: "ok", text: "Result released to the chart.", detail: "Send it to NPHIES from the NPHIES Clinical page." });
  return true;
}

/* ---------- developer switches ---------- */

export const setRejectNext = (on: boolean) => store.set({ ...store.get(), rejectNext: on });
export const toggleViewed = (key: string) => store.set({ ...store.get(), viewed: { ...store.get().viewed, [key]: !store.get().viewed[key] } });

/* ---------- conformance ---------- */

export function labConformance(s: LabState): ConfStep[] {
  const all = s.orders.flatMap((o) => o.sends);
  const orders = all.filter((x) => x.kind === "lab-order");
  const results = all.filter((x) => x.kind === "lab-result");
  const base = { viewed: s.viewed };
  return [
    conformanceStep({ ...base, id: "5.1", title: "Laboratory Order: Publish", what: "a laboratory order bundle", sends: orders, amendment: false, hint: "Place an order in the chart and press Send Order To NPHIES." }),
    conformanceStep({ ...base, id: "5.2", title: "Laboratory Order: Amended Order", what: "an amendment that replaces the order", sends: orders, amendment: true, hint: "Change or cancel a sent order in the chart, then send it again." }),
    conformanceStep({ ...base, id: "2.1", title: "Lab Result: Publish", what: "a result bundle with the minimum content", sends: results, amendment: false, minimums: labResultMinimums, hint: "Use Create Conformance Sample Order, then Publish Result." }),
    conformanceStep({ ...base, id: "2.2", title: "Lab Result: Amended Report", what: "an amendment that replaces the result", sends: results, amendment: true, minimums: labAmendmentMinimums, hint: "Correct one result, cancel another, then Publish Amendment." }),
  ];
}
