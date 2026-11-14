import * as React from "react";
import { AlertTriangle, Check as CheckIcon, ChevronDown, CircleAlert, CircleCheck, CircleDot, Circle, ShieldAlert } from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Card, Switch, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Check } from "@/lib/model";
import { STATE_LABEL, type ConfStep, type StepState } from "@/lib/fhir/conformance";
import { COMMON_ASSUMPTIONS } from "@/lib/fhir/assumptions";
import { INTERP_TEXT, type Interp } from "@/lib/fhir/lab-catalog";
import type { NphiesResponse } from "@/lib/fhir/common";
import type { SendRecord } from "@/lib/fhir/types";

type Tone = "neutral" | "primary" | "ok" | "warn" | "danger" | "info" | "admit" | "move" | "update" | "cancel" | "merge";

/* ---------- small pieces ---------- */

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          {c.level === "ok" && <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />}
          {c.level === "warn" && <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />}
          {c.level === "error" && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <span className={cn(c.level === "error" && "text-destructive")}>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Abnormal flag next to a result. Critical values are loud on purpose. */
export function FlagPill({ interp }: { interp: Interp }) {
  if (interp === "N" || interp === "NEG") return <span className="text-xs text-muted-foreground">{INTERP_TEXT[interp]}</span>;
  const critical = interp === "HH" || interp === "LL";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold leading-none",
        critical ? "bg-destructive text-white" : "bg-warn/20 text-warn",
      )}
      title={INTERP_TEXT[interp]}
    >
      {critical && <ShieldAlert className="size-3" />}
      {INTERP_TEXT[interp]}
    </span>
  );
}

export const LAB_STATUS_UI: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "move" },
  collected: { label: "Specimen Collected", tone: "update" },
  "in-progress": { label: "In Progress", tone: "merge" },
  resulted: { label: "Resulted", tone: "ok" },
  amended: { label: "Amended", tone: "admit" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const RAD_STATUS_UI: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "move" },
  performed: { label: "Exam Performed", tone: "update" },
  resulted: { label: "Reported", tone: "ok" },
  amended: { label: "Amended", tone: "admit" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const PRIORITY_UI: Record<string, { label: string; tone: Tone }> = {
  routine: { label: "Routine", tone: "neutral" },
  urgent: { label: "Urgent", tone: "warn" },
  asap: { label: "ASAP", tone: "merge" },
  stat: { label: "STAT", tone: "danger" },
};

export function StatusBadge({ map, status }: { map: Record<string, { label: string; tone: Tone }>; status: string }) {
  const s = map[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function TestCodeNote({ madeUp }: { madeUp?: boolean }) {
  return madeUp ? <span className="ml-1 text-xs text-muted-foreground">(test code)</span> : null;
}

/** Wraps a button that may be disabled by permission. A disabled button shows no tooltip by itself, so the wrapper carries the title. */
export function Gate({ allowed, reason, children }: { allowed: boolean; reason: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex" title={allowed ? undefined : reason}>
      {children}
    </span>
  );
}

export function NphiesPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Badge tone={tone} className="gap-1">
      NPHIES: {label}
    </Badge>
  );
}

/** Developer-only box that lists the assumptions made where the snapshot is unclear. */
export function AssumptionNote({ items }: { items: string[] }) {
  const dev = useDevMode();
  const [open, setOpen] = React.useState(false);
  if (!dev) return null;
  const all = [...items, ...COMMON_ASSUMPTIONS];
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/8 px-3 py-2 text-xs">
      <button className="flex w-full items-center justify-between gap-2 font-medium text-warn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Assumptions: {all.length} points the NPHIES guide leaves open, and what the app does</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {all.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- response ---------- */

export function ResponseView({ response }: { response: NphiesResponse }) {
  const ok = response.status === "accepted";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={ok ? "ok" : "danger"}>{ok ? "Accepted" : "Rejected"}</Badge>
        <span className="font-mono text-xs text-muted-foreground">HTTP {response.http}</span>
        <span className="font-mono text-xs text-muted-foreground">{response.transactionId}</span>
        <span className="text-xs text-muted-foreground">Simulated. No call was made.</span>
      </div>
      <CodeBlock filename="OperationOutcome.json" code={JSON.stringify(response.outcome, null, 2)} maxHeight={260} allowDownload={false} />
    </div>
  );
}

/* ---------- document viewer (Developer View) ---------- */

type DocTab = "json" | "checks" | "response";

/**
 * Developer View panel: pick one of the sends, then see the FHIR JSON, the validation checks and the simulated response.
 * `records` are the sends of one kind for one order, oldest first.
 */
export function DocViewer({ records, filenamePrefix, empty }: { records: SendRecord[]; filenamePrefix: string; empty: string }) {
  const dev = useDevMode();
  const [selSeq, setSelSeq] = React.useState<number | null>(null);
  const [tab, setTab] = React.useState<DocTab>("json");
  const rec = records.find((r) => r.seq === selSeq) ?? records[records.length - 1];
  const json = React.useMemo(() => (rec ? JSON.stringify(rec.bundle, null, 2) : ""), [rec]);
  if (!dev) return null;
  if (!rec) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const errs = rec.checks.filter((c) => c.level === "error").length;
  const warns = rec.checks.filter((c) => c.level === "warn").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {records.map((r) => (
          <button
            key={r.seq}
            onClick={() => setSelSeq(r.seq)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              r.seq === rec.seq ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted",
            )}
          >
            Version {r.version} {r.docStatus} {r.response.status === "accepted" ? "accepted" : "rejected"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {rec.bundle?.entry?.length ?? 0} resources
        </span>
        <span className={errs ? "text-destructive" : "text-ok"}>{errs} errors</span>
        <span className={warns ? "text-warn" : ""}>{warns} warnings</span>
        <span>Sent {new Date(rec.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="tablist">
        {(["json", "checks", "response"] as DocTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("rounded-md px-3 py-1.5 font-medium", tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "json" ? "FHIR JSON" : t === "checks" ? `Validation (${rec.checks.length})` : "NPHIES Response"}
          </button>
        ))}
      </div>
      {tab === "json" && <CodeBlock filename={`${filenamePrefix}-v${rec.version}.json`} code={json} maxHeight={420} />}
      {tab === "checks" && <ChecksList checks={[...rec.checks].sort((a, b) => rank(a.level) - rank(b.level))} />}
      {tab === "response" && <ResponseView response={rec.response} />}
    </div>
  );
}

const rank = (l: Check["level"]) => (l === "error" ? 0 : l === "warn" ? 1 : 2);

/* ---------- conformance panel ---------- */

const STATE_TONE: Record<StepState, Tone> = { none: "neutral", progress: "warn", done: "ok", failed: "danger" };

function StateIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckIcon className="size-4 shrink-0 text-ok" />;
  if (state === "failed") return <AlertTriangle className="size-4 shrink-0 text-destructive" />;
  if (state === "progress") return <CircleDot className="size-4 shrink-0 text-warn" />;
  return <Circle className="size-4 shrink-0 text-muted-foreground/60" />;
}

function ConformancePanelInner({
  steps,
  onToggleViewed,
  rejectNext,
  onRejectNext,
  assumptions,
  actions,
  defaultOpen = false,
}: {
  steps: ConfStep[];
  onToggleViewed: (key: string) => void;
  rejectNext: boolean;
  onRejectNext: (v: boolean) => void;
  assumptions: string[];
  actions?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const dev = useDevMode();
  const [open, setOpen] = React.useState(defaultOpen);
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Card className="mt-4">
      <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          <span className="block text-sm font-semibold">NPHIES Requirements</span>
          <span className="block text-xs text-muted-foreground">Every NPHIES test step, and whether it is done.</span>
        </span>
        <span className="flex items-center gap-2">
          <Badge tone={done === steps.length ? "ok" : "neutral"}>
            {done} of {steps.length} done
          </Badge>
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          <div className="grid gap-3 md:grid-cols-2">
            {steps.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StateIcon state={s.state} />
                    <span className="text-sm font-semibold">
                      {dev && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{s.id}</span>}
                      {s.title}
                    </span>
                  </div>
                  <Badge tone={STATE_TONE[s.state]}>{STATE_LABEL[s.state]}</Badge>
                </div>
                {s.state !== "done" && <p className="mt-1.5 text-xs text-muted-foreground">{s.hint}</p>}
                {dev && (
                  <ul className="mt-2 space-y-1.5 border-t border-border/70 pt-2">
                    {s.subs.map((sub) => (
                      <li key={sub.id} className="flex items-start gap-2 text-xs">
                        <StateIcon state={sub.state} />
                        <span className="min-w-0 flex-1">
                          <span className="font-mono text-muted-foreground">{sub.id}</span> {sub.text}
                          {sub.detail && <span className="block text-muted-foreground">{sub.detail}</span>}
                        </span>
                        {sub.manual && (
                          <label className="flex shrink-0 items-center gap-1 text-muted-foreground" title="Tick this after you looked at the document in the NPHIES provider portal.">
                            <input type="checkbox" checked={sub.state === "done"} onChange={() => onToggleViewed(sub.id)} />
                            Viewed
                          </label>
                        )}
                      </li>
                    ))}
                    {s.mins.length > 0 && (
                      <li className="pt-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Minimum content</span>
                        <ul className="mt-1 space-y-1">
                          {s.mins.map((m) => (
                            <li key={m.id} className="flex items-start gap-2 text-xs">
                              <StateIcon state={m.state} />
                              <span className="min-w-0">
                                <span className="font-mono text-muted-foreground">{m.id}</span> {m.text}
                                {m.detail && <span className="block text-muted-foreground">{m.detail}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {dev && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <Switch checked={rejectNext} onChange={onRejectNext} label="Simulate a rejection on the next send" />
              <span>Simulate a rejection on the next send</span>
              <span className="text-xs text-muted-foreground">Use it to test the rejected state. It turns off after one send.</span>
            </div>
          )}
          <AssumptionNote items={assumptions} />
        </div>
      )}
    </Card>
  );
}


/** The requirements checklist is for testers, so it only shows in Developer View. */
export function ConformancePanel(props: React.ComponentProps<typeof ConformancePanelInner>) {
  const dev = useDevMode();
  return dev ? <ConformancePanelInner {...props} /> : null;
}
