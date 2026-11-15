import * as React from "react";
import { Info } from "lucide-react";
import { Badge, Field, Select, cn } from "@/components/ui/primitives";
import type { Dx } from "@/lib/model";
import { COVERAGE_LABEL, NO_DIAGNOSIS_NOTE, coverageLabel, dxOption, type OrderCoverage, type OrderDiagnosis } from "@/lib/order-fields";

/** Diagnosis picker fed by the visit's diagnoses. Shows a note instead when the visit has none. */
export function OrderDiagnosisField({
  diagnoses,
  value,
  onChange,
  disabled,
}: {
  diagnoses: Dx[];
  value: OrderDiagnosis | null;
  onChange: (d: OrderDiagnosis | null) => void;
  disabled?: boolean;
}) {
  // A diagnosis kept on an older order may have been removed from the visit since. Keep it in the list so it still shows.
  const options = diagnoses.map(dxOption);
  if (value?.code && !options.some((o) => o.code === value.code)) options.unshift(value);
  if (options.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium leading-5">Diagnosis</span>
        <p role="note" className="flex items-start gap-2 rounded-md border border-warn/50 bg-warn/10 px-2.5 py-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
          {NO_DIAGNOSIS_NOTE}
        </p>
      </div>
    );
  }
  return (
    <Field label="Diagnosis" hl7="Additional Order Information (Preliminary Diagnosis)">
      <Select
        value={value?.code ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(options.find((o) => o.code === e.target.value) ?? null)}
      >
        <option value="">No Diagnosis Linked</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>{o.code} {o.text}</option>
        ))}
      </Select>
    </Field>
  );
}

/** Plan Coverage or Additional / Self-Pay. Plan Coverage is offered only when the visit is insured. */
export function OrderCoverageField({
  value,
  onChange,
  insured,
  disabled,
}: {
  value: OrderCoverage;
  onChange: (c: OrderCoverage) => void;
  insured: boolean;
  disabled?: boolean;
}) {
  const name = `coverage-${React.useId()}`;
  const opts: OrderCoverage[] = ["plan", "self-pay"];
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium leading-5">Coverage</legend>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((c) => {
          const off = disabled || (c === "plan" && !insured);
          return (
            <label
              key={c}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                value === c ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card hover:bg-muted",
                off && "cursor-not-allowed opacity-60 hover:bg-card",
              )}
            >
              <input type="radio" className="accent-current" name={name} value={c} checked={value === c} disabled={off} onChange={() => onChange(c)} />
              {COVERAGE_LABEL[c]}
            </label>
          );
        })}
      </div>
      {!insured && <p className="text-xs text-muted-foreground">This visit has no insurance plan, so the order is self-pay.</p>}
    </fieldset>
  );
}

/** One line for the order lists: "Diagnosis J18.9 Pneumonia" and the coverage badge. */
export function OrderMetaLine({ diagnosis, coverage }: { diagnosis?: OrderDiagnosis; coverage?: OrderCoverage }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        Diagnosis: {diagnosis ? <span className="text-foreground"><span className="font-mono">{diagnosis.code}</span> {diagnosis.text}</span> : "Not Linked"}
      </span>
      <span className="flex items-center gap-1.5">
        Coverage: <Badge tone={coverage === "plan" ? "ok" : coverage === "self-pay" ? "warn" : "neutral"}>{coverageLabel(coverage)}</Badge>
      </span>
    </div>
  );
}
