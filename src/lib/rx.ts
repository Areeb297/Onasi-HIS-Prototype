import { useSyncExternalStore } from "react";
import { audit } from "./audit";
import type { Encounter } from "./model";
import { DRUG_BY_ID } from "./rx-catalogue";
import { calcQuantity, fillState, isControlled, recomputeStatus, type FillState } from "./rx-logic";
import type { DispenseLine, Drug, ItemStatus, Prescription, Reason, RxItem, RxState, SendRecord, UsageSetting } from "./rx-types";
import { getState } from "./store";

/**
 * Own localStorage store for prescriptions, dispenses and the send log.
 * Separate from the ADT store. Every prescription carries the visit number of the encounter.
 */

/** v2: drug, route and specialty codes changed and every sent prescription now holds the reference id from nphies. Older saved data is dropped. */
const KEY = "onasi-emr-rx-v2";
const OLD_KEYS = ["onasi-emr-rx-v1"];
const EMPTY: RxState = { prescriptions: [], dispenses: [], sends: [], heights: {}, counters: { rx: 0, item: 0, disp: 0, ref: 0 } };

let state: RxState = load();
const listeners = new Set<() => void>();

function load(): RxState {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as RxState) };
  } catch {
    /* storage may be blocked */
  }
  return seed();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function setRx(next: RxState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

export function getRx(): RxState {
  return state;
}

export function useRx(): RxState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Clear everything. Pass seed to bring back the demo prescriptions. */
export function resetRx(withSeed = false) {
  setRx(withSeed ? seed() : { ...EMPTY, prescriptions: [], dispenses: [], sends: [], heights: {}, counters: { ...EMPTY.counters } });
}

/* ---------- ids and selectors ---------- */

const pad = (n: number) => String(100000 + n);

export function getDrug(id: string): Drug {
  const d = DRUG_BY_ID[id];
  if (!d) throw new Error(`Unknown drug ${id}`);
  return d;
}

export function rxForVisit(s: RxState, visit: string): Prescription[] {
  return s.prescriptions.filter((p) => p.visitNumber === visit);
}

export function linesFor(s: RxState, rxId: string): DispenseLine[] {
  return s.dispenses.filter((d) => d.rxId === rxId).flatMap((d) => d.lines);
}

export function fillOf(s: RxState, rx: Prescription, item: RxItem): FillState {
  return fillState(item, linesFor(s, rx.id));
}

export function dispensedQty(s: RxState, rx: Prescription, item: RxItem): number {
  return fillOf(s, rx, item).dispensedTotal;
}

/** Items a pharmacist can still dispense: sent, active and not fully dispensed. */
export function openItems(s: RxState, rx: Prescription): RxItem[] {
  if (!rx.sentAt) return [];
  return rx.items.filter((i) => i.status === "active" && !fillOf(s, rx, i).done);
}

/** Everything on the visit that matters for the duplicate check. */
export function activeDrugsOnVisit(s: RxState, visit: string, skipItemId?: string): { drug: Drug; where: string }[] {
  return rxForVisit(s, visit).flatMap((rx) =>
    rx.items
      .filter((i) => i.id !== skipItemId && (i.status === "active" || i.status === "on-hold"))
      .map((i) => ({ drug: getDrug(i.drugId), where: rx.number })),
  );
}

/* ---------- prescribing ---------- */

export interface NewItem {
  drugId: string;
  dose: number;
  frequencyId: string;
  asNeeded: boolean;
  durationDays: number;
  /** Leave empty to calculate. */
  quantity?: number;
  route: string;
  patientInstruction: string;
  fulfillmentNote: string;
  refills: number;
  reason: Reason;
  usage: UsageSetting;
  allergyOverride?: RxItem["allergyOverride"];
}

export function defaultUsage(cls: Encounter["cls"]): UsageSetting {
  return cls === "I" ? "inpatient" : "outpatient";
}

export function quantityFor(drug: Drug, dose: number, frequencyId: string, days: number): number {
  return calcQuantity(dose, frequencyId, days, drug.unit);
}

/** Add an item to the open draft for this visit and class, or start a new prescription. */
export function addDraftItem(enc: Pick<Encounter, "visitNumber" | "patientId" | "attending">, n: NewItem): { rx: Prescription; item: RxItem } {
  const drug = getDrug(n.drugId);
  const controlled = isControlled(drug.controlClass);
  const s = state;
  const counters = { ...s.counters };
  counters.item += 1;
  const manual = n.quantity !== undefined && n.quantity > 0;
  const item: RxItem = {
    id: `ri-${counters.item}-${Date.now().toString(36)}`,
    identifier: `RXI-${pad(counters.item)}`,
    drugId: drug.id,
    dose: n.dose,
    frequencyId: n.frequencyId,
    asNeeded: n.asNeeded,
    durationDays: n.durationDays,
    quantity: manual ? (n.quantity as number) : quantityFor(drug, n.dose, n.frequencyId, n.durationDays),
    quantityManual: manual,
    route: n.route,
    patientInstruction: n.patientInstruction,
    fulfillmentNote: n.fulfillmentNote,
    refills: controlled ? 0 : n.refills,
    reason: n.reason,
    status: "active",
    version: 1,
    allergyOverride: n.allergyOverride,
  };
  let rx = s.prescriptions.find((p) => p.visitNumber === enc.visitNumber && !p.sentAt && p.controlled === controlled && p.usage === n.usage);
  let prescriptions: Prescription[];
  if (rx) {
    const target = rx;
    rx = { ...target, items: [...target.items, item] };
    prescriptions = s.prescriptions.map((p) => (p.id === target.id ? (rx as Prescription) : p));
  } else {
    counters.rx += 1;
    rx = {
      id: `rx-${counters.rx}-${Date.now().toString(36)}`,
      number: `RX-${pad(counters.rx)}`,
      visitNumber: enc.visitNumber,
      patientId: enc.patientId,
      prescriberId: enc.attending,
      authoredAt: new Date().toISOString(),
      usage: n.usage,
      groupId: `RXG-${pad(counters.rx)}`,
      controlled,
      items: [item],
      dirty: true,
    };
    prescriptions = [...s.prescriptions, rx];
  }
  setRx({ ...s, prescriptions, counters });
  audit("create", `Prescription item ${item.identifier}`, { patient: enc.patientId, detail: `Visit ${enc.visitNumber}. ${drug.generic} ${drug.strengthValue} ${drug.strengthUnit}, ${rx.number}` });
  if (n.allergyOverride) {
    audit("create", `Allergy override ${item.identifier}`, {
      patient: enc.patientId,
      detail: `Visit ${enc.visitNumber}. ${drug.generic} against ${n.allergyOverride.allergy}. Reason: ${n.allergyOverride.reason}`,
    });
  }
  return { rx, item };
}

export interface ItemPatch {
  dose?: number;
  frequencyId?: string;
  asNeeded?: boolean;
  durationDays?: number;
  quantity?: number;
  route?: string;
  patientInstruction?: string;
  fulfillmentNote?: string;
  refills?: number;
  reason?: Reason;
  /** Set to false to go back to the calculated quantity. */
  quantityManual?: boolean;
}

/** Change an item. If the prescription was sent, it becomes "changes not sent" and the item version goes up. */
export function updateItem(rxId: string, itemId: string, patch: ItemPatch) {
  const s = state;
  const rx = s.prescriptions.find((p) => p.id === rxId);
  if (!rx) return;
  const items = rx.items.map((i) => {
    if (i.id !== itemId) return i;
    const drug = getDrug(i.drugId);
    const next: RxItem = { ...i, ...patch };
    if (patch.quantity !== undefined) next.quantityManual = true;
    else if (!next.quantityManual) next.quantity = quantityFor(drug, next.dose, next.frequencyId, next.durationDays);
    if (isControlled(drug.controlClass)) next.refills = 0;
    if (rx.sentAt) next.version = i.version + 1;
    return next;
  });
  const updated: Prescription = { ...rx, items, dirty: true };
  setRx({ ...s, prescriptions: s.prescriptions.map((p) => (p.id === rxId ? updated : p)) });
  audit("update", `Prescription item ${rx.number}`, { patient: rx.patientId, detail: `Visit ${rx.visitNumber}. Item edited${rx.sentAt ? ", changes not sent yet" : ""}` });
}

/** Only items that were never sent can be removed. Sent items are cancelled or stopped instead. */
export function removeDraftItem(rxId: string, itemId: string) {
  const s = state;
  const rx = s.prescriptions.find((p) => p.id === rxId);
  if (!rx || rx.sentAt) return;
  const items = rx.items.filter((i) => i.id !== itemId);
  const prescriptions = items.length ? s.prescriptions.map((p) => (p.id === rxId ? { ...rx, items } : p)) : s.prescriptions.filter((p) => p.id !== rxId);
  setRx({ ...s, prescriptions });
  audit("delete", `Prescription draft item ${rx.number}`, { patient: rx.patientId, detail: `Visit ${rx.visitNumber}. Removed before sending` });
}

export function setHeight(visit: string, patientId: string, cm: number) {
  setRx({ ...state, heights: { ...state.heights, [visit]: cm } });
  audit("update", "Body height", { patient: patientId, detail: `Visit ${visit}. ${cm} cm` });
}

/** Recompute active/completed for every item of a prescription after dispenses change. */
export function refreshStatuses(s: RxState, rxId: string): RxState {
  const lines = linesFor(s, rxId);
  return {
    ...s,
    prescriptions: s.prescriptions.map((p) =>
      p.id !== rxId ? p : { ...p, items: p.items.map((i) => ({ ...i, status: recomputeStatus(i, lines) as ItemStatus })) },
    ),
  };
}

export function addSendRecord(s: RxState, rec: SendRecord): RxState {
  return { ...s, sends: [...s.sends, rec].slice(-60) };
}

export function nextCounter(key: keyof RxState["counters"]): number {
  const counters = { ...state.counters, [key]: state.counters[key] + 1 };
  state = { ...state, counters };
  return counters[key];
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function dispenseNumber(n: number): string {
  return `DSP-${pad(n)}`;
}

/* ---------- demo data ---------- */

function seed(): RxState {
  const s: RxState = { prescriptions: [], dispenses: [], sends: [], heights: {}, counters: { rx: 0, item: 0, disp: 0, ref: 0 } };
  try {
    const encs = getState().encounters;
    const find = (pid: string) => encs.find((e) => e.patientId === pid && e.status === "active");
    const mk = (visit: string, patientId: string, doctor: string, usage: UsageSetting, drugId: string, over: Partial<RxItem>, ref: string): void => {
      const drug = DRUG_BY_ID[drugId];
      s.counters.rx += 1;
      s.counters.item += 1;
      const dose = over.dose ?? drug.defaultDose;
      const freq = over.frequencyId ?? drug.defaultFrequency;
      const days = over.durationDays ?? drug.defaultDays;
      const item: RxItem = {
        id: `seed-item-${s.counters.item}`,
        identifier: `RXI-${pad(s.counters.item)}`,
        drugId,
        dose,
        frequencyId: freq,
        asNeeded: false,
        durationDays: days,
        quantity: calcQuantity(dose, freq, days, drug.unit),
        quantityManual: false,
        route: drug.defaultRoute,
        patientInstruction: "",
        fulfillmentNote: "",
        refills: 0,
        reason: { code: "R69", text: "Illness, unspecified" },
        status: "active",
        version: 1,
        ...over,
      };
      s.prescriptions.push({
        id: `seed-rx-${s.counters.rx}`,
        number: `RX-${pad(s.counters.rx)}`,
        visitNumber: visit,
        patientId,
        prescriberId: doctor,
        authoredAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        usage,
        groupId: ref,
        nationalRef: ref,
        raqeebRef: ref.startsWith("RQB") ? ref : undefined,
        controlled: isControlled(drug.controlClass),
        items: [item],
        sentAt: new Date(Date.now() - 35 * 60_000).toISOString(),
        dirty: false,
        lastSend: { at: new Date(Date.now() - 35 * 60_000).toISOString(), http: 201, ok: true },
      });
      s.heights[visit] = s.heights[visit] ?? 168;
    };
    const p2 = find("P002");
    if (p2) mk(p2.visitNumber, "P002", p2.attending, "inpatient", "DRG010", { reason: { code: "E11.9", text: "Type 2 diabetes mellitus without complications" } }, "NRX10007919");
    const p7 = find("P007");
    if (p7) {
      mk(p7.visitNumber, "P007", p7.attending, "outpatient", "DRG001", { reason: { code: "R50.9", text: "Fever, unspecified" } }, "NRX10015838");
      mk(p7.visitNumber, "P007", p7.attending, "outpatient", "DRG033", { reason: { code: "R52", text: "Pain, unspecified" } }, "RQB10023757");
    }
    s.counters.ref = 3;
  } catch {
    /* seed is optional */
  }
  return s;
}
