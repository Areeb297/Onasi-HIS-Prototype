import { createStore } from "./fhir/store-util";

/**
 * The stock that the pharmacy adds on top of the built-in batches: opening stock and goods receipts. Kept in a file of its own
 * so that both rx-stock.ts (which offers batches for dispensing) and pharmacy-stock.ts (the stock screens) can read it
 * without importing each other.
 */

export type ReceiptStatus = "Draft" | "Posted";

export interface StockLineInput {
  drugId: string;
  lot: string;
  /** YYYY-MM-DD */
  expiry: string;
  quantity: number;
  /** SAR per dispensing unit. Optional, never below zero. */
  unitCost?: number;
}

export interface OpeningEntry {
  id: string;
  number: string;
  location: string;
  /** YYYY-MM-DD */
  date: string;
  lines: StockLineInput[];
  by: string;
  at: string;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  supplier: string;
  /** Supplier invoice or delivery note number. */
  invoiceNo: string;
  location: string;
  status: ReceiptStatus;
  notes?: string;
  lines: StockLineInput[];
  by: string;
  at: string;
  postedAt?: string;
}

export interface StockState {
  openings: OpeningEntry[];
  receipts: GoodsReceipt[];
  seq: { opening: number; receipt: number };
}

const EMPTY = (): StockState => ({ openings: [], receipts: [], seq: { opening: 0, receipt: 0 } });
const store = createStore<StockState>("onasi-emr-pharmacy-stock-v1", EMPTY);
export const useStock = store.use;
export const getStock = store.get;
export const setStock = store.set;
export const resetStock = store.reset;


export const normLot = (lot: string) => lot.trim().toUpperCase();

export interface AddedBatch {
  drugId: string;
  location: string;
  lot: string;
  expiry: string;
  quantity: number;
  unitCost?: number;
  source: "Opening Stock" | "Goods Receipt";
  /** OPN or GRN number. */
  ref: string;
}

/** Batches from opening stock and posted goods receipts. Drafts add nothing. */
export function addedBatches(s: StockState = store.get()): AddedBatch[] {
  const out: AddedBatch[] = [];
  for (const o of s.openings) for (const l of o.lines) out.push({ ...l, lot: normLot(l.lot), location: o.location, source: "Opening Stock", ref: o.number });
  for (const r of s.receipts) {
    if (r.status !== "Posted") continue;
    for (const l of r.lines) out.push({ ...l, lot: normLot(l.lot), location: r.location, source: "Goods Receipt", ref: r.number });
  }
  return out;
}

/** The added batches of one drug in the shape rx-stock.ts uses. batchesFor adds them to the built-in batches, so they can be dispensed. */
export function extraBatchesFor(drugId: string, s: StockState = store.get()): { lot: string; expiry: string; base: number }[] {
  return addedBatches(s).filter((b) => b.drugId === drugId).map((b) => ({ lot: b.lot, expiry: b.expiry, base: b.quantity }));
}

