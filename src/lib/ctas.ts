import type { CtasLevel } from "./model";

/**
 * Canadian Triage and Acuity Scale (CTAS) modifier engine. Pure functions, no storage.
 *
 * Source for the tables: CTAS Paramedic Guide v2.0 and CTAS Field Reference Guide v1.0 (London Health Sciences Centre,
 * adapted from the Ontario Hospital Association CTAS training manual, 2009). The rules used:
 *  - First order modifiers (breathing, circulation, consciousness, temperature, then pain, bleeding disorder, mechanism of injury)
 *    each give a level. When more than one applies, the HIGHEST acuity (the lowest number) wins.
 *  - Adult tables apply from 18 years. Children use the paediatric tables, which depend on age.
 *  - The modifiers only raise acuity. The presenting complaint sets the starting level (3, 4 or 5 in many cases), and the nurse decides.
 *
 * What is NOT automated, on purpose: the presenting complaint list (CEDIS) and most second order modifiers. The nurse picks the level,
 * and must give a reason if it is less urgent than the modifiers say.
 *
 * ASSUMPTIONS (the paediatric reference tables list only these ages, so the age to row mapping is ours):
 *  - Paediatric vital sign rows: under 3 months, 3 to 6 months, 6 to 12 months, 1 to 3 years (used up to 5 years),
 *    "6 years" (used from 5 up to 8 years) and "10 years" (used from 8 up to 18 years).
 *  - A value exactly on the edge of a band takes the band on the normal side.
 *  - Adult blood pressure and heart rate have no numeric CTAS level. They only prompt the nurse to assess perfusion.
 */

export interface CtasLevelInfo {
  level: CtasLevel;
  label: string;
  /** Minutes from triage to physician assessment. 0 means immediate. */
  targetMin: number;
  /** Share of patients who should be seen within the target (the CTAS fractile response). */
  fractile: number;
  /** Re-assess every this many minutes while waiting. 0 means continuous nursing care. */
  reassessMin: number;
}

export const CTAS_LEVELS: CtasLevelInfo[] = [
  { level: 1, label: "Resuscitation", targetMin: 0, fractile: 98, reassessMin: 0 },
  { level: 2, label: "Emergent", targetMin: 15, fractile: 95, reassessMin: 15 },
  { level: 3, label: "Urgent", targetMin: 30, fractile: 90, reassessMin: 30 },
  { level: 4, label: "Less Urgent", targetMin: 60, fractile: 85, reassessMin: 60 },
  { level: 5, label: "Non-Urgent", targetMin: 120, fractile: 80, reassessMin: 120 },
];

/* ---------- inputs and outputs ---------- */

export type Distress = "none" | "mild" | "moderate" | "severe";
export type Perfusion = "normal" | "borderline" | "compromised" | "shock";
export type Appearance = "well" | "unwell" | "septic";

export interface TriageInput {
  /** Age in whole months. Use ageInMonths(dob). */
  ageMonths: number;
  hr?: number;
  rr?: number;
  sbp?: number;
  dbp?: number;
  spo2?: number;
  /** Oral temperature in degrees C. Axillary is about 1 lower and rectal about 1 higher. */
  temp?: number;
  /** Glasgow Coma Scale for adults, Paediatric Coma Scale for infants and children. */
  gcs?: number;
  pain?: number;
  painLocation?: "central" | "peripheral";
  painDuration?: "acute" | "chronic";
  /** Nurse's judgement of work of breathing. */
  distress?: Distress;
  /** Nurse's judgement of perfusion (skin, pulse, capillary refill). */
  perfusion?: Perfusion;
  /** How the patient looks when the temperature is raised. */
  appearance?: Appearance;
  immunocompromised?: boolean;
  /** High blood pressure with other symptoms such as headache, chest pain, shortness of breath or nausea. */
  symptomatic?: boolean;
  /** On an anticoagulant or has a bleeding disorder, and is bleeding. Adults only. */
  bleeding?: "none" | "minor" | "major";
  /** A mechanism of injury the guide lists as CTAS 2 (ejection, rollover, high speed, fall from height, penetrating injury and so on). */
  highRiskInjury?: boolean;
}

export interface Driver {
  id: string;
  /** Plain-English name of the modifier. */
  modifier: string;
  level: CtasLevel;
  /** Why, in words a nurse can check. */
  why: string;
}

export interface Assessment {
  band: "adult" | "paediatric";
  ageText: string;
  /** Every modifier that applies, most urgent first. */
  drivers: Driver[];
  /** The most urgent level any modifier gives. Undefined when no modifier applies: pick the level from the presenting complaint. */
  level?: CtasLevel;
  /** Things to check by hand. These never change the level. */
  prompts: string[];
}

/* ---------- age ---------- */

export function ageInMonths(dob: string, now: Date = new Date()): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 18 * 12 * 3;
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
}

export const isPaediatric = (ageMonths: number): boolean => ageMonths < 18 * 12;

export function ageText(ageMonths: number): string {
  if (ageMonths < 3) return `${ageMonths} month${ageMonths === 1 ? "" : "s"}`;
  if (ageMonths < 24) return `${ageMonths} months`;
  return `${Math.floor(ageMonths / 12)} years`;
}

/* ---------- paediatric vital sign bands (Tables 15 and 17) ---------- */

/** Edges: below a is level 1, a to b level 2, b to c level 3, c to d normal, d to e level 3, e to f level 2, above f level 1. */
type Edges = [number, number, number, number, number, number];

interface PaedRow { max: number; rr: Edges; hr: Edges }

/** max is the age in months below which the row applies. */
const PAED_ROWS: PaedRow[] = [
  { max: 3, rr: [10, 20, 30, 60, 70, 80], hr: [40, 65, 90, 180, 205, 230] },
  { max: 6, rr: [10, 20, 30, 60, 70, 80], hr: [40, 63, 80, 160, 180, 210] },
  { max: 12, rr: [10, 17, 25, 45, 55, 60], hr: [40, 60, 80, 140, 160, 180] },
  { max: 60, rr: [10, 15, 20, 30, 35, 40], hr: [40, 58, 75, 130, 145, 165] },
  { max: 96, rr: [8, 12, 16, 24, 28, 32], hr: [40, 55, 70, 110, 125, 140] },
  { max: Infinity, rr: [8, 10, 14, 20, 24, 26], hr: [30, 45, 60, 90, 105, 120] },
];

const paedRow = (months: number): PaedRow => PAED_ROWS.find((r) => months < r.max) ?? PAED_ROWS[PAED_ROWS.length - 1];

/** Level for a value, or undefined when it is in the normal band. */
export function bandLevel(v: number, e: Edges): CtasLevel | undefined {
  if (v < e[0]) return 1;
  if (v < e[1]) return 2;
  if (v < e[2]) return 3;
  if (v <= e[3]) return undefined;
  if (v <= e[4]) return 3;
  if (v <= e[5]) return 2;
  return 1;
}

/* ---------- pain (Table 5 adult, Table 23 paediatric) ---------- */

type Sev = "severe" | "moderate" | "mild";
const painSeverity = (p: number): Sev => (p >= 8 ? "severe" : p >= 4 ? "moderate" : "mild");

const ADULT_PAIN: Record<Sev, Record<"central" | "peripheral", Record<"acute" | "chronic", CtasLevel>>> = {
  severe: { central: { acute: 2, chronic: 3 }, peripheral: { acute: 3, chronic: 4 } },
  moderate: { central: { acute: 3, chronic: 4 }, peripheral: { acute: 4, chronic: 5 } },
  mild: { central: { acute: 4, chronic: 5 }, peripheral: { acute: 5, chronic: 5 } },
};
const PAED_PAIN: Record<Sev, CtasLevel> = { severe: 2, moderate: 3, mild: 4 };

/* ---------- the engine ---------- */

const min = (a: CtasLevel, b: CtasLevel): CtasLevel => (a < b ? a : b);

export function assessCtas(i: TriageInput): Assessment {
  const paed = isPaediatric(i.ageMonths);
  const row = paed ? paedRow(i.ageMonths) : undefined;
  const drivers: Driver[] = [];
  const prompts: string[] = [];
  const add = (id: string, modifier: string, level: CtasLevel, why: string) => {
    // One line per modifier: keep the most urgent.
    const same = drivers.find((d) => d.id === id);
    if (same) {
      if (level < same.level) { same.level = level; same.why = why; }
    } else drivers.push({ id, modifier, level, why });
  };

  /* Breathing */
  if (i.spo2 !== undefined) {
    if (i.spo2 < 90) add("breathing", "Breathing", 1, `Oxygen saturation ${i.spo2}%, under 90%`);
    else if (i.spo2 < 92) add("breathing", "Breathing", 2, `Oxygen saturation ${i.spo2}%, under 92%`);
    else if (i.spo2 < 94) add("breathing", "Breathing", 3, `Oxygen saturation ${i.spo2}%, 92 to 94%`);
  }
  if (i.distress === "severe") add("breathing", "Breathing", 1, "Severe respiratory distress");
  else if (i.distress === "moderate") add("breathing", "Breathing", 2, "Moderate respiratory distress");
  else if (i.distress === "mild") add("breathing", "Breathing", 3, "Mild respiratory distress");
  if (row && i.rr !== undefined) {
    const l = bandLevel(i.rr, row.rr);
    if (l) add("breathing", "Breathing", l, `Respiratory rate ${i.rr} is outside the normal range for ${ageText(i.ageMonths)}`);
  }
  if (!paed && i.rr !== undefined && (i.rr >= 30 || i.rr <= 8) && !i.distress) {
    prompts.push("The respiratory rate is very high or low. CTAS has no adult rate table, so judge the work of breathing and set Breathing.");
  }

  /* Circulation */
  if (i.perfusion === "shock") add("circulation", "Circulation", 1, "Shock: severe signs of poor perfusion");
  else if (i.perfusion === "compromised") add("circulation", "Circulation", 2, "Hemodynamic compromise: borderline perfusion");
  else if (i.perfusion === "borderline") add("circulation", "Circulation", 3, "Vital signs at the upper or lower end of normal");
  if (row && i.hr !== undefined) {
    const l = bandLevel(i.hr, row.hr);
    if (l) add("circulation", "Circulation", l, `Heart rate ${i.hr} is outside the normal range for ${ageText(i.ageMonths)}`);
  }
  if (!paed && (!i.perfusion || i.perfusion === "normal")) {
    if ((i.sbp !== undefined && i.sbp < 90) || (i.hr !== undefined && (i.hr > 130 || i.hr < 40))) {
      prompts.push("The blood pressure or heart rate may mean poor perfusion. CTAS has no adult number for this: check skin, pulse and capillary refill, then set Circulation.");
    }
  }

  /* Consciousness */
  if (i.gcs !== undefined) {
    if (i.gcs <= 9) add("consciousness", "Consciousness", 1, `Coma score ${i.gcs}: unconscious`);
    else if (i.gcs <= 13) add("consciousness", "Consciousness", 2, `Coma score ${i.gcs}: altered level of consciousness`);
  }

  /* Temperature */
  if (i.temp !== undefined) {
    const t = i.temp;
    if (paed && i.ageMonths < 3) {
      if (t >= 38) add("temperature", "Temperature", 2, `Temperature ${t}°C in a baby under 3 months`);
      else if (t < 36) add("temperature", "Temperature", 2, `Temperature ${t}°C is low in a baby under 3 months`);
    } else if (paed) {
      if (t < 32) add("temperature", "Temperature", 2, `Temperature ${t}°C: hypothermia`);
      else if (t < 36) add("temperature", "Temperature", 3, `Temperature ${t}°C: low`);
    } else if (t < 36) {
      prompts.push("A low temperature can mean sepsis. Check the other signs of infection.");
    }
    if (t >= 38.5) {
      const ap = i.appearance;
      if (i.immunocompromised) add("temperature", "Temperature", 2, `Fever ${t}°C in an immunocompromised patient`);
      else if (!paed) {
        if (ap === "septic") add("temperature", "Temperature", 2, `Fever ${t}°C and looks septic`);
        else if (ap === "well") add("temperature", "Temperature", 4, `Fever ${t}°C and looks well`);
        else add("temperature", "Temperature", 3, `Fever ${t}°C and looks unwell`);
      } else if (i.ageMonths >= 3 && i.ageMonths < 36) {
        if (ap === "well") add("temperature", "Temperature", 3, `Fever ${t}°C, child looks well`);
        else add("temperature", "Temperature", 2, `Fever ${t}°C, child looks unwell`);
      } else if (i.ageMonths >= 36) {
        if (ap === "well") add("temperature", "Temperature", 4, `Fever ${t}°C, child looks well`);
        else add("temperature", "Temperature", 3, `Fever ${t}°C, child looks unwell`);
      }
      if (!ap && !i.immunocompromised) prompts.push("The temperature is raised. Say how the patient looks (well, unwell or septic). Until then the level assumes unwell.");
    }
  }

  /* Pain */
  if (i.pain !== undefined && i.pain > 0) {
    const sev = painSeverity(i.pain);
    if (paed) add("pain", "Pain", PAED_PAIN[sev], `Pain ${i.pain}/10, ${sev}`);
    else {
      const loc = i.painLocation ?? "central";
      const dur = i.painDuration ?? "acute";
      add("pain", "Pain", ADULT_PAIN[sev][loc][dur], `Pain ${i.pain}/10, ${sev}, ${loc}, ${dur}`);
      if (!i.painLocation) prompts.push("Say if the pain is central (in a body cavity or organ) or peripheral. The level assumes central, which is the safer choice.");
    }
  }

  /* Bleeding disorder or anticoagulant (adult table) */
  if (!paed && i.bleeding === "major") add("bleeding", "Bleeding", 2, "Bleeding at a major site while on an anticoagulant or with a bleeding disorder");
  else if (!paed && i.bleeding === "minor") add("bleeding", "Bleeding", 3, "Minor bleeding while on an anticoagulant or with a bleeding disorder");

  /* Mechanism of injury */
  if (i.highRiskInjury) add("injury", "Mechanism of injury", 2, "High-risk mechanism of injury");

  /* Second order: blood pressure (adult table 9) */
  if (!paed && (i.sbp !== undefined || i.dbp !== undefined)) {
    const s = i.sbp ?? 0;
    const d = i.dbp ?? 0;
    if (s >= 220 || d >= 130) add("blood-pressure", "High blood pressure", i.symptomatic ? 2 : 3, `Blood pressure ${s || "?"}/${d || "?"}${i.symptomatic ? " with symptoms" : " without symptoms"}`);
    else if ((s >= 200 || d >= 110) && i.symptomatic) add("blood-pressure", "High blood pressure", 3, `Blood pressure ${s || "?"}/${d || "?"} with symptoms`);
  }

  drivers.sort((a, b) => a.level - b.level);
  const level = drivers.length ? drivers.reduce<CtasLevel>((m, d) => min(m, d.level), 5) : undefined;
  return { band: paed ? "paediatric" : "adult", ageText: ageText(i.ageMonths), drivers, level, prompts };
}

/** True when the nurse picked a less urgent level than the modifiers give. A reason must be written. */
export const needsReason = (chosen: CtasLevel | undefined, a: Assessment): boolean => !!chosen && a.level !== undefined && chosen > a.level;

/** One line for the card: which modifier set the level. */
export const whyLine = (a: Assessment): string => (a.drivers[0] ? `${a.drivers[0].modifier}: ${a.drivers[0].why}` : "");
