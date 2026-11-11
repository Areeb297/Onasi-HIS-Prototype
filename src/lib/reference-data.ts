import type { Bed, Doctor, Dx, Pr, Allergy, Patient } from "./model";
import { VS, VS_ADMISSION_METHOD, VS_COUNTRY, vsLabel } from "./nphies-valuesets";

export const FACILITY = "DEMO-HOSP-01";

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
export const ADT_APP_OID = `${ORG_OID}.1`;

/** OIDs from the NPHIES-CS integration guide, except participant and nationalOrg, which are made-up demo values. */
export const OID = {
  healthId: "2.16.840.1.113883.3.3731.1.1.100.1",
  provider: "2.16.840.1.113883.3.3731.1.2.1",
  nphiesApp: "2.16.840.1.113883.3.3731.1.2.2",
  /** Older demo root still used by the FHIR and CDA builders. HL7 v2 messages use ORG_OID. */
  participant: "2.16.840.1.113883.3.3731.9999.1",
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
