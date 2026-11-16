import { invoiceOf, invoiceView } from "./invoice";
import type { Encounter, Patient } from "./model";
import { CLASS_FEE, payerShareOf } from "./nphies-financial";

/**
 * Co-payment before the doctor (practice in Saudi private hospitals): the patient's share is due at check-in and is
 * taken by the cashier before the consultation. This is a practice, not a rule, so nothing is blocked: the check-in
 * shows the amount for the cashier and the doctor's worklist shows a small "Not Paid" pill.
 */

/** The patient's share of the consultation: the whole fee for cash, the co-payment for an insured patient. */
export function consultationShare(p: Pick<Patient, "extra">, cls: Encounter["cls"] = "O"): number {
  const fee = CLASS_FEE[cls] ?? CLASS_FEE.O; // the same fees NPHIES Financial estimates with
  return Math.round(fee * (1 - payerShareOf(p)) * 100) / 100;
}

export interface ShareDue { amount: number; paid: boolean }

/**
 * What the patient still owes on an outpatient visit: the invoice balance once the invoice exists, otherwise the
 * consultation share. `paid` is true when nothing is owed.
 */
export function patientShareDue(e: Pick<Encounter, "visitNumber" | "cls">, p: Pick<Patient, "extra">): ShareDue {
  const inv = invoiceOf(e.visitNumber);
  const amount = inv ? invoiceView(inv).totals.patientBalance : consultationShare(p, e.cls);
  return { amount: Math.max(0, amount), paid: amount <= 0.005 };
}
