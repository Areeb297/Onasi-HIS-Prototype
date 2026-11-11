import * as React from "react";
import { IconAlertTriangle, IconCheck, IconChevronDown, IconCircleDashed, IconInfoCircle, IconShieldExclamation, IconX } from "@tabler/icons-react";
import { Badge, Card, cn } from "@/components/ui/primitives";
import { CodeBlock } from "@/components/ui/code-block";
import { useDevMode } from "@/lib/devmode";
import { ASSUMPTIONS } from "@/lib/fhir/medication";
import { CONTROL_LABEL } from "@/lib/rx-catalogue";
import { GROUPS, STEPS, stepStatus, type StepStatus } from "@/lib/rx-logic";
import type { SafetyFinding } from "@/lib/rx-safety";
import type { ControlClass, ItemStatus, RxCheck, SendRecord } from "@/lib/rx-types";
import { useRx } from "@/lib/rx";

/** Small pieces shared by the prescription tab and the pharmacy worklist. */

const STATUS: Record<ItemStatus, { label: string; tone: "ok" | "warn" | "cancel" | "neutral" | "move" }> = {
  active: { label: "Active", tone: "ok" },
  "on-hold": { label: "On Hold", tone: "warn" },
  stopped: { label: "Stopped", tone: "cancel" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  completed: { label: "Completed", tone: "move" },
};

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ControlBadge({ cls }: { cls: ControlClass }) {
  if (cls === "U") return null;
  return <Badge tone="danger">{CONTROL_LABEL[cls]} ({cls})</Badge>;
}

/* ---------- safety banners ---------- */

export function SafetyBanner({ f }: { f: SafetyFinding }) {
  const strong = f.level === "block" || f.level === "error";
  const Icon = f.level === "block" ? IconShieldExclamation : f.level === "info" ? IconInfoCircle : IconAlertTriangle;
  return (
    <div
      role={strong ? "alert" : "note"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug",
        strong && "border-destructive/40 bg-destructive/8 text-destructive",
        f.level === "warn" && "border-warn/40 bg-warn/10 text-foreground",
        f.level === "info" && "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", f.level === "warn" && "text-warn")} stroke={1.75} />
      <span>{f.text}</span>
    </div>
  );
}

/* ---------- validator output ---------- */

export function CheckList({ checks, max = 400 }: { checks: RxCheck[]; max?: number }) {
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const sorted = [...checks].sort((a, b) => rank(a.level) - rank(b.level));
  return (
    <div>
      <div className="mb-2 flex gap-2 text-xs">
        <Badge tone={errors ? "danger" : "ok"}>{errors} errors</Badge>
        <Badge tone={warns ? "warn" : "neutral"}>{warns} warnings</Badge>
        <Badge tone="neutral">{checks.length - errors - warns} passed</Badge>
      </div>
      <ul className="space-y-1 overflow-auto text-xs" style={{ maxHeight: max }}>
        {sorted.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            {c.level === "ok" ? <IconCheck className="mt-px size-3.5 shrink-0 text-ok" /> : c.level === "warn" ? <IconAlertTriangle className="mt-px size-3.5 shrink-0 text-warn" /> : <IconX className="mt-px size-3.5 shrink-0 text-destructive" />}
            <span className={cn(c.level === "error" && "text-destructive")}>
              {c.text}
              {c.spec && <span className="ml-1.5 font-mono text-xs text-muted-foreground">[{c.spec}]</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const rank = (l: string) => (l === "error" ? 0 : l === "warn" ? 1 : 2);

/* ---------- Developer View: message, checks, response ---------- */

type Tab = "message" | "checks" | "response" | "history";

export function MessageViewer({
  title,
  bundle,
  checks,
  record,
  history,
}: {
  title: string;
  bundle: unknown;
  checks: RxCheck[];
  /** Latest sent record, if any. */
  record?: SendRecord;
  history?: SendRecord[];
}) {
  const [tab, setTab] = React.useState<Tab>("message");
  const json = React.useMemo(() => JSON.stringify(bundle, null, 2), [bundle]);
  const tabs: [Tab, string][] = [["message", "FHIR Message"], ["checks", "Validator"], ["response", "Simulated Response"], ["history", "Sent Messages"]];
  return (
    <div className="rounded-lg border border-dashed border-update/50 bg-update/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs font-semibold text-update">Developer View</span>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn("rounded-md px-2 py-1 text-xs font-medium", tab === id ? "bg-update/20 text-update" : "text-muted-foreground hover:bg-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "message" && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">This is what the next send will contain. Resource ids change when it is sent.</p>
          <CodeBlock filename={`${title}.json`} code={json} maxHeight={420} />
        </>
      )}
      {tab === "checks" && <CheckList checks={checks} />}
      {tab === "response" &&
        (record ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Badge tone={record.ok ? "ok" : "danger"}>HTTP {record.http}</Badge>
              <span className="text-muted-foreground">{record.summary}</span>
            </div>
            <CodeBlock filename="OperationOutcome.json" code={JSON.stringify(record.outcome, null, 2)} maxHeight={260} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing sent yet. Send to see the simulated nphies response (201 with an OperationOutcome, or 400 with the errors).</p>
        ))}
      {tab === "history" &&
        ((history ?? []).length ? (
          <ul className="space-y-1 text-xs">
            {[...(history ?? [])].reverse().map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={h.ok ? "ok" : "danger"}>HTTP {h.http}</Badge>
                <span className="font-mono">{new Date(h.at).toLocaleTimeString("en-GB")}</span>
                <span>{h.summary}</span>
                {h.steps.length > 0 && <span className="font-mono text-update">steps {h.steps.join(", ")}</span>}
                {h.refId && <span className="font-mono">{h.refId}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No messages sent yet.</p>
        ))}
      <Assumptions />
    </div>
  );
}

export function Assumptions() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-3 border-t border-update/30 pt-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs font-medium text-update">
        <IconChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        Assumption notes ({ASSUMPTIONS.length})
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {ASSUMPTIONS.map((a) => (
            <li key={a}>
              <b className="text-foreground">Assumption.</b> {a}
            </li>
          ))}
          <li>
            <b className="text-foreground">Assumption.</b> A prescription item changes between active and completed from the dispenses. No prescription message is sent when that happens.
          </li>
        </ul>
      )}
    </div>
  );
}

/* ---------- NPHIES requirements panel ---------- */

const STATUS_VIEW: Record<StepStatus, { label: string; tone: "neutral" | "ok" | "danger"; icon: React.ReactNode }> = {
  "not-started": { label: "Not Started", tone: "neutral", icon: <IconCircleDashed className="size-4 text-muted-foreground" /> },
  done: { label: "Done", tone: "ok", icon: <IconCheck className="size-4 text-ok" /> },
  failed: { label: "Failed", tone: "danger", icon: <IconX className="size-4 text-destructive" /> },
};

function ConformancePanelInner({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const dev = useDevMode();
  const { sends } = useRx();
  const done = STEPS.filter((s) => stepStatus(sends, s.id) === "done").length;
  return (
    <Card className="mt-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span>
          <span className="block text-sm font-semibold">NPHIES Requirements</span>
          <span className="block text-xs text-muted-foreground">Seha steps 7.1 to 7.5: prescription and dispense. Each step turns Done when nphies accepts the message.</span>
        </span>
        <span className="flex items-center gap-2">
          <Badge tone={done === STEPS.length ? "ok" : "neutral"}>{done} of {STEPS.length} done</Badge>
          <IconChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.id} className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold">
                {dev && <span className="mr-1.5 font-mono text-update">{g.id}</span>}
                {g.label}
              </div>
              <ul>
                {STEPS.filter((s) => s.group === g.id).map((s) => {
                  const st = stepStatus(sends, s.id);
                  const v = STATUS_VIEW[st];
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-xs last:border-0">
                      <span className="flex items-center gap-2">
                        {v.icon}
                        {s.label}
                        {dev && <span className="font-mono text-xs text-muted-foreground">{s.nums}</span>}
                      </span>
                      <Badge tone={v.tone}>{v.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}


/** The requirements checklist is for testers, so it only shows in Developer View. */
export function ConformancePanel(props: { defaultOpen?: boolean }) {
  const dev = useDevMode();
  return dev ? <ConformancePanelInner {...props} /> : null;
}
