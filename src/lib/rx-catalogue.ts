import type { ControlClass, Drug, Frequency } from "./rx-types";

/**
 * Demo drug catalogue. About 30 common drugs, made up for the app.
 * Codes are TEST codes (prefix TST). The real value set is "KSA Prescription Pharmacy Item Name" in IS0200.
 * Brand names are fictional. Control classes are for demonstration only.
 */

export const ROUTES: { code: string; label: string }[] = [
  { code: "PO", label: "Oral" },
  { code: "SL", label: "Sublingual" },
  { code: "IV", label: "Intravenous" },
  { code: "IM", label: "Intramuscular" },
  { code: "SC", label: "Subcutaneous" },
  { code: "INH", label: "Inhaled" },
  { code: "TOP", label: "Topical" },
  { code: "TD", label: "Transdermal" },
  { code: "PR", label: "Rectal" },
];

export const ROUTE_LABEL: Record<string, string> = Object.fromEntries(ROUTES.map((r) => [r.code, r.label]));

/** Routes that need an injection or infusion. A tablet or capsule can never use them. */
export const PARENTERAL = ["IV", "IM", "SC"];

export const FREQUENCIES: Frequency[] = [
  { id: "OD", label: "Once daily", perDay: 1, frequency: 1, period: 1, periodUnit: "d" },
  { id: "BID", label: "Twice daily", perDay: 2, frequency: 2, period: 1, periodUnit: "d" },
  { id: "TID", label: "3 times daily", perDay: 3, frequency: 3, period: 1, periodUnit: "d" },
  { id: "QID", label: "4 times daily", perDay: 4, frequency: 4, period: 1, periodUnit: "d" },
  { id: "Q6H", label: "Every 6 hours", perDay: 4, frequency: 1, period: 6, periodUnit: "h" },
  { id: "Q8H", label: "Every 8 hours", perDay: 3, frequency: 1, period: 8, periodUnit: "h" },
  { id: "Q12H", label: "Every 12 hours", perDay: 2, frequency: 1, period: 12, periodUnit: "h" },
  { id: "QHS", label: "Once daily at bedtime", perDay: 1, frequency: 1, period: 1, periodUnit: "d", when: "HS" },
  { id: "WEEKLY", label: "Once weekly", perDay: 1 / 7, frequency: 1, period: 1, periodUnit: "wk" },
];

export const FREQ_BY_ID: Record<string, Frequency> = Object.fromEntries(FREQUENCIES.map((f) => [f.id, f]));

export const DURATION_CHIPS = [3, 5, 7, 10, 14, 30];

let n = 0;
function drug(
  generic: string,
  brand: string,
  strengthValue: number,
  strengthUnit: string,
  form: string,
  unit: string,
  cls: ControlClass,
  therapeuticClass: string,
  o: Partial<Drug> & { maxDailyDose: number },
): Drug {
  n += 1;
  const num = String(n).padStart(3, "0");
  return {
    id: `DRG${num}`,
    code: `TST-DRG-${num}`,
    generic,
    brand,
    strengthValue,
    strengthUnit,
    perUnit: strengthValue,
    form,
    formCode: form.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6),
    unit,
    routes: ["PO"],
    controlClass: cls,
    therapeuticClass,
    allergyKeys: [generic.toLowerCase()],
    crossKeys: [],
    defaultDose: 1,
    defaultFrequency: "BID",
    defaultDays: 5,
    defaultRoute: "PO",
    pack: { type: "box", size: 30 },
    barcode: `62900000${num}`,
    ...o,
  };
}

const PEN = ["penicillin", "beta-lactam"];

export const DRUGS: Drug[] = [
  drug("Paracetamol", "Paracip", 500, "mg", "Tablet", "tablet", "U", "Analgesic", { maxDailyDose: 4000, defaultDose: 2, defaultFrequency: "TID", defaultDays: 3, routes: ["PO", "PR"] }),
  drug("Ibuprofen", "Ibufen", 400, "mg", "Tablet", "tablet", "U", "NSAID", { maxDailyDose: 2400, defaultFrequency: "TID", defaultDays: 5, allergyKeys: ["ibuprofen", "nsaid"], crossKeys: ["aspirin"] }),
  drug("Diclofenac", "Diclon", 50, "mg", "Tablet", "tablet", "U", "NSAID", { maxDailyDose: 150, defaultFrequency: "TID", defaultDays: 5, allergyKeys: ["diclofenac", "nsaid"], crossKeys: ["aspirin"] }),
  drug("Amoxicillin", "Amoxia", 500, "mg", "Capsule", "capsule", "U", "Penicillin antibiotic", { maxDailyDose: 3000, defaultFrequency: "TID", defaultDays: 7, allergyKeys: ["amoxicillin", ...PEN] }),
  drug("Amoxicillin Suspension", "Amoxia Susp", 250, "mg/5 mL", "Suspension", "mL", "U", "Penicillin antibiotic", { perUnit: 50, maxDailyDose: 3000, defaultDose: 5, defaultFrequency: "TID", defaultDays: 7, allergyKeys: ["amoxicillin", ...PEN], pack: { type: "bottle", size: 100 } }),
  drug("Amoxicillin and Clavulanate", "Clavamox", 625, "mg", "Tablet", "tablet", "U", "Penicillin antibiotic", { maxDailyDose: 3000, defaultFrequency: "TID", defaultDays: 7, allergyKeys: ["amoxicillin", "clavulanate", ...PEN] }),
  drug("Azithromycin", "Azithra", 500, "mg", "Tablet", "tablet", "U", "Macrolide antibiotic", { maxDailyDose: 500, defaultFrequency: "OD", defaultDays: 3, pack: { type: "box", size: 3 } }),
  drug("Cefuroxime", "Cefurox", 500, "mg", "Tablet", "tablet", "U", "Cephalosporin antibiotic", { maxDailyDose: 1000, defaultFrequency: "BID", defaultDays: 7, allergyKeys: ["cefuroxime", "cephalosporin", "beta-lactam"], crossKeys: ["penicillin"] }),
  drug("Ciprofloxacin", "Ciprocin", 500, "mg", "Tablet", "tablet", "U", "Quinolone antibiotic", { maxDailyDose: 1500, defaultFrequency: "BID", defaultDays: 7, allergyKeys: ["ciprofloxacin", "quinolone"] }),
  drug("Metformin", "Glucomet", 500, "mg", "Tablet", "tablet", "U", "Biguanide", { maxDailyDose: 2550, defaultFrequency: "BID", defaultDays: 30 }),
  drug("Gliclazide", "Glyclaz", 80, "mg", "Tablet", "tablet", "U", "Sulfonylurea", { maxDailyDose: 320, defaultFrequency: "OD", defaultDays: 30, allergyKeys: ["gliclazide", "sulfa"] }),
  drug("Insulin Glargine", "Glargix Pen", 100, "unit/mL", "Injection", "mL", "U", "Insulin", { maxDailyDose: 100, defaultDose: 0.2, defaultFrequency: "QHS", defaultDays: 30, routes: ["SC"], defaultRoute: "SC", pack: { type: "pen", size: 3 } }),
  drug("Amlodipine", "Amlovas", 5, "mg", "Tablet", "tablet", "U", "Calcium channel blocker", { maxDailyDose: 10, defaultFrequency: "OD", defaultDays: 30 }),
  drug("Lisinopril", "Lisoprex", 10, "mg", "Tablet", "tablet", "U", "ACE inhibitor", { maxDailyDose: 80, defaultFrequency: "OD", defaultDays: 30, allergyKeys: ["lisinopril", "ace inhibitor"] }),
  drug("Losartan", "Losarta", 50, "mg", "Tablet", "tablet", "U", "ARB", { maxDailyDose: 100, defaultFrequency: "OD", defaultDays: 30 }),
  drug("Atenolol", "Atenox", 50, "mg", "Tablet", "tablet", "U", "Beta blocker", { maxDailyDose: 100, defaultFrequency: "OD", defaultDays: 30 }),
  drug("Atorvastatin", "Atorvin", 20, "mg", "Tablet", "tablet", "U", "Statin", { maxDailyDose: 80, defaultFrequency: "QHS", defaultDays: 30 }),
  drug("Simvastatin", "Simvaz", 20, "mg", "Tablet", "tablet", "U", "Statin", { maxDailyDose: 40, defaultFrequency: "QHS", defaultDays: 30 }),
  drug("Omeprazole", "Omepra", 20, "mg", "Capsule", "capsule", "U", "Proton pump inhibitor", { maxDailyDose: 40, defaultFrequency: "OD", defaultDays: 14 }),
  drug("Pantoprazole", "Pantora", 40, "mg", "Tablet", "tablet", "U", "Proton pump inhibitor", { maxDailyDose: 80, defaultFrequency: "OD", defaultDays: 14 }),
  drug("Salbutamol Inhaler", "Ventolix", 100, "mcg/puff", "Inhaler", "puff", "U", "Bronchodilator", { maxDailyDose: 1600, defaultDose: 2, defaultFrequency: "QID", defaultDays: 14, routes: ["INH"], defaultRoute: "INH", pack: { type: "inhaler", size: 200 } }),
  drug("Cetirizine", "Cetrizin", 10, "mg", "Tablet", "tablet", "U", "Antihistamine", { maxDailyDose: 10, defaultFrequency: "OD", defaultDays: 7 }),
  drug("Prednisolone", "Predmax", 5, "mg", "Tablet", "tablet", "U", "Corticosteroid", { maxDailyDose: 80, defaultDose: 4, defaultFrequency: "OD", defaultDays: 5 }),
  drug("Levothyroxine", "Thyrox", 100, "mcg", "Tablet", "tablet", "U", "Thyroid hormone", { maxDailyDose: 300, defaultFrequency: "OD", defaultDays: 30 }),
  drug("Aspirin", "Aspirex", 81, "mg", "Tablet", "tablet", "U", "Antiplatelet", { maxDailyDose: 325, defaultFrequency: "OD", defaultDays: 30, allergyKeys: ["aspirin", "nsaid", "salicylate"] }),
  drug("Clopidogrel", "Clopigo", 75, "mg", "Tablet", "tablet", "U", "Antiplatelet", { maxDailyDose: 75, defaultFrequency: "OD", defaultDays: 30 }),
  drug("Warfarin", "Warfin", 5, "mg", "Tablet", "tablet", "U", "Anticoagulant", { maxDailyDose: 15, defaultFrequency: "QHS", defaultDays: 30 }),
  drug("Enoxaparin", "Enoxal", 40, "mg/0.4 mL", "Injection", "syringe", "U", "Anticoagulant", { maxDailyDose: 80, defaultFrequency: "OD", defaultDays: 7, routes: ["SC"], defaultRoute: "SC", pack: { type: "box", size: 10 } }),
  drug("Furosemide", "Furoso", 40, "mg", "Tablet", "tablet", "U", "Loop diuretic", { maxDailyDose: 240, defaultFrequency: "OD", defaultDays: 14, allergyKeys: ["furosemide", "sulfa"] }),
  drug("Ondansetron", "Ondaset", 4, "mg", "Tablet", "tablet", "U", "Antiemetic", { maxDailyDose: 32, defaultFrequency: "TID", defaultDays: 3, routes: ["PO", "SL"] }),
  // Narcotic, controlled and restricted examples. The class is a demo value.
  drug("Morphine Sulfate", "Morphex", 10, "mg", "Tablet", "tablet", "N", "Opioid", { maxDailyDose: 120, defaultFrequency: "Q12H", defaultDays: 5, allergyKeys: ["morphine", "opioid"], crossKeys: ["codeine", "tramadol"] }),
  drug("Fentanyl Patch", "Fentra Patch", 25, "mcg/h", "Patch", "patch", "N", "Opioid", { maxDailyDose: 100, defaultFrequency: "WEEKLY", defaultDays: 14, routes: ["TD"], defaultRoute: "TD", allergyKeys: ["fentanyl", "opioid"], crossKeys: ["morphine", "tramadol"], pack: { type: "box", size: 5 } }),
  drug("Tramadol", "Tramol", 50, "mg", "Capsule", "capsule", "C", "Opioid", { maxDailyDose: 400, defaultFrequency: "Q12H", defaultDays: 5, allergyKeys: ["tramadol", "opioid"], crossKeys: ["morphine", "codeine"] }),
  drug("Diazepam", "Diazex", 5, "mg", "Tablet", "tablet", "C", "Benzodiazepine", { maxDailyDose: 40, defaultFrequency: "BID", defaultDays: 5, allergyKeys: ["diazepam", "benzodiazepine"] }),
  drug("Alprazolam", "Alpraz", 0.5, "mg", "Tablet", "tablet", "C", "Benzodiazepine", { maxDailyDose: 4, defaultFrequency: "BID", defaultDays: 5, allergyKeys: ["alprazolam", "benzodiazepine"] }),
  drug("Pregabalin", "Pregabex", 75, "mg", "Capsule", "capsule", "R", "Gabapentinoid", { maxDailyDose: 600, defaultFrequency: "BID", defaultDays: 14 }),
  drug("Zolpidem", "Zolpix", 10, "mg", "Tablet", "tablet", "R", "Hypnotic", { maxDailyDose: 10, defaultFrequency: "QHS", defaultDays: 7 }),
];

export const DRUG_BY_ID: Record<string, Drug> = Object.fromEntries(DRUGS.map((d) => [d.id, d]));

/** A short list of chips for fast prescribing. */
export const QUICK_DRUG_IDS: string[] = ["Paracetamol", "Amoxicillin", "Ibuprofen", "Metformin", "Amlodipine", "Omeprazole", "Salbutamol Inhaler", "Tramadol"]
  .map((g) => DRUGS.find((d) => d.generic === g)?.id ?? "")
  .filter(Boolean);

export const CONTROL_LABEL: Record<ControlClass, string> = {
  U: "Uncontrolled",
  N: "Narcotic",
  C: "Controlled",
  R: "Restricted",
};

export function drugLabel(d: Drug): string {
  return `${d.generic} ${d.strengthValue} ${d.strengthUnit} ${d.form}`;
}

export function searchDrugs(q: string, limit = 12): Drug[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return DRUGS.filter((d) => `${d.generic} ${d.brand} ${d.therapeuticClass} ${d.code}`.toLowerCase().includes(s)).slice(0, limit);
}
