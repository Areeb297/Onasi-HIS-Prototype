import { audit } from "./audit";
import { coverageView } from "./chart-entries";
import { createStore } from "./fhir/store-util";
import type { Encounter, HisState, Patient } from "./model";
import { caseOf, estimateCharge, financialVisits, getFinancial, PAYER_SHARE, payerShareOf, type Charge } from "./nphies-financial";
import { FACILITY_NAME } from "./reference-data";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";

/**
 * Cashier invoices, one per visit, as the HIS has them: invoice worklist, invoice detail, Record Payment (new payment,
 * payment waiver, adjust payment), refund of an overpayment, receipt, and reporting to ZATCA.
 *
 * The lines come from estimateCharge in nphies-financial.ts and the insured share from payerShareOf (the co-pay on the card). The payer is the
 * patient's real coverage, read the same way as the chart header (coverageView in chart-entries.ts): a patient with no
 * insurance card, or a visit registered as cash, has no insurance share and pays the whole amount.
 *
 * Life of an invoice:
 *  - Created the first time anyone opens it (or opens the worklist). Invoice numbers are given at creation.
 *  - Draft while the visit is open. The lines follow the visit: a new order adds to a line, a cancelled order takes it off.
 *    Money already placed on a line that shrinks becomes unallocated money on that payment (Adjust Payment moves it to another
 *    line; Process Refund gives it back when the patient has paid more than is due).
 *  - Submitted once the visit is finished (discharged). The lines no longer change.
 *  - Closed when both the patient balance and the insurance balance are zero. The insurance balance is paid by the payer:
 *    it drops when NPHIES Financial records the payer's payment for the visit.
 *
 * ZATCA (simulated): patient invoices are simplified tax invoices and must be reported within 24 hours. The first payment
 * reports the invoice automatically; Send To ZATCA does it by hand. A reported invoice that changes afterwards goes back to
 * Pending (in a live system the change is sent as a credit or debit note) and the 24 hours start again.
 */

/* ---------- constants ---------- */

export const VAT_RATE = 0.15;
export const ZATCA_HOURS = 24;
/** Made-up VAT registration number of the hospital, for the receipt and the QR placeholder. 15 digits, starts and ends with 3. */
export const SELLER_VAT_NUMBER = "310123456700003";
export const CLINIC_NAME = FACILITY_NAME;

export type InvoiceStatus = "Draft" | "Submitted" | "Closed";
export type PayMethod = "Cash" | "Card" | "Bank Transfer";
export const PAY_METHODS: PayMethod[] = ["Cash", "Card", "Bank Transfer"];
/** The HIS loads these from a lookup list that is not in the source. Sensible values. */
export const WAIVER_TYPES = ["Management Approval", "Staff Courtesy", "Charity Case", "Financial Hardship"];
export type ZatcaStatus = "Pending" | "Reported" | "Failed";

/**
 * VAT on the patient share. RULE TO CONFIRM WITH FINANCE: 15 percent is charged on the patient share only when the patient
 * is not a Saudi national (the state carries the VAT for Saudi citizens in private healthcare). An unknown nationality
 * (999) is charged until it is corrected. The insurance share carries no VAT here.
 */
export function vatAppliesToPatientShare(p: Pick<Patient, "nationality">): boolean {
  return p.nationality !== "SAU";
}

/* ---------- records ---------- */

export interface InvoiceLine {
  /** visit, lab, rad or rx. One line per kind, from estimateCharge. */
  key: string;
  service: string;
  unitCost: number;
  units: number;
  /** Discount in SAR. Zero for now: contractual discounts are not modelled. */
  discount: number;
}

export interface Transaction {
  id: string;
  kind: "payment" | "waiver" | "refund";
  at: string;
  amount: number;
  method?: PayMethod;
  reference?: string;
  /** Name of the proof file (screenshot or PDF). Only the name is kept. */
  proofName?: string;
  waiverType?: string;
  /** Payment or waiver money placed on lines, by line key. */
  allocations: Record<string, number>;
  /** Payment money given back by refunds. */
  refunded: number;
  /** Refund only: the payments the money came from, by transaction id. */
  from?: Record<string, number>;
  by: string;
}

export interface ZatcaRecord {
  status: ZatcaStatus;
  /** The 24 hours count from here: creation, or the last change after reporting. */
  clockFrom: string;
  reportedAt?: string;
  /** Made-up ZATCA reference once reported. */
  uuid?: string;
  attempts: number;
  message?: string;
  /** Reported by the first payment rather than by the button. */
  auto?: boolean;
}

export interface Invoice {
  visit: string;
  number: number;
  patientId: string;
  createdAt: string;
  /** Set when the visit is finished. From then the lines are fixed. */
  finalizedAt?: string;
  /** Payer name, or null for a cash visit. */
  insurer: string | null;
  /** The part of each line the payer pays, 0 to 1, from the co-pay on the card. Older invoices have none: 90 percent. */
  payerShare?: number;
  vat: boolean;
  lines: InvoiceLine[];
  transactions: Transaction[];
  zatca: ZatcaRecord;
}

interface InvoiceState {
  invoices: Invoice[];
  seq: number;
  txSeq: number;
  /** Developer switch: the next ZATCA report fails. */
  zatcaFailNext: boolean;
}

const EMPTY = (): InvoiceState => ({ invoices: [], seq: 0, txSeq: 0, zatcaFailNext: false });
const store = createStore<InvoiceState>("onasi-emr-invoices-v1", EMPTY);
export const useInvoices = store.use;
export const getInvoices = store.get;
export const resetInvoices = store.reset;
export const setZatcaFailNext = (on: boolean) => store.set({ ...store.get(), zatcaFailNext: on });

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ---------- money ---------- */

/** Rounds to halalas. Never returns -0, so a settled balance reads as 0. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 + 0;
const isZero = (n: number) => Math.abs(n) < 0.005;
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
export const sar = (n: number) => `${round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;

/* ---------- lines from the visit ---------- */

const KIND_SERVICE: Record<string, string> = { lab: "Laboratory Test", rad: "Radiology Exam", rx: "Medication Item" };

/** Turns the NPHIES Financial charge into invoice lines (unit cost times units). */
export function linesFromCharge(charge: Charge): InvoiceLine[] {
  return charge.lines.map((l) => {
    const key = l.label.startsWith("Laboratory") ? "lab" : l.label.startsWith("Radiology") ? "rad" : l.label.startsWith("Medication") ? "rx" : "visit";
    const units = Number(/\((\d+) /.exec(l.label)?.[1] ?? 1) || 1;
    return { key, service: KIND_SERVICE[key] ?? l.label, unitCost: round2(l.amount / units), units, discount: 0 };
  });
}

/**
 * Payer of the visit, or null for a cash patient. Same rule as the chart header: the insurance card on the patient's
 * file, unless there is none or the visit was registered as cash.
 */
export function insurerOf(p: Pick<Patient, "extra">): string | null {
  const payer = coverageView(p, new Date().toISOString().slice(0, 10)).payer;
  return payer === "Cash" ? null : payer;
}

const finished = (e: Encounter) => e.status === "discharged" || e.status === "cancelled";

/* ---------- computed view ---------- */

export interface LineView extends InvoiceLine {
  gross: number;
  net: number;
  patientAmount: number;
  patientTax: number;
  insuranceAmount: number;
  insuranceTax: number;
  tax: number;
  total: number;
  patientPayable: number;
  patientPaid: number;
  patientBalance: number;
  insurancePayable: number;
  insurancePaid: number;
  insuranceBalance: number;
}

export interface Totals {
  gross: number;
  discount: number;
  /** Net of discount, before tax. */
  taxable: number;
  tax: number;
  total: number;
  patientAmount: number;
  patientTax: number;
  patientPayable: number;
  insuranceAmount: number;
  insuranceTax: number;
  insurancePayable: number;
  /** Money taken from the patient, less refunds. Waivers are not money. */
  patientPaid: number;
  waived: number;
  refunded: number;
  insurancePaid: number;
  /** What the patient still owes. Below zero means the hospital owes the patient. */
  patientBalance: number;
  insuranceBalance: number;
  /** Paid by the patient and the payer together. */
  paid: number;
}

export interface InvoiceView {
  invoice: Invoice;
  status: InvoiceStatus;
  lines: LineView[];
  totals: Totals;
  /** Payment money not placed on a line and not refunded, by transaction id. */
  unallocated: Record<string, number>;
  overpaid: number;
}

export function lineShares(l: InvoiceLine, insured: boolean, vat: boolean, payerShare: number = PAYER_SHARE) {
  const gross = round2(l.unitCost * l.units);
  const net = round2(gross - l.discount);
  const patientAmount = insured ? round2(net * (1 - payerShare)) : net;
  const insuranceAmount = round2(net - patientAmount);
  const patientTax = vat ? round2(patientAmount * VAT_RATE) : 0;
  const insuranceTax = 0;
  return { gross, net, patientAmount, insuranceAmount, patientTax, insuranceTax, tax: round2(patientTax + insuranceTax), total: round2(net + patientTax + insuranceTax) };
}

const allocatedTo = (inv: Invoice, key: string) => sum(inv.transactions.filter((t) => t.kind !== "refund").map((t) => t.allocations[key] ?? 0));

export const unallocatedOf = (t: Transaction) =>
  t.kind === "refund" ? 0 : round2(t.amount - sum(Object.values(t.allocations)) - t.refunded);

/** What the payer has paid on the visit, from NPHIES Financial. */
export function payerPaid(visit: string, fin = getFinancial()): number {
  return caseOf(visit, fin).payment?.amount ?? 0;
}

export function statusOf(inv: Pick<Invoice, "finalizedAt" | "lines">, patientBalance: number, insuranceBalance: number): InvoiceStatus {
  if (inv.lines.length && isZero(patientBalance) && isZero(insuranceBalance)) return "Closed";
  return inv.finalizedAt ? "Submitted" : "Draft";
}

export function invoiceView(inv: Invoice, insurancePaidTotal: number = payerPaid(inv.visit)): InvoiceView {
  const insured = !!inv.insurer;
  let insLeft = round2(Math.max(0, insurancePaidTotal));
  const lines: LineView[] = inv.lines.map((l) => {
    const s = lineShares(l, insured, inv.vat, inv.payerShare);
    const patientPayable = round2(s.patientAmount + s.patientTax);
    const insurancePayable = round2(s.insuranceAmount + s.insuranceTax);
    const patientPaid = allocatedTo(inv, l.key);
    const insurancePaid = round2(Math.min(insLeft, insurancePayable));
    insLeft = round2(insLeft - insurancePaid);
    return {
      ...l, ...s, patientPayable, patientPaid, patientBalance: round2(patientPayable - patientPaid),
      insurancePayable, insurancePaid, insuranceBalance: round2(insurancePayable - insurancePaid),
    };
  });
  const tx = inv.transactions;
  const received = sum(tx.filter((t) => t.kind !== "refund").map((t) => t.amount));
  const waived = sum(tx.filter((t) => t.kind === "waiver").map((t) => t.amount));
  const refunded = sum(tx.filter((t) => t.kind === "refund").map((t) => t.amount));
  const patientPayable = sum(lines.map((l) => l.patientPayable));
  const insurancePayable = sum(lines.map((l) => l.insurancePayable));
  const insurancePaid = sum(lines.map((l) => l.insurancePaid));
  const patientBalance = round2(patientPayable - received + refunded);
  const insuranceBalance = round2(insurancePayable - insurancePaid);
  const patientPaid = round2(received - waived - refunded);
  const totals: Totals = {
    gross: sum(lines.map((l) => l.gross)),
    discount: sum(lines.map((l) => l.discount)),
    taxable: sum(lines.map((l) => l.net)),
    tax: sum(lines.map((l) => l.tax)),
    total: sum(lines.map((l) => l.total)),
    patientAmount: sum(lines.map((l) => l.patientAmount)),
    patientTax: sum(lines.map((l) => l.patientTax)),
    patientPayable,
    insuranceAmount: sum(lines.map((l) => l.insuranceAmount)),
    insuranceTax: sum(lines.map((l) => l.insuranceTax)),
    insurancePayable,
    patientPaid, waived, refunded, insurancePaid, patientBalance, insuranceBalance,
    paid: round2(patientPaid + insurancePaid),
  };
  const unallocated: Record<string, number> = {};
  for (const t of tx) {
    const u = unallocatedOf(t);
    if (u > 0.004) unallocated[t.id] = u;
  }
  return { invoice: inv, status: statusOf(inv, patientBalance, insuranceBalance), lines, totals, unallocated, overpaid: patientBalance < -0.004 ? round2(-patientBalance) : 0 };
}

/* ---------- create and refresh ---------- */

const who = (): string => {
  try { return currentUser().name; } catch { return "Unknown"; }
};
const iso = (t: number) => new Date(t).toISOString();

export const invoiceOf = (visit: string, s: InvoiceState = store.get()): Invoice | undefined => s.invoices.find((i) => i.visit === visit);

const sameLines = (a: InvoiceLine[], b: InvoiceLine[]) =>
  a.length === b.length && a.every((l, i) => l.key === b[i].key && l.units === b[i].units && l.unitCost === b[i].unitCost && l.discount === b[i].discount);

/**
 * Takes money off lines that are now smaller than what was placed on them (an order was cancelled).
 * Waivers give back first and simply shrink, since no money changed hands. Then the newest payments give back,
 * and that money stays on the payment as unallocated.
 */
function trimAllocations(inv: Invoice): Invoice {
  const insured = !!inv.insurer;
  const payable: Record<string, number> = {};
  for (const l of inv.lines) {
    const s = lineShares(l, insured, inv.vat, inv.payerShare);
    payable[l.key] = round2(s.patientAmount + s.patientTax);
  }
  const txs = inv.transactions.map((t) => ({ ...t, allocations: { ...t.allocations } }));
  const order = [
    ...txs.map((t, i) => ({ t, i })).filter((x) => x.t.kind === "waiver").reverse(),
    ...txs.map((t, i) => ({ t, i })).filter((x) => x.t.kind === "payment").reverse(),
  ].map((x) => x.t);
  const keys = new Set(txs.flatMap((t) => Object.keys(t.allocations)));
  for (const key of keys) {
    let over = round2(sum(txs.map((t) => t.allocations[key] ?? 0)) - (payable[key] ?? 0));
    for (const t of order) {
      if (over <= 0.004) break;
      const a = t.allocations[key] ?? 0;
      if (a <= 0) continue;
      const take = round2(Math.min(a, over));
      const left = round2(a - take);
      if (left > 0.004) t.allocations[key] = left;
      else delete t.allocations[key];
      if (t.kind === "waiver") t.amount = round2(t.amount - take);
      over = round2(over - take);
    }
  }
  return { ...inv, transactions: txs.filter((t) => t.kind !== "waiver" || t.amount > 0.004) };
}

/** Rebuilds a Draft invoice from the visit. Returns the same object when nothing changed. */
export function refreshInvoice(inv: Invoice, enc: Encounter, p: Patient, now: number = Date.now()): Invoice {
  if (inv.finalizedAt) {
    // The lines of a finished visit are fixed. Only the payer is put right, and only while no money has been taken,
    // so an invoice made before the payer was read from the patient's coverage does not keep a wrong insurer.
    const insurer = insurerOf(p);
    return inv.insurer !== insurer && inv.transactions.length === 0 ? { ...inv, insurer, payerShare: insurer ? payerShareOf(p) : undefined } : inv;
  }
  const lines = linesFromCharge(estimateCharge(enc));
  const insurer = insurerOf(p);
  const vat = vatAppliesToPatientShare(p);
  const payerShare = insurer ? payerShareOf(p) : undefined;
  let next = inv;
  if (!sameLines(inv.lines, lines) || inv.insurer !== insurer || inv.vat !== vat || inv.payerShare !== payerShare) {
    next = trimAllocations({ ...inv, lines, insurer, vat, payerShare });
    if (inv.zatca.status === "Reported" || inv.zatca.status === "Failed") {
      next.zatca = {
        ...inv.zatca, status: "Pending", clockFrom: iso(now),
        message: "The invoice changed after it was reported. Send it again: a live system sends the change as a credit or debit note.",
      };
    }
  }
  if (finished(enc)) next = { ...next, finalizedAt: iso(now) };
  return next;
}

function contextOf(visit: string, his: HisState = getState()): { enc: Encounter; patient: Patient } | null {
  const enc = his.encounters.find((e) => e.visitNumber === visit);
  const patient = enc && his.patients.find((p) => p.id === enc.patientId);
  return enc && patient ? { enc, patient } : null;
}

function upsert(s: InvoiceState, inv: Invoice): InvoiceState {
  return { ...s, invoices: s.invoices.some((i) => i.visit === inv.visit) ? s.invoices.map((i) => (i.visit === inv.visit ? inv : i)) : [...s.invoices, inv] };
}

function createOrRefresh(s: InvoiceState, visit: string, now: number): { s: InvoiceState; created?: Invoice } {
  const ctx = contextOf(visit);
  if (!ctx) return { s };
  const existing = invoiceOf(visit, s);
  if (existing) {
    const next = refreshInvoice(existing, ctx.enc, ctx.patient, now);
    return { s: next === existing ? s : upsert(s, next) };
  }
  const seq = s.seq + 1;
  const base: Invoice = {
    visit, number: 100000 + seq, patientId: ctx.patient.id, createdAt: iso(now), insurer: insurerOf(ctx.patient), vat: vatAppliesToPatientShare(ctx.patient),
    lines: [], transactions: [], zatca: { status: "Pending", clockFrom: iso(now), attempts: 0 },
  };
  const inv = refreshInvoice(base, ctx.enc, ctx.patient, now);
  return { s: upsert({ ...s, seq }, inv), created: inv };
}

/** Creates the invoice of a visit on first open, or refreshes its lines while it is a draft. */
export function ensureInvoice(visit: string, now: number = Date.now()): Invoice | null {
  const before = store.get();
  const { s, created } = createOrRefresh(before, visit, now);
  if (s !== before) store.set(s);
  if (created) audit("create", `Invoice #${created.number}`, { patient: nameOf(created), detail: `Visit ${visit}` });
  return invoiceOf(visit, s) ?? null;
}

/** Creates or refreshes the invoices of every billable visit (the worklist). One store write. */
export function syncInvoices(now: number = Date.now()): void {
  const before = store.get();
  let s = before;
  const created: Invoice[] = [];
  for (const v of financialVisits()) {
    const r = createOrRefresh(s, v.enc.visitNumber, now);
    s = r.s;
    if (r.created) created.push(r.created);
  }
  if (s !== before) store.set(s);
  for (const c of created) audit("create", `Invoice #${c.number}`, { patient: nameOf(c), detail: `Visit ${c.visit}` });
}

function nameOf(inv: Invoice): string {
  return patientName(getState().patients.find((p) => p.id === inv.patientId));
}

/* ---------- worklist ---------- */

export interface WorklistRow {
  view: InvoiceView;
  patient: Patient | undefined;
}

export interface WorklistFilter {
  patient?: string;
  number?: string;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
}

const localDay = (isoText: string) => {
  const d = new Date(isoText);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function worklist(f: WorklistFilter = {}, s: InvoiceState = store.get(), his: HisState = getState(), fin = getFinancial()): WorklistRow[] {
  const q = f.patient?.trim().toLowerCase() ?? "";
  const num = f.number?.replace(/\D/g, "") ?? "";
  return s.invoices
    .map((inv) => ({ view: invoiceView(inv, payerPaid(inv.visit, fin)), patient: his.patients.find((p) => p.id === inv.patientId) }))
    .filter(({ view, patient }) => {
      if (q && !`${patientName(patient)} ${patient?.mrn ?? ""} ${patient?.nationalId ?? ""}`.toLowerCase().includes(q)) return false;
      if (num && !String(view.invoice.number).includes(num)) return false;
      const day = localDay(view.invoice.createdAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    })
    .sort((a, b) => b.view.invoice.number - a.view.invoice.number);
}

/* ---------- ZATCA ---------- */

export interface ZatcaClock {
  status: ZatcaStatus;
  deadline: number;
  msLeft: number;
  overdue: boolean;
  /** Plain words for the tag: "Reported 14 Nov 10:20", "18 hours 5 minutes left", "Overdue by 2 hours". */
  text: string;
}

function durationText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minute${m === 1 ? "" : "s"}` : ""}`;
}

export function zatcaClock(inv: Invoice, now: number = Date.now()): ZatcaClock {
  const z = inv.zatca;
  const deadline = new Date(z.clockFrom).getTime() + ZATCA_HOURS * 3600_000;
  const msLeft = deadline - now;
  if (z.status === "Reported") {
    const at = z.reportedAt ? new Date(z.reportedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return { status: z.status, deadline, msLeft, overdue: false, text: `Reported ${at}`.trim() };
  }
  const overdue = msLeft <= 0;
  return { status: z.status, deadline, msLeft, overdue, text: overdue ? `Overdue by ${durationText(-msLeft)}` : `${durationText(msLeft)} left to report` };
}

const hex = (n: number, len = 8) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What a real ZATCA QR code holds (seller, VAT number, time, total, VAT), as text. Only a placeholder is drawn. */
export function zatcaQrText(v: InvoiceView): string {
  return [CLINIC_NAME, SELLER_VAT_NUMBER, v.invoice.zatca.reportedAt ?? "", v.totals.total.toFixed(2), v.totals.tax.toFixed(2)].join("|");
}
export const qrSeed = (text: string) => hash(text);

function reportOne(s: InvoiceState, inv: Invoice, now: number, auto: boolean): { s: InvoiceState; ok: boolean } {
  const fail = s.zatcaFailNext;
  const attempts = inv.zatca.attempts + 1;
  const zatca: ZatcaRecord = fail
    ? { ...inv.zatca, status: "Failed", attempts, auto, message: "ZATCA did not accept the invoice: the signature check failed. Send it again." }
    : {
        status: "Reported", clockFrom: inv.zatca.clockFrom, reportedAt: iso(now), attempts, auto,
        uuid: `${hex(hash(`${inv.visit}${now}`))}-${hex(hash(`${inv.number}`), 4)}-4${hex(attempts, 3)}-${hex(hash(inv.patientId), 4)}-${hex(now, 12)}`,
      };
  return { s: { ...upsert(s, { ...inv, zatca }), zatcaFailNext: fail ? false : s.zatcaFailNext }, ok: !fail };
}

/** Send To ZATCA, for one invoice or many (bulk). Simulated. */
export function sendToZatca(visits: string[], now: number = Date.now()): Result<{ reported: number; failed: number; skipped: number }> {
  if (!can("billing")) {
    audit("denied", "Send To ZATCA", { detail: "Needs billing" });
    return { ok: false, errors: ["Your role cannot send invoices to ZATCA. This needs the billing permission."] };
  }
  let s = store.get();
  let reported = 0, failed = 0, skipped = 0;
  for (const visit of visits) {
    const inv = invoiceOf(visit, s);
    if (!inv || inv.zatca.status === "Reported") { skipped++; continue; }
    const r = reportOne(s, inv, now, false);
    s = r.s;
    if (r.ok) reported++; else failed++;
    audit("send-document", `Invoice #${inv.number} to ZATCA`, { patient: nameOf(inv), detail: r.ok ? "Reported" : "Failed" });
  }
  store.set(s);
  return { ok: true, value: { reported, failed, skipped } };
}

/* ---------- payments ---------- */

function denied(target: string, inv?: Invoice): Result<never> {
  audit("denied", target, { patient: inv ? nameOf(inv) : undefined, detail: "Needs billing" });
  return { ok: false, errors: ["Your role cannot do this. It needs the billing permission."] };
}

export interface PaymentInput {
  amount: number;
  method: PayMethod;
  reference?: string;
  proofName?: string;
  /** A waiver type writes off the whole patient balance. The amount is then zero. */
  waiverType?: string;
}

/** Places money on the lines with a patient balance, top to bottom. */
function allocateInOrder(view: InvoiceView, amount: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = round2(amount);
  for (const l of view.lines) {
    if (left <= 0.004) break;
    if (l.patientBalance <= 0.004) continue;
    const put = round2(Math.min(left, l.patientBalance));
    out[l.key] = put;
    left = round2(left - put);
  }
  return out;
}

/** Record Payment, New Payment tab. */
export function takePayment(visit: string, input: PaymentInput, now: number = Date.now()): Result<Transaction> {
  const inv0 = invoiceOf(visit);
  if (!can("billing")) return denied(inv0 ? `Invoice #${inv0.number}` : `Invoice for visit ${visit}`, inv0);
  const inv = ensureInvoice(visit, now);
  if (!inv) return { ok: false, errors: ["This invoice was not found."] };
  const view = invoiceView(inv);
  const balance = view.totals.patientBalance;
  if (balance <= 0.004) return { ok: false, errors: ["Nothing is due on this invoice."] };
  const waiver = input.waiverType?.trim();
  const errors: string[] = [];
  if (waiver && !WAIVER_TYPES.includes(waiver)) errors.push("Choose a waiver type from the list.");
  const amount = waiver ? balance : round2(Number(input.amount));
  if (!waiver) {
    if (!Number.isFinite(amount) || amount <= 0) errors.push("Enter an amount above zero.");
    else if (amount > balance + 0.004) errors.push(`The amount is more than the balance of ${sar(balance)}.`);
    if (!PAY_METHODS.includes(input.method)) errors.push("Choose the payment method.");
  }
  if (errors.length) return { ok: false, errors };

  let s = store.get();
  const txSeq = s.txSeq + 1;
  const cash = input.method === "Cash";
  const t: Transaction = {
    id: `TX-${txSeq}`, kind: waiver ? "waiver" : "payment", at: iso(now), amount,
    method: waiver ? undefined : input.method,
    reference: waiver || cash ? undefined : input.reference?.trim() || undefined,
    proofName: waiver || cash ? undefined : input.proofName?.trim() || undefined,
    waiverType: waiver || undefined,
    allocations: allocateInOrder(view, amount), refunded: 0, by: who(),
  };
  const first = !inv.transactions.some((x) => x.kind !== "refund");
  let next: Invoice = { ...inv, transactions: [...inv.transactions, t] };
  s = upsert({ ...s, txSeq }, next);
  audit("update", `Invoice #${inv.number}`, {
    patient: nameOf(inv),
    detail: waiver ? `Payment waiver (${waiver}) of ${sar(amount)}` : `Payment of ${sar(amount)} by ${input.method}${t.reference ? `, reference ${t.reference}` : ""}`,
  });
  // Simplified invoices must reach ZATCA within 24 hours: the first payment reports the invoice.
  if (first && next.zatca.status !== "Reported") {
    const r = reportOne(s, next, now, true);
    s = r.s;
    next = invoiceOf(visit, s)!;
    audit("send-document", `Invoice #${inv.number} to ZATCA`, { patient: nameOf(inv), detail: r.ok ? "Reported with the first payment" : "Failed with the first payment" });
  }
  store.set(s);
  return { ok: true, value: t };
}

/** Record Payment, Adjust Payment tab: place a payment's unallocated money on unpaid lines. */
export function allocatePayment(visit: string, txId: string, amounts: Record<string, number>): Result<Transaction> {
  const inv = invoiceOf(visit);
  if (!can("billing")) return denied(inv ? `Invoice #${inv.number}` : `Invoice for visit ${visit}`, inv);
  if (!inv) return { ok: false, errors: ["This invoice was not found."] };
  const t = inv.transactions.find((x) => x.id === txId && x.kind !== "refund");
  if (!t) return { ok: false, errors: ["Choose a payment first."] };
  const view = invoiceView(inv);
  const free = unallocatedOf(t);
  const errors: string[] = [];
  const clean: Record<string, number> = {};
  for (const [key, raw] of Object.entries(amounts)) {
    const a = round2(Number(raw) || 0);
    if (a < 0) { errors.push("Amounts cannot be below zero."); continue; }
    if (a === 0) continue;
    const line = view.lines.find((l) => l.key === key);
    if (!line) { errors.push("A line on this invoice was not found."); continue; }
    if (a > line.patientBalance + 0.004) errors.push(`${line.service}: ${sar(a)} is more than its balance of ${sar(line.patientBalance)}.`);
    clean[key] = a;
  }
  const total = sum(Object.values(clean));
  if (!errors.length && total <= 0) errors.push("Enter an amount for at least one line.");
  if (total > free + 0.004) errors.push(`The total ${sar(total)} is more than the ${sar(free)} this payment has free.`);
  if (errors.length) return { ok: false, errors };

  const allocations = { ...t.allocations };
  for (const [k, a] of Object.entries(clean)) allocations[k] = round2((allocations[k] ?? 0) + a);
  const nt: Transaction = { ...t, allocations };
  store.set(upsert(store.get(), { ...inv, transactions: inv.transactions.map((x) => (x.id === t.id ? nt : x)) }));
  audit("update", `Invoice #${inv.number}`, { patient: nameOf(inv), detail: `Payment ${t.id}: ${sar(total)} placed on ${Object.keys(clean).length} line(s)` });
  return { ok: true, value: nt };
}

export interface RefundInput {
  method: PayMethod;
  reference?: string;
  proofName?: string;
}

/** Process Refund: gives back the whole overpayment, from the payments' unallocated money, newest first. */
export function refundOverpayment(visit: string, input: RefundInput, now: number = Date.now()): Result<Transaction> {
  const inv = invoiceOf(visit);
  if (!can("billing")) return denied(inv ? `Invoice #${inv.number}` : `Invoice for visit ${visit}`, inv);
  if (!inv) return { ok: false, errors: ["This invoice was not found."] };
  const view = invoiceView(inv);
  if (view.overpaid <= 0) return { ok: false, errors: ["The patient has not paid more than is due."] };
  if (!PAY_METHODS.includes(input.method)) return { ok: false, errors: ["Choose the refund method."] };
  let need = view.overpaid;
  const from: Record<string, number> = {};
  const txs = inv.transactions.map((t) => ({ ...t }));
  for (let i = txs.length - 1; i >= 0 && need > 0.004; i--) {
    const free = unallocatedOf(txs[i]);
    if (free <= 0.004) continue;
    const take = round2(Math.min(free, need));
    txs[i].refunded = round2(txs[i].refunded + take);
    from[txs[i].id] = take;
    need = round2(need - take);
  }
  let s = store.get();
  const txSeq = s.txSeq + 1;
  const r: Transaction = {
    id: `TX-${txSeq}`, kind: "refund", at: iso(now), amount: view.overpaid, method: input.method,
    reference: input.reference?.trim() || undefined, proofName: input.proofName?.trim() || undefined,
    allocations: {}, refunded: 0, from, by: who(),
  };
  s = upsert({ ...s, txSeq }, { ...inv, transactions: [...txs, r] });
  store.set(s);
  audit("update", `Invoice #${inv.number}`, { patient: nameOf(inv), detail: `Refund of ${sar(r.amount)} by ${input.method}` });
  return { ok: true, value: r };
}
