import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import { Dialog as BaseDialog } from "@/components/Dialog";
import { Money } from "@/components/Money";
import { GlassBackdrop, GlassPillSwitch } from "@/components/ui/glass";
import { Badge, Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useClaims } from "@/lib/claims";
import { useInvoices } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { allClaims, CONTACT_MEDIUMS, CONTACT_OUTCOMES, useRcm, type HistoryEntry, type Note, type NoteInput, type RcmClaim, type Res } from "@/lib/rcm-cases";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { fmtDate, fmtDateTime } from "@/lib/format";

/**
 * Shared parts of the RCM case screens (rejections, denials, FWA, AR, reconciliation, import): page top, filter bar,
 * worklist plus case panel, the claim money bar, notes and history, and the small action dialogs.
 * Onasi brand: dark green #032C26 for ink and the selected row, cyan #39EDD5 with #03C1AC and #035D53 for accents.
 * Status colours appear only on status badges.
 */

/** The Onasi dark green for the main action of a panel or dialog. */
export const BRAND = "bg-[#032c26] text-white hover:bg-[#035d53] hover:brightness-100 dark:bg-[#39edd5] dark:text-[#032c26] dark:hover:bg-[#03c1ac]";

/**
 * The app dialog, rendered on the page body. The case panel is frosted glass (backdrop-filter), which would otherwise
 * become the containing block of the fixed dialog and trap it inside the panel.
 */
export function Dialog(props: React.ComponentProps<typeof BaseDialog>) {
  return props.open ? createPortal(<BaseDialog {...props} />, document.body) : null;
}

/* ---------- data ---------- */

/** Subscribes to every store the RCM screens read, and returns the claims once per change. */
export function useRcmData() {
  const s = useRcm();
  const fin = useFinancial();
  const inv = useInvoices();
  const his = useHis();
  const drafts = useClaims();
  const lab = useLab();
  const rx = useRx();
  const session = useSession();
  const claims = React.useMemo(() => allClaims(s, fin), [s, fin, inv, his, drafts, lab, rx]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = React.useMemo(() => new Date(), [s, fin, inv]); // eslint-disable-line react-hooks/exhaustive-deps
  return { s, fin, inv, his, claims, today, allowed: can("billing"), user: session.user.name };
}

/** Runs an action; a refusal shows its reasons as a toast. Returns true when it worked. */
export function run(r: Res, okText?: string): boolean {
  if (r.ok) { if (okText) pushToast({ tone: "ok", text: okText }); return true; }
  pushToast({ tone: "warn", text: r.errors[0], detail: r.errors.slice(1).join(" ") || undefined });
  return false;
}

export const fmtDay = (d?: string) => (d ? fmtDate(d.length === 10 ? `${d}T00:00:00` : d) : "");
export const fmtTime = (d: string) => fmtDateTime(d);

/* ---------- page frame ---------- */

export function RcmPage({ title, subtitle, right, children }: { title: string; subtitle: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <GlassBackdrop>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[#032c26] dark:text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {right}
      </div>
      {children}
    </GlassBackdrop>
  );
}

export function Toolbar({ query, onQuery, placeholder, status, statuses, onStatus, payer, onPayer, payers, count, unit = ["case", "cases"], children }: {
  query: string; onQuery: (v: string) => void; placeholder: string; unit?: [string, string];
  status?: string; statuses?: readonly string[]; onStatus?: (v: string) => void;
  payer?: string; onPayer?: (v: string) => void; payers?: readonly string[];
  count: number; children?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="glass-card my-4 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-2xl px-3 py-2.5 sm:px-4" role="group" aria-label="Filters">
      <label className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
        <span className="sr-only">Search</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} className="h-8 rounded-full pl-8" />
      </label>
      {statuses && status !== undefined && onStatus && <GlassPillSwitch size="sm" label="Status" value={status} options={statuses} onChange={onStatus} />}
      {payers && payer !== undefined && onPayer && (
        <span className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-[0.8125rem] text-muted-foreground">Payer</label>
          <select id={id} value={payer} onChange={(e) => onPayer(e.target.value)} className="glass-pill h-8 rounded-full pl-2.5 pr-7 text-[0.8125rem] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring dark:[color-scheme:dark]">
            <option value="">All Payers</option>
            {payers.map((p) => <option key={p}>{p}</option>)}
          </select>
        </span>
      )}
      {children}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">{count} {count === 1 ? unit[0] : unit[1]}</span>
    </div>
  );
}

/**
 * The worklist and the case panel side by side on a wide screen. Below the lg breakpoint the panel opens over the list
 * as a full-screen sheet with a Back button, so a phone shows one thing at a time.
 */
export function SplitView({ list, panel, open, onClose, label }: { list: React.ReactNode; panel: React.ReactNode; open: boolean; onClose: () => void; label: string }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && window.matchMedia("(max-width: 1023px)").matches) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
      <div className="min-w-0">{list}</div>
      <aside aria-label={label} className={cn(
        "min-w-0 lg:sticky lg:top-4 lg:block",
        open ? "fixed inset-0 z-40 overflow-y-auto bg-background p-3 lg:static lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0" : "hidden",
      )}>
        {open && (
          <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={onClose}><ArrowLeft className="size-4" aria-hidden="true" /> Back To The List</Button>
        )}
        {panel}
      </aside>
    </div>
  );
}

/** A clickable worklist row: Enter or Space opens it, the selected row carries a dark green rail. */
export function RowButton({ selected, onOpen, children, label }: { selected: boolean; onOpen: () => void; children: React.ReactNode; label: string }) {
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        selected && "bg-[#39edd5]/10 shadow-[inset_3px_0_0_#032c26] dark:shadow-[inset_3px_0_0_#39edd5]",
      )}
    >
      {children}
    </tr>
  );
}

export function ListCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel overflow-hidden rounded-2xl">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3">
        <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </header>
      {children}
    </section>
  );
}

/* ---------- case panel ---------- */

export function Panel({ eyebrow, title, badge, sub, children, actions }: { eyebrow: string; title: string; badge?: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="glass-panel overflow-hidden rounded-2xl">
      <header className="border-b border-border/70 bg-[linear-gradient(120deg,rgba(57,237,213,0.10),transparent_60%)] px-4 pb-3 pt-3.5">
        <p className="text-xs font-medium text-[#035d53] dark:text-[#39edd5]">{eyebrow}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight tabular-nums text-[#032c26] dark:text-foreground">{title}</h2>
          {badge}
        </div>
        {sub && <div className="mt-1 text-[0.8125rem] text-muted-foreground">{sub}</div>}
      </header>
      {actions && <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3">{actions}</div>}
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <div className="glass-panel hidden rounded-2xl px-6 py-14 text-center text-sm text-muted-foreground lg:block">{children}</div>;
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[0.8125rem] font-semibold text-foreground">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem]">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="truncate font-medium">{v || <span className="text-muted-foreground">Not Set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The claim's money in one bar: paid, approved and still owed, the patient's share, and what the payer did not pay.
 * Each part is also written under the bar, so nothing depends on colour.
 */
export function LedgerBar({ claim }: { claim: Pick<RcmClaim, "claimed" | "approved" | "paid" | "patientShare" | "denied" | "state"> }) {
  const total = Math.max(claim.claimed, 0.01);
  const rejected = claim.state === "Rejected" || claim.state === "Submitted";
  const parts = rejected
    ? [{ key: "held", label: claim.state === "Rejected" ? "Held By Rejection" : "Waiting For Answer", value: claim.claimed, cls: "bg-[repeating-linear-gradient(135deg,#94a3a0_0_4px,#c5d4cd_4px_8px)]" }]
    : [
        { key: "paid", label: "Paid", value: Math.min(claim.paid, claim.approved), cls: "bg-[#032c26] dark:bg-[#39edd5]" },
        { key: "owed", label: "Approved, Not Paid", value: Math.max(0, claim.approved - claim.paid), cls: "bg-[#03c1ac]" },
        { key: "share", label: "Patient Share", value: claim.patientShare, cls: "bg-[#39edd5]/45" },
        { key: "denied", label: "Not Paid By Payer", value: claim.denied, cls: "bg-[repeating-linear-gradient(135deg,#be123c33_0_4px,#be123c14_4px_8px)]" },
      ];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round(p.value)} SAR`).join(", ")}>
        {parts.filter((p) => p.value > 0.004).map((p) => <span key={p.key} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <ul className={cn("mt-2 grid gap-x-4 gap-y-1 text-xs", parts.length > 1 && "grid-cols-2")}>
        <li className={cn("flex justify-between font-medium", parts.length > 1 && "col-span-2")}><span>Claimed</span><Money value={claim.claimed} /></li>
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2 text-muted-foreground">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("size-2 shrink-0 rounded-sm", p.cls)} />{p.label}</span>
            <Money value={p.value} className="text-foreground" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- status badges ---------- */

type Tone = React.ComponentProps<typeof Badge>["tone"];
const TONES: Record<string, Tone> = {
  Open: "warn", "In Review": "info", Closed: "neutral", Resolved: "ok", "Follow Up": "move",
  Received: "warn", "Partly Adjusted": "info", Adjusted: "admit", "Notice Sent": "ok", Paid: "ok", "Partly Paid": "warn", "Not Paid": "neutral",
  Ready: "ok", Update: "info", Invalid: "danger", High: "danger", Medium: "warn", Low: "neutral", Pending: "warn", Approved: "ok", Declined: "danger",
  Submitted: "info", Rejected: "danger", Denied: "danger", "Partly Approved": "warn", Active: "ok", Inactive: "neutral",
};
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge tone={TONES[status] ?? "neutral"} className={className}>{status}</Badge>;
}

/* ---------- notes and history ---------- */

/** Notes and status changes in one list, newest first, each with who and when. */
export function Timeline({ notes, history }: { notes: Note[]; history: HistoryEntry[] }) {
  const items = [
    ...notes.map((n) => ({ at: n.at, key: n.id, node: <NoteItem n={n} /> })),
    ...history.map((h, i) => ({ at: h.at, key: `h${i}`, node: <HistoryItem h={h} /> })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!items.length) return <p className="text-[0.8125rem] text-muted-foreground">No notes yet. Add one after each call or message with the payer.</p>;
  return (
    <ol className="relative space-y-3 border-l border-border pl-4">
      {items.map((x) => <li key={x.key} className="relative before:absolute before:-left-[1.3rem] before:top-1.5 before:size-2 before:rounded-full before:bg-[#03c1ac]">{x.node}</li>)}
    </ol>
  );
}

function NoteItem({ n }: { n: Note }) {
  return (
    <div className="text-[0.8125rem]">
      <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{n.by}</span>, {fmtTime(n.at)}</p>
      <p className="mt-0.5">{n.text}</p>
      {(n.medium || n.reference || n.followUp) && (
        <p className="mt-1 flex flex-wrap gap-1.5">
          {n.medium && <Badge>{n.medium}</Badge>}
          {n.outcome && <Badge tone={n.outcome === "Resolved" ? "ok" : n.outcome === "No Response" ? "danger" : "warn"}>{n.outcome}</Badge>}
          {n.person && <span className="text-xs text-muted-foreground">{n.person}</span>}
          {n.reference && <span className="text-xs text-muted-foreground">Reference {n.reference}</span>}
          {n.followUp && <span className="text-xs text-muted-foreground">Follow up {fmtDay(n.followUp)}</span>}
        </p>
      )}
    </div>
  );
}

function HistoryItem({ h }: { h: HistoryEntry }) {
  return (
    <div className="text-[0.8125rem]">
      <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{h.by}</span>, {fmtTime(h.at)}</p>
      <p className="mt-0.5 font-medium">{h.action}{h.from && h.to && h.from !== h.to ? <span className="font-normal text-muted-foreground">: {h.from} to {h.to}</span> : null}</p>
      {h.note && <p className="text-muted-foreground">{h.note}</p>}
    </div>
  );
}

/** The HIS Claim Notes dialog: a contact with the payer, or a plain note. */
export function NoteDialog({ open, onClose, onSave, kindLabel }: { open: boolean; onClose: () => void; onSave: (n: NoteInput) => boolean; kindLabel: string }) {
  const [f, setF] = React.useState({ text: "", medium: "", outcome: "", person: "", reference: "", follow: false, followUp: "" });
  React.useEffect(() => { if (open) setF({ text: "", medium: "", outcome: "", person: "", reference: "", follow: false, followUp: "" }); }, [open]);
  const save = () => {
    if (onSave({ text: f.text, medium: f.medium || undefined, outcome: f.outcome || undefined, person: f.person, reference: f.reference, followUp: f.follow ? f.followUp : undefined })) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Claim Notes" subtitle={`${kindLabel} note. Contact details are optional; fill them in after a call or message with the payer.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" className={BRAND} onClick={save}>Save Notes</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact Medium"><Select value={f.medium} onChange={(e) => setF({ ...f, medium: e.target.value })}><option value="">No Contact</option>{CONTACT_MEDIUMS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Contact Outcome" required={!!f.medium}><Select value={f.outcome} disabled={!f.medium} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option value="">Choose</option>{CONTACT_OUTCOMES.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Contact Person / Department"><Input maxLength={250} value={f.person} disabled={!f.medium} onChange={(e) => setF({ ...f, person: e.target.value })} /></Field>
        <Field label="Reference Number"><Input maxLength={100} value={f.reference} disabled={!f.medium} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Notes" required className="sm:col-span-2">
          <textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={3} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.follow} onChange={(e) => setF({ ...f, follow: e.target.checked })} className="size-4 accent-[#032c26]" /> Follow-Up Required</label>
        {f.follow && <Field label="Follow-Up Date" required><Input type="date" value={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.value })} /></Field>}
      </div>
    </Dialog>
  );
}

/**
 * A dialog for one action that needs a written note, with optional extra fields above it.
 * `onSubmit` returns true when the action worked; the dialog then closes.
 */
export function ActionDialog({ open, onClose, title, subtitle, submit, onSubmit, children, noteLabel = "Notes", notePlaceholder, danger }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; submit: string; onSubmit: (note: string) => boolean;
  children?: React.ReactNode; noteLabel?: string; notePlaceholder?: string; danger?: boolean;
}) {
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (open) setNote(""); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title={title} subtitle={subtitle}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} className={danger ? undefined : BRAND} onClick={() => onSubmit(note) && onClose()}>{submit}</Button></>}>
      <div className="grid gap-3">
        {children}
        <Field label={noteLabel} required>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={notePlaceholder} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </Field>
      </div>
    </Dialog>
  );
}

export function NoAccess() {
  return <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">You can read these cases. Changing them needs the billing permission.</p>;
}

export function ClearButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.8125rem] font-medium text-[#035d53] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring dark:text-[#39edd5]"><X className="size-3.5" aria-hidden="true" />Clear Filters</button>;
}

/** Matches a case against the search box: claim number, patient, MRN and payer. */
export const matches = (q: string, ...fields: (string | undefined)[]) => !q.trim() || fields.some((f) => f?.toLowerCase().includes(q.trim().toLowerCase()));

/** Days as plain words for the age column. */
export const daysText = (n: number) => (n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);
