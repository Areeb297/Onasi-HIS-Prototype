import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { PAY_METHODS, refundOverpayment, type InvoiceView, type PayMethod } from "@/lib/invoice";
import { can } from "@/lib/session";
import { pushToast } from "@/lib/toast";
import { Sar } from "./InvoiceParts";
import { ProofPicker } from "./PaymentDialog";

/** Process Refund: gives the whole overpayment back to the patient. */
export function RefundDialog({ open, onClose, view }: { open: boolean; onClose: () => void; view: InvoiceView }) {
  const [method, setMethod] = React.useState<PayMethod>("Cash");
  const [reference, setReference] = React.useState("");
  const [proof, setProof] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);
  const allowed = can("cashier");

  React.useEffect(() => {
    if (open) { setMethod("Cash"); setReference(""); setProof(""); setErrors([]); }
  }, [open]);

  const submit = () => {
    const r = refundOverpayment(view.invoice.visit, { method, reference, proofName: proof });
    if (!r.ok) { setErrors(r.errors); return; }
    pushToast({ tone: "ok", text: "Refund recorded.", detail: `${r.value.amount.toFixed(2)} SAR by ${method}.` });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Process Refund"
      subtitle="Give the overpayment back to the patient"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!allowed} title={allowed ? undefined : "This needs the cashier permission."}>Confirm Refund</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-move/30 bg-move/8 p-4">
          <div>
            <p className="text-sm font-medium">Overpayment Amount</p>
            <p className="text-xs text-muted-foreground">The hospital owes the patient</p>
          </div>
          <Sar value={view.overpaid} className="text-2xl font-bold text-move" />
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="list-disc rounded-lg border border-destructive/40 bg-destructive/5 py-2 pe-3 ps-7 text-sm text-destructive">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <Field label="Refund Method" required>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Reference / Notes">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Enter a reference or notes" />
        </Field>
        <ProofPicker label="Proof Of Refund" value={proof} onChange={setProof} />
      </div>
    </Dialog>
  );
}
