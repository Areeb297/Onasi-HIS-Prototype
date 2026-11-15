import * as React from "react";
import { ChevronRight, RotateCcw, Search, X } from "lucide-react";
import { FilterField, Pagination, ResponsiveFilters, fmtDate, fmtTime, usePaging } from "@/components/claims/RcmUi";
import { OutcomeBadge, TxTypeCell, TxTypeIcon } from "@/components/claims/TxParts";
import { GlassPillSwitch } from "@/components/ui/glass";
import { Button, Card, Empty, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useFinancial } from "@/lib/nphies-financial";
import {
  allTransactions, EMPTY_TX_FILTER, filterTransactions, OUTCOMES, responseTimeText, TX_TYPE_LABEL, TX_TYPES, type TxFilter, type TxType,
} from "@/lib/rcm-transactions";
import { navigate, useRoute } from "@/lib/router";
import { useSession } from "@/lib/session";
import { useHis } from "@/lib/store";

const ALL = "All";
type TypePill = typeof ALL | (typeof TX_TYPES)[number]["short"];
const PILLS: TypePill[] = [ALL, ...TX_TYPES.map((t) => t.short)];
const typeOfPill = (p: TypePill): "" | TxType => TX_TYPES.find((t) => t.short === p)?.key ?? "";
const pillOfType = (t: "" | TxType): TypePill => TX_TYPES.find((x) => x.key === t)?.short ?? ALL;

/** Every request sent to NPHIES and its answer: /transactions (optional ?visit=) */
export function TransactionsPage() {
  useFinancial();
  useHis();
  useSession();
  const { params } = useRoute();
  const visitParam = params.get("visit") ?? "";
  const [filter, setFilter] = React.useState<TxFilter>({ ...EMPTY_TX_FILTER, visit: visitParam });
  React.useEffect(() => setFilter((f) => ({ ...f, visit: visitParam })), [visitParam]);

  const all = allTransactions();
  const rows = filterTransactions(all, filter);
  const paging = usePaging(rows.length, 25);
  const pageRows = paging.slice(rows);
  const payers = [...new Set(all.map((t) => t.payer).filter(Boolean))].sort();
  const outcomes = OUTCOMES.filter((o) => all.some((t) => t.outcome.label === o));
  const active = [filter.patient, filter.payer, filter.outcome, filter.from, filter.to].filter(Boolean).length;
  const set = <K extends keyof TxFilter>(k: K, v: TxFilter[K]) => { setFilter((f) => ({ ...f, [k]: v })); paging.setPage(1); };
  const reset = () => { setFilter({ ...EMPTY_TX_FILTER, visit: filter.visit, type: filter.type }); paging.setPage(1); };
  const open = (id: string) => navigate("/transaction", { id });

  const filters = (drawer: boolean) => (
    <div className={cn(drawer ? "flex flex-col gap-3" : "grid items-end gap-2.5 px-4 py-3 md:grid-cols-3 xl:grid-cols-[minmax(12rem,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_8.75rem_8.75rem_auto]")}>
      <FilterField label="Patient">
        <span className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Name, MRN, visit, bundle id" value={filter.patient} onChange={(e) => set("patient", e.target.value)} />
        </span>
      </FilterField>
      <FilterField label="Payer">
        <Select value={filter.payer} onChange={(e) => set("payer", e.target.value)}>
          <option value="">All Payers</option>
          {payers.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Outcome">
        <Select value={filter.outcome} onChange={(e) => set("outcome", e.target.value)}>
          <option value="">All Outcomes</option>
          {outcomes.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Sent From"><Input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => set("from", e.target.value)} /></FilterField>
      <FilterField label="Sent To"><Input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => set("to", e.target.value)} /></FilterField>
      {drawer ? (
        <FilterField label="Request Type">
          <Select value={filter.type} onChange={(e) => set("type", e.target.value as "" | TxType)}>
            <option value="">All Types</option>
            {TX_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </FilterField>
      ) : (
        <Button className="h-9" variant="ghost" disabled={!active} onClick={reset} aria-label="Reset filters" title="Reset filters"><RotateCcw className="size-4" /><span className="xl:sr-only">Reset</span></Button>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Submitted Transactions"
        subtitle="Every request the hospital sent to NPHIES and the answer that came back: eligibility, prior authorization, claims, polls, cancellations and payment notices."
        right={<Button onClick={() => navigate("/billing")}>Billing Worklist</Button>}
      />

      <div className="mb-3 hidden md:block">
        <GlassPillSwitch label="Request type" size="sm" value={pillOfType(filter.type)} options={PILLS} onChange={(p) => set("type", typeOfPill(p))} />
      </div>

      <Card>
        <div className="border-b border-border px-4 py-3 md:p-0">
          <ResponsiveFilters render={filters} active={active + (filter.type ? 1 : 0)} onReset={() => { reset(); set("type", ""); }} />
        </div>
        {filter.visit && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm">
            <span className="text-muted-foreground">Showing visit</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#39edd5]/15 py-0.5 pe-1 ps-2.5 font-mono text-xs font-semibold text-[#035d53] dark:text-[#39edd5]">
              {filter.visit}
              <button type="button" aria-label="Show every visit" onClick={() => navigate("/transactions")} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-[#39edd5]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3" /></button>
            </span>
            <Button size="sm" variant="ghost" onClick={() => navigate("/claim", { visit: filter.visit })}>Open Claim</Button>
          </div>
        )}

        <div className="hidden md:block">
          <Table>
            <thead>
              <tr>
                <Th>Sent</Th>
                <Th>Request Type</Th>
                <Th>Patient</Th>
                <Th>Payer</Th>
                <Th>Bundle Id</Th>
                <Th>Outcome</Th>
                <Th>Response Time</Th>
                <Th className="relative w-10"><span className="sr-only">Open</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><Td colSpan={8}><Empty>{all.length ? "No transactions match the filters." : "Nothing has been sent to NPHIES yet. Requests appear here as soon as eligibility, prior authorization or a claim is sent."}</Empty></Td></tr>}
              {pageRows.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => open(t.id)}>
                  <Td className="whitespace-nowrap"><div>{fmtDate(t.sentAt)}</div><div className="text-xs tabular-nums text-muted-foreground">{fmtTime(t.sentAt)}</div></Td>
                  <Td><TxTypeCell tx={t} /></Td>
                  <Td className="min-w-40">
                    <div className="font-medium">{t.patientName}</div>
                    <div className="text-xs text-muted-foreground">MRN <span className="font-mono">{t.mrn}</span>, visit <span className="font-mono">{t.visit}</span></div>
                  </Td>
                  <Td className="whitespace-nowrap">{t.payer || "Not Named"}</Td>
                  <Td><span className="font-mono text-xs" title={t.bundleId}>{t.bundleId.slice(0, 13)}...</span></Td>
                  <Td><OutcomeBadge tx={t} /></Td>
                  <Td className="whitespace-nowrap text-sm text-muted-foreground">{responseTimeText(t.responseMs)}</Td>
                  <Td>
                    <button type="button" aria-label={`Open ${TX_TYPE_LABEL[t.type]} for ${t.patientName}, sent ${fmtDate(t.sentAt)} ${fmtTime(t.sentAt)}`} onClick={(e) => { e.stopPropagation(); open(t.id); }}
                      className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronRight className="size-4" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <ul className="flex flex-col gap-2 p-3 md:hidden" aria-label="Transactions">
          {rows.length === 0 && <li><Empty>{all.length ? "No transactions match the filters." : "Nothing has been sent to NPHIES yet."}</Empty></li>}
          {pageRows.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => open(t.id)} className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="glass-icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"><TxTypeIcon type={t.type} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium">{TX_TYPE_LABEL[t.type]}{t.focus ? `, ${t.focus}` : ""}</span>
                    <OutcomeBadge tx={t} />
                  </span>
                  <span className="mt-0.5 block text-sm">{t.patientName}</span>
                  <span className="block text-xs text-muted-foreground">{t.payer}, visit {t.visit}</span>
                  <span className="block text-xs text-muted-foreground">{fmtDate(t.sentAt)} at {fmtTime(t.sentAt)}, {responseTimeText(t.responseMs).toLowerCase()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-border">
          <Pagination total={rows.length} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} noun="transactions" />
        </div>
      </Card>
    </div>
  );
}
