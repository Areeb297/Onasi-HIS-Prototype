import { FREQ_BY_ID } from "./rx-catalogue";
import type {
  ControlClass, DoseStep, DoseTime, Drug, DispenseLine, DurationUnit, FillType, ItemStatus, Regimen, RxItem, SendRecord, UsageSetting,
} from "./rx-types";

/** Pure rules for quantity, fills, statuses and the conformance checklist. No storage here. */

const EPS = 1e-6;

export const isControlled = (c: ControlClass): boolean => c !== "U";

/** Raqeeb scope: controlled item and an outpatient, discharge or community setting. */
export function isRaqeebScope(controlled: boolean, usage: UsageSetting): boolean {
  return controlled && usage !== "inpatient";
}

function roundUp(x: number, step: number): number {
  const n = Math.ceil(Math.round((x / step) * 1e6) / 1e6);
  return Math.round(n * step * 1e6) / 1e6;
}

/** Quantity to dispense = dose x times per day x days, rounded up. Liquids round up to 0.1. */
export function calcQuantity(dose: number, frequencyId: string, days: number, unit: string): number {
  const perDay = FREQ_BY_ID[frequencyId]?.perDay ?? 1;
  const raw = dose * perDay * days;
  if (!(raw > 0)) return 0;
  return Math.max(unit === "mL" ? 0.1 : 1, roundUp(raw, unit === "mL" ? 0.1 : 1));
}

/** Total daily amount in the strength unit (for example mg). */
export function dailyAmount(drug: Drug, dose: number, frequencyId: string): number {
  return dose * drug.perUnit * (FREQ_BY_ID[frequencyId]?.perDay ?? 1);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/** End of the validity period. Assumption: treatment days for every fill, plus a 7 day grace period. */
export function validityEnd(startDate: string, durationDays: number, refills: number): string {
  return addDays(startDate, Math.max(1, durationDays) * (refills + 1) + 7);
}

/* ---------- duration, start and end dates ---------- */

export const DURATION_UNITS: { id: DurationUnit; label: string; days: number }[] = [
  { id: "d", label: "Days", days: 1 },
  { id: "wk", label: "Weeks", days: 7 },
  { id: "mo", label: "Months", days: 30 },
];
const UNIT_DAYS: Record<DurationUnit, number> = { d: 1, wk: 7, mo: 30 };

/** Days in a duration. A month counts as 30 days. */
export const toDays = (value: number, unit: DurationUnit = "d"): number => Math.max(0, Math.round(value * (UNIT_DAYS[unit] ?? 1)));

/** The duration in the unit asked for, or in days when the days do not divide evenly. */
export function fromDays(days: number, unit: DurationUnit = "d"): { value: number; unit: DurationUnit } {
  const per = UNIT_DAYS[unit] ?? 1;
  return days > 0 && days % per === 0 ? { value: days / per, unit } : { value: days, unit: "d" };
}

/** Last day of treatment. A course that starts on the 1st and runs 5 days ends on the 5th. */
export const endDateFor = (start: string, days: number): string => addDays(start, Math.max(1, Math.round(days)) - 1);

/** Days from start to end, both days counted. Zero when the end is before the start. */
export function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Start and end of an item. Items saved before the start date existed start on the day the prescription was written. */
export function itemDates(item: Pick<RxItem, "startDate" | "durationDays">, authoredAt: string): { start: string; end: string } {
  const start = item.startDate || authoredAt.slice(0, 10);
  return { start, end: endDateFor(start, item.durationDays) };
}

/* ---------- regimens: normal, split and taper ---------- */

export const REGIMENS: { id: Regimen; label: string; help: string }[] = [
  { id: "normal", label: "Normal", help: "One dose and frequency for the whole course." },
  { id: "split", label: "Split", help: "Different doses at set times every day, for example 2 tablets in the morning and 1 at night." },
  { id: "taper", label: "Taper", help: "Phases one after the other, for example 40 mg for 5 days, then 20 mg for 5 days." },
];

export const DOSE_TIMES: { id: DoseTime; label: string }[] = [
  { id: "MORN", label: "Morning" },
  { id: "NOON", label: "Noon" },
  { id: "EVE", label: "Evening" },
  { id: "NIGHT", label: "Night" },
];

/** Regimen of an item. Older items have none and are normal. */
export const regimenOf = (item: Pick<RxItem, "regimen" | "schedule">): Regimen =>
  item.regimen && item.regimen !== "normal" && (item.schedule?.length ?? 0) > 0 ? item.regimen : "normal";

/** The rows of an item. A normal item is one row made of its dose, frequency and duration. */
export function stepsOf(item: Pick<RxItem, "regimen" | "schedule" | "dose" | "frequencyId" | "durationDays">): DoseStep[] {
  return regimenOf(item) === "normal" ? [{ dose: item.dose, frequencyId: item.frequencyId, days: item.durationDays }] : (item.schedule as DoseStep[]);
}

/** Overall course: split rows run side by side (the longest counts), taper phases run one after the other (they add up). */
export function regimenDays(regimen: Regimen, steps: DoseStep[]): number {
  if (!steps.length) return 0;
  if (regimen === "taper") return steps.reduce((n, s) => n + Math.max(0, s.days), 0);
  return Math.max(...steps.map((s) => Math.max(0, s.days)));
}

/** Quantity for all rows together: each row is dose x times per day x days. Rounded up once at the end. */
export function regimenQuantity(regimen: Regimen, steps: DoseStep[], unit: string): number {
  if (regimen === "normal" || steps.length === 0) {
    const s = steps[0];
    return s ? calcQuantity(s.dose, s.frequencyId, s.days, unit) : 0;
  }
  const raw = steps.reduce((n, s) => n + s.dose * (FREQ_BY_ID[s.frequencyId]?.perDay ?? 1) * s.days, 0);
  if (!(raw > 0)) return 0;
  const step = unit === "mL" ? 0.1 : 1;
  return Math.max(step, roundUp(raw, step));
}

/** Highest amount in the strength unit taken on any one day. Split rows add up; taper phases do not overlap. */
export function regimenDailyAmount(drug: Drug, regimen: Regimen, steps: DoseStep[]): number {
  const each = steps.map((s) => dailyAmount(drug, s.dose, s.frequencyId));
  if (!each.length) return 0;
  return regimen === "split" ? each.reduce((a, b) => a + b, 0) : Math.max(...each);
}

/** Start and end date of every row. Split rows all start on the first day; taper phases start the day after the last one ended. */
export function stepDates(regimen: Regimen, steps: DoseStep[], start: string): { start: string; end: string }[] {
  let from = start;
  return steps.map((s) => {
    const span = { start: regimen === "taper" ? from : start, end: endDateFor(regimen === "taper" ? from : start, s.days) };
    if (regimen === "taper") from = addDays(span.end, 1);
    return span;
  });
}

/** Problems with the rows of a split or taper regimen. Empty when fine. */
export function regimenProblems(regimen: Regimen, steps: DoseStep[]): string[] {
  if (regimen === "normal") return [];
  const out: string[] = [];
  const name = regimen === "split" ? "A split regimen" : "A taper regimen";
  if (steps.length < 2) out.push(`${name} needs two or more rows.`);
  steps.forEach((s, i) => {
    if (!(s.dose > 0)) out.push(`Row ${i + 1}: enter a dose above zero.`);
    if (!(s.days > 0) || !Number.isInteger(s.days)) out.push(`Row ${i + 1}: enter the number of days as a whole number above zero.`);
    if (!FREQ_BY_ID[s.frequencyId]) out.push(`Row ${i + 1}: choose a frequency.`);
  });
  if (regimen === "split") {
    const times = steps.map((s) => s.time).filter(Boolean);
    if (new Set(times).size !== times.length) out.push("Two split rows have the same time of day. Use one row per time.");
  }
  return out;
}

/* ---------- patient's own medicine ---------- */

/** A prescription that only records medicine the patient brought. It is never sent to nphies and never dispensed. */
export const isPatientOwn = (rx: { items: Pick<RxItem, "patientProvided">[] }): boolean => rx.items.length > 0 && rx.items.every((i) => !!i.patientProvided);

/* ---------- fills ---------- */

export interface FillState {
  totalFills: number;
  completedFills: number;
  /** Quantity already dispensed in the fill that is open. */
  inFill: number;
  /** Quantity still to dispense in the open fill. Zero when the item is done. */
  remaining: number;
  /** Total quantity dispensed in completed lines. */
  dispensedTotal: number;
  done: boolean;
}

/** Works out where an item stands. Only completed lines count. A cancelled line gives its quantity back. */
export function fillState(item: Pick<RxItem, "id" | "quantity" | "refills">, lines: DispenseLine[]): FillState {
  const totalFills = item.refills + 1;
  let completedFills = 0;
  let inFill = 0;
  let dispensedTotal = 0;
  for (const l of lines) {
    if (l.itemId !== item.id || l.status !== "completed") continue;
    dispensedTotal += l.quantity;
    inFill += l.quantity;
    if (inFill >= item.quantity - EPS) {
      completedFills += 1;
      inFill = 0;
    }
  }
  const done = completedFills >= totalFills;
  return { totalFills, completedFills, inFill, remaining: done ? 0 : Math.max(0, item.quantity - inFill), dispensedTotal, done };
}

/**
 * FF full first fill, FFP part of the first fill, FFC the dispense that completes a first fill after parts.
 * RF, RFP and RFC are the same for refills.
 */
export function classifyDispense(state: FillState, qty: number): FillType {
  const refill = state.completedFills > 0;
  const completes = qty >= state.remaining - EPS;
  if (!completes) return refill ? "RFP" : "FFP";
  if (state.inFill === 0) return refill ? "RF" : "FF";
  return refill ? "RFC" : "FFC";
}

export function refillsRemainingAfter(item: Pick<RxItem, "refills">, state: FillState): number {
  return Math.max(0, item.refills - state.completedFills);
}

/** Active becomes completed when every fill is dispensed, and back to active when a dispense is cancelled. */
export function recomputeStatus(item: RxItem, lines: DispenseLine[]): ItemStatus {
  if (item.status !== "active" && item.status !== "completed") return item.status;
  return fillState(item, lines).done ? "completed" : "active";
}

export function validateDispenseQty(state: FillState, qty: number): string | null {
  if (!(qty > 0)) return "Enter a quantity above zero.";
  if (state.done) return "This item is fully dispensed.";
  if (qty > state.remaining + EPS) return `Only ${state.remaining} is left to dispense.`;
  return null;
}

/* ---------- conformance checklist ---------- */

export interface StepDef {
  id: string;
  group: "7.1" | "7.2" | "7.3" | "7.4" | "7.5";
  /** Step numbers on the Seha conformance sheet. */
  nums: string;
  label: string;
}

export const GROUPS: { id: StepDef["group"]; label: string; area: "prescribe" | "dispense" }[] = [
  { id: "7.1", label: "Uncontrolled prescription", area: "prescribe" },
  { id: "7.2", label: "Narcotic, controlled or restricted prescription", area: "prescribe" },
  { id: "7.3", label: "Dispense, uncontrolled", area: "dispense" },
  { id: "7.4", label: "Dispense, narcotic, controlled or restricted", area: "dispense" },
  { id: "7.5", label: "Dispense, multiple items", area: "dispense" },
];

export const STEPS: StepDef[] = [
  { id: "7.1.create", group: "7.1", nums: "7.1.1 to 7.1.2", label: "Create prescription" },
  { id: "7.1.cancel", group: "7.1", nums: "7.1.4 to 7.1.5", label: "Cancel prescription" },
  { id: "7.1.hold", group: "7.1", nums: "7.1.6 to 7.1.7", label: "Suspend (on-hold)" },
  { id: "7.1.stop", group: "7.1", nums: "7.1.8 to 7.1.9", label: "Stopped (after a partial dispense)" },
  { id: "7.2.create", group: "7.2", nums: "7.2.1 to 7.2.2", label: "Create, Raqeeb reference id returned" },
  { id: "7.2.cancel-active", group: "7.2", nums: "7.2.4 to 7.2.5", label: "Cancel active item" },
  { id: "7.2.cancel-completed", group: "7.2", nums: "7.2.5 to 7.2.6", label: "Cancel completed item (cancel the dispense first)" },
  { id: "7.2.stop", group: "7.2", nums: "7.2.7 to 7.2.8", label: "Stopped (after a partial dispense)" },
  { id: "7.2.update", group: "7.2", nums: "7.2.9 to 7.2.10", label: "Update with Raqeeb reference id" },
  { id: "7.3.ff", group: "7.3", nums: "7.3.1 to 7.3.2", label: "Full dispense (FF)" },
  { id: "7.3.ffp", group: "7.3", nums: "7.3.4 to 7.3.5", label: "Partial dispense (FFP)" },
  { id: "7.3.ffc", group: "7.3", nums: "7.3.7 to 7.3.8", label: "Complete after partial (FFC)" },
  { id: "7.4.ff", group: "7.4", nums: "7.4.1 to 7.4.2", label: "Full dispense (FF)" },
  { id: "7.4.ffp", group: "7.4", nums: "7.4.4 to 7.4.5", label: "Partial dispense (FFP)" },
  { id: "7.4.ffc", group: "7.4", nums: "7.4.7 to 7.4.8", label: "Complete after partial (FFC)" },
  { id: "7.4.cancel", group: "7.4", nums: "7.4.10 to 7.4.11", label: "Cancel completed dispense" },
  { id: "7.4.update", group: "7.4", nums: "7.4.12 to 7.4.13", label: "Update dispense" },
  { id: "7.5.multi", group: "7.5", nums: "7.5.1 to 7.5.2", label: "Dispense multiple items" },
];

export type PrescriptionAction = "create" | "update" | "cancel" | "hold" | "resume" | "stop";

export function prescriptionSteps(action: PrescriptionAction, controlled: boolean, statusBefore: ItemStatus): string[] {
  const g = controlled ? "7.2" : "7.1";
  switch (action) {
    case "create": return [`${g}.create`];
    case "cancel": return [controlled ? (statusBefore === "completed" ? "7.2.cancel-completed" : "7.2.cancel-active") : "7.1.cancel"];
    case "hold": return controlled ? [] : ["7.1.hold"];
    case "stop": return [`${g}.stop`];
    case "update": return controlled ? ["7.2.update"] : [];
    default: return [];
  }
}

export type DispenseAction = "dispense" | "cancel" | "update";

export function dispenseSteps(action: DispenseAction, controlled: boolean, types: FillType[]): string[] {
  const g = controlled ? "7.4" : "7.3";
  const out: string[] = [];
  // Uncontrolled dispenses can be cancelled and updated too, but the Seha sheet has steps only for the controlled ones.
  if (action === "cancel") return controlled ? ["7.4.cancel"] : [];
  if (action === "update") return controlled ? ["7.4.update"] : [];
  const t = types[0];
  if (t === "FF") out.push(`${g}.ff`);
  else if (t === "FFP") out.push(`${g}.ffp`);
  else if (t === "FFC") out.push(`${g}.ffc`);
  if (types.length > 1) out.push("7.5.multi");
  return out;
}

export type StepStatus = "not-started" | "done" | "failed";

export function stepStatus(sends: SendRecord[], id: string): StepStatus {
  const mine = sends.filter((s) => s.steps.includes(id));
  if (mine.some((s) => s.ok)) return "done";
  return mine.length ? "failed" : "not-started";
}
