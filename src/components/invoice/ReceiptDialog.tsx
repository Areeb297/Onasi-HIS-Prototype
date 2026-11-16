import { Printer } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/primitives";
import { CLINIC_NAME, SELLER_VAT_NUMBER, type InvoiceView } from "@/lib/invoice";
import type { Patient } from "@/lib/model";
import { patientName } from "@/lib/store";
import { ZatcaQr } from "./InvoiceParts";
import { fmtDateTime } from "@/lib/format";

/** Prints only the receipt, at till-roll width. */
const PRINT_CSS = `
@media print {
  @page { size: 80mm auto; margin: 4mm; }
  body * { visibility: hidden !important; }
  .invoice-receipt, .invoice-receipt * { visibility: visible !important; }
  .invoice-receipt { position: absolute; inset: 0 auto auto 0; width: 72mm; color: #000; background: #fff; box-shadow: none; border: 0; }
}`;

const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-2 font-bold" : "flex justify-between gap-2"}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** The narrow receipt from the HIS invoice-print page: clinic, invoice, patient, lines and totals. */
export function Receipt({ view, patient }: { view: InvoiceView; patient: Patient | undefined }) {
  const t = view.totals;
  const reported = view.invoice.zatca.status === "Reported";
  return (
    <div className="invoice-receipt mx-auto w-full max-w-[300px] rounded-md border border-dashed border-border bg-white p-4 font-mono text-[0.75rem] leading-snug text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{CLINIC_NAME}</div>
        <div>VAT No. {SELLER_VAT_NUMBER}</div>
        <div className="mt-1 font-bold">Simplified Tax Invoice</div>
      </div>
      <hr className="my-2 border-dashed border-black/40" />
      <Row label="Invoice" value={`#${view.invoice.number}`} />
      <Row label="Date" value={fmtDateTime(view.invoice.createdAt)} />
      <Row label="Patient" value={patientName(patient)} />
      <Row label="MRN" value={patient?.mrn ?? ""} />
      {view.invoice.insurer && <Row label="Insurer" value={view.invoice.insurer} />}
      <hr className="my-2 border-dashed border-black/40" />
      {view.lines.map((l) => (
        <div key={l.key} className="mb-1">
          <div>{l.service}</div>
          <Row label={`${l.units} x ${n2(l.unitCost)}`} value={n2(l.total)} />
        </div>
      ))}
      <hr className="my-2 border-dashed border-black/40" />
      <Row label="Taxable Amount" value={n2(t.taxable)} />
      <Row label="VAT 15%" value={n2(t.tax)} />
      <Row label="Discount" value={n2(t.discount + t.waived)} />
      <Row label="Grand Total" value={n2(t.total)} strong />
      {view.invoice.insurer && <Row label="Insurance Share" value={n2(t.insurancePayable)} />}
      {view.invoice.insurer && <Row label="Patient Share" value={n2(t.patientPayable)} />}
      <Row label="Paid" value={n2(t.patientPaid)} />
      <Row label="Balance Due" value={n2(Math.max(0, t.patientBalance))} strong />
      <p className="mt-1 text-center text-[0.6875rem]">Amounts in SAR</p>
      {reported && (
        <div className="mt-2 flex justify-center">
          <ZatcaQr view={view} size={88} />
        </div>
      )}
      <p className="mt-2 text-center">Thank you</p>
    </div>
  );
}

export function ReceiptDialog({ open, onClose, view, patient }: { open: boolean; onClose: () => void; view: InvoiceView; patient: Patient | undefined }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Receipt"
      subtitle={`Invoice #${view.invoice.number}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      <Receipt view={view} patient={patient} />
    </Dialog>
  );
}
