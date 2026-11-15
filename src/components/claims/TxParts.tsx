import * as React from "react";
import { IconCash, IconCircleX, IconFileInvoice, IconMessageCircle, IconRefresh, IconShieldCheck, IconUserCheck } from "@tabler/icons-react";
import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download } from "lucide-react";
import { copyText, downloadText } from "@/components/ui/code-block";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { responseTimeText, TX_TYPE_LABEL, type RcmTransaction, type TxType } from "@/lib/rcm-transactions";
import { fmtDate, fmtTime } from "./RcmUi";

const TYPE_ICON: Record<TxType, typeof IconCash> = {
  eligibility: IconUserCheck, priorauth: IconShieldCheck, claim: IconFileInvoice, communication: IconMessageCircle, poll: IconRefresh, cancel: IconCircleX, "payment-notice": IconCash,
};

export function TxTypeIcon({ type, className }: { type: TxType; className?: string }) {
  const Icon = TYPE_ICON[type];
  return <Icon className={cn("size-4", className)} stroke={1.75} aria-hidden="true" />;
}

/** Request type as an icon tile and its name. */
export function TxTypeCell({ tx }: { tx: RcmTransaction }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="glass-icon flex size-7 shrink-0 items-center justify-center rounded-lg"><TxTypeIcon type={tx.type} /></span>
      <span className="min-w-0">
        <span className="block font-medium leading-tight">{TX_TYPE_LABEL[tx.type]}</span>
        {tx.focus && <span className="block text-xs text-muted-foreground">{tx.focus}</span>}
      </span>
    </span>
  );
}

export function OutcomeBadge({ tx }: { tx: Pick<RcmTransaction, "outcome"> }) {
  return <Badge tone={tx.outcome.tone}>{tx.outcome.label}</Badge>;
}

/**
 * The visit's requests and answers, oldest first. Each entry opens its transaction. The current one is marked.
 */
export function TxTimeline({ list, currentId, onOpen, className }: { list: RcmTransaction[]; currentId?: string; onOpen: (id: string) => void; className?: string }) {
  if (!list.length) return <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing has been sent to NPHIES for this visit yet.</p>;
  return (
    <ol className={cn("relative flex flex-col", className)} aria-label="Transactions of this visit">
      {list.map((t, i) => {
        const current = t.id === currentId;
        return (
          <li key={t.id} className="relative flex gap-3 pb-3 last:pb-0">
            {i < list.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
            <span aria-hidden="true" className={cn("relative z-10 mt-1 flex size-[31px] shrink-0 items-center justify-center rounded-full border",
              current ? "border-[#03c1ac] bg-[#032c26] text-[#39edd5]" : "border-border bg-card text-muted-foreground")}>
              <TxTypeIcon type={t.type} />
            </span>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              aria-current={current ? "true" : undefined}
              className={cn("min-w-0 flex-1 rounded-xl border px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                current ? "border-[#03c1ac]/60 bg-[#39edd5]/10" : "border-transparent hover:border-border hover:bg-muted/60")}
            >
              <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{TX_TYPE_LABEL[t.type]}{t.focus ? `, ${t.focus}` : ""}</span>
                <OutcomeBadge tx={t} />
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {fmtDate(t.sentAt)} at {fmtTime(t.sentAt)}. {t.response ? `Answered in ${responseTimeText(t.responseMs).toLowerCase()}.` : "No answer message."}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- JSON viewer ---------- */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function Scalar({ value }: { value: Json }) {
  if (value === null) return <span className="text-cancel">null</span>;
  if (typeof value === "string") return <span className="break-all text-[#1d63d8] dark:text-[#7db5ff]">"{value}"</span>;
  if (typeof value === "number") return <span className="text-warn">{value}</span>;
  return <span className="text-cancel">{String(value)}</span>;
}

const KeyName = ({ name }: { name?: string }) => (name === undefined ? null : <><span className="text-[#035d53] dark:text-[#39edd5]">"{name}"</span><span className="text-muted-foreground">: </span></>);

function JsonNode({ name, value, depth, last, openTo }: { name?: string; value: Json; depth: number; last: boolean; openTo: number }) {
  const pad = { paddingLeft: `${depth * 1.1 + 1.25}rem` };
  const comma = last ? null : <span className="text-muted-foreground">,</span>;
  if (value === null || typeof value !== "object") {
    return <div style={pad} className="pr-4">{<KeyName name={name} />}<Scalar value={value} />{comma}</div>;
  }
  const isArray = Array.isArray(value);
  const items: [string | undefined, Json][] = isArray ? (value as Json[]).map((v) => [undefined, v]) : Object.entries(value as Record<string, Json>);
  const [o, c] = isArray ? ["[", "]"] : ["{", "}"];
  if (!items.length) return <div style={pad} className="pr-4"><KeyName name={name} /><span className="text-muted-foreground">{o}{c}</span>{comma}</div>;
  return (
    <details open={depth < openTo}>
      <summary
        style={{ paddingLeft: `${depth * 1.1 + 0.25}rem` }}
        className="flex cursor-pointer list-none items-center pr-4 hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight aria-hidden="true" className="me-1 size-3.5 shrink-0 text-muted-foreground transition-transform [[open]>summary>&]:rotate-90" />
        <span><KeyName name={name} /><span className="text-muted-foreground">{o}</span></span>
        <span className="text-muted-foreground [[open]>summary>&]:hidden"> {items.length} {isArray ? (items.length === 1 ? "item" : "items") : (items.length === 1 ? "field" : "fields")} {c}{last ? "" : ","}</span>
      </summary>
      {items.map(([k, v], i) => <JsonNode key={k ?? i} name={k} value={v} depth={depth + 1} last={i === items.length - 1} openTo={openTo} />)}
      <div style={pad} className="pr-4 text-muted-foreground">{c}{comma}</div>
    </details>
  );
}

/** Formatted JSON with fold arrows, Expand All, Collapse All, Copy and Download. Falls back to plain text if it does not parse. */
export function JsonViewer({ json, filename, emptyText = "No message." }: { json?: string; filename: string; emptyText?: string }) {
  const [openTo, setOpenTo] = React.useState(6);
  const [version, setVersion] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  if (!json) return <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  let parsed: Json | undefined;
  try { parsed = JSON.parse(json) as Json; } catch { parsed = undefined; }
  const setAll = (n: number) => { setOpenTo(n); setVersion((v) => v + 1); };
  const copy = async () => { if (await copyText(json)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } };
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{filename}</span>
        <span className="flex flex-wrap items-center gap-1">
          {parsed !== undefined && <>
            <Button size="sm" variant="ghost" onClick={() => setAll(99)}><ChevronsUpDown className="size-3.5" /> Expand All</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(1)}><ChevronsDownUp className="size-3.5" /> Collapse All</Button>
          </>}
          <Button size="sm" variant="ghost" onClick={() => downloadText(filename, json)}><Download className="size-3.5" /> Download</Button>
          <Button size="sm" variant="ghost" onClick={copy} aria-live="polite">{copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}</Button>
        </span>
      </figcaption>
      <div className="max-h-[32rem] overflow-auto py-2 font-mono text-[0.8125rem] leading-[1.65]">
        {parsed === undefined
          ? <pre className="whitespace-pre-wrap px-4">{json}</pre>
          : <div key={version} className="min-w-max"><JsonNode value={parsed} depth={0} last openTo={openTo} /></div>}
      </div>
    </figure>
  );
}
