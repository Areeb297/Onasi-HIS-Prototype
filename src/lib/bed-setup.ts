import { useSyncExternalStore } from "react";
import type { Bed, BedGender, HisState } from "./model";
import { BEDS, BED_BY_ID, WARDS } from "./reference-data";

/**
 * Bed Setup: the bed master. Adds beds, one at a time or several at once, and keeps each bed's room type, bed type,
 * floor, gender restriction, equipment and Active or Inactive.
 * Own localStorage store. A new bed is also added to the reference bed list, so bed labels and PV1-3 know it.
 * The ward, room and bed number cannot change once the bed is saved: messages already sent name the bed.
 */

/** HIS lookups "Room Type" and "Bed Type" (Beds.RoomTypeId, BedTypeId). */
export const ROOM_TYPES = ["General Ward", "Semi-Private Room", "Private Room", "VIP Room", "Intensive Care Unit", "Coronary Care Unit", "Neonatal Intensive Care Unit", "Pediatric Intensive Care Unit", "Isolation Room", "Day Care Room", "Emergency Observation Room", "Recovery Room", "Delivery Room"];
export const BED_TYPES = ["Standard Bed", "Electric Bed", "ICU Bed", "Pediatric Bed", "Neonatal Bed", "Bariatric Bed", "Maternity Bed", "Isolation Bed", "Recovery Bed", "Observation Bed"];
export const BED_GENDERS: BedGender[] = ["Any", "Male", "Female"];
export const GENDER_LABEL: Record<BedGender, string> = { Any: "Any", Male: "Male Only", Female: "Female Only" };

/** The most beds the Multiple Beds mode adds at once. */
export const MAX_BATCH = 20;

/** Every setup field of a bed, filled in. */
export type BedAttrs = Required<Pick<Bed, "floor" | "roomType" | "bedType" | "gender" | "isolation" | "oxygen" | "ventilator" | "monitor" | "active">> & { notes: string };

const FLOOR_OF: Record<string, string> = { "3A": "3", "4B": "4", ICU: "2" };

/** What a bed has before anyone edits it, from its ward. */
export function defaultAttrs(bed: Pick<Bed, "ward">): BedAttrs {
  const icu = bed.ward === "ICU";
  return {
    floor: FLOOR_OF[bed.ward] ?? "1",
    roomType: icu ? "Intensive Care Unit" : "Semi-Private Room",
    bedType: icu ? "ICU Bed" : "Electric Bed",
    gender: "Any",
    isolation: false,
    oxygen: true,
    ventilator: icu,
    monitor: icu,
    active: true,
    notes: "",
  };
}

/* ---------- store ---------- */

interface State {
  /** Saved beds by id: every bed that was added here or edited here. */
  beds: Record<string, Bed & { added?: boolean }>;
}

const KEY = "onasi-his-bed-setup-v1";
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (raw) return { beds: (JSON.parse(raw) as Partial<State>).beds ?? {} };
  } catch {
    /* storage may be blocked */
  }
  return { beds: {} };
}

/** New beds join the reference list, so every screen and message that reads it knows them. */
function syncReference(s: State) {
  for (const b of Object.values(s.beds)) {
    if (!b.added || BED_BY_ID[b.id]) continue;
    const base: Bed = { id: b.id, ward: b.ward, wardName: b.wardName, room: b.room, bed: b.bed };
    BEDS.push(base);
    BED_BY_ID[b.id] = base;
  }
}

function get(): State {
  if (!state) {
    state = load();
    syncReference(state);
  }
  return state;
}

function commit(next: State) {
  state = next;
  syncReference(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useBedSetup(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}
export const getBedSetup = get;
/** Forget every edit and remove the beds added here. */
export function resetBedSetup() {
  for (const b of Object.values(get().beds)) {
    if (!b.added) continue;
    const at = BEDS.findIndex((x) => x.id === b.id);
    if (at >= 0) BEDS.splice(at, 1);
    delete BED_BY_ID[b.id];
  }
  commit({ beds: {} });
}

/** The bed with its setup: the defaults for its ward, then whatever was saved. */
export function withSetup(bed: Bed, s: State = get()): Bed {
  return { ...defaultAttrs(bed), ...bed, ...s.beds[bed.id] };
}

/** Every bed with its setup, in ward order. */
export function allBeds(s: State = get()): Bed[] {
  const order = WARDS.map((w) => w.ward);
  return BEDS.map((b) => withSetup(b, s)).sort((a, b) => order.indexOf(a.ward) - order.indexOf(b.ward));
}

export const isActive = (b: Pick<Bed, "active">): boolean => b.active !== false;

/* ---------- rules ---------- */

export interface BedSetupInput extends BedAttrs {
  mode: "single" | "multiple";
  ward: string;
  room: string;
  /** Single mode. */
  bedNo: string;
  /** Multiple mode: beds are named prefix + number, for example B1, B2, B3. */
  prefix: string;
  start: number;
  count: number;
}

export function blankInput(ward = WARDS[0].ward): BedSetupInput {
  return { mode: "single", ward, room: "", bedNo: "", prefix: "", start: 1, count: 2, ...defaultAttrs({ ward }) };
}

export function inputFromBed(b: Bed): BedSetupInput {
  const f = withSetup(b) as Bed & BedAttrs;
  return {
    ...blankInput(b.ward), mode: "single", ward: b.ward, room: b.room, bedNo: b.bed,
    floor: f.floor, roomType: f.roomType, bedType: f.bedType, gender: f.gender, isolation: f.isolation, oxygen: f.oxygen,
    ventilator: f.ventilator, monitor: f.monitor, active: f.active, notes: f.notes ?? "",
  };
}

const NAME = /^[A-Za-z0-9]+$/;

/** The beds the input would create, as id and bed number. */
export function plannedBeds(i: Pick<BedSetupInput, "mode" | "room" | "bedNo" | "prefix" | "start" | "count">): { id: string; bed: string }[] {
  const room = i.room.trim().toUpperCase();
  if (i.mode === "single") {
    const bed = i.bedNo.trim().toUpperCase();
    return bed ? [{ id: `${room}-${bed}`, bed }] : [];
  }
  const n = Math.min(Math.max(0, Math.floor(i.count)), MAX_BATCH);
  const prefix = i.prefix.trim().toUpperCase();
  return Array.from({ length: n }, (_, k) => {
    const bed = `${prefix}${Math.floor(i.start) + k}`;
    return { id: `${room}-${bed}`, bed };
  });
}

/** Who is in the bed now, if anyone, with the patient's sex. */
function holderOf(state: HisState, bedId: string): { sex: "M" | "F" } | undefined {
  const enc = state.encounters.find(
    (e) => (e.status === "active" && e.bedId === bedId) || (e.status === "discharged" && e.discharge?.bedId === bedId && !e.discharge.leftWardAt),
  );
  const p = enc && state.patients.find((x) => x.id === enc.patientId);
  return p ? { sex: p.sex } : undefined;
}

/** What stops the beds from being saved, one line per problem. `editId` is the bed being edited. */
export function bedSetupProblems(i: BedSetupInput, state: HisState, editId?: string): string[] {
  const out: string[] = [];
  if (editId) {
    const holder = holderOf(state, editId);
    if (holder && !i.active) out.push("A patient is in this bed. Move or discharge the patient before making the bed inactive.");
    if (holder && i.gender !== "Any" && (i.gender === "Male") !== (holder.sex === "M")) out.push(`The patient in this bed is ${holder.sex === "M" ? "male" : "female"}. Keep the gender restriction until the bed is empty.`);
  } else {
    if (!WARDS.some((w) => w.ward === i.ward)) out.push("Pick the ward.");
    if (!i.room.trim()) out.push("Enter the room number.");
    else if (!NAME.test(i.room.trim())) out.push("Use letters and numbers only in the room number.");
    if (i.mode === "single") {
      if (!i.bedNo.trim()) out.push("Enter the bed number.");
      else if (!NAME.test(i.bedNo.trim())) out.push("Use letters and numbers only in the bed number.");
    } else {
      if (!i.prefix.trim()) out.push("Enter the bed prefix.");
      else if (!NAME.test(i.prefix.trim())) out.push("Use letters and numbers only in the bed prefix.");
      if (!Number.isFinite(i.start) || i.start < 1) out.push("The start number must be 1 or more.");
      if (!Number.isFinite(i.count) || i.count < 1 || i.count > MAX_BATCH) out.push(`The number of beds must be between 1 and ${MAX_BATCH}.`);
    }
    const taken = plannedBeds(i).filter((b) => BED_BY_ID[b.id]).map((b) => b.id);
    if (taken.length) out.push(`${taken.length === 1 ? "This bed already exists" : "These beds already exist"}: ${taken.join(", ")}.`);
  }
  if (!i.roomType) out.push("Pick the room type.");
  if (!i.bedType) out.push("Pick the bed type.");
  if (!i.floor.trim()) out.push("Enter the floor.");
  return out;
}

export type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const attrsOf = (i: BedSetupInput): BedAttrs => ({
  floor: i.floor.trim(), roomType: i.roomType, bedType: i.bedType, gender: i.gender, isolation: i.isolation,
  oxygen: i.oxygen, ventilator: i.ventilator, monitor: i.monitor, active: i.active, notes: i.notes.trim(),
});

/** Add the beds, or save the edit of one bed. */
export function saveBeds(i: BedSetupInput, state: HisState, editId?: string): Result<Bed[]> {
  const problems = bedSetupProblems(i, state, editId);
  if (problems.length) return { ok: false, problems };
  const s = get();
  if (editId) {
    const base = BED_BY_ID[editId];
    if (!base) return { ok: false, problems: ["That bed does not exist."] };
    const saved = { ...s.beds[editId], ...base, ...attrsOf(i), added: s.beds[editId]?.added };
    commit({ beds: { ...s.beds, [editId]: saved } });
    return { ok: true, value: [withSetup(base)] };
  }
  const ward = WARDS.find((w) => w.ward === i.ward)!;
  const made = plannedBeds(i).map((p) => ({ id: p.id, ward: ward.ward, wardName: ward.name, room: i.room.trim().toUpperCase(), bed: p.bed, ...attrsOf(i), added: true }));
  commit({ beds: { ...s.beds, ...Object.fromEntries(made.map((b) => [b.id, b])) } });
  return { ok: true, value: made.map((b) => withSetup(BED_BY_ID[b.id])) };
}

/** Equipment and isolation badges, in words. */
export function equipmentOf(b: Bed): string[] {
  return [b.isolation && "Isolation", b.oxygen && "Oxygen", b.ventilator && "Ventilator", b.monitor && "Monitor"].filter(Boolean) as string[];
}
