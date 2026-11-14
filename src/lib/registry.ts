/**
 * Simulated national registry and insurance eligibility, for the registration form.
 *
 * In a real HIS:
 * - The Health ID comes from the NHIC Patient Registry (NPHIES PID-3 needs it).
 * - The insurance card is an eligibility check with the payer through NPHIES financial services
 *   (a different guide from the UHR pages this project read).
 * - The ID card data comes from the national identity services.
 * All people and policies below are made up.
 */

export interface InsuranceCard {
  payer: string;
  policyNo: string;
  memberId: string;
  className: string;
  network: string;
  startDate: string; // yyyy-mm-dd
  expiryDate: string;
  copayPercent: number;
  status: "Active" | "Expired";
  /** What the payer answered for an active card. Covered when empty. */
  coverage?: "Covered" | "Not Covered" | "Out Of Network" | "Limit Exhausted";
}

export interface IdCard {
  idType: "National ID" | "Iqama";
  idNumber: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  copyNo: string;
  placeOfBirth: string;
}

export interface RegistryPerson {
  idNumber: string;
  idType: "National ID" | "Iqama";
  first: string;
  second: string;
  third: string;
  family: string;
  firstAr: string;
  secondAr: string;
  thirdAr: string;
  familyAr: string;
  dob: string;
  sex: "M" | "F";
  nationality: string;
  maritalStatus: string;
  religion: string;
  bloodGroup: string;
  healthId: string;
  mobile: string;
  address: string;
  occupation: string;
  idCard: IdCard;
  insurance?: InsuranceCard;
}

const card = (idType: IdCard["idType"], idNumber: string, issuer: string, issue: string, expiry: string, place: string): IdCard => ({
  idType, idNumber, issuer, issueDate: issue, expiryDate: expiry, copyNo: "01", placeOfBirth: place,
});

/**
 * Saad, Reem and Yousef are already patients of the hospital (same ID number and Health ID as the seed patients),
 * so registering them again shows the duplicate check. The other people are new to the hospital.
 */
export const REGISTRY: RegistryPerson[] = [
  {
    idNumber: "1000000011", idType: "National ID", first: "Saad", second: "Fahad", third: "Nasser", family: "Almutairi",
    firstAr: "سعد", secondAr: "فهد", thirdAr: "ناصر", familyAr: "المطيري", dob: "1968-03-14", sex: "M", nationality: "682",
    maritalStatus: "M", religion: "Islam", bloodGroup: "O+", healthId: "1090000001", mobile: "0500000011", address: "RHAD3100",
    occupation: "Engineer", idCard: card("National ID", "1000000011", "Ministry of Interior", "2021-02-10", "2031-02-09", "Riyadh"),
    insurance: { payer: "Bupa Arabia", policyNo: "POL-48210", memberId: "MEM-7710021", className: "Class A", network: "Gold Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 10, status: "Active" },
  },
  {
    idNumber: "1000000029", idType: "National ID", first: "Reem", second: "Khalid", third: "Omar", family: "Alghamdi",
    firstAr: "ريم", secondAr: "خالد", thirdAr: "عمر", familyAr: "الغامدي", dob: "1991-07-02", sex: "F", nationality: "682",
    maritalStatus: "S", religion: "Islam", bloodGroup: "A+", healthId: "1090000014", mobile: "0500000029", address: "RHAD3107",
    occupation: "Teacher", idCard: card("National ID", "1000000029", "Ministry of Interior", "2020-06-01", "2030-05-31", "Jeddah"),
    insurance: { payer: "Tawuniya", policyNo: "POL-33905", memberId: "MEM-4402918", className: "Class B", network: "Silver Network", startDate: "2025-03-01", expiryDate: "2026-02-28", copayPercent: 20, status: "Expired" },
  },
  {
    idNumber: "2000000037", idType: "Iqama", first: "Ahmed", second: "Mahmoud", third: "Hassan", family: "Ibrahim",
    firstAr: "أحمد", secondAr: "محمود", thirdAr: "حسن", familyAr: "إبراهيم", dob: "1984-01-30", sex: "M", nationality: "818",
    maritalStatus: "M", religion: "Islam", bloodGroup: "B+", healthId: "1090000503", mobile: "0500000037", address: "RHAD3114",
    occupation: "Accountant", idCard: card("Iqama", "2000000037", "Passports Directorate", "2025-04-12", "2026-12-20", "Cairo"),
    insurance: { payer: "MedGulf", policyNo: "POL-90117", memberId: "MEM-1180334", className: "Class A", network: "Gold Network", startDate: "2026-04-15", expiryDate: "2027-04-14", copayPercent: 10, status: "Active" },
  },
  {
    idNumber: "2000000045", idType: "Iqama", first: "Maria", second: "Santos", third: "Cruz", family: "Reyes",
    firstAr: "ماريا", secondAr: "سانتوس", thirdAr: "كروز", familyAr: "ريس", dob: "1990-09-09", sex: "F", nationality: "608",
    maritalStatus: "S", religion: "Christianity", bloodGroup: "AB+", healthId: "1090000516", mobile: "0500000045", address: "RHAD3121",
    occupation: "Nurse", idCard: card("Iqama", "2000000045", "Passports Directorate", "2024-08-01", "2026-07-31", "Manila"),
  },
  {
    idNumber: "1000000037", idType: "National ID", first: "Yousef", second: "Ali", third: "Salem", family: "Alsubaie",
    firstAr: "يوسف", secondAr: "علي", thirdAr: "سالم", familyAr: "السبيعي", dob: "1955-11-23", sex: "M", nationality: "682",
    maritalStatus: "W", religion: "Islam", bloodGroup: "O-", healthId: "1090000027", mobile: "0500000052", address: "RHAD3128",
    occupation: "Retired", idCard: card("National ID", "1000000037", "Ministry of Interior", "2019-01-05", "2029-01-04", "Dammam"),
    insurance: { payer: "Tawuniya", policyNo: "POL-12034", memberId: "MEM-9921877", className: "VIP", network: "Platinum Network", startDate: "2026-02-01", expiryDate: "2027-01-31", copayPercent: 0, status: "Active" },
  },
  {
    idNumber: "1000000201", idType: "National ID", first: "Abdullah", second: "Saleh", third: "Mohammed", family: "Alotaibi",
    firstAr: "عبدالله", secondAr: "صالح", thirdAr: "محمد", familyAr: "العتيبي", dob: "1979-05-20", sex: "M", nationality: "682",
    maritalStatus: "M", religion: "Islam", bloodGroup: "A-", healthId: "1090000542", mobile: "0500000201", address: "RHAD3135",
    occupation: "Driver", idCard: card("National ID", "1000000201", "Ministry of Interior", "2022-03-01", "2032-02-28", "Taif"),
    insurance: { payer: "Bupa Arabia", policyNo: "POL-55120", memberId: "MEM-3306712", className: "Class C", network: "Bronze Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 20, status: "Active", coverage: "Out Of Network" },
  },
  {
    idNumber: "1000000219", idType: "National ID", first: "Noura", second: "Ibrahim", third: "Abdulaziz", family: "Alqahtani",
    firstAr: "نورة", secondAr: "إبراهيم", thirdAr: "عبدالعزيز", familyAr: "القحطاني", dob: "1963-08-11", sex: "F", nationality: "682",
    maritalStatus: "M", religion: "Islam", bloodGroup: "B-", healthId: "1090000555", mobile: "0500000219", address: "RHAD3142",
    occupation: "Retired", idCard: card("National ID", "1000000219", "Ministry of Interior", "2023-09-15", "2033-09-14", "Abha"),
    insurance: { payer: "Tawuniya", policyNo: "POL-70443", memberId: "MEM-6120985", className: "Class B", network: "Silver Network", startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent: 20, status: "Active", coverage: "Limit Exhausted" },
  },
  {
    idNumber: "2000000227", idType: "Iqama", first: "Rajesh", second: "Kumar", third: "Anil", family: "Sharma",
    firstAr: "راجيش", secondAr: "كومار", thirdAr: "أنيل", familyAr: "شارما", dob: "1988-12-04", sex: "M", nationality: "356",
    maritalStatus: "M", religion: "Hinduism", bloodGroup: "O+", healthId: "1090000568", mobile: "0500000227", address: "RHAD3149",
    occupation: "Technician", idCard: card("Iqama", "2000000227", "Passports Directorate", "2025-11-01", "2027-10-31", "Mumbai"),
    insurance: { payer: "MedGulf", policyNo: "POL-81276", memberId: "MEM-2057741", className: "Class C", network: "Bronze Network", startDate: "2026-06-01", expiryDate: "2027-05-31", copayPercent: 20, status: "Active", coverage: "Not Covered" },
  },
];

export function lookupById(idNumber: string): RegistryPerson | undefined {
  return REGISTRY.find((p) => p.idNumber === idNumber.trim());
}

/** Eligibility check for a patient by ID number. Active or expired cards both come back, as a real payer would return. */
export function retrieveInsurance(idNumber: string): InsuranceCard | undefined {
  return lookupById(idNumber)?.insurance;
}

export function retrieveIdCard(idNumber: string): IdCard | undefined {
  return lookupById(idNumber)?.idCard;
}

/** The four-part Arabic name of a registry person, as one line. */
export function registryNameAr(p: RegistryPerson): string {
  return [p.firstAr, p.secondAr, p.thirdAr, p.familyAr].filter(Boolean).join(" ");
}

/** Gregorian date (yyyy-mm-dd) as a Hijri date text, using the Umm al-Qura calendar. */
export function hijri(date: string): string {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date)).replace(/\s*AH/i, "");
  } catch {
    return "";
  }
}

export function isExpired(date: string): boolean {
  return !!date && new Date(date).getTime() < Date.now();
}
