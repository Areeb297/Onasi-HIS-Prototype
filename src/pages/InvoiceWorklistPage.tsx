import * as React from "react";
import { Eye, FileText, Landmark, Printer, Send } from "lucide-react";
import { IconCash, IconClockExclamation, IconFileInvoice, IconReceipt2 } from "@tabler/icons-react";
import { InvoiceStatusBadge, Sar, useNow, ZatcaTag } from "@/components/invoice/InvoiceParts";
import { ReceiptDialog } from "@/components/invoice/ReceiptDialog";
import { DataTable, ListPage, ListToolbar, inRange, useList, type Column, type FilterDef } from "@/components/list";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Switch, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { fmtDate } from "@/lib/format";
import { setZatcaFailNext, sendToZatca, syncInvoices, useInvoices, worklist, zatcaClock, type WorklistRow } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { useRad } from "@/lib/radiology";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
  const [printVisit, setPrintVisit] = React.useState<string | null>(null);
  const allowed = can("billing");

  // Every billable visit gets its invoice when the worklist opens; draft lines follow the visit.
  React.useEffect(() => { syncInvoices(); }, [his, lab, rad, rx]);

  const all = worklist({}, store, his, fin);
  type Row = WorklistRow;
  const zatca = (r: Row) => zatcaClock(r.view.invoice, now);
  const statuses = [...new Set(all.map((r) => r.view.status))].sort();

  const filters: FilterDef<Row>[] = [
    { id: "date", label: "Date", kind: "dateRange", test: (r, v) => inRange(localDay(r.view.invoice.createdAt), v) },
    { id: "status", label: "Status", quick: true, options: statuses.map((s) => ({ value: s, label: s })), test: (r, v) => r.view.status === v },
    { id: "zatca", label: "ZATCA", quick: true, allLabel: "All ZATCA States", options: [
      { value: "Pending", label: "Not Reported" }, { value: "overdue", label: "Past 24 Hours" }, { value: "Failed", label: "Failed" }, { value: "Reported", label: "Reported" },
    ], test: (r, v) => (v === "overdue" ? zatca(r).status !== "Reported" && zatca(r).overdue : zatca(r).status === v) },
    { id: "balance", label: "Balance", options: [{ value: "due", label: "Patient Owes" }, { value: "clear", label: "Settled" }, { value: "credit", label: "Refund Due" }],
      test: (r, v) => { const b = r.view.totals.patientBalance; return v === "due" ? b > 0.004 : v === "credit" ? b < -0.004 : Math.abs(b) <= 0.004; } },
  ];

  const columns: Column<Row>[] = [
    { id: "number", header: "Invoice #", hideable: false, value: (r) => r.view.invoice.number, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.view.invoice.number}</span> },
    {
      id: "patient", header: "Patient", value: (r) => patientName(r.patient),
      cell: (r) => <span className="flex items-center gap-2 whitespace-nowrap"><span className="font-medium">{patientName(r.patient)}</span><span className="font-mono text-xs text-muted-foreground">{r.patient?.mrn}</span></span>,
    },
    { id: "date", header: "Date", value: (r) => r.view.invoice.createdAt, csv: (r) => fmtDate(r.view.invoice.createdAt), cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.view.invoice.createdAt)}</span> },
    { id: "amount", header: "Amount", numeric: true, value: (r) => r.view.totals.total, cell: (r) => <span className="font-semibold"><Sar value={r.view.totals.total} /></span> },
    {
      id: "balance", header: "Balance", numeric: true, value: (r) => r.view.totals.patientBalance,
      cell: (r) => { const b = r.view.totals.patientBalance; return <span className={cn("font-semibold", b > 0.004 ? "text-warn" : b < -0.004 ? "text-move" : "text-ok")}><Sar value={b} /></span>; },
    },
    { id: "status", header: "Status", value: (r) => r.view.status, cell: (r) => <InvoiceStatusBadge status={r.view.status} /> },
    { id: "zatca", header: "ZATCA", value: (r) => zatca(r).status, csv: (r) => zatca(r).text, cell: (r) => { const z = zatca(r); return <span title={z.text}><Badge tone={z.status === "Reported" ? "ok" : z.status === "Failed" || z.overdue ? "danger" : "warn"}>{z.status === "Reported" ? "Reported" : z.status === "Failed" ? "Failed" : z.overdue ? "Overdue" : "Not Reported"}</Badge></span>; } },
  ];

  const list = useList({
    id: "invoices",
    title: "Invoice Worklist",
    rows: all,
    columns,
    getId: (r) => r.view.invoice.visit,
    filters,
    initialSort: { key: "date", dir: "desc" },
    unit: ["invoice", "invoices"],
    search: (r) => `${patientName(r.patient)} ${r.patient?.mrn ?? ""} ${r.patient?.nationalId ?? ""} ${r.view.invoice.number} ${r.view.invoice.visit}`,
  });

  const shown = list.sorted;
  const sums = shown.reduce((t, { view: v }) => {
    const bal = v.totals.patientBalance;
    const z = zatcaClock(v.invoice, now);
    t.total += v.totals.total;
    if (bal > 0.004) { t.due += bal; t.dueCount += 1; }
    if (z.status !== "Reported") { t.unreported += 1; if (z.overdue) t.overdue += 1; }
    return t;
  }, { total: 0, due: 0, dueCount: 0, unreported: 0, overdue: 0 });
  const printRow = all.find((r) => r.view.invoice.visit === printVisit);

  const bulkSend = (rows: Row[]) => {
    const r = sendToZatca(rows.map((x) => x.view.invoice.visit));
    if (!r.ok) { pushToast({ tone: "warn", text: r.errors[0] }); return; }
    const { reported, failed, skipped } = r.value;
    pushToast({
      tone: failed ? "warn" : "ok",
      text: `${reported} invoice${reported === 1 ? "" : "s"} reported to ZATCA.`,
      detail: [failed && `${failed} failed. Send them again.`, skipped && `${skipped} were already reported.`].filter(Boolean).join(" ") || undefined,
    });
    list.clearSelection();
  };

  return (
    <ListPage
      title="Invoice Worklist"
      subtitle="One invoice per visit. Report each to ZATCA within 24 hours."
      aside={dev ? (
        <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <Switch checked={store.zatcaFailNext} onChange={setZatcaFailNext} label="Next ZATCA report fails" />
          Next ZATCA Report Fails
        </label>
      ) : undefined}
      more={[{ label: "NPHIES Financial", icon: <Landmark className="size-4" />, onClick: () => navigate("/nphies-financial") }]}
      kpis={
        <KpiStrip label="Invoice totals for the rows shown" className="grid-cols-2 lg:grid-cols-4">
          <KpiTile dense icon={<IconFileInvoice stroke={1.75} />} label="Invoices" value={shown.length.toLocaleString("en-US")} />
          <KpiTile dense icon={<IconReceipt2 stroke={1.75} />} label="Invoiced" value={<Sar value={sums.total} />} />
          <KpiTile dense icon={<IconCash stroke={1.75} />} label="Patient Balance" value={<Sar value={sums.due} />} note={sums.dueCount ? `${sums.dueCount} still to pay` : undefined} tone={sums.dueCount ? "warn" : undefined} accent={sums.dueCount ? "warn" : "brand"} />
          <KpiTile dense icon={<IconClockExclamation stroke={1.75} />} label="Not Reported" value={sums.unreported.toLocaleString("en-US")} note={sums.overdue ? `${sums.overdue} past 24 hours` : undefined} tone={sums.overdue ? "danger" : undefined} accent={sums.overdue ? "danger" : "brand"} />
        </KpiStrip>
      }
    >
      <ListToolbar list={list} placeholder="Name, MRN, ID or invoice" />
      <DataTable
        list={list}
        label="Invoices"
        rowLabel={(r) => `invoice ${r.view.invoice.number}`}
        onRowClick={(r) => navigate("/invoice", { visit: r.view.invoice.visit })}
        actions={(r) => [
          { id: "view", label: "View Invoice", icon: <Eye />, onClick: () => navigate("/invoice", { visit: r.view.invoice.visit }) },
          { id: "print", label: "Print Receipt", icon: <Printer />, onClick: () => setPrintVisit(r.view.invoice.visit) },
        ]}
        selectable
        bulk={[{ label: "Send To ZATCA", icon: <Send aria-hidden="true" />, onClick: bulkSend, disabled: !allowed, title: allowed ? undefined : "Needs the billing permission." }]}
        card={(r) => ({
          title: <span className="flex items-center gap-2"><span className="font-mono text-xs font-normal text-muted-foreground">{r.view.invoice.number}</span>{patientName(r.patient)}</span>,
          aside: <InvoiceStatusBadge status={r.view.status} />,
          lines: [
            <span key="a" className="flex flex-wrap gap-x-3"><span>{fmtDate(r.view.invoice.createdAt)}</span><span className="font-semibold text-foreground"><Sar value={r.view.totals.total} /></span><span>Balance <Sar value={r.view.totals.patientBalance} /></span></span>,
            <ZatcaTag key="b" invoice={r.view.invoice} now={now} compact />,
          ],
        })}
        empty={{
          icon: <FileText />,
          title: "No Invoices Yet",
          text: "Each billable visit gets its invoice here. Take payments, print receipts and report invoices to ZATCA within 24 hours.",
        }}
      />
      {printRow && <ReceiptDialog open onClose={() => setPrintVisit(null)} view={printRow.view} patient={printRow.patient} />}
    </ListPage>
  );
}
