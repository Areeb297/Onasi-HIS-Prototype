import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { ReqChip } from "@/components/badges";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Card, CardHeader, Switch, cn } from "@/components/ui/primitives";
import { pretty, SEGMENT_TITLES, type SegmentStatus } from "@/lib/hl7";
import type { Check } from "@/lib/model";
import type { EventSpec, SegId } from "@/lib/spec";

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          {c.level === "ok" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />}
          {c.level === "warn" && <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />}
          {c.level === "error" && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <span className={cn(c.level === "error" && "text-destructive")}>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Live message panel. Shows the segment table for the event with a switch for each segment,
 * the HL7 text, and the result of the checks.
 */
export function MessagePanel({
  event,
  message,
  filename,
  statuses,
  include,
  onToggle,
  checks,
}: {
  event: EventSpec;
  message: string;
  filename: string;
  statuses: SegmentStatus[];
  include: Record<SegId, boolean>;
  onToggle: (id: SegId, value: boolean) => void;
  checks: Check[];
}) {
  const errors = checks.filter((c) => c.level === "error").length;
  const warnings = checks.filter((c) => c.level === "warn").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Segments"
          subtitle="R is required, O is optional, - must not be present, I is ignored by nphies. Switch a segment on or off to test how NPHIES reacts."
          right={
            errors ? (
              <Badge tone="danger">{errors} {errors === 1 ? "Error" : "Errors"}</Badge>
            ) : warnings ? (
              <Badge tone="warn">{warnings} {warnings === 1 ? "Warning" : "Warnings"}</Badge>
            ) : (
              <Badge tone="ok">All Checks Pass</Badge>
            )
          }
        />
        <ul className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-2">
          {statuses.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1">
              <span className="flex min-w-0 items-center gap-2">
                <ReqChip req={s.req} />
                <span className="font-mono text-xs font-semibold">{s.id}</span>
                <span className="truncate text-xs text-muted-foreground">{SEGMENT_TITLES[s.id]}</span>
              </span>
              <span className="flex items-center gap-2">
                {!s.ok && <AlertTriangle className="size-3.5 text-destructive" aria-label="Does not match the table" />}
                <Switch
                  label={`Include ${s.id}`}
                  checked={!!include[s.id]}
                  disabled={s.id === "MSH"}
                  onChange={(v) => onToggle(s.id, v)}
                />
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <CodeBlock filename={filename} code={pretty(message)} />

      <Card>
        <CardHeader title="Checks" subtitle={`Table and field checks for ${event.trigger}`} />
        <div className="px-4 py-3">
          <ChecksList checks={checks} />
        </div>
      </Card>
    </div>
  );
}
