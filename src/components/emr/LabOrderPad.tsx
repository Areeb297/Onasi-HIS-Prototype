import * as React from "react";
import { Search, X } from "lucide-react";
import { Gate } from "@/components/emr/fhir-ui";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { COMMON_PANELS, COMMON_SINGLES, LAB_CATALOG, QUICK_SETS, testByCode, type LabTest } from "@/lib/fhir/lab-catalog";
import { PRIORITIES, type Priority } from "@/lib/fhir/types";

export interface LabOrderInput {
  codes: string[];
  priority: Priority;
  fasting: boolean | null;
  note: string;
}

function Chip({ test, on, toggle }: { test: LabTest; on: boolean; toggle: () => void }) {
  const dev = useDevMode();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      title={`${test.display} (LOINC ${test.code})${test.madeUp ? " (test code)" : ""}`}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
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
}: {
  /** Names of picked tests that are already open for the visit. The pad warns before it adds them again. */
  duplicatesOf?: (codes: string[]) => string[];
  initial?: LabOrderInput;
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
  const [fasting, setFasting] = React.useState<"" | "yes" | "no">(initial?.fasting === true ? "yes" : initial?.fasting === false ? "no" : "");
  const [note, setNote] = React.useState(initial?.note ?? "");
  const [q, setQ] = React.useState("");
  const [pending, setPending] = React.useState<{ andSend: boolean } | null>(null);

  const toggle = (c: string) => !testsLocked && setCodes((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const addMany = (list: string[]) => !testsLocked && setCodes((cur) => [...new Set([...cur, ...list])]);
  const found = q.trim()
    ? LAB_CATALOG.filter((t) => `${t.short} ${t.display} ${t.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12)
    : [];

  const value: LabOrderInput = { codes, priority, fasting: fasting === "yes" ? true : fasting === "no" ? false : null, note };
  const ready = codes.length > 0 && canOrder;
  const dupes = duplicatesOf && !testsLocked ? duplicatesOf(codes) : [];
  /** A duplicate asks first. Anything else goes straight through. */
  const submit = (andSend: boolean) => (dupes.length > 0 ? setPending({ andSend }) : onSubmit(value, andSend));

  return (
    <div className="space-y-3">
      {!testsLocked && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Quick Sets</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SETS.map((s) => (
                <Button key={s.id} size="sm" onClick={() => addMany(s.codes)} title={s.codes.map((c) => testByCode(c)?.short).join(", ")}>
                  + {s.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Panels</div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_PANELS.map((t) => (
                <Chip key={t.code} test={t} on={codes.includes(t.code)} toggle={() => toggle(t.code)} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Common Tests</div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_SINGLES.map((t) => (
                <Chip key={t.code} test={t} on={codes.includes(t.code)} toggle={() => toggle(t.code)} />
              ))}
            </div>
          </div>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search all tests by name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
          </div>
          {found.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {found.map((t) => (
                <Chip key={t.code} test={t} on={codes.includes(t.code)} toggle={() => toggle(t.code)} />
              ))}
            </div>
          )}
        </>
      )}
      {testsLocked && <p className="text-xs text-muted-foreground">The specimen is collected, so the tests cannot change. You can still change the priority and the note.</p>}

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Selected ({codes.length})</div>
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tap a chip above to add a test.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {codes.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                {testByCode(c)?.short ?? c}
                {!testsLocked && (
                  <button type="button" onClick={() => toggle(c)} aria-label={`Remove ${testByCode(c)?.short}`}>
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_180px_minmax(0,1fr)]">
        <Field label="Priority" hl7="ServiceRequest.priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fasting" hl7="Additional Order Information">
          <Select value={fasting} onChange={(e) => setFasting(e.target.value as "" | "yes" | "no")}>
            <option value="">Not Stated</option>
            <option value="yes">Fasting</option>
            <option value="no">Non-Fasting</option>
          </Select>
        </Field>
        <Field label="Note For The Lab">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

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

      <div className="flex flex-wrap gap-2">
        <Gate allowed={canOrder} reason="Your role cannot order laboratory tests.">
          <Button variant="primary" disabled={!ready || !!pending} onClick={() => submit(false)}>
            {submitLabel}
          </Button>
        </Gate>
        {showSend && (
          <Gate allowed={canOrder} reason="Your role cannot order laboratory tests.">
            <Button disabled={!ready || !!pending} onClick={() => submit(true)}>
              {submitLabel} And Send To NPHIES
            </Button>
          </Gate>
        )}
        {onCancel && <Button variant="ghost" onClick={onCancel}>Close</Button>}
        {!canOrder && <span className="self-center text-xs text-muted-foreground">{reason}</span>}
      </div>
    </div>
  );
}
