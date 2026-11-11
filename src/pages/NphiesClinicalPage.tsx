import * as React from "react";
import { Eye, EyeOff, Send } from "lucide-react";
import { Gate } from "@/components/emr/fhir-ui";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { useDocs } from "@/lib/docs";
import { useLab } from "@/lib/lab";
import {
  GROUP_LABEL, STATE_LABEL, STATE_TONE, TYPE_LABEL, buildOutbox, countByGroup, filterOutbox, lastMessage, mayAct, readyRows, sendAllReady, sendRow,
  type OutboxGroup, type OutboxRow, type SendState,
} from "@/lib/nphies-outbox";
import { useRad } from "@/lib/radiology";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { useVitals } from "@/lib/vitals";

const GROUPS: (OutboxGroup | "all")[] = ["all", "visit", "lab", "radiology", "medication", "vitals", "documents"];
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export function NphiesClinicalPage() {
  // Subscribe to every store the list is built from, so the page updates when something is sent or changed.
  useHis(); useLab(); useRad(); useRx(); useVitals(); useDocs(); useSession();
  const dev = useDevMode();
  const [group, setGroup] = React.useState<OutboxGroup | "all">("all");
  const [state, setState] = React.useState<SendState | "all" | "needs-action">("needs-action");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState("");

  const all = buildOutbox();
  const counts = countByGroup(all);
  const rows = filterOutbox(all, { group, state, query: q });
  const sendable = readyRows(rows);
  const tally = (s: SendState) => all.filter((r) => r.state === s).length;
  const readyNow = all.filter((r) => r.state === "not-sent" && r.ready).length;

  function sendOne(r: OutboxRow) {
    setSummary("");
    sendRow(r);
  }

  function sendEverything() {
    const out = sendAllReady(rows);
    const text = `Sent ${out.accepted}. Rejected ${out.rejected}.${out.skipped ? ` Not sent ${out.skipped}.` : ""}`;
    setSummary(text);
    pushToast({ tone: out.rejected ? "warn" : "ok", text: "Send all finished.", detail: text });
  }

  return (
    <div>
      <PageHeader
        title="NPHIES Clinical"
        subtitle="Everything the clinical side sends to NPHIES, in one list: visit updates, lab, radiology, medication, vital signs and clinical documents. Items appear as ready once they are complete, for example a lab order after the specimen is collected."
        right={
          <Gate allowed={sendable.length > 0 || !can("patient.read")} reason="Nothing in this list is ready, or your role cannot send it.">
            <Button variant="primary" disabled={sendable.length === 0} onClick={sendEverything} title="Sends every ready item in the list below. Responses are simulated.">
              <Send className="size-4" />
              Send All Ready ({sendable.length})
            </Button>
          </Gate>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ready To Send" value={readyNow} tone="neutral" />
        <Stat label="Changes Not Sent" value={tally("changes")} tone="warn" />
        <Stat label="Rejected" value={tally("rejected")} tone="danger" />
        <Stat label="Sent" value={tally("sent")} tone="ok" />
      </div>

      <Card>
        <CardHeader
          title="Send List"
          subtitle={summary || "Nothing is really sent. The responses are simulated, like the rest of this app."}
          right={
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Status" className="w-44">
                <Select value={state} onChange={(e) => setState(e.target.value as SendState | "all" | "needs-action")}>
                  <option value="needs-action">Needs Action</option>
                  <option value="all">All</option>
                  {(Object.keys(STATE_LABEL) as SendState[]).map((s) => (
                    <option key={s} value={s}>{STATE_LABEL[s]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Search" className="w-52">
                <Input placeholder="Patient, MRN or visit" value={q} onChange={(e) => setQ(e.target.value)} />
              </Field>
            </div>
          }
        />
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3" role="group" aria-label="Filter by type">
          {GROUPS.map((g) => (
            <Button key={g} size="sm" variant={group === g ? "primary" : "secondary"} aria-pressed={group === g} onClick={() => setGroup(g)}>
              {g === "all" ? "All" : GROUP_LABEL[g]} ({counts[g]})
            </Button>
          ))}
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>What Is Sent</Th>
              <Th>Status</Th>
              <Th>Last Sent</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={5}><Empty>{state === "needs-action" ? "Nothing needs to be sent. Choose All to see items already sent." : "No items match."}</Empty></Td></tr>
            )}
            {rows.map((r) => {
              const msg = dev && open === r.key ? lastMessage(r) : null;
              return (
                <React.Fragment key={r.key}>
                  <tr className={cn("hover:bg-muted/40", open === r.key && "bg-accent/40")}>
                    <Td>
                      <div className="font-semibold">{r.patient}</div>
                      <div className="text-xs text-muted-foreground">{r.mrn}{dev && ` · Visit ${r.visit}`}</div>
                    </Td>
                    <Td>
                      <Badge tone="neutral">{TYPE_LABEL[r.type]}</Badge>
                      <div className="mt-1 max-w-md text-sm">{r.item}</div>
                    </Td>
                    <Td>
                      <Badge tone={r.state === "not-sent" && r.ready ? "info" : STATE_TONE[r.state]}>{r.stateDetail}</Badge>
                      {!r.ready && r.state !== "sent" && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{r.blocked}</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{when(r.lastAt)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.action && (
                          <Gate allowed={can(r.perm)} reason={`Your role cannot send this. It needs the ${r.perm} permission.`}>
                            <Button size="sm" variant={r.action === "Resend" ? "danger" : "primary"} disabled={!mayAct(r)} onClick={() => sendOne(r)}>
                              {r.action}
                            </Button>
                          </Gate>
                        )}
                        {dev && (
                          <Button size="sm" variant="ghost" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
                            {open === r.key ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            Message
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                  {dev && open === r.key && (
                    <tr>
                      <Td colSpan={5}>
                        {msg ? (
                          <div>
                            <p className="mb-2 text-xs text-muted-foreground">Newest message for this item ({msg.format}), sent {when(msg.at)}.</p>
                            <CodeBlock filename={msg.filename} code={msg.text} maxHeight={360} />
                          </div>
                        ) : (
                          <p className="py-2 text-sm text-muted-foreground">Nothing has been sent for this item yet.</p>
                        )}
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "neutral" | "ok" | "warn" | "danger" }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "danger" && "text-destructive")}>{value}</div>
    </Card>
  );
}
