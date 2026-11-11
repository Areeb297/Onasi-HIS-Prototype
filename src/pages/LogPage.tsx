import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Download, Trash2 } from "lucide-react";
import { EventBadge } from "@/components/badges";
import { ChecksList } from "@/components/MessagePanel";
import { CodeBlock, copyText, downloadText } from "@/components/ui/code-block";
import { Badge, Button, Card, Empty, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { pretty } from "@/lib/hl7";
import type { LogEntry } from "@/lib/model";
import { EVENTS, eventLabel } from "@/lib/spec";
import { clearLog, resetAll, useHis } from "@/lib/store";

function fileName(m: LogEntry) {
  return `${eventLabel(m.eventId).replace(" ", "_")}_${m.controlId}.hl7`;
}

export function LogPage() {
  const state = useHis();
  const [source, setSource] = React.useState<"all" | "mine" | "seed">("all");
  const [event, setEvent] = React.useState("all");
  const [open, setOpen] = React.useState<number | null>(null);
  const [copied, setCopied] = React.useState<number | null>(null);

  const rows = [...state.log]
    .reverse()
    .filter((m) => (source === "all" ? true : source === "seed" ? m.source === "seed" : m.source !== "seed"))
    .filter((m) => event === "all" || m.eventId === event);

  async function copy(m: LogEntry) {
    await copyText(m.message);
    setCopied(m.seq);
    setTimeout(() => setCopied(null), 1200);
  }

  function downloadAll() {
    const text = [...rows].reverse().map((m) => m.message).join("\r\n\r\n");
    downloadText("adt_messages.hl7", text);
  }

  return (
    <div>
      <PageHeader
        title="Message Log"
        subtitle="Every message the app built. Nothing is sent to NPHIES. Copy a message or download it as an .hl7 text file."
        right={
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={downloadAll} disabled={rows.length === 0}>
              <Download className="size-4" />
              Download All
            </Button>
            <Button variant="danger" onClick={() => confirm("Clear every message in the log?") && clearLog()} disabled={state.log.length === 0}>
              <Trash2 className="size-4" />
              Clear Log
            </Button>
            <Button variant="danger" onClick={() => confirm("Reset all patients, visits and messages to the demo data?") && resetAll()}>
              Reset Demo Data
            </Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-48" value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Source">
          <option value="all">All Messages</option>
          <option value="mine">Sent By Me Or The Runner</option>
          <option value="seed">Demo Data Only</option>
        </Select>
        <Select className="w-56" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
          <option value="all">All Events</option>
          {EVENTS.map((e) => (
            <option key={e.id} value={e.id}>{eventLabel(e.id)} {e.name}</option>
          ))}
        </Select>
        <span className="self-center text-xs text-muted-foreground">{rows.length} of {state.log.length} messages</span>
      </div>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th>Message ID</Th>
              <Th>Event</Th>
              <Th>Patient</Th>
              <Th>Visit</Th>
              <Th>Sent</Th>
              <Th>Checks</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={8}><Empty>No messages yet. Send one from the Events menu or run a flow.</Empty></Td></tr>
            )}
            {rows.map((m) => (
              <React.Fragment key={m.seq}>
                <tr className="hover:bg-muted/40">
                  <Td>
                    <button aria-label="Show message" onClick={() => setOpen(open === m.seq ? null : m.seq)} className="text-muted-foreground">
                      {open === m.seq ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  </Td>
                  <Td className="font-mono text-xs">{m.controlId}</Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <EventBadge id={m.eventId} />
                      <span className="text-xs text-muted-foreground">{m.source === "seed" ? "Demo" : m.source === "runner" ? "Runner" : "Manual"}</span>
                    </span>
                  </Td>
                  <Td>{m.patientName}</Td>
                  <Td className="font-mono text-xs">{m.visitNumber}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{new Date(m.sentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</Td>
                  <Td>
                    {m.errors ? <Badge tone="danger">{m.errors} Errors</Badge> : m.warnings ? <Badge tone="warn">{m.warnings} Warnings</Badge> : <Badge tone="ok">Pass</Badge>}
                  </Td>
                  <Td className="text-right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => copy(m)}>
                        <Copy className="size-3.5" />
                        {copied === m.seq ? "Copied" : "Copy"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => downloadText(fileName(m), m.message)}>
                        <Download className="size-3.5" />
                        .hl7
                      </Button>
                    </span>
                  </Td>
                </tr>
                {open === m.seq && (
                  <tr>
                    <Td colSpan={8} className="bg-muted/30">
                      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                        <CodeBlock filename={fileName(m)} code={pretty(m.message)} />
                        <ChecksList checks={m.checks} />
                      </div>
                    </Td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
