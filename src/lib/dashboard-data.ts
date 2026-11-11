import { clockOf, stageOf } from "./ed";
import { RCM } from "./masters/rcm";
import type { HisState } from "./model";
import { buildOutbox, STATE_LABEL, type SendState } from "./nphies-outbox";
import { BEDS, WARDS } from "./reference-data";
import { getState } from "./store";

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
    ready: outbox.filter((r) => r.ready && r.action && r.state !== "rejected").length,
    rejected: byState("rejected"),
    wards: WARDS.map((w) => {
      const beds = BEDS.filter((b) => b.ward === w.ward);
      const used = beds.filter((b) => occupied.has(b.id)).length;
      return { ward: w.name, used, free: beds.length - used, total: beds.length };
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
    return { day: i === all.length - 1 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short" }), Outpatient: opd, Inpatient: ipd, Emergency: er };
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
    nationality: count((p) => COUNTRY[p.nationality] ?? (p.nationality || "Not recorded")).slice(0, 6),
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
