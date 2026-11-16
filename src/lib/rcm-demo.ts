import type { Dx, Encounter, Patient } from "./model";

/**
 * Sample insured patients and past visits for the RCM screens (Billing Worklist, claims, Submitted Transactions and the
 * rejection, denial, AR and reconciliation work that follows). Made-up people only.
 *
 * This file is pure data: store.ts adds it to the seed, and rcm-demo-claims.ts gives each visit its claim history.
 * Each visit has a target claim state; the claim history is found again by patient, class and reason.
 */

export type DemoTarget =
  | "drafted" | "reviewed" | "pa-pended" | "pa-rejected" | "pa-approved" | "submitted" | "pended"
  | "approved" | "partial" | "rejected" | "paid" | "part-paid";

type Card = NonNullable<NonNullable<Patient["extra"]>["insurance"]>;

const card = (payer: string, n: number, copayPercent: number, className = "Class A"): Card => ({
  payer, policyNo: `POL-${26000 + n * 37}`, memberId: `MEM-${8810000 + n * 113}`, className,
  network: className === "VIP" ? "Platinum Network" : className === "Class A" ? "Gold Network" : "Silver Network",
  startDate: "2026-01-01", expiryDate: "2026-12-31", copayPercent, status: "Active",
});

/** Insurance cards for seeded patients whose current visit should carry a claim. The rest stay cash patients. */
export const DEMO_CARDS: Record<string, Card> = {
  P002: card("Bupa Arabia", 2, 10),
  P003: card("Tawuniya", 3, 20, "Class B"),
  P004: card("MedGulf", 4, 10),
  P006: card("Al Rajhi Takaful", 6, 20, "Class B"),
  P008: card("Malath", 8, 10),
  P011: card("Tawuniya", 11, 20, "Class C"),
  P012: card("Bupa Arabia", 12, 10),
  P014: card("MedGulf", 14, 10),
};

/** The claim state each seeded visit is brought to. Keyed by patient: each has one current visit. */
export const EXISTING_TARGETS: Record<string, { target: DemoTarget; reason: string }> = {
  P002: { target: "pa-approved", reason: "High blood sugar" }, P003: { target: "pa-pended", reason: "Chest pain" }, P004: { target: "drafted", reason: "Chest X-ray" },
  P006: { target: "submitted", reason: "Hip pain after fall" }, P008: { target: "drafted", reason: "Chest pain" }, P011: { target: "reviewed", reason: "Sore throat" },
  P012: { target: "drafted", reason: "Abdominal pain" }, P014: { target: "drafted", reason: "Chest pain and sweating" },
};

const RAW: [id: string, given: string, family: string, dob: string, sex: "M" | "F", nationality: string, payer: string, copay: number, cls?: string][] = [
  ["P101", "Abdulaziz", "Alqahtani", "1979-02-11", "M", "SAU", "Bupa Arabia", 10],
  ["P102", "Nora", "Alshehri", "1988-09-23", "F", "SAU", "Tawuniya", 20, "Class B"],
  ["P103", "Fahad", "Alotaibi", "1965-06-04", "M", "SAU", "MedGulf", 10],
  ["P104", "Sara", "Aldossary", "1993-12-15", "F", "SAU", "Al Rajhi Takaful", 20, "Class B"],
  ["P105", "Mohammed", "Alzahrani", "1958-03-30", "M", "SAU", "Malath", 10],
  ["P106", "Hessa", "Almutlaq", "1975-07-19", "F", "SAU", "Bupa Arabia", 0, "VIP"],
  ["P107", "Khalid", "Alshahrani", "2004-01-08", "M", "SAU", "Tawuniya", 20, "Class C"],
  ["P108", "Amal", "Alruwaili", "1982-10-27", "F", "SAU", "MedGulf", 10],
  ["P109", "Mahmoud", "Abdelrahman", "1970-05-13", "M", "EGY", "Al Rajhi Takaful", 20, "Class B"],
  ["P110", "Ruba", "Alenezi", "1999-04-02", "F", "SAU", "Malath", 10],
];

export const DEMO_MARK = "P101";

export const DEMO_PATIENTS: Patient[] = RAW.map(([id, given, family, dob, sex, nationality, payer, copay, cls], i) => ({
  id, mrn: `MR-26-${String(201 + i).padStart(6, "0")}`, nationalId: `${nationality === "SAU" ? 1 : 2}0${String(48213570 + i * 7919).slice(0, 8)}`,
  family, given, dob, sex, healthId: String(1090100001 + i * 17), nationality, maritalStatus: i % 3 ? "M" : "S",
  address: `RIYA${String(4100 + i * 11)}`,
  extra: { visitPayType: "Insurance", insurance: card(payer, 100 + i, copay, cls ?? "Class A") },
}));

const D = {
  pneumonia: { code: "J18.9", text: "Pneumonia, unspecified" },
  dm2: { code: "E11.9", text: "Type 2 diabetes mellitus without complications" },
  htn: { code: "I10", text: "Essential (primary) hypertension" },
  urti: { code: "J06.9", text: "Acute upper respiratory infection, unspecified" },
  gastro: { code: "A09.9", text: "Gastroenteritis and colitis of unspecified origin" },
  chest: { code: "R07.4", text: "Chest pain, unspecified" },
  uti: { code: "N39.0", text: "Urinary tract infection, site not specified" },
  asthma: { code: "J45.9", text: "Asthma, unspecified" },
  backPain: { code: "M54.5", text: "Low back pain" },
  hipFx: { code: "S72.00", text: "Fracture of neck of femur, closed" },
  hf: { code: "I50.9", text: "Heart failure, unspecified" },
  ckd: { code: "N18.3", text: "Chronic kidney disease, stage 3" },
  migraine: { code: "G43.9", text: "Migraine, unspecified" },
  copd: { code: "J44.9", text: "Chronic obstructive pulmonary disease, unspecified" },
} as const;

export interface DemoVisit {
  pid: string;
  cls: "O" | "E" | "I";
  daysAgo: number;
  hour: number;
  /** Days in hospital for an inpatient stay. */
  los?: number;
  service: string;
  doctor: string;
  /** Unique per patient: the claim history finds the visit again by patient, class and reason. */
  reason: string;
  complaint: { code: string; text: string };
  dx: { code: string; text: string }[];
  target: DemoTarget;
  /** Tests, exams and medicines of the visit (LOINC, imaging procedure codes, drug ids). lab.ts, radiology.ts and rx.ts seed them. */
  orders?: { lab?: string[]; rad?: string[]; rx?: string[] };
  /** The claim type, when it is not the one that follows the visit class. */
  claimType?: "pharmacy";
}

/** Past visits, June to November 2026. Several patients come more than once. */
export const DEMO_VISITS: DemoVisit[] = [
  { pid: "P101", cls: "I", daysAgo: 160, hour: 9, los: 4, service: "MED", doctor: "D1001", reason: "Fever and productive cough", complaint: { code: "49727002", text: "Cough" }, dx: [D.pneumonia, D.dm2], target: "paid", orders: { lab: ["58410-2", "1988-5", "24323-8"], rad: ["XCHES-PA"], rx: ["DRG006", "DRG001"] } },
  { pid: "P101", cls: "O", daysAgo: 118, hour: 10, service: "OPD", doctor: "D1001", reason: "Diabetes follow up", complaint: { code: "", text: "Diabetes follow up" }, dx: [D.dm2, D.htn], target: "paid", orders: { lab: ["4548-4", "24331-1"], rx: ["DRG010", "DRG013"] } },
  { pid: "P101", cls: "O", daysAgo: 22, hour: 11, service: "OPD", doctor: "D1001", reason: "Blood pressure review", complaint: { code: "", text: "Blood pressure review" }, dx: [D.htn], target: "pended", orders: { lab: ["2160-0"], rx: ["DRG013"] } },
  { pid: "P102", cls: "O", daysAgo: 150, hour: 16, service: "OPD", doctor: "D1001", reason: "Sore throat and fever", complaint: { code: "162397003", text: "Sore throat" }, dx: [D.urti], target: "paid", orders: { rx: ["DRG004", "DRG001"] } },
  { pid: "P102", cls: "E", daysAgo: 64, hour: 22, service: "ER", doctor: "D1003", reason: "Vomiting and diarrhoea", complaint: { code: "422400008", text: "Vomiting" }, dx: [D.gastro], target: "partial", orders: { lab: ["58410-2", "2951-2", "2823-3"], rx: ["DRG030"] } },
  { pid: "P103", cls: "I", daysAgo: 138, hour: 7, los: 6, service: "ORT", doctor: "D1005", reason: "Hip fracture after a fall", complaint: { code: "1912002", text: "Fall" }, dx: [D.hipFx, D.htn], target: "part-paid", orders: { lab: ["58410-2", "5902-2", "6301-6"], rx: ["DRG028", "DRG002", "DRG001"] } },
  { pid: "P103", cls: "O", daysAgo: 96, hour: 9, service: "ORT", doctor: "D1005", reason: "Hip fracture follow up", complaint: { code: "", text: "Hip fracture follow up" }, dx: [D.hipFx], target: "approved", orders: { rx: ["DRG001"] } },
  { pid: "P104", cls: "O", daysAgo: 127, hour: 13, service: "OPD", doctor: "D1001", reason: "Painful urination", complaint: { code: "49650001", text: "Painful urination" }, dx: [D.uti], target: "rejected", orders: { lab: ["24357-6", "630-4"], rx: ["DRG009"] } },
  { pid: "P104", cls: "E", daysAgo: 41, hour: 3, service: "ER", doctor: "D1003", reason: "Severe headache", complaint: { code: "25064002", text: "Headache" }, dx: [D.migraine], target: "paid", orders: { rad: ["CSKUH"], rx: ["DRG002"] } },
  { pid: "P105", cls: "I", daysAgo: 112, hour: 18, los: 5, service: "MED", doctor: "D1001", reason: "Shortness of breath and leg swelling", complaint: { code: "267036007", text: "Shortness of breath" }, dx: [D.hf, D.ckd, D.htn], target: "partial", orders: { lab: ["58410-2", "2160-0", "2951-2"], rad: ["XCHES-PA"], rx: ["DRG029", "DRG014"] } },
  { pid: "P105", cls: "O", daysAgo: 70, hour: 10, service: "OPD", doctor: "D1001", reason: "Heart failure clinic", complaint: { code: "", text: "Heart failure clinic" }, dx: [D.hf], target: "part-paid", orders: { lab: ["2160-0", "2823-3"], rx: ["DRG029"] } },
  { pid: "P105", cls: "I", daysAgo: 12, hour: 8, los: 2, service: "MED", doctor: "D1001", reason: "Planned review of kidney function", complaint: { code: "", text: "Kidney function review" }, dx: [D.ckd], target: "pa-rejected", orders: { lab: ["2160-0", "3094-0"] } },
  { pid: "P106", cls: "O", daysAgo: 104, hour: 11, service: "OPD", doctor: "D1001", reason: "Wheezing at night", complaint: { code: "56018004", text: "Wheezing" }, dx: [D.asthma], target: "approved", orders: { rx: ["DRG021", "DRG023"] } },
  { pid: "P106", cls: "O", daysAgo: 30, hour: 12, service: "OPD", doctor: "D1001", reason: "Asthma review", complaint: { code: "", text: "Asthma review" }, dx: [], target: "rejected", orders: { rx: ["DRG021"] } },
  { pid: "P107", cls: "E", daysAgo: 88, hour: 20, service: "ER", doctor: "D1003", reason: "Chest pain while playing football", complaint: { code: "29857009", text: "Chest pain" }, dx: [D.chest], target: "paid", orders: { lab: ["10839-9"], rad: ["XCHES-PA"] } },
  { pid: "P107", cls: "O", daysAgo: 8, hour: 15, service: "OPD", doctor: "D1001", reason: "Low back pain", complaint: { code: "161891005", text: "Back pain" }, dx: [D.backPain], target: "submitted", orders: { rad: ["X-LSJ"], rx: ["DRG003"] } },
  { pid: "P108", cls: "O", daysAgo: 77, hour: 9, service: "OPD", doctor: "D1001", reason: "Cough for two weeks", complaint: { code: "49727002", text: "Cough" }, dx: [D.urti], target: "partial", orders: { rad: ["XCHES-PA"], rx: ["DRG007"] } },
  { pid: "P108", cls: "I", daysAgo: 19, hour: 14, los: 3, service: "MED", doctor: "D1001", reason: "Worsening breathlessness", complaint: { code: "267036007", text: "Shortness of breath" }, dx: [D.copd], target: "rejected", orders: { lab: ["58410-2", "1988-5"], rad: ["CCHES"], rx: ["DRG021", "DRG023"] } },
  { pid: "P109", cls: "O", daysAgo: 55, hour: 10, service: "OPD", doctor: "D1001", reason: "Sugar control review", complaint: { code: "", text: "Sugar control review" }, dx: [D.dm2], target: "approved", orders: { lab: ["4548-4", "2345-7"], rx: ["DRG010", "DRG011"] } },
  { pid: "P109", cls: "O", daysAgo: 4, hour: 9, service: "OPD", doctor: "D1001", reason: "Repeat prescription", complaint: { code: "", text: "Repeat prescription" }, dx: [D.dm2], target: "reviewed", orders: { rx: ["DRG010", "DRG011", "DRG017"] }, claimType: "pharmacy" },
  { pid: "P110", cls: "E", daysAgo: 48, hour: 1, service: "ER", doctor: "D1003", reason: "Abdominal pain", complaint: { code: "21522001", text: "Abdominal pain" }, dx: [D.gastro], target: "pended", orders: { lab: ["58410-2"], rad: ["UABDO"], rx: ["DRG030"] } },
  { pid: "P110", cls: "O", daysAgo: 2, hour: 17, service: "OPD", doctor: "D1001", reason: "Migraine follow up", complaint: { code: "", text: "Migraine follow up" }, dx: [], target: "drafted", orders: { rx: ["DRG002"] } },
];

const pad = (n: number) => String(n).padStart(2, "0");
export const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** When a demo visit started and ended, as Dates. */
export function demoVisitTimes(v: DemoVisit, now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - v.daysAgo, v.hour, (v.daysAgo * 7) % 50);
  const end = v.cls === "I" ? new Date(start.getTime() + (v.los ?? 2) * 86_400_000 + 3 * 3_600_000) : new Date(start.getTime() + (v.cls === "E" ? 4 : 1) * 3_600_000);
  return { start, end };
}

const VITALS: Record<DemoVisit["cls"], Encounter["vitals"]> = {
  O: { bp: "124/80", pulse: "76", temp: "36.8", spo2: "98", rr: "16", weight: "78", height: "171", at: "" },
  E: { bp: "132/84", pulse: "98", temp: "37.6", spo2: "97", rr: "18", weight: "72", height: "168", at: "" },
  I: { bp: "138/86", pulse: "92", temp: "38.1", spo2: "94", rr: "20", weight: "84", height: "174", at: "" },
};

/** One finished visit for the seed. Inpatient stays carry their four discharge clearances. */
export function demoEncounter(v: DemoVisit, visitNumber: string, now: Date): Encounter {
  const { start, end } = demoVisitTimes(v, now);
  const at = localStamp(start);
  const done = localStamp(end);
  const dx: Dx[] = v.dx.map((d, i) => ({ code: d.code, text: d.text, type: "F", at, kind: i === 0 ? "P" : "S", onAdmission: v.cls === "I" ? true : undefined }));
  const stamp = (by: string, role: string) => ({ by, role, at: done });
  return {
    visitNumber, patientId: v.pid, cls: v.cls, status: "discharged", transfers: [], attending: v.doctor, admitting: v.doctor, service: v.service,
    reason: v.reason, admitAt: at, dischargeAt: done, disposition: "306689006", dx, pr: [], allergies: [],
    complaints: [{ code: v.complaint.code, text: v.complaint.text }], notes: [], vitals: { ...VITALS[v.cls]!, at },
    ...(v.cls === "O" ? { checkedIn: true } : {}),
    ...(v.cls === "I" ? {
      admissionMethod: v.reason.startsWith("Planned") ? "14" : "15",
      clearances: { clinical: stamp("Dr. Khalid Alharbi", "Doctor"), pharmacy: stamp("Hind Alotaibi", "Pharmacist"), nursing: stamp("Huda Alotaibi, RN", "Nurse"), finance: stamp("Majed Aldosari", "Billing") },
    } : {}),
    ...(v.cls === "E" ? { ed: { arrivalAt: at, arrivalMode: "Walk-in" as const, triageAt: at, ctas: 3 as const, complaint: v.complaint.text, triageNurse: "Huda Alotaibi, RN" } } : {}),
  };
}

/** Adds the demo patients, their cards and their past visits to a seed state. Visit numbers continue the counter. */
export function addDemoData<S extends { patients: Patient[]; encounters: Encounter[]; counters: { visit: number; patient: number } }>(state: S, now: Date = new Date()): S {
  const patients = state.patients.map((p) => (DEMO_CARDS[p.id] ? { ...p, extra: { ...p.extra, visitPayType: "Insurance" as const, insurance: { ...DEMO_CARDS[p.id] } } } : p));
  let visit = state.counters.visit;
  // A stay that was already claimed needs the vital signs the nurse recorded on admission.
  const encounters = state.encounters.map((e) => (e.patientId === "P006" && !e.vitals ? { ...e, vitals: { ...VITALS.I!, at: e.admitAt ?? "" } } : e));
  for (const v of DEMO_VISITS) encounters.push(demoEncounter(v, `V${100001 + visit++}`, now));
  return { ...state, patients: [...patients, ...DEMO_PATIENTS.map((p) => ({ ...p }))], encounters, counters: { ...state.counters, visit, patient: state.counters.patient + DEMO_PATIENTS.length } };
}

/** The claim state a visit is brought to, or undefined when it is not a demo claim. */
export function demoTargetOf(enc: Pick<Encounter, "patientId" | "cls" | "reason" | "status">): DemoTarget | undefined {
  const past = DEMO_VISITS.find((v) => v.pid === enc.patientId && v.cls === enc.cls && v.reason === enc.reason);
  if (past) return past.target;
  const seeded = EXISTING_TARGETS[enc.patientId];
  // Only the seeded visit of that patient (matched by its reason), not visits added later.
  return seeded && seeded.reason === enc.reason && enc.status !== "cancelled" && enc.status !== "preadmit" ? seeded.target : undefined;
}

/** Saved data from before the sample patients existed: adds them once. Data that already has them is returned as it is. */
export function withDemoData<S extends { patients: Patient[]; encounters: Encounter[]; counters: { visit: number; patient: number } }>(state: S, now: Date = new Date()): S {
  return state.patients.some((p) => p.id === DEMO_MARK) ? state : addDemoData(state, now);
}

export interface DemoOrders {
  visitNumber: string;
  patientId: string;
  doctor: string;
  /** When the orders were placed: an hour into the visit. ISO time. */
  at: string;
  reason: string;
  /** The principal diagnosis, given as the reason for each order so the claim lines link to it. */
  dx?: { code: string; text: string };
  inpatient: boolean;
  lab: string[];
  rad: string[];
  rx: string[];
}

/** The orders of the demo visits present in the visit list, for the lab, radiology and pharmacy seeds. */
export function demoOrders(encounters: Pick<Encounter, "visitNumber" | "patientId" | "cls" | "reason" | "admitAt" | "attending">[]): DemoOrders[] {
  const out: DemoOrders[] = [];
  for (const v of DEMO_VISITS) {
    if (!v.orders) continue;
    const e = encounters.find((x) => x.patientId === v.pid && x.cls === v.cls && x.reason === v.reason);
    if (!e?.admitAt) continue;
    out.push({
      visitNumber: e.visitNumber, patientId: v.pid, doctor: e.attending, at: new Date(new Date(e.admitAt).getTime() + 3_600_000).toISOString(), reason: v.reason,
      dx: v.dx[0] ? { ...v.dx[0] } : undefined, inpatient: v.cls === "I", lab: v.orders.lab ?? [], rad: v.orders.rad ?? [], rx: v.orders.rx ?? [],
    });
  }
  return out;
}

/** The claim type a demo visit's claim was made as, when it differs from the default. */
export const demoClaimTypeOf = (enc: Pick<Encounter, "patientId" | "cls" | "reason">): "pharmacy" | undefined =>
  DEMO_VISITS.find((v) => v.pid === enc.patientId && v.cls === enc.cls && v.reason === enc.reason)?.claimType;
