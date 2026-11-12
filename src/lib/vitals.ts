import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import { comp, doctorXcn, esc, hd, messageToString, pidSegment, ts, visitCx, type Seg } from "./hl7";
import { VS } from "./nphies-valuesets";
import { currentUser } from "./session";
import type { Check, Encounter, HisState, Patient } from "./model";
import { DOCTORS, OID, ORG_ID, ORG_OID } from "./reference-data";
import type { SegId } from "./spec";
import { getState, nowLocal, updateEncounter } from "./store";
import {
  CLAIM_ITEMS, EXTRA_CODES, LOINC_SYSTEM, NTE_COMMENT_TYPE, NTE_MAX, OBR_PANEL_CODE, OBR_SECTION_ID, VITALS, VITAL_BY_KEY, bmiOf, flagFor, refRangeFor,
  type Consciousness, type PanelContext, type VitalKey,
} from "./vitals-spec";

/**
 * Vital sign panels: capture, amend, cancel, and send as HL7 ORU^R01 (NPHIES UHR).
 * Also answers "is this visit ready for a claim?" (CHI: eight vitals plus chief complaint, each a value or an absence reason).
 * Everything is simulated: there is no connection to NPHIES.
 */

export type PanelStatus = "F" | "C" | "X";
export type ObsStatus = "F" | "C" | "D" | "W";

export interface VitalObs {
  key: VitalKey;
  value?: number;
  /** The reading could not be taken. Used for claims. It is not sent in the ORU. */
  absence?: { code: string; label: string };
  status: ObsStatus;
}

export interface SendRecord {
  at: string;
  controlId: string;
  kind: "new" | "amend" | "cancel" | "batch";
  /** Panel version that was sent. 0 for a batch. */
  version: number;
  visit: string;
  message: string;
  ack: string;
  accepted: boolean;
  errors: number;
  checks: Check[];
}

export interface VitalPanel {
  id: string;
  visit: string;
  patientId: string;
  /** OBR-2 and OBR-3. */
  businessId: string;
  /** Local date-time. OBR-7 and OBR-22. */
  at: string;
  context: PanelContext;
  /** Provider id of the person who took the reading. Becomes the National Provider ID in OBR-16. Empty when not known. */
  recordedBy: string;
  status: PanelStatus;
  version: number;
  obs: VitalObs[];
  onOxygen: boolean;
  o2flow?: number;
  position?: string;
  consciousness: Consciousness;
  note?: string;
  sends: SendRecord[];
}

interface State {
  panels: VitalPanel[];
  seq: number;
  rejectNext: boolean;
  batches: SendRecord[];
}

/** v2: goes with the ADT store v3 (new visit data) and the corrected temperature absence codes. */
const KEY = "onasi-emr-vitals-v2";
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  return seedVitals();
}

function get(): State {
  if (!state) state = load();
  return state;
}

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useVitals(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}
export const getVitals = get;
export const resetVitals = () => commit(seedVitals());
export const setVitalsRejectNext = (on: boolean) => commit({ ...get(), rejectNext: on });

export const panelsOf = (visit: string, s: State = get()): VitalPanel[] =>
  s.panels.filter((p) => p.visit === visit).sort((a, b) => b.at.localeCompare(a.at));

const ageOf = (p: Patient | undefined) => (p ? Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86_400_000)) : 40);
const ctx = (visit: string): { enc: Encounter; patient: Patient } | null => {
  const st = getState();
  const enc = st.encounters.find((e) => e.visitNumber === visit);
  const patient = enc && st.patients.find((p) => p.id === enc.patientId);
  return enc && patient ? { enc, patient } : null;
};

/**
 * The signed-in person as the recorder of a reading (OBR-16): their doctor id or provider id.
 * "" when the user has no provider id, so nobody else is named in their place.
 */
export function currentRecorder(): string {
  let user;
  try { user = currentUser(); } catch { return ""; }
  const doctor = DOCTORS.find((d) => user.name === `Dr. ${d.given} ${d.family}`);
  return doctor?.id ?? user.providerId ?? "";
}

export const obsValue = (p: VitalPanel, k: VitalKey): number | undefined => p.obs.find((o) => o.key === k && o.status !== "D" && o.status !== "W")?.value;

/* ---------- editing ---------- */

export interface PanelInput {
  visit: string;
  at?: string;
  context: PanelContext;
  recordedBy?: string;
  values: Partial<Record<VitalKey, number>>;
  absences?: Partial<Record<VitalKey, { code: string; label: string }>>;
  onOxygen?: boolean;
  o2flow?: number;
  position?: string;
  consciousness?: Consciousness;
  note?: string;
}

function toObs(input: Pick<PanelInput, "values" | "absences">): VitalObs[] {
  const out: VitalObs[] = [];
  for (const d of VITALS) {
    const v = input.values[d.key];
    const a = input.absences?.[d.key];
    if (v !== undefined && !Number.isNaN(v)) out.push({ key: d.key, value: v, status: "F" });
    else if (a) out.push({ key: d.key, absence: a, status: "F" });
  }
  return out;
}

/** Keep the legacy chart header in step with the newest panel. */
function syncChart(visit: string) {
  const newest = panelsOf(visit).find((p) => p.status !== "X");
  if (!newest) return;
  const val = (k: VitalKey) => obsValue(newest, k);
  updateEncounter(
    visit,
    (e) => {
      const base = e.vitals ?? { bp: "", pulse: "", temp: "", spo2: "", rr: "", weight: "", at: "" };
      const s = (n: number | undefined, keep: string) => (n === undefined ? keep : String(n));
      e.vitals = {
        ...base,
        bp: val("sbp") !== undefined && val("dbp") !== undefined ? `${val("sbp")}/${val("dbp")}` : base.bp,
        pulse: s(val("pulse"), base.pulse), temp: s(val("temp"), base.temp), spo2: s(val("spo2"), base.spo2),
        rr: s(val("rr"), base.rr), weight: s(val("weight"), base.weight),
        height: val("height") !== undefined ? String(val("height")) : base.height,
        at: newest.at,
      };
    },
    { touch: false },
  );
}

export function savePanel(input: PanelInput): VitalPanel | null {
  const c = ctx(input.visit);
  if (!c) return null;
  const s = get();
  const n = s.seq + 1;
  const panel: VitalPanel = {
    id: `VP-${n}`, visit: input.visit, patientId: c.patient.id, businessId: `VSP${String(n).padStart(6, "0")}`,
    at: input.at ?? nowLocal(), context: input.context, recordedBy: input.recordedBy ?? currentRecorder(),
    status: "F", version: 1, obs: toObs(input), onOxygen: !!input.onOxygen, o2flow: input.o2flow, position: input.position,
    consciousness: input.consciousness ?? "Alert", note: input.note, sends: [],
  };
  commit({ ...s, seq: n, panels: [...s.panels, panel] });
  syncChart(input.visit);
  audit("create", `Vital signs ${panel.businessId}`, { patient: `${c.patient.given} ${c.patient.family}`, detail: `Visit ${input.visit}, ${input.context}` });
  return panel;
}

/** Correct a panel that may already be sent. Changed readings become C and the panel becomes C. */
export function amendPanel(id: string, input: Pick<PanelInput, "values" | "absences" | "note">): VitalPanel | null {
  const s = get();
  const p = s.panels.find((x) => x.id === id);
  if (!p || p.status === "X") return null;
  const next = toObs(input);
  const obs: VitalObs[] = [];
  for (const d of VITALS) {
    const before = p.obs.find((o) => o.key === d.key && o.status !== "D" && o.status !== "W");
    const after = next.find((o) => o.key === d.key);
    if (!before && after) obs.push({ ...after, status: p.sends.length ? "C" : "F" });
    else if (before && !after) obs.push({ ...before, status: "D" });
    else if (before && after) {
      const same = before.value === after.value && before.absence?.code === after.absence?.code;
      obs.push(same ? before : { ...after, status: p.sends.length ? "C" : "F" });
    }
  }
  const sent = p.sends.length > 0;
  const updated: VitalPanel = { ...p, obs, note: input.note ?? p.note, status: sent ? "C" : "F", version: p.version + 1 };
  commit({ ...s, panels: s.panels.map((x) => (x.id === id ? updated : x)) });
  syncChart(p.visit);
  audit("update", `Vital signs ${p.businessId} v${updated.version}`, { detail: sent ? "Correction after send" : "Edit before send" });
  return updated;
}

export function cancelPanel(id: string, reason: "D" | "W" = "W"): boolean {
  const s = get();
  const p = s.panels.find((x) => x.id === id);
  if (!p || p.status === "X") return false;
  const updated: VitalPanel = { ...p, status: "X", version: p.version + 1, obs: p.obs.map((o) => ({ ...o, status: reason })) };
  commit({ ...s, panels: s.panels.map((x) => (x.id === id ? updated : x)) });
  audit("update", `Vital signs ${p.businessId} cancelled`, { detail: reason === "D" ? "Deleted" : "Entered in error" });
  return true;
}

export function cancelReading(id: string, key: VitalKey, reason: "D" | "W" = "W"): boolean {
  const s = get();
  const p = s.panels.find((x) => x.id === id);
  if (!p || p.status === "X") return false;
  const updated: VitalPanel = {
    ...p, version: p.version + 1, status: p.sends.length ? "C" : p.status,
    obs: p.obs.map((o) => (o.key === key ? { ...o, status: reason } : o)),
  };
  commit({ ...s, panels: s.panels.map((x) => (x.id === id ? updated : x)) });
  audit("update", `Vital signs ${p.businessId} reading cancelled`, { detail: VITAL_BY_KEY[key].label });
  return true;
}

/* ---------- ORU^R01 ---------- */

interface OruSeg { id: string; f: Record<number, string> }
const asSeg = (s: OruSeg): Seg => ({ id: s.id as SegId, f: s.f });

const uuidish = (n: number) => `VSO-${Date.now().toString(36).toUpperCase()}-${String(n).padStart(4, "0")}`;

function obrObx(p: VitalPanel, patient: Patient, setId: number): OruSeg[] {
  const age = ageOf(patient);
  const out: OruSeg[] = [];
  const bid = `${esc(p.businessId)}^^${ORG_OID}`;
  const obr: Record<number, string> = {
    1: String(setId), 2: bid, 3: bid,
    4: `${OBR_PANEL_CODE.code}^${OBR_PANEL_CODE.text}^${OBR_PANEL_CODE.system}`,
    7: ts(p.at), 22: ts(p.at), 24: OBR_SECTION_ID, 25: p.status,
  };
  if (p.recordedBy) obr[16] = doctorXcn(p.recordedBy);
  out.push({ id: "OBR", f: obr });
  // A note about the panel is an OBR-NTE: it comes directly after the OBR, before the first OBX. NTE-4 is required.
  if (p.note) out.push({ id: "NTE", f: { 1: "1", 3: esc(p.note.slice(0, NTE_MAX)), 4: NTE_COMMENT_TYPE } });
  // Readings the app derives or adds (BMI, oxygen flow, position) follow the panel: cancelled with it, corrected with their source.
  const cancelStatus: ObsStatus | undefined = p.status === "X" ? (p.obs.find((o) => o.status === "D" || o.status === "W")?.status ?? "W") : undefined;
  const statusOf = (...keys: VitalKey[]): ObsStatus =>
    cancelStatus ?? (keys.some((k) => p.obs.find((o) => o.key === k)?.status === "C") ? "C" : "F");
  let n = 1;
  const push = (code: string, text: string, value: string, unit: string, range: string, flag: string, status: ObsStatus, type = "NM") => {
    const f: Record<number, string> = { 1: String(n++), 2: type, 3: `${code}^${text}^${LOINC_SYSTEM}`, 5: esc(value), 11: status };
    if (unit) f[6] = unit;
    if (range) f[7] = esc(range);
    if (flag) f[8] = flag;
    out.push({ id: "OBX", f });
  };
  for (const d of VITALS) {
    const o = p.obs.find((x) => x.key === d.key);
    if (!o || o.value === undefined) continue; // absence reasons are for claims, not for the ORU
    // OBX-7 is sent only when the app has a range that fits the patient's age (adult ranges only).
    push(d.loinc, d.loincText, String(o.value), d.unit, refRangeFor(d, age), flagFor(d, o.value, age), o.status);
  }
  const w = obsValue(p, "weight");
  const h = obsValue(p, "height");
  const bmi = w !== undefined && h !== undefined ? bmiOf(w, h) : undefined;
  if (bmi !== undefined) push(EXTRA_CODES.bmi.loinc, EXTRA_CODES.bmi.text, String(bmi), EXTRA_CODES.bmi.unit, "", "", statusOf("weight", "height"));
  if (p.onOxygen && p.o2flow !== undefined) push(EXTRA_CODES.o2flow.loinc, EXTRA_CODES.o2flow.text, String(p.o2flow), EXTRA_CODES.o2flow.unit, "", "", statusOf());
  if (p.position) push("8361-8", "Body position with respect to gravity", p.position, "", "", "", statusOf(), "ST");
  return out;
}

export function buildOru(panels: VitalPanel[], patient: Patient, enc: Encounter, controlId: string, when: Date = new Date()): { segs: Seg[]; message: string } {
  const pad = (x: number) => String(x).padStart(2, "0");
  const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const msh: OruSeg = {
    id: "MSH",
    f: { 2: "^~\\&", 3: hd(ORG_OID), 4: hd(ORG_ID), 5: `nphies^${OID.nphiesApp}^ISO`, 7: ts(local), 9: comp("ORU", "R01", "ORU_R01"), 10: controlId, 12: "2.5.1" },
  };
  const pid = pidSegment(patient);
  const pv1: OruSeg = { id: "PV1", f: { 1: "1", 2: enc.cls, 19: visitCx(enc.visitNumber) } };
  const segs: Seg[] = [asSeg(msh), pid, asSeg(pv1)];
  let setId = 1;
  for (const p of panels) for (const sg of obrObx(p, patient, setId++)) segs.push(asSeg(sg));
  // OBR set ids restart per message: the code above already numbers them 1..n
  return { segs, message: messageToString(segs) };
}

/* ---------- validation ---------- */

const CODE_UNITS: Record<string, string> = Object.fromEntries([
  ...VITALS.map((v) => [v.loinc, v.unit]),
  [EXTRA_CODES.bmi.loinc, EXTRA_CODES.bmi.unit], [EXTRA_CODES.mbp.loinc, EXTRA_CODES.mbp.unit], [EXTRA_CODES.o2flow.loinc, EXTRA_CODES.o2flow.unit],
  ["8361-8", ""],
]);

export function validateOru(segs: Seg[]): Check[] {
  const out: Check[] = [];
  const err = (text: string) => out.push({ level: "error", text });
  const warn = (text: string) => out.push({ level: "warn", text });
  const ok = (text: string) => out.push({ level: "ok", text });
  const by = (id: string) => segs.filter((s) => (s.id as string) === id);
  const [msh] = by("MSH"); const [pid] = by("PID"); const [pv1] = by("PV1");
  const before = out.length;

  if (!msh) err("MSH is missing."); else {
    if (msh.f[9] !== "ORU^R01^ORU_R01") err("MSH-9 should be ORU^R01^ORU_R01.");
    if (!/^\^2\.16\.840\.1\.113883\.3\.3731\.[\d.]+\^ISO$/.test(msh.f[3] ?? "")) err("MSH-3 must be the National Organization OID: ^2.16.840.1.113883.3.3731.XXXX^ISO.");
    if (!(msh.f[5] ?? "").startsWith("nphies^")) warn("MSH-5 should have namespace nphies.");
    if (!msh.f[10]) err("MSH-10 Message Control ID is empty.");
    if (msh.f[12] !== "2.5.1") err("MSH-12 should be 2.5.1.");
  }
  if (!pid) err("PID is required."); else {
    if (!pid.f[3]) err("PID-3 Health ID is required.");
    else if (!pid.f[3].includes(OID.healthId)) err(`PID-3 must carry assigning authority ${OID.healthId}.`);
    if (!pid.f[7]) err("PID-7 Date of Birth is required.");
  }
  if (!pv1) err("PV1 is required: vital signs attach to a visit."); else {
    if (!pv1.f[2]) err("PV1-2 Patient Class is required.");
    else if (!VS.patientClass.has(pv1.f[2])) err(`PV1-2 "${pv1.f[2]}" is not a patient class code.`);
    if (!pv1.f[19]) err("PV1-19 Visit Number is required.");
    else if (!pv1.f[19].includes(`&${ORG_OID}&ISO`)) err("PV1-19 must carry the National Organization OID as assigning authority.");
  }
  const obrs = by("OBR");
  if (obrs.length === 0) err("At least one OBR (Vital Signs Panel) is required.");
  // walk the group: each OBX belongs to the OBR above it
  const grp: { cur: Seg | null; count: number } = { cur: null, count: 0 };
  const closeGroup = () => { if (grp.cur && grp.count === 0) err(`OBR ${grp.cur.f[1]} has no OBX. A panel needs at least one reading.`); };
  for (const s of segs) {
    const id = s.id as string;
    if (id === "NTE") {
      if (!s.f[3]) err("NTE-3 Comment is empty.");
      else if (s.f[3].length > NTE_MAX) err(`NTE-3 Comment is longer than ${NTE_MAX} characters.`);
      if (s.f[4] !== NTE_COMMENT_TYPE) err(`NTE-4 must be ${NTE_COMMENT_TYPE}.`);
    }
    if (id === "OBR") {
      closeGroup(); grp.cur = s; grp.count = 0;
      const n = s.f[1] ?? "?";
      if (!s.f[2] || !s.f[3]) err(`OBR ${n}: OBR-2 and OBR-3 (business id) are required.`);
      else if (!s.f[2].includes("^^2.16.840.1.113883.3.3731.")) err(`OBR ${n}: the business id needs the National Organization OID.`);
      if (s.f[4] !== `${OBR_PANEL_CODE.code}^${OBR_PANEL_CODE.text}^${OBR_PANEL_CODE.system}`) err(`OBR ${n}: OBR-4 must be 85353-1^Vital Signs Panel^2.16.840.1.113883.6.1.`);
      if (!s.f[7] || !s.f[22]) err(`OBR ${n}: OBR-7 and OBR-22 (time the vitals were taken) are required.`);
      else if (s.f[7] !== s.f[22]) warn(`OBR ${n}: OBR-7 and OBR-22 should be the same time for vital signs.`);
      if (!s.f[16]) warn(`OBR ${n}: OBR-16 (the provider who took the reading) is required if known.`);
      else if (!s.f[16].includes(`&${OID.provider}`)) err(`OBR ${n}: OBR-16 needs the National Provider ID with assigning authority ${OID.provider}.`);
      if (s.f[24] !== OBR_SECTION_ID) err(`OBR ${n}: OBR-24 must be ${OBR_SECTION_ID}.`);
      if (s.f[25] && !["F", "C", "X"].includes(s.f[25])) err(`OBR ${n}: OBR-25 must be F, C or X.`);
    } else if (id === "OBX") {
      grp.count += 1;
      const cur = grp.cur;
      if (!cur) { err("An OBX appears before any OBR."); continue; }
      const code = (s.f[3] ?? "").split("^")[0];
      const n = `OBR ${cur.f[1]} OBX ${s.f[1]}`;
      if (!(code in CODE_UNITS)) err(`${n}: ${code || "no code"} is not in the vital signs value set.`);
      if (!(s.f[3] ?? "").endsWith(`^${LOINC_SYSTEM}`)) err(`${n}: OBX-3 coding system must be ${LOINC_SYSTEM}.`);
      if (s.f[5] === undefined || s.f[5] === "") err(`${n}: OBX-5 value is empty.`);
      else if (s.f[2] === "NM" && Number.isNaN(Number(s.f[5]))) err(`${n}: OBX-5 is not a number.`);
      if (s.f[2] === "NM" && code in CODE_UNITS && (s.f[6] ?? "") !== CODE_UNITS[code]) warn(`${n}: OBX-6 unit should be ${CODE_UNITS[code] || "empty"}.`);
      if (!["F", "C", "D", "W"].includes(s.f[11] ?? "")) err(`${n}: OBX-11 must be F, C, D or W.`);
      if (s.f[2] !== "NM" && s.f[2] !== "ST") err(`${n}: OBX-2 must be NM or ST.`);
      if ((s.f[5] ?? "").length > (s.f[2] === "NM" ? 16 : 199)) err(`${n}: OBX-5 is too long.`);
      const def = VITALS.find((v) => v.loinc === code);
      if (def && s.f[5] && !Number.isNaN(Number(s.f[5])) && (Number(s.f[5]) < def.min || Number(s.f[5]) > def.max)) warn(`${n}: ${def.label} ${s.f[5]} is outside the plausible range ${def.min} to ${def.max}.`);
      if (cur.f[25] === "X" && !["D", "W"].includes(s.f[11] ?? "")) err(`${n}: a cancelled panel (OBR-25 X) needs OBX-11 D or W on every reading.`);
    }
  }
  closeGroup();
  if (out.length === before) ok("The ORU message follows the vital signs interface.");
  return out;
}

/* ---------- sending (simulated) ---------- */

function ackFor(controlId: string, accepted: boolean, firstError?: string): string {
  const msh = `MSH|^~\\&|nphies^${OID.nphiesApp}^ISO||^${OID.nationalOrg}^ISO||${ts(nowLocal())}||ACK^R01^ACK|ACK-${controlId}||2.5.1`;
  return accepted ? `${msh}\rMSA|AA|${controlId}` : `${msh}\rMSA|AE|${controlId}|Message rejected\rERR||OBR|207^Application internal error|E|||||${firstError ?? "Validation failed"}`;
}

function doSend(panels: VitalPanel[], kind: SendRecord["kind"]): SendRecord | null {
  const first = panels[0];
  const c = ctx(first.visit);
  if (!c) return null;
  const s = get();
  const controlId = uuidish(s.seq + panels.length);
  const { segs, message } = buildOru(panels, c.patient, c.enc, controlId);
  const checks = validateOru(segs);
  const errors = checks.filter((x) => x.level === "error");
  const accepted = errors.length === 0 && !s.rejectNext;
  const rec: SendRecord = {
    at: new Date().toISOString(), controlId, kind, version: panels.length === 1 ? first.version : 0, visit: first.visit, message, accepted, errors: errors.length, checks,
    ack: ackFor(controlId, accepted, errors[0]?.text ?? (s.rejectNext ? "Rejected on purpose by the tester" : undefined)),
  };
  audit("send-adt", `ORU R01 ${controlId}`, { patient: `${c.patient.given} ${c.patient.family}`, detail: `${kind}, ${panels.length} panel(s), ${accepted ? "accepted" : "rejected"}` });
  return rec;
}

export function sendPanel(id: string): SendRecord | null {
  const s = get();
  const p = s.panels.find((x) => x.id === id);
  if (!p) return null;
  const kind: SendRecord["kind"] = p.status === "X" ? "cancel" : p.sends.some((x) => x.accepted) ? "amend" : "new";
  const rec = doSend([p], kind);
  if (!rec) return null;
  const now = get();
  commit({ ...now, rejectNext: false, panels: now.panels.map((x) => (x.id === id ? { ...x, sends: [...x.sends, rec] } : x)) });
  return rec;
}

/** Scenario h: send many panels of one visit in a single message (historical data migration). */
export function sendHistorical(visit: string): SendRecord | null {
  const panels = panelsOf(visit).filter((p) => p.status !== "X").reverse();
  if (panels.length < 2) return null;
  const rec = doSend(panels, "batch");
  if (!rec) return null;
  const now = get();
  commit({ ...now, rejectNext: false, batches: [...now.batches, rec] });
  return rec;
}

export const sentOk = (p: VitalPanel) => p.sends.some((x) => x.accepted);
/** True when the newest version of the panel has not been accepted by NPHIES yet. */
export const needsSend = (p: VitalPanel): boolean => {
  const last = p.sends[p.sends.length - 1];
  return !last || !last.accepted || last.version < p.version;
};

/* ---------- claim readiness (CHI) ---------- */

export interface ClaimLine {
  key: (typeof CLAIM_ITEMS)[number]["key"];
  label: string;
  state: "measured" | "absent" | "missing";
  value?: string;
  reason?: string;
}

const ABSENCE_SYSTEM: Record<VitalKey, string> = {
  sbp: "blood-pressure-absence-reason", dbp: "blood-pressure-absence-reason", pulse: "pulse-absence-reason",
  rr: "respiratory-rate-absence-reason", temp: "temperature-absence-reason", spo2: "oxygen-saturation-absence-reason",
  weight: "weight-absence-reason", height: "height-absence-reason",
};

export function claimReadiness(visit: string): { lines: ClaimLine[]; ready: number; total: number } {
  const c = ctx(visit);
  const panels = panelsOf(visit).filter((p) => p.status !== "X");
  const lines: ClaimLine[] = CLAIM_ITEMS.map((it) => {
    if (it.key === "complaint") {
      const has = !!c && (c.enc.complaints.length > 0 || !!c.enc.reason);
      return { key: it.key, label: it.label, state: has ? "measured" : "missing", value: has ? (c!.enc.reason || c!.enc.complaints[0].text) : undefined };
    }
    const k = it.key;
    for (const p of panels) {
      const o = p.obs.find((x) => x.key === k && x.status !== "D" && x.status !== "W");
      if (o?.value !== undefined) return { key: k, label: it.label, state: "measured", value: `${o.value} ${VITAL_BY_KEY[k].display}` };
      if (o?.absence) return { key: k, label: it.label, state: "absent", reason: `${o.absence.label} (${o.absence.code})` };
    }
    return { key: k, label: it.label, state: "missing" };
  });
  const ready = lines.filter((l) => l.state !== "missing").length;
  return { lines, ready, total: lines.length };
}

/** The claim items that have neither a value nor an absence reason. A claim built without them is rejected. */
export function claimVitalsMissing(visit: string): string[] {
  return claimReadiness(visit).lines.filter((l) => l.state === "missing").map((l) => l.label);
}

/**
 * Claim.supportingInfo entries the claim rules ask for: the eight vital signs and the chief complaint.
 * An item with no value and no absence reason cannot be written: check claimVitalsMissing first.
 */
export function claimVitalsJson(visit: string): unknown[] {
  const { lines } = claimReadiness(visit);
  const CATEGORY = "http://nphies.sa/terminology/CodeSystem/claim-information-category";
  return lines
    .filter((l) => l.state !== "missing")
    .map((l, i) => {
      if (l.key === "complaint") {
        return { sequence: i + 1, category: { coding: [{ system: CATEGORY, code: "chief-complaint" }] }, valueString: l.value };
      }
      const d = VITAL_BY_KEY[l.key as VitalKey];
      const panel = panelsOf(visit).filter((p) => p.status !== "X").find((p) => p.obs.some((o) => o.key === d.key && o.status !== "D" && o.status !== "W"));
      const o = panel?.obs.find((x) => x.key === d.key && x.status !== "D" && x.status !== "W");
      const base = {
        sequence: i + 1,
        category: { coding: [{ system: CATEGORY, code: d.claimCategory }] },
      };
      return o?.value !== undefined
        ? { ...base, valueQuantity: { value: o.value, system: "http://unitsofmeasure.org", code: d.claimUnit } }
        : { ...base, reason: { coding: [{ system: `http://nphies.sa/terminology/CodeSystem/${ABSENCE_SYSTEM[d.key]}`, code: o?.absence?.code }] } };
    });
}

/* ---------- scenarios from the ORU guide ---------- */

export interface Scenario { id: string; label: string; done: boolean; hint: string }

export function scenarioCoverage(visit: string, s: State = get()): Scenario[] {
  const ps = panelsOf(visit, s).filter((p) => p.status !== "X");
  const sent = (p: VitalPanel) => sentOk(p);
  const ctxDone = (c: PanelContext, n = 1) => ps.filter((p) => p.context === c && sent(p)).length >= n;
  return [
    { id: "a", label: "ED triage", done: ctxDone("triage"), hint: "Record vitals at triage and send them." },
    { id: "b", label: "Admission", done: ctxDone("admission"), hint: "Record vitals at admission." },
    { id: "c", label: "Routine monitoring", done: ctxDone("routine", 2), hint: "Two routine panels, for example every 4 hours." },
    { id: "d", label: "Before a procedure", done: ctxDone("pre-procedure"), hint: "Pre-procedure vitals." },
    { id: "e", label: "Transfer, before and after", done: ctxDone("transfer", 2), hint: "One panel before and one after the move." },
    { id: "f", label: "Discharge", done: ctxDone("discharge"), hint: "Final vitals before discharge." },
    { id: "g", label: "Correction", done: ps.some((p) => p.status === "C" && p.sends.some((x) => x.kind === "amend" && x.accepted)), hint: "Correct a sent panel, then send it again." },
    { id: "h", label: "Historical migration", done: s.batches.some((b) => b.accepted && b.visit === visit), hint: "Send all panels of a visit in one message." },
  ];
}

/* ---------- triage hook ---------- */

export function recordFromTriage(visit: string, v: { bp: string; pulse: string; temp: string; spo2: string; rr: string }) {
  const num = (x: string) => (x.trim() !== "" && !Number.isNaN(Number(x)) ? Number(x) : undefined);
  const [sys, dia] = v.bp.split("/").map((x) => num(x ?? ""));
  const values: Partial<Record<VitalKey, number>> = {};
  const set = (k: VitalKey, x: number | undefined) => { if (x !== undefined) values[k] = x; };
  set("sbp", sys); set("dbp", dia); set("pulse", num(v.pulse)); set("temp", num(v.temp)); set("spo2", num(v.spo2)); set("rr", num(v.rr));
  if (Object.keys(values).length === 0) return null;
  return savePanel({ visit, context: "triage", values });
}

/* ---------- seed ---------- */

function seedVitals(): State {
  const st: HisState = getState();
  const panels: VitalPanel[] = [];
  let seq = 0;
  const when = (m: number) => {
    const d = new Date(Date.now() - m * 60_000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const mk = (pid: string, minsAgo: number, context: PanelContext, v: Partial<Record<VitalKey, number>>, extra: Partial<VitalPanel> = {}) => {
    const enc = [...st.encounters].reverse().find((e) => e.patientId === pid && e.status !== "cancelled");
    if (!enc) return;
    seq += 1;
    panels.push({
      id: `VP-${seq}`, visit: enc.visitNumber, patientId: pid, businessId: `VSP${String(seq).padStart(6, "0")}`, at: when(minsAgo), context,
      recordedBy: enc.attending, status: "F", version: 1, onOxygen: false, consciousness: "Alert", sends: [],
      obs: (Object.keys(v) as VitalKey[]).map((k) => ({ key: k, value: v[k], status: "F" as const })), ...extra,
    });
  };
  mk("P001", 1600, "admission", { sbp: 128, dbp: 82, pulse: 92, rr: 22, temp: 38.4, spo2: 94, weight: 84, height: 176 });
  mk("P001", 480, "routine", { sbp: 124, dbp: 80, pulse: 88, rr: 20, temp: 37.9, spo2: 95 });
  mk("P001", 90, "routine", { sbp: 120, dbp: 78, pulse: 84, rr: 18, temp: 37.4, spo2: 96 });
  mk("P003", 560, "admission", { sbp: 142, dbp: 90, pulse: 104, rr: 20, temp: 37.0, spo2: 96, weight: 91, height: 172 });
  mk("P003", 300, "routine", { sbp: 150, dbp: 92, pulse: 112, rr: 22, temp: 37.1, spo2: 93 });
  mk("P003", 60, "routine", { sbp: 138, dbp: 86, pulse: 98, rr: 19, temp: 36.9, spo2: 95 });
  mk("P014", 8, "triage", { sbp: 84, dbp: 50, pulse: 128, rr: 28, temp: 36.9, spo2: 89, weight: 88 }, { consciousness: "Alert" });
  mk("P004", 100, "other", { sbp: 118, dbp: 76, pulse: 74, rr: 16, temp: 36.7, spo2: 98, weight: 66, height: 160 });
  return { panels, seq, rejectNext: false, batches: [] };
}

/** Send the first seeded panels so the demo has accepted messages. Called once from the board and chart on first use. */
let seeded = false;
export function ensureSeedSends() {
  if (seeded) return;
  seeded = true;
  const s = get();
  if (s.panels.some((p) => p.sends.length > 0)) return;
  for (const p of s.panels.filter((x) => ["admission"].includes(x.context) && x.patientId === "P001")) sendPanel(p.id);
}

