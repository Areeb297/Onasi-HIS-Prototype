import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import type { Encounter } from "./model";
import { getRx, rxForVisit } from "./rx";
import { DRUG_BY_ID, FREQ_BY_ID, ROUTE_LABEL, drugLabel } from "./rx-catalogue";
import type { Drug, ItemStatus, RxItem, RxState } from "./rx-types";
import { currentUser, roleOf } from "./session";
import { getState } from "./store";

/**
 * Medication chart (eMAR) for inpatients and emergency patients.
 * The doses due are worked out from the visit's sent prescriptions. Nothing is stored for a dose until a nurse
 * records it as given, held, refused or missed. A dose is never saved as given by default.
 * Own localStorage store. It only reads prescriptions; it never changes them.
 */

const MIN = 60_000;
const DAY = 86_400_000;

/** A dose more than this many minutes early or late needs a reason. The same window decides "due" and "overdue". */
export const DOSE_WINDOW_MIN = 60;

export type DoseOutcome = "given" | "held" | "refused" | "missed";
export type DoseState = DoseOutcome | "scheduled" | "due" | "overdue";
export type ScheduleKind = "regular" | "prn" | "stat";

export const OUTCOME_LABEL: Record<DoseOutcome, string> = { given: "Given", held: "Held", refused: "Refused", missed: "Missed" };
export const STATE_LABEL: Record<DoseState, string> = { ...OUTCOME_LABEL, scheduled: "Scheduled", due: "Due", overdue: "Overdue" };

export const HELD_REASONS = ["Nil by mouth", "Vital signs out of range", "Lab result out of range", "Doctor's instruction", "Patient away from the ward", "No IV access", "Other"];
export const REFUSED_REASONS = ["Patient refused", "Family or guardian refused", "Patient feels sick", "Other"];
export const MISSED_REASONS = ["Medicine not available", "Patient away from the ward", "Patient asleep", "Dose not given in time", "Other"];
export const TIMING_REASONS = ["Patient away for a test or procedure", "Medicine came late from the pharmacy", "Patient asleep", "Doctor asked for a different time", "Nurse busy with an emergency", "Other"];
export const PRN_REASONS = ["Pain", "Fever", "Nausea or vomiting", "Anxiety or agitation", "Shortness of breath", "Cannot sleep", "High blood sugar", "Other"];
export const REASONS_FOR: Record<Exclude<DoseOutcome, "given">, string[]> = { held: HELD_REASONS, refused: REFUSED_REASONS, missed: MISSED_REASONS };

export const RIGHTS = ["patient", "drug", "dose", "route", "time"] as const;
export type Right = (typeof RIGHTS)[number];

/* ---------- high-alert drugs ---------- */

/** A short list. A real hospital keeps its own high-alert list (ISMP) in the pharmacy formulary. */
const HIGH_ALERT: { label: string; test: RegExp }[] = [
  { label: "Insulin", test: /insulin/i },
  { label: "Heparin", test: /heparin|enoxaparin/i },
  { label: "Opioid", test: /opioid|morphine|fentanyl|tramadol|codeine|oxycodone|pethidine/i },
  { label: "Potassium", test: /potassium/i },
];

/** The high-alert group of a drug, or null. High-alert doses need a second nurse. */
export function highAlertOf(drug: Pick<Drug, "generic" | "therapeuticClass">): string | null {
  const text = `${drug.generic} ${drug.therapeuticClass}`;
  return HIGH_ALERT.find((h) => h.test.test(text))?.label ?? null;
}

/* ---------- orders on the chart ---------- */

/** One prescription item as the medication chart sees it. */
export interface MarOrder {
  itemId: string;
  rxId: string;
  rxNumber: string;
  drug: Drug;
  drugText: string;
  doseText: string;
  routeText: string;
  frequencyId: string;
  frequencyText: string;
  kind: ScheduleKind;
  status: ItemStatus;
  /** False for a stopped, cancelled or on-hold item: no further doses. */
  live: boolean;
  highAlert: string | null;
  /** First and last moment a dose can fall due (ms). */
  start: number;
  end: number;
  /** As-needed drugs: the shortest gap between doses, from the frequency. */
  minGapMinutes?: number;
  instruction: string;
}

const ms = (s: string | undefined): number => (s ? new Date(s).getTime() : 0);
const iso = (t: number): string => new Date(t).toISOString();

export function scheduleKind(item: Pick<RxItem, "asNeeded" | "frequencyId">): ScheduleKind {
  if (item.asNeeded || /^prn$/i.test(item.frequencyId)) return "prn";
  if (/^(stat|once|now)$/i.test(item.frequencyId)) return "stat";
  return "regular";
}

/** The medication chart is for admitted and emergency patients. Outpatients take their medicines home. */
export const emarApplies = (enc: Pick<Encounter, "cls">): boolean => enc.cls === "I" || enc.cls === "E";

export function marOrders(enc: Encounter, rx: RxState = getRx()): MarOrder[] {
  const out: MarOrder[] = [];
  const discharged = enc.status === "discharged" && enc.dischargeAt ? ms(enc.dischargeAt) : 0;
  for (const p of rxForVisit(rx, enc.visitNumber)) {
    // A draft is not an order yet. Take-home prescriptions are not given on the ward.
    if (!p.sentAt || p.usage === "discharge" || p.usage === "community") continue;
    for (const item of p.items) {
      const drug = DRUG_BY_ID[item.drugId];
      if (!drug) continue;
      const kind = scheduleKind(item);
      const freq = FREQ_BY_ID[item.frequencyId];
      const start = ms(p.sentAt);
      let end = start + Math.max(1, item.durationDays || 1) * DAY;
      if (discharged) end = Math.min(end, discharged);
      out.push({
        itemId: item.id, rxId: p.id, rxNumber: p.number, drug, drugText: drugLabel(drug),
        doseText: `${item.dose} ${drug.unit}`, routeText: ROUTE_LABEL[item.route] ?? item.route,
        frequencyId: item.frequencyId,
        frequencyText: kind === "stat" ? "Stat (once, now)" : kind === "prn" ? `As needed${freq ? `, up to ${freq.label.toLowerCase()}` : ""}` : freq?.label ?? item.frequencyId,
        kind, status: item.status, live: item.status === "active" || item.status === "completed",
        highAlert: highAlertOf(drug), start, end,
        minGapMinutes: kind === "prn" && freq && freq.perDay > 0 ? Math.round(1440 / freq.perDay) : undefined,
        instruction: item.patientInstruction,
      });
    }
  }
  return out;
}

/* ---------- dose times ---------- */

/** Usual ward round times (hour of the day). A hospital sets its own. */
const WARD_HOURS: Record<string, number[]> = {
  OD: [8], BID: [8, 20], TID: [8, 14, 20], QID: [8, 12, 16, 20],
  Q6H: [0, 6, 12, 18], Q8H: [6, 14, 22], Q12H: [8, 20], QHS: [22],
};

function hoursFor(frequencyId: string): number[] {
  const known = WARD_HOURS[frequencyId];
  if (known) return known;
  const f = FREQ_BY_ID[frequencyId];
  if (f?.periodUnit === "h" && f.period > 0) {
    const out: number[] = [];
    for (let h = 6; h < 30; h += f.period) out.push(h % 24);
    return [...new Set(out)].sort((a, b) => a - b);
  }
  const n = f ? Math.round(f.perDay) : 1;
  if (n <= 1) return [8];
  return Array.from({ length: n }, (_, i) => 8 + Math.round((i * 12) / (n - 1)));
}

/** The times a dose falls due between two moments (ms). As-needed drugs have none. */
export function slotTimes(o: Pick<MarOrder, "kind" | "start" | "end" | "frequencyId">, from: number, to: number): number[] {
  if (o.kind === "prn") return [];
  if (o.kind === "stat") return o.start >= from && o.start <= to ? [o.start] : [];
  const lo = Math.max(from, o.start);
  const hi = Math.min(to, o.end - 1);
  if (hi < lo) return [];
  const out: number[] = [];
  if (FREQ_BY_ID[o.frequencyId]?.periodUnit === "wk") {
    const t = new Date(o.start);
    t.setHours(8, 0, 0, 0);
    if (t.getTime() < o.start) t.setDate(t.getDate() + 1);
    for (; t.getTime() <= hi; t.setDate(t.getDate() + 7)) if (t.getTime() >= lo) out.push(t.getTime());
    return out;
  }
  const hours = hoursFor(o.frequencyId);
  const day = new Date(lo);
  day.setHours(0, 0, 0, 0);
  for (; day.getTime() <= hi; day.setDate(day.getDate() + 1)) {
    for (const h of hours) {
      const t = new Date(day);
      t.setHours(h, 0, 0, 0);
      if (t.getTime() >= lo && t.getTime() <= hi) out.push(t.getTime());
    }
  }
  return out;
}

/** Where an unrecorded dose stands. It becomes overdue; it is never marked given or missed by the clock. */
export function pendingState(dueAt: number, now: number): "scheduled" | "due" | "overdue" {
  if (now > dueAt + DOSE_WINDOW_MIN * MIN) return "overdue";
  return now >= dueAt - DOSE_WINDOW_MIN * MIN ? "due" : "scheduled";
}

/* ---------- store ---------- */

export interface AdminRecord {
  id: string;
  visit: string;
  patientId: string;
  itemId: string;
  rxId: string;
  /** ISO time the dose was due. Empty for an as-needed dose. */
  slot?: string;
  /** Kept as text so the history still reads right if the prescription changes later. */
  drugText: string;
  doseText: string;
  routeText: string;
  outcome: DoseOutcome;
  /** ISO time the dose was given, or the time the outcome was recorded. */
  at: string;
  /** Minutes early (negative) or late against the due time. */
  offMinutes?: number;
  by: string;
  byRole: string;
  /** Why it was held, refused or missed. */
  reason?: string;
  note?: string;
  /** Why it was more than 60 minutes early or late. */
  timingReason?: string;
  /** Second nurse for a high-alert drug. */
  witness?: { name: string; staffNo: string };
  highAlert?: string;
  /** As-needed dose: why it was given. */
  prnReason?: string;
  /** As-needed dose: how the patient responded. */
  effect?: { text: string; at: string; by: string };
  /** Entered in error. The record stays in the history and the dose opens again. */
  voided?: { at: string; by: string; reason: string };
}

interface State {
  records: AdminRecord[];
  seq: number;
}

const KEY = "onasi-emr-emar-v1";
const EMPTY: State = { records: [], seq: 0 };
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as State) };
  } catch {
    /* storage may be blocked */
  }
  return EMPTY;
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

export function useEmar(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}
export const getEmar = get;
export const resetEmar = () => commit({ records: [], seq: 0 });

/** Every record of the visit, newest first. Includes the ones entered in error. */
export const recordsOf = (visit: string, s: State = get()): AdminRecord[] =>
  s.records.filter((r) => r.visit === visit).sort((a, b) => b.at.localeCompare(a.at));

/* ---------- doses ---------- */

export interface DoseSlot {
  id: string;
  order: MarOrder;
  /** When the dose is due (ms). Null for an as-needed dose. */
  dueAt: number | null;
  /** Due time, or the time given for an as-needed dose. Used for sorting and for the grid. */
  time: number;
  record?: AdminRecord;
  state: DoseState;
}

/**
 * Doses of the visit between two moments: the ones due from the prescriptions plus the as-needed doses that were given.
 * A stopped, cancelled or on-hold prescription keeps its recorded doses and shows no others.
 */
export function dosesBetween(enc: Encounter, from: number, to: number, now: number = Date.now(), s: State = get(), rx: RxState = getRx()): DoseSlot[] {
  const out: DoseSlot[] = [];
  const recs = s.records.filter((r) => r.visit === enc.visitNumber && !r.voided);
  for (const o of marOrders(enc, rx)) {
    const mine = recs.filter((r) => r.itemId === o.itemId);
    const bySlot = new Map(mine.filter((r) => r.slot).map((r) => [r.slot as string, r]));
    const seen = new Set<string>();
    for (const t of slotTimes(o, from, to)) {
      const key = iso(t);
      const record = bySlot.get(key);
      seen.add(key);
      if (!record && !o.live) continue;
      out.push({ id: `${o.itemId}|${key}`, order: o, dueAt: t, time: t, record, state: record ? record.outcome : pendingState(t, now) });
    }
    for (const r of mine) {
      // A dose recorded against a time the schedule no longer has (the prescription changed), or an as-needed dose.
      if (r.slot && seen.has(r.slot)) continue;
      const t = ms(r.slot ?? r.at);
      if (t < from || t > to) continue;
      out.push({ id: r.id, order: o, dueAt: r.slot ? t : null, time: t, record: r, state: r.outcome });
    }
  }
  return out.sort((a, b) => a.time - b.time || a.order.drugText.localeCompare(b.order.drugText));
}

/** Doses more than 60 minutes late with nothing recorded. */
export function overdueDoses(enc: Encounter, now: number = Date.now(), s: State = get(), rx: RxState = getRx()): DoseSlot[] {
  if (!emarApplies(enc)) return [];
  return dosesBetween(enc, 0, now, now, s, rx).filter((d) => d.state === "overdue");
}

/** The last time an as-needed drug was given, for the "at least N hours apart" hint. */
export function lastGiven(visit: string, itemId: string, s: State = get()): AdminRecord | undefined {
  return recordsOf(visit, s).find((r) => r.itemId === itemId && r.outcome === "given" && !r.voided);
}

/* ---------- recording ---------- */

export interface AdminInput {
  visit: string;
  itemId: string;
  /** Due time (ms). Leave out for an as-needed dose. */
  slot?: number;
  outcome: DoseOutcome;
  /** Time the dose was given (ms). Now when left out. */
  at?: number;
  rights?: Partial<Record<Right, boolean>>;
  reason?: string;
  note?: string;
  timingReason?: string;
  witness?: { name: string; staffNo: string };
  prnReason?: string;
}

const NAME_NOISE = new Set(["dr", "rn", "md", "pharmd", "mlt", "nurse"]);
const nameKey = (s: string) => s.toLowerCase().split(/[^a-z؀-ۿ]+/).filter((w) => w && !NAME_NOISE.has(w)).join(" ");

/** True when the second nurse is the person who is signed in. */
export function samePerson(witness: { name: string; staffNo: string }, who: { id: string; name: string }): boolean {
  return witness.staffNo.trim().toLowerCase() === who.id.toLowerCase() || (nameKey(witness.name) !== "" && nameKey(witness.name) === nameKey(who.name));
}

/** Everything that stops a dose from being recorded. An empty list means it can be saved. */
export function checkAdmin(input: AdminInput, order: MarOrder | undefined, who: { id: string; name: string }, now: number, existing: AdminRecord[] = []): string[] {
  if (!order) return ["This medicine is not on the medication chart of this visit."];
  const errors: string[] = [];
  if (!order.live) errors.push(`This prescription is ${order.status === "on-hold" ? "on hold" : order.status}. No more doses can be recorded.`);
  if (order.kind === "prn") {
    if (input.slot !== undefined) errors.push("An as-needed medicine has no set dose time.");
    if (input.outcome !== "given") errors.push("An as-needed dose is recorded only when it is given.");
  } else if (input.slot === undefined) {
    errors.push("Choose the dose time you are recording.");
  } else {
    if (slotTimes(order, input.slot, input.slot).length === 0) errors.push("This time is not a dose time for this medicine.");
    if (existing.some((r) => !r.voided && r.itemId === input.itemId && r.slot === iso(input.slot as number))) errors.push("This dose is already recorded.");
  }
  if (input.outcome === "given") {
    const at = input.at ?? now;
    const unticked = RIGHTS.filter((r) => !input.rights?.[r]);
    if (unticked.length) errors.push(`Confirm the five rights. Not confirmed: ${unticked.join(", ")}.`);
    if (at > now + MIN) errors.push("The time given cannot be in the future.");
    if (input.slot !== undefined && Math.abs(at - input.slot) > DOSE_WINDOW_MIN * MIN && !input.timingReason?.trim()) {
      errors.push(`This dose is more than ${DOSE_WINDOW_MIN} minutes ${at < input.slot ? "early" : "late"}. Choose a reason.`);
    }
    if (order.highAlert) {
      const w = input.witness;
      if (!w?.name.trim() || !w.staffNo.trim()) errors.push(`${order.highAlert} is a high-alert medicine. Enter the second nurse's name and staff number.`);
      else if (samePerson(w, who)) errors.push("The second nurse must be a different person.");
    }
    if (order.kind === "prn" && !input.prnReason?.trim()) errors.push("Choose why the as-needed dose is given.");
  } else {
    if (!input.reason?.trim()) errors.push(`Choose why the dose was ${OUTCOME_LABEL[input.outcome].toLowerCase()}.`);
    else if (input.reason === "Other" && !input.note?.trim()) errors.push("Write the reason in the note.");
  }
  if ((input.timingReason === "Other" || input.prnReason === "Other") && !input.note?.trim() && input.outcome === "given") errors.push("Write the reason in the note.");
  return errors;
}

function signedIn(): { id: string; name: string; role: string } {
  try {
    const u = currentUser();
    return { id: u.id, name: u.name, role: roleOf(u).label };
  } catch {
    return { id: "", name: "Unknown", role: "None" };
  }
}

export type RecordResult = { ok: true; record: AdminRecord } | { ok: false; errors: string[] };

export function recordDose(input: AdminInput, now: number = Date.now()): RecordResult {
  const enc = getState().encounters.find((e) => e.visitNumber === input.visit);
  if (!enc) return { ok: false, errors: ["This visit was not found."] };
  if (!emarApplies(enc)) return { ok: false, errors: ["The medication chart is for inpatients and emergency patients."] };
  const order = marOrders(enc).find((o) => o.itemId === input.itemId);
  const who = signedIn();
  const s = get();
  const errors = checkAdmin(input, order, who, now, s.records);
  if (errors.length || !order) return { ok: false, errors };
  const given = input.outcome === "given";
  const at = given ? input.at ?? now : now;
  const seq = s.seq + 1;
  const record: AdminRecord = {
    id: `MA-${seq}`, visit: enc.visitNumber, patientId: enc.patientId, itemId: order.itemId, rxId: order.rxId,
    slot: input.slot !== undefined ? iso(input.slot) : undefined,
    drugText: order.drugText, doseText: order.doseText, routeText: order.routeText,
    outcome: input.outcome, at: iso(at),
    offMinutes: given && input.slot !== undefined ? Math.round((at - input.slot) / MIN) : undefined,
    by: who.name, byRole: who.role,
    reason: given ? undefined : input.reason?.trim(),
    note: input.note?.trim() || undefined,
    timingReason: given ? input.timingReason?.trim() || undefined : undefined,
    witness: given && order.highAlert && input.witness ? { name: input.witness.name.trim(), staffNo: input.witness.staffNo.trim() } : undefined,
    highAlert: order.highAlert ?? undefined,
    prnReason: given && order.kind === "prn" ? input.prnReason?.trim() : undefined,
  };
  commit({ seq, records: [...s.records, record] });
  audit("create", `Medicine dose ${record.id}`, {
    patient: enc.patientId,
    detail: `Visit ${enc.visitNumber}. ${order.drugText}, ${OUTCOME_LABEL[input.outcome].toLowerCase()}${record.reason ? `: ${record.reason}` : ""}${record.witness ? `. Second nurse ${record.witness.name} (${record.witness.staffNo})` : ""}`,
  });
  return { ok: true, record };
}

/** As-needed dose: how the patient responded. */
export function addEffectNote(recordId: string, text: string): boolean {
  const s = get();
  const r = s.records.find((x) => x.id === recordId);
  if (!r || r.voided || r.outcome !== "given" || !text.trim()) return false;
  const who = signedIn();
  commit({ ...s, records: s.records.map((x) => (x.id === recordId ? { ...x, effect: { text: text.trim(), at: new Date().toISOString(), by: who.name } } : x)) });
  audit("update", `Medicine dose ${recordId}`, { patient: r.patientId, detail: `Visit ${r.visit}. Effect noted for ${r.drugText}` });
  return true;
}

/** Entered in error: the record stays in the history, struck out, and the dose can be recorded again. */
export function voidRecord(recordId: string, reason: string): boolean {
  const s = get();
  const r = s.records.find((x) => x.id === recordId);
  if (!r || r.voided || !reason.trim()) return false;
  const who = signedIn();
  commit({ ...s, records: s.records.map((x) => (x.id === recordId ? { ...x, voided: { at: new Date().toISOString(), by: who.name, reason: reason.trim() } } : x)) });
  audit("update", `Medicine dose ${recordId}`, { patient: r.patientId, detail: `Visit ${r.visit}. Entered in error: ${reason.trim()}` });
  return true;
}
