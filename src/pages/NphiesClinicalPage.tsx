import * as React from "react";
import { Eye, EyeOff, Send, SendHorizontal } from "lucide-react";
import { IconCircleCheck, IconCircleX, IconPencil, IconSend } from "@tabler/icons-react";
import { CellSub, DataTable, ListPage, ListToolbar, StatFilters, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { CodeBlock } from "@/components/ui/code-block";
import { NphiesLogo } from "@/components/NphiesLogo";
import { Badge } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { useDocs } from "@/lib/docs";
import { fmtShort } from "@/lib/format";
import { useLab } from "@/lib/lab";
import {
  GROUP_LABEL, STATE_LABEL, STATE_TONE, TYPE_LABEL, buildOutbox, countByGroup, lastMessage, mayAct, readyRows, sendAllReady, sendRow,
  type OutboxGroup, type OutboxRow, type SendState,
} from "@/lib/nphies-outbox";
import { useRad } from "@/lib/radiology";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { useVitals } from "@/lib/vitals";

const GROUPS: OutboxGroup[] = ["visit", "lab", "radiology", "medication", "vitals", "documents"];
const when = (iso?: string) => (iso ? fmtShort(iso) : "Never");

/** The status pill: a ready item that is not sent yet reads as ready, in the brand teal. */
const statePill = (r: OutboxRow) => <Badge tone={r.state === "not-sent" && r.ready ? "info" : STATE_TONE[r.state]}>{r.stateDetail}</Badge>;

export function NphiesClinicalPage() {
  // Subscribe to every store the list is built from, so the page updates when something is sent or changed.
  useHis(); useLab(); useRad(); useRx(); useVitals(); useDocs(); useSession();
  const dev = useDevMode();
  const [open, setOpen] = React.useState<string | null>(null);

  const all = buildOutbox();
  const counts = countByGroup(all);
  const tally = (s: SendState) => all.filter((r) => r.state === s).length;

  const filters: FilterDef<OutboxRow>[] = [
    { id: "group", label: "Type", quick: true, allLabel: `All Types (${counts.all})`, options: GROUPS.map((g) => ({ value: g, label: `${GROUP_LABEL[g]} (${counts[g]})` })), test: (r, v) => r.group === v },
    { id: "state", label: "Status", quick: true, options: [
      { value: "needs-action", label: "Needs Action" }, { value: "ready", label: "Ready To Send" },
      ...(Object.keys(STATE_LABEL) as SendState[]).map((s) => ({ value: s, label: STATE_LABEL[s] })),
    ], test: (r, v) => (v === "needs-action" ? r.state !== "sent" : v === "ready" ? r.state === "not-sent" && r.ready : r.state === v) },
  ];

  const columns: Column<OutboxRow>[] = [
    {
      id: "patient", header: "Patient", hideable: false, value: (r) => r.patient,
      cell: (r) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="font-semibold text-[#032c26] dark:text-foreground">{r.patient}</span>
          <span className="font-mono text-xs text-muted-foreground">{r.mrn}</span>
          {dev && <span className="font-mono text-xs text-muted-foreground">{r.visit}</span>}
        </span>
      ),
    },
    { id: "type", header: "Type", value: (r) => TYPE_LABEL[r.type], cell: (r) => <span className="whitespace-nowrap">{TYPE_LABEL[r.type]}</span> },
    { id: "item", header: "What Is Sent", value: (r) => r.item, cell: (r) => <span className="block max-w-md">{r.item}</span> },
    {
      id: "state", header: "Status", value: (r) => r.stateDetail,
      cell: (r) => <div className="min-w-32"><span title={!r.ready && r.state !== "sent" ? r.blocked : undefined}>{statePill(r)}</span>{!r.ready && r.state !== "sent" && <CellSub className="mt-0.5 max-w-xs">{r.blocked}</CellSub>}</div>,
    },
    { id: "last", header: "Last Sent", value: (r) => r.lastAt ?? "", csv: (r) => when(r.lastAt), cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.lastAt)}</span> },
  ];

  const list = useList({
    id: "nphies-clinical",
    title: "NPHIES Clinical",
    rows: all,
    columns,
    getId: (r) => r.key,
    filters,
    initialFilters: { state: "needs-action" },
    unit: ["item", "items"],
    search: (r) => `${r.patient} ${r.mrn} ${r.visit} ${r.item} ${TYPE_LABEL[r.type]}`,
  });
  const sendable = readyRows(list.sorted);

  function send(rows: OutboxRow[], label: string) {
    const out = sendAllReady(rows);
    const text = `Sent ${out.accepted}. Rejected ${out.rejected}.${out.skipped ? ` Not sent ${out.skipped}.` : ""}`;
    pushToast({ tone: out.rejected ? "warn" : "ok", text: `${label} finished.`, detail: text });
    list.clearSelection();
  }

  const actions = (r: OutboxRow): RowAction[] => {
    const out: RowAction[] = [];
    if (r.action) {
      const perm = can(r.perm);
      out.push({
        id: "send", label: r.action, icon: <SendHorizontal />, emphasis: r.action === "Send" && mayAct(r), danger: r.action === "Resend",
        disabled: !mayAct(r), title: perm ? (mayAct(r) ? undefined : r.blocked || "Not ready to send") : `Your role cannot send this. It needs the ${r.perm} permission.`,
        onClick: () => sendRow(r),
      });
    }
    if (dev) out.push({ id: "msg", label: open === r.key ? "Hide Message" : "Show Message", icon: open === r.key ? <EyeOff /> : <Eye />, onClick: () => setOpen(open === r.key ? null : r.key) });
    return out;
  };

  return (
    <ListPage
      mark={<NphiesLogo height={22} />}
      title="NPHIES Clinical"
      subtitle="Everything the clinical side sends to NPHIES, in one list. Responses are simulated."
      primary={can("patient.read") ? {
        label: `Send All Ready (${sendable.length})`, icon: <Send className="size-4" aria-hidden="true" />, disabled: sendable.length === 0,
        title: sendable.length ? "Sends every ready item in the list below" : "Nothing in this list is ready, or your role cannot send it",
        onClick: () => send(list.sorted, "Send all"),
      } : undefined}
      kpis={
        <StatFilters label="Send list by status" value={list.filterValues.state ?? ""} onChange={(v) => list.setFilter("state", v)} items={[
          { id: "ready", label: "Ready To Send", value: all.filter((r) => r.state === "not-sent" && r.ready).length, icon: <IconSend stroke={1.75} /> },
          { id: "changes", label: "Changes Not Sent", value: tally("changes"), icon: <IconPencil stroke={1.75} />, alert: true },
          { id: "rejected", label: "Rejected", value: tally("rejected"), icon: <IconCircleX stroke={1.75} />, alert: true },
          { id: "sent", label: "Sent", value: tally("sent"), icon: <IconCircleCheck stroke={1.75} /> },
        ]} />
      }
    >
      <ListToolbar list={list} placeholder="Patient, MRN or item" />
      <DataTable
        list={list}
        label="NPHIES send list"
        rowLabel={(r) => `${r.patient}, ${r.item}`}
        actions={actions}
        selectable
        bulk={[{ label: "Send Selected", icon: <Send aria-hidden="true" />, onClick: (rows) => send(rows, "Send selected"), disabled: !can("patient.read") }]}
        expanded={dev ? (r) => {
          if (open !== r.key) return null;
          const msg = lastMessage(r);
          return msg ? (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Newest message for this item ({msg.format}), sent {when(msg.at)}.</p>
              <CodeBlock filename={msg.filename} code={msg.text} maxHeight={360} />
            </div>
          ) : <p className="py-2 text-sm text-muted-foreground">Nothing has been sent for this item yet.</p>;
        } : undefined}
        card={(r) => ({
          title: r.patient,
          aside: statePill(r),
          lines: [<span key="a">{TYPE_LABEL[r.type]}: {r.item}</span>, <span key="b" className="tabular-nums">Last sent {when(r.lastAt)}</span>],
        })}
        empty={{
          icon: <Send />,
          title: "Nothing To Send Yet",
          text: "Items appear as ready once they are complete, for example a lab order after the specimen is collected.",
        }}
      />
    </ListPage>
  );
}
