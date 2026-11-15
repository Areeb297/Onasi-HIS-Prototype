import { audit } from "../audit";
import { NATIONALITIES } from "../reference-data";
import { can } from "../session";
import { isOff, logCall } from "./call-log";

/**
 * Yakeen (Elm): checks a person against the national identity records by ID number and date of birth, and returns the
 * name, sex, nationality, ID expiry and the national address held by Saudi Post. Simulated: the people below are made up.
 *
 * Assumptions for the demo: the date of birth is typed in the Gregorian calendar for both ID types (the real service
 * takes a Hijri month and year for citizens), and one call returns the identity and the address together.
 */

export type IdType = "national-id" | "iqama";
export const ID_TYPE_LABEL: Record<IdType, string> = { "national-id": "National ID", iqama: "Iqama" };

/** First name, father, grandfather, family. */
export type NameParts = [string, string, string, string];

export interface YakeenAddress {
  buildingNumber: string;
  street: string;
  district: string;
  city: string;
  postalCode: string;
  additionalNumber: string;
  /** Saudi Post short address, AAAANNNN. */
  shortAddress: string;
}

export interface YakeenIdentity {
  idType: IdType;
  idNumber: string;
  nameEn: NameParts;
  nameAr: NameParts;
  sex: "M" | "F";
  /** YYYY-MM-DD */
  dob: string;
  dobHijri: string;
  /** ISO 3166 alpha-3, as the patient file keeps it. */
  nationality: string;
  nationalityLabel: string;
  /** YYYY-MM-DD */
  idExpiry: string;
  idExpiryHijri: string;
  address: YakeenAddress;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const fullName = (parts: NameParts): string => parts.join(" ");

/** A Gregorian date in the Umm al-Qura calendar, for example "22 Jumada II 1405 AH". */
export function hijri(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
}

/** The last digit of a Saudi ID number is a Luhn check digit. */
function checkDigit(nine: string): string {
  const sum = [...nine].reduce((t, c, i) => {
    const d = Number(c) * (i % 2 === 0 ? 2 : 1);
    return t + (d > 9 ? d - 9 : d);
  }, 0);
  return String((10 - (sum % 10)) % 10);
}

/** Ten digits, starting with 1 for a citizen or 2 for a resident, with a correct check digit. */
export function idProblem(idType: IdType, idNumber: string): string | null {
  const label = ID_TYPE_LABEL[idType];
  if (!/^\d{10}$/.test(idNumber)) return `The ${label} number has 10 digits.`;
  const first = idType === "national-id" ? "1" : "2";
  if (idNumber[0] !== first) return `${idType === "national-id" ? "A National ID" : "An Iqama"} number starts with ${first}.`;
  if (checkDigit(idNumber.slice(0, 9)) !== idNumber[9]) return `This is not a valid ${label} number. Check the digits.`;
  return null;
}

/* ---------- made-up people ---------- */

type Seed = [nine: string, dob: string, sex: "M" | "F", en: NameParts, ar: NameParts, nationality: string, idExpiry: string, address: [building: string, street: string, district: string, city: string, postal: string, additional: string, short: string]];

const SEEDS: Seed[] = [
  ["101234567", "1985-03-14", "M", ["Abdullah", "Saad", "Mohammed", "Alqahtani"], ["عبدالله", "سعد", "محمد", "القحطاني"], "SAU", "2029-06-30", ["7421", "King Fahd Road", "Al Olaya", "Riyadh", "12211", "2930", "RRRD2930"]],
  ["102345678", "1990-11-02", "F", ["Noura", "Fahad", "Abdulaziz", "Alotaibi"], ["نورة", "فهد", "عبدالعزيز", "العتيبي"], "SAU", "2028-01-15", ["3318", "Prince Sultan Street", "Al Rawdah", "Jeddah", "23433", "6712", "JDRA6712"]],
  ["103456789", "1978-07-21", "M", ["Khalid", "Ibrahim", "Saleh", "Alharbi"], ["خالد", "إبراهيم", "صالح", "الحربي"], "SAU", "2027-09-08", ["8102", "King Abdulaziz Road", "Al Shati", "Dammam", "32413", "4455", "DMSH4455"]],
  ["104567890", "2001-01-30", "F", ["Reem", "Sultan", "Nasser", "Aldosari"], ["ريم", "سلطان", "ناصر", "الدوسري"], "SAU", "2030-03-22", ["2260", "Al Takhassusi Street", "Al Mohammadiyah", "Riyadh", "12363", "7781", "RMHA7781"]],
  ["105678901", "1964-05-09", "M", ["Mohammed", "Ali", "Hassan", "Alghamdi"], ["محمد", "علي", "حسن", "الغامدي"], "SAU", "2026-12-01", ["6540", "King Saud Road", "Al Hamra", "Al Baha", "65525", "3306", "BHHM3306"]],
  ["106789012", "1995-09-17", "F", ["Sara", "Yousef", "Ahmed", "Alzahrani"], ["سارة", "يوسف", "أحمد", "الزهراني"], "SAU", "2029-11-11", ["4879", "Al Hada Road", "Al Shifa", "Taif", "26523", "8120", "TFSF8120"]],
  ["107890123", "1988-12-25", "M", ["Faisal", "Turki", "Abdulrahman", "Alshehri"], ["فيصل", "تركي", "عبدالرحمن", "الشهري"], "SAU", "2028-08-19", ["1933", "King Khalid Road", "Al Khalidiyah", "Abha", "62521", "5604", "ABKH5604"]],
  ["108901234", "2012-04-06", "F", ["Lama", "Majed", "Saud", "Almutairi"], ["لمى", "ماجد", "سعود", "المطيري"], "SAU", "2027-04-06", ["5207", "Abu Bakr Al Siddiq Road", "Al Nakheel", "Riyadh", "12382", "9043", "RNKL9043"]],
  ["109012345", "1972-02-18", "M", ["Saleh", "Hamad", "Abdullah", "Alanazi"], ["صالح", "حمد", "عبدالله", "العنزي"], "SAU", "2030-10-05", ["7765", "King Faisal Road", "Al Muruj", "Tabuk", "47311", "2218", "TBMR2218"]],
  ["110123456", "1999-06-11", "F", ["Hessa", "Bandar", "Fahad", "Alsubaie"], ["حصة", "بندر", "فهد", "السبيعي"], "SAU", "2029-02-27", ["3091", "Al Imam Saud Road", "Al Malqa", "Riyadh", "13521", "6377", "RMLQ6377"]],
  ["111234567", "1958-10-03", "M", ["Ibrahim", "Omar", "Suleiman", "Alrashidi"], ["إبراهيم", "عمر", "سليمان", "الرشيدي"], "SAU", "2027-07-14", ["9418", "King Abdullah Road", "Al Safra", "Buraydah", "52367", "1159", "BRSF1159"]],
  ["112345678", "2019-08-23", "M", ["Yazeed", "Nawaf", "Khalid", "Alshammari"], ["يزيد", "نواف", "خالد", "الشمري"], "SAU", "2029-08-23", ["2684", "King Fahd Road", "Al Nuqrah", "Hail", "55431", "4092", "HLNQ4092"]],
  ["212345678", "1983-04-12", "M", ["Ahmed", "Mahmoud", "Hassan", "Elsayed"], ["أحمد", "محمود", "حسن", "السيد"], "EGY", "2027-05-20", ["6133", "Al Madinah Road", "Al Faisaliyah", "Jeddah", "23442", "7306", "JDFS7306"]],
  ["223456789", "1991-09-28", "F", ["Maria", "Jose", "Antonio", "Santos"], ["ماريا", "خوسيه", "أنطونيو", "سانتوس"], "PHL", "2026-11-30", ["4420", "Al Urubah Road", "Al Wurud", "Riyadh", "12251", "8814", "RWRD8814"]],
  ["234567890", "1979-01-05", "M", ["Rajesh", "Suresh", "Mohan", "Kumar"], ["راجيش", "سوريش", "موهان", "كومار"], "IND", "2027-03-18", ["7850", "Dhahran Street", "Al Aqrabiyah", "Al Khobar", "34446", "3521", "KBAQ3521"]],
  ["245678901", "1986-06-19", "M", ["Imran", "Tariq", "Aslam", "Khan"], ["عمران", "طارق", "أسلم", "خان"], "PAK", "2028-02-09", ["1596", "Ali Ibn Abi Talib Road", "Al Aziziyah", "Madinah", "42318", "6640", "MDAZ6640"]],
  ["256789012", "1994-12-08", "F", ["Amal", "Abdo", "Saleh", "Alhaddad"], ["أمل", "عبده", "صالح", "الحداد"], "YEM", "2026-09-25", ["8327", "King Abdulaziz Road", "Al Suwais", "Jazan", "82722", "2475", "JZSW2475"]],
  ["267890123", "1975-03-27", "M", ["Omar", "Walid", "Zaki", "Alkhatib"], ["عمر", "وليد", "زكي", "الخطيب"], "SYR", "2027-12-12", ["3704", "Ibrahim Al Khalil Road", "Al Misfalah", "Makkah", "24231", "9186", "MKMS9186"]],
  ["278901234", "1989-07-15", "F", ["Rana", "Sami", "Fuad", "Haddad"], ["رنا", "سامي", "فؤاد", "حداد"], "JOR", "2028-06-03", ["5961", "Prince Turki Street", "Al Yarmouk", "Al Khobar", "34423", "1738", "KBYR1738"]],
  ["289012345", "1982-10-30", "M", ["Mustafa", "Osman", "Altayeb", "Abdelrahim"], ["مصطفى", "عثمان", "الطيب", "عبدالرحيم"], "SDN", "2027-01-22", ["2245", "Omar Ibn Al Khattab Road", "Al Nahdah", "Riyadh", "13222", "5067", "RNHD5067"]],
];

const toIdentity = ([nine, dob, sex, nameEn, nameAr, nationality, idExpiry, a]: Seed): YakeenIdentity => ({
  idType: nine[0] === "1" ? "national-id" : "iqama", idNumber: nine + checkDigit(nine), nameEn, nameAr, sex, dob, dobHijri: hijri(dob),
  nationality, nationalityLabel: NATIONALITIES.find((n) => n.code === nationality)?.label ?? nationality, idExpiry, idExpiryHijri: hijri(idExpiry),
  address: { buildingNumber: a[0], street: a[1], district: a[2], city: a[3], postalCode: a[4], additionalNumber: a[5], shortAddress: a[6] },
});

/** The made-up identity records. Shown as samples on the Integrations page so a demo has numbers to type. */
export const YAKEEN_PEOPLE: YakeenIdentity[] = SEEDS.map(toIdentity);

const masked = (id: string) => `******${id.slice(-4)}`;

export interface YakeenQuery {
  idType: IdType;
  idNumber: string;
  /** YYYY-MM-DD, Gregorian. */
  dob: string;
}

/** Looks a person up. Only staff who register patients may ask, and every question that reaches Yakeen is logged. */
export function yakeenLookup(q: YakeenQuery, now: number = Date.now()): Result<YakeenIdentity> {
  if (!can("patient.register")) {
    audit("denied", "Yakeen identity check", { detail: "No permission to register patients" });
    return { ok: false, errors: ["Only staff who register patients can check an identity with Yakeen."] };
  }
  if (isOff("yakeen")) return { ok: false, errors: ["Yakeen is switched off. Enter the details by hand, or ask the System Administrator to connect it."] };
  const idNumber = q.idNumber.replace(/\s/g, "");
  const errors: string[] = [];
  const bad = idProblem(q.idType, idNumber);
  if (bad) errors.push(bad);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.dob)) errors.push("Enter the date of birth.");
  if (errors.length) return { ok: false, errors };

  const person = YAKEEN_PEOPLE.find((p) => p.idNumber === idNumber);
  const problem = !person ? "No record was found for this number." : person.dob !== q.dob ? "The date of birth does not match this number." : null;
  logCall({
    integration: "yakeen", operation: "Identity Lookup", ok: !problem,
    summary: `${ID_TYPE_LABEL[q.idType]} ${masked(idNumber)}: ${problem ? problem.replace(/\.$/, "") : "verified"}`,
    request: { service: q.idType === "national-id" ? "CitizenInfo" : "ResidentInfo", idNumber, dateOfBirth: q.dob, addressLanguage: "E" },
    response: problem ? { verified: false, errorCode: person ? "DOB_MISMATCH" : "NOT_FOUND", message: problem } : { verified: true, person },
  }, now);
  audit("view", "Yakeen identity check", { detail: `${ID_TYPE_LABEL[q.idType]} ${masked(idNumber)}: ${problem ? "not verified" : "verified"}` });
  return person && !problem ? { ok: true, value: person } : { ok: false, errors: [problem!] };
}
