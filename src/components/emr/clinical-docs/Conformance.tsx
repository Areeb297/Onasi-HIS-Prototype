import { CheckCircle2, Circle, MinusCircle, XCircle } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { ASSUMPTIONS } from "@/lib/cda/docspec";
import type { Step } from "@/lib/cda/conformance";

/** NPHIES requirements panel and the assumptions list. Developer View only. */

const ICON = {
  done: <CheckCircle2 className="size-4 text-ok" />,
  todo: <Circle className="size-4 text-muted-foreground" />,
  na: <MinusCircle className="size-4 text-muted-foreground/60" />,
  fail: <XCircle className="size-4 text-destructive" />,
} as const;

const LABEL = { done: "Done", todo: "To do", na: "Not for this visit", fail: "Not met" } as const;
const TONE = { done: "ok", todo: "neutral", na: "neutral", fail: "danger" } as const;

export function ConformancePanel({ steps }: { steps: Step[] }) {
  const flows = [...new Set(steps.map((s) => s.flow))];
  const done = steps.filter((s) => s.state === "done").length;
  const applicable = steps.filter((s) => s.state !== "na").length;
  return (
    <Card>
      <CardHeader
        title="NPHIES Requirements: Clinical Notes Summary"
        subtitle="Test steps 4.1 to 4.3 and the Operative Note flows. Status comes from this visit's documents."
        right={<Badge tone={done === applicable ? "ok" : "primary"}>{done} of {applicable} done</Badge>}
      />
      <div className="divide-y divide-border">
        {flows.map((flow) => (
          <div key={flow} className="px-4 py-3">
            <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{flow}</h4>
            <ul className="space-y-1.5">
              {steps
                .filter((s) => s.flow === flow)
                .map((s) => (
                  <li key={s.id} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5">{ICON[s.state]}</span>
                    <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{s.id}</span>
                    <span className="min-w-0 flex-1">
                      {s.text}
                      <span className="block text-xs text-muted-foreground">Expected: {s.expected}. {s.state !== "done" && s.state !== "na" ? s.hint : ""}</span>
                    </span>
                    <Badge tone={TONE[s.state]}>{LABEL[s.state]}</Badge>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        The last two steps carry the number 4.1.1 and 4.1.2 again in the sheet. They are shown here with a star.
      </p>
    </Card>
  );
}

export function AssumptionList() {
  return (
    <Card>
      <CardHeader title="Assumptions" subtitle="Where the snapshot is silent, the app assumes the following. Check them before real use." />
      <ul className="list-disc space-y-1 px-8 py-3 text-sm">
        {ASSUMPTIONS.map((a) => (
          <li key={a}>{a}</li>
        ))}
        <li>ICD-10-AM diagnosis codes are written with the ICD-10 OID (2.16.840.1.113883.6.3). Procedure codes use a made-up demo OID.</li>
      </ul>
    </Card>
  );
}
