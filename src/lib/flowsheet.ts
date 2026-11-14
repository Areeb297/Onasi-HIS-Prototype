import type { FieldDef, FieldOption, FormDef, FormRecord, ScoreBand } from "./schema";

/**
 * Pure helpers for nursing flowsheets and scored forms: totals, risk bands, shifts, age groups and the fluid balance.
 * No storage and no React here, so every rule can be tested on its own.
 */

type Values = FormRecord["values"];

const optValue = (o: string | FieldOption) => (typeof o === "string" ? o : o.value);
const optScore = (o: string | FieldOption) => (typeof o === "string" ? 0 : (o.score ?? 0));

const isScored = (f: FieldDef): boolean =>
  f.type === "scale" || ((f.type === "radio" || f.type === "select") && !!f.options?.some((o) => typeof o !== "string" && o.score !== undefined));

/** Sum of the scores of every scale, radio and select field that has scored options. */
export function scoreOf(form: FormDef, v: Values): number {
  let total = 0;
  for (const f of form.fields) {
    const val = v[f.key];
    if (f.type === "scale" && typeof val === "number") total += val;
    if ((f.type === "radio" || f.type === "select") && typeof val === "string") {
      const o = f.options?.find((x) => optValue(x) === val);
      if (o) total += optScore(o);
    }
  }
  return total;
}

export const hasScores = (form: FormDef): boolean => form.fields.some(isScored);

export const bandOf = (bands: ScoreBand[] | undefined, total: number): ScoreBand | undefined => bands?.find((b) => total >= b.min && total <= b.max);

export interface ScoreSummary {
  total: number;
  /** Scored items that have an answer, and how many there are. */
  answered: number;
  items: number;
  /** False when the form needs every item and some are empty. The total must not be used then. */
  complete: boolean;
  band?: ScoreBand;
  /** Labels of the scored items that still need an answer. */
  missing: string[];
}

/** The total, whether it can be trusted, and the named risk band. */
export function scoreSummary(form: FormDef, v: Values): ScoreSummary {
  const scored = form.fields.filter(isScored);
  const missing = scored.filter((f) => v[f.key] === undefined || v[f.key] === "").map((f) => f.label);
  const total = scoreOf(form, v);
  const complete = form.scoreAll ? missing.length === 0 : scored.length - missing.length > 0;
  return { total, answered: scored.length - missing.length, items: scored.length, complete, band: complete ? bandOf(form.scoreBands, total) : undefined, missing };
}

/* ---------- worked-out number fields ---------- */

const numOf = (x: Values[string] | undefined): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Fill every field that has a `compute` rule. Empty inputs count as 0. When no input has a value the result stays empty,
 * so an untouched form does not show a made-up zero. Fields are worked out in form order, so a balance can use two totals.
 */
export function computeValues(form: FormDef, v: Values): Values {
  const out: Values = { ...v };
  for (const f of form.fields) {
    if (!f.compute) continue;
    const add = f.compute.add.map((k) => numOf(out[k]));
    const sub = (f.compute.subtract ?? []).map((k) => numOf(out[k]));
    if ([...add, ...sub].every((n) => n === null)) {
      out[f.key] = "";
      continue;
    }
    const sum = (a: (number | null)[]) => a.reduce<number>((n, x) => n + (x ?? 0), 0);
    out[f.key] = Math.round((sum(add) - sum(sub)) * 100) / 100;
  }
  return out;
}

/* ---------- shifts ---------- */

export const SHIFT_NAMES = ["Morning", "Evening", "Night"] as const;
export type Shift = (typeof SHIFT_NAMES)[number];
export const SHIFT_HOURS = "Morning 07:00 to 15:00. Evening 15:00 to 23:00. Night 23:00 to 07:00.";

/** The shift that covers a time of day. */
export function shiftAt(d: Date): Shift {
  const h = d.getHours();
  return h >= 7 && h < 15 ? "Morning" : h >= 15 && h < 23 ? "Evening" : "Night";
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Starting values of a new record: the time now, today and the running shift, for the fields that ask for them. */
export function prefillValues(form: FormDef, now: Date = new Date()): Values {
  const v: Values = {};
  for (const f of form.fields) {
    if (f.prefill === "now") v[f.key] = `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (f.prefill === "today") v[f.key] = localDate(now);
    if (f.prefill === "shift") v[f.key] = shiftAt(now);
  }
  return v;
}

/* ---------- age groups ---------- */

/** Children are under this age. From this age the adult tools apply. */
export const ADULT_FROM_YEARS = 14;

export function ageYears(dob: string, now: Date = new Date()): number {
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return NaN;
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a;
}

/** True when the form fits the patient's age. A form with no age group fits everyone. An unknown age hides nothing. */
export function fitsAge(form: Pick<FormDef, "audience"> | undefined, age: number): boolean {
  if (!form?.audience || Number.isNaN(age)) return true;
  return form.audience === "child" ? age < ADULT_FROM_YEARS : age >= ADULT_FROM_YEARS;
}

/* ---------- allergies from the chart ---------- */

const SEVERITY: Record<string, string> = { SV: "severe", MO: "moderate", MI: "mild" };

/** One line of text for the allergies in the chart. */
export function allergyText(allergies: { text: string; severity?: string; reaction?: string }[]): string {
  if (!allergies.length) return "No allergies recorded in the chart";
  return allergies.map((a) => `${a.text}${a.severity && SEVERITY[a.severity] ? ` (${SEVERITY[a.severity]}${a.reaction ? `, ${a.reaction}` : ""})` : ""}`).join("; ");
}

/* ---------- fluid balance by shift and by day ---------- */

export interface FluidLine {
  intake: number;
  output: number;
  balance: number;
}

export interface FluidDay extends FluidLine {
  date: string;
  shifts: Record<Shift, FluidLine | null>;
}

/**
 * Add up the Daily Intake & Output records by date and shift. Several records in one shift are added together.
 * The 24-hour balance of a date is its Morning, Evening and Night shifts together. Newest date first.
 */
export function fluidDays(records: Pick<FormRecord, "values">[]): FluidDay[] {
  const days = new Map<string, FluidDay>();
  for (const r of records) {
    const date = typeof r.values.chartDate === "string" ? r.values.chartDate : "";
    const shift = SHIFT_NAMES.find((s) => s === r.values.shift);
    if (!date || !shift) continue;
    const v = computeValuesForFluid(r.values);
    const day = days.get(date) ?? { date, intake: 0, output: 0, balance: 0, shifts: { Morning: null, Evening: null, Night: null } };
    const line = day.shifts[shift] ?? { intake: 0, output: 0, balance: 0 };
    line.intake += v.intake;
    line.output += v.output;
    line.balance = line.intake - line.output;
    day.shifts[shift] = line;
    day.intake += v.intake;
    day.output += v.output;
    day.balance = day.intake - day.output;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export const FLUID_INTAKE_KEYS = ["oral", "iv", "tubeFeed", "otherIntake"];
export const FLUID_OUTPUT_KEYS = ["urine", "drain", "vomit", "otherOutput"];

function computeValuesForFluid(v: Values): { intake: number; output: number } {
  const sum = (keys: string[]) => keys.reduce((n, k) => n + (numOf(v[k]) ?? 0), 0);
  return { intake: sum(FLUID_INTAKE_KEYS), output: sum(FLUID_OUTPUT_KEYS) };
}

/** "+250 mL" or "-400 mL": the sign is always written, so a balance is never read the wrong way round. */
export const signedMl = (n: number): string => `${n > 0 ? "+" : ""}${n} mL`;
