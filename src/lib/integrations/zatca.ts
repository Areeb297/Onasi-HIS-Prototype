import { SELLER_VAT_NUMBER, getInvoices, invoiceView } from "../invoice";
import type { CallEntry } from "./call-log";
import { pretty } from "./call-log";

/**
 * ZATCA e-invoicing reports, read from the invoice store. An invoice keeps only its latest report, so each invoice
 * that was sent at least once is one line here, with the number of attempts.
 */
export function zatcaCalls(): CallEntry[] {
  return getInvoices().invoices.filter((i) => i.zatca.attempts > 0).map((inv): CallEntry => {
    const z = inv.zatca;
    const t = invoiceView(inv).totals;
    const ok = z.status !== "Failed";
    return {
      id: `ZATCA-${inv.number}`, integration: "zatca", at: z.reportedAt ?? z.clockFrom, operation: "Report Simplified Invoice",
      summary: `Invoice ${inv.number}, visit ${inv.visit}. ${ok ? "Reported" : "Failed"}${z.attempts > 1 ? `, ${z.attempts} attempts` : ""}`, ok, format: "JSON",
      request: pretty({ invoiceNumber: inv.number, visit: inv.visit, sellerVatNumber: SELLER_VAT_NUMBER, currency: "SAR", total: t.total, vat: t.tax, attempts: z.attempts }),
      response: pretty(ok ? { status: "REPORTED", uuid: z.uuid, reportedAt: z.reportedAt } : { status: "FAILED", message: z.message }),
    };
  });
}
