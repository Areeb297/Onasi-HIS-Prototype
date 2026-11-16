import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Download, FileText, RotateCcw, Trash2 } from "lucide-react";
import { EventBadge } from "@/components/badges";
import { ChecksList } from "@/components/MessagePanel";
import { DataTable, ListPage, ListToolbar, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { CodeBlock, copyText, downloadText } from "@/components/ui/code-block";
import { Badge } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import { fmtDateTime } from "@/lib/format";
import { pretty } from "@/lib/hl7";
import type { LogEntry } from "@/lib/model";
import { EVENTS, eventLabel } from "@/lib/spec";
import { clearLog, resetAll, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

function fileName(m: LogEntry) {
  return `${eventLabel(m.eventId).replace(" ", "_")}_${m.controlId}.hl7`;
}
const sourceText = (m: LogEntry) => (m.source === "seed" ? "Demo" : m.source === "runner" ? "Runner" : "Manual");
const checksText = (m: LogEntry) => (m.errors ? `${m.errors} Errors` : m.warnings ? `${m.warnings} Warnings` : "Pass");

/** Every HL7 message the app built. Developer View only. */
export function LogPage() {
  const state = useHis();
  const [open, setOpen] = React.useState<number | null>(null);
  const rows = [...state.log].reverse();

  const filters: FilterDef<LogEntry>[] = [
    { id: "source", label: "Source", quick: true, options: [{ value: "mine", label: "Sent By Me Or The Runner" }, { value: "seed", label: "Demo Data Only" }],
      test: (m, v) => (v === "seed" ? m.source === "seed" : m.source !== "seed") },
    { id: "event", label: "Event", quick: true, options: EVENTS.map((e) => ({ value: e.id, label: `${eventLabel(e.id)} ${e.name}` })), test: (m, v) => m.eventId === v },
    { id: "checks", label: "Checks", options: [{ value: "errors", label: "Errors" }, { value: "warnings", label: "Warnings" }, { value: "pass", label: "Pass" }],
      test: (m, v) => (v === "errors" ? !!m.errors : v === "warnings" ? !m.errors && !!m.warnings : !m.errors && !m.warnings) },
  ];
  const columns: Column<LogEntry>[] = [
    {
      id: "id", header: "Message ID", hideable: false, value: (m) => m.controlId,
      cell: (m) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {open === m.seq ? <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          <span className="font-mono text-xs">{m.controlId}</span>
        </span>
      ),
    },
    { id: "event", header: "Event", value: (m) => eventLabel(m.eventId), cell: (m) => <EventBadge id={m.eventId} /> },
    { id: "source", header: "Source", value: sourceText, cell: (m) => <span className="text-muted-foreground">{sourceText(m)}</span> },
    { id: "patient", header: "Patient", value: (m) => m.patientName, cell: (m) => <span className="whitespace-nowrap">{m.patientName}</span> },
    { id: "visit", header: "Visit", value: (m) => m.visitNumber, cell: (m) => <span className="font-mono text-xs whitespace-nowrap">{m.visitNumber}</span> },
    { id: "sent", header: "Sent", value: (m) => m.sentAt, csv: (m) => fmtDateTime(m.sentAt), cell: (m) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(m.sentAt)}</span> },
    { id: "checks", header: "Checks", value: checksText, cell: (m) => <Badge tone={m.errors ? "danger" : m.warnings ? "warn" : "ok"}>{checksText(m)}</Badge> },
  ];
  const list = useList({
    id: "message-log",
    title: "Message Log",
    rows,
    columns,
    getId: (m) => String(m.seq),
    filters,
    initialSort: { key: "sent", dir: "desc" },
    pageSize: 50,
    unit: ["message", "messages"],
    search: (m) => `${m.controlId} ${m.patientName} ${m.visitNumber} ${eventLabel(m.eventId)}`,
  });

  // HL7 messages carry patient details, so a copy is audited like a download (downloadText audits downloads).
  async function copy(m: LogEntry) {
    await copyText(m.message);
    audit("export", `HL7 message ${m.controlId}`, { patient: m.patientName, detail: `Visit ${m.visitNumber}. Copied` });
    pushToast({ tone: "ok", text: "Message copied.", detail: m.controlId });
  }
  const downloadAll = (list: LogEntry[]) => {
    downloadText("adt_messages.hl7", [...list].reverse().map((m) => m.message).join("\r\n\r\n"), `${list.length} HL7 message(s)`);
  };
  const downloadOne = (m: LogEntry) => downloadText(fileName(m), m.message, `HL7 message ${m.controlId}, visit ${m.visitNumber}, ${m.patientName}`);

  const actions = (m: LogEntry): RowAction[] => [
    { id: "copy", label: "Copy Message", icon: <Copy />, onClick: () => copy(m) },
    { id: "hl7", label: "Download .hl7", icon: <Download />, onClick: () => downloadOne(m) },
  ];

  return (
    <ListPage
      title="Message Log"
      subtitle="Every message the app built. Nothing is sent to NPHIES."
      primary={{ label: "Download All", icon: <Download className="size-4" aria-hidden="true" />, disabled: list.sorted.length === 0, onClick: () => downloadAll(list.sorted) }}
      more={[
        { label: "Clear Log", icon: <Trash2 className="size-4" />, danger: true, disabled: state.log.length === 0, onClick: () => { if (confirm("Clear every message in the log?")) clearLog(); } },
        { label: "Reset Demo Data", icon: <RotateCcw className="size-4" />, danger: true, onClick: () => { if (confirm("Reset all patients, visits and messages to the demo data?")) resetAll(); } },
      ]}
    >
      <ListToolbar list={list} placeholder="Message ID, patient or visit" />
      <DataTable
        list={list}
        label="HL7 messages"
        rowLabel={(m) => `message ${m.controlId}`}
        onRowClick={(m) => setOpen(open === m.seq ? null : m.seq)}
        actions={actions}
        selectable
        bulk={[{ label: "Download .hl7", icon: <Download aria-hidden="true" />, onClick: downloadAll }]}
        expanded={(m) => open === m.seq ? (
          <div className="grid gap-4 py-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <CodeBlock filename={fileName(m)} code={pretty(m.message)} />
            <ChecksList checks={m.checks} />
          </div>
        ) : null}
        card={(m) => ({
          title: <span className="flex items-center gap-2"><EventBadge id={m.eventId} />{m.patientName}</span>,
          aside: <Badge tone={m.errors ? "danger" : m.warnings ? "warn" : "ok"}>{checksText(m)}</Badge>,
          lines: [<span key="a" className="font-mono text-xs">{m.controlId}, {m.visitNumber}</span>, <span key="b" className="tabular-nums">{fmtDateTime(m.sentAt)}, {sourceText(m)}</span>],
        })}
        empty={{ icon: <FileText />, title: "No Messages Yet", text: "Send a message from the Events menu or run a flow, and each one is listed here." }}
      />
    </ListPage>
  );
}
