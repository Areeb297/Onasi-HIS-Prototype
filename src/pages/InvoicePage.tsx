import * as React from "react";
import { ArrowLeft, CreditCard, Info, Printer, Send } from "lucide-react";
import { InvoiceStatusBadge, Sar, useNow, ZatcaQr, ZatcaTag } from "@/components/invoice/InvoiceParts";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { IconCash, IconClockDollar, IconReceipt2, IconShieldCheck } from "@tabler/icons-react";
import { PaymentDialog } from "@/components/invoice/PaymentDialog";
import { ReceiptDialog } from "@/components/invoice/ReceiptDialog";
import { RefundDialog } from "@/components/invoice/RefundDialog";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Td, Th, cn } from "@/components/ui/primitives";
import { ensureInvoice, invoiceOf, invoiceView, payerPaid, sendToZatca, useInvoices } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { useRad } from "@/lib/radiology";
import { navigate, useRoute } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";

const when = (iso: string) => fmtDateTime(iso);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Invoice detail for one visit: /invoice?visit=V... */
export function InvoicePage() {
  const { params } = useRoute();
  const visit = params.get("visit") ?? "";
  const his = useHis();
  const lab = useLab();
  const rad = useRad();
  const rx = useRx();
  const fin = useFinancial();
  const store = useInvoices();
  useSession();
  const now = useNow();
  const [payOpen, setPayOpen] = React.useState(false);
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [receiptOpen, setReceiptOpen] = React.useState(false);

  const enc = his.encounters.find((e) => e.visitNumber === visit);
  const patient = enc && his.patients.find((p) => p.id === enc.patientId);
  const billable = !!enc && enc.status !== "preadmit";

  // Created on first open. While it is a draft the lines follow the visit's orders.
  React.useEffect(() => {
    if (billable) ensureInvoice(visit);
  }, [visit, billable, his, lab, rad, rx]);

  if (!visit) return <Card><Empty>No visit was given. Open an invoice from the Invoice Worklist.</Empty></Card>;
  if (!enc || !patient) return <Card><Empty>Visit {visit} was not found.</Empty></Card>;
  if (!billable) return <Card><Empty>This visit is a pre-admission. The invoice starts when the patient is admitted.</Empty></Card>;
  const inv = invoiceOf(visit, store);
  if (!inv) return <Card><Empty>Preparing the invoice...</Empty></Card>;

  const v = invoiceView(inv, payerPaid(visit, fin));
  const t = v.totals;
  const insured = !!inv.insurer;
  const allowed = can("billing");
  const reported = inv.zatca.status === "Reported";
  const noPerm = "This needs the billing permission.";
  const cashier = can("cashier");
  const noCash = "This needs the cashier permission.";

  const sendZatca = () => {
    const r = sendToZatca([visit]);
    if (!r.ok) { pushToast({ tone: "warn", text: r.errors[0] }); return; }
    const z = invoiceOf(visit)!.zatca;
    pushToast(z.status === "Reported" ? { tone: "ok", text: "Invoice reported to ZATCA." } : { tone: "danger", text: "ZATCA did not accept the invoice.", detail: z.message });
  };

  const money = (n: number, cls?: string) => <Td className={cn("text-right", cls)}><Sar value={n} /></Td>;
  const groupBorder = "border-l border-l-foreground/15";

  return (
    <div>
      <PageHeader
        mark={<Button size="sm" variant="ghost" onClick={() => navigate("/invoices")} aria-label="Back to the Invoice Worklist"><ArrowLeft className="size-4" /></Button>}
        title={`Invoice ${inv.number}`}
        subtitle={v.status === "Draft" ? "Draft: the lines follow the visit's orders until the visit ends." : v.status === "Submitted" ? "The visit has ended. The lines are fixed." : inv.insurer ? "Paid in full by the patient and the payer." : "Paid in full by the patient."}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={sendZatca} disabled={!allowed || reported} title={!allowed ? noPerm : reported ? "Already reported." : undefined}>
              <Send className="size-4" /> Send To ZATCA
            </Button>
            <Button variant="primary" onClick={() => setReceiptOpen(true)}><Printer className="size-4" /> Print Receipt</Button>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Invoice Number">{inv.number}</Fact>
            <Fact label="Patient">{patientName(patient)}</Fact>
            <Fact label="MRN">{patient.mrn}</Fact>
            <Fact label="Date">{when(inv.createdAt)}</Fact>
            <Fact label="Payer">{inv.insurer ?? "Cash"}</Fact>
            <Fact label="Status"><InvoiceStatusBadge status={v.status} /></Fact>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5">
          <ZatcaTag invoice={inv} now={now} />
          {!reported && <span className="text-xs text-muted-foreground">Simplified invoices must reach ZATCA within 24 hours. The first payment reports it automatically.</span>}
        </div>
      </Card>

      <KpiStrip label="Invoice amounts" className={cn("mb-4 grid-cols-2", insured ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <KpiTile icon={<IconReceipt2 stroke={1.75} />} label="Invoice Total" value={<Sar value={t.total} />} note={`${v.lines.length} ${v.lines.length === 1 ? "line" : "lines"}, VAT included`} />
        {insured && <KpiTile icon={<IconShieldCheck stroke={1.75} />} label="Insurance Share" value={<Sar value={t.insurancePayable} />} note={t.insuranceBalance > 0.004 ? <>Still to come <Sar value={t.insuranceBalance} /></> : "Settled by the payer"} tone={t.insuranceBalance > 0.004 ? undefined : "ok"} />}
        <KpiTile icon={<IconCash stroke={1.75} />} label="Paid" value={<Sar value={t.paid} />} note={insured ? "Patient and payer together" : "By the patient"} tone={t.paid > 0.004 ? "ok" : undefined} />
        <KpiTile icon={<IconClockDollar stroke={1.75} />} label="Patient Due" value={<Sar value={t.patientBalance} />} note={t.patientBalance > 0.004 ? "Take the payment at the desk" : t.patientBalance < -0.004 ? "Refund owed to the patient" : "Nothing to collect"} tone={t.patientBalance > 0.004 ? "warn" : t.patientBalance < -0.004 ? undefined : "ok"} accent={t.patientBalance > 0.004 ? "warn" : "brand"} className={insured ? undefined : "col-span-2 lg:col-span-1"} />
      </KpiStrip>

      {v.overpaid > 0 && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-move/30 bg-move/8 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-move" aria-hidden="true" />
          <span><span className="font-semibold">Overpayment.</span> The hospital owes the patient <Sar value={v.overpaid} className="font-semibold" />. A paid order was cancelled.</span>
        </div>
      )}
      {Object.keys(v.unallocated).length > 0 && v.overpaid <= 0 && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <span>A payment has money not placed on any line. Use Take Payment, then Adjust Payment, to place it.</span>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader title="Item Details" subtitle={insured ? `${inv.insurer} pays ${Math.round((inv.payerShare ?? 0.9) * 1000) / 10} percent. The patient pays ${Math.round((1 - (inv.payerShare ?? 0.9)) * 1000) / 10} percent${inv.vat ? " plus 15 percent VAT on that share" : ""}.` : inv.vat ? "Cash patient with no insurance share. The patient pays the whole amount plus 15 percent VAT." : "Cash patient with no insurance share. The patient pays the whole amount."} />
        <div className="overflow-x-auto">
          <table className={cn("w-full border-collapse text-sm", insured ? "min-w-[1100px]" : "min-w-[760px]")}>
            <thead>
              {insured && (
                <tr>
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className={cn("bg-card text-center", groupBorder)}>Patient</Th>
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                  <Th className={cn("bg-card text-center", groupBorder)}>Insurance</Th>
                  <Th className="bg-card" />
                  <Th className="bg-card" />
                </tr>
              )}
              <tr>
                <Th>Service</Th>
                <Th className="text-right">Unit Cost</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Discount</Th>
                <Th className="text-right">Tax</Th>
                <Th className="text-right">Total</Th>
                {insured && (
                  <>
                    <Th className={cn("text-right", groupBorder)}>Amount</Th><Th className="text-right">Tax</Th><Th className="text-right">Balance</Th>
                    <Th className={cn("text-right", groupBorder)}>Amount</Th><Th className="text-right">Tax</Th><Th className="text-right">Balance</Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l) => (
                <tr key={l.key} className={cn((l.patientBalance > 0.004 || l.insuranceBalance > 0.004) && "bg-warn/5")}>
                  <Td className="font-medium">{l.service}</Td>
                  {money(l.unitCost)}
                  <Td className="text-right tabular-nums">{l.units}</Td>
                  {money(l.gross)}
                  <Td className="text-right"><Sar value={l.discount} minus /></Td>
                  {money(l.tax)}
                  {money(l.total, "font-semibold")}
                  {insured && (
                    <>
                      {money(l.patientAmount, groupBorder)}{money(l.patientTax)}{money(l.patientBalance, l.patientBalance > 0.004 ? "text-warn font-semibold" : undefined)}
                      {money(l.insuranceAmount, groupBorder)}{money(l.insuranceTax)}{money(l.insuranceBalance, l.insuranceBalance > 0.004 ? "text-warn font-semibold" : undefined)}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <Td className="bg-muted/50">Totals</Td>
                <Td className="bg-muted/50" />
                <Td className="bg-muted/50" />
                {money(t.gross, "bg-muted/50")}
                <Td className="bg-muted/50 text-right"><Sar value={t.discount} minus /></Td>
                {money(t.tax, "bg-muted/50")}
                {money(t.total, "bg-muted/50")}
                {insured && (
                  <>
                    {money(t.patientAmount, cn("bg-muted/50", groupBorder))}{money(t.patientTax, "bg-muted/50")}{money(t.patientBalance, "bg-muted/50")}
                    {money(t.insuranceAmount, cn("bg-muted/50", groupBorder))}{money(t.insuranceTax, "bg-muted/50")}{money(t.insuranceBalance, "bg-muted/50")}
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader title="Payments And Transactions" right={<span className="text-xs text-muted-foreground">{inv.transactions.length} {inv.transactions.length === 1 ? "Entry" : "Entries"}</span>} />
          {inv.transactions.length === 0 ? (
            <Empty>No payments recorded.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {[...inv.transactions].reverse().map((tx) => (
                <li key={tx.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium", tx.kind === "waiver" && "text-muted-foreground")}>
                      {tx.kind === "waiver" ? "Waived Off" : tx.kind === "refund" ? `Refund (${tx.method})` : tx.method}
                      {tx.waiverType && <span className="font-normal"> · {tx.waiverType}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{when(tx.at)} · {tx.by}</p>
                    {tx.reference && <p className="text-xs text-muted-foreground">Ref: {tx.reference}</p>}
                    {tx.proofName && <p className="text-xs text-muted-foreground">Proof: {tx.proofName}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Sar
                      value={tx.amount}
                      minus={tx.kind === "refund"}
                      className={cn("font-semibold", tx.kind === "waiver" ? "text-muted-foreground line-through" : tx.kind === "refund" ? "text-move" : "text-ok")}
                    />
                    {(v.unallocated[tx.id] ?? 0) > 0 && <Badge tone="warn">Unapplied <Sar value={v.unallocated[tx.id]} /></Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Total Summary" right={t.waived > 0 ? <Badge tone="merge">Waived Off</Badge> : undefined} />
          <div className="flex gap-4 p-4">
            <dl className="flex-1 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Taxable Amount</dt><dd><Sar value={t.taxable} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">VAT</dt><dd><Sar value={t.tax} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Grand Total</dt><dd className="font-semibold"><Sar value={t.total} /></dd></div>
              {insured && <div className="flex justify-between"><dt className="text-muted-foreground">Insurance Balance</dt><dd><Sar value={t.insuranceBalance} /></dd></div>}
              {t.waived > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Waived</dt><dd><Sar value={t.waived} minus /></dd></div>}
              {t.refunded > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Refunded</dt><dd><Sar value={t.refunded} /></dd></div>}
              <div className="flex justify-between border-t border-border pt-1.5"><dt className="font-semibold">Patient Due</dt><dd className="font-bold"><Sar value={t.patientBalance} /></dd></div>
            </dl>
            {reported && <ZatcaQr view={v} />}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            {t.patientBalance > 0.004 && (
              <Button variant="primary" onClick={() => setPayOpen(true)} disabled={!cashier} title={cashier ? undefined : noCash}>
                <CreditCard className="size-4" /> Take Payment
              </Button>
            )}
            {v.overpaid > 0 && (
              <Button onClick={() => setRefundOpen(true)} disabled={!cashier} title={cashier ? undefined : noCash}>Process Refund</Button>
            )}
            {Math.abs(t.patientBalance) <= 0.004 && Object.keys(v.unallocated).length > 0 && (
              <Button onClick={() => setPayOpen(true)} disabled={!cashier} title={cashier ? undefined : noCash}>Adjust Payment</Button>
            )}
            {Math.abs(t.patientBalance) <= 0.004 && Object.keys(v.unallocated).length === 0 && (
              <Button disabled><CreditCard className="size-4" /> {t.waived > 0 && t.patientPaid <= 0 ? "Waived Off" : "Paid In Full"}</Button>
            )}
          </div>
        </Card>
      </div>

      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} view={v} />
      <RefundDialog open={refundOpen} onClose={() => setRefundOpen(false)} view={v} />
      <ReceiptDialog open={receiptOpen} onClose={() => setReceiptOpen(false)} view={v} patient={patient} />
    </div>
  );
}
