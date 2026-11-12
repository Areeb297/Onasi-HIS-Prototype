import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { buildDocument } from "./cda/build";
import { isDeathDisposition } from "./cda/chartdata";
import { DOC_CODE, gatherInput } from "./cda/gather";
import { renderRequest, simulateResponse } from "./cda/iti41";
import type { BuiltDoc, DocType, SimResponse } from "./cda/types";
import { errorsOf, validateDoc } from "./cda/validate";
import type { Check, Encounter, Patient } from "./model";
import { getFormRecords } from "./records";
import { can, currentUser } from "./session";

/**
 * Clinical document store. Keeps every version of every document the app generated or published,
 * plus a history of what happened. Browser storage only. Publishing is simulated.
 */

export type DocStatus = "draft" | "published" | "deprecated";

export interface DocRecord {
  id: string;
  setId: string;
  visit: string;
  patientId: string;
  type: DocType;
  version: number;
  status: DocStatus;
  built: BuiltDoc;
  checks: Check[];
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  /** Last registry answer. A rejected publish keeps the document as a draft with this response. */
  response?: SimResponse;
  replaces?: string;
  replacedBy?: string;
  amendReason?: string;
  procIndex?: number;
}

export interface DocEvent {
  id: number;
  at: string;
  user: string;
  visit: string;
  kind: "generated" | "published" | "rejected" | "amended" | "deprecated" | "death";
  type?: DocType;
  docId?: string;
  text: string;
}

interface State {
  docs: DocRecord[];
  events: DocEvent[];
  /** Visits where a patient death was recorded. */
  deaths: Record<string, { at: string; user: string }>;
  seq: number;
}

/** v2: the document XML, code systems and metadata changed. Documents saved by the older version are dropped. */
const KEY = "onasi-emr-docs-v2";
let state: State = { docs: [], events: [], deaths: {}, seq: 1 };
try {
  localStorage.removeItem("onasi-emr-docs-v1");
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<State>) };
} catch {
  /* storage may be blocked */
}

const listeners = new Set<() => void>();
function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useDocs(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export const getDocsState = (): State => state;
export const docsForVisit = (visit: string, s: State = state): DocRecord[] => s.docs.filter((d) => d.visit === visit);
export const eventsForVisit = (visit: string, s: State = state): DocEvent[] => s.events.filter((e) => e.visit === visit);
export const deathRecorded = (visit: string, s: State = state): boolean => !!s.deaths[visit];

/** The version that counts: the published one, else the newest draft. */
export function currentDoc(visit: string, type: DocType, s: State = state, procIndex?: number): DocRecord | undefined {
  const all = s.docs.filter((d) => d.visit === visit && d.type === type && (procIndex === undefined || d.procIndex === procIndex));
  return all.find((d) => d.status === "published") ?? [...all].reverse().find((d) => d.status === "draft");
}

const who = () => currentUser().name;

function pushEvent(s: State, e: Omit<DocEvent, "id" | "at" | "user">): State {
  const id = s.events.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  return { ...s, events: [...s.events, { ...e, id, at: new Date().toISOString(), user: who() }] };
}

export type Result<T = DocRecord> = { ok: true; doc: T; message: string } | { ok: false; message: string };

function allowed(perm: "emr.write" | "docs.publish", target: string, patientName: string): string | null {
  if (can(perm)) return null;
  audit("denied", target, { patient: patientName });
  return perm === "docs.publish" ? "Your role cannot publish clinical documents." : "Your role cannot create clinical documents.";
}

const deathMsg = "A patient death is recorded for this visit. No clinical document is published to nphies. Death reporting is a separate process.";

/** Build a draft from the live chart. Replaces an older draft of the same document. */
export function generateDoc(enc: Encounter, patient: Patient, type: DocType, opts: { procIndex?: number; now?: Date } = {}): Result {
  const name = `${patient.given} ${patient.family}`;
  const denied = allowed("emr.write", `Clinical document ${type}`, name);
  if (denied) return { ok: false, message: denied };
  if (deathRecorded(enc.visitNumber) || isDeathDisposition(enc.disposition)) return { ok: false, message: deathMsg };
  if (type === "newborn" && getFormRecords(enc.visitNumber, "delivery-outcomes").some((r) => /^still/i.test(String(r.values.birthStatus ?? "")))) {
    return { ok: false, message: "A stillbirth is recorded. No Newborn Discharge Summary is created. Publish the Maternal Discharge Summary only." };
  }
  const published = currentDoc(enc.visitNumber, type, state, opts.procIndex);
  if (published?.status === "published") return { ok: false, message: "This document is already published. Use Amend to send a new version." };

  const seq = state.seq;
  const docId = `${enc.visitNumber}-${DOC_CODE[type]}-${seq}`;
  const built = buildDocument(gatherInput(type, enc, patient, { docId, setId: docId, version: 1, procIndex: opts.procIndex, now: opts.now }));
  const checks = validateDoc(built);
  const rec: DocRecord = {
    id: docId, setId: docId, visit: enc.visitNumber, patientId: patient.id, type, version: 1, status: "draft", built, checks,
    createdAt: (opts.now ?? new Date()).toISOString(), createdBy: who(), procIndex: opts.procIndex,
  };
  const old = published; // a draft, if any
  let next: State = { ...state, seq: seq + 1, docs: [...state.docs.filter((d) => d.id !== old?.id), rec] };
  next = pushEvent(next, { visit: enc.visitNumber, kind: "generated", type, docId, text: `${built.title} version 1 generated (${errorsOf(checks).length} errors, ${checks.filter((c) => c.level === "warn").length} warnings).` });
  commit(next);
  audit("create", `${built.title} ${docId}`, { patient: name, detail: `Visit ${enc.visitNumber}` });
  return { ok: true, doc: rec, message: `${built.title} generated from the chart.` };
}

/** Send the draft to the (simulated) registry. A rejection keeps it as a draft. */
export function publishDoc(id: string, now: Date = new Date()): Result {
  const rec = state.docs.find((d) => d.id === id);
  if (!rec) return { ok: false, message: "Document not found." };
  const denied = allowed("docs.publish", `Publish ${rec.built.title}`, rec.patientId);
  if (denied) return { ok: false, message: denied };
  if (rec.status !== "draft") return { ok: false, message: "Only a draft can be published." };
  if (deathRecorded(rec.visit) || rec.built.facts.died) {
    return { ok: false, message: deathMsg };
  }
  const checks = validateDoc(rec.built);
  const response = simulateResponse(rec.built, checks, now);
  audit("send-document", `${rec.built.title} ${rec.id}`, { patient: rec.patientId, detail: `ITI-41 ${response.ok ? "accepted" : "rejected"}, visit ${rec.visit}` });
  if (!response.ok) {
    let next: State = { ...state, docs: state.docs.map((d) => (d.id === id ? { ...d, checks, response } : d)) };
    next = pushEvent(next, { visit: rec.visit, kind: "rejected", type: rec.type, docId: id, text: `${rec.built.title} rejected: ${response.errors.length} errors.` });
    commit(next);
    return { ok: false, message: `The registry rejected the document: ${response.errors[0]?.context ?? "unknown error"}` };
  }
  const done: DocRecord = { ...rec, status: "published", checks, response, publishedAt: now.toISOString(), publishedBy: who() };
  let next: State = { ...state, docs: state.docs.map((d) => (d.id === id ? done : d)) };
  next = pushEvent(next, { visit: rec.visit, kind: "published", type: rec.type, docId: id, text: `${rec.built.title} version ${rec.version} published.` });
  commit(next);
  return { ok: true, doc: done, message: `${rec.built.title} published. The registry answered Success.` };
}

/** Amend a published document: build a new version from the current chart that replaces the old one. */
export function amendDoc(enc: Encounter, patient: Patient, id: string, reason: string, now: Date = new Date()): Result {
  const old = state.docs.find((d) => d.id === id);
  const name = `${patient.given} ${patient.family}`;
  if (!old) return { ok: false, message: "Document not found." };
  const denied = allowed("docs.publish", `Amend ${old.built.title}`, name);
  if (denied) return { ok: false, message: denied };
  if (old.status !== "published") return { ok: false, message: "Only a published document can be amended." };
  if (!reason.trim()) return { ok: false, message: "Enter the reason for the amendment." };

  const newId = `${old.visit}-${DOC_CODE[old.type]}-${state.seq}`;
  const built = buildDocument(gatherInput(old.type, enc, patient, { docId: newId, setId: old.setId, version: old.version + 1, replaces: old.id, amendReason: reason.trim(), procIndex: old.procIndex, now }));
  const checks = validateDoc(built);
  const response = simulateResponse(built, checks, now);
  const rec: DocRecord = {
    id: newId, setId: old.setId, visit: old.visit, patientId: old.patientId, type: old.type, version: old.version + 1, status: response.ok ? "published" : "draft",
    built, checks, createdAt: now.toISOString(), createdBy: who(), response, replaces: old.id, amendReason: reason.trim(), procIndex: old.procIndex,
    publishedAt: response.ok ? now.toISOString() : undefined, publishedBy: response.ok ? who() : undefined,
  };
  audit("send-document", `${built.title} ${newId}`, { patient: name, detail: `Amendment of ${old.id}: ${reason.trim()}. ITI-41 ${response.ok ? "accepted" : "rejected"}` });
  let next: State = { ...state, seq: state.seq + 1 };
  if (response.ok) {
    const depMeta = { ...old.built.metadata, documentEntry: { ...old.built.metadata.documentEntry, availabilityStatus: "Deprecated" as const } };
    next.docs = [...state.docs.map((d) => (d.id === old.id ? { ...d, status: "deprecated" as const, replacedBy: newId, built: { ...d.built, metadata: depMeta } } : d)), rec];
    next = pushEvent(next, { visit: old.visit, kind: "amended", type: old.type, docId: newId, text: `${built.title} version ${rec.version} published. It replaces ${old.id}.` });
    next = pushEvent(next, { visit: old.visit, kind: "deprecated", type: old.type, docId: old.id, text: `${old.id} (version ${old.version}) is now deprecated.` });
    audit("update", `${old.built.title} ${old.id}`, { patient: name, detail: "Deprecated by amendment" });
  } else {
    next.docs = [...state.docs, rec];
    next = pushEvent(next, { visit: old.visit, kind: "rejected", type: old.type, docId: newId, text: `Amendment of ${old.id} rejected: ${response.errors.length} errors.` });
  }
  commit(next);
  return response.ok
    ? { ok: true, doc: rec, message: `Version ${rec.version} published. Version ${old.version} is deprecated.` }
    : { ok: false, message: `The registry rejected the amendment: ${response.errors[0]?.context ?? "unknown error"}` };
}

/** Exception flow: the patient died. Nothing is published. */
export function recordDeath(enc: Encounter, patient: Patient): Result<null> {
  const name = `${patient.given} ${patient.family}`;
  const denied = allowed("emr.write", `Patient death ${enc.visitNumber}`, name);
  if (denied) return { ok: false, message: denied };
  if (deathRecorded(enc.visitNumber)) return { ok: false, message: "A death is already recorded for this visit." };
  let next: State = { ...state, deaths: { ...state.deaths, [enc.visitNumber]: { at: new Date().toISOString(), user: who() } } };
  next = pushEvent(next, { visit: enc.visitNumber, kind: "death", text: "Patient death recorded. Nothing is published to nphies. Death reporting is not sent to nphies." });
  commit(next);
  audit("update", `Patient death ${enc.visitNumber}`, { patient: name, detail: "Exception flow: no clinical document published" });
  return { ok: true, doc: null, message: "Death recorded. No clinical document will be published." };
}

export function deleteDraft(id: string) {
  const d = state.docs.find((x) => x.id === id);
  if (!d || d.status !== "draft") return;
  commit({ ...state, docs: state.docs.filter((x) => x.id !== id) });
  audit("delete", `${d.built.title} draft ${id}`, { patient: d.patientId });
}

export function resetDocs() {
  commit({ docs: [], events: [], deaths: {}, seq: 1 });
}

export { renderRequest };
