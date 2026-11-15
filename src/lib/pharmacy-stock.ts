import { audit } from "./audit";
import { DRUGS, DRUG_BY_ID } from "./rx-catalogue";
import { batchesFor } from "./rx-stock";
import type { Dispense, Drug, Prescription, RxItem, RxState } from "./rx-types";
import { needsPharmacist, pharmacyItems, type VerifyStatus } from "./rx-verify";
import { can, currentUser } from "./session";
import {
  addedBatches, extraBatchesFor, getStock, normLot, resetStock, setStock, useStock,
  type AddedBatch, type GoodsReceipt, type OpeningEntry, type ReceiptStatus, type StockLineInput, type StockState,
} from "./stock-store";

export { addedBatches, extraBatchesFor, getStock, normLot, resetStock, setStock, useStock };
export type { AddedBatch, GoodsReceipt, OpeningEntry, ReceiptStatus, StockLineInput, StockState };
const store = { get: getStock, set: setStock };

/**
 * Pharmacy stock control: Stock On Hand, Low Stock, Expiry Watch, Opening Stock Entry and Goods Receipt.
 *
 * Layered on top of rx-stock.ts. The batches there are worked out from the drug id and cannot take new ones, so the
 * batches added here (opening stock and posted goods receipts) live in this store and are joined to them for the stock
 * screens. The same rule takes dispensed medicine off: completed dispense lines are matched to a batch by lot.
 *
 * rx-stock.batchesFor reads the added batches from stock-store.ts, so stock added here is offered in the Dispense dialog and
 * passes the dispense gate. This file shows them as their own rows, with their location, source and cost, and takes care that a
 * unit handed over is taken off only once.
 *
 * Hospital data only. Nothing here goes to nphies.
 */

/** Where the hospital keeps medicine. The HIS loads these from its location master. Sensible values. */
export const LOCATIONS = ["Main Pharmacy", "Inpatient Pharmacy", "Emergency Pharmacy", "Central Store"] as const;
/** The batches from rx-stock.ts are kept here. */
export const DEFAULT_LOCATION = "Main Pharmacy";
/** Made-up suppliers. The HIS loads these from its supplier master. */
export const SUPPLIERS = ["Al Wadi Medical Supply", "Najd Pharma Distribution", "Red Sea Healthcare Trading", "Qassim Medical Store", "Eastern Province Drug Company"];
/** A drug is low when what can still be used, across every location, is under this many packs. */
export const REORDER_PACKS = 5;
/** Batches that expire within this many days are on the Expiry Watch. */
export const EXPIRY_WATCH_DAYS = 90;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ---------- small helpers ---------- */

const round = (n: number) => Math.round(n * 1e4) / 1e4;
/** Today as YYYY-MM-DD, the same way rx-stock.ts compares expiry dates. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Local calendar day, for "dispensed today". */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

/** Whole days from today to the expiry date. Below zero once expired. */
export function daysToExpiry(expiry: string, today: Date): number {
  const a = new Date(`${isoDay(today)}T00:00:00Z`).getTime();
  const b = new Date(`${expiry.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export const reorderLevel = (drug: Pick<Drug, "pack">): number => drug.pack.size * REORDER_PACKS;

const who = () => {
  try { return currentUser().name; } catch { return "Unknown"; }
};
const mayEdit = () => can("rx.dispense") || can("admin");

/** Units handed over from each lot of a drug: completed dispense lines only, the same rule as rx-stock.ts. */
export function dispensedByLot(drugId: string, dispenses: Dispense[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const d of dispenses) {
    for (const l of d.lines) {
      if (l.drugId === drugId && l.status === "completed" && l.lot) {
        const k = normLot(l.lot);
        used.set(k, round((used.get(k) ?? 0) + l.quantity));
      }
    }
  }
  return used;
}

/* ---------- stock on hand ---------- */

export interface StockRow {
  key: string;
  drug: Drug;
  location: string;
  lot: string;
  expiry: string;
  /** Opening quantity: the rx-stock starting amount or an opening stock entry. */
  base: number;
  /** Received on goods receipts. */
  received: number;
  dispensed: number;
  available: number;
  source: "Pharmacy Stock" | "Opening Stock" | "Goods Receipt";
  ref?: string;
  unitCost?: number;
  expired: boolean;
  daysLeft: number;
}

/** Every batch of every drug, in every location. Earliest expiry first within a drug. */
export function stockOnHand(s: StockState, dispenses: Dispense[], today: Date = new Date(), drugs: Drug[] = DRUGS): StockRow[] {
  const added = addedBatches(s);
  const rows: StockRow[] = [];
  for (const drug of drugs) {
    const used = dispensedByLot(drug.id, dispenses);
    // Units handed over that no batch has taken yet. A built-in batch takes its share first, then the batches added here.
    const left = new Map(used);
    const mine: StockRow[] = [];
    for (const b of batchesFor(drug, dispenses, today, false)) {
      left.set(normLot(b.lot), Math.max(0, round((left.get(normLot(b.lot)) ?? 0) - (b.base - b.onHand))));
      const days = daysToExpiry(b.expiry, today);
      mine.push({
        key: `${drug.id}:${b.lot}`, drug, location: DEFAULT_LOCATION, lot: b.lot, expiry: b.expiry, base: b.base, received: 0,
        dispensed: round(b.base - b.onHand), available: b.onHand, source: "Pharmacy Stock", expired: days < 0, daysLeft: days,
      });
    }
    for (const b of added.filter((x) => x.drugId === drug.id)) {
      const base = b.source === "Opening Stock" ? b.quantity : 0;
      const received = b.source === "Goods Receipt" ? b.quantity : 0;
      const dispensed = Math.min(base + received, left.get(b.lot) ?? 0);
      left.set(b.lot, round((left.get(b.lot) ?? 0) - dispensed));
      const days = daysToExpiry(b.expiry, today);
      mine.push({
        key: `${drug.id}:${b.lot}`, drug, location: b.location, lot: b.lot, expiry: b.expiry, base, received, dispensed,
        available: Math.max(0, round(base + received - dispensed)), source: b.source, ref: b.ref, unitCost: b.unitCost, expired: days < 0, daysLeft: days,
      });
    }
    rows.push(...mine.sort((a, b) => a.expiry.localeCompare(b.expiry)));
  }
  return rows;
}

export interface LowStockRow {
  drug: Drug;
  /** Usable units across every location. Expired batches do not count. */
  available: number;
  reorderLevel: number;
  /** Units needed to reach the reorder level. */
  short: number;
}

/** Drugs whose usable stock is under the reorder level. Lowest first, as a share of the level. */
export function lowStock(rows: StockRow[]): LowStockRow[] {
  const byDrug = new Map<string, { drug: Drug; available: number }>();
  for (const r of rows) {
    const cur = byDrug.get(r.drug.id) ?? { drug: r.drug, available: 0 };
    if (!r.expired) cur.available = round(cur.available + r.available);
    byDrug.set(r.drug.id, cur);
  }
  return [...byDrug.values()]
    .map(({ drug, available }) => ({ drug, available, reorderLevel: reorderLevel(drug), short: round(reorderLevel(drug) - available) }))
    .filter((x) => x.available < x.reorderLevel)
    .sort((a, b) => a.available / a.reorderLevel - b.available / b.reorderLevel);
}

/** Batches with stock that are expired or expire within `days`. Earliest first. */
export function expiryWatch(rows: StockRow[], days: number = EXPIRY_WATCH_DAYS): StockRow[] {
  return rows.filter((r) => r.available > 0 && r.daysLeft <= days).sort((a, b) => a.expiry.localeCompare(b.expiry));
}

export function expiryText(r: Pick<StockRow, "daysLeft">): string {
  if (r.daysLeft < 0) return `Expired ${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"} ago`;
  if (r.daysLeft === 0) return "Expires today";
  return `Expires in ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`;
}

/* ---------- checks before saving ---------- */

/** Every lot already in stock for each drug, as drugId|LOT. */
export function knownLots(s: StockState, dispenses: Dispense[], today: Date = new Date(), drugs: Drug[] = DRUGS): Set<string> {
  const out = new Set<string>();
  for (const d of drugs) for (const b of batchesFor(d, dispenses, today, false)) out.add(`${d.id}|${normLot(b.lot)}`);
  for (const b of addedBatches(s)) out.add(`${b.drugId}|${b.lot}`);
  return out;
}

/** Problems with the lines of one document, each starting with its line number. Empty means the lines can be saved. */
export function lineProblems(lines: StockLineInput[], known: Set<string>, today: Date = new Date()): string[] {
  const out: string[] = [];
  if (!lines.length) return ["Add at least one item."];
  const seen = new Set<string>();
  const t = isoDay(today);
  lines.forEach((l, i) => {
    const at = `Line ${i + 1}: `;
    const drug = DRUG_BY_ID[l.drugId];
    if (!drug) out.push(`${at}Choose the item.`);
    const lot = normLot(l.lot ?? "");
    if (!lot) out.push(`${at}Enter the batch (lot) number.`);
    if (!l.expiry) out.push(`${at}Enter the expiry date.`);
    else if (!validDay(l.expiry)) out.push(`${at}The expiry date is not a valid date.`);
    else if (l.expiry <= t) out.push(`${at}The expiry date must be after today. Expired stock cannot be received.`);
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) out.push(`${at}Enter a quantity above zero.`);
    if (l.unitCost !== undefined && (!Number.isFinite(l.unitCost) || l.unitCost < 0)) out.push(`${at}The unit cost cannot be below zero.`);
    if (drug && lot) {
      const k = `${drug.id}|${lot}`;
      if (known.has(k)) out.push(`${at}Batch ${lot} of ${drug.generic} is already in stock. Check the lot number.`);
      else if (seen.has(k)) out.push(`${at}Batch ${lot} of ${drug.generic} is entered twice.`);
      seen.add(k);
    }
  });
  return out;
}

export interface OpeningInput {
  location: string;
  date: string;
  lines: StockLineInput[];
}

export function openingProblems(input: OpeningInput, s: StockState, dispenses: Dispense[], today: Date = new Date()): string[] {
  const out: string[] = [];
  if (!(LOCATIONS as readonly string[]).includes(input.location)) out.push("Choose the stock location.");
  if (!input.date || !validDay(input.date)) out.push("Enter the date of the opening stock.");
  else if (input.date > isoDay(today)) out.push("The opening stock date cannot be in the future.");
  return [...out, ...lineProblems(input.lines, knownLots(s, dispenses, today), today)];
}

export interface ReceiptInput {
  date: string;
  supplier: string;
  invoiceNo: string;
  location: string;
  notes?: string;
  lines: StockLineInput[];
}

export function receiptProblems(input: ReceiptInput, s: StockState, dispenses: Dispense[], today: Date = new Date()): string[] {
  const out: string[] = [];
  if (!input.supplier.trim()) out.push("Choose the supplier.");
  if (!input.invoiceNo.trim()) out.push("Enter the supplier invoice or delivery note number.");
  if (!(LOCATIONS as readonly string[]).includes(input.location)) out.push("Choose the location that receives the goods.");
  if (!input.date || !validDay(input.date)) out.push("Enter the receipt date.");
  else if (input.date > isoDay(today)) out.push("The receipt date cannot be in the future.");
  return [...out, ...lineProblems(input.lines, knownLots(s, dispenses, today), today)];
}

/* ---------- saving ---------- */

const pad = (n: number) => String(n).padStart(6, "0");
const cleanLines = (lines: StockLineInput[]): StockLineInput[] =>
  lines.map((l) => ({ drugId: l.drugId, lot: normLot(l.lot), expiry: l.expiry, quantity: round(l.quantity), ...(l.unitCost !== undefined ? { unitCost: Math.round(l.unitCost * 100) / 100 } : {}) }));
const units = (lines: StockLineInput[]) => lines.map((l) => `${DRUG_BY_ID[l.drugId]?.generic ?? l.drugId} ${l.quantity} (lot ${normLot(l.lot)})`).join("; ");
const denied = (target: string): Result<never> => {
  audit("denied", target, { detail: "Needs rx.dispense" });
  return { ok: false, errors: ["Your role cannot change pharmacy stock. This needs the dispensing permission."] };
};

/** Opening Stock Entry: the first count of stock in a location. Adds batches at once. */
export function saveOpeningStock(input: OpeningInput, dispenses: Dispense[], today: Date = new Date()): Result<OpeningEntry> {
  if (!mayEdit()) return denied("Opening stock entry");
  const s = store.get();
  const errors = openingProblems(input, s, dispenses, today);
  if (errors.length) return { ok: false, errors };
  const n = s.seq.opening + 1;
  const entry: OpeningEntry = { id: `opn-${n}-${Date.now().toString(36)}`, number: `OPN-${pad(n)}`, location: input.location, date: input.date, lines: cleanLines(input.lines), by: who(), at: new Date().toISOString() };
  store.set({ ...s, openings: [...s.openings, entry], seq: { ...s.seq, opening: n } });
  audit("create", `Opening stock ${entry.number}`, { detail: `${entry.location}. ${units(entry.lines)}` });
  return { ok: true, value: entry };
}

/** Goods Receipt: saved as a draft (adds nothing yet) or posted (adds the batches). */
export function saveReceipt(input: ReceiptInput, status: ReceiptStatus, dispenses: Dispense[], today: Date = new Date()): Result<GoodsReceipt> {
  if (!mayEdit()) return denied("Goods receipt");
  const s = store.get();
  const errors = receiptProblems(input, s, dispenses, today);
  if (errors.length) return { ok: false, errors };
  const n = s.seq.receipt + 1;
  const now = new Date().toISOString();
  const r: GoodsReceipt = {
    id: `grn-${n}-${Date.now().toString(36)}`, number: `GRN-${pad(n)}`, date: input.date, supplier: input.supplier.trim(), invoiceNo: input.invoiceNo.trim(),
    location: input.location, status, notes: input.notes?.trim() || undefined, lines: cleanLines(input.lines), by: who(), at: now,
    ...(status === "Posted" ? { postedAt: now } : {}),
  };
  store.set({ ...s, receipts: [...s.receipts, r], seq: { ...s.seq, receipt: n } });
  audit("create", `Goods receipt ${r.number}`, { detail: `${status}. ${r.supplier}, invoice ${r.invoiceNo}, ${r.location}. ${units(r.lines)}` });
  return { ok: true, value: r };
}

/** Post a draft receipt. The lines are checked again, since a batch may have been added since the draft was saved. */
export function postReceipt(id: string, dispenses: Dispense[], today: Date = new Date()): Result<GoodsReceipt> {
  if (!mayEdit()) return denied("Goods receipt");
  const s = store.get();
  const r = s.receipts.find((x) => x.id === id);
  if (!r) return { ok: false, errors: ["This goods receipt was not found."] };
  if (r.status === "Posted") return { ok: false, errors: [`${r.number} is already posted.`] };
  const others: StockState = { ...s, receipts: s.receipts.filter((x) => x.id !== id) };
  const errors = receiptProblems(r, others, dispenses, today);
  if (errors.length) return { ok: false, errors };
  const posted: GoodsReceipt = { ...r, status: "Posted", postedAt: new Date().toISOString() };
  store.set({ ...s, receipts: s.receipts.map((x) => (x.id === id ? posted : x)) });
  audit("update", `Goods receipt ${r.number}`, { detail: `Posted. ${units(r.lines)}` });
  return { ok: true, value: posted };
}

/** Only drafts can be removed. A posted receipt has added stock. */
export function deleteDraftReceipt(id: string): Result<true> {
  if (!mayEdit()) return denied("Goods receipt");
  const s = store.get();
  const r = s.receipts.find((x) => x.id === id);
  if (!r) return { ok: false, errors: ["This goods receipt was not found."] };
  if (r.status !== "Draft") return { ok: false, errors: ["A posted receipt cannot be removed."] };
  store.set({ ...s, receipts: s.receipts.filter((x) => x.id !== id) });
  audit("delete", `Goods receipt ${r.number}`, { detail: "Draft removed" });
  return { ok: true, value: true };
}

export const receiptValue = (r: Pick<GoodsReceipt, "lines">): number =>
  Math.round(r.lines.reduce((n, l) => n + (l.unitCost ?? 0) * l.quantity, 0) * 100) / 100;

/* ---------- pharmacy home ---------- */

export interface QueueRow {
  rx: Prescription;
  item: RxItem;
  status: VerifyStatus;
  sentAt: string;
}

/** Items waiting at the pharmacy (sent, active, not fully dispensed), oldest first. */
export function activeQueue(rx: RxState): QueueRow[] {
  return rx.prescriptions
    .flatMap((p) => pharmacyItems(rx, p).map(({ item, status }) => ({ rx: p, item, status, sentAt: p.sentAt ?? p.authoredAt })))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export interface Overview {
  /** New, changed or answered items waiting for the pharmacist check. */
  waiting: number;
  /** Verified and not fully dispensed. */
  ready: number;
  /** Completed dispense lines handed over today. */
  dispensedToday: number;
  lowStock: number;
  expiringSoon: number;
}

export function pharmacyOverview(rx: RxState, s: StockState, today: Date = new Date()): Overview {
  const queue = activeQueue(rx);
  const day = localDay(today);
  const rows = stockOnHand(s, rx.dispenses, today);
  return {
    waiting: queue.filter((q) => needsPharmacist(q.status)).length,
    ready: queue.filter((q) => q.status === "verified").length,
    dispensedToday: rx.dispenses.filter((d) => localDay(new Date(d.handedOverAt)) === day).reduce((n, d) => n + d.lines.filter((l) => l.status === "completed").length, 0),
    lowStock: lowStock(rows).length,
    expiringSoon: expiryWatch(rows).length,
  };
}
