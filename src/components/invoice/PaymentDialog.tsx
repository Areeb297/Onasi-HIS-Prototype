import * as React from "react";
import { Upload } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { allocatePayment, PAY_METHODS, round2, takePayment, WAIVER_TYPES, type InvoiceView, type PayMethod } from "@/lib/invoice";
import { can } from "@/lib/session";
import { pushToast } from "@/lib/toast";
import { Sar } from "./InvoiceParts";
import { fmtDateTime } from "@/lib/format";

const when = (iso: string) => fmtDateTime(iso);

/** A file picker that keeps only the file name. Keyboard reachable: the real input sits inside the label. */
export function ProofPicker({ value, onChange, label }: { value: string; onChange: (name: string) => void; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
        <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{value || "Choose A File (Image Or PDF)"}</span>
        <input type="file" accept="image/*,.pdf" className="sr-only" onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")} />
      </label>
    </div>
  );
}

function SummaryCell({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className={cn("text-xs", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("text-sm", strong ? "font-bold" : "font-medium")}>{children}</dd>
    </div>
  );
}

/** Record Payment: New Payment (with Payment Waiver) and Adjust Payment, as in the HIS payment dialog. */
export function PaymentDialog({ open, onClose, view }: { open: boolean; onClose: () => void; view: InvoiceView }) {
  const visit = view.invoice.visit;
  const balance = view.totals.patientBalance;
  const [tab, setTab] = React.useState<"new" | "adjust">("new");
  const [waiver, setWaiver] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PayMethod>("Cash");
  const [reference, setReference] = React.useState("");
  const [proof, setProof] = React.useState("");
  const [txId, setTxId] = React.useState<string | null>(null);
  const [alloc, setAlloc] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<string[]>([]);
  const allowed = can("cashier");

  React.useEffect(() => {
    if (!open) return;
    setTab("new"); setWaiver(""); setAmount(balance > 0 ? balance.toFixed(2) : ""); setMethod("Cash");
    setReference(""); setProof(""); setTxId(null); setAlloc({}); setErrors([]);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const waived = !!waiver;
  const entered = waived ? 0 : Math.max(0, Number(amount) || 0);
  const remaining = waived ? 0 : round2(Math.max(0, balance - entered));
  const cash = method === "Cash";
  const insured = !!view.invoice.insurer;
  const adjustable = view.invoice.transactions.filter((t) => (view.unallocated[t.id] ?? 0) > 0);
  const unpaid = view.lines.filter((l) => l.patientBalance > 0.004);
  const free = txId ? view.unallocated[txId] ?? 0 : 0;
  const allocTotal = round2(Object.values(alloc).reduce((a, b) => a + (Number(b) || 0), 0));
  const totalUnapplied = round2(Object.values(view.unallocated).reduce((a, b) => a + b, 0));

  const submit = () => {
    const r = tab === "new"
      ? takePayment(visit, { amount: Number(amount), method, reference, proofName: proof, waiverType: waiver || undefined })
      : txId
        ? allocatePayment(visit, txId, Object.fromEntries(Object.entries(alloc).map(([k, v]) => [k, Number(v) || 0])))
        : { ok: false as const, errors: ["Choose a payment first."] };
    if (!r.ok) { setErrors(r.errors); return; }
    pushToast({ tone: "ok", text: tab === "new" ? (waived ? "Payment waived." : "Payment recorded.") : "Payment allocated." });
    onClose();
  };

  const tabBtn = (id: "new" | "adjust", label: string) => (
    <button
      type="button"
      role="tab"
      id={`pay-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`pay-panel-${id}`}
      onClick={() => { setTab(id); setErrors([]); }}
      className={cn(
        "h-8 flex-1 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Record Payment"
      subtitle={`Invoice ${view.invoice.number}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!allowed} title={allowed ? undefined : "This needs the cashier permission."}>
            {tab === "new" ? "Submit Payment" : "Allocate Payment"}
          </Button>
        </>
      }
    >
      <div role="tablist" aria-label="Payment" className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {tabBtn("new", "New Payment")}
        {tabBtn("adjust", "Adjust Payment")}
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mb-3 list-disc rounded-lg border border-destructive/40 bg-destructive/5 py-2 pe-3 ps-7 text-sm text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      {tab === "new" ? (
        <div role="tabpanel" id="pay-panel-new" aria-labelledby="pay-tab-new" className="space-y-4">
          <dl className={cn("grid grid-cols-1 gap-x-5 border-y border-border py-1 sm:grid-cols-2", insured ? "md:grid-cols-3" : "md:grid-cols-2")}>
            <SummaryCell label={insured ? "Patient Share" : "Subtotal"}><Sar value={view.totals.patientAmount} /></SummaryCell>
            <SummaryCell label={insured ? "Patient Tax" : "Tax"}><Sar value={view.totals.patientTax} /></SummaryCell>
            {insured && <SummaryCell label="Insurance Tax"><Sar value={view.totals.insuranceTax} /></SummaryCell>}
            <SummaryCell label="Discount"><Sar value={view.totals.discount + view.totals.waived} minus /></SummaryCell>
            <SummaryCell label="Paid So Far"><Sar value={view.totals.patientPaid} /></SummaryCell>
            <SummaryCell label="Payable" strong><Sar value={waived ? 0 : Math.max(0, balance)} /></SummaryCell>
          </dl>

          {view.invoice.transactions.some((t) => t.kind !== "refund") && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">Previous Payments</h3>
                {totalUnapplied > 0 && <Badge tone="warn">Unapplied Amount: <Sar value={totalUnapplied} /></Badge>}
              </div>
              <ul className="space-y-1.5">
                {view.invoice.transactions.filter((t) => t.kind !== "refund").map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                    <span>
                      <span className="font-medium">{t.kind === "waiver" ? "Waived Off" : t.method}</span>
                      <span className="text-muted-foreground"> · {when(t.at)}{t.reference ? ` · ${t.reference}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {(view.unallocated[t.id] ?? 0) > 0 && <Badge tone="warn">Unapplied <Sar value={view.unallocated[t.id]} /></Badge>}
                      <Sar value={t.amount} className={t.kind === "waiver" ? "text-muted-foreground line-through" : "font-semibold"} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Payment Waiver" hint="Writes off the whole amount due. No money is taken.">
            <Select value={waiver} onChange={(e) => setWaiver(e.target.value)}>
              <option value="">None</option>
              {WAIVER_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </Field>

          <div className={cn("grid gap-4", waived ? "grid-cols-1" : "sm:grid-cols-2")}>
            <Field label="Amount" required hint={`Remaining balance after this payment: ${remaining.toFixed(2)} SAR`}>
              <Input
                type="number" inputMode="decimal" min={0} max={balance} step="0.01"
                value={waived ? "0" : amount} disabled={waived}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            {!waived && (
              <Field label="Payment Method" required>
                <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
            )}
          </div>

          {!waived && !cash && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reference / Notes">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="For example the card slip or transfer number" />
              </Field>
              <ProofPicker label="Payment Proof" value={proof} onChange={setProof} />
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="pay-panel-adjust" aria-labelledby="pay-tab-adjust" className="space-y-4">
          <fieldset className="rounded-lg border border-border bg-muted/40 p-3">
            <legend className="px-1 text-sm font-medium">Select A Payment With Money Not Yet Placed On A Line</legend>
            {adjustable.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment has money left to place. This happens when a paid order is cancelled.</p>
            ) : (
              <div className="space-y-2">
                {adjustable.map((t) => (
                  <label key={t.id} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring", txId === t.id ? "border-primary" : "border-border")}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="adjust-tx" checked={txId === t.id} onChange={() => { setTxId(t.id); setAlloc({}); setErrors([]); }} />
                      <span>
                        <span className="font-medium">{t.method} · {when(t.at)}</span>
                        <span className="block text-xs text-muted-foreground">{t.reference || "No reference"}</span>
                      </span>
                    </span>
                    <span className="text-right">
                      <Sar value={view.unallocated[t.id]} className="font-semibold text-ok" />
                      <span className="block text-xs text-muted-foreground">of <Sar value={t.amount} /></span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {txId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md bg-accent px-3 py-2 text-sm">
                <span>Available To Allocate</span>
                <Sar value={free - allocTotal} className={cn("font-bold", free - allocTotal < -0.004 && "text-destructive")} />
              </div>
              <div className="rounded-lg border border-border">
                <Table>
                  <thead><tr><Th>Service</Th><Th className="text-right">Balance</Th><Th className="w-40">Allocate</Th></tr></thead>
                  <tbody>
                    {unpaid.length === 0 && <tr><Td colSpan={3} className="text-center text-muted-foreground">No unpaid lines.</Td></tr>}
                    {unpaid.map((l) => (
                      <tr key={l.key}>
                        <Td className="font-medium">{l.service}</Td>
                        <Td className="text-right text-destructive"><Sar value={l.patientBalance} /></Td>
                        <Td>
                          <Input
                            type="number" inputMode="decimal" min={0} max={l.patientBalance} step="0.01" aria-label={`Allocate to ${l.service}`}
                            value={alloc[l.key] ?? ""} onChange={(e) => setAlloc((a) => ({ ...a, [l.key]: e.target.value }))}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
