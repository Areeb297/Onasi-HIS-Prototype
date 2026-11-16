import { bedCounts } from "./beds";
import { clockOf, stageOf } from "./ed";
import { RCM } from "./masters/rcm";
import type { HisState } from "./model";
import { buildOutbox, STATE_LABEL, type SendState } from "./nphies-outbox";
import { BEDS, WARDS, countryLabel } from "./reference-data";
import { STATUS_LABEL as APPT_STATUS, doctorName, getAppointments, isLive, todayOf } from "./appointments";
import { allCases } from "./theatre";
import { scheduleEnd, scheduleStatus } from "./theatre-logic";
import { getState, patientName } from "./store";
import { fmtDayMonth, fmtWeekday } from "./format";

/**
 * Numbers for the dashboards. "Live" numbers are counted from the stores right now.
 * The 7-day trend and the Daman figures are sample data, and the screens say so.
 */

export interface Tile { label: string; value: string; note: string; tone?: "ok" | "warn" | "danger" }

export function liveCounts(s: HisState = getState(), now = Date.now()) {
  const active = s.encounters.filter((e) => e.status === "active");
  const ed = active.filter((e) => e.cls === "E" && e.ed);
  const occupied = new Set(active.filter((e) => e.bedId).map((e) => e.bedId));
  const outbox = buildOutbox();
  const byState = (st: SendState) => outbox.filter((r) => r.state === st).length;
  return {
    opd: active.filter((e) => e.cls === "O").length,
    ipd: active.filter((e) => e.cls === "I").length,
    er: ed.length,
    edLate: ed.filter((e) => clockOf(e.ed!, now).overdue).length,
    edWaiting: ed.filter((e) => ["waiting-triage", "waiting-doctor"].includes(stageOf(e.ed!))).length,
    bedsTotal: BEDS.length,
    bedsUsed: occupied.size,
    /** Beds in every state: free, occupied, reserved, discharging, cleaning, out. */
    bedStates: bedCounts(s),
    ready: outbox.filter((r) => r.ready && r.action && r.state !== "rejected").length,
    rejected: byState("rejected"),
    wards: WARDS.map((w) => {
      const beds = BEDS.filter((b) => b.ward === w.ward);
      const used = beds.filter((b) => occupied.has(b.id)).length;
      // Free means ready for a patient. Reserved, cleaning and out-of-service beds are neither in use nor free.
      const free = bedCounts(s, w.ward).free;
      return { ward: w.name, used, free, notReady: beds.length - used - free, total: beds.length };
    }),
    ctas: [1, 2, 3, 4, 5].map((l) => ({ level: `CTAS ${l}`, n: l, patients: ed.filter((e) => e.ed!.ctas === l).length })),
    sendStates: (["not-sent", "changes", "rejected", "sent"] as SendState[]).map((st) => ({ state: STATE_LABEL[st], items: byState(st) })),
  };
}

/** Sample visits for the last 7 days. Fixed numbers, so the chart is steady. Today adds the patients in the building now. */
export function visitTrend(s: HisState = getState(), now = new Date()) {
  const sample = [[42, 9, 17], [47, 11, 21], [39, 8, 19], [51, 12, 24], [44, 10, 18], [36, 7, 26]];
  const live = liveCounts(s, now.getTime());
  return [...sample, [40 + live.opd, 8 + live.ipd, 16 + live.er]].map(([opd, ipd, er], i, all) => {
    const d = new Date(now.getTime() - (all.length - 1 - i) * 86_400_000);
    return { day: i === all.length - 1 ? "Today" : fmtWeekday(d), Outpatient: opd, Inpatient: ipd, Emergency: er };
  });
}

/* ---------- Daman (sample figures from the RCM setup table) ---------- */

export interface DamanRow { status: string; claims: number; amount: number; avgDays: number; period: string }

export const damanRows = (): DamanRow[] => (RCM.find((m) => m.id === "daman-dashboard")?.seed ?? []) as unknown as DamanRow[];

export function damanTotals(rows: DamanRow[] = damanRows()) {
  const claims = rows.reduce((n, r) => n + r.claims, 0);
  const amount = rows.reduce((n, r) => n + r.amount, 0);
  const of = (st: string) => rows.find((r) => r.status === st);
  const decided = (of("Accepted")?.claims ?? 0) + (of("Rejected")?.claims ?? 0) + (of("Paid")?.claims ?? 0);
  return {
    claims, amount,
    rejectionRate: decided ? (of("Rejected")?.claims ?? 0) / decided : 0,
    paid: of("Paid")?.amount ?? 0,
    open: (of("Submitted")?.amount ?? 0) + (of("Pending")?.amount ?? 0),
    slowest: [...rows].sort((a, b) => b.avgDays - a.avgDays)[0],
  };
}

/** Sample weekly submitted and paid amounts, in thousand SAR. */
export const DAMAN_WEEKS = [
  { week: "6 Oct", Submitted: 188, Paid: 142 }, { week: "13 Oct", Submitted: 204, Paid: 171 }, { week: "20 Oct", Submitted: 197, Paid: 186 },
  { week: "27 Oct", Submitted: 231, Paid: 203 }, { week: "3 Nov", Submitted: 246, Paid: 212 }, { week: "10 Nov", Submitted: 219, Paid: 240 },
];

export const sar = (n: number) => `${Math.round(n).toLocaleString("en-US")} SAR`;
export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/* ---------- Operational overview: extra panels ---------- */

export const RANGES = ["Today", "Yesterday", "This week", "This month", "Last month", "Last 30 days"] as const;
export type RangeId = (typeof RANGES)[number];
/** How much of the month's sample figures a range shows. Live counts do not change with the range. */
export const RANGE_SHARE: Record<RangeId, number> = { Today: 0.05, Yesterday: 0.045, "This week": 0.28, "This month": 0.4, "Last month": 1, "Last 30 days": 0.95 };

/** Country codes used on patient records (ISO 3166 numeric), in words. */
const COUNTRY: Record<string, string> = { "682": "Saudi", "818": "Egyptian", "356": "Indian", "586": "Pakistani", "608": "Filipino", "050": "Bangladeshi", "400": "Jordanian", "760": "Syrian", "887": "Yemeni", "729": "Sudanese" };

export function patientMix(s: HisState = getState()) {
  const count = (key: (p: HisState["patients"][number]) => string) => {
    const m = new Map<string, number>();
    for (const p of s.patients) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return [...m.entries()].map(([name, patients]) => ({ name, patients })).sort((a, b) => b.patients - a.patients);
  };
  return {
    total: s.patients.length,
    gender: count((p) => (p.sex === "M" ? "Male" : "Female")),
    nationality: count((p) => COUNTRY[p.nationality] ?? (countryLabel(p.nationality) || p.nationality || "Not recorded")).slice(0, 6),
  };
}

/** Sample money and appointment figures for one month. Scaled by the chosen range. */
export function operations(range: RangeId) {
  const k = RANGE_SHARE[range];
  const r = (n: number) => Math.round(n * k);
  const generated = r(412_600), collected = r(301_900);
  return {
    revenue: { generated, collected, outstanding: generated - collected, invoices: r(640) },
    departments: [["General Medicine", 128_400], ["Surgery", 96_200], ["Emergency", 71_300], ["Radiology", 58_900], ["Laboratory", 37_100], ["Pharmacy", 20_700]].map(([department, v]) => ({ department: department as string, revenue: r(v as number) })),
    payers: [["Bupa Arabia", 96_000, 78_000], ["Tawuniya", 84_500, 61_200], ["MedGulf", 52_300, 40_100], ["Daman", 47_800, 30_600], ["NextCare", 28_900, 21_400]].map(([payer, g, c]) => ({ payer: payer as string, Collected: r(c as number), Outstanding: r((g as number) - (c as number)) })),
    payments: [["Cash", 38_200], ["Card", 74_600], ["Online", 21_900]].map(([method, v]) => ({ method: method as string, amount: r(v as number) })),
    appointments: { online: r(310), visit: r(520) },
    providers: [["Dr. Khalid Alharbi", "Medicine", 212, 188, 9, 15], ["Dr. Noura Alzahrani", "Surgery", 164, 150, 6, 8], ["Dr. Huda Alotaibi", "Radiology", 141, 133, 3, 5], ["Dr. Omar Alshehri", "Emergency", 120, 117, 1, 2]].map(([provider, department, a, c, n, x]) => ({ provider: provider as string, department: department as string, appointments: r(a as number), completed: r(c as number), noShow: r(n as number), cancelled: r(x as number) })),
  };
}

/* ---------- Daman platform transactions (sample) ---------- */

export const DAMAN_COUNTS = [
  ["Eligibility Requests", 1284], ["Eligibility Responses", 1279], ["Claim Requests", 699], ["Claim Responses", 688],
  ["Preauthorization Requests", 342], ["Preauthorization Responses", 337], ["Transaction Requests", 58],
] as const;

export const DAMAN_PRIOR_AUTH = { requested: 1126, approved: 912, rejected: 141, partial: 73, approvedAmount: 684_300 };

type Mix = { name: string; count: number }[];
const mix = (rows: [string, number][]): Mix => rows.map(([name, count]) => ({ name, count }));

export const DAMAN_SECTIONS: { id: string; title: string; note: string; unit: string; data: Mix }[] = [
  { id: "elig-types", title: "Eligibility request types", note: "Why each coverage eligibility request was sent.", unit: "requests", data: mix([["Benefits", 702], ["Validation", 431], ["Discovery", 151]]) },
  { id: "elig-outcomes", title: "Eligibility response outcomes", note: "What the payer answered.", unit: "responses", data: mix([["Eligible", 1147], ["Not eligible", 96], ["Error", 36]]) },
  { id: "elig-errors", title: "Eligibility error groups", note: "Validation and business errors on eligibility responses.", unit: "errors", data: mix([["Member not found", 17], ["Policy expired", 11], ["Invalid identifier", 5], ["Other", 3]]) },
  { id: "claim-types", title: "Claim request types", note: "Claim types submitted in the period.", unit: "claims", data: mix([["Professional", 318], ["Institutional", 207], ["Pharmacy", 121], ["Oral", 34], ["Vision", 19]]) },
  { id: "claim-outcomes", title: "Claim response outcomes", note: "What the payer decided.", unit: "responses", data: mix([["Approved", 515], ["Partial", 92], ["Pended", 44], ["Rejected", 37]]) },
  { id: "claim-errors", title: "Claim error groups", note: "Claim response errors by validation group.", unit: "errors", data: mix([["Missing supporting info", 21], ["Code not covered", 14], ["Duplicate claim", 9], ["Vital signs missing", 8], ["Other", 6]]) },
  { id: "auth-types", title: "Preauthorization request types", note: "Preauthorization types submitted.", unit: "requests", data: mix([["Institutional", 149], ["Professional", 118], ["Pharmacy", 52], ["Oral", 23]]) },
  { id: "auth-outcomes", title: "Preauthorization response outcomes", note: "What the payer decided.", unit: "responses", data: mix([["Approved", 254], ["Partial", 37], ["Pended", 21], ["Rejected", 25]]) },
  { id: "tx-mix", title: "Transaction request mix", note: "Payment reconciliation and payment notice requests.", unit: "requests", data: mix([["Payment reconciliation", 34], ["Payment notice", 24]]) },
];

export const DAMAN_MONTHS = [
  { month: "Jun", Approved: 118, Partial: 9, Rejected: 21, amount: 96, rate: 14.2 }, { month: "Jul", Approved: 131, Partial: 12, Rejected: 24, amount: 104, rate: 14.4 },
  { month: "Aug", Approved: 142, Partial: 11, Rejected: 19, amount: 111, rate: 11.0 }, { month: "Sep", Approved: 156, Partial: 14, Rejected: 27, amount: 119, rate: 13.7 },
  { month: "Oct", Approved: 171, Partial: 13, Rejected: 26, amount: 124, rate: 12.4 }, { month: "Nov", Approved: 194, Partial: 14, Rejected: 24, amount: 130, rate: 10.3 },
];

export const DAMAN_REJECTED_SERVICES = [
  { code: "73221-00-00", service: "MRI of the knee", rejections: 18 }, { code: "30445-00-00", service: "Laparoscopic cholecystectomy", rejections: 14 },
  { code: "11700-00-00", service: "12-lead electrocardiogram", rejections: 11 }, { code: "56001-00-00", service: "CT of the brain", rejections: 9 },
  { code: "96027-00-00", service: "Physiotherapy session", rejections: 7 },
];

/* ---------- Stat tile history: change against the previous period, and a sparkline ---------- */

/** What the previous period is called for each date range. */
export const PERIOD_WORD: Record<RangeId, string> = {
  Today: "yesterday", Yesterday: "the day before", "This week": "last week", "This month": "last month", "Last month": "the month before", "Last 30 days": "the 30 days before",
};

/** Sample shapes for 12 periods. Each is scaled so its last point is the current value. Fixed, so tiles are steady. */
const SHAPES: Record<string, number[]> = {
  patients: [0.62, 0.66, 0.69, 0.71, 0.75, 0.78, 0.82, 0.85, 0.88, 0.91, 0.95, 1],
  opd: [1.3, 0.9, 1.15, 1.4, 0.8, 1.05, 1.25, 0.95, 1.5, 1.1, 1.35, 1],
  ipd: [0.8, 1.1, 0.95, 1.2, 1.25, 0.9, 1.05, 1.3, 1.1, 0.85, 0.75, 1],
  er: [0.7, 0.9, 1.2, 0.8, 1.1, 0.95, 0.75, 1.15, 0.85, 1.05, 0.8, 1],
  revenue: [0.78, 0.83, 0.8, 0.88, 0.86, 0.91, 0.89, 0.95, 0.92, 0.97, 0.94, 1],
  collected: [0.74, 0.79, 0.81, 0.8, 0.86, 0.84, 0.9, 0.88, 0.93, 0.95, 0.91, 1],
  outstanding: [1.22, 1.18, 1.25, 1.12, 1.15, 1.08, 1.1, 1.04, 1.06, 0.97, 0.93, 1],
  nphies: [0.6, 0.9, 0.7, 1.1, 0.8, 1.2, 0.9, 1.3, 1, 0.85, 1.15, 1],
};

export interface TileTrend { points: number[]; prev: number; current: number; against: string }

/** Twelve sample periods ending with the current value. When the current value is zero, a small sample base is used so the line still shows. */
export function tileTrend(metric: string, current: number, range: RangeId): TileTrend {
  const shape = SHAPES[metric] ?? SHAPES.revenue;
  const base = current || 4;
  // The line keeps its fractions so small counts do not zigzag; the previous period is a whole number.
  const points = shape.map((m, i) => (i === shape.length - 1 ? current : i === shape.length - 2 ? Math.round(base * m) : base * m));
  return { points, prev: points[points.length - 2], current, against: PERIOD_WORD[range] };
}

/* ---------- Claims analytics (Daman dashboard). Made-up Saudi sample claims, filtered for real. ---------- */

export const CLAIM_PAYERS = ["Bupa Arabia", "Tawuniya", "MedGulf", "Al Rajhi Takaful", "Malath Insurance", "Walaa Insurance"] as const;
/** NPHIES claim types. */
export const CLAIM_TYPES = ["Professional", "Institutional", "Pharmacy", "Oral", "Vision"] as const;
export const CLAIM_PERIODS = ["Last 30 Days", "Last 90 Days", "Last 6 Months", "Last 12 Months"] as const;
export type ClaimPeriod = (typeof CLAIM_PERIODS)[number];
export const PERIOD_DAYS: Record<ClaimPeriod, number> = { "Last 30 Days": 30, "Last 90 Days": 90, "Last 6 Months": 182, "Last 12 Months": 365 };
export const PREV_WORD: Record<ClaimPeriod, string> = { "Last 30 Days": "the 30 days before", "Last 90 Days": "the 90 days before", "Last 6 Months": "the 6 months before", "Last 12 Months": "the year before" };
export const CLAIM_STATUSES = ["Paid", "Partially Paid", "Denied", "Pending"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Service groups from the Saudi Billing System (SBS) and ACHI procedure chapters. Average amounts in SAR. */
export const SERVICE_GROUPS = [
  { group: "Cardiovascular Procedures", system: "ACHI", avg: 21_400 },
  { group: "Musculoskeletal Procedures", system: "ACHI", avg: 15_800 },
  { group: "Obstetric Procedures", system: "ACHI", avg: 9_600 },
  { group: "Digestive System Procedures", system: "ACHI", avg: 8_200 },
  { group: "Room and Board", system: "SBS", avg: 6_100 },
  { group: "Imaging Services", system: "ACHI", avg: 1_850 },
  { group: "Dental Services", system: "ACHI", avg: 1_250 },
  { group: "Medications", system: "SBS", avg: 640 },
  { group: "Laboratory Tests", system: "SBS", avg: 410 },
  { group: "Consultations", system: "SBS", avg: 320 },
] as const;

export const DENIAL_REASONS = [
  "Medical necessity not shown", "Prior authorization missing", "Service not covered by the policy", "Diagnosis and service do not match",
  "Missing supporting documents", "Duplicate claim", "Member not eligible on the service date", "Submitted after the deadline",
] as const;

export interface Claim {
  id: string; day: number; payer: string; type: string; dept: string; group: string; system: string;
  amount: number; paid: number; denied: number; status: ClaimStatus; reason?: string;
  preAuth: "Approved" | "Denied" | "Not Required"; payDays?: number;
}

/** Small seeded random generator, so the sample claims are the same on every load. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, list: readonly T[], weights?: number[]): T {
  if (!weights) return list[Math.floor(r() * list.length)];
  const total = weights.reduce((n, w) => n + w, 0);
  let x = r() * total;
  for (let i = 0; i < list.length; i++) { x -= weights[i]; if (x <= 0) return list[i]; }
  return list[list.length - 1];
}

/** How each payer behaves: share of claims, denial tendency, and average days to pay. */
const PAYER_PROFILE: Record<string, { share: number; deny: number; days: number }> = {
  "Bupa Arabia": { share: 30, deny: 0.07, days: 24 }, Tawuniya: { share: 24, deny: 0.1, days: 33 }, MedGulf: { share: 14, deny: 0.15, days: 47 },
  "Al Rajhi Takaful": { share: 13, deny: 0.09, days: 29 }, "Malath Insurance": { share: 10, deny: 0.13, days: 41 }, "Walaa Insurance": { share: 9, deny: 0.12, days: 38 },
};

/** Which service groups and departments each claim type carries. */
const TYPE_GROUPS: Record<string, string[]> = {
  Professional: ["Consultations", "Laboratory Tests", "Imaging Services", "Medications"],
  Institutional: ["Cardiovascular Procedures", "Musculoskeletal Procedures", "Obstetric Procedures", "Digestive System Procedures", "Room and Board", "Imaging Services"],
  Pharmacy: ["Medications"], Oral: ["Dental Services"], Vision: ["Consultations"],
};
const TYPE_DEPTS: Record<string, string[]> = {
  Professional: ["Internal Medicine", "Pediatrics", "Emergency", "Cardiology", "Obstetrics and Gynecology", "Orthopedics"],
  Institutional: ["General Surgery", "Orthopedics", "Cardiology", "Obstetrics and Gynecology", "Internal Medicine", "Emergency"],
  Pharmacy: ["Internal Medicine", "Pediatrics", "Emergency"], Oral: ["Dental"], Vision: ["Ophthalmology"],
};

let CLAIMS_CACHE: Claim[] | null = null;

/** Sample claims over the last two years. Day 0 is today; day 400 is 400 days ago. */
export function sampleClaims(): Claim[] {
  if (CLAIMS_CACHE) return CLAIMS_CACHE;
  const r = seeded(101);
  const payers = Object.keys(PAYER_PROFILE);
  const out: Claim[] = [];
  for (let day = 729; day >= 0; day--) {
    // Volume grows slowly over time, with a weekend dip (Friday and Saturday).
    const weekday = (day + 3) % 7;
    const n = Math.round((2.6 + (729 - day) / 520) * (weekday >= 5 ? 0.55 : 1) + r() * 1.6);
    for (let k = 0; k < n; k++) {
      const payer = pick(r, payers, payers.map((p) => PAYER_PROFILE[p].share));
      const prof = PAYER_PROFILE[payer];
      const type = pick(r, CLAIM_TYPES, [44, 22, 20, 9, 5]);
      const groupName = pick(r, TYPE_GROUPS[type]);
      const g = SERVICE_GROUPS.find((x) => x.group === groupName)!;
      const dept = pick(r, TYPE_DEPTS[type]);
      const amount = Math.round(g.avg * (0.45 + r() * 1.1 + (r() < 0.06 ? 1.4 : 0)));
      const needsAuth = type === "Institutional" || g.group === "Imaging Services";
      const preAuth: Claim["preAuth"] = needsAuth ? (r() < 0.86 ? "Approved" : "Denied") : "Not Required";
      // Recent claims are more likely still waiting for the payer.
      const pendingChance = day < 20 ? 0.75 : day < 45 ? 0.4 : day < 90 ? 0.16 : day < 150 ? 0.05 : 0.015;
      const denyChance = prof.deny + (preAuth === "Denied" ? 0.45 : 0) - (preAuth === "Approved" ? 0.03 : 0);
      const x = r();
      const status: ClaimStatus = r() < pendingChance ? "Pending" : x < denyChance ? "Denied" : x < denyChance + 0.14 ? "Partially Paid" : "Paid";
      const paid = status === "Paid" ? amount : status === "Partially Paid" ? Math.round(amount * (0.55 + r() * 0.3)) : 0;
      const denied = status === "Denied" ? amount : status === "Partially Paid" ? amount - paid : 0;
      const reason = status === "Denied" || status === "Partially Paid"
        ? (preAuth === "Denied" ? "Prior authorization missing" : pick(r, DENIAL_REASONS, [26, 9, 15, 17, 14, 7, 6, 6]))
        : undefined;
      const payDays = status === "Paid" || status === "Partially Paid" ? Math.max(4, Math.round(prof.days * (0.45 + r() * 1.25) + (r() < 0.08 ? 45 : 0))) : undefined;
      out.push({ id: `CL${String(out.length + 1).padStart(8, "0")}`, day, payer, type, dept, group: g.group, system: g.system, amount, paid, denied, status, reason, preAuth, payDays });
    }
  }
  CLAIMS_CACHE = out;
  return out;
}

export interface ClaimFilters { period: ClaimPeriod; payer: string; type: string }
export const ALL = "All";

const total = (list: Claim[], f: (c: Claim) => number) => list.reduce((n, c) => n + f(c), 0);
const match = (f: ClaimFilters) => (c: Claim) => (f.payer === ALL || c.payer === f.payer) && (f.type === ALL || c.type === f.type);

/** Claims in the chosen period (offset 0) or the period before it (offset 1). */
function slice(f: ClaimFilters, offset = 0) {
  const days = PERIOD_DAYS[f.period];
  const ok = match(f);
  return sampleClaims().filter((c) => c.day >= offset * days && c.day < (offset + 1) * days && ok(c));
}

/** Days from submission to the answer from the payer. Paid claims use the payment day; denials are answered in 12 to 41 days. */
const decidedAfter = (c: Claim) => (c.status === "Pending" ? Infinity : c.payDays ?? 12 + (Number(c.id.slice(4)) % 30));

/** Money still waiting for the payer at a moment `daysAgo` days back: claims sent before then and not yet answered by then. */
export function outstandingAsOf(daysAgo: number, f: ClaimFilters) {
  const ok = match(f);
  return total(sampleClaims().filter((c) => ok(c) && c.day >= daysAgo && c.day - daysAgo < decidedAfter(c)), (c) => c.amount);
}

export function claimKpis(list: Claim[]) {
  const claimed = total(list, (c) => c.amount);
  const paid = total(list, (c) => c.paid);
  const denied = total(list, (c) => c.denied);
  const decided = list.filter((c) => c.status !== "Pending");
  const decidedAmount = total(decided, (c) => c.amount);
  const paidRows = list.filter((c) => c.payDays != null);
  const paDenied = list.filter((c) => c.preAuth === "Denied" && c.denied > 0);
  return {
    claims: list.length, claimed, paid, denied,
    outstanding: total(list.filter((c) => c.status === "Pending"), (c) => c.amount),
    denialRate: decided.length ? (list.filter((c) => c.status === "Denied").length / decided.length) * 100 : 0,
    collectionRate: decidedAmount ? (paid / decidedAmount) * 100 : 0,
    avgPayDays: paidRows.length ? total(paidRows, (c) => c.payDays!) / paidRows.length : 0,
    paDeniedAmount: total(paDenied, (c) => c.denied), paDeniedCount: paDenied.length,
    paDeniedAvg: paDenied.length ? total(paDenied, (c) => c.denied) / paDenied.length : 0,
  };
}
export type ClaimKpis = ReturnType<typeof claimKpis>;

/** Everything the claims dashboard shows, for one set of filters. Every chart, tile and table reads the same slice. */
export function claimsView(f: ClaimFilters, now = new Date()) {
  const list = slice(f);
  const k = claimKpis(list);
  const prev = claimKpis(slice(f, 1));
  const days = PERIOD_DAYS[f.period];
  // Outstanding is a balance, not a flow: the money open today, against the money that was open one period ago.
  k.outstanding = outstandingAsOf(0, f);
  prev.outstanding = outstandingAsOf(days, f);

  // Sparklines: the period split into 12 equal parts, oldest first. Outstanding is read at the end of each part.
  const parts = Array.from({ length: 12 }, (_, i) => {
    const hi = days - (i * days) / 12, lo = days - ((i + 1) * days) / 12;
    return { ...claimKpis(list.filter((c) => c.day < hi && c.day >= lo)), outstanding: outstandingAsOf(Math.round(lo), f) };
  });
  const spark = (key: keyof ClaimKpis) => parts.map((p) => p[key]);

  const decided = list.filter((c) => c.status !== "Pending");
  const status = CLAIM_STATUSES.map((name) => {
    const rows = list.filter((c) => c.status === name);
    const amount = total(rows, (c) => c.amount);
    return { status: name, claims: rows.length, amount, avg: rows.length ? amount / rows.length : 0, share: list.length ? (rows.length / list.length) * 100 : 0 };
  });

  const deniedTotal = k.denied;
  const reasons = DENIAL_REASONS.map((reason) => {
    const rows = list.filter((c) => c.reason === reason);
    return { reason, claims: rows.length, amount: total(rows, (c) => c.denied) };
  }).filter((x) => x.claims > 0).sort((a, b) => b.claims - a.claims);
  let running = 0;
  const pareto = [...reasons].sort((a, b) => b.amount - a.amount).map((x) => {
    running += x.amount;
    return { ...x, share: deniedTotal ? (x.amount / deniedTotal) * 100 : 0, cumulative: deniedTotal ? (running / deniedTotal) * 100 : 0 };
  });

  // Trend in equal blocks counted back from today, so no block is a part month: 30-day, 7-day and 1-day blocks.
  const dateOf = (day: number) => new Date(now.getTime() - day * 86_400_000);
  const blocks = (size: number) => {
    const n = Math.max(1, Math.floor(days / size));
    return Array.from({ length: n }, (_, i) => {
      const hi = (n - i) * size, lo = hi - size;
      const rows = list.filter((c) => c.day < hi && c.day >= lo);
      return { label: fmtDayMonth(dateOf(lo)), claims: rows.length, amount: total(rows, (c) => c.amount) };
    });
  };
  const monthly = blocks(30);
  const weekly = blocks(7);
  const byDay = new Map<number, Claim[]>();
  for (const c of list) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  const daily = Array.from({ length: days }, (_, i) => {
    const day = days - 1 - i;
    const rows = byDay.get(day) ?? [];
    return { label: fmtDayMonth(dateOf(day)), claims: rows.length, amount: total(rows, (c) => c.amount) };
  });

  const depts = [...new Set(list.map((c) => c.dept))].map((dept) => {
    const rows = list.filter((c) => c.dept === dept);
    return { dept, Paid: total(rows, (c) => c.paid), Denied: total(rows, (c) => c.denied) };
  }).sort((a, b) => b.Paid + b.Denied - (a.Paid + a.Denied));

  const deniedRows = list.filter((c) => c.denied > 0);
  const paGroup = (c: Claim) => (c.preAuth === "Denied" || c.reason === "Prior authorization missing" ? 1 : c.preAuth === "Approved" ? 0 : 2);
  const preAuth = ["Approved Prior Authorization", "Denied or Missing Authorization", "No Authorization Needed"].map((name, i) => {
    const rows = deniedRows.filter((c) => paGroup(c) === i);
    return { name, amount: total(rows, (c) => c.denied), claims: rows.length };
  });

  const groups = SERVICE_GROUPS.map((g) => {
    const rows = list.filter((c) => c.group === g.group);
    return { group: g.group, system: g.system, claims: rows.length, avg: rows.length ? total(rows, (c) => c.amount) / rows.length : 0 };
  }).filter((g) => g.claims > 0).sort((a, b) => b.avg - a.avg);

  // Ageing is the state today: every claim still open, for the chosen payer and claim type, whatever the period.
  const pending = sampleClaims().filter((c) => c.status === "Pending" && match(f)(c));
  const ageing = ([["0 to 30 days", 0, 30], ["31 to 60 days", 31, 60], ["61 to 90 days", 61, 90], ["91 to 120 days", 91, 120], ["Over 120 days", 121, 1e9]] as const).map(([band, lo, hi]) => {
    const rows = pending.filter((c) => c.day >= lo && c.day <= hi);
    return { band, claims: rows.length, amount: total(rows, (c) => c.amount) };
  });
  const payTimes = ([["0 to 15", 0, 15], ["16 to 30", 16, 30], ["31 to 45", 31, 45], ["46 to 60", 46, 60], ["61 to 90", 61, 90], ["Over 90", 91, 1e9]] as const).map(([band, lo, hi]) => ({
    band, claims: list.filter((c) => c.payDays != null && c.payDays >= lo && c.payDays <= hi).length,
  }));

  const payers = CLAIM_PAYERS.map((payer) => {
    const kk = claimKpis(list.filter((c) => c.payer === payer));
    return { payer, claims: kk.claims, claimed: kk.claimed, paid: kk.paid, denied: kk.denied, denialRate: kk.denialRate, paidRatio: kk.claimed ? (kk.paid / kk.claimed) * 100 : 0, avgPayDays: kk.avgPayDays };
  }).filter((p) => p.claims > 0).sort((a, b) => b.claimed - a.claimed);

  const types = CLAIM_TYPES.map((t) => {
    const rows = list.filter((c) => c.type === t);
    return { type: t, claims: rows.length, amount: total(rows, (c) => c.amount) };
  });

  const funnel = [
    { stage: "Submitted", amount: k.claimed, claims: list.length },
    { stage: "Adjudicated", amount: total(decided, (c) => c.amount), claims: decided.length },
    { stage: "Approved", amount: total(decided, (c) => c.amount - c.denied), claims: decided.filter((c) => c.status !== "Denied").length },
    { stage: "Paid", amount: k.paid, claims: list.filter((c) => c.paid > 0).length },
  ];

  return { kpis: k, prev, spark, status, reasons, pareto, monthly, weekly, daily, depts, preAuth, groups, ageing, payTimes, payers, types, funnel };
}
export type ClaimsView = ReturnType<typeof claimsView>;


/* ---------- Main dashboard: visits this week, today's agenda, goals ---------- */

/** Sample visits for the week before the last 7 days, by class, for the change pill on the visits chart. */
export const VISITS_LAST_WEEK = { Outpatient: 286, Inpatient: 61, Emergency: 132 };

export interface AgendaItem { id: string; time: string; end: string; kind: "Clinic" | "Online" | "Theatre"; title: string; detail: string; status: string; done: boolean; route: string }

/** Today's appointments and theatre cases from the stores, in time order. Cancelled and no-show appointments are left out. */
export function todayAgenda(now = new Date()): AgendaItem[] {
  const today = todayOf(now.getTime());
  const s = getState();
  const nameOf = (id: string) => patientName(s.patients.find((p) => p.id === id));
  const appts: AgendaItem[] = getAppointments().appointments
    .filter((a) => a.date === today && isLive(a.status))
    .map((a) => ({
      id: a.id, time: a.start, end: a.end, kind: a.visitType === "online" ? "Online" : "Clinic", title: nameOf(a.patientId),
      detail: `${doctorName(a.doctorId)}, ${a.speciality}`, status: APPT_STATUS[a.status], done: ["checked-out", "completed"].includes(a.status), route: "/m/appointments",
    }));
  const cases: AgendaItem[] = allCases()
    .filter((c) => c.schedule?.date === today && !c.closed)
    .map((c) => ({
      id: c.id, time: c.schedule!.start, end: scheduleEnd(c.schedule!), kind: "Theatre", title: nameOf(c.patientId),
      detail: `${c.request.procedure}, ${c.schedule!.room}`, status: scheduleStatus(c) ?? "Requested", done: scheduleStatus(c) === "Completed", route: "/theatre",
    }));
  return [...appts, ...cases].sort((a, b) => a.time.localeCompare(b.time));
}

/** Sample share of claims sent to NPHIES within 24 hours of the visit closing, for the goals card. */
export const CLAIMS_24H: Record<RangeId, number> = { Today: 91, Yesterday: 94, "This week": 92, "This month": 89, "Last month": 86, "Last 30 days": 88 };
