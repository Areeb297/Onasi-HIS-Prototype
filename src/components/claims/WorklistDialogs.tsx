import * as React from "react";
import { ExternalLink, Search } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Badge, Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import {
  batchCheck, PRIORITY_LABEL, pollRequest, pollTargets, reviewBatch, submitBatch, type BatchResult, type ClaimPriority, type Finding, type WorklistRow,
} from "@/lib/claims";
import { visitTimeline } from "@/lib/rcm-transactions";
import { navigate } from "@/lib/router";
import { getState, patientName } from "@/lib/store";
import { insurerOf } from "@/lib/invoice";
import { pushToast } from "@/lib/toast";
import { ReviewCounts } from "./ClaimParts";
import { BrandChip, StatusChip, fmtDate } from "./RcmUi";
import { TxTimeline } from "./TxParts";

const nameOf = (rows: WorklistRow[], visit: string) => {
  const r = rows.find((x) => x.visit === visit);
  return r ? patientName(r.patient) : visit;
};

/** Review Batch: the review of every selected claim, one line each, with a link to open the claim. */
export function ReviewBatchDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: WorklistRow[] }) {
  const [results, setResults] = React.useState<{ visit: string; findings: Finding[] }[]>([]);
  const key = rows.map((r) => r.visit).join(",");
  // Runs once per opening: the review saves when it ran, which re-renders the worklist.
  React.useEffect(() => { if (open && key) setResults(reviewBatch(key.split(","))); }, [open, key]);
  const clear = results.filter((r) => !r.findings.some((f) => f.severity === "hard")).length;
  return (
    <Dialog open={open} onClose={onClose} wide title="Review Batch" subtitle={`${rows.length} claim${rows.length === 1 ? "" : "s"} for ${rows[0]?.payer ?? ""}. ${clear} without a Hard Stop.`} footer={<Button onClick={onClose}>Close</Button>}>
      <ul className="flex flex-col gap-2">
        {results.map(({ visit, findings }) => (
          <li key={visit} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{nameOf(rows, visit)}</p>
              <p className="font-mono text-xs text-muted-foreground">{visit}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ReviewCounts findings={findings} />
              <Button size="sm" variant="ghost" onClick={() => { onClose(); navigate("/claim", { visit }); }}>Open Claim <ExternalLink className="size-3.5" /></Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Submit Batch Request: one payer, a priority, then the ready claims go through NPHIES Financial one by one. */
export function SubmitBatchDialog({ open, onClose, rows, onDone }: { open: boolean; onClose: () => void; rows: WorklistRow[]; onDone: () => void }) {
  const [priority, setPriority] = React.useState<ClaimPriority>("normal");
  const [result, setResult] = React.useState<BatchResult | null>(null);
  React.useEffect(() => { if (open) { setPriority("normal"); setResult(null); } }, [open]);
  const check = batchCheck(rows, "submit");
  const submit = () => {
    const r = submitBatch(check.ready, priority);
    if (!r.ok) { pushToast({ tone: "warn", text: r.problems[0] }); return; }
    setResult(r.value);
    onDone();
    pushToast({ tone: r.value.sent.length ? "ok" : "warn", text: `Batch ${r.value.batchId}: ${r.value.sent.length} sent, ${r.value.held.length} held back.` });
  };
  return (
    <Dialog
      open={open} onClose={onClose} wide title="Submit Batch Request"
      subtitle={result ? `Batch ${result.batchId} for ${check.payer}.` : `Choose a priority for every claim in the batch, then submit it to NPHIES. Each claim still passes its own review.`}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!check.ok} onClick={submit}>Submit Batch To NPHIES</Button>
      </>}
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm"><span className="font-semibold">{result.sent.length}</span> sent, <span className="font-semibold">{result.held.length}</span> held back.</p>
          {result.sent.length > 0 && <ul className="flex flex-wrap gap-1.5">{result.sent.map((v) => <li key={v}><Badge tone="ok">{nameOf(rows, v)}</Badge></li>)}</ul>}
          {result.held.length > 0 && <HeldList rows={rows} held={result.held} onClose={onClose} />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Payer</dt><dd className="font-medium">{check.payer ?? "Mixed"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Selected Claims</dt><dd className="font-medium tabular-nums">{rows.length}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Ready To Send</dt><dd className="font-medium tabular-nums">{check.ready.length}</dd></div>
          </dl>
          {!check.ok && <p role="alert" className="text-sm font-medium text-destructive">{check.why}</p>}
          <Field label="Priority" required hint="Set on every claim in this batch.">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as ClaimPriority)}>
              {(Object.keys(PRIORITY_LABEL) as ClaimPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          {check.skipped.length > 0 && <HeldList rows={rows} held={check.skipped} title="Not In This Batch" onClose={onClose} />}
        </div>
      )}
    </Dialog>
  );
}

function HeldList({ rows, held, title = "Held Back", onClose }: { rows: WorklistRow[]; held: { visit: string; why: string }[]; title?: string; onClose: () => void }) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {held.map((h) => (
          <li key={h.visit} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm">
            <span className="min-w-0"><span className="font-medium">{nameOf(rows, h.visit)}</span><span className="block text-xs text-muted-foreground">{h.why}</span></span>
            <Button size="sm" variant="ghost" onClick={() => { onClose(); navigate("/claim", { visit: h.visit }); }}>Open Claim</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Poll Request: ask NPHIES for the answers a payer still owes (queued authorizations and claims, payment advice). */
export function PollRequestDialog({ open, onClose, payers }: { open: boolean; onClose: () => void; payers: string[] }) {
  const [payer, setPayer] = React.useState("");
  React.useEffect(() => { if (open) setPayer(""); }, [open]);
  const targets = open ? pollTargets(payer) : [];
  const send = () => {
    const r = pollRequest(payer);
    if (!r.ok) { pushToast({ tone: "warn", text: r.problems[0] }); return; }
    pushToast({ tone: "ok", text: `Poll request sent. ${r.polled} answer${r.polled === 1 ? "" : "s"} received.` });
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Poll Request" subtitle="Asks NPHIES for answers the payer has not sent yet." footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!targets.length} onClick={send}>Send Poll Request</Button>
    </>}>
      <div className="flex flex-col gap-4">
        <Field label="Payer">
          <Select value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">All Payers</option>
            {payers.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        {targets.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {targets.map((t) => <li key={`${t.visit}-${t.action}`} className="flex justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2"><span className="font-mono text-xs">{t.visit}</span><span className="text-muted-foreground">{t.label}</span></li>)}
          </ul>
        ) : <p className="rounded-lg bg-muted/60 px-3 py-3 text-sm text-muted-foreground">Nothing is waiting for an answer{payer ? ` from ${payer}` : ""}.</p>}
      </div>
    </Dialog>
  );
}

/**
 * Create Claim / PreAuth: find the patient's insured visit and open its claim. Every insured visit is listed (a claim
 * already sent opens as it is); a cash patient who matches the search is shown with the reason there is no claim.
 */
export function CreateClaimDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: WorklistRow[] }) {
  const [q, setQ] = React.useState("");
  React.useEffect(() => { if (open) setQ(""); }, [open]);
  const term = q.trim().toLowerCase();
  const hit = (p: WorklistRow["patient"], visit = "") => !term || `${patientName(p)} ${p.mrn} ${p.nationalId} ${visit}`.toLowerCase().includes(term);
  const sentOf = (r: WorklistRow) => !!r.m.fin.claim && r.m.fin.claim.status !== "rejected" && r.m.fin.claim.status !== "cancelled";
  const visits = rows.filter((r) => hit(r.patient, r.visit)).sort((a, b) => Number(sentOf(a)) - Number(sentOf(b)) || b.visitAt.localeCompare(a.visitAt));
  const insured = new Set(rows.map((r) => r.patient.id));
  const cash = term ? getState().patients.filter((p) => !p.mergedInto && !insured.has(p.id) && !insurerOf(p) && hit(p)).slice(0, 5) : [];
  return (
    <Dialog open={open} onClose={onClose} wide title="Create Claim / PreAuth" subtitle="Find the patient and choose the insured visit. The claim opens with its diagnoses, care team and invoice lines filled in." footer={<Button onClick={onClose}>Cancel</Button>}>
      <label className="relative block">
        <span className="sr-only">Search patient or visit</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus className="pl-9" placeholder="Patient name, MRN, ID number or visit" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">{visits.length} insured visit{visits.length === 1 ? "" : "s"}{term ? " match" : ""}.</p>
      <ul className="mt-2 flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
        {visits.length === 0 && !cash.length && (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">
            {rows.length ? "No patient or visit matches. Try the MRN or the visit number." : "No insured visits yet. Register the patient with an insurance card first."}
          </li>
        )}
        {visits.map((r) => {
          const sent = sentOf(r);
          return (
            <li key={r.visit}>
              <button
                type="button"
                onClick={() => { onClose(); navigate("/claim", { visit: r.visit }); }}
                className={cn("flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{patientName(r.patient)}</span>
                  <span className="block text-xs text-muted-foreground">MRN {r.patient.mrn}, visit {r.visit}, {fmtDate(r.visitAt)}{sent ? `, claim ${r.m.fin.claim!.claimNumber}` : ""}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <BrandChip>{r.payer}</BrandChip>
                  <StatusChip status={r.status} />
                  <Sar value={r.m.net} className="text-sm font-semibold" />
                </span>
              </button>
            </li>
          );
        })}
        {cash.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{patientName(p)}</span>
              <span className="block text-xs text-muted-foreground">MRN {p.mrn}. Cash patient: no insurance on file, so visits are billed on the invoice, not by a claim.</span>
            </span>
            <Badge>Cash</Badge>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Logs Timeline of one visit, from Submitted Transactions. */
export function LogsDialog({ visit, onClose, title }: { visit: string | null; onClose: () => void; title?: string }) {
  const list = visit ? visitTimeline(visit) : [];
  return (
    <Dialog open={!!visit} onClose={onClose} title="Logs Timeline" subtitle={title ?? (visit ? `Every request and answer for visit ${visit}.` : undefined)} footer={<>
      <Button onClick={() => { onClose(); navigate("/transactions", { visit: visit ?? undefined }); }}>All Transactions</Button>
      <Button variant="primary" onClick={onClose}>Close</Button>
    </>}>
      <TxTimeline list={list} onOpen={(id) => { onClose(); navigate("/transaction", { id }); }} />
    </Dialog>
  );
}
