import * as React from "react";
import { X } from "lucide-react";
import { Gate } from "@/components/emr/fhir-ui";
import { OrderCoverageField, OrderDiagnosisField } from "@/components/emr/OrderFields";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { BODY_REGIONS, MODALITIES, QUICK_RAD, RAD_CATALOG, procByCode, type RadProcedure } from "@/lib/fhir/rad-catalog";
import { PRIORITIES, type OrderCoverage, type OrderDiagnosis, type Priority } from "@/lib/fhir/types";
import type { Dx } from "@/lib/model";
import { defaultOrderDiagnosis } from "@/lib/order-fields";

export interface RadOrderInput {
  /** The exams in this order. Each goes to NPHIES as its own order document. */
  procCodes: string[];
  priority: Priority;
  indication: string;
  clinicalInfo: string;
  /** Visit diagnosis the order is for. null = none linked. */
  diagnosis: OrderDiagnosis | null;
  coverage: OrderCoverage;
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

/**
 * Order pad for imaging. Tap one or more exams, check the reason, place the order. One order can hold several exams;
 * each exam still gets its own worklist line, report and NPHIES order document.
 */
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
  diagnoses = [],
  insured = false,
}: {
  /** Names of picked exams that are already open for the visit. The pad warns before it adds them again. */
  duplicatesOf?: (procCodes: string[]) => string[];
  /** The visit's diagnoses, for the Diagnosis picker. */
  diagnoses?: Dx[];
  /** The visit is billed to an insurance plan. Plan Coverage is offered only then. */
  insured?: boolean;
  /** An existing exam. Orders saved before diagnosis and coverage existed have neither. */
  initial?: { procCode: string; priority: Priority; indication: string; clinicalInfo: string; diagnosis?: OrderDiagnosis | null; coverage?: OrderCoverage };
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
  const [diagnosis, setDiagnosis] = React.useState<OrderDiagnosis | null>(initial ? initial.diagnosis ?? null : defaultOrderDiagnosis(diagnoses));
  const [coverage, setCoverage] = React.useState<OrderCoverage>(initial?.coverage ?? (insured ? "plan" : "self-pay"));
  const [pending, setPending] = React.useState<{ andSend: boolean } | null>(null);

  const toggle = (c: string) => setCodes((cur) => (single ? [c] : cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const pickDiagnosis = (d: OrderDiagnosis | null) => {
    setDiagnosis(d);
    // The diagnosis is a good start for the reason when none is typed yet.
    if (d && !indication.trim()) setIndication(d.text);
  };
  const picked = codes.map((c) => procByCode(c)).filter((p): p is RadProcedure => !!p);
  const hasReason = indication.trim().length > 0;
  const ready = canOrder && picked.length > 0 && hasReason;
  const whyOff = !canOrder ? "" : picked.length === 0 ? "Pick an exam first." : !hasReason ? "Enter the reason for the exam. NPHIES rejects a radiology order without it." : "";
  const value: RadOrderInput = { procCodes: codes, priority, indication, clinicalInfo, diagnosis, coverage };
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
      <div className="rounded-lg border border-border bg-muted/30">
        <div className="px-3 pt-2.5 text-xs font-medium text-muted-foreground">{single ? "Exam" : `Exams In This Order (${picked.length})`}</div>
        {picked.length === 0 ? (
          <p className="px-3 pb-3 pt-1 text-sm text-muted-foreground">Tap an exam above to add it.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-1.5 font-medium">Exam</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Modality</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Body Site</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Contrast</th>
                  {!single && <th scope="col" className="px-3 py-1.5"><span className="sr-only">Remove</span></th>}
                </tr>
              </thead>
              <tbody>
                {picked.map((p) => (
                  <tr key={p.code} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium">
                      {p.display}
                      {dev && <div className="font-mono text-xs font-normal text-muted-foreground">{p.code}</div>}
                    </td>
                    <td className="px-3 py-1.5">
                      {MODALITIES[p.modality].display}
                      {dev && <div className="font-mono text-xs text-muted-foreground">orderDetail {MODALITIES[p.modality].code}</div>}
                    </td>
                    <td className="px-3 py-1.5">
                      {BODY_REGIONS[p.region].display}
                      {dev && <div className="font-mono text-xs text-muted-foreground">bodySite {BODY_REGIONS[p.region].code}</div>}
                    </td>
                    <td className="px-3 py-1.5">{p.contrast ? "Needed" : "No"}</td>
                    {!single && (
                      <td className="px-3 py-1.5 text-right">
                        <button type="button" className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggle(p.code)} aria-label={`Remove ${p.short}`}>
                          <X className="size-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {picked.length > 1 && (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            One order, {picked.length} exams. Modality and body site come with each exam. Radiology does and reports each exam on its own, and each is sent to NPHIES as its own order document.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <OrderDiagnosisField diagnoses={diagnoses} value={diagnosis} onChange={pickDiagnosis} />
        <OrderCoverageField value={coverage} onChange={setCoverage} insured={insured || coverage === "plan"} />
      </div>
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
