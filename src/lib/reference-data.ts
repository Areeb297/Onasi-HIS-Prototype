import type { Bed, Doctor, Dx, Pr, Allergy, Patient } from "./model";
import { VS, VS_ADMISSION_METHOD, VS_COUNTRY, vsLabel } from "./nphies-valuesets";



/**
 * The organisation as NPHIES knows it. One id and one OID for every HL7 message (ADT and vital signs ORU).
 * Both are made-up demo values: the real ones are issued at onboarding.
 * - ORG_ID: NHIC Organization ID. Goes in MSH-4, PD1-3 and the facility part of PV1-3.
 * - ORG_OID: National Organization OID (2.16.840.1.113883.3.3731.XXXX, where XXXX includes the organisation id).
 *   Assigning authority of the visit number (PV1-19), MSH-3 of the ORU, and OBR-2/3.
 * - ADT_APP_OID: the sending application for ADT MSH-3 (organisation OID plus a suffix the participant chooses).
 */
export const ORG_ID = "15000000999999";
export const ORG_OID = `2.16.840.1.113883.3.3731.5.1.${ORG_ID}`;
/** The organisation id under its older name. One value for ADT, vital signs, FHIR and documents. */
export const FACILITY = ORG_ID;
export const ADT_APP_OID = `${ORG_OID}.1`;

/** OIDs from the NPHIES-CS integration guide, except participant and nationalOrg, which are made-up demo values. */
export const OID = {
  healthId: "2.16.840.1.113883.3.3731.1.1.100.1",
  provider: "2.16.840.1.113883.3.3731.1.2.1",
  nphiesApp: "2.16.840.1.113883.3.3731.1.2.2",
  /** Same value as ORG_OID, kept under its older name for the FHIR builders. */
  participant: ORG_OID,
  /** Same value as ORG_OID. */
  nationalOrg: ORG_OID,
  /** ICD-10-AM, for DG1-3, PV2-3 and PR1-15. */
  icd10am: "2.16.840.1.113883.6.135",
  /** ACHI procedures, for PR1-3. */
  achi: "2.16.840.1.113883.3.3731.50.2",
  /** ADA dental services, for PR1-3. */
  ada: "2.16.840.1.113883.3.3731.50.3",
  /** Imaging Procedure value set, for PR1-3. */
  imaging: "2.16.840.1.113883.3.3731.1.204.15",
  /** SNOMED CT, for the allergen in AL1-3. */
  snomed: "2.16.840.1.113883.6.96",
  /** Allergy severity table, for AL1-4. */
  allergySeverity: "2.16.840.1.113883.18.55",
} as const;

/** Nationality for PID-28. Codes are from CS-Adm-Country (ISO 3166 alpha-3, and 999 for unknown). */
export const NATIONALITIES = [
  { code: "SAU", label: "Saudi Arabia" },
  { code: "EGY", label: "Egypt" },
  { code: "IND", label: "India" },
  { code: "PAK", label: "Pakistan" },
  { code: "PHL", label: "Philippines" },
  { code: "YEM", label: "Yemen" },
  { code: "SYR", label: "Syria" },
  { code: "BGD", label: "Bangladesh" },
  { code: "JOR", label: "Jordan" },
  { code: "SDN", label: "Sudan" },
  { code: "999", label: "Unknown" },
];

/** ISO 3166 numeric codes that older records and the demo registry still hold, to the alpha-3 code NPHIES expects. */
const NUMERIC_COUNTRY: Record<string, string> = {
  "682": "SAU", "818": "EGY", "356": "IND", "586": "PAK", "608": "PHL", "887": "YEM", "760": "SYR", "050": "BGD", "400": "JOR", "729": "SDN",
};

/** Nationality as a CS-Adm-Country code. Old numeric codes are converted. Anything not published becomes "" (not sent). */
export function countryCode(value: string | undefined): string {
  const v = (value ?? "").trim().toUpperCase();
  if (!v) return "";
  if (VS.country.has(v)) return v;
  return NUMERIC_COUNTRY[v] ?? "";
}

export const countryLabel = (value: string | undefined): string => {
  const c = countryCode(value);
  return NATIONALITIES.find((n) => n.code === c)?.label ?? vsLabel(VS_COUNTRY, c);
};

/** Marital status for PID-16. Codes are from CS-Adm-MaritalStatus. */
export const MARITAL = [
  { code: "S", label: "Single" },
  { code: "M", label: "Married" },
  { code: "D", label: "Divorced" },
  { code: "W", label: "Widowed" },
  { code: "A", label: "Separated" },
  { code: "U", label: "Unknown" },
];

/** Saudi Post short address: 4 letters then 4 digits. */
export const ADDRESS_PATTERN = /^[A-Z]{4}[0-9]{4}$/;
export const FACILITY_NAME = "Demo General Hospital";

export const DOCTORS: Doctor[] = [
  { id: "D1001", family: "Alharbi", given: "Khalid", service: "MED" },
  { id: "D1002", family: "Alzahrani", given: "Noura", service: "SUR" },
  { id: "D1003", family: "Alqahtani", given: "Faisal", service: "ICU" },
  { id: "D1004", family: "Alotaibi", given: "Huda", service: "RAD" },
  { id: "D1005", family: "Alshehri", given: "Omar", service: "ORT" },
];

/**
 * Hospital services. `code` is the HIS code used inside the app. `unit` is the code sent in PV1-10,
 * from CS-Adm-MedicalUnitIdentifier. The match between our services and the published units is our choice:
 * confirm it with the facility before going live.
 */
export const SERVICES: { code: string; label: string; unit: string }[] = [
  { code: "MED", label: "Medicine", unit: "MX" },
  { code: "SUR", label: "Surgery", unit: "MS" },
  { code: "ICU", label: "Intensive Care", unit: "MI" },
  { code: "ORT", label: "Orthopedics", unit: "MS2" },
  { code: "RAD", label: "Radiology", unit: "MK" },
  { code: "LAB", label: "Laboratory", unit: "MO1" },
  { code: "OPD", label: "Outpatient Clinic", unit: "MF1.2" },
  { code: "ER", label: "Emergency", unit: "ME1.1" },
];

/** PV1-10 code for a HIS service. "" when the service has no published unit. */
export const unitCodeOf = (service: string | undefined): string =>
  SERVICES.find((s) => s.code === service)?.unit ?? (service && VS.medicalUnit.has(service) ? service : "");

/**
 * Discharge disposition for PV1-36. SNOMED CT codes from CS-Adm-DischargeDisposition.
 * These nine are the only ones the A08 discharge update accepts, so the app offers only these.
 */
export const DISPOSITIONS: { code: string; label: string }[] = [
  { code: "306689006", label: "Home" },
  { code: "225928004", label: "Left against medical advice" },
  { code: "306699001", label: "Transfer to an acute hospital" },
  { code: "306698009", label: "Transfer to a psychiatric hospital" },
  { code: "306691003", label: "Transfer to a residential aged care service" },
  { code: "306685000", label: "Transfer to other health care accommodation" },
  { code: "306706006", label: "Statistical discharge, type change" },
  { code: "20541009", label: "Statistical discharge from leave" },
  { code: "79779006", label: "Died" },
];
export const DEFAULT_DISPOSITION = "306689006";
export const CNHI_DISPOSITIONS = new Set(DISPOSITIONS.map((d) => d.code));

/** Admission method for PV1-4 (required). Codes and names are from CS-Adm-AdmissionMethod. */
export const ADMISSION_METHODS: { code: string; label: string }[] = VS_ADMISSION_METHOD.map((x) => ({ code: x.code, label: x.label }));
/** The A08 discharge update accepts only 14 (Elective) and 15 (Emergency). The other methods are folded into these two. */
const EMERGENCY_METHODS = new Set(["02", "03", "04", "05", "06", "07", "08", "12", "15"]);
export const cnhiAdmissionMethod = (code: string): string => (code === "14" || code === "15" ? code : EMERGENCY_METHODS.has(code) ? "15" : "14");
export const defaultAdmissionMethod = (cls: string): string => (cls === "E" ? "15" : "14");

/** Patient class for PV1-2. Codes from CS-Adm-PatientClass. Only the classes this HIS runs are listed. */
export const PATIENT_CLASSES: { code: "I" | "O" | "E"; label: string }[] = [
  { code: "I", label: "Inpatient" },
  { code: "O", label: "Outpatient" },
  { code: "E", label: "Emergency" },
];

/** Allergy type for AL1-2. Codes from CS-Allergy-Type. */
export const ALLERGY_TYPES: { code: "DALG" | "FALG" | "ALG"; label: string }[] = [
  { code: "DALG", label: "Drug" },
  { code: "FALG", label: "Food" },
  { code: "ALG", label: "Other" },
];
/** Allergy severity for AL1-4. Codes from CS-Allergy-Severity. */
export const ALLERGY_SEVERITIES: { code: "SV" | "MO" | "MI"; label: string }[] = [
  { code: "SV", label: "Severe" },
  { code: "MO", label: "Moderate" },
  { code: "MI", label: "Mild" },
];

/** Diagnosis type for DG1-6, as listed on the DG1 page. */
export const DX_TYPES: { code: "A" | "W" | "F"; label: string }[] = [
  { code: "A", label: "Admitting" },
  { code: "W", label: "Working" },
  { code: "F", label: "Final" },
];
/** Procedure functional type for PR1-6, as listed on the PR1 page. */
export const PR_TYPES: { code: "A" | "D" | "I" | "P"; label: string; short: string }[] = [
  { code: "P", label: "Procedure for treatment (therapeutic, including operations)", short: "Treatment" },
  { code: "D", label: "Diagnostic procedure", short: "Diagnostic" },
  { code: "I", label: "Invasive procedure not classified elsewhere (e.g., IV, catheter, etc.)", short: "Invasive, other" },
  { code: "A", label: "Anesthesia", short: "Anesthesia" },
];
/** Which code list a procedure code comes from. Decides the coding system OID in PR1-3. */
export const PR_SYSTEMS: { code: "ACHI" | "ADA" | "IMG"; label: string; oid: string }[] = [
  { code: "ACHI", label: "Procedure", oid: "2.16.840.1.113883.3.3731.50.2" },
  { code: "ADA", label: "Dental", oid: "2.16.840.1.113883.3.3731.50.3" },
  { code: "IMG", label: "Imaging", oid: "2.16.840.1.113883.3.3731.1.204.15" },
];

export const WARDS = [
  { ward: "3A", name: "Medical Ward 3A", rooms: [["301", 2], ["302", 2]] as [string, number][] },
  { ward: "4B", name: "Surgical Ward 4B", rooms: [["401", 2], ["402", 2]] as [string, number][] },
  { ward: "ICU", name: "Intensive Care", rooms: [["ICU1", 2], ["ICU2", 2]] as [string, number][] },
];

export const BEDS: Bed[] = WARDS.flatMap((w) =>
  w.rooms.flatMap(([room, count]) =>
    Array.from({ length: count }, (_, i) => {
      const bed = String.fromCharCode(65 + i);
      return { id: `${room}-${bed}`, ward: w.ward, wardName: w.name, room, bed };
    }),
  ),
);

export const BED_BY_ID: Record<string, Bed> = Object.fromEntries(BEDS.map((b) => [b.id, b]));

export const DX_SAMPLES: Dx[] = [
  { code: "J18.9", text: "Pneumonia, unspecified organism", type: "A" },
  { code: "I21.9", text: "Acute myocardial infarction, unspecified", type: "A" },
  { code: "K35.80", text: "Acute appendicitis, unspecified", type: "A" },
  { code: "S72.001", text: "Fracture of neck of femur", type: "A" },
  { code: "E11.9", text: "Type 2 diabetes mellitus without complications", type: "W" },
];

/** Sample procedures. The codes are examples: check them against CS-Clinical-Procedure and CS-Rad-Procedure. */
export const PR_SAMPLES: Pr[] = [
  { code: "44970-00", text: "Laparoscopic appendicectomy", system: "ACHI", type: "P" },
  { code: "90661-00", text: "Chest X-ray", system: "IMG", type: "D" },
  { code: "38497-00", text: "Coronary angiography", system: "ACHI", type: "D" },
  { code: "47519-00", text: "Hip arthroplasty", system: "ACHI", type: "P" },
];

/** Common complaints (SNOMED CT) for one-click entry. */
export const COMPLAINT_SAMPLES = [
  { code: "386661006", text: "Fever" },
  { code: "49727002", text: "Cough" },
  { code: "29857009", text: "Chest pain" },
  { code: "25064002", text: "Headache" },
  { code: "21522001", text: "Abdominal pain" },
  { code: "267036007", text: "Shortness of breath" },
];

/**
 * Sample allergies with SNOMED CT substance codes. The KSA allergy value sets (CS-Allergy-Drug, -Food, -Substance)
 * are held on the NHIC website, so these codes still need checking against them.
 */
export const ALLERGY_SAMPLES: Allergy[] = [
  { text: "Penicillin", severity: "SV", reaction: "Rash", type: "DALG", code: "764146007" },
  { text: "Latex", severity: "MO", reaction: "Hives", type: "ALG", code: "111088007" },
  { text: "Ibuprofen", severity: "MO", reaction: "Wheeze", type: "DALG", code: "387207008" },
  { text: "Eggs", severity: "MI", reaction: "Itching", type: "FALG", code: "102263004" },
];

/* ---------- Chart code lists (diagnosis, allergy and chief complaint search) ---------- */

export interface CodedTerm { code: string; text: string }

/**
 * Common ICD-10-AM diagnoses for the chart search. The HIS reads the full code table from its database.
 * Codes are examples of common diagnoses: check each one against the ICD-10-AM edition the hospital codes with
 * before go-live (some chapters need a fifth character for the site or the episode).
 */
export const ICD10AM_DIAGNOSES: CodedTerm[] = [
  // Infections
  { code: "A09.0", text: "Other and unspecified gastroenteritis and colitis of infectious origin" },
  { code: "A09.9", text: "Gastroenteritis and colitis of unspecified origin" },
  { code: "A15.0", text: "Tuberculosis of lung, confirmed by sputum microscopy" },
  { code: "A41.9", text: "Sepsis, unspecified" },
  { code: "A49.9", text: "Bacterial infection, unspecified" },
  { code: "B01.9", text: "Varicella without complication" },
  { code: "B02.9", text: "Zoster without complication" },
  { code: "B34.9", text: "Viral infection, unspecified" },
  { code: "B37.0", text: "Candidal stomatitis" },
  { code: "B86", text: "Scabies" },
  { code: "U07.1", text: "COVID-19, virus identified" },
  // Neoplasms
  { code: "C18.9", text: "Malignant neoplasm of colon, unspecified" },
  { code: "C34.9", text: "Malignant neoplasm of bronchus or lung, unspecified" },
  { code: "C50.9", text: "Malignant neoplasm of breast, unspecified" },
  { code: "C61", text: "Malignant neoplasm of prostate" },
  { code: "D25.9", text: "Leiomyoma of uterus, unspecified" },
  // Blood
  { code: "D50.9", text: "Iron deficiency anaemia, unspecified" },
  { code: "D56.1", text: "Beta thalassaemia" },
  { code: "D57.0", text: "Sickle-cell anaemia with crisis" },
  { code: "D57.1", text: "Sickle-cell anaemia without crisis" },
  { code: "D64.9", text: "Anaemia, unspecified" },
  { code: "D69.6", text: "Thrombocytopenia, unspecified" },
  // Endocrine and metabolic
  { code: "E03.9", text: "Hypothyroidism, unspecified" },
  { code: "E05.9", text: "Thyrotoxicosis, unspecified" },
  { code: "E10.9", text: "Type 1 diabetes mellitus without complication" },
  { code: "E11.9", text: "Type 2 diabetes mellitus without complication" },
  { code: "E11.65", text: "Type 2 diabetes mellitus with hyperglycaemia" },
  { code: "E55.9", text: "Vitamin D deficiency, unspecified" },
  { code: "E66.9", text: "Obesity, unspecified" },
  { code: "E78.0", text: "Pure hypercholesterolaemia" },
  { code: "E78.5", text: "Hyperlipidaemia, unspecified" },
  { code: "E87.1", text: "Hypo-osmolality and hyponatraemia" },
  { code: "E87.5", text: "Hyperkalaemia" },
  { code: "E87.6", text: "Hypokalaemia" },
  // Mental health
  { code: "F03", text: "Unspecified dementia" },
  { code: "F20.9", text: "Schizophrenia, unspecified" },
  { code: "F32.9", text: "Depressive episode, unspecified" },
  { code: "F41.1", text: "Generalised anxiety disorder" },
  { code: "F41.9", text: "Anxiety disorder, unspecified" },
  { code: "F51.0", text: "Nonorganic insomnia" },
  { code: "F90.0", text: "Disturbance of activity and attention" },
  // Nervous system
  { code: "G20", text: "Parkinson disease" },
  { code: "G40.9", text: "Epilepsy, unspecified" },
  { code: "G43.9", text: "Migraine, unspecified" },
  { code: "G44.2", text: "Tension-type headache" },
  { code: "G45.9", text: "Transient cerebral ischaemic attack, unspecified" },
  { code: "G47.3", text: "Sleep apnoea" },
  { code: "G51.0", text: "Bell palsy" },
  { code: "G56.0", text: "Carpal tunnel syndrome" },
  { code: "G62.9", text: "Polyneuropathy, unspecified" },
  // Eye and ear
  { code: "H10.9", text: "Conjunctivitis, unspecified" },
  { code: "H25.9", text: "Senile cataract, unspecified" },
  { code: "H40.9", text: "Glaucoma, unspecified" },
  { code: "H52.1", text: "Myopia" },
  { code: "H60.9", text: "Otitis externa, unspecified" },
  { code: "H61.2", text: "Impacted cerumen" },
  { code: "H65.9", text: "Nonsuppurative otitis media, unspecified" },
  { code: "H66.9", text: "Otitis media, unspecified" },
  { code: "H81.1", text: "Benign paroxysmal vertigo" },
  // Circulatory
  { code: "I10", text: "Essential (primary) hypertension" },
  { code: "I11.9", text: "Hypertensive heart disease without (congestive) heart failure" },
  { code: "I20.0", text: "Unstable angina" },
  { code: "I20.9", text: "Angina pectoris, unspecified" },
  { code: "I21.4", text: "Acute subendocardial myocardial infarction" },
  { code: "I21.9", text: "Acute myocardial infarction, unspecified" },
  { code: "I25.9", text: "Chronic ischaemic heart disease, unspecified" },
  { code: "I26.9", text: "Pulmonary embolism without mention of acute cor pulmonale" },
  { code: "I48.9", text: "Atrial fibrillation and atrial flutter, unspecified" },
  { code: "I50.0", text: "Congestive heart failure" },
  { code: "I50.9", text: "Heart failure, unspecified" },
  { code: "I61.9", text: "Intracerebral haemorrhage, unspecified" },
  { code: "I63.9", text: "Cerebral infarction, unspecified" },
  { code: "I64", text: "Stroke, not specified as haemorrhage or infarction" },
  { code: "I80.2", text: "Phlebitis and thrombophlebitis of other deep vessels of lower extremities" },
  { code: "I83.9", text: "Varicose veins of lower extremities without ulcer or inflammation" },
  { code: "I95.9", text: "Hypotension, unspecified" },
  // Respiratory
  { code: "J00", text: "Acute nasopharyngitis (common cold)" },
  { code: "J01.9", text: "Acute sinusitis, unspecified" },
  { code: "J02.9", text: "Acute pharyngitis, unspecified" },
  { code: "J03.9", text: "Acute tonsillitis, unspecified" },
  { code: "J04.0", text: "Acute laryngitis" },
  { code: "J06.9", text: "Acute upper respiratory infection, unspecified" },
  { code: "J10.1", text: "Influenza with other respiratory manifestations, seasonal influenza virus identified" },
  { code: "J11.1", text: "Influenza with other respiratory manifestations, virus not identified" },
  { code: "J12.9", text: "Viral pneumonia, unspecified" },
  { code: "J15.9", text: "Bacterial pneumonia, unspecified" },
  { code: "J18.9", text: "Pneumonia, unspecified" },
  { code: "J20.9", text: "Acute bronchitis, unspecified" },
  { code: "J21.9", text: "Acute bronchiolitis, unspecified" },
  { code: "J30.4", text: "Allergic rhinitis, unspecified" },
  { code: "J32.9", text: "Chronic sinusitis, unspecified" },
  { code: "J35.0", text: "Chronic tonsillitis" },
  { code: "J44.1", text: "Chronic obstructive pulmonary disease with acute exacerbation, unspecified" },
  { code: "J44.9", text: "Chronic obstructive pulmonary disease, unspecified" },
  { code: "J45.9", text: "Asthma, unspecified" },
  { code: "J46", text: "Status asthmaticus" },
  { code: "J90", text: "Pleural effusion, not elsewhere classified" },
  { code: "J93.9", text: "Pneumothorax, unspecified" },
  { code: "J96.0", text: "Acute respiratory failure" },
  // Digestive and dental
  { code: "K02.9", text: "Dental caries, unspecified" },
  { code: "K04.7", text: "Periapical abscess without sinus" },
  { code: "K05.1", text: "Chronic gingivitis" },
  { code: "K21.0", text: "Gastro-oesophageal reflux disease with oesophagitis" },
  { code: "K21.9", text: "Gastro-oesophageal reflux disease without oesophagitis" },
  { code: "K25.9", text: "Gastric ulcer, unspecified as acute or chronic, without haemorrhage or perforation" },
  { code: "K29.7", text: "Gastritis, unspecified" },
  { code: "K30", text: "Functional dyspepsia" },
  { code: "K35.80", text: "Acute appendicitis, unspecified" },
  { code: "K40.9", text: "Unilateral or unspecified inguinal hernia, without obstruction or gangrene" },
  { code: "K42.9", text: "Umbilical hernia without obstruction or gangrene" },
  { code: "K52.9", text: "Noninfective gastroenteritis and colitis, unspecified" },
  { code: "K56.6", text: "Other and unspecified intestinal obstruction" },
  { code: "K58.9", text: "Irritable bowel syndrome without diarrhoea" },
  { code: "K59.0", text: "Constipation" },
  { code: "K60.2", text: "Anal fissure, unspecified" },
  { code: "K64.9", text: "Haemorrhoids, unspecified" },
  { code: "K74.6", text: "Other and unspecified cirrhosis of liver" },
  { code: "K76.0", text: "Fatty (change of) liver, not elsewhere classified" },
  { code: "K80.20", text: "Calculus of gallbladder without cholecystitis, without mention of obstruction" },
  { code: "K81.0", text: "Acute cholecystitis" },
  { code: "K85.9", text: "Acute pancreatitis, unspecified" },
  { code: "K92.2", text: "Gastrointestinal haemorrhage, unspecified" },
  // Skin
  { code: "L01.0", text: "Impetigo" },
  { code: "L02.9", text: "Cutaneous abscess, furuncle and carbuncle, unspecified" },
  { code: "L03.9", text: "Cellulitis, unspecified" },
  { code: "L20.9", text: "Atopic dermatitis, unspecified" },
  { code: "L23.9", text: "Allergic contact dermatitis, unspecified cause" },
  { code: "L30.9", text: "Dermatitis, unspecified" },
  { code: "L40.0", text: "Psoriasis vulgaris" },
  { code: "L50.9", text: "Urticaria, unspecified" },
  { code: "L70.0", text: "Acne vulgaris" },
  // Musculoskeletal
  { code: "M06.9", text: "Rheumatoid arthritis, unspecified" },
  { code: "M10.9", text: "Gout, unspecified" },
  { code: "M16.9", text: "Coxarthrosis, unspecified" },
  { code: "M17.9", text: "Gonarthrosis, unspecified" },
  { code: "M19.9", text: "Arthrosis, unspecified" },
  { code: "M51.2", text: "Other specified intervertebral disc displacement" },
  { code: "M54.2", text: "Cervicalgia" },
  { code: "M54.4", text: "Lumbago with sciatica" },
  { code: "M54.5", text: "Low back pain" },
  { code: "M65.3", text: "Trigger finger" },
  { code: "M72.2", text: "Plantar fascial fibromatosis" },
  { code: "M75.1", text: "Rotator cuff syndrome" },
  { code: "M81.9", text: "Osteoporosis, unspecified" },
  // Kidney, urinary and reproductive
  { code: "N10", text: "Acute tubulo-interstitial nephritis" },
  { code: "N17.9", text: "Acute kidney failure, unspecified" },
  { code: "N18.3", text: "Chronic kidney disease, stage 3" },
  { code: "N18.5", text: "Chronic kidney disease, stage 5" },
  { code: "N18.9", text: "Chronic kidney disease, unspecified" },
  { code: "N20.0", text: "Calculus of kidney" },
  { code: "N20.1", text: "Calculus of ureter" },
  { code: "N23", text: "Unspecified renal colic" },
  { code: "N30.0", text: "Acute cystitis" },
  { code: "N39.0", text: "Urinary tract infection, site not specified" },
  { code: "N40", text: "Hyperplasia of prostate" },
  { code: "N63", text: "Unspecified lump in breast" },
  { code: "N76.0", text: "Acute vaginitis" },
  { code: "N92.0", text: "Excessive and frequent menstruation with regular cycle" },
  { code: "N94.6", text: "Dysmenorrhoea, unspecified" },
  { code: "N97.9", text: "Female infertility, unspecified" },
  // Pregnancy and newborn
  { code: "O13", text: "Gestational hypertension" },
  { code: "O14.9", text: "Pre-eclampsia, unspecified" },
  { code: "O20.0", text: "Threatened abortion" },
  { code: "O21.0", text: "Mild hyperemesis gravidarum" },
  { code: "O80", text: "Single spontaneous delivery" },
  { code: "P07.3", text: "Other preterm infants" },
  { code: "P59.9", text: "Neonatal jaundice, unspecified" },
  // Symptoms and signs
  { code: "R00.0", text: "Tachycardia, unspecified" },
  { code: "R04.0", text: "Epistaxis" },
  { code: "R05", text: "Cough" },
  { code: "R06.0", text: "Dyspnoea" },
  { code: "R07.4", text: "Chest pain, unspecified" },
  { code: "R10.4", text: "Other and unspecified abdominal pain" },
  { code: "R11", text: "Nausea and vomiting" },
  { code: "R21", text: "Rash and other nonspecific skin eruption" },
  { code: "R31", text: "Unspecified haematuria" },
  { code: "R42", text: "Dizziness and giddiness" },
  { code: "R50.9", text: "Fever, unspecified" },
  { code: "R51", text: "Headache" },
  { code: "R52.9", text: "Pain, unspecified" },
  { code: "R53", text: "Malaise and fatigue" },
  { code: "R55", text: "Syncope and collapse" },
  { code: "R56.0", text: "Febrile convulsions" },
  { code: "R60.0", text: "Localised oedema" },
  { code: "R63.4", text: "Abnormal weight loss" },
  { code: "R73.9", text: "Hyperglycaemia, unspecified" },
  // Injury and poisoning
  { code: "S52.50", text: "Fracture of lower end of radius, unspecified" },
  { code: "S61.9", text: "Open wound of wrist and hand, part unspecified" },
  { code: "S72.00", text: "Fracture of neck of femur, part unspecified" },
  { code: "S82.6", text: "Fracture of lateral malleolus" },
  { code: "S93.40", text: "Sprain and strain of ankle, part unspecified" },
  { code: "T30.0", text: "Burn of unspecified body region, unspecified degree" },
  { code: "T63.2", text: "Toxic effect of venom of scorpion" },
  { code: "T78.2", text: "Anaphylactic shock, unspecified" },
  { code: "T78.4", text: "Allergy, unspecified" },
  // Factors influencing health status
  { code: "Z00.0", text: "General medical examination" },
  { code: "Z30.0", text: "General counselling and advice on contraception" },
  { code: "Z49.1", text: "Extracorporeal dialysis" },
  { code: "Z51.1", text: "Chemotherapy session for neoplasm" },
  { code: "Z72.0", text: "Tobacco use" },
  { code: "Z88.0", text: "Personal history of allergy to penicillin" },
  { code: "Z95.1", text: "Presence of aortocoronary bypass graft" },
  { code: "Z99.2", text: "Dependence on renal dialysis" },
];

/** Where an allergen comes from. Decides the default category and the AL1-2 allergy type. */
export type AllergenGroup = "drug" | "food" | "substance";
export interface Allergen extends CodedTerm { group: AllergenGroup }

/**
 * Coded allergens (SNOMED CT substance codes) for the allergy search. The KSA allergy value sets
 * (CS-Allergy-Drug, -Food, -Substance) are published by NHIC, so check these codes against them before go-live.
 */
export const ALLERGENS: Allergen[] = [
  // Drugs
  { group: "drug", code: "764146007", text: "Penicillin" },
  { group: "drug", code: "372687004", text: "Amoxicillin" },
  { group: "drug", code: "387170002", text: "Ampicillin" },
  { group: "drug", code: "372670001", text: "Ceftriaxone" },
  { group: "drug", code: "372833007", text: "Cefuroxime" },
  { group: "drug", code: "372694001", text: "Erythromycin" },
  { group: "drug", code: "387487009", text: "Clarithromycin" },
  { group: "drug", code: "387531004", text: "Azithromycin" },
  { group: "drug", code: "372840008", text: "Ciprofloxacin" },
  { group: "drug", code: "387552007", text: "Levofloxacin" },
  { group: "drug", code: "372478003", text: "Doxycycline" },
  { group: "drug", code: "372809001", text: "Tetracycline" },
  { group: "drug", code: "372735009", text: "Vancomycin" },
  { group: "drug", code: "387321007", text: "Gentamicin" },
  { group: "drug", code: "372602008", text: "Metronidazole" },
  { group: "drug", code: "372786004", text: "Clindamycin" },
  { group: "drug", code: "387406002", text: "Sulfonamide" },
  { group: "drug", code: "387458008", text: "Aspirin" },
  { group: "drug", code: "387207008", text: "Ibuprofen" },
  { group: "drug", code: "372588000", text: "Naproxen" },
  { group: "drug", code: "7034005", text: "Diclofenac" },
  { group: "drug", code: "387517004", text: "Paracetamol" },
  { group: "drug", code: "387494007", text: "Codeine" },
  { group: "drug", code: "373529000", text: "Morphine" },
  { group: "drug", code: "386858008", text: "Tramadol" },
  { group: "drug", code: "387222003", text: "Carbamazepine" },
  { group: "drug", code: "387220006", text: "Phenytoin" },
  { group: "drug", code: "387562000", text: "Lamotrigine" },
  { group: "drug", code: "387135004", text: "Allopurinol" },
  { group: "drug", code: "386873009", text: "Lisinopril" },
  { group: "drug", code: "372658000", text: "Enalapril" },
  { group: "drug", code: "373444002", text: "Atorvastatin" },
  { group: "drug", code: "372877000", text: "Heparin" },
  { group: "drug", code: "372756006", text: "Warfarin" },
  { group: "drug", code: "67866001", text: "Insulin" },
  { group: "drug", code: "372567009", text: "Metformin" },
  { group: "drug", code: "387480006", text: "Lidocaine" },
  { group: "drug", code: "372487007", text: "Ondansetron" },
  { group: "drug", code: "372776000", text: "Metoclopramide" },
  { group: "drug", code: "387137007", text: "Omeprazole" },
  { group: "drug", code: "385420005", text: "Contrast media" },
  // Foods
  { group: "food", code: "102263004", text: "Eggs" },
  { group: "food", code: "762952008", text: "Peanut" },
  { group: "food", code: "3718001", text: "Cow's milk" },
  { group: "food", code: "412071004", text: "Wheat" },
  { group: "food", code: "29263009", text: "Gluten" },
  { group: "food", code: "735971005", text: "Fish" },
  { group: "food", code: "735029006", text: "Shellfish" },
  { group: "food", code: "762953003", text: "Tree nut" },
  { group: "food", code: "762954009", text: "Sesame seed" },
  { group: "food", code: "1144525004", text: "Soy" },
  { group: "food", code: "102261002", text: "Strawberry" },
  { group: "food", code: "102262009", text: "Chocolate" },
  { group: "food", code: "256350002", text: "Almond" },
  { group: "food", code: "226926008", text: "Kiwi fruit" },
  // Substances
  { group: "substance", code: "111088007", text: "Latex" },
  { group: "substance", code: "288328004", text: "Bee venom" },
  { group: "substance", code: "260147004", text: "House dust mite" },
  { group: "substance", code: "256277009", text: "Grass pollen" },
  { group: "substance", code: "256259004", text: "Pollen" },
  { group: "substance", code: "260152009", text: "Cat dander" },
  { group: "substance", code: "84489001", text: "Mould" },
  { group: "substance", code: "39920005", text: "Nickel" },
  { group: "substance", code: "44588005", text: "Iodine" },
  { group: "substance", code: "373568007", text: "Chlorhexidine" },
  { group: "substance", code: "409137002", text: "Adhesive" },
];

/** Common chief complaints as SNOMED CT findings, for the chief complaint search. */
export const SNOMED_COMPLAINTS: CodedTerm[] = [
  ...COMPLAINT_SAMPLES,
  { code: "422587007", text: "Nausea" },
  { code: "422400008", text: "Vomiting" },
  { code: "62315008", text: "Diarrhea" },
  { code: "14760008", text: "Constipation" },
  { code: "404640003", text: "Dizziness" },
  { code: "161891005", text: "Back pain" },
  { code: "81680005", text: "Neck pain" },
  { code: "30989003", text: "Knee pain" },
  { code: "57676002", text: "Joint pain" },
  { code: "162397003", text: "Sore throat" },
  { code: "84229001", text: "Fatigue" },
  { code: "13791008", text: "Weakness" },
  { code: "271807003", text: "Rash" },
  { code: "418290006", text: "Itching" },
  { code: "80313002", text: "Palpitations" },
  { code: "49650001", text: "Painful urination" },
  { code: "162116003", text: "Frequent urination" },
  { code: "34436003", text: "Blood in urine" },
  { code: "271594007", text: "Fainting" },
  { code: "56018004", text: "Wheezing" },
  { code: "64531003", text: "Runny nose" },
  { code: "16001004", text: "Ear pain" },
  { code: "27355003", text: "Toothache" },
  { code: "111516008", text: "Blurred vision" },
  { code: "89362005", text: "Weight loss" },
  { code: "79890006", text: "Loss of appetite" },
  { code: "193462001", text: "Insomnia" },
  { code: "48694002", text: "Anxiety" },
  { code: "267038008", text: "Swelling" },
  { code: "289530006", text: "Vaginal bleeding" },
  { code: "91175000", text: "Seizure" },
  { code: "286933003", text: "Confusion" },
  { code: "44077006", text: "Numbness" },
  { code: "16331000", text: "Heartburn" },
  { code: "249366005", text: "Nosebleed" },
  { code: "1912002", text: "Fall" },
  { code: "125666000", text: "Burn" },
];

/**
 * Value lists for the allergy form, from the HIS lookups (Allergy Category, Allergy Type, Allergy Clinical Status, Allergy Verification Status,
 * Allergy Criticality, Allergy Source Type, Allergy Exposure Route, Allergy Reaction Outcome). The category keeps its stored value and shows the HIS label.
 */
export const ALLERGY_CATEGORIES: { value: "Medication" | "Food" | "Environment"; label: string }[] = [
  { value: "Medication", label: "Drug Allergy" },
  { value: "Food", label: "Food Allergy" },
  { value: "Environment", label: "Allergy (Other Than Drug Or Food)" },
];
export const ALLERGY_REACTION_TYPES = ["Allergy", "Intolerance"] as const;
export const ALLERGY_CLINICAL_STATUSES = ["Active", "Inactive", "Resolved"] as const;
export const ALLERGY_VERIFICATION = ["Unconfirmed", "Confirmed", "Refuted", "Entered In Error"] as const;
export const ALLERGY_CRITICALITY = ["Low", "High", "Unable To Assess"] as const;
export const ALLERGY_SOURCES = ["Patient Reported", "Clinician Observed", "Imported Record", "Other"];
export const EXPOSURE_ROUTES = ["Ingestion", "Injection", "Topical", "Inhalation", "Other", "Unknown"];
export const REACTION_OUTCOMES = ["Recovered", "Ongoing", "Unknown"];

/** Made-up patients. No real people. */
const RAW_PATIENTS: Omit<Patient, "healthId" | "nationality" | "maritalStatus" | "address">[] = [
  { id: "P001", mrn: "MRN0000101", nationalId: "1000000011", family: "Almutairi", given: "Saad", dob: "1968-03-14", sex: "M" },
  { id: "P002", mrn: "MRN0000102", nationalId: "1000000029", family: "Alghamdi", given: "Reem", dob: "1991-07-02", sex: "F" },
  { id: "P003", mrn: "MRN0000103", nationalId: "1000000037", family: "Alsubaie", given: "Yousef", dob: "1955-11-23", sex: "M" },
  { id: "P004", mrn: "MRN0000104", nationalId: "1000000045", family: "Alanazi", given: "Layla", dob: "1984-01-30", sex: "F" },
  { id: "P005", mrn: "MRN0000105", nationalId: "1000000052", family: "Aldosari", given: "Majed", dob: "1977-09-09", sex: "M" },
  { id: "P006", mrn: "MRN0000106", nationalId: "1000000060", family: "Alrashid", given: "Dana", dob: "2001-05-18", sex: "F" },
  { id: "P007", mrn: "MRN0000107", nationalId: "1000000078", family: "Almalki", given: "Turki", dob: "1949-12-01", sex: "M" },
  { id: "P008", mrn: "MRN0000108", nationalId: "1000000086", family: "Alshammari", given: "Hanan", dob: "1996-04-26", sex: "F" },
  { id: "P009", mrn: "MRN0000109", nationalId: "1000000094", family: "Alyami", given: "Bader", dob: "1989-08-15", sex: "M" },
  { id: "P010", mrn: "MRN0000110", nationalId: "1000000102", family: "Alsalem", given: "Mona", dob: "1972-02-07", sex: "F" },
  { id: "P011", mrn: "MRN0000111", nationalId: "1000000110", family: "Alharthi", given: "Ahmed", dob: "1999-06-21", sex: "M" },
  { id: "P012", mrn: "MRN0000112", nationalId: "1000000128", family: "Alsaif", given: "Lina", dob: "1987-10-03", sex: "F" },
  { id: "P013", mrn: "MRN0000113", nationalId: "1000000136", family: "Albishi", given: "Rakan", dob: "2012-04-17", sex: "M" },
  { id: "P014", mrn: "MRN0000114", nationalId: "1000000144", family: "Almansour", given: "Faisal", dob: "1961-12-12", sex: "M" },
];

export const SEED_PATIENTS: Patient[] = RAW_PATIENTS.map((p, i) => ({
  ...p,
  healthId: String(1090000001 + i * 13),
  nationality: i === 6 ? "EGY" : "SAU",
  maritalStatus: "SMMDWSMMSM"[i % 10],
  address: `RHAD${String(3100 + i * 7)}`,
  confidential: p.id === "P010" || p.id === "P003",
}));
