import * as React from "react";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { fmtDateTime } from "@/components/claims/RcmUi";
import { JsonViewer, OutcomeBadge, TxTimeline, TxTypeIcon } from "@/components/claims/TxParts";
import { Sar } from "@/components/invoice/InvoiceParts";
import { copyText } from "@/components/ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, Card, CardHeader, Empty } from "@/components/ui/primitives";
import { useFinancial, type FinMessage } from "@/lib/nphies-financial";
import { allTransactions, focalResource, formattedPayload, responseTimeText, TX_TYPE_LABEL, visitTimeline } from "@/lib/rcm-transactions";
import { navigate, useRoute } from "@/lib/router";
import { useSession } from "@/lib/session";
import { useHis } from "@/lib/store";

const KIND_LABEL: Record<string, string> = {
  "eligibility-request": "Eligibility Request", "eligibility-response": "Eligibility Response", "priorauth-request": "Prior Authorization Request",
  "priorauth-response": "Prior Authorization Response", "poll-request": "Poll Request", "cancel-request": "Cancel Request", "claim-request": "Claim Request",
  "claim-response": "Claim Response", "communication-request": "Communication Request", communication: "Communication", "payment-reconciliation": "Payment Reconciliation",
  "payment-notice": "Payment Notice",
};

function CopyId({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate font-mono text-xs">{value}</span>
      <button type="button" aria-label={`Copy ${label}`} onClick={async () => { if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1400); } }}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

/** The amount a message carries, if any: Claim total, PaymentReconciliation or PaymentNotice amount. */
function amountOf(msg: FinMessage | undefined): number | undefined {
  const r = msg && focalResource(msg);
  const pick = (k: string) => { const v = r?.[k] as { value?: unknown } | undefined; return typeof v?.value === "number" ? v.value : undefined; };
  return pick("total") ?? pick("paymentAmount") ?? pick("amount");
}

function MessageFacts({ msg, bundleId, direction, at }: { msg: FinMessage; bundleId: string; direction: string; at: string }) {
  const r = focalResource(msg) ?? {};
  const amount = amountOf(msg);
  const ref = (r.preAuthRef ?? r.identifier ?? r.request) as string | undefined;
  return (
    <dl className="grid grid-cols-2 gap-4 p-4">
      <Fact label="Message">{KIND_LABEL[msg.kind] ?? msg.kind}</Fact>
      <Fact label="Direction">{direction}</Fact>
      <Fact label="Time">{fmtDateTime(at)}</Fact>
      <div className="col-span-2 sm:col-span-1"><Fact label="Bundle Id"><CopyId value={bundleId} label="bundle id" /></Fact></div>
      <Fact label="Resource">{String(r.resourceType ?? "Not Named")}</Fact>
      {typeof r.outcome === "string" && <Fact label="Outcome Code"><span className="font-mono text-xs">{r.outcome}</span></Fact>}
      {typeof r.use === "string" && <Fact label="Use"><span className="capitalize">{r.use}</span></Fact>}
      {ref && <Fact label="Reference"><span className="font-mono text-xs">{ref}</span></Fact>}
      {amount !== undefined && <Fact label="Amount"><Sar value={amount} /></Fact>}
      <div className="col-span-2"><Fact label="Summary">{msg.summary}</Fact></div>
    </dl>
  );
}

/** One transaction: summary, request JSON, response JSON, and the visit's timeline: /transaction?id=V...-n */
export function TransactionDetailPage() {
  useFinancial();
  useHis();
  useSession();
  const { params } = useRoute();
  const id = params.get("id") ?? "";
  const [tab, setTab] = React.useState("summary");
  React.useEffect(() => setTab("summary"), [id]);
  const list = allTransactions();
  const tx = list.find((t) => t.id === id);
  if (!tx) {
    return (
      <Card>
        <Empty>
          This transaction was not found. <button type="button" className="font-medium text-foreground underline" onClick={() => navigate("/transactions")}>Open Submitted Transactions</button>
        </Empty>
      </Card>
    );
  }
  const timeline = visitTimeline(tx.visit, list);
  const at = timeline.findIndex((t) => t.id === tx.id);
  const prev = timeline[at - 1];
  const next = timeline[at + 1];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button size="sm" variant="ghost" className="mt-0.5 px-2" aria-label="Back to Submitted Transactions" onClick={() => navigate("/transactions")}><ArrowLeft className="size-4" /></Button>
          <span className="glass-icon mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-xl sm:flex"><TxTypeIcon type={tx.type} className="size-5" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{TX_TYPE_LABEL[tx.type]}{tx.focus ? `, ${tx.focus}` : ""}</h1>
              <OutcomeBadge tx={tx} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {tx.patientName}, MRN <span className="font-mono">{tx.mrn}</span>, visit <span className="font-mono">{tx.visit}</span>. Payer {tx.payer || "not named"}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!prev} onClick={() => prev && navigate("/transaction", { id: prev.id })}><ArrowLeft className="size-4" /> Earlier</Button>
          <Button size="sm" disabled={!next} onClick={() => next && navigate("/transaction", { id: next.id })}>Later <ArrowRight className="size-4" /></Button>
          <Button size="sm" onClick={() => navigate("/claim", { visit: tx.visit })}>Open Claim</Button>
        </div>
      </div>

      <dl className="glass-panel mb-4 grid grid-cols-2 gap-4 rounded-2xl px-4 py-3 lg:grid-cols-4">
        <Fact label="Bundle Id"><CopyId value={tx.bundleId} label="bundle id" /></Fact>
        <Fact label="Sent">{fmtDateTime(tx.sentAt)}</Fact>
        <Fact label="Answered">{tx.respondedAt ? fmtDateTime(tx.respondedAt) : "No Answer Message"}</Fact>
        <Fact label="Response Time">{responseTimeText(tx.responseMs)}</Fact>
      </dl>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
            <TabsTrigger value="summary" className="h-8 flex-none px-3">Summary</TabsTrigger>
            <TabsTrigger value="request" className="h-8 flex-none px-3">Request JSON</TabsTrigger>
            <TabsTrigger value="response" className="h-8 flex-none px-3">Response JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-2 flex flex-col gap-4">
            <Card className="px-4 py-3">
              <p className="text-sm">
                <span className="font-medium">{tx.request.summary}.</span>
                <span className="text-muted-foreground"> {tx.response ? "The answer:" : "No answer message is expected for this request."} </span>
                {tx.response && <span className="font-medium">{tx.response.summary}.</span>}
              </p>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Request" subtitle="Sent by the hospital to NPHIES." />
                <MessageFacts msg={tx.request} bundleId={tx.bundleId} direction="Hospital To NPHIES" at={tx.sentAt} />
              </Card>
              <Card>
                <CardHeader title="Response" subtitle="Returned by NPHIES for the payer." />
                {tx.response && tx.responseBundleId
                  ? <MessageFacts msg={tx.response} bundleId={tx.responseBundleId} direction="NPHIES To Hospital" at={tx.respondedAt!} />
                  : <Empty>No response message for this request.</Empty>}
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="request" className="mt-2">
            <JsonViewer json={formattedPayload(tx.request, tx.bundleId)} filename={`${tx.request.kind}-${tx.bundleId.slice(0, 8)}.json`} />
          </TabsContent>
          <TabsContent value="response" className="mt-2">
            <JsonViewer json={tx.response && tx.responseBundleId ? formattedPayload(tx.response, tx.responseBundleId) : undefined} filename={`${tx.response?.kind ?? "response"}-${(tx.responseBundleId ?? "none").slice(0, 8)}.json`} emptyText="No response message for this request." />
          </TabsContent>
        </Tabs>

        <aside className="min-w-0" aria-label="Claim timeline">
          <Card className="xl:sticky xl:top-[4.5rem]">
            <CardHeader title="Claim Timeline" subtitle={`Every request for visit ${tx.visit}, oldest first.`} />
            <div className="max-h-[70vh] overflow-y-auto p-3">
              <TxTimeline list={timeline} currentId={tx.id} onOpen={(i) => navigate("/transaction", { id: i })} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

