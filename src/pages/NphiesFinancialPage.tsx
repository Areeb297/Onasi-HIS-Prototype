import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Gate } from "@/components/emr/fhir-ui";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import {
  AUTH_FROM, caseOf, financialVisits, finActionFor, resetFinancial, runFinancial, setFinRejectNext, stepViews, useFinancial, type FinVisit, type StepView,
} from "@/lib/nphies-financial";
import { navigate } from "@/lib/router";
import { getMasterRows, useRecords } from "@/lib/records";
import { can, useSession } from "@/lib/session";
import { useHis, patientName } from "@/lib/store";

const sar = (n: number) => `${n.toLocaleString()} SAR`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function NphiesFinancialPage() {
  const his = useHis();
  const fin = useFinancial();
  useRecords();
  useSession();
  const dev = useDevMode();
  const allowed = can("billing");
  const [q, setQ] = React.useState("");
  const [cls, setCls] = React.useState("all");
  const [openVisit, setOpenVisit] = React.useState<string | null>(null);

  const visits = financialVisits().filter((v) => {
    if (cls !== "all" && v.enc.cls !== cls) return false;
    const text = `${patientName(v.patient)} ${v.patient.mrn} ${v.enc.visitNumber} ${v.payer}`.toLowerCase();
    return !q.trim() || text.includes(q.trim().toLowerCase());
  });
  const open = visits.find((v) => v.enc.visitNumber === openVisit) ?? null;
  const batches = getMasterRows("payment-reconciliations");
  void his;

  return (
    <div>
      <PageHeader
        title="NPHIES Financial"
        subtitle="Check coverage, ask for approval, send the claim and confirm the payment for each visit. Clinical items are sent from NPHIES Clinical. Nothing here is really sent: the payer answers are simulated."
        right={
          dev ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={fin.rejectNext} onChange={setFinRejectNext} label="Next answer is a refusal" />
                Next answer is a refusal
              </label>
              <Button variant="ghost" size="sm" onClick={() => { resetFinancial(); setOpenVisit(null); }} title="Clears every financial step and message">Reset Financial Demo Data</Button>
            </div>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardHeader
          title="Visits"
          subtitle="Pick a visit to work through its steps. Amounts are estimates from the orders on the visit."
          right={
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Visit Type" className="w-40">
                <Select value={cls} onChange={(e) => setCls(e.target.value)}>
                  <option value="all">All</option>
                  <option value="O">Outpatient</option>
                  <option value="E">Emergency</option>
                  <option value="I">Inpatient</option>
                </Select>
              </Field>
              <Field label="Search" className="w-52">
                <Input placeholder="Patient, MRN, visit or payer" value={q} onChange={(e) => setQ(e.target.value)} />
              </Field>
            </div>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>Payer</Th>
              <Th>Charge</Th>
              <Th>Eligibility</Th>
              <Th>Authorization</Th>
              <Th>Claim</Th>
              <Th>Payment</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {visits.length === 0 && <tr><Td colSpan={8}><Empty>No visits match.</Empty></Td></tr>}
            {visits.map((v) => {
              const views = stepViews(v.enc, fin);
              return (
                <tr key={v.enc.visitNumber} className={cn("hover:bg-muted/40", openVisit === v.enc.visitNumber && "bg-accent/40")}>
                  <Td>
                    <div className="font-semibold">{patientName(v.patient)}</div>
                    <div className="text-xs text-muted-foreground">{v.patient.mrn}{dev && ` · Visit ${v.enc.visitNumber}`}</div>
                  </Td>
                  <Td>{v.payer}</Td>
                  <Td className="whitespace-nowrap">{sar(v.charge.total)}</Td>
                  {views.map((s) => (
                    <Td key={s.step}><Badge tone={s.tone}>{s.status}</Badge></Td>
                  ))}
                  <Td>
                    <Button size="sm" variant={openVisit === v.enc.visitNumber ? "primary" : "secondary"} onClick={() => setOpenVisit(openVisit === v.enc.visitNumber ? null : v.enc.visitNumber)}>
                      {openVisit === v.enc.visitNumber ? "Close" : "Open Steps"}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {open && <VisitSteps v={open} allowed={allowed} dev={dev} />}

      <Card className="mt-4">
        <CardHeader
          title="Payment Batches From Payers"
          subtitle="Taken from the Payment Reconciliations list in RCM. A payer pays many claims in one batch."
          right={<Button size="sm" variant="secondary" onClick={() => navigate("/m/payment-reconciliations")}>Open Payment Reconciliations</Button>}
        />
        <Table>
          <thead>
            <tr><Th>Batch</Th><Th>Payer</Th><Th>Payment Date</Th><Th>Claimed</Th><Th>Paid</Th><Th>Difference</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {batches.length === 0 && <tr><Td colSpan={7}><Empty>No payment batches yet.</Empty></Td></tr>}
            {batches.map((b, i) => (
              <tr key={String(b.batchNo ?? i)}>
                <Td className="font-mono text-xs">{String(b.batchNo ?? "")}</Td>
                <Td>{String(b.payer ?? "")}</Td>
                <Td>{String(b.paymentDate ?? "")}</Td>
                <Td>{sar(Number(b.claimed ?? 0))}</Td>
                <Td>{sar(Number(b.paid ?? 0))}</Td>
                <Td className={Number(b.variance ?? 0) < 0 ? "text-destructive" : undefined}>{sar(Number(b.variance ?? 0))}</Td>
                <Td><Badge tone={b.status === "Paid" ? "ok" : b.status === "Review" ? "warn" : "neutral"}>{String(b.status ?? "")}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function VisitSteps({ v, allowed, dev }: { v: FinVisit; allowed: boolean; dev: boolean }) {
  const fin = useFinancial();
  const [showMsgs, setShowMsgs] = React.useState(false);
  const [msgSeq, setMsgSeq] = React.useState<number | null>(null);
  const visit = v.enc.visitNumber;
  const views = stepViews(v.enc, fin);
  const c = caseOf(visit, fin);
  const msg = c.messages.find((m) => m.seq === msgSeq);

  return (
    <Card>
      <CardHeader
        title={`${patientName(v.patient)}: Steps`}
        subtitle={`${v.payer}. Estimated charge ${sar(v.charge.total)}${v.authNeeded ? `. Approval is needed before the claim (inpatient, or ${sar(AUTH_FROM)} and above).` : ". No approval is needed before the claim."}`}
        right={
          dev ? (
            <Button size="sm" variant="ghost" onClick={() => setShowMsgs((x) => !x)} aria-expanded={showMsgs}>
              {showMsgs ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              Messages ({c.messages.length})
            </Button>
          ) : undefined
        }
      />
      <ol className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {views.map((s, i) => (
          <StepCard key={s.step} n={i + 1} s={s} allowed={allowed} visit={visit} />
        ))}
      </ol>
      <div className="border-t border-border px-4 py-3">
        <h3 className="mb-1 text-sm font-semibold">Charge</h3>
        <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
          {v.charge.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-3 border-b border-border/60 py-1"><span>{l.label}</span><span className="tabular-nums">{sar(l.amount)}</span></li>
          ))}
          <li className="flex justify-between gap-3 py-1 font-semibold"><span>Total</span><span className="tabular-nums">{sar(v.charge.total)}</span></li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Prices are made up for the demo.</p>
      </div>
      {dev && showMsgs && (
        <div className="border-t border-border px-4 py-3">
          <h3 className="mb-2 text-sm font-semibold">Messages</h3>
          {c.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet for this visit.</p>
          ) : (
            <Table>
              <thead><tr><Th>#</Th><Th>Time</Th><Th>Direction</Th><Th>Message</Th><Th>What It Says</Th><Th>Body</Th></tr></thead>
              <tbody>
                {c.messages.map((m) => (
                  <tr key={m.seq}>
                    <Td>{m.seq}</Td>
                    <Td className="whitespace-nowrap">{when(m.at)}</Td>
                    <Td><Badge tone={m.direction === "out" ? "info" : "neutral"}>{m.direction === "out" ? "Sent To NPHIES" : "Received"}</Badge></Td>
                    <Td className="font-mono text-xs">{m.kind}</Td>
                    <Td>{m.summary}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setMsgSeq(msgSeq === m.seq ? null : m.seq)}>{msgSeq === m.seq ? "Hide" : "Show"}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {msg && <div className="mt-3"><CodeBlock filename={`${visit}-${msg.kind}-${msg.seq}.json`} code={msg.json} maxHeight={360} /></div>}
          <p className="mt-2 text-xs text-muted-foreground">Assumption: message names follow the NPHIES Financial Services guide. The bodies are shortened and not checked against its profiles.</p>
        </div>
      )}
    </Card>
  );
}

function StepCard({ n, s, allowed, visit }: { n: number; s: StepView; allowed: boolean; visit: string }) {
  const first = finActionFor(s);
  const second = finActionFor(s, true);
  const reason = "Your role cannot do this. It needs the billing permission.";
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{n}. {s.label}</h3>
        <Badge tone={s.tone}>{s.status}</Badge>
      </div>
      <p className="min-h-10 text-xs text-muted-foreground">{s.hint}</p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        {first && s.action && (
          <Gate allowed={allowed} reason={reason}>
            <Button size="sm" variant="primary" disabled={!allowed} onClick={() => runFinancial(visit, first)}>{s.action}</Button>
          </Gate>
        )}
        {second && s.secondary && (
          <Gate allowed={allowed} reason={reason}>
            <Button size="sm" variant="secondary" disabled={!allowed} onClick={() => runFinancial(visit, second)}>{s.secondary.label}</Button>
          </Gate>
        )}
      </div>
    </li>
  );
}
