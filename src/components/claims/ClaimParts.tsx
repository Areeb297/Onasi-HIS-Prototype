import * as React from "react";
import { IconAlertTriangle, IconCircleCheck, IconHandStop, IconOctagon } from "@tabler/icons-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, cn } from "@/components/ui/primitives";
import {
  claimFor, confirmSoftStops, reviewModel, reviewSummary, sendFromClaim, SEVERITY_LABEL, unconfirmedSoftStops, type ClaimUse, type Finding, type Severity, type SoftStopAck, type StatusTone,
} from "@/lib/claims";
import { pushToast } from "@/lib/toast";

const SEVERITY_TONE: Record<Severity, "danger" | "warn" | "info"> = { hard: "danger", soft: "warn", warning: "info" };
const SEVERITY_ICON: Record<Severity, typeof IconOctagon> = { hard: IconOctagon, soft: IconHandStop, warning: IconAlertTriangle };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

export function ClaimStatusBadge({ status }: { status: { label: string; tone: StatusTone } }) {
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

/** Counts of each severity, for a worklist row or a page header. */
export function ReviewCounts({ findings, compact }: { findings: Finding[]; compact?: boolean }) {
  const s = reviewSummary(findings);
  if (!findings.length) return <Badge tone="ok">{compact ? "Clear" : "Review Clear"}</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {s.hard > 0 && <Badge tone="danger">{s.hard} Hard Stop{s.hard === 1 ? "" : "s"}</Badge>}
      {s.soft > 0 && <Badge tone="warn">{s.soft} Soft Stop{s.soft === 1 ? "" : "s"}</Badge>}
      {s.warning > 0 && <Badge tone="info">{s.warning} Warning{s.warning === 1 ? "" : "s"}</Badge>}
    </span>
  );
}

export function FindingList({ findings, confirmed }: { findings: Finding[]; confirmed?: Set<string> }) {
  if (!findings.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2.5 text-sm text-ok">
        <IconCircleCheck className="size-4 shrink-0" stroke={1.75} aria-hidden="true" /> The review found nothing to fix.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f) => {
        const Icon = SEVERITY_ICON[f.severity];
        return (
          <li key={f.id} className={cn("flex gap-3 rounded-lg border px-3 py-2.5", f.severity === "hard" ? "border-destructive/40 bg-destructive/5" : f.severity === "soft" ? "border-warn/40 bg-warn/5" : "border-border")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", f.severity === "hard" ? "text-destructive" : f.severity === "soft" ? "text-warn" : "text-move")} stroke={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={f.severity} />
                {confirmed?.has(f.id) && <Badge tone="ok">Confirmed</Badge>}
              </div>
              <p className="mt-1 text-sm font-medium">{f.text}</p>
              <p className="text-xs text-muted-foreground">{f.fix}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const USE_LABEL: Record<ClaimUse, string> = { priorauth: "Prior Authorization", claim: "Claim" };

/**
 * Claim review. Without `sendAs` it only shows the findings. With `sendAs` it is the step before sending:
 * a Hard Stop blocks, Soft Stops need a reason before Confirm And Send.
 */
export function ReviewDialog({
  open, onClose, visit, findings, ack, sendAs, onSend,
}: {
  open: boolean;
  onClose: () => void;
  visit: string;
  findings: Finding[];
  ack: SoftStopAck | undefined;
  sendAs?: ClaimUse;
  onSend?: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => { if (open) { setReason(""); setError(""); } }, [open]);
  const hard = findings.filter((f) => f.severity === "hard");
  const openSoft = unconfirmedSoftStops(findings, ack);
  const confirmed = new Set(ack?.ids ?? []);

  const confirmAndSend = () => {
    if (openSoft.length) {
      const r = confirmSoftStops(visit, [...(ack?.ids ?? []), ...openSoft.map((f) => f.id)], reason);
      if (!r.ok) { setError(r.problems[0]); return; }
      pushToast({ tone: "ok", text: "Soft stops confirmed." });
    }
    onSend?.();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={sendAs ? `Review Before Sending ${USE_LABEL[sendAs]}` : "Claim Review"}
      subtitle="Hard Stop blocks sending. Soft Stop needs a reason before sending. Warning is for information."
      footer={
        <>
          <Button onClick={onClose}>{sendAs ? "Cancel" : "Close"}</Button>
          {sendAs && (
            <Button variant="primary" onClick={confirmAndSend} disabled={hard.length > 0} title={hard.length ? "Fix every Hard Stop first." : undefined}>
              {openSoft.length ? "Confirm And Send" : "Send"}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-3"><ReviewCounts findings={findings} /></div>
      <FindingList findings={findings} confirmed={confirmed} />
      {sendAs && hard.length > 0 && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {hard.length === 1 ? "A Hard Stop blocks" : `${hard.length} Hard Stops block`} sending. Fix {hard.length === 1 ? "it" : "them"} and review again.
        </p>
      )}
      {sendAs && !hard.length && openSoft.length > 0 && (
        <Field label="Why Is It Safe To Send?" required hint="Saved with your name in the audit log." className="mt-4">
          <textarea
            className="min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-background"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(""); }}
            aria-invalid={!!error}
          />
        </Field>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}

/**
 * Send Prior Authorization or Send Claim from any screen. Sends at once when the review is clear; otherwise opens the
 * review so the biller sees the Hard Stops or confirms the Soft Stops.
 */
export function useClaimSend(): [(visit: string, use: ClaimUse) => void, React.ReactNode] {
  const [pending, setPending] = React.useState<{ visit: string; use: ClaimUse } | null>(null);
  const send = React.useCallback((visit: string, use: ClaimUse) => {
    const r = sendFromClaim(visit, use);
    if (r.ok) { setPending(null); return; }
    if (r.blocked || r.needsConfirm) { setPending({ visit, use }); return; }
    pushToast({ tone: "warn", text: r.problems[0] ?? "Nothing was sent." });
  }, []);
  const m = pending ? claimFor(pending.visit) : null;
  const element = pending && m ? (
    <ReviewDialog
      open
      onClose={() => setPending(null)}
      visit={pending.visit}
      findings={reviewModel(m, pending.use)}
      ack={m.draft?.ack}
      sendAs={pending.use}
      onSend={() => {
        const r = sendFromClaim(pending.visit, pending.use);
        if (r.ok) setPending(null);
        else if (!r.blocked && !r.needsConfirm) { pushToast({ tone: "warn", text: r.problems[0] ?? "Nothing was sent." }); setPending(null); }
      }}
    />
  ) : null;
  return [send, element];
}
