/**
 * Laboratory test catalogue (LOINC) with reference ranges, plus helpers to turn a typed value into an interpretation.
 *
 * Codes and names were checked against the LOINC table (NLM Clinical Tables look-up, November 2026). A code that is
 * not confirmed carries `madeUp: true` (shown as "(test code)" in the UI); none is left at present.
 * Reference ranges are generic adult demo values, not clinical guidance.
 * Real mapping of a hospital catalogue must use the NHIC "Laboratory Orders and Results" value set.
 */

/** Short keys used inside the app. What is sent is the LOINC code in LAB_DEPTS. */
export type LabDept = "HM" | "CH" | "MB" | "SR" | "CO" | "BB" | "UA" | "MO";
export type SpecimenKey = "BLD" | "SER" | "PLS" | "URN" | "NPS";
export type ValueKind = "quantity" | "integer" | "string" | "organism";
export type Interp = "N" | "H" | "L" | "HH" | "LL" | "A" | "POS" | "NEG";

/**
 * Section codes from the NPHIES "Laboratory Department" value set (Confluence page id 23234312): LOINC codes,
 * code system OID 2.16.840.1.113883.6.1. The display is the concept name on that page.
 */
export const LAB_DEPTS: Record<LabDept, { code: string; display: string }> = {
  HM: { code: "18723-7", display: "Hematology Studies" },
  CH: { code: "18719-5", display: "Biochemistry" },
  MB: { code: "18725-2", display: "Microbiology" },
  SR: { code: "18727-8", display: "Serology" },
  CO: { code: "18720-3", display: "Coagulation Studies" },
  BB: { code: "18717-9", display: "Blood Banking" },
  UA: { code: "18729-4", display: "Urinalysis Studies" },
  MO: { code: "26435-8", display: "Molecular Biology" },
};

/** SNOMED CT specimen types. All are in the NPHIES "Specimen type" value set (CS-Lab-SpecimenType, page id 30736696). */
export const SPECIMEN_TYPES: Record<SpecimenKey, { code: string; display: string }> = {
  NPS: { code: "258500001", display: "Nasopharyngeal swab" },
  BLD: { code: "119297000", display: "Blood specimen" },
  SER: { code: "119364003", display: "Serum specimen" },
  PLS: { code: "119361006", display: "Plasma specimen" },
  URN: { code: "122575003", display: "Urine specimen" },
};

export interface LabTest {
  /** LOINC code. */
  code: string;
  display: string;
  short: string;
  dept: LabDept;
  specimen: SpecimenKey;
  kind: ValueKind;
  /** UCUM unit sent in valueQuantity. Must be in KSA_LAB_UNITS (lab-units.ts). Leave it out for a number that has no unit. */
  unit?: string;
  /** Unit as people read it, when it differs from UCUM. */
  unitLabel?: string;
  low?: number;
  high?: number;
  /** Female range when it differs. */
  lowF?: number;
  highF?: number;
  critLow?: number;
  critHigh?: number;
  /** Fixed narrative reference range. When missing it is built from low and high. */
  refText?: string;
  /** Pick-list for text results. */
  choices?: string[];
  /** Text results that count as normal. */
  normal?: string[];
  /** Codes of member tests when this is a panel. */
  panel?: string[];
  /** Not sure this code is real. Shown as "(test code)". */
  madeUp?: boolean;
  /** Appears as a chip in the order pad. */
  common?: boolean;
}

const T = (t: LabTest): LabTest => t;

export const LAB_CATALOG: LabTest[] = [
  // ---- panels
  T({ code: "58410-2", display: "CBC panel - Blood by Automated count", short: "CBC", dept: "HM", specimen: "BLD", kind: "quantity", common: true, panel: ["718-7", "6690-2", "777-3", "789-8", "4544-3", "787-2"] }),
  T({ code: "24323-8", display: "Comprehensive metabolic 2000 panel - Serum or Plasma", short: "CMP", dept: "CH", specimen: "SER", kind: "quantity", common: true, panel: ["2345-7", "3094-0", "2160-0", "2951-2", "2823-3", "2075-0", "17861-6", "1751-7", "1742-6", "1920-8", "6768-6", "1975-2"] }),
  T({ code: "24331-1", display: "Lipid 1996 panel - Serum or Plasma", short: "Lipid Panel", dept: "CH", specimen: "SER", kind: "quantity", common: true, panel: ["2093-3", "2571-8", "2085-9", "13457-7"] }),
  T({ code: "24357-6", display: "Urinalysis macro (dipstick) panel - Urine", short: "Urinalysis", dept: "UA", specimen: "URN", kind: "string", common: true, panel: ["5811-5", "5803-2", "25428-4", "20454-5"] }),

  // ---- hematology
  T({ code: "718-7", display: "Hemoglobin [Mass/volume] in Blood", short: "Hemoglobin", dept: "HM", specimen: "BLD", kind: "quantity", unit: "g/dL", low: 13.0, high: 17.0, lowF: 12.0, highF: 15.5, critLow: 7.0, critHigh: 20.0,
    refText: "Adult male 13.0-17.0 g/dL. Adult female 12.0-15.5 g/dL. Child 1 to 12 years 11.5-15.5 g/dL. Newborn 14.0-24.0 g/dL. Ranges vary by age and sex." }),
  T({ code: "6690-2", display: "Leukocytes [#/volume] in Blood by Automated count", short: "WBC", dept: "HM", specimen: "BLD", kind: "quantity", unit: "10*3/uL", unitLabel: "x10^3/uL", low: 4.0, high: 11.0, critLow: 2.0, critHigh: 30.0,
    refText: "Adult 4.0-11.0 x10^3/uL. Child 1 to 6 years 5.0-15.5 x10^3/uL. Child 7 to 12 years 4.5-13.5 x10^3/uL. Newborn 9.0-30.0 x10^3/uL. Higher in pregnancy." }),
  T({ code: "777-3", display: "Platelets [#/volume] in Blood by Automated count", short: "Platelets", dept: "HM", specimen: "BLD", kind: "quantity", unit: "10*3/uL", unitLabel: "x10^3/uL", low: 150, high: 400, critLow: 20, critHigh: 1000 }),
  T({ code: "789-8", display: "Erythrocytes [#/volume] in Blood by Automated count", short: "RBC", dept: "HM", specimen: "BLD", kind: "quantity", unit: "10*6/uL", unitLabel: "x10^6/uL", low: 4.5, high: 5.9, lowF: 4.1, highF: 5.1 }),
  T({ code: "4544-3", display: "Hematocrit [Volume Fraction] of Blood by Automated count", short: "Hematocrit", dept: "HM", specimen: "BLD", kind: "quantity", unit: "%", low: 40, high: 52, lowF: 36, highF: 46, critLow: 20, critHigh: 60 }),
  T({ code: "787-2", display: "MCV [Entitic mean volume] in Red Blood Cells by Automated count", short: "MCV", dept: "HM", specimen: "BLD", kind: "quantity", unit: "fL", low: 80, high: 100 }),
  T({ code: "6301-6", display: "INR in Platelet poor plasma by Coagulation assay", short: "INR", dept: "CO", specimen: "PLS", kind: "quantity", unit: "{INR}", unitLabel: "", low: 0.8, high: 1.2, critHigh: 5.0, common: true }),
  T({ code: "5902-2", display: "Prothrombin time (PT)", short: "PT", dept: "CO", specimen: "PLS", kind: "quantity", unit: "s", low: 11, high: 13.5 }),
  T({ code: "883-9", display: "ABO group [Type] in Blood", short: "ABO Group", dept: "BB", specimen: "BLD", kind: "string", choices: ["A", "B", "AB", "O"], normal: ["A", "B", "AB", "O"], refText: "No reference range. Report the ABO group." }),

  // ---- chemistry
  T({ code: "2345-7", display: "Glucose [Mass/volume] in Serum or Plasma", short: "Glucose", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 70, high: 99, critLow: 50, critHigh: 500, common: true,
    refText: "Fasting 70-99 mg/dL. Random below 140 mg/dL. Newborn 40-90 mg/dL in the first day of life. Confirm values above 126 mg/dL with a second sample." }),
  T({ code: "3094-0", display: "Urea nitrogen [Mass/volume] in Serum or Plasma", short: "BUN", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 7, high: 20 }),
  T({ code: "2160-0", display: "Creatinine [Mass/volume] in Serum or Plasma", short: "Creatinine", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 0.7, high: 1.3, lowF: 0.6, highF: 1.1, critHigh: 7.0, common: true }),
  T({ code: "2951-2", display: "Sodium [Moles/volume] in Serum or Plasma", short: "Sodium", dept: "CH", specimen: "SER", kind: "quantity", unit: "mmol/L", low: 135, high: 145, critLow: 120, critHigh: 160, common: true }),
  T({ code: "2823-3", display: "Potassium [Moles/volume] in Serum or Plasma", short: "Potassium", dept: "CH", specimen: "SER", kind: "quantity", unit: "mmol/L", low: 3.5, high: 5.1, critLow: 2.5, critHigh: 6.5, common: true }),
  T({ code: "2075-0", display: "Chloride [Moles/volume] in Serum or Plasma", short: "Chloride", dept: "CH", specimen: "SER", kind: "quantity", unit: "mmol/L", low: 98, high: 107 }),
  T({ code: "17861-6", display: "Calcium [Mass/volume] in Serum or Plasma", short: "Calcium", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 8.6, high: 10.2, critLow: 6.5, critHigh: 13.0 }),
  T({ code: "1751-7", display: "Albumin [Mass/volume] in Serum or Plasma", short: "Albumin", dept: "CH", specimen: "SER", kind: "quantity", unit: "g/dL", low: 3.5, high: 5.2 }),
  T({ code: "1742-6", display: "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma", short: "ALT", dept: "CH", specimen: "SER", kind: "quantity", unit: "U/L", low: 7, high: 56, common: true }),
  T({ code: "1920-8", display: "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma", short: "AST", dept: "CH", specimen: "SER", kind: "quantity", unit: "U/L", low: 10, high: 40, common: true }),
  T({ code: "6768-6", display: "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma", short: "ALP", dept: "CH", specimen: "SER", kind: "quantity", unit: "U/L", low: 40, high: 129 }),
  T({ code: "1975-2", display: "Bilirubin.total [Mass/volume] in Serum or Plasma", short: "Bilirubin Total", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 0.1, high: 1.2 }),
  T({ code: "4548-4", display: "Hemoglobin A1c/Hemoglobin.total in Blood", short: "HbA1c", dept: "CH", specimen: "BLD", kind: "quantity", unit: "%", low: 4.0, high: 5.6, critHigh: 15, common: true }),
  T({ code: "2093-3", display: "Cholesterol [Mass/volume] in Serum or Plasma", short: "Cholesterol", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 0, high: 200, refText: "< 200 mg/dL" }),
  T({ code: "2571-8", display: "Triglyceride [Mass/volume] in Serum or Plasma", short: "Triglycerides", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 0, high: 150, refText: "< 150 mg/dL" }),
  T({ code: "2085-9", display: "Cholesterol in HDL [Mass/volume] in Serum or Plasma", short: "HDL", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 40, high: 90 }),
  T({ code: "13457-7", display: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation", short: "LDL", dept: "CH", specimen: "SER", kind: "quantity", unit: "mg/dL", low: 0, high: 130, refText: "< 130 mg/dL" }),
  T({ code: "3016-3", display: "Thyrotropin [Units/volume] in Serum or Plasma", short: "TSH", dept: "CH", specimen: "SER", kind: "quantity", unit: "m[IU]/L", unitLabel: "mIU/L", low: 0.4, high: 4.0, common: true }),
  T({ code: "2276-4", display: "Ferritin [Mass/volume] in Serum or Plasma", short: "Ferritin", dept: "CH", specimen: "SER", kind: "quantity", unit: "ng/mL", low: 24, high: 336, lowF: 11, highF: 307 }),
  // Numeric results sent as an integer or a string, with a text range that has < or >.
  T({ code: "1988-5", display: "C reactive protein [Mass/volume] in Serum or Plasma", short: "CRP", dept: "CH", specimen: "SER", kind: "integer", unit: "mg/L", high: 5, critHigh: 200, refText: "< 5 mg/L", common: true }),
  T({ code: "10839-9", display: "Troponin I.cardiac [Mass/volume] in Serum or Plasma", short: "Troponin I", dept: "CH", specimen: "SER", kind: "string", unit: "ng/mL", high: 0.04, critHigh: 0.5, refText: "< 0.04 ng/mL", common: true }),
  // ---- urinalysis members. Specific gravity has no unit: "1" is not in the KSA unit value set, so the number is sent alone.
  T({ code: "5811-5", display: "Specific gravity of Urine by Test strip", short: "Specific Gravity", dept: "UA", specimen: "URN", kind: "quantity", low: 1.005, high: 1.03 }),
  T({ code: "5803-2", display: "pH of Urine by Test strip", short: "Urine pH", dept: "UA", specimen: "URN", kind: "quantity", unit: "[pH]", unitLabel: "pH", low: 4.5, high: 8.0 }),
  T({ code: "25428-4", display: "Glucose [Presence] in Urine by Test strip", short: "Urine Glucose", dept: "UA", specimen: "URN", kind: "string", choices: ["Negative", "Trace", "1+", "2+", "3+", "4+"], normal: ["Negative"], refText: "Negative" }),
  T({ code: "20454-5", display: "Protein [Presence] in Urine by Test strip", short: "Urine Protein", dept: "UA", specimen: "URN", kind: "string", choices: ["Negative", "Trace", "1+", "2+", "3+", "4+"], normal: ["Negative"], refText: "Negative" }),

  // ---- serology and molecular
  T({ code: "94500-6", display: "SARS-CoV-2 (COVID-19) RNA [Presence] in Respiratory system specimen by NAA with probe detection", short: "COVID-19 PCR", dept: "MO", specimen: "NPS", kind: "string", choices: ["Not Detected", "Detected"], normal: ["Not Detected"], refText: "Not Detected", common: true }),
  T({ code: "2106-3", display: "Choriogonadotropin [Presence] in Urine", short: "Pregnancy Test (Urine)", dept: "SR", specimen: "URN", kind: "string", choices: ["Negative", "Positive"], normal: ["Negative"], refText: "Negative" }),

  // ---- microbiology
  T({ code: "630-4", display: "Bacteria identified in Urine by Culture", short: "Urine Culture", dept: "MB", specimen: "URN", kind: "organism", refText: "No growth", common: true }),
  T({ code: "600-7", display: "Bacteria identified in Blood by Culture", short: "Blood Culture", dept: "MB", specimen: "BLD", kind: "organism", refText: "No growth", common: true }),
];

const BY_CODE = new Map(LAB_CATALOG.map((t) => [t.code, t]));
export const testByCode = (code: string): LabTest | undefined => BY_CODE.get(code);

/** Tests shown as chips in the order pad: the four panels first, then the other common tests. */
export const COMMON_PANELS = LAB_CATALOG.filter((t) => t.panel);
export const COMMON_SINGLES = LAB_CATALOG.filter((t) => t.common && !t.panel);

/** One-click bundles of tests. */
export const QUICK_SETS: { id: string; label: string; codes: string[] }[] = [
  { id: "admit", label: "Admission Set", codes: ["58410-2", "24323-8"] },
  { id: "dm", label: "Diabetes Review", codes: ["4548-4", "2345-7", "2160-0", "24331-1", "24357-6"] },
  { id: "chest", label: "Chest Pain", codes: ["10839-9", "58410-2", "24323-8"] },
  { id: "infect", label: "Infection Work-Up", codes: ["58410-2", "1988-5", "600-7", "24357-6", "630-4"] },
];

/** Organisms use SNOMED CT codes. */
export interface Organism { code: string; display: string }
export const ORGANISMS: Organism[] = [
  { code: "112283007", display: "Escherichia coli" },
  { code: "3092008", display: "Staphylococcus aureus" },
  { code: "56415008", display: "Klebsiella pneumoniae" },
  { code: "52499004", display: "Pseudomonas aeruginosa" },
];

/** LOINC susceptibility codes, checked against the LOINC table. */
export const ANTIBIOTICS: { key: string; code: string; display: string }[] = [
  { key: "AMP", code: "18864-9", display: "Ampicillin [Susceptibility]" },
  { key: "AMC", code: "18862-3", display: "Amoxicillin+Clavulanate [Susceptibility]" },
  { key: "CRO", code: "18895-3", display: "Ceftriaxone [Susceptibility]" }, // 18886-2 is Cefotaxime
  { key: "CIP", code: "18906-8", display: "Ciprofloxacin [Susceptibility]" },
  { key: "GEN", code: "18928-2", display: "Gentamicin [Susceptibility]" },
  { key: "NIT", code: "18955-5", display: "Nitrofurantoin [Susceptibility]" },
];

/* ---------- helpers ---------- */

export function expand(codes: string[]): LabTest[] {
  const out: LabTest[] = [];
  for (const c of codes) {
    const t = testByCode(c);
    if (!t) continue;
    if (t.panel) out.push(...t.panel.map((m) => testByCode(m)).filter((m): m is LabTest => !!m));
    else out.push(t);
  }
  return out;
}

export function rangeFor(t: LabTest, sex: "M" | "F"): { low?: number; high?: number } {
  if (sex === "F" && (t.lowF !== undefined || t.highF !== undefined)) return { low: t.lowF ?? t.low, high: t.highF ?? t.high };
  return { low: t.low, high: t.high };
}

export const unitText = (t: LabTest) => t.unitLabel ?? t.unit ?? "";

/** Narrative reference range. NPHIES wants text always; "undefined" when there is none. */
export function refTextFor(t: LabTest, sex: "M" | "F"): string {
  if (t.refText) return t.refText;
  const { low, high } = rangeFor(t, sex);
  const u = unitText(t);
  if (low !== undefined && high !== undefined) return `${low} - ${high}${u ? ` ${u}` : ""}`;
  if (high !== undefined) return `< ${high}${u ? ` ${u}` : ""}`;
  if (low !== undefined) return `> ${low}${u ? ` ${u}` : ""}`;
  return "undefined";
}

/** Reference range as a structured low/high pair, when both ends are known and make sense. */
export function structuredRange(t: LabTest, sex: "M" | "F"): { low?: number; high?: number } | null {
  const r = rangeFor(t, sex);
  if (t.kind === "string" && !t.unit) return null;
  if (t.kind === "integer" || (t.kind === "string" && t.unit)) return null; // these use text ranges with < or >
  if (r.low === undefined && r.high === undefined) return null;
  return r;
}

export const isAbnormal = (i: Interp) => i !== "N" && i !== "NEG";
export const isCritical = (i: Interp) => i === "HH" || i === "LL";

export const INTERP_TEXT: Record<Interp, string> = {
  N: "Normal", H: "High", L: "Low", HH: "Critical High", LL: "Critical Low", A: "Abnormal", POS: "Positive", NEG: "Negative",
};

export function parseNumeric(raw: string): { n: number; op: "<" | ">" | "" } | null {
  const m = /^\s*([<>]=?)?\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return null;
  return { n: Number(m[2]), op: (m[1]?.[0] as "<" | ">" | undefined) ?? "" };
}

/** Work out the interpretation flag for a typed value. The technologist can override it. */
export function interpretValue(t: LabTest, raw: string, sex: "M" | "F"): Interp {
  const v = raw.trim();
  if (!v) return "N";
  if (t.kind === "organism") return /no growth/i.test(v) ? "NEG" : "POS";
  const num = parseNumeric(v);
  if (num) {
    const { low, high } = rangeFor(t, sex);
    if (num.op === ">") return t.critHigh !== undefined && num.n >= t.critHigh ? "HH" : high !== undefined && num.n >= high ? "H" : "N";
    if (num.op === "<") return t.critLow !== undefined && num.n <= t.critLow ? "LL" : low !== undefined && num.n <= low ? "L" : "N";
    if (t.critLow !== undefined && num.n <= t.critLow) return "LL";
    if (low !== undefined && num.n < low) return "L";
    if (t.critHigh !== undefined && num.n >= t.critHigh) return "HH";
    if (high !== undefined && num.n > high) return "H";
    return "N";
  }
  if (t.normal) return t.normal.some((x) => x.toLowerCase() === v.toLowerCase()) ? "N" : /^(positive|detected)$/i.test(v) ? "POS" : "A";
  return "N";
}

/** A believable value for the conformance sample and for quick demo fills. */
const SAMPLE: Record<string, string> = {
  "718-7": "9.8", // low: the abnormal quantitative result with a structured range
  "6690-2": "7.2", // normal, with the long textual range
  "777-3": "255",
  "789-8": "4.9",
  "4544-3": "44",
  "787-2": "88",
  "1988-5": "48", // abnormal integer with a text range "< 5 mg/L"
  "10839-9": "0.52",
  "25428-4": "Negative", // normal textual result
  "20454-5": "Negative",
  "5811-5": "1.015",
  "5803-2": "6.0",
};

export function sampleValue(t: LabTest, sex: "M" | "F"): string {
  if (SAMPLE[t.code] !== undefined) return SAMPLE[t.code];
  if (t.choices) return t.normal?.[0] ?? t.choices[0];
  const { low, high } = rangeFor(t, sex);
  if (low !== undefined && high !== undefined) return String(Math.round(((low + high) / 2) * 100) / 100);
  return "";
}

/** The tests that make a document meet the Seha "Lab Result" minimum content (2.1.1). */
export const CONFORMANCE_SAMPLE_CODES = ["58410-2", "1988-5", "24357-6", "630-4"];

export function normalizeCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  return codes.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
}
