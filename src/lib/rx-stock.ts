import type { Dispense, Drug } from "./rx-types";

/**
 * Pharmacy stock by batch. Made-up numbers: every drug gets two or three batches worked out from its id,
 * so the same drug always shows the same batches. What was handed over from a batch is taken off its stock.
 * Hospital data only. Nothing here goes to nphies except the lot and expiry already on the dispense line.
 */

export interface Batch {
  lot: string;
  /** YYYY-MM-DD */
  expiry: string;
  /** Units in stock now. */
  onHand: number;
  /** Units at the start, before any hand over. */
  base: number;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

function monthEnd(from: Date, monthsAhead: number): string {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + monthsAhead + 1, 0)).toISOString().slice(0, 10);
}

/** Batches of a drug, earliest expiry first (first expiry, first out). */
export function batchesFor(drug: Drug, dispenses: Dispense[], today: Date = new Date()): Batch[] {
  const n = parseInt(drug.id.replace(/\D/g, ""), 10) || 1;
  const prefix = drug.brand.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  const num = String(n).padStart(3, "0");
  const size = drug.pack.size;
  // Every fourth drug has a nearly empty first batch, so a short batch can be shown.
  const first = n % 4 === 1 ? Math.max(1, Math.floor(size / 5)) : size * (1 + (n % 3));
  const raw: Omit<Batch, "onHand">[] = [
    { lot: `${prefix}${num}A`, expiry: monthEnd(today, 2 + (n % 5)), base: first },
    { lot: `${prefix}${num}B`, expiry: monthEnd(today, 9 + (n % 7)), base: size * 4 },
  ];
  if (n % 5 === 0) raw.push({ lot: `${prefix}${num}C`, expiry: monthEnd(today, 20), base: size * 2 });
  const used = new Map<string, number>();
  for (const d of dispenses) {
    for (const l of d.lines) {
      if (l.drugId === drug.id && l.status === "completed" && l.lot) used.set(l.lot, (used.get(l.lot) ?? 0) + l.quantity);
    }
  }
  return raw
    .map((b) => ({ ...b, onHand: Math.max(0, round(b.base - (used.get(b.lot) ?? 0))) }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

export const totalOnHand = (batches: Batch[]): number => round(batches.reduce((n, b) => n + b.onHand, 0));

/** The batch to offer first: the earliest expiry that still has stock. */
export function firstUsableBatch(batches: Batch[]): Batch | undefined {
  return batches.find((b) => b.onHand > 0);
}

/** Expiry as a date only, for example 31 Jan 2027. */
export function fmtExpiry(iso: string | undefined): string {
  if (!iso) return "No expiry recorded";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const isExpired = (b: Pick<Batch, "expiry">, today: Date = new Date()): boolean => b.expiry < today.toISOString().slice(0, 10);

const units = (n: number, unit: string) => `${round(n)} ${unit}${n === 1 || unit === "mL" ? "" : "s"}`;

/**
 * Says in words why the stock does not cover the quantity, and what to do. Null when the batch covers it.
 * `owed` is what is still left to dispense on the item.
 */
export function stockProblem(drug: Pick<Drug, "generic" | "unit">, batches: Batch[], lot: string | undefined, qty: number, owed: number, today: Date = new Date()): string | null {
  const all = totalOnHand(batches);
  if (all <= 0) return `${drug.generic} is out of stock. Nothing can be dispensed now. The item stays on the worklist.`;
  if (!lot) return `Choose a batch for ${drug.generic}.`;
  const batch = batches.find((b) => b.lot === lot);
  if (!batch) return `Batch ${lot} is not in stock for ${drug.generic}. Choose a batch from the list.`;
  if (isExpired(batch, today)) return `Batch ${batch.lot} expired on ${fmtExpiry(batch.expiry)}. Choose another batch.`;
  if (!(qty > 0) || qty <= batch.onHand + 1e-6) return null;
  if (batch.onHand <= 0) return `Batch ${batch.lot} is empty. Choose another batch.`;
  const rest = round(owed - batch.onHand);
  const other = batches.some((b) => b.lot !== batch.lot && b.onHand >= qty && !isExpired(b, today));
  return (
    `Not enough stock in batch ${batch.lot}. It has ${units(batch.onHand, drug.unit)} and you asked for ${units(qty, drug.unit)}. ` +
    `Dispense ${units(batch.onHand, drug.unit)} now${rest > 0 ? ` and the other ${units(rest, drug.unit)} stay on the worklist` : ""}` +
    `${other ? ", or choose a batch with more stock." : "."}`
  );
}
