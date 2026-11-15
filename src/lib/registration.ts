import { ageInMonths, ageText } from "./ctas";
import type { Patient, PatientFlags } from "./model";
import { lookupById, type InsuranceCard } from "./registry";

/**
 * Rules for the registration desk, kept free of screens so they can be tested:
 * the duplicate patient check, the coverage answer in plain words, the safety flags and the form checks.
 *
 * Assumptions (not from the NPHIES ADT pages, which do not cover them):
 *  - Two files are treated as the same person when the ID number or the Health ID is the same,
 *    or when the date of birth is the same together with the name or the mobile number.
 *  - The coverage answers (not covered, out of network, limit exhausted) are simulated. A real HIS reads them
 *    from the NPHIES financial eligibility response.
 */

/* ---------- names and age ---------- */

/** The Arabic name on the patient file as one line. Empty when none was entered. */
export function arabicName(p: Pick<Patient, "extra"> | undefined): string {
  const n = p?.extra?.nameAr;
  if (!n) return "";
  return [n.first, n.second, n.third, n.family].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
}

/** Age in words from the date of birth, for example "58 years" or "7 months". Empty when the date is missing or not valid. */
export function ageLabel(dob: string, now: Date = new Date()): string {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return "";
  return ageText(ageInMonths(dob, now));
}

/* ---------- duplicate check ---------- */

export type DuplicateReason = "id" | "healthId" | "name-dob" | "phone-dob";

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  id: "Same ID number",
  healthId: "Same Health ID",
  "name-dob": "Same name and date of birth",
  "phone-dob": "Same mobile number and date of birth",
};

export interface DuplicateCandidate {
  idNumber?: string;
  healthId?: string;
  given?: string;
  family?: string;
  /** Arabic first and family names, when entered. */
  givenAr?: string;
  familyAr?: string;
  dob?: string;
  mobile?: string;
}

export interface DuplicateMatch {
  patient: Patient;
  reasons: DuplicateReason[];
}

const clean = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** A phone number as its last 9 digits, so 0500000011, +966500000011 and 500000011 are the same number. */
export function phoneKey(phone: string | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "").replace(/^966/, "").replace(/^0+/, "");
  return digits.length >= 7 ? digits.slice(-9) : "";
}

/** Patients already on file who look like the person being registered. The strongest matches come first. */
export function findDuplicates(c: DuplicateCandidate, patients: Patient[]): DuplicateMatch[] {
  const id = clean(c.idNumber);
  const healthId = clean(c.healthId);
  const name = clean(c.given) && clean(c.family) ? `${clean(c.given)} ${clean(c.family)}` : "";
  const nameAr = clean(c.givenAr) && clean(c.familyAr) ? `${clean(c.givenAr)} ${clean(c.familyAr)}` : "";
  const phone = phoneKey(c.mobile);
  const dob = (c.dob ?? "").trim();

  const out: DuplicateMatch[] = [];
  for (const p of patients) {
    const reasons: DuplicateReason[] = [];
    if (id && (clean(p.extra?.idNumber) === id || clean(p.nationalId) === id)) reasons.push("id");
    if (healthId && clean(p.healthId) === healthId) reasons.push("healthId");
    if (dob && p.dob === dob) {
      const pAr = p.extra?.nameAr;
      const sameName = !!name && `${clean(p.given)} ${clean(p.family)}` === name;
      const sameNameAr = !!nameAr && !!pAr && `${clean(pAr.first)} ${clean(pAr.family)}` === nameAr;
      if (sameName || sameNameAr) reasons.push("name-dob");
      if (phone && phoneKey(p.extra?.mobile) === phone) reasons.push("phone-dob");
    }
    if (reasons.length) out.push({ patient: p, reasons });
  }
  const strong = (m: DuplicateMatch) => (m.reasons.includes("id") || m.reasons.includes("healthId") ? 1 : 0);
  return out.sort((a, b) => strong(b) - strong(a) || b.reasons.length - a.reasons.length);
}

/* ---------- coverage ---------- */

export type CoverageKind = "covered" | "limit-exhausted" | "not-active" | "not-covered" | "out-of-network" | "no-insurance";

export interface CoverageOutcome {
  kind: CoverageKind;
  /** The visit must not be saved as an insurance visit until the clerk decides what to do. */
  blocking: boolean;
  /** A warning to show, while saving is still allowed. */
  warning: boolean;
  title: string;
  titleAr: string;
  text: string;
  textAr: string;
}

/** The payer answer in plain words. `today` is yyyy-mm-dd. A missing card means no insurance was found. */
export function coverageOutcome(card: InsuranceCard | null | undefined, today: string): CoverageOutcome {
  const mk = (kind: CoverageKind, title: string, titleAr: string, text: string, textAr: string): CoverageOutcome => ({
    kind, blocking: kind !== "covered" && kind !== "limit-exhausted", warning: kind === "limit-exhausted", title, titleAr, text, textAr,
  });
  if (!card) {
    return mk("no-insurance", "No Insurance Found", "لا يوجد تأمين",
      "No insurance policy was found for this ID number.", "لم يتم العثور على وثيقة تأمين لرقم الهوية هذا.");
  }
  const notStarted = !!card.startDate && card.startDate > today;
  const ended = !!card.expiryDate && card.expiryDate < today;
  if (card.status !== "Active" || ended || notStarted) {
    return mk("not-active", "Insurance Not Active", "التأمين غير ساري",
      notStarted
        ? `The ${card.payer} policy starts on ${card.startDate}. It does not cover a visit today.`
        : `The ${card.payer} policy ended on ${card.expiryDate}. It does not cover a visit today.`,
      notStarted ? `وثيقة ${card.payer} تبدأ في ${card.startDate} ولا تغطي زيارة اليوم.` : `وثيقة ${card.payer} انتهت في ${card.expiryDate} ولا تغطي زيارة اليوم.`);
  }
  if (card.coverage === "Not Covered") {
    return mk("not-covered", "Not Covered", "غير مغطى",
      `${card.payer} answered that this patient is not covered for care at this hospital.`, `أفادت ${card.payer} أن المريض غير مغطى للعلاج في هذا المستشفى.`);
  }
  if (card.coverage === "Out Of Network") {
    return mk("out-of-network", "Out Of Network", "خارج الشبكة",
      `This hospital is not in the patient's ${card.network} with ${card.payer}. The payer will not pay for the visit.`,
      `هذا المستشفى ليس ضمن شبكة المريض (${card.network}) لدى ${card.payer}. لن تدفع شركة التأمين تكلفة الزيارة.`);
  }
  if (card.coverage === "Limit Exhausted") {
    return mk("limit-exhausted", "Yearly Limit Used Up", "تم استنفاد الحد السنوي",
      `The policy with ${card.payer} is active, but the yearly limit is used up. The patient may have to pay. Tell the patient before the visit starts.`,
      `وثيقة ${card.payer} سارية لكن الحد السنوي مستنفد. قد يدفع المريض التكلفة. أخبر المريض قبل بدء الزيارة.`);
  }
  return mk("covered", "Covered", "مغطى",
    `${card.payer} covers this patient. The patient pays ${card.copayPercent}% of the bill.`, `${card.payer} تغطي هذا المريض. يدفع المريض ${card.copayPercent}% من الفاتورة.`);
}

/* ---------- safety flags ---------- */

export interface FlagView {
  id: "dnr" | "interpreter" | "fallRisk" | "isolation";
  label: string;
  /** Extra words for the banner, for example the doctor and date of a Do Not Resuscitate order. */
  detail?: string;
  tone: "danger" | "warn" | "info";
}

export const INTERPRETER_LANGUAGES = ["English", "Urdu", "Hindi", "Bengali", "Tagalog", "Indonesian", "Malayalam", "Amharic", "Sign Language", "Other"];

/** The flags on a patient file as labelled badges, most serious first. */
export function flagViews(flags: PatientFlags | undefined): FlagView[] {
  if (!flags) return [];
  const out: FlagView[] = [];
  if (flags.dnr) out.push({ id: "dnr", label: "Do Not Resuscitate", detail: [flags.dnr.doctor, flags.dnr.date].filter(Boolean).join(", "), tone: "danger" });
  if (flags.isolation) out.push({ id: "isolation", label: "Isolation", tone: "warn" });
  if (flags.fallRisk) out.push({ id: "fallRisk", label: "Fall Risk", tone: "warn" });
  if (flags.interpreter) out.push({ id: "interpreter", label: flags.interpreter.language ? `Needs Interpreter: ${flags.interpreter.language}` : "Needs Interpreter", tone: "info" });
  return out;
}

/* ---------- lists for the form ---------- */

export const TITLES = ["Mr", "Mrs", "Miss", "Ms", "Dr", "Baby"];

/** The usual title for the sex and marital status, the way the HIS fills it in until the clerk picks one. */
export function defaultTitle(sex: "M" | "F", marital: string, newborn = false): string {
  if (newborn) return "Baby";
  if (sex === "M") return "Mr";
  if (marital === "M" || marital === "W" || marital === "D" || marital === "A") return "Mrs";
  if (marital === "S") return "Miss";
  return "Ms";
}

/** Saudi regions with their main cities, for the State / Region and City fields. */
export const SAUDI_REGIONS: { region: string; cities: string[] }[] = [
  { region: "Riyadh", cities: ["Riyadh", "Al Kharj", "Ad Diriyah", "Al Majmaah", "Wadi Ad Dawasir"] },
  { region: "Makkah", cities: ["Makkah", "Jeddah", "Taif", "Rabigh", "Al Qunfudhah"] },
  { region: "Madinah", cities: ["Madinah", "Yanbu", "Al Ula", "Badr"] },
  { region: "Eastern Province", cities: ["Dammam", "Al Khobar", "Dhahran", "Al Ahsa", "Jubail", "Hafar Al Batin", "Qatif"] },
  { region: "Asir", cities: ["Abha", "Khamis Mushait", "Bisha", "An Namas"] },
  { region: "Qassim", cities: ["Buraydah", "Unaizah", "Ar Rass"] },
  { region: "Tabuk", cities: ["Tabuk", "Duba", "Al Wajh"] },
  { region: "Hail", cities: ["Hail", "Baqaa"] },
  { region: "Jazan", cities: ["Jazan", "Sabya", "Abu Arish"] },
  { region: "Najran", cities: ["Najran", "Sharurah"] },
  { region: "Al Baha", cities: ["Al Baha", "Baljurashi"] },
  { region: "Al Jouf", cities: ["Sakaka", "Dumat Al Jandal", "Qurayyat"] },
  { region: "Northern Borders", cities: ["Arar", "Rafha", "Turaif"] },
];

/**
 * Admission types. Each one sets PV1-4 (CS-Adm-AdmissionMethod), so the message says how the patient came in.
 * The match from the HIS words to the published codes is our choice: confirm it with the facility.
 */
export const ADMISSION_TYPES: { label: string; method: string }[] = [
  { label: "Elective", method: "14" },
  { label: "Emergency", method: "15" },
  { label: "Urgent", method: "01" },
  { label: "Maternity, Planned", method: "13" },
  { label: "Maternity, Emergency", method: "12" },
  { label: "Newborn", method: "N" },
];

export const PATIENT_CONDITIONS = ["Stable", "Fair", "Serious", "Critical"];
export const ACTIVITY_LEVELS = ["Bed Rest", "Up With Help", "Up As Tolerated", "Walks Freely"];
export const ADMISSION_SPECIALTIES = [
  "Internal Medicine", "General Surgery", "Orthopedics", "Cardiology", "Intensive Care", "Neurology", "Obstetrics And Gynecology",
  "Pediatrics", "Neonatology", "Urology", "Nephrology", "Pulmonology",
];

/* ---------- Health ID from the registry ---------- */

export type HealthIdAnswer = { ok: true; healthId: string } | { ok: false; message: string };

/**
 * Fetch Health ID: asks the national registry with the ID number and the date of birth, as the HIS does.
 * Simulated with the same registry the ID lookup uses. Both must match a person.
 */
export function fetchHealthId(idNumber: string, dob: string, today: string): HealthIdAnswer {
  const id = idNumber.trim();
  if (!/^\d{10}$/.test(id)) return { ok: false, message: "Enter the 10 digit ID number first." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob > today) return { ok: false, message: "Enter a valid date of birth first." };
  const p = lookupById(id);
  if (!p || p.dob !== dob || !p.healthId) return { ok: false, message: "No Health ID was returned by the registry. Check the ID number and the date of birth." };
  return { ok: true, healthId: p.healthId };
}

/* ---------- form checks ---------- */

export type VisitChoice = "none" | "O" | "I" | "E";

export type RegField =
  | "idNumber" | "first" | "family" | "dob" | "mobile" | "email" | "shortCode" | "healthId" | "bedId"
  | "dnrDoctor" | "dnrDate" | "language" | "consent"
  | "title" | "nickName" | "parentId" | "addressLine1" | "admissionType" | "patientCondition" | "expectedStay";

export interface RegistrationInput {
  idNumber: string;
  healthId: string;
  first: string;
  family: string;
  dob: string;
  mobile: string;
  email: string;
  /** National address short code. Empty is allowed. */
  shortCode: string;
  consent: boolean;
  visit: VisitChoice;
  bedId: string;
  dnr: boolean;
  dnrDoctor: string;
  dnrDate: string;
  interpreter: boolean;
  language: string;
  /** yyyy-mm-dd */
  today: string;
  /** Address Line 1. Required, except for an unknown patient. */
  addressLine1?: string;
  title?: string;
  /** Confidential patient: a nick name is required. */
  confidential?: boolean;
  nickName?: string;
  /** Newborn: the parent (a patient already on file) is required. The ID number is not: a baby often has none yet. */
  newborn?: boolean;
  parentId?: string;
  /** Unknown or unconscious emergency patient: only the title and the sex are required. */
  unknown?: boolean;
  /** Inpatient: admission type and patient condition are required. Expected stay is optional, in whole days. */
  admissionType?: string;
  patientCondition?: string;
  expectedStay?: string;
}

export interface FieldProblem {
  field: RegField;
  message: string;
  messageAr: string;
}

const SHORT_ADDRESS = /^[A-Z]{4}\d{4}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What stops the registration from being saved, one line per field, in the order of the form. */
export function validateRegistration(i: RegistrationInput): FieldProblem[] {
  const out: FieldProblem[] = [];
  const add = (field: RegField, message: string, messageAr: string) => out.push({ field, message, messageAr });
  const unknown = !!i.unknown;
  const s = (v: string | undefined) => (v ?? "").trim();
  if (!unknown && !i.newborn && !i.idNumber.trim()) add("idNumber", "Enter the ID number.", "أدخل رقم الهوية.");
  if (i.newborn && !unknown && !s(i.parentId)) add("parentId", "Pick the parent of the newborn.", "اختر أحد والدي المولود.");
  if (i.visit === "I" && !i.bedId) add("bedId", "Pick a bed for the admission.", "اختر سريرا للتنويم.");
  if (i.visit === "I" && !s(i.admissionType)) add("admissionType", "Pick the admission type.", "اختر نوع التنويم.");
  if (i.visit === "I" && !s(i.patientCondition)) add("patientCondition", "Pick the patient condition.", "اختر حالة المريض.");
  if (i.visit === "I" && s(i.expectedStay) && !/^\d{1,3}$/.test(s(i.expectedStay))) add("expectedStay", "The expected stay is a whole number of days.", "مدة الإقامة المتوقعة عدد صحيح من الأيام.");
  if (unknown && !s(i.title)) add("title", "Pick a title. It is required for an unknown patient.", "اختر اللقب. هو مطلوب للمريض المجهول.");
  if (!unknown && !i.first.trim()) add("first", "Enter the first name.", "أدخل الاسم الأول.");
  if (!unknown && !i.family.trim()) add("family", "Enter the family name.", "أدخل اسم العائلة.");
  if (i.confidential && !s(i.nickName)) add("nickName", "Enter a nick name for the confidential patient.", "أدخل اسما مستعارا للمريض السري.");
  if (!unknown && !i.dob) add("dob", "Enter the date of birth.", "أدخل تاريخ الميلاد.");
  else if (i.dob && i.dob > i.today) add("dob", "The date of birth cannot be in the future.", "تاريخ الميلاد لا يمكن أن يكون في المستقبل.");
  if (!unknown && !s(i.addressLine1)) add("addressLine1", "Enter Address Line 1.", "أدخل سطر العنوان الأول.");
  if (i.shortCode && !SHORT_ADDRESS.test(i.shortCode)) add("shortCode", "The short address is 4 capital letters then 4 digits.", "العنوان المختصر 4 أحرف كبيرة ثم 4 أرقام.");
  if (!unknown && !i.mobile.trim()) add("mobile", "Enter the mobile number.", "أدخل رقم الجوال.");
  else if (i.mobile.trim() && !phoneKey(i.mobile)) add("mobile", "The mobile number is too short.", "رقم الجوال قصير.");
  if (i.email.trim() && !EMAIL.test(i.email.trim())) add("email", "The email address is not valid.", "البريد الإلكتروني غير صحيح.");
  if (i.dnr && !i.dnrDoctor) add("dnrDoctor", "Pick the doctor who ordered Do Not Resuscitate.", "اختر الطبيب الذي أمر بعدم الإنعاش.");
  if (i.dnr && !i.dnrDate) add("dnrDate", "Enter the date of the Do Not Resuscitate order.", "أدخل تاريخ أمر عدم الإنعاش.");
  else if (i.dnr && i.dnrDate > i.today) add("dnrDate", "The order date cannot be in the future.", "تاريخ الأمر لا يمكن أن يكون في المستقبل.");
  if (i.interpreter && !i.language.trim()) add("language", "Pick the language for the interpreter.", "اختر لغة المترجم.");
  // An unknown patient gets a test Health ID when saved, and cannot give consent until the details are completed.
  if (!unknown && !i.healthId.trim()) add("healthId", "Enter the Health ID.", "أدخل رقم الهوية الصحية.");
  if (!unknown && !i.consent) add("consent", "Confirm the patient consent.", "أكد موافقة المريض.");
  return out;
}

/** The name saved for an unknown or unconscious patient. */
export const UNKNOWN_NAME = { given: "Unknown", family: "Patient" } as const;

/** The name to show in lists: the nick name for a confidential patient, unless the user has opened the record. */
export function listName(p: Pick<Patient, "given" | "family" | "confidential" | "extra">, opened = false): string {
  if (p.confidential && !opened) return p.extra?.nickName?.trim() || "Confidential Patient";
  return `${p.given} ${p.family}`;
}

/** Builds the flags object to store. Flags that are off are left out. Returns nothing when no flag is on. */
export function buildFlags(i: { dnr: boolean; dnrDoctor: string; dnrDate: string; interpreter: boolean; language: string; fallRisk: boolean; isolation: boolean }): PatientFlags | undefined {
  const f: PatientFlags = {};
  if (i.dnr) f.dnr = { doctor: i.dnrDoctor, date: i.dnrDate };
  if (i.interpreter) f.interpreter = { language: i.language.trim() };
  if (i.fallRisk) f.fallRisk = true;
  if (i.isolation) f.isolation = true;
  return Object.keys(f).length ? f : undefined;
}
