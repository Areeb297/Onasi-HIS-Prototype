import * as React from "react";
import { Gate } from "@/components/emr/fhir-ui";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { BODY_REGIONS, MODALITIES, QUICK_RAD, RAD_CATALOG, procByCode, type RadProcedure } from "@/lib/fhir/rad-catalog";
import { PRIORITIES, type Priority } from "@/lib/fhir/types";

export interface RadOrderInput {
  procCodes: string[];
  priority: Priority;
  indication: string;
  clinicalInfo: string;
}

function Chip({ proc, on, toggle, disabled }: { proc: RadProcedure; on: boolean; toggle: () => void; disabled?: boolean }) {
  const dev = useDevMode();
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={toggle}
      title={`${proc.display} (code ${proc.code})`}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
      )}
    >
      {proc.short}
      {dev && <span className="ml-1.5 font-mono text-xs opacity-70">{proc.code}</span>}
    </button>
  );
}

/** Order pad for imaging. Tap the procedure, check the reason, place the order. Each procedure becomes its own order. */
export function RadOrderPad({
  initial,
  defaultIndication,
  single,
  procLocked,
  canOrder,
  reason,
  submitLabel,
  showSend,
  onSubmit,
  onCancel,
  duplicatesOf,
}: {
  /** Names of picked exams that are already open for the visit. The pad warns before it adds them again. */
  duplicatesOf?: (procCodes: string[]) => string[];
  initial?: { procCode: string; priority: Priority; indication: string; clinicalInfo: string };
  defaultIndication?: string;
  /** Amend mode: one procedure only. */
  single?: boolean;
  /** The exam is already done, so the procedure cannot change. */
  procLocked?: boolean;
  canOrder: boolean;
  reason: string;
  submitLabel: string;
  showSend?: boolean;
  onSubmit: (v: RadOrderInput, andSend: boolean) => void;
  onCancel?: () => void;
}) {
  const dev = useDevMode();
  const [codes, setCodes] = React.useState<string[]>(initial ? [initial.procCode] : []);
  const [priority, setPriority] = React.useState<Priority>(initial?.priority ?? "routine");
  const [indication, setIndication] = React.useState(initial?.indication ?? defaultIndication ?? "");
  const [clinicalInfo, setClinicalInfo] = React.useState(initial?.clinicalInfo ?? "");
  const [pending, setPending] = React.useState<{ andSend: boolean } | null>(null);

  const toggle = (c: string) => setCodes((cur) => (single ? [c] : cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const picked = codes.map((c) => procByCode(c)).filter((p): p is RadProcedure => !!p);
  const hasReason = indication.trim().length > 0;
  const ready = canOrder && picked.length > 0 && hasReason;
  const whyOff = !canOrder ? "" : picked.length === 0 ? "Pick a procedure first." : !hasReason ? "Enter the reason for the exam. NPHIES rejects a radiology order without it." : "";
  const value: RadOrderInput = { procCodes: codes, priority, indication, clinicalInfo };
  const dupes = duplicatesOf && !procLocked ? duplicatesOf(codes) : [];
  /** A duplicate asks first. Anything else goes straight through. */
  const submit = (andSend: boolean) => (dupes.length > 0 ? setPending({ andSend }) : onSubmit(value, andSend));

  return (
    <div className="space-y-3">
      {!single && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Quick Orders</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_RAD.map((q) => {
              const p = procByCode(q.code)!;
              return <Chip key={q.id} proc={p} on={codes.includes(q.code)} toggle={() => toggle(q.code)} />;
            })}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{single ? "Procedure" : "All Procedures"}</div>
        <div className="flex flex-wrap gap-1.5">
          {RAD_CATALOG.map((p) => (
            <Chip key={p.code} proc={p} on={codes.includes(p.code)} disabled={procLocked} toggle={() => toggle(p.code)} />
          ))}
        </div>
      </div>
      {picked.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {picked.map((p) => (
            <div key={p.code} className="flex flex-wrap items-center gap-x-3">
              <span className="font-medium">{p.display}</span>
              <span className="text-xs text-muted-foreground">
                {MODALITIES[p.modality].display} · {BODY_REGIONS[p.region].display}
                {p.contrast && " · Contrast needed"}
              </span>
              {dev && <span className="font-mono text-xs text-muted-foreground">orderDetail {p.modality}, bodySite {BODY_REGIONS[p.region].code}</span>}
            </div>
          ))}
          {picked.length > 1 && <p className="mt-1 text-xs text-muted-foreground">Each procedure becomes its own order, because an order document holds one imaging procedure.</p>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Priority" hl7="ServiceRequest.priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason For The Exam" required hl7="Composition.section (procedure indications, LOINC 59768-2)">
          <Input value={indication} required aria-required="true" aria-invalid={!hasReason} onChange={(e) => setIndication(e.target.value)} placeholder="For example: cough and fever" />
        </Field>
        <Field label="Clinical History" hl7="Composition.section (clinical information)">
          <Input value={clinicalInfo} onChange={(e) => setClinicalInfo(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {pending && dupes.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-warn/50 bg-warn/10 p-3">
          <p className="text-sm">
            <span className="font-semibold">Already ordered for this visit:</span> {dupes.join(", ")}. Radiology has not reported the earlier order yet. Order the exam again only if a repeat is needed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => { const p = pending; setPending(null); onSubmit(value, p.andSend); }}>Order Anyway</Button>
            <Button onClick={() => setPending(null)}>Go Back</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Gate allowed={canOrder} reason="Your role cannot order radiology exams.">
          <Button variant="primary" disabled={!ready || !!pending} onClick={() => submit(false)}>{submitLabel}</Button>
        </Gate>
        {showSend && (
          <Gate allowed={canOrder} reason="Your role cannot order radiology exams.">
            <Button disabled={!ready || !!pending} onClick={() => submit(true)}>{submitLabel} And Send To NPHIES</Button>
          </Gate>
        )}
        {onCancel && <Button variant="ghost" onClick={onCancel}>Close</Button>}
        {!canOrder && <span className="self-center text-xs text-muted-foreground">{reason}</span>}
        {whyOff && <span className="self-center text-xs text-muted-foreground" role="status">{whyOff}</span>}
      </div>
    </div>
  );
}
