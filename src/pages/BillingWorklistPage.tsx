import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ClipboardCheck, FileText, History, ListTree, MoreHorizontal, Plus, RotateCcw, Search, Send, ShieldCheck, X } from "lucide-react";
import { IconAlertOctagon, IconCalendarDue, IconCash, IconClockHour4, IconSend } from "@tabler/icons-react";
import { ReviewDialog, useClaimSend } from "@/components/claims/ClaimParts";
import { BrandChip, FilterField, IconAction, ItemChips, Pagination, ResponsiveFilters, StatusChip, fmtDate, fmtTime, useIsPhone, usePaging } from "@/components/claims/RcmUi";
import { CreateClaimDialog, LogsDialog, PollRequestDialog, ReviewBatchDialog, SubmitBatchDialog } from "@/components/claims/WorklistDialogs";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Money } from "@/components/Money";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { Button, Card, Empty, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  batchCheck, billingRows, CLAIM_TYPE_LABEL, EMPTY_WORKLIST_FILTER, filterRows, reviewSummary, runReview, sortRows, SUBTYPE_LABEL, useClaims, WORKLIST_SORT_LABEL,
  type ClaimType, type WorklistFilter, type WorklistRow, type WorklistSort,
} from "@/lib/claims";
import { syncInvoices, useInvoices } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { allTransactions } from "@/lib/rcm-transactions";
import { useRad } from "@/lib/radiology";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { useVitals } from "@/lib/vitals";

const CLASS_LABEL: Record<string, string> = { O: "Outpatient", E: "Emergency", I: "Inpatient" };
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Biller worklist, one row per insured visit: /billing */
export function BillingWorklistPage() {
  const his = useHis();
  const lab = useLab();
  const rad = useRad();
  const rx = useRx();
  const fin = useFinancial();
  useInvoices();
  useClaims();
  useVitals();
  useSession();
  const [filter, setFilter] = React.useState<WorklistFilter>(EMPTY_WORKLIST_FILTER);
  const [sort, setSort] = React.useState<WorklistSort>("visit-desc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<null | "create" | "poll" | "review-batch" | "submit-batch">(null);
  const [reviewVisit, setReviewVisit] = React.useState<string | null>(null);
  const [logsVisit, setLogsVisit] = React.useState<string | null>(null);
  const [send, sendDialog] = useClaimSend();
  const phone = useIsPhone();
  const allowed = can("billing");
  const noRole = "Your role cannot send. This needs the billing permission.";

  // The claim amounts come from the invoices, so make sure every billable visit has its invoice.
  React.useEffect(() => { syncInvoices(); }, [his, lab, rad, rx]);

  const all = billingRows(fin);
  const rows = sortRows(filterRows(all, filter), sort);
  const paging = usePaging(rows.length, 25);
  const pageRows = paging.slice(rows);
  const payers = [...new Set(all.map((r) => r.payer))].sort();
  const statuses = [...new Set(all.map((r) => r.status.label))].sort();
  const active = Object.values(filter).filter(Boolean).length;
  const set = <K extends keyof WorklistFilter>(k: K, v: WorklistFilter[K]) => { setFilter((f) => ({ ...f, [k]: v })); paging.setPage(1); };

  // Selection survives filtering; rows that left the list (claim sent elsewhere) drop out.
  const selectedRows = all.filter((r) => selected.has(r.visit));
  const toggle = (v: string) => setSelected((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const pageAll = pageRows.length > 0 && pageRows.every((r) => selected.has(r.visit));
  const togglePage = () => setSelected((s) => { const n = new Set(s); pageRows.forEach((r) => (pageAll ? n.delete(r.visit) : n.add(r.visit))); return n; });

  // KPIs over every insured visit, not only the filtered ones.
  const today = todayLocal();
  const ready = all.filter((r) => r.options.claim.enabled && r.options.claim.action === "claim" && !r.findings.some((f) => f.severity === "hard")).length;
  const sentToday = allTransactions().filter((t) => localDay(t.sentAt) === today).length;
  const waiting = all.filter((r) => r.m.fin.authorization?.status === "pended" || r.m.fin.claim?.status === "pended" || r.m.fin.claim?.status === "needs-info").length;
  const rejected = all.filter((r) => r.m.fin.claim?.status === "rejected" || r.m.fin.authorization?.status === "denied").length;
  const outstanding = all.filter((r) => r.m.fin.claim && r.m.fin.claim.status !== "rejected" && r.m.fin.claim.status !== "cancelled").reduce((n, r) => n + r.m.totals.insuranceBalance, 0);

  const reviewOf = reviewVisit ? all.find((r) => r.visit === reviewVisit) : undefined;
  const openReview = (v: string) => { runReview(v); setReviewVisit(v); };

  const filters = (drawer: boolean) => (
    <div className={cn(drawer ? "flex flex-col gap-3" : "grid items-end gap-2.5 px-4 py-3 md:grid-cols-4 xl:grid-cols-[minmax(10rem,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_8.5rem_8.5rem_9rem_auto]")}>
      <FilterField label="Patient" className={drawer ? undefined : "md:col-span-2 xl:col-span-1"}>
        <span className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Name, MRN or visit" value={filter.patient} onChange={(e) => set("patient", e.target.value)} />
        </span>
      </FilterField>
      <FilterField label="Payer">
        <Select value={filter.payer} onChange={(e) => set("payer", e.target.value)}>
          <option value="">All Payers</option>
          {payers.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Claim Type">
        <Select value={filter.type} onChange={(e) => set("type", e.target.value as "" | ClaimType)}>
          <option value="">All Types</option>
          {(Object.keys(CLAIM_TYPE_LABEL) as ClaimType[]).map((t) => <option key={t} value={t}>{CLAIM_TYPE_LABEL[t]}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Claim Status">
        <Select value={filter.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Start Date"><Input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => set("from", e.target.value)} /></FilterField>
      <FilterField label="End Date"><Input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => set("to", e.target.value)} /></FilterField>
      <FilterField label="Sort By">
        <Select value={sort} onChange={(e) => setSort(e.target.value as WorklistSort)}>
          {(Object.keys(WORKLIST_SORT_LABEL) as WorklistSort[]).map((s) => <option key={s} value={s}>{WORKLIST_SORT_LABEL[s]}</option>)}
        </Select>
      </FilterField>
      {!drawer && (
        <Button className="h-9" variant="ghost" disabled={!active} onClick={() => setFilter(EMPTY_WORKLIST_FILTER)} aria-label="Reset filters" title="Reset filters">
          <RotateCcw className="size-4" /><span className="xl:sr-only">Reset</span>
        </Button>
      )}
    </div>
  );

  const actions = (r: WorklistRow) => <RowActions r={r} allowed={allowed} noRole={noRole} send={send} onReview={openReview} onLogs={setLogsVisit} />;

  return (
    <TooltipProvider delayDuration={250}>
      <PageHeader
        title="Billing Worklist"
        subtitle="One row per insured visit. Check the claim, send prior authorization when it is needed, then send the claim to the payer through NPHIES."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="More billing actions"><MoreHorizontal className="size-4" /><span className="hidden sm:inline">More</span></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem disabled={!allowed} onSelect={() => setDialog("poll")}>
                  <History /> <span><span className="block">Poll Request</span><span className="block text-xs text-muted-foreground">Fetch answers the payer still owes</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/m/claim-import")}>
                  <ListTree /> <span><span className="block">Import Claims</span><span className="block text-xs text-muted-foreground">Claims from another system</span></span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/transactions")}><IconSend stroke={1.75} /> Submitted Transactions</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/nphies-financial")}><IconCash stroke={1.75} /> NPHIES Financial</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="primary" disabled={!allowed} title={allowed ? undefined : noRole} onClick={() => setDialog("create")}><Plus className="size-4" /> Create Claim / PreAuth</Button>
          </div>
        }
      />

      <KpiStrip label="Billing totals" className="mb-4 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        <KpiTile dense={phone} icon={<Send strokeWidth={1.75} />} label="Claims Ready" value={ready.toLocaleString("en-US")} note="Can be sent now" />
        <KpiTile dense={phone} icon={<IconCalendarDue stroke={1.75} />} label="Sent Today" value={sentToday.toLocaleString("en-US")} note="Requests to NPHIES" onClick={() => navigate("/transactions")} />
        <KpiTile dense={phone} icon={<IconClockHour4 stroke={1.75} />} label="Pending Payer" value={waiting.toLocaleString("en-US")} note={waiting ? "Use Poll Request" : "Nothing waiting"} accent={waiting ? "warn" : "brand"} />
        <KpiTile dense={phone} icon={<IconAlertOctagon stroke={1.75} />} label="Rejected" value={rejected.toLocaleString("en-US")} note="Claims rejected or authorizations denied" accent={rejected ? "danger" : "brand"} tone={rejected ? "danger" : undefined} />
        <KpiTile dense={phone} icon={<IconCash stroke={1.75} />} label="Money Outstanding" value={<Money value={outstanding} />} note="Insurance share not paid yet" className="col-span-2 lg:col-span-1" />
      </KpiStrip>

      <Card className="relative">
        <div className="border-b border-border px-4 py-3 md:p-0">
          <ResponsiveFilters render={filters} active={active} onReset={() => setFilter(EMPTY_WORKLIST_FILTER)} title="Filters" />
        </div>

        {/* Desktop and tablet: the table. */}
        <div className="hidden md:block">
          <Table>
            <thead>
              <tr>
                <Th className="w-9 px-2.5">
                  <input type="checkbox" aria-label="Select every claim on this page" checked={pageAll} onChange={togglePage} disabled={!pageRows.length} className="size-4 accent-[#035d53]" />
                </Th>
                <Th className="w-9 px-1.5">Sr#</Th>
                <Th>Invoice No</Th>
                <Th>Patient</Th>
                <Th>Visit Date/Time</Th>
                <Th>Payer</Th>
                <Th>Claim</Th>
                <Th>Total Items</Th>
                <Th numeric>Net Amount</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><Td colSpan={10}><Empty>{all.length ? "No claims match the filters. Reset them to see every insured visit." : "No insured visits yet. Cash visits are billed on the Invoice Worklist."}</Empty></Td></tr>
              )}
              {pageRows.map((r, i) => {
                const on = selected.has(r.visit);
                return (
                  <tr key={r.visit} className={cn("align-top transition-colors hover:bg-muted/40", on && "bg-[#39edd5]/[0.07] hover:bg-[#39edd5]/10")}>
                    <Td className="px-2.5"><input type="checkbox" aria-label={`Select claim for ${patientName(r.patient)}, visit ${r.visit}`} checked={on} onChange={() => toggle(r.visit)} className="mt-0.5 size-4 accent-[#035d53]" /></Td>
                    <Td className="px-1.5 tabular-nums text-muted-foreground">{(paging.page - 1) * paging.size + i + 1}</Td>
                    <Td className="font-mono text-xs">{r.invoiceNumber ? `#${r.invoiceNumber}` : <span className="font-sans text-muted-foreground">None</span>}</Td>
                    <Td className="min-w-40">
                      <button type="button" className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate("/claim", { visit: r.visit })}>{patientName(r.patient)}</button>
                      <div className="mt-0.5 text-xs text-muted-foreground">MRN <span className="font-mono">{r.patient.mrn}</span></div>
                      <div className="text-xs text-muted-foreground">Visit <span className="font-mono">{r.visit}</span></div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div>{fmtDate(r.visitAt)}</div>
                      <div className="text-xs text-muted-foreground">{fmtTime(r.visitAt)}{fmtTime(r.visitAt) ? ", " : ""}{CLASS_LABEL[r.enc.cls]}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{r.payer}</Td>
                    <Td className="min-w-44"><ClaimCell r={r} onReview={openReview} /></Td>
                    <Td className="min-w-28">
                      <div className="mb-1 text-sm font-semibold tabular-nums">{r.items.total} <span className="text-xs font-normal text-muted-foreground">item{r.items.total === 1 ? "" : "s"}</span></div>
                      <ItemChips items={r.items} />
                    </Td>
                    <Td numeric className="font-semibold"><Sar value={r.m.net} /></Td>
                    <Td>{actions(r)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>

        {/* Phone: one card per claim. */}
        <ul className="flex flex-col gap-2.5 p-3 md:hidden" aria-label="Claims">
          {rows.length === 0 && <li><Empty>{all.length ? "No claims match the filters." : "No insured visits yet."}</Empty></li>}
          {pageRows.map((r) => {
            const on = selected.has(r.visit);
            return (
              <li key={r.visit} className={cn("rounded-xl border bg-card p-3", on ? "border-[#03c1ac]" : "border-border")}>
                <div className="flex items-start gap-2.5">
                  <input type="checkbox" aria-label={`Select claim for ${patientName(r.patient)}`} checked={on} onChange={() => toggle(r.visit)} className="mt-1 size-4 accent-[#035d53]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="text-left font-medium leading-tight" onClick={() => navigate("/claim", { visit: r.visit })}>{patientName(r.patient)}</button>
                      <Sar value={r.m.net} className="text-sm font-semibold" />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">MRN {r.patient.mrn}, visit {r.visit}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(r.visitAt)}, {CLASS_LABEL[r.enc.cls]}, {r.payer}</p>
                  </div>
                </div>
                <div className="mt-2.5 border-t border-border/70 pt-2.5"><ClaimCell r={r} onReview={openReview} /></div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <ItemChips items={r.items} />
                  {actions(r)}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-border">
          <Pagination total={rows.length} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} noun="claims" />
        </div>
      </Card>

      <BulkBar
        rows={selectedRows}
        allowed={allowed}
        onClear={() => setSelected(new Set())}
        onReview={() => setDialog("review-batch")}
        onSubmit={() => setDialog("submit-batch")}
      />

      <CreateClaimDialog open={dialog === "create"} onClose={() => setDialog(null)} rows={all} />
      <PollRequestDialog open={dialog === "poll"} onClose={() => setDialog(null)} payers={payers} />
      <ReviewBatchDialog open={dialog === "review-batch"} onClose={() => setDialog(null)} rows={selectedRows} />
      <SubmitBatchDialog open={dialog === "submit-batch"} onClose={() => setDialog(null)} rows={selectedRows} onDone={() => undefined} />
      <LogsDialog visit={logsVisit} onClose={() => setLogsVisit(null)} />
      {reviewOf && <ReviewDialog open onClose={() => setReviewVisit(null)} visit={reviewOf.visit} findings={reviewOf.findings} ack={reviewOf.m.draft?.ack} />}
      {sendDialog}
    </TooltipProvider>
  );
}

/** Claim number, then Type, Sub-Type and Status chips. A Hard Stop or Soft Stop shows as a link to the review. */
function ClaimCell({ r, onReview }: { r: WorklistRow; onReview: (v: string) => void }) {
  const s = reviewSummary(r.findings);
  const cl = r.m.fin.claim;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {cl ? <span className="font-mono text-xs font-semibold">{cl.claimNumber}</span> : <span className="text-xs text-muted-foreground">Not Sent Yet</span>}
        <StatusChip status={r.status} />
      </div>
      <div className="flex flex-wrap gap-1">
        <BrandChip title="Claim Type">{CLAIM_TYPE_LABEL[r.m.type]}</BrandChip>
        <BrandChip title="Sub-Type">{SUBTYPE_LABEL[r.m.subType]}</BrandChip>
      </div>
      {(s.hard > 0 || s.soft > 0 || (r.m.authNeeded && r.m.fin.authorization?.status !== "approved")) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {r.m.authNeeded && r.m.fin.authorization?.status !== "approved" && <span className="font-medium text-warn">Needs PreAuth</span>}
          {(s.hard > 0 || s.soft > 0) && (
            <button type="button" onClick={() => onReview(r.visit)} className={cn("rounded font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", s.hard ? "text-destructive" : "text-warn")}>
              {s.hard ? `${s.hard} Hard Stop${s.hard === 1 ? "" : "s"}` : `${s.soft} Soft Stop${s.soft === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RowActions({ r, allowed, noRole, send, onReview, onLogs }: {
  r: WorklistRow; allowed: boolean; noRole: string; send: (v: string, use: "priorauth" | "claim") => void; onReview: (v: string) => void; onLogs: (v: string) => void;
}) {
  const pa = r.options.priorAuth;
  const cl = r.options.claim;
  const hasLogs = r.m.fin.messages.length > 0;
  const hard = r.findings.filter((f) => f.severity === "hard").length;
  const claimTip = cl.enabled && cl.reviewed && hard ? `${cl.label}. The review has ${hard} Hard Stop${hard === 1 ? "" : "s"}, so it opens the review first.` : cl.label;
  const who = `${patientName(r.patient)}, visit ${r.visit}`;
  return (
    <div className="flex items-center justify-end gap-1">
      <IconAction icon={<ShieldCheck />} label={pa.enabled ? pa.label : "Send PreAuth"} disabled={!allowed || !pa.enabled} reason={!allowed ? noRole : pa.why} onClick={() => send(r.visit, "priorauth")} />
      <IconAction icon={<Send />} label={cl.enabled ? claimTip : "Send Claim"} disabled={!allowed || !cl.enabled} reason={!allowed ? noRole : cl.why} onClick={() => send(r.visit, "claim")} />
      <IconAction icon={<FileText />} label="Open Claim" onClick={() => navigate("/claim", { visit: r.visit })} primary />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`More actions for ${who}`} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={() => onReview(r.visit)} className="items-start">
            <ClipboardCheck className="mt-0.5" />
            <span><span className="block">Review</span><span className="block text-xs text-muted-foreground">Hard Stops, Soft Stops and Warnings</span></span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasLogs} onSelect={() => navigate("/transactions", { visit: r.visit })} className="items-start">
            <IconSend stroke={1.75} className="mt-0.5" />
            <span><span className="block">Transactions</span><span className="block text-xs text-muted-foreground">{hasLogs ? "Requests and answers with their JSON" : "Nothing sent to NPHIES yet"}</span></span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasLogs} onSelect={() => onLogs(r.visit)} className="items-start">
            <History className="mt-0.5" />
            <span><span className="block">Logs</span><span className="block text-xs text-muted-foreground">{hasLogs ? "Timeline of this claim" : "Nothing sent to NPHIES yet"}</span></span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Bulk actions, shown only while claims are selected. A batch goes to one payer, so both buttons stay disabled with
 * the reason when the selection mixes payers.
 */
function BulkBar({ rows, allowed, onClear, onReview, onSubmit }: { rows: WorklistRow[]; allowed: boolean; onClear: () => void; onReview: () => void; onSubmit: () => void }) {
  const still = useReducedMotion();
  const review = batchCheck(rows, "review");
  const submit = batchCheck(rows, "submit");
  const payers = [...new Set(rows.map((r) => r.payer))];
  const why = !allowed ? "Your role cannot send. This needs the billing permission." : !review.ok ? review.why : !submit.ok ? submit.why : "";
  return (
    <AnimatePresence>
      {rows.length > 0 && (
        <motion.div
          role="region"
          aria-label="Selected claims"
          initial={still ? false : { y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={still ? { opacity: 0 } : { y: 24, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 0.8, 0.3, 1] }}
          className="sticky bottom-20 z-30 mt-4 w-full max-w-[50rem] md:bottom-4"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-[linear-gradient(135deg,#032c26,#03443a)] px-4 py-3 text-white shadow-[0_18px_40px_-18px_rgba(3,44,38,0.7)]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold"><span className="tabular-nums text-[#39edd5]">{rows.length}</span> claim{rows.length === 1 ? "" : "s"} selected{payers.length === 1 ? ` for ${payers[0]}` : ""}</p>
              <p className="text-xs text-white/75" aria-live="polite">{why || `${submit.ready.length} ready to send${submit.skipped.length ? `, ${submit.skipped.length} not ready` : ""}.`}</p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button type="button" onClick={onReview} disabled={!review.ok}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-white/25 px-3 sm:flex-none text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39edd5] disabled:opacity-45">
                <ClipboardCheck className="size-4" /> Review<span className="hidden sm:inline"> Batch</span>
              </button>
              <button type="button" onClick={onSubmit} disabled={!allowed || !review.ok}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-[#39edd5] px-3 sm:flex-none text-sm font-semibold text-[#032c26] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-45">
                <Send className="size-4" /> Submit<span className="hidden sm:inline"> Batch Request</span>
              </button>
              <button type="button" onClick={onClear} aria-label="Clear the selection" className="inline-flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39edd5]">
                <X className="size-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
