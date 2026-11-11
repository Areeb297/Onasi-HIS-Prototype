/**
 * Vital sign specification as data.
 *
 * Sources (see the skill file references/vital-signs-requirements.md):
 * - UHR ORU: LOINC codes and UCUM units from the NPHIES "Vital signs - Observations" value set.
 * - CHI claims: the eight vital signs plus chief complaint that professional and institutional claims must carry,
 *   each with a value or an absence reason (NPHIES Financial Services IG, rules BV-00763 to BV-00780).
 * Reference ranges, flags and NEWS2 are general clinical practice, not NPHIES or CBAHI requirements.
 */

export type VitalKey = "sbp" | "dbp" | "pulse" | "rr" | "temp" | "spo2" | "weight" | "height";

export interface VitalDef {
  key: VitalKey;
  label: string;
  /** LOINC code for OBX-3 in the ORU. */
  loinc: string;
  loincText: string;
  /** UCUM unit as published in the ORU value set. */
  unit: string;
  /** UCUM unit as published in the claim rules. */
  claimUnit: string;
  /** Claim supportingInfo category code. */
  claimCategory: string;
  /** Business rule ids, institutional and professional. */
  rules: string;
  /** Plain unit for screens. */
  display: string;
  min: number;
  max: number;
  step?: number;
  /** Adult reference range for OBX-7 and flags. */
  range?: { low: number; high: number };
  /** Critical limits. */
  critical?: { low?: number; high?: number };
  /** Absence reasons from the nphies code system for this vital. */
  absence: { code: string; label: string; assumed?: boolean }[];
}

export const VITALS: VitalDef[] = [
  {
    key: "sbp", label: "Systolic BP", loinc: "8480-6", loincText: "Systolic blood pressure", unit: "mm[Hg]", claimUnit: "mm[Hg]",
    claimCategory: "vital-sign-systolic", rules: "BV-00764, BV-00773", display: "mmHg", min: 40, max: 300,
    range: { low: 90, high: 140 }, critical: { low: 80, high: 200 },
    absence: [{ code: "999", label: "Unknown" }, { code: "888", label: "Not measurable" }],
  },
  {
    key: "dbp", label: "Diastolic BP", loinc: "8462-4", loincText: "Diastolic blood pressure", unit: "mm[Hg]", claimUnit: "mm[Hg]",
    claimCategory: "vital-sign-diastolic", rules: "BV-00763, BV-00772", display: "mmHg", min: 20, max: 200,
    range: { low: 60, high: 90 },
    absence: [{ code: "999", label: "Unknown" }, { code: "888", label: "Not measurable" }],
  },
  {
    key: "pulse", label: "Pulse", loinc: "8867-4", loincText: "Heart rate", unit: "{beats}/min", claimUnit: "/min",
    claimCategory: "pulse", rules: "BV-00765, BV-00774", display: "/min", min: 10, max: 300,
    range: { low: 60, high: 100 }, critical: { low: 40, high: 130 },
    absence: [{ code: "999", label: "Not stated or inadequately described" }, { code: "997", label: "Cardiac arrest" }, { code: "998", label: "Not recorded" }],
  },
  {
    key: "rr", label: "Respiratory rate", loinc: "9279-1", loincText: "Respiratory rate", unit: "{breaths}/min", claimUnit: "/min",
    claimCategory: "respiratory-rate", rules: "BV-00768, BV-00777", display: "/min", min: 2, max: 80,
    range: { low: 12, high: 20 }, critical: { low: 8, high: 30 },
    absence: [{ code: "88", label: "Not obtained" }, { code: "99", label: "Unknown" }, { code: "00", label: "Artificial ventilation" }],
  },
  {
    key: "temp", label: "Temperature", loinc: "8310-5", loincText: "Body temperature", unit: "cel", claimUnit: "Cel",
    claimCategory: "temperature", rules: "BV-00766, BV-00775", display: "°C", min: 25, max: 45, step: 0.1,
    range: { low: 36.1, high: 37.8 }, critical: { low: 35, high: 39.5 },
    // The temperature absence reason codes could not be read from the IG page. These are assumed.
    absence: [{ code: "999", label: "Unknown", assumed: true }, { code: "888", label: "Not obtained", assumed: true }],
  },
  {
    key: "spo2", label: "Oxygen saturation", loinc: "59408-5", loincText: "Oxygen saturation in Arterial blood by Pulse oximetry", unit: "%", claimUnit: "%",
    claimCategory: "oxygen-saturation", rules: "BV-00771, BV-00780", display: "%", min: 30, max: 100,
    range: { low: 94, high: 100 }, critical: { low: 90 },
    absence: [{ code: "999", label: "Unknown" }, { code: "888", label: "Not obtained" }],
  },
  {
    key: "weight", label: "Weight", loinc: "29463-7", loincText: "Body weight", unit: "kg", claimUnit: "kg",
    claimCategory: "vital-sign-weight", rules: "BV-00769, BV-00778", display: "kg", min: 0.3, max: 500, step: 0.1,
    absence: [{ code: "999.9", label: "Not collected" }],
  },
  {
    key: "height", label: "Height", loinc: "8302-2", loincText: "Body height", unit: "cm", claimUnit: "cm",
    claimCategory: "vital-sign-height", rules: "BV-00767, BV-00776", display: "cm", min: 20, max: 260, step: 0.5,
    absence: [{ code: "999.9", label: "Not measured" }],
  },
];

export const VITAL_BY_KEY: Record<VitalKey, VitalDef> = Object.fromEntries(VITALS.map((v) => [v.key, v])) as Record<VitalKey, VitalDef>;

/** Extra readings from the ORU value set. They are optional detail on the panel. */
export const EXTRA_CODES = {
  bmi: { loinc: "39156-5", text: "Body mass index (BMI) [Ratio]", unit: "kg/m2" },
  mbp: { loinc: "8478-0", text: "Mean blood pressure", unit: "mm[Hg]" },
  o2flow: { loinc: "3151-8", text: "Inhaled oxygen flow rate", unit: "L/min" },
} as const;

export const BP_POSITIONS = ["Sitting", "Standing", "Lying", "Semi-recumbent"];

export const OBR_PANEL_CODE = { code: "85353-1", text: "Vital Signs Panel", system: "2.16.840.1.113883.6.1" } as const;
export const LOINC_SYSTEM = "2.16.840.1.113883.6.1";
export const UCUM_SYSTEM = "2.16.840.1.113883.6.8";

/** Why the panel was taken. Matches the example scenarios in the ORU guide. */
export type PanelContext = "triage" | "admission" | "routine" | "pre-procedure" | "transfer" | "discharge" | "other";

export const CONTEXTS: { id: PanelContext; label: string }[] = [
  { id: "triage", label: "ED triage" },
  { id: "admission", label: "Admission" },
  { id: "routine", label: "Routine monitoring" },
  { id: "pre-procedure", label: "Before a procedure" },
  { id: "transfer", label: "Before or after a transfer" },
  { id: "discharge", label: "Discharge" },
  { id: "other", label: "Other" },
];

/** Hospital policy example from the guide: vital signs every 4 hours for inpatients. Configurable. */
export const ROUTINE_INTERVAL_HOURS = 4;

/* ---------- flags and ranges ---------- */

export const refRangeText = (d: VitalDef): string => (d.range ? `${d.range.low}-${d.range.high}` : "");

/** HL7 style abnormal flag for an adult reading. Children are not flagged because the app has adult ranges only. */
export function flagFor(d: VitalDef, value: number, ageYears: number): "" | "L" | "H" | "LL" | "HH" {
  if (ageYears < 12 || !d.range) return "";
  if (d.critical?.low !== undefined && value < d.critical.low) return "LL";
  if (d.critical?.high !== undefined && value > d.critical.high) return "HH";
  if (value < d.range.low) return "L";
  if (value > d.range.high) return "H";
  return "";
}

export const bmiOf = (weightKg: number, heightCm: number): number | undefined =>
  weightKg > 0 && heightCm > 0 ? Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10 : undefined;

/* ---------- NEWS2 (Royal College of Physicians, adults) ---------- */

export type Consciousness = "Alert" | "Confusion" | "Voice" | "Pain" | "Unresponsive";
export const CONSCIOUSNESS: Consciousness[] = ["Alert", "Confusion", "Voice", "Pain", "Unresponsive"];

export interface News2 {
  total: number;
  parts: { label: string; score: number }[];
  band: "Low" | "Low-Medium" | "Medium" | "High";
  note: string;
  /** False when a needed reading is missing, so the score is partial. */
  complete: boolean;
}

/** National Early Warning Score 2, SpO2 scale 1. General clinical practice, not an NPHIES or CBAHI requirement. */
export function news2(v: Partial<Record<VitalKey, number>>, onOxygen: boolean, c: Consciousness): News2 | null {
  const parts: { label: string; score: number }[] = [];
  const add = (label: string, score: number) => parts.push({ label, score });
  const rng = (x: number, table: [number, number, number][]) => table.find(([lo, hi]) => x >= lo && x <= hi)?.[2] ?? 0;
  let complete = true;

  if (v.rr !== undefined) add("Respiratory rate", rng(v.rr, [[-1e9, 8, 3], [9, 11, 1], [12, 20, 0], [21, 24, 2], [25, 1e9, 3]])); else complete = false;
  if (v.spo2 !== undefined) add("Oxygen saturation", rng(v.spo2, [[-1e9, 91, 3], [92, 93, 2], [94, 95, 1], [96, 1e9, 0]])); else complete = false;
  add("Air or oxygen", onOxygen ? 2 : 0);
  if (v.sbp !== undefined) add("Systolic BP", rng(v.sbp, [[-1e9, 90, 3], [91, 100, 2], [101, 110, 1], [111, 219, 0], [220, 1e9, 3]])); else complete = false;
  if (v.pulse !== undefined) add("Pulse", rng(v.pulse, [[-1e9, 40, 3], [41, 50, 1], [51, 90, 0], [91, 110, 1], [111, 130, 2], [131, 1e9, 3]])); else complete = false;
  add("Consciousness", c === "Alert" ? 0 : 3);
  if (v.temp !== undefined) add("Temperature", rng(v.temp, [[-1e9, 35.0, 3], [35.1, 36.0, 1], [36.1, 38.0, 0], [38.1, 39.0, 1], [39.1, 1e9, 2]])); else complete = false;

  if (parts.length < 4) return null;
  const total = parts.reduce((a, p) => a + p.score, 0);
  const single3 = parts.some((p) => p.score === 3);
  const band: News2["band"] = total >= 7 ? "High" : total >= 5 ? "Medium" : single3 ? "Low-Medium" : "Low";
  const note =
    band === "High" ? "Emergency response and continuous monitoring."
    : band === "Medium" ? "Urgent review by a clinician."
    : band === "Low-Medium" ? "One reading scores 3. Urgent ward-based review."
    : total >= 1 ? "Low risk. Routine or frequent observation by policy." : "Low risk.";
  return { total, parts, band, note, complete };
}

/* ---------- claim readiness ---------- */

export const CLAIM_ITEMS: { key: VitalKey | "complaint"; label: string }[] = [
  { key: "sbp", label: "Systolic BP" }, { key: "dbp", label: "Diastolic BP" }, { key: "pulse", label: "Pulse" },
  { key: "temp", label: "Temperature" }, { key: "height", label: "Height" }, { key: "rr", label: "Respiratory rate" },
  { key: "weight", label: "Weight" }, { key: "spo2", label: "Oxygen saturation" }, { key: "complaint", label: "Chief complaint" },
];
