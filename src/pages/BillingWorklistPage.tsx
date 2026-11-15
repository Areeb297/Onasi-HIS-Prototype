import * as React from "react";
import { FileText, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { ClaimStatusBadge, ReviewCounts, useClaimSend } from "@/components/claims/ClaimParts";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { CLAIM_TYPE_LABEL, claimFor, claimStatusOf, insuredVisits, reviewModel, sendOptions, SUBTYPE_LABEL, useClaims, type ClaimType } from "@/lib/claims";
import { syncInvoices, useInvoices } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { useRad } from "@/lib/radiology";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { useVitals } from "@/lib/vitals";

const day = (iso: string | undefined) => (iso ? new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not Recorded");
const CLASS_LABEL: Record<string, string> = { O: "Outpatient", E: "Emergency", I: "Inpatient" };

interface Filter { patient: string; payer: string; type: "" | ClaimType; status: string; from: string; to: string }
const EMPTY: Filter = { patient: "", payer: "", type: "", status: "", from: "", to: "" };

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
  const [filter, setFilter] = React.useState<Filter>(EMPTY);
  const [send, sendDialog] = useClaimSend();
  const allowed = can("billing");

  // The claim amounts come from the invoices, so make sure every billable visit has its invoice.
  React.useEffect(() => { syncInvoices(); }, [his, lab, rad, rx]);

  const all = insuredVisits().map(({ enc, patient, payer }) => {
    const m = claimFor(enc.visitNumber)!;
    const status = claimStatusOf(m.fin);
    return { enc, patient, payer, m, status, findings: reviewModel(m, "claim"), options: sendOptions(enc, fin), visitDay: (enc.admitAt ?? enc.ed?.arrivalAt ?? "").slice(0, 10) };
  });
  const statuses = [...new Set(all.map((r) => r.status.label))].sort();
  const payers = [...new Set(all.map((r) => r.payer))].sort();
  const q = filter.patient.trim().toLowerCase();
  const rows = all
    .filter((r) => !q || `${patientName(r.patient)} ${r.patient.mrn} ${r.enc.visitNumber}`.toLowerCase().includes(q))
    .filter((r) => !filter.payer || r.payer === filter.payer)
    .filter((r) => !filter.type || r.m.type === filter.type)
    .filter((r) => !filter.status || r.status.label === filter.status)
    .filter((r) => !filter.from || (r.visitDay && r.visitDay >= filter.from))
    .filter((r) => !filter.to || (r.visitDay && r.visitDay <= filter.to))
    .sort((a, b) => a.visitDay.localeCompare(b.visitDay));

  const net = rows.reduce((n, r) => n + r.m.net, 0);
  const oldest = rows.find((r) => r.visitDay)?.visitDay;
  const oldestDays = oldest ? Math.max(0, Math.floor((Date.now() - new Date(`${oldest}T00:00:00`).getTime()) / 86_400_000)) : 0;
  const set = (k: keyof Filter) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const noRole = allowed ? undefined : "This needs the billing permission.";

  return (
    <div>
      <PageHeader
        title="Billing Worklist"
        subtitle="One row per insured visit. Open the claim to review it, then send prior authorization and the claim to the payer through NPHIES."
        right={<Button onClick={() => navigate("/nphies-financial")}>NPHIES Financial</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="px-4 py-3"><div className="text-xs text-muted-foreground">Records</div><div className="mt-1 text-xl font-semibold tabular-nums">{rows.length}</div></Card>
        <Card className="px-4 py-3"><div className="text-xs text-muted-foreground">Net Amount</div><div className="mt-1 text-xl font-semibold"><Sar value={net} /></div></Card>
        <Card className="px-4 py-3">
          <div className="text-xs text-muted-foreground">Oldest Visit</div>
          <div className="mt-1 text-xl font-semibold">{oldest ? day(oldest) : "None"}</div>
          {oldest && <div className="text-xs text-muted-foreground">{oldestDays} day{oldestDays === 1 ? "" : "s"} ago</div>}
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader title="Filters" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label="Patient"><Input placeholder="Name, MRN or visit" value={filter.patient} onChange={set("patient")} /></Field>
          <Field label="Payer">
            <Select value={filter.payer} onChange={set("payer")}>
              <option value="">All Payers</option>
              {payers.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Claim Type">
            <Select value={filter.type} onChange={set("type")}>
              <option value="">All Types</option>
              {(Object.keys(CLAIM_TYPE_LABEL) as ClaimType[]).map((t) => <option key={t} value={t}>{CLAIM_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="Claim Status">
            <Select value={filter.status} onChange={set("status")}>
              <option value="">All Statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Start Date"><Input type="date" value={filter.from} onChange={set("from")} /></Field>
          <Field label="End Date"><Input type="date" value={filter.to} onChange={set("to")} /></Field>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button size="sm" onClick={() => setFilter(EMPTY)}><RotateCcw className="size-4" /> Reset</Button>
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Visit</Th>
              <Th>Patient</Th>
              <Th>Payer</Th>
              <Th>Claim Type</Th>
              <Th>Claim Status</Th>
              <Th>Items</Th>
              <Th>Review</Th>
              <Th className="text-right">Net Amount</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={9}><Empty>{all.length ? "No visits match the filters." : "No insured visits yet. Cash visits are billed on the Invoice Worklist."}</Empty></Td></tr>
            )}
            {rows.map(({ enc, patient, payer, m, status, findings, options }) => {
              const v = enc.visitNumber;
              const hard = findings.some((f) => f.severity === "hard");
              return (
                <tr key={v} className="hover:bg-muted/40">
                  <Td>
                    <div className="font-mono text-xs">{v}</div>
                    <div className="text-xs text-muted-foreground">{CLASS_LABEL[enc.cls]}, {day(enc.admitAt ?? enc.ed?.arrivalAt)}</div>
                  </Td>
                  <Td>
                    <div className="font-medium">{patientName(patient)}</div>
                    <div className="text-xs text-muted-foreground">{patient.mrn}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{payer}</Td>
                  <Td className="whitespace-nowrap">{CLAIM_TYPE_LABEL[m.type]}<div className="text-xs text-muted-foreground">{SUBTYPE_LABEL[m.subType]}</div></Td>
                  <Td>
                    <ClaimStatusBadge status={status} />
                    {m.authNeeded && m.fin.authorization?.status !== "approved" && <div className="mt-1"><Badge tone="warn">Authorization Needed</Badge></div>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    <div>{m.lines.length} service{m.lines.length === 1 ? "" : "s"}</div>
                    <div className="text-muted-foreground">{m.dx.length} diagnos{m.dx.length === 1 ? "is" : "es"}</div>
                  </Td>
                  <Td><ReviewCounts findings={findings} compact /></Td>
                  <Td className="text-right font-semibold"><Sar value={m.net} /></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" onClick={() => navigate("/claim", { visit: v })} aria-label={`Open claim for visit ${v}`}>
                        <FileText className="size-4" /> Open Claim
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        disabled={!allowed || !options.priorAuth.enabled}
                        title={noRole ?? (options.priorAuth.enabled ? options.priorAuth.label : options.priorAuth.why)}
                        aria-label={`${options.priorAuth.label} for visit ${v}`}
                        onClick={() => send(v, "priorauth")}
                      >
                        <ShieldCheck className="size-4" /> <span className="hidden xl:inline">{options.priorAuth.label}</span>
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        disabled={!allowed || !options.claim.enabled}
                        title={noRole ?? (options.claim.enabled ? (hard && options.claim.reviewed ? "The review has a Hard Stop. Open the claim to fix it." : options.claim.label) : options.claim.why)}
                        aria-label={`${options.claim.label} for visit ${v}`}
                        onClick={() => send(v, "claim")}
                      >
                        <Send className="size-4" /> <span className="hidden xl:inline">{options.claim.label}</span>
                      </Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {sendDialog}
    </div>
  );
}
