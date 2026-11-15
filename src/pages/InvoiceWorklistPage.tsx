import * as React from "react";
import { Eye, Printer, RotateCcw, Send } from "lucide-react";
import { InvoiceStatusBadge, Sar, useNow, ZatcaTag } from "@/components/invoice/InvoiceParts";
import { ReceiptDialog } from "@/components/invoice/ReceiptDialog";
import { Button, Card, CardHeader, Empty, Field, Input, PageHeader, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { setZatcaFailNext, sendToZatca, syncInvoices, useInvoices, worklist, type WorklistFilter } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { useRad } from "@/lib/radiology";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** Cashier invoice worklist: /invoices */
export function InvoiceWorklistPage() {
  const his = useHis();
  const lab = useLab();
  const rad = useRad();
  const rx = useRx();
  const fin = useFinancial();
  const store = useInvoices();
  useSession();
  const dev = useDevMode();
  const now = useNow();
  const [filter, setFilter] = React.useState<WorklistFilter>({});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [printVisit, setPrintVisit] = React.useState<string | null>(null);
  const allowed = can("billing");

  // Every billable visit gets its invoice when the worklist opens; draft lines follow the visit.
  React.useEffect(() => { syncInvoices(); }, [his, lab, rad, rx]);

  const rows = worklist(filter, store, his, fin);
  const visible = new Set(rows.map((r) => r.view.invoice.visit));
  const chosen = [...selected].filter((v) => visible.has(v));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const printRow = rows.find((r) => r.view.invoice.visit === printVisit);

  const set = (k: keyof WorklistFilter) => (e: React.ChangeEvent<HTMLInputElement>) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (visit: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(visit)) n.delete(visit); else n.add(visit);
    return n;
  });

  const bulkSend = () => {
    const r = sendToZatca(chosen);
    if (!r.ok) { pushToast({ tone: "warn", text: r.errors[0] }); return; }
    const { reported, failed, skipped } = r.value;
    pushToast({
      tone: failed ? "warn" : "ok",
      text: `${reported} invoice${reported === 1 ? "" : "s"} reported to ZATCA.`,
      detail: [failed && `${failed} failed. Send them again.`, skipped && `${skipped} were already reported.`].filter(Boolean).join(" ") || undefined,
    });
    setSelected(new Set());
  };

  return (
    <div>
      <PageHeader
        title="Invoice Worklist"
        subtitle="One invoice per visit. Take payments, print receipts and report invoices to ZATCA within 24 hours."
        right={
          <div className="flex flex-wrap items-center gap-3">
            {dev && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={store.zatcaFailNext} onChange={setZatcaFailNext} label="Next ZATCA report fails" />
                Next ZATCA report fails
              </label>
            )}
            <Button onClick={() => navigate("/nphies-financial")}>NPHIES Financial</Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardHeader title="Filters" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Patient"><Input placeholder="Name, MRN or ID number" value={filter.patient ?? ""} onChange={set("patient")} /></Field>
          <Field label="Invoice Number"><Input inputMode="numeric" placeholder="For example 100004" value={filter.number ?? ""} onChange={set("number")} /></Field>
          <Field label="Start Date"><Input type="date" value={filter.from ?? ""} onChange={set("from")} /></Field>
          <Field label="End Date"><Input type="date" value={filter.to ?? ""} onChange={set("to")} /></Field>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button size="sm" onClick={() => { setFilter({}); setSelected(new Set()); }}><RotateCcw className="size-4" /> Reset</Button>
        </div>
      </Card>

      {chosen.length > 0 && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-semibold">{chosen.length} invoice{chosen.length === 1 ? "" : "s"} selected</span>
            <Button variant="primary" onClick={bulkSend} disabled={!allowed} title={allowed ? undefined : "This needs the billing permission."}>
              <Send className="size-4" /> Send To ZATCA
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <thead>
            <tr>
              <Th className="w-10">
                <input
                  type="checkbox" aria-label="Select all invoices shown" checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.view.invoice.visit)))}
                />
              </Th>
              <Th>Invoice Number</Th>
              <Th>Patient</Th>
              <Th>Date</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th>ZATCA</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><Td colSpan={9}><Empty>No invoices match.</Empty></Td></tr>}
            {rows.map(({ view: v, patient }) => {
              const visit = v.invoice.visit;
              const bal = v.totals.patientBalance;
              return (
                <tr key={visit} className={cn("hover:bg-muted/40", selected.has(visit) && "bg-accent/40")}>
                  <Td><input type="checkbox" aria-label={`Select invoice ${v.invoice.number}`} checked={selected.has(visit)} onChange={() => toggle(visit)} /></Td>
                  <Td className="font-mono text-xs">#{v.invoice.number}</Td>
                  <Td>
                    <div className="font-medium">{patientName(patient)}</div>
                    <div className="text-xs text-muted-foreground">{patient?.mrn}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{day(v.invoice.createdAt)}</Td>
                  <Td className="text-right font-semibold"><Sar value={v.totals.total} /></Td>
                  <Td className={cn("text-right font-semibold", bal > 0.004 ? "text-warn" : bal < -0.004 ? "text-move" : "text-ok")}><Sar value={bal} /></Td>
                  <Td><InvoiceStatusBadge status={v.status} /></Td>
                  <Td><ZatcaTag invoice={v.invoice} now={now} compact /></Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => navigate("/invoice", { visit })} aria-label={`View invoice ${v.invoice.number}`} title="View">
                        <Eye className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPrintVisit(visit)} aria-label={`Print receipt for invoice ${v.invoice.number}`} title="Print Receipt">
                        <Printer className="size-4" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {printRow && <ReceiptDialog open onClose={() => setPrintVisit(null)} view={printRow.view} patient={printRow.patient} />}
    </div>
  );
}
