import * as React from "react";
import { Search, X } from "lucide-react";
import { ErrorSummary, FormField, FormGrid, FormSection, Segmented } from "@/components/emr/entry-ui";
import { Gate } from "@/components/emr/fhir-ui";
import { OrderCoverageField, OrderDiagnosisField } from "@/components/emr/OrderFields";
import { Button, Input, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { COMMON_PANELS, COMMON_SINGLES, LAB_CATALOG, QUICK_SETS, testByCode, type LabTest } from "@/lib/fhir/lab-catalog";
import { PRIORITIES, type OrderCoverage, type OrderDiagnosis, type Priority } from "@/lib/fhir/types";
import type { Dx } from "@/lib/model";
import { defaultOrderDiagnosis } from "@/lib/order-fields";

export interface LabOrderInput {
  codes: string[];
  priority: Priority;
  fasting: boolean | null;
  note: string;
  /** Visit diagnosis the order is for. null = none linked. */
  diagnosis: OrderDiagnosis | null;
  coverage: OrderCoverage;
}

/** What an existing order brings into the pad. Orders saved before diagnosis and coverage existed have neither. */
export type LabOrderInitial = Omit<LabOrderInput, "diagnosis" | "coverage"> & { diagnosis?: OrderDiagnosis | null; coverage?: OrderCoverage };

type Fasting = "none" | "yes" | "no";
const FASTING: { value: Fasting; label: string }[] = [
  { value: "none", label: "Not Stated" },
  { value: "yes", label: "Fasting" },
  { value: "no", label: "Non-Fasting" },
];
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p.code, label: p.label }));
const groupLabel = "mb-1.5 text-xs font-medium text-muted-foreground";

function Chip({ test, on, toggle }: { test: LabTest; on: boolean; toggle: () => void }) {
  const dev = useDevMode();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      title={`${test.display} (LOINC ${test.code})${test.madeUp ? " (test code)" : ""}`}
      className={cn(
        "min-h-8 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
      )}
    >
      {test.short}
      {test.panel && <span className="ml-1 opacity-70">({test.panel.length})</span>}
      {dev && <span className="ml-1.5 font-mono text-xs opacity-70">{test.code}</span>}
    </button>
  );
}

/**
 * The order pad: tap chips to pick tests, then place the order. Panels and quick sets pick many tests at once.
 * Used for new orders and for amending an order that has not been collected yet.
 */
export function LabOrderPad({
  initial,
  canOrder,
  reason,
  testsLocked,
  submitLabel,
  showSend,
  onSubmit,
  onCancel,
  duplicatesOf,
  diagnoses = [],
  insured = false,
}: {
  /** Names of picked tests that are already open for the visit. The pad warns before it adds them again. */
  duplicatesOf?: (codes: string[]) => string[];
  /** The visit's diagnoses, for the Diagnosis picker. */
  diagnoses?: Dx[];
  /** The visit is billed to an insurance plan. Plan Coverage is offered only then. */
  insured?: boolean;
  initial?: LabOrderInitial;
  canOrder: boolean;
  reason: string;
  /** The specimen is already collected, so tests cannot change. */
  testsLocked?: boolean;
  submitLabel: string;
  showSend?: boolean;
  onSubmit: (v: LabOrderInput, andSend: boolean) => void;
  onCancel?: () => void;
}) {
  const [codes, setCodes] = React.useState<string[]>(initial?.codes ?? []);
  const [priority, setPriority] = React.useState<Priority>(initial?.priority ?? "routine");
  const [fasting, setFasting] = React.useState<Fasting>(initial?.fasting === true ? "yes" : initial?.fasting === false ? "no" : "none");
  const [note, setNote] = React.useState(initial?.note ?? "");
  const [diagnosis, setDiagnosis] = React.useState<OrderDiagnosis | null>(initial ? initial.diagnosis ?? null : defaultOrderDiagnosis(diagnoses));
  const [coverage, setCoverage] = React.useState<OrderCoverage>(initial?.coverage ?? (insured ? "plan" : "self-pay"));
  const [q, setQ] = React.useState("");
  const [pending, setPending] = React.useState<{ andSend: boolean } | null>(null);
  /** An order was tried with no test picked. The message stays until a test is picked. */
  const [tried, setTried] = React.useState(false);

  const toggle = (c: string) => !testsLocked && setCodes((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const addMany = (list: string[]) => !testsLocked && setCodes((cur) => [...new Set([...cur, ...list])]);
  const found = q.trim()
    ? LAB_CATALOG.filter((t) => `${t.short} ${t.display} ${t.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12)
    : [];

  const value: LabOrderInput = { codes, priority, fasting: fasting === "yes" ? true : fasting === "no" ? false : null, note, diagnosis, coverage };
  const noTests = codes.length === 0;
  const showNoTests = tried && noTests;
  const dupes = duplicatesOf && !testsLocked ? duplicatesOf(codes) : [];
  /** No test asks for one. A duplicate asks first. Anything else goes straight through. */
  const submit = (andSend: boolean) => {
    setTried(true);
    if (noTests) return;
    if (dupes.length > 0) setPending({ andSend });
    else onSubmit(value, andSend);
  };

  return (
    <div className="space-y-5">
      {showNoTests && <ErrorSummary problems={["Choose at least one test."]} />}
      <FormSection
        title="Tests"
        description={testsLocked ? "The specimen is collected, so the tests cannot change. You can still change the priority and the note." : "Tap to add or remove a test. Panels and quick sets add several at once."}
      >
        {!testsLocked && (
          <>
            <div>
              <div className={groupLabel}>Quick Sets</div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_SETS.map((s) => (
                  <Button key={s.id} size="sm" onClick={() => addMany(s.codes)} title={s.codes.map((c) => testByCode(c)?.short).join(", ")}>
                    + {s.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <div className={groupLabel}>Panels</div>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_PANELS.map((t) => (
                  <Chip key={t.code} test={t} on={codes.includes(t.code)} toggle={() => toggle(t.code)} />
                ))}
              </div>
            </div>
            <div>
              <div className={groupLabel}>Common Tests</div>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_SINGLES.map((t) => (
                  <Chip key={t.code} test={t} on={codes.includes(t.code)} toggle={() => toggle(t.code)} />
                ))}
              </div>
            </div>
            <div>
              <div className="relative max-w-sm [--field-h:2.5rem]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input className="pl-8" placeholder="Search all tests by name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
              </div>
              {found.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {found.map((t) => (
                    <Chip key={t.code} test={t} on={codes.includes(t.code)} toggle={() => toggle(t.code)} />
                  ))}
                </div>
              )}
              {q.trim() !== "" && found.length === 0 && <p className="mt-1.5 text-xs text-muted-foreground">No test matches. Try fewer letters or the code.</p>}
            </div>
          </>
        )}
        <div className={cn("rounded-lg border bg-muted/30 p-3", showNoTests ? "border-destructive/60" : "border-border")}>
          <div className={groupLabel}>Selected ({codes.length})</div>
          {noTests ? (
            <p className={cn("text-sm", showNoTests ? "font-medium text-destructive" : "text-muted-foreground")}>
              {showNoTests ? "No test chosen yet. Tap a test above to add it." : "Tap a test above to add it."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {codes.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                  {testByCode(c)?.short ?? c}
                  {!testsLocked && (
                    <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggle(c)} aria-label={`Remove ${testByCode(c)?.short}`}>
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </FormSection>

      <FormSection title="Order Details">
        <FormGrid>
          <FormField group label="Priority" hl7="ServiceRequest.priority">
            <Segmented value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
          </FormField>
          <FormField group label="Fasting" hl7="Additional Order Information">
            <Segmented value={fasting} options={FASTING} onChange={setFasting} />
          </FormField>
          <OrderDiagnosisField diagnoses={diagnoses} value={diagnosis} onChange={setDiagnosis} />
          <OrderCoverageField value={coverage} onChange={setCoverage} insured={insured || coverage === "plan"} />
          <FormField label="Note For The Lab" help="Optional." className="sm:col-span-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: sample from the central line" />
          </FormField>
        </FormGrid>
      </FormSection>

      {pending && dupes.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-warn/50 bg-warn/10 p-3">
          <p className="text-sm">
            <span className="font-semibold">Already ordered for this visit:</span> {dupes.join(", ")}. The laboratory has not resulted the earlier order yet. Order the test again only if a new sample is needed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => { const p = pending; setPending(null); onSubmit(value, p.andSend); }}>Order Anyway</Button>
            <Button onClick={() => setPending(null)}>Go Back</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Gate allowed={canOrder} reason="Your role cannot order laboratory tests.">
          <Button variant="primary" disabled={!canOrder || !!pending} onClick={() => submit(false)}>
            {submitLabel}
          </Button>
        </Gate>
        {showSend && (
          <Gate allowed={canOrder} reason="Your role cannot order laboratory tests.">
            <Button disabled={!canOrder || !!pending} onClick={() => submit(true)}>
              {submitLabel} And Send To NPHIES
            </Button>
          </Gate>
        )}
        {onCancel && <Button variant="ghost" onClick={onCancel}>Close</Button>}
        {!canOrder && <span className="text-xs text-muted-foreground">{reason}</span>}
      </div>
    </div>
  );
}
