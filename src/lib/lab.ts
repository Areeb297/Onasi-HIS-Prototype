/**
 * Laboratory: own localStorage store, seeds, order and result lifecycle, sending to (simulated) NPHIES, conformance status.
 *
 * Order flow:   chart "Place Order" -> received -> specimen collected -> in progress -> resulted -> amended
 * Sign-off:     in progress has three steps: enter results, send for verification, then a second user verifies and
 *               releases (or sends back with a reason). A critical value needs a recorded call-back before release.
 * NPHIES:       order bundle (5.1, amendment 5.2) and result bundle (2.1, amendment 2.2). Amendments replace the original:
 *               same set identifier, higher version number, status amended / corrected / cancelled.
 * Everything is stored in the browser. No network calls.
 */

import { audit } from "./audit";
import { conformanceStep, type ConfStep } from "./fhir/conformance";
import { simulateNphies, type Json } from "./fhir/common";
import { buildLabOrderBundle, buildLabReportBundle } from "./fhir/lab-bundles";
import {
  CONFORMANCE_SAMPLE_CODES, ORGANISMS, expand, interpretValue, normalizeCodes, parseNumeric, sampleValue, testByCode, type LabTest,
} from "./fhir/lab-catalog";
import { labAmendmentMinimums, labResultMinimums, validateLabOrderBundle, validateLabReportBundle } from "./fhir/lab-validate";
import { LAB_DIRECTOR, doctorIdForUser, personFromDoctor, personFromUser, providerIdForUser } from "./fhir/people";
import { createStore } from "./fhir/store-util";
import {
  lastAccepted, nextVersion, type CriticalCall, type DocStatus, type LabOrder, type LabResult, type LabSpecimen, type Priority, type SendRecord,
} from "./fhir/types";
import type { Encounter, Patient } from "./model";
import { can, currentUser, type DemoUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

export * from "./fhir/lab-catalog";
export { buildLabOrderBundle, buildLabReportBundle, formatResult, placerNumber } from "./fhir/lab-bundles";
export { labAmendmentMinimums, labResultMinimums, validateLabOrderBundle, validateLabReportBundle } from "./fhir/lab-validate";
export type { CriticalCall, LabOrder, LabResult, LabSpecimen, LabStatus, Priority, StaffStamp } from "./fhir/types";

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

/** The results were sent for verification and nobody has verified or returned them yet. */
export const awaitingVerification = (o: LabOrder): boolean => o.status === "in-progress" && !!o.submittedAt && !o.verifiedAt;

/** Critical results of an order that are still part of the report. */
export const criticalResults = (o: LabOrder): LabResult[] =>
  Object.values(o.results).filter((r) => (r.interp === "HH" || r.interp === "LL") && r.status !== "cancelled");

/**
 * The two-person rule. `sameUser` is true when this user sent the results for verification or typed one of the values.
 * Only an administrator may then verify, and must give a reason.
 */
export function verifierCheck(o: Pick<LabOrder, "enteredBy" | "results">, user: DemoUser): { sameUser: boolean; mayOverride: boolean } {
  const pid = providerIdForUser(user);
  const typed = !!pid && Object.values(o.results).some((r) => r.performedBy?.id === pid);
  return { sameUser: o.enteredBy?.userId === user.id || typed, mayOverride: user.role === "admin" };
}

/** What is missing from a critical call-back record. Empty means it is complete. */
export function criticalCallProblems(c: Partial<CriticalCall> | undefined): string[] {
  const out: string[] = [];
  if (!c?.toldTo?.trim()) out.push("Who was told");
  if (!c?.toldBy?.trim()) out.push("Who made the call");
  if (!c?.at || Number.isNaN(new Date(c.at).getTime())) out.push("Time of the call");
  if (!c?.readBack) out.push("Read-back confirmed");
  return out;
}

/**
 * The last released result of the same test for the same patient, from another order. Null when there is none.
 * Used by the verifier to compare (delta check).
 */
export function previousResult(orders: LabOrder[], order: LabOrder, code: string): { result: LabResult; order: LabOrder } | null {
  const curAt = order.results[code]?.at;
  let best: { result: LabResult; order: LabOrder } | null = null;
  for (const o of orders) {
    if (o.id === order.id || o.patientId !== order.patientId || !isPublished(o)) continue;
    const r = o.results[code];
    if (!r || r.status === "cancelled" || !(r.value.trim() || r.organism)) continue;
    if (curAt && r.at > curAt) continue;
    if (!best || r.at > best.result.at) best = { result: r, order: o };
  }
  return best;
}

/** Change from the previous value to the current one, for numbers only. */
export function resultDelta(prev: string, cur: string): { diff: number; pct: number | null } | null {
  const a = parseNumeric(prev);
  const b = parseNumeric(cur);
  if (!a || !b) return null;
  const diff = Math.round((b.n - a.n) * 1000) / 1000;
  return { diff, pct: a.n !== 0 ? Math.round((diff / Math.abs(a.n)) * 1000) / 10 : null };
}

/**
 * Tests in `codes` that are already on an open order (not yet resulted, not cancelled) for the same visit.
 * A panel counts as a duplicate when one of its tests is already open, and the other way round.
 */
export function openLabDuplicates(orders: LabOrder[], visitNumber: string, codes: string[], excludeOrderId?: string): string[] {
  const open = orders.filter((o) => o.visitNumber === visitNumber && o.id !== excludeOrderId && (o.status === "received" || o.status === "collected" || o.status === "in-progress"));
  const openCodes = new Set(open.flatMap((o) => o.codes));
  const openLeaves = new Set(open.flatMap((o) => leafTests(o).map((t) => t.code)));
  const out: string[] = [];
  for (const c of codes) {
    const t = testByCode(c);
    if (!t) continue;
    if (openCodes.has(c)) out.push(t.short);
    else {
      const hits = expand([c]).filter((leaf) => openLeaves.has(leaf.code));
      if (hits.length) out.push(t.panel ? `${t.short} (${hits.map((h) => h.short).join(", ")} already ordered)` : t.short);
    }
  }
  return [...new Set(out)];
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

/** There is no flag here on purpose: the flag is always worked out from the value and the ranges. */
export interface ResultPatch {
  value?: string;
  organism?: LabResult["organism"];
  sens?: LabResult["sens"];
  note?: string;
}

/** Save one result. After publishing, a changed value or flag marks the observation as corrected. */
export function saveLabResult(id: string, code: string, patch: ResultPatch): boolean {
  const o = getOrder(id);
  const t = testByCode(code);
  if (!o || !t || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (lockedForVerification(o)) return false;
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
    if (patch.value !== undefined || patch.organism !== undefined) {
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

/** Results that wait for the verifier cannot change. The verifier sends them back to entry first. */
function lockedForVerification(o: LabOrder): boolean {
  if (!awaitingVerification(o)) return false;
  pushToast({ tone: "warn", text: "These results are waiting for verification.", detail: "The verifier must send them back before they can change." });
  return true;
}

export function cancelLabResult(id: string, code: string, cancel: boolean): boolean {
  const o = getOrder(id);
  if (!o || !o.results[code] || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (lockedForVerification(o)) return false;
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
  pushToast({ tone: "ok", text: "Results saved.", detail: isPublished(o) ? "Publish the amendment to replace the earlier version." : "Send them for verification when every result is entered." });
}

/** Fill every test with a believable value, so the document meets the Seha minimum content. */
export function fillSampleResults(id: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (lockedForVerification(o)) return false;
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
  const o = placeLabOrder(enc, { codes: CONFORMANCE_SAMPLE_CODES, priority: "routine", fasting: null, note: "Sample order" });
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
  if (awaitingVerification(o)) {
    pushToast({ tone: "warn", text: "This result is waiting for verification.", detail: "A second user must verify and release it before it is sent." });
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

/* ---------- verification (sign-off) ---------- */

/**
 * The technologist has entered every result and hands the order to a verifier.
 * Refuses while any result is empty and says which ones.
 */
export function submitForVerification(id: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (o.status !== "in-progress" || awaitingVerification(o)) return false;
  const missing = missingResults(o);
  if (missing.length) {
    pushToast({ tone: "warn", text: "Some results are still empty.", detail: `Enter these first: ${missing.map((m) => m.short).join(", ")}.` });
    return false;
  }
  const u = currentUser();
  const at = new Date().toISOString();
  mutate(id, (x) => {
    x.enteredBy = { userId: u.id, name: u.name };
    x.submittedAt = at;
    x.sentBack = undefined;
  });
  audit("update", `Lab result ${id} sent for verification`, { patient: nameOf(o), detail: `Visit ${o.visitNumber}. ${leafTests(o).length} result(s).` });
  pushToast({ tone: "ok", text: "Results sent for verification.", detail: "A second user must verify and release them." });
  return true;
}

/** The verifier returns the results to entry, with a reason. */
export function sendBackLabResult(id: string, reason: string): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (!awaitingVerification(o)) return false;
  if (!reason.trim()) {
    pushToast({ tone: "warn", text: "Give a reason for sending the results back." });
    return false;
  }
  const u = currentUser();
  mutate(id, (x) => {
    x.submittedAt = undefined;
    x.sentBack = { by: u.name, at: new Date().toISOString(), reason: reason.trim() };
  });
  audit("update", `Lab result ${id} sent back to entry`, { patient: nameOf(o), detail: `Visit ${o.visitNumber}. Reason: ${reason.trim()}` });
  pushToast({ tone: "ok", text: "Results sent back to entry." });
  return true;
}

export interface VerifyInput {
  /** Needed when an administrator verifies a result they entered themselves. */
  overrideReason?: string;
  /** Needed when the order has a critical value. */
  criticalCall?: CriticalCall;
}

/**
 * Verify and release: the sign-off by a second user. The result becomes final in the chart. Nothing is sent to NPHIES:
 * the result then waits on the NPHIES Clinical page, where publishLabResult sends it.
 */
export function verifyAndReleaseLabResult(id: string, input: VerifyInput = {}): boolean {
  const o = getOrder(id);
  if (!o || !allowed("lab.result", `Lab order ${id}`)) return false;
  if (isPublished(o)) return true;
  const missing = missingResults(o);
  if (missing.length) {
    pushToast({ tone: "warn", text: "Some results are still empty.", detail: `Enter these first: ${missing.map((m) => m.short).join(", ")}.` });
    return false;
  }
  if (!awaitingVerification(o)) {
    pushToast({ tone: "warn", text: "Send the results for verification first.", detail: "A result is released only after a second user has verified it." });
    return false;
  }
  const u = currentUser();
  const who = verifierCheck(o, u);
  const reason = input.overrideReason?.trim() ?? "";
  if (who.sameUser && !who.mayOverride) {
    audit("denied", `Lab result ${id} verification`, { patient: nameOf(o), detail: "The same user entered the result" });
    pushToast({ tone: "warn", text: "You entered this result.", detail: "A different user must verify it." });
    return false;
  }
  if (who.sameUser && !reason) {
    pushToast({ tone: "warn", text: "Give a reason for verifying your own result." });
    return false;
  }
  const critical = hasCritical(o);
  if (critical) {
    const gaps = criticalCallProblems(input.criticalCall);
    if (gaps.length) {
      pushToast({ tone: "warn", text: "Record the critical result call first.", detail: `Missing: ${gaps.join(", ")}.` });
      return false;
    }
  }
  const at = new Date().toISOString();
  mutate(id, (x) => {
    x.verifiedBy = { userId: u.id, name: u.name };
    x.verifiedAt = at;
    x.verifyOverrideReason = who.sameUser ? reason : undefined;
    x.criticalCall = critical && input.criticalCall ? { ...input.criticalCall, toldTo: input.criticalCall.toldTo.trim(), toldBy: input.criticalCall.toldBy.trim() } : undefined;
    x.status = "resulted";
    x.resultDirty = true;
  });
  const patient = nameOf(o);
  if (who.sameUser) audit("update", `Lab result ${id} verified with override`, { patient, detail: `The verifier also entered the result. Reason: ${reason}` });
  if (critical && input.criticalCall) {
    const c = input.criticalCall;
    audit("update", `Lab result ${id} critical call`, { patient, detail: `Told ${c.toldTo.trim()} by ${c.toldBy.trim()} at ${c.at}. Read-back confirmed.` });
  }
  audit("update", `Lab result ${id} verified and released`, { patient, detail: `Visit ${o.visitNumber}. Entered by ${o.enteredBy?.name ?? "unknown"}. Waiting to be sent from NPHIES Clinical.` });
  pushToast({ tone: "ok", text: "Result verified and released to the chart.", detail: "Send it to NPHIES from the NPHIES Clinical page." });
  return true;
}

/** Kept for callers that release without extra input. It is the same sign-off, so it only works after verification was asked for. */
export const releaseLabResult = (id: string): boolean => verifyAndReleaseLabResult(id);

/** Why a result cannot be sent to NPHIES yet, or null when it can. Used by the NPHIES Clinical page. */
export function labResultSendBlock(o: LabOrder): string | null {
  const missing = missingResults(o).length;
  if (missing) return `${missing} of ${leafTests(o).length} results are still empty.`;
  if (!isPublished(o)) return awaitingVerification(o) ? "Waiting for a second user to verify and release the result." : "Waiting for the laboratory to send the result for verification.";
  return null;
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
    conformanceStep({ ...base, id: "2.1", title: "Lab Result: Publish", what: "a result bundle with the minimum content", sends: results, amendment: false, minimums: labResultMinimums, hint: "Use Create Sample Order, send the result for verification, verify it as a second user, then send it from NPHIES Clinical." }),
    conformanceStep({ ...base, id: "2.2", title: "Lab Result: Amended Report", what: "an amendment that replaces the result", sends: results, amendment: true, minimums: labAmendmentMinimums, hint: "Correct one result, cancel another, then Publish Amendment." }),
  ];
}
