import type { Bed, Doctor, Dx, Pr, Allergy, Patient } from "./model";

export const FACILITY = "DEMO-HOSP-01";

/** OIDs from the NPHIES-CS integration guide, except PARTICIPANT, which is a made-up demo value. */
export const OID = {
  healthId: "2.16.840.1.113883.3.3731.1.1.100.1",
  provider: "2.16.840.1.113883.3.3731.1.2.1",
  nphiesApp: "2.16.840.1.113883.3.3731.1.2.2",
  participant: "2.16.840.1.113883.3.3731.9999.1",
  /** National Organization OID for ORU (format 2.16.840.1.113883.3.3731.XXXX). Made-up demo value. */
  nationalOrg: "2.16.840.1.113883.3.3731.5.1.15000000999999",
} as const;

export const NATIONALITIES = [
  { code: "682", label: "Saudi Arabia" },
  { code: "818", label: "Egypt" },
  { code: "356", label: "India" },
  { code: "586", label: "Pakistan" },
  { code: "608", label: "Philippines" },
  { code: "887", label: "Yemen" },
  { code: "760", label: "Syria" },
  { code: "999", label: "Unknown" },
];

export const MARITAL = [
  { code: "S", label: "Single" },
  { code: "M", label: "Married" },
  { code: "D", label: "Divorced" },
  { code: "W", label: "Widowed" },
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

export const SERVICES: { code: string; label: string }[] = [
  { code: "MED", label: "Medicine" },
  { code: "SUR", label: "Surgery" },
  { code: "ICU", label: "Intensive Care" },
  { code: "ORT", label: "Orthopedics" },
  { code: "RAD", label: "Radiology" },
  { code: "LAB", label: "Laboratory" },
  { code: "OPD", label: "Outpatient Clinic" },
  { code: "ER", label: "Emergency" },
];

export const DISPOSITIONS: { code: string; label: string }[] = [
  { code: "01", label: "01 Home or self care" },
  { code: "02", label: "02 Another hospital" },
  { code: "06", label: "06 Home with health service" },
  { code: "07", label: "07 Left against advice" },
  { code: "20", label: "20 Expired" },
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

export const PR_SAMPLES: Pr[] = [
  { code: "44970-00", text: "Laparoscopic appendicectomy" },
  { code: "90661-00", text: "Chest X-ray" },
  { code: "38497-00", text: "Coronary angiography" },
  { code: "47519-00", text: "Hip arthroplasty" },
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

export const ALLERGY_SAMPLES: Allergy[] = [
  { text: "Penicillin", severity: "SV", reaction: "Rash" },
  { text: "Latex", severity: "MO", reaction: "Hives" },
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
  nationality: i === 6 ? "818" : "682",
  maritalStatus: "SMMDWSMMSM"[i % 10],
  address: `RHAD${String(3100 + i * 7)}`,
  confidential: p.id === "P010" || p.id === "P003",
}));
